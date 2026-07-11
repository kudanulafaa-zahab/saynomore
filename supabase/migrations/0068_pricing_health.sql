-- 0068: Pricing intelligence — margin drift detection + one-tap repricing.
--
-- Problem this solves: landed cost is computed automatically at GRN, but
-- fixed selling prices are static. When a new shipment lands at a higher
-- cost, every fixed price silently keeps selling at a lower margin than the
-- SKU's target, and nothing surfaces it. The owner had to re-derive prices
-- by hand across Products and Price Lists after every shipment.
--
-- 1. get_pricing_health(): for every active SKU with stock, compare the
--    actual margin of each fixed price against target_margin_pct using the
--    latest landed cost, and return the drifted/missing ones with suggested
--    prices and the stock value exposed.
-- 2. apply_target_prices(sku): recompute this SKU's fixed prices from the
--    latest landed cost at its target margin (only the price fields that are
--    already in use), with a full audit_log entry.
-- 3. Fix get_tier_prices_for_skus: its sku_default branch derived pack and
--    carton prices by multiplying the piece price, ignoring the per-UOM
--    fixed_price_per_pack/carton overrides that v_skus (Products screen) and
--    New Sale honour — so two screens could quote different prices for the
--    same SKU. The waterfall now matches v_skus exactly.

-- ── 1. Margin drift report ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pricing_health()
RETURNS TABLE (
  sku_id                 uuid,
  internal_code          text,
  full_path              text,
  stock_pieces           integer,
  stock_value_mvr        numeric,   -- remaining pieces × their batch cost
  landed_per_piece_mvr   numeric,   -- latest batch with stock (what pricing should track)
  target_margin_pct      numeric,
  -- actual margin of each fixed price vs latest landed (NULL when not fixed)
  margin_piece_pct       numeric,
  margin_pack_pct        numeric,
  margin_carton_pct      numeric,
  worst_margin_pct       numeric,
  -- suggested fixed prices at target margin, whole-MVR rounded
  suggested_piece_mvr    numeric,
  suggested_pack_mvr     numeric,
  suggested_carton_mvr   numeric,
  status                 text       -- 'below_target' | 'no_price' | 'no_cost'
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH latest_landed AS (
    SELECT DISTINCT ON (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
    FROM v_batch_stock bs
    WHERE bs.qty_pieces_remaining > 0
    ORDER BY bs.sku_id, bs.received_at DESC
  ),
  stock AS (
    SELECT bs.sku_id,
           SUM(bs.qty_pieces_remaining)::integer AS pieces,
           SUM(bs.qty_pieces_remaining * COALESCE(bs.landed_per_piece_mvr, 0)) AS value_mvr
    FROM v_batch_stock bs
    WHERE bs.qty_pieces_remaining > 0
    GROUP BY bs.sku_id
  ),
  base AS (
    SELECT
      s.id,
      s.internal_code,
      concat_ws(' › ', b.name, m.name, v.display_name) AS full_path,
      st.pieces,
      ROUND(st.value_mvr, 2) AS value_mvr,
      ll.landed_per_piece_mvr AS landed,
      s.target_margin_pct,
      s.pcs_per_pack,
      s.packs_per_carton,
      s.fixed_selling_price_mvr    AS fix_piece,
      s.fixed_price_per_pack_mvr   AS fix_pack,
      s.fixed_price_per_carton_mvr AS fix_carton
    FROM skus s
    JOIN stock st          ON st.sku_id = s.id
    LEFT JOIN latest_landed ll ON ll.sku_id = s.id
    JOIN variants v        ON v.id = s.variant_id
    JOIN product_models m  ON m.id = v.model_id
    JOIN brands b          ON b.id = m.brand_id
    WHERE s.is_active
  ),
  margins AS (
    SELECT *,
      CASE WHEN fix_piece  > 0 AND landed IS NOT NULL
           THEN ROUND((1 - landed / fix_piece) * 100, 1) END AS m_piece,
      CASE WHEN fix_pack   > 0 AND landed IS NOT NULL
           THEN ROUND((1 - landed * pcs_per_pack / fix_pack) * 100, 1) END AS m_pack,
      CASE WHEN fix_carton > 0 AND landed IS NOT NULL
           THEN ROUND((1 - landed * pcs_per_pack * packs_per_carton / fix_carton) * 100, 1) END AS m_carton
    FROM base
  ),
  judged AS (
    SELECT *,
      LEAST(
        COALESCE(m_piece,  999),
        COALESCE(m_pack,   999),
        COALESCE(m_carton, 999)
      ) AS worst,
      CASE
        WHEN landed IS NULL THEN 'no_cost'
        WHEN fix_piece IS NULL AND fix_pack IS NULL AND fix_carton IS NULL
             AND (target_margin_pct IS NULL OR target_margin_pct <= 0)
          THEN 'no_price'
        WHEN target_margin_pct IS NOT NULL AND target_margin_pct > 0
             AND LEAST(COALESCE(m_piece, 999), COALESCE(m_pack, 999), COALESCE(m_carton, 999))
                 < target_margin_pct - 1.0   -- 1pt tolerance absorbs whole-MVR rounding
          THEN 'below_target'
        ELSE 'ok'
      END AS status
    FROM margins
  )
  SELECT
    id, internal_code, full_path,
    pieces, value_mvr, landed, target_margin_pct,
    m_piece, m_pack, m_carton,
    NULLIF(worst, 999),
    CASE WHEN landed IS NOT NULL AND target_margin_pct > 0 AND target_margin_pct < 100
         THEN ROUND(landed / (1 - target_margin_pct / 100.0), 0) END,
    CASE WHEN landed IS NOT NULL AND target_margin_pct > 0 AND target_margin_pct < 100
         THEN ROUND(landed * pcs_per_pack / (1 - target_margin_pct / 100.0), 0) END,
    CASE WHEN landed IS NOT NULL AND target_margin_pct > 0 AND target_margin_pct < 100
         THEN ROUND(landed * pcs_per_pack * packs_per_carton / (1 - target_margin_pct / 100.0), 0) END,
    status
  FROM judged
  WHERE status <> 'ok'
  ORDER BY
    CASE status WHEN 'below_target' THEN 0 WHEN 'no_price' THEN 1 ELSE 2 END,
    value_mvr DESC;
$$;

-- ── 2. One-tap reprice to target margin ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_target_prices(p_sku_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_sku    skus%ROWTYPE;
  v_landed numeric;
  v_new_piece  numeric;
  v_new_pack   numeric;
  v_new_carton numeric;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only admin or manager can reprice';
  END IF;

  SELECT * INTO v_sku FROM skus WHERE id = p_sku_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SKU not found'; END IF;
  IF v_sku.target_margin_pct IS NULL OR v_sku.target_margin_pct <= 0
     OR v_sku.target_margin_pct >= 100 THEN
    RAISE EXCEPTION 'SKU has no valid target margin — set one first';
  END IF;

  SELECT bs.landed_per_piece_mvr INTO v_landed
  FROM v_batch_stock bs
  WHERE bs.sku_id = p_sku_id AND bs.qty_pieces_remaining > 0
  ORDER BY bs.received_at DESC
  LIMIT 1;
  IF v_landed IS NULL THEN
    RAISE EXCEPTION 'No landed cost yet — receive stock via a GRN first';
  END IF;

  -- Only refresh the price fields already in use: a NULL fixed price means
  -- the SKU is margin-priced and already follows landed cost automatically.
  v_new_piece  := ROUND(v_landed / (1 - v_sku.target_margin_pct / 100.0), 0);
  v_new_pack   := ROUND(v_landed * v_sku.pcs_per_pack
                        / (1 - v_sku.target_margin_pct / 100.0), 0);
  v_new_carton := ROUND(v_landed * v_sku.pcs_per_pack * v_sku.packs_per_carton
                        / (1 - v_sku.target_margin_pct / 100.0), 0);

  UPDATE skus SET
    fixed_selling_price_mvr    = CASE WHEN fixed_selling_price_mvr    IS NOT NULL THEN v_new_piece  ELSE NULL END,
    fixed_price_per_pack_mvr   = CASE WHEN fixed_price_per_pack_mvr   IS NOT NULL THEN v_new_pack   ELSE NULL END,
    fixed_price_per_carton_mvr = CASE WHEN fixed_price_per_carton_mvr IS NOT NULL THEN v_new_carton ELSE NULL END,
    updated_at = now()
  WHERE id = p_sku_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('skus', p_sku_id, 'update',
          format('Repriced to %s%% target margin from landed %s MVR/pc (piece %s → %s, pack %s → %s, carton %s → %s)',
                 v_sku.target_margin_pct, v_landed,
                 v_sku.fixed_selling_price_mvr,    CASE WHEN v_sku.fixed_selling_price_mvr    IS NOT NULL THEN v_new_piece  END,
                 v_sku.fixed_price_per_pack_mvr,   CASE WHEN v_sku.fixed_price_per_pack_mvr   IS NOT NULL THEN v_new_pack   END,
                 v_sku.fixed_price_per_carton_mvr, CASE WHEN v_sku.fixed_price_per_carton_mvr IS NOT NULL THEN v_new_carton END),
          auth.uid());
END $$;

-- ── 3. Waterfall consistency: honour per-UOM fixed prices ─────────────────
CREATE OR REPLACE FUNCTION public.get_tier_prices_for_skus(p_sku_ids uuid[], p_tier text DEFAULT 'retail'::text)
 RETURNS TABLE(sku_id uuid, price_per_piece_mvr numeric, price_per_pack_mvr numeric, price_per_carton_mvr numeric, source text, price_list_name text, price_list_date date)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH active_list AS (
    SELECT id, name, effective_from
    FROM price_lists
    WHERE tier = p_tier
      AND effective_from <= CURRENT_DATE
    ORDER BY effective_from DESC
    LIMIT 1
  ),
  list_prices AS (
    SELECT
      pli.sku_id,
      ROUND(pli.price_per_piece_mvr, 0)  AS price_per_piece_mvr,
      ROUND(pli.price_per_pack_mvr, 0)   AS price_per_pack_mvr,
      ROUND(pli.price_per_carton_mvr, 0) AS price_per_carton_mvr,
      'price_list'::TEXT  AS source,
      al.name             AS price_list_name,
      al.effective_from   AS price_list_date
    FROM price_list_items pli
    JOIN active_list al ON al.id = pli.price_list_id
    WHERE pli.sku_id = ANY(p_sku_ids)
  ),
  sku_defaults AS (
    -- Per-UOM fixed prices win over "piece × multiplier" so this RPC quotes
    -- exactly what v_skus (Products screen) shows. Previously pack/carton
    -- were always derived from the piece price, ignoring the overrides.
    SELECT
      s.id                                                           AS sku_id,
      ROUND(s.fixed_selling_price_mvr, 0)                            AS price_per_piece_mvr,
      ROUND(COALESCE(s.fixed_price_per_pack_mvr,
                     s.fixed_selling_price_mvr * s.pcs_per_pack), 0) AS price_per_pack_mvr,
      ROUND(COALESCE(s.fixed_price_per_carton_mvr,
                     s.fixed_selling_price_mvr * s.pcs_per_pack
                       * s.packs_per_carton), 0)                     AS price_per_carton_mvr,
      'sku_default'::TEXT                                            AS source,
      NULL::TEXT                                                     AS price_list_name,
      NULL::DATE                                                     AS price_list_date
    FROM skus s
    WHERE s.id = ANY(p_sku_ids)
      AND (s.fixed_selling_price_mvr IS NOT NULL
           OR s.fixed_price_per_pack_mvr IS NOT NULL
           OR s.fixed_price_per_carton_mvr IS NOT NULL)
  ),
  margin_prices AS (
    SELECT
      s.id AS sku_id,
      ROUND(ll.landed_per_piece_mvr / (1 - s.target_margin_pct / 100.0), 0)            AS price_per_piece_mvr,
      ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack)
            / (1 - s.target_margin_pct / 100.0), 0)                                     AS price_per_pack_mvr,
      ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack * s.packs_per_carton)
            / (1 - s.target_margin_pct / 100.0), 0)                                     AS price_per_carton_mvr,
      'margin'::TEXT                                                                     AS source,
      NULL::TEXT                                                                         AS price_list_name,
      NULL::DATE                                                                         AS price_list_date
    FROM skus s
    JOIN LATERAL (
      SELECT bs.landed_per_piece_mvr
      FROM v_batch_stock bs
      WHERE bs.sku_id = s.id
        AND bs.qty_pieces_remaining > 0
      ORDER BY bs.received_at DESC
      LIMIT 1
    ) ll ON TRUE
    WHERE s.id = ANY(p_sku_ids)
      AND s.fixed_selling_price_mvr IS NULL
      AND s.fixed_price_per_pack_mvr IS NULL
      AND s.fixed_price_per_carton_mvr IS NULL
      AND s.target_margin_pct IS NOT NULL
      AND s.target_margin_pct > 0
      AND s.target_margin_pct < 100
      AND ll.landed_per_piece_mvr IS NOT NULL
  )
  SELECT DISTINCT ON (all_prices.sku_id)
    all_prices.sku_id,
    all_prices.price_per_piece_mvr,
    all_prices.price_per_pack_mvr,
    all_prices.price_per_carton_mvr,
    all_prices.source,
    all_prices.price_list_name,
    all_prices.price_list_date
  FROM (
    SELECT * FROM list_prices
    UNION ALL
    SELECT * FROM sku_defaults
    UNION ALL
    SELECT * FROM margin_prices
  ) all_prices
  ORDER BY all_prices.sku_id,
    CASE all_prices.source
      WHEN 'price_list'  THEN 1
      WHEN 'sku_default' THEN 2
      WHEN 'margin'      THEN 3
      ELSE 4
    END;
$function$;

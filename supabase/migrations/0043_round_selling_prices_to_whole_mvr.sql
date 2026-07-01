-- Ali's rule: every customer-facing selling price is a whole MVR number, no
-- cents (MVR 166, not MVR 165.50). Internal costing (landed cost, forex
-- rates, margin %) keeps its existing higher precision -- this migration only
-- touches the selling-price outputs shown to staff/customers.
--
-- Previously v_skus and the tier-price RPCs rounded computed prices to 2
-- decimal places (ROUND(x, 2)). This changes those to ROUND(x, 0), and also
-- rounds the passthrough branches (fixed_selling_price_mvr typed directly on
-- a SKU, and price_list_items entered in a price list) so a manually-typed
-- decimal price still displays/sells as a whole number everywhere.

-- ── v_skus ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS v_skus;
CREATE VIEW v_skus AS
WITH latest_landed AS (
  SELECT DISTINCT ON (v_batch_stock.sku_id) v_batch_stock.sku_id,
    v_batch_stock.landed_per_piece_mvr
  FROM v_batch_stock
  WHERE v_batch_stock.qty_pieces_remaining > 0
  ORDER BY v_batch_stock.sku_id, v_batch_stock.received_at DESC
)
SELECT s.id,
  s.variant_id,
  s.internal_code,
  s.supplier_barcode,
  s.pcs_per_pack,
  s.packs_per_carton,
  s.pcs_per_pack * s.packs_per_carton AS pcs_per_carton,
  s.carton_length_cm,
  s.carton_width_cm,
  s.carton_height_cm,
  s.carton_weight_kg,
  s.cbm_per_carton,
  s.is_active,
  s.notes,
  s.created_at,
  s.updated_at,
  s.target_margin_pct,
  s.fixed_selling_price_mvr,
  s.fixed_price_per_pack_mvr,
  s.fixed_price_per_carton_mvr,
  ll.landed_per_piece_mvr,
  CASE
    WHEN s.fixed_selling_price_mvr IS NOT NULL THEN ROUND(s.fixed_selling_price_mvr, 0)
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
      THEN ROUND(ll.landed_per_piece_mvr / (1::numeric - s.target_margin_pct / 100.0), 0)
    ELSE NULL::numeric
  END AS selling_price_per_piece_mvr,
  CASE
    WHEN s.fixed_price_per_pack_mvr IS NOT NULL THEN ROUND(s.fixed_price_per_pack_mvr, 0)
    WHEN s.fixed_selling_price_mvr IS NOT NULL THEN ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric, 0)
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
      THEN ROUND(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric / (1::numeric - s.target_margin_pct / 100.0), 0)
    ELSE NULL::numeric
  END AS selling_price_per_pack_mvr,
  CASE
    WHEN s.fixed_price_per_carton_mvr IS NOT NULL THEN ROUND(s.fixed_price_per_carton_mvr, 0)
    WHEN s.fixed_selling_price_mvr IS NOT NULL THEN ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric, 0)
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
      THEN ROUND(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric / (1::numeric - s.target_margin_pct / 100.0), 0)
    ELSE NULL::numeric
  END AS selling_price_per_carton_mvr,
  -- actual_margin_pct: keep 1-decimal precision (an internal analytics
  -- figure, not a price shown to customers) but recompute against the
  -- now-rounded piece price so the displayed margin matches the displayed
  -- price exactly.
  CASE
    WHEN s.fixed_selling_price_mvr IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL AND ll.landed_per_piece_mvr > 0::numeric
      THEN ROUND((1::numeric - ll.landed_per_piece_mvr / ROUND(s.fixed_selling_price_mvr, 0)) * 100::numeric, 1)
    ELSE NULL::numeric
  END AS actual_margin_pct,
  v.attributes,
  v.display_name AS variant_display,
  m.id AS model_id,
  m.name AS model_name,
  b.id AS brand_id,
  b.name AS brand_name,
  pc.id AS category_id,
  pc.name AS category_name,
  pc.unit_uom,
  pc.cost_basis,
  concat_ws(' › '::text, b.name, m.name, v.display_name, (s.pcs_per_pack || '×'::text) || s.packs_per_carton) AS full_path,
  s.sellable_units,
  pc.default_sellable_units
FROM skus s
  JOIN variants v ON v.id = s.variant_id
  JOIN product_models m ON m.id = v.model_id
  JOIN brands b ON b.id = m.brand_id
  JOIN product_categories pc ON pc.id = m.category_id
  LEFT JOIN latest_landed ll ON ll.sku_id = s.id;

-- ── get_tier_price_for_sku ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_tier_price_for_sku(UUID, TEXT);
CREATE FUNCTION get_tier_price_for_sku(
  p_sku_id UUID,
  p_tier   TEXT DEFAULT 'retail'
)
RETURNS TABLE (
  price_per_piece_mvr   NUMERIC,
  price_per_pack_mvr    NUMERIC,
  price_per_carton_mvr  NUMERIC,
  source                TEXT,    -- 'price_list' | 'sku_default' | 'margin'
  price_list_name       TEXT,
  price_list_date       DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_list AS (
    SELECT id, name, effective_from
    FROM price_lists
    WHERE tier = p_tier
      AND effective_from <= CURRENT_DATE
    ORDER BY effective_from DESC
    LIMIT 1
  ),
  list_price AS (
    SELECT
      ROUND(pli.price_per_piece_mvr, 0)  AS price_per_piece_mvr,
      ROUND(pli.price_per_pack_mvr, 0)   AS price_per_pack_mvr,
      ROUND(pli.price_per_carton_mvr, 0) AS price_per_carton_mvr,
      'price_list'::TEXT  AS source,
      al.name             AS price_list_name,
      al.effective_from   AS price_list_date
    FROM price_list_items pli
    JOIN active_list al ON al.id = pli.price_list_id
    WHERE pli.sku_id = p_sku_id
    LIMIT 1
  ),
  sku_default AS (
    SELECT
      ROUND(s.fixed_selling_price_mvr, 0)                            AS price_per_piece_mvr,
      ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack, 0)           AS price_per_pack_mvr,
      ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack
            * s.packs_per_carton, 0)                                 AS price_per_carton_mvr,
      'sku_default'::TEXT                                            AS source,
      NULL::TEXT                                                     AS price_list_name,
      NULL::DATE                                                     AS price_list_date
    FROM skus s
    WHERE s.id = p_sku_id
      AND s.fixed_selling_price_mvr IS NOT NULL
    LIMIT 1
  ),
  -- Latest in-stock landed cost for this SKU (same source as v_skus)
  latest_landed AS (
    SELECT bs.landed_per_piece_mvr
    FROM v_batch_stock bs
    WHERE bs.sku_id = p_sku_id
      AND bs.qty_pieces_remaining > 0
    ORDER BY bs.received_at DESC
    LIMIT 1
  ),
  margin_price AS (
    SELECT
      ROUND(ll.landed_per_piece_mvr / (1 - s.target_margin_pct / 100.0), 0)            AS price_per_piece_mvr,
      ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack)
            / (1 - s.target_margin_pct / 100.0), 0)                                     AS price_per_pack_mvr,
      ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack * s.packs_per_carton)
            / (1 - s.target_margin_pct / 100.0), 0)                                     AS price_per_carton_mvr,
      'margin'::TEXT                                                                     AS source,
      NULL::TEXT                                                                         AS price_list_name,
      NULL::DATE                                                                         AS price_list_date
    FROM skus s
    CROSS JOIN latest_landed ll
    WHERE s.id = p_sku_id
      AND s.fixed_selling_price_mvr IS NULL
      AND s.target_margin_pct IS NOT NULL
      AND s.target_margin_pct > 0
      AND s.target_margin_pct < 100
      AND ll.landed_per_piece_mvr IS NOT NULL
    LIMIT 1
  )
  SELECT * FROM list_price
  UNION ALL
  SELECT * FROM sku_default
  UNION ALL
  SELECT * FROM margin_price
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_tier_price_for_sku(UUID, TEXT) TO authenticated;

-- ── get_tier_prices_for_skus (bulk, used by the sales modal) ────────────
DROP FUNCTION IF EXISTS get_tier_prices_for_skus(UUID[], TEXT);
CREATE FUNCTION get_tier_prices_for_skus(
  p_sku_ids UUID[],
  p_tier    TEXT DEFAULT 'retail'
)
RETURNS TABLE (
  sku_id               UUID,
  price_per_piece_mvr  NUMERIC,
  price_per_pack_mvr   NUMERIC,
  price_per_carton_mvr NUMERIC,
  source               TEXT,
  price_list_name      TEXT,
  price_list_date      DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT
      s.id                                                           AS sku_id,
      ROUND(s.fixed_selling_price_mvr, 0)                            AS price_per_piece_mvr,
      ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack, 0)           AS price_per_pack_mvr,
      ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack
            * s.packs_per_carton, 0)                                 AS price_per_carton_mvr,
      'sku_default'::TEXT                                            AS source,
      NULL::TEXT                                                     AS price_list_name,
      NULL::DATE                                                     AS price_list_date
    FROM skus s
    WHERE s.id = ANY(p_sku_ids)
      AND s.fixed_selling_price_mvr IS NOT NULL
  ),
  -- Margin fallback: latest in-stock landed cost per SKU, only when no fixed price
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
  -- Priority: price_list first, then sku_default, then margin
  ORDER BY all_prices.sku_id,
    CASE all_prices.source
      WHEN 'price_list'  THEN 1
      WHEN 'sku_default' THEN 2
      WHEN 'margin'      THEN 3
      ELSE 4
    END;
$$;

GRANT EXECUTE ON FUNCTION get_tier_prices_for_skus(UUID[], TEXT) TO authenticated;

-- ── Migration 0030: Audit fixes — post_sale idempotency + tier-price margin fallback ──
--
-- Two fixes from the financial-logic audit:
--
-- FIX #1 — post_sale double-deduction landmine
--   The old guard allowed status IN ('draft','confirmed') to proceed, but only
--   flipped draft->confirmed. Calling it on an already-confirmed order would
--   deduct stock a SECOND time. We now reject anything that isn't 'draft', so a
--   confirmed/picked/delivered order can never be re-posted. The normal create
--   flow (which always posts a fresh draft) is unaffected.
--
-- FIX #2 — get_tier_price_for_sku skipped the margin-formula fallback
--   The old chain was: price_list -> fixed_selling_price -> (nothing). A SKU
--   priced ONLY by target_margin_pct, sold to a tier with no price list, came
--   back with no price. We add the documented 3rd level: derive from the latest
--   landed cost via landed/(1-margin%), matching v_skus. Final chain is now:
--     1. price_list item for the tier
--     2. fixed_selling_price_mvr
--     3. margin formula on latest in-stock landed cost
--     4. NULL

-- ── FIX #1 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION post_sale(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order       sales_orders%ROWTYPE;
  v_line        RECORD;
  v_batch       RECORD;
  v_remaining   INTEGER;
  v_take        INTEGER;
  v_user        UUID := auth.uid();
BEGIN
  SELECT * INTO v_order FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.source_godown_id IS NULL THEN RAISE EXCEPTION 'Source godown required'; END IF;
  -- Only a draft order may be posted. Anything already confirmed (or further
  -- along) has already deducted stock — re-posting would double-deduct.
  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'Order already posted (status: %) — stock was already deducted', v_order.status;
  END IF;

  FOR v_line IN
    SELECT id, sku_id, qty_pieces FROM sales_order_lines WHERE order_id = p_order_id
  LOOP
    v_remaining := v_line.qty_pieces;
    FOR v_batch IN
      SELECT bs.batch_id, bs.qty_pieces_remaining, bs.received_at
      FROM v_batch_stock bs
      WHERE bs.sku_id = v_line.sku_id
        AND bs.godown_id = v_order.source_godown_id
        AND bs.qty_pieces_remaining > 0
      ORDER BY bs.received_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_remaining, v_batch.qty_pieces_remaining);
      INSERT INTO stock_movements
        (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, created_by)
      VALUES
        (v_batch.batch_id, v_line.sku_id, v_order.source_godown_id, 'out',
         v_take, 'sales_order', p_order_id, v_user);
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Insufficient stock for SKU % in selected godown', v_line.sku_id;
    END IF;
  END LOOP;

  UPDATE sales_orders SET status='confirmed' WHERE id = p_order_id AND status='draft';
  RETURN p_order_id;
END $$;

-- ── FIX #2 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_tier_price_for_sku(
  p_sku_id UUID,
  p_tier   TEXT DEFAULT 'retail'
)
RETURNS TABLE (
  price_per_piece_mvr   NUMERIC,
  price_per_pack_mvr    NUMERIC,
  price_per_carton_mvr  NUMERIC,
  source                TEXT   -- 'price_list' | 'sku_default' | 'margin'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Most-recent price list for this tier on or before today
  WITH active_list AS (
    SELECT id
    FROM price_lists
    WHERE tier = p_tier
      AND effective_from <= CURRENT_DATE
    ORDER BY effective_from DESC
    LIMIT 1
  ),
  list_price AS (
    SELECT
      pli.price_per_piece_mvr,
      pli.price_per_pack_mvr,
      pli.price_per_carton_mvr,
      'price_list'::TEXT AS source
    FROM price_list_items pli
    JOIN active_list al ON al.id = pli.price_list_id
    WHERE pli.sku_id = p_sku_id
    LIMIT 1
  ),
  sku_default AS (
    SELECT
      s.fixed_selling_price_mvr                                        AS price_per_piece_mvr,
      ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack,         2)    AS price_per_pack_mvr,
      ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack
            * s.packs_per_carton,                                2)    AS price_per_carton_mvr,
      'sku_default'::TEXT                                              AS source
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
      ROUND(ll.landed_per_piece_mvr / (1 - s.target_margin_pct / 100.0), 2) AS price_per_piece_mvr,
      ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack)
            / (1 - s.target_margin_pct / 100.0), 2)                          AS price_per_pack_mvr,
      ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack * s.packs_per_carton)
            / (1 - s.target_margin_pct / 100.0), 2)                          AS price_per_carton_mvr,
      'margin'::TEXT AS source
    FROM skus s
    CROSS JOIN latest_landed ll
    WHERE s.id = p_sku_id
      AND s.fixed_selling_price_mvr IS NULL          -- only when no fixed price
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

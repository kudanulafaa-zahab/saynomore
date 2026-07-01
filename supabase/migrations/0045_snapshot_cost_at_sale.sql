-- Root cause of "profit numbers look wrong": a sale records what was CHARGED
-- (unit_price_mvr) but never what it actually COST at that moment. Every
-- report then re-fetches "today's" landed cost for historical sales too, so
-- margin on old sales silently drifts every time a new shipment lands at a
-- different price. This migration makes true cost/margin permanent at the
-- moment of sale.
--
-- A single sale line can be FIFO-fulfilled from multiple batches at
-- different landed costs (post_sale loops batches oldest-first), so the
-- snapshot is a quantity-weighted average across whichever batches were
-- actually consumed for that line -- not a single batch's cost.

ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS landed_cost_per_piece_mvr NUMERIC(15,4),
  ADD COLUMN IF NOT EXISTS actual_margin_pct NUMERIC(6,2);

COMMENT ON COLUMN sales_order_lines.landed_cost_per_piece_mvr IS
  'Quantity-weighted average landed cost of the batch(es) actually consumed by post_sale for this line. Set once at confirmation, never recalculated -- the permanent record of what this sale really cost. NULL on legacy rows sold before this column existed.';
COMMENT ON COLUMN sales_order_lines.actual_margin_pct IS
  'Locked-in margin at time of sale: (1 - landed_cost_per_piece_mvr / (unit_price_mvr / units_per_uom)) * 100, where units_per_uom converts unit_price_mvr (priced per piece/pack/carton) to a per-piece basis. NULL on legacy rows.';

-- ── post_sale: snapshot weighted-average cost + margin per line ──────────
CREATE OR REPLACE FUNCTION post_sale(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order       sales_orders%ROWTYPE;
  v_line        RECORD;
  v_batch       RECORD;
  v_remaining   INTEGER;
  v_take        INTEGER;
  v_user        UUID := auth.uid();
  v_cost_sum    NUMERIC;   -- sum of (qty_taken * batch landed cost) for the current line
  v_qty_sold    INTEGER;   -- total pieces actually taken for the current line
  v_avg_cost    NUMERIC;
  v_price_per_piece NUMERIC;
  v_margin      NUMERIC;
BEGIN
  SELECT * INTO v_order FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.source_godown_id IS NULL THEN RAISE EXCEPTION 'Source godown required'; END IF;
  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'Order already posted (status: %) — stock was already deducted', v_order.status;
  END IF;

  FOR v_line IN
    SELECT id, sku_id, qty_pieces, uom, unit_price_mvr FROM sales_order_lines WHERE order_id = p_order_id
  LOOP
    v_remaining := v_line.qty_pieces;
    v_cost_sum  := 0;
    v_qty_sold  := 0;

    FOR v_batch IN
      SELECT bs.batch_id, bs.qty_pieces_remaining, bs.received_at, bs.landed_per_piece_mvr
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
      v_cost_sum := v_cost_sum + (v_take * COALESCE(v_batch.landed_per_piece_mvr, 0));
      v_qty_sold := v_qty_sold + v_take;
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Insufficient stock for SKU % in selected godown', v_line.sku_id;
    END IF;

    -- Snapshot: quantity-weighted average cost across whichever batches were consumed.
    v_avg_cost := CASE WHEN v_qty_sold > 0 THEN v_cost_sum / v_qty_sold ELSE NULL END;

    -- unit_price_mvr is priced per the line's UOM (piece/pack/carton); convert
    -- to per-piece so it's comparable to landed_per_piece_mvr.
    SELECT
      v_line.unit_price_mvr / CASE v_line.uom
        WHEN 'carton' THEN (s.pcs_per_pack * s.packs_per_carton)
        WHEN 'pack'   THEN s.pcs_per_pack
        ELSE 1
      END
    INTO v_price_per_piece
    FROM skus s WHERE s.id = v_line.sku_id;

    v_margin := CASE
      WHEN v_avg_cost IS NOT NULL AND v_price_per_piece IS NOT NULL AND v_price_per_piece > 0
        THEN ROUND((1 - v_avg_cost / v_price_per_piece) * 100, 2)
      ELSE NULL
    END;

    UPDATE sales_order_lines
    SET landed_cost_per_piece_mvr = v_avg_cost,
        actual_margin_pct         = v_margin
    WHERE id = v_line.id;
  END LOOP;

  UPDATE sales_orders SET status='confirmed' WHERE id = p_order_id AND status='draft';
  RETURN p_order_id;
END $function$;

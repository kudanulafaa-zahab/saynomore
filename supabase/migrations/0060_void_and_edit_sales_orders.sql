-- ============================================================================
-- 0060 — Void confirmed sales orders + safely edit/delete individual lines
-- ============================================================================
-- Audit finding (full-app review, 2026-07): deleteOrder() on a confirmed order
-- was a plain cascade delete with no stock reversal -- stock silently vanished
-- from the ledger forever, permanently understating on-hand quantity. And the
-- order-line edit/delete UI was fully built (LineDialog, handleDeleteLine) but
-- wired dead (editable={false} everywhere), because there was no safe way to
-- edit a line post-confirmation: post_sale() already FIFO-depleted specific
-- batches, so a naive UPDATE on qty/price would leave stock_movements out of
-- sync with the line, corrupting every report built on SUM(qty_pieces).
--
-- Fix: two RPCs that always reverse-then-reapply stock inside one transaction,
-- exactly mirroring how admin_void_grn (0005) already reverses GRN stock.
--   1. void_sales_order(order_id, reason)
--      - Deletes every 'out' stock_movements row created by post_sale() for
--        this order (restores exact quantities to the exact batches they came
--        from -- no guessing which batch to credit).
--      - Sets status='cancelled' (never deletes the order or its lines --
--        preserves full audit history, matches "void don't delete" decision).
--      - Blocked once payment_status is 'paid'/'deposited' or delivered with
--        cash collected, to avoid orphaning settled money -- those require a
--        manual credit note, a separate future feature, not silent voiding.
--   2. edit_sales_order_line(line_id, new_qty_pieces, new_unit_price_mvr)
--      - Reverses this line's own 'out' movements (only this line's, matched
--        via source_id = order_id AND sku_id = line.sku_id, scoped further by
--        deleting exactly the movements created for this line -- see note
--        below on why source_id alone isn't enough).
--      - Re-runs the same FIFO logic post_sale() uses to re-deplete for the
--        new quantity.
--      - Recomputes landed_cost_per_piece_mvr / actual_margin_pct / qty /
--        unit_price / line_total_mvr -- all in SQL, never in TypeScript.
--      - Only allowed while order status IN ('confirmed','picked') -- once
--        out_for_delivery/delivered, a line correction risks disagreeing with
--        what the driver physically has on the vehicle; use void + recreate.
--
-- Known limitation (accepted): stock_movements has no line_id column, only
-- (source_type='sales_order', source_id=order_id, sku_id). If an order has
-- two lines for the SAME sku_id (currently not possible -- the UI's
-- LineDialog upserts by sku_id per order, and there is no schema constraint
-- preventing it either way), editing one line could reverse/redeplete the
-- wrong movements. This migration adds that constraint explicitly so the
-- assumption holds going forward.
-- ============================================================================

BEGIN;

-- ── Guarantee the assumption edit_sales_order_line relies on ───────────────
-- (one line per SKU per order) so line-level stock reversal is unambiguous.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_lines_order_sku_uniq'
  ) THEN
    ALTER TABLE sales_order_lines
      ADD CONSTRAINT sales_order_lines_order_sku_uniq UNIQUE (order_id, sku_id);
  END IF;
END $$;

-- ── void_sales_order ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION void_sales_order(p_order_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order   sales_orders%ROWTYPE;
  v_user    UUID := auth.uid();
  v_reversed INTEGER;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only a manager or admin can void a confirmed order';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to void an order';
  END IF;

  SELECT * INTO v_order FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.status IN ('cancelled') THEN
    RAISE EXCEPTION 'Order already cancelled';
  END IF;
  IF v_order.status = 'draft' THEN
    RAISE EXCEPTION 'Draft order has no stock to reverse — delete it directly instead';
  END IF;
  IF v_order.payment_status IN ('paid', 'deposited') THEN
    RAISE EXCEPTION 'Cannot void: payment already settled (%). Issue a credit note instead.', v_order.payment_status;
  END IF;
  IF v_order.status = 'delivered' AND COALESCE(v_order.cash_collected_mvr, 0) > 0 THEN
    RAISE EXCEPTION 'Cannot void: cash already collected on delivery. Issue a credit note instead.';
  END IF;

  -- Restore stock: delete exactly the 'out' movements post_sale() created for
  -- this order. This credits the SAME batches the sale drew from — no
  -- guessing which batch to add back to.
  DELETE FROM stock_movements
  WHERE source_type = 'sales_order'
    AND source_id = p_order_id
    AND movement_type = 'out';
  GET DIAGNOSTICS v_reversed = ROW_COUNT;

  UPDATE sales_orders SET status = 'cancelled' WHERE id = p_order_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('sales_orders', p_order_id, 'update',
          format('voided — %s stock movement(s) reversed. Reason: %s', v_reversed, p_reason), v_user);
END $$;

GRANT EXECUTE ON FUNCTION void_sales_order(UUID, TEXT) TO authenticated;

-- ── edit_sales_order_line ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION edit_sales_order_line(
  p_line_id UUID,
  p_new_qty_pieces INTEGER,
  p_new_unit_price_mvr NUMERIC
)
RETURNS sales_order_lines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line        sales_order_lines%ROWTYPE;
  v_order       sales_orders%ROWTYPE;
  v_user        UUID := auth.uid();
  v_batch       RECORD;
  v_remaining   INTEGER;
  v_take        INTEGER;
  v_cost_sum    NUMERIC := 0;
  v_qty_sold    INTEGER := 0;
  v_avg_cost    NUMERIC;
  v_price_per_piece NUMERIC;
  v_margin      NUMERIC;
  v_units_per_uom NUMERIC;
  v_new_line_total NUMERIC;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only a manager or admin can edit a confirmed order line';
  END IF;
  IF p_new_qty_pieces IS NULL OR p_new_qty_pieces <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;
  IF p_new_unit_price_mvr IS NULL OR p_new_unit_price_mvr < 0 THEN
    RAISE EXCEPTION 'Price cannot be negative';
  END IF;

  SELECT * INTO v_line FROM sales_order_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order line not found'; END IF;

  SELECT * INTO v_order FROM sales_orders WHERE id = v_line.order_id;
  IF v_order.status NOT IN ('confirmed', 'picked') THEN
    RAISE EXCEPTION 'Can only edit lines while order is confirmed or picked (status: %) — void and recreate instead', v_order.status;
  END IF;

  -- Reverse this line's existing stock impact (scoped to this SKU within this
  -- order — the unique constraint above guarantees no other line shares it).
  DELETE FROM stock_movements
  WHERE source_type = 'sales_order'
    AND source_id = v_order.id
    AND sku_id = v_line.sku_id
    AND movement_type = 'out';

  -- Re-deplete FIFO for the new quantity, identical logic to post_sale().
  v_remaining := p_new_qty_pieces;
  FOR v_batch IN
    SELECT bs.batch_id, bs.qty_pieces_remaining, bs.received_at, bs.landed_per_piece_mvr
    FROM v_batch_stock bs
    WHERE bs.sku_id = v_line.sku_id
      AND bs.godown_id = v_order.source_godown_id
      AND bs.qty_pieces_remaining > 0
    ORDER BY bs.received_at ASC, bs.batch_id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_batch.qty_pieces_remaining);
    INSERT INTO stock_movements
      (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, created_by)
    VALUES
      (v_batch.batch_id, v_line.sku_id, v_order.source_godown_id, 'out',
       v_take, 'sales_order', v_order.id, v_user);
    v_cost_sum := v_cost_sum + (v_take * COALESCE(v_batch.landed_per_piece_mvr, 0));
    v_qty_sold := v_qty_sold + v_take;
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient stock for SKU % in selected godown — only % of % pieces available', v_line.sku_id, v_qty_sold, p_new_qty_pieces;
  END IF;

  v_avg_cost := CASE WHEN v_qty_sold > 0 THEN v_cost_sum / v_qty_sold ELSE NULL END;

  SELECT CASE v_line.uom
    WHEN 'carton' THEN s.pcs_per_pack * s.packs_per_carton
    WHEN 'pack'   THEN s.pcs_per_pack
    ELSE 1
  END INTO v_units_per_uom
  FROM skus s WHERE s.id = v_line.sku_id;

  v_price_per_piece := p_new_unit_price_mvr / NULLIF(v_units_per_uom, 0);
  v_margin := CASE
    WHEN v_avg_cost IS NOT NULL AND v_price_per_piece IS NOT NULL AND v_price_per_piece > 0
      THEN ROUND((1 - v_avg_cost / v_price_per_piece) * 100, 2)
    ELSE NULL
  END;

  -- new qty in the line's own uom (pieces / units_per_uom), and line_total —
  -- computed here in SQL, never in TypeScript, per the app's financial rule.
  v_new_line_total := ROUND(p_new_qty_pieces::NUMERIC / NULLIF(v_units_per_uom, 0) * p_new_unit_price_mvr, 2);

  UPDATE sales_order_lines
  SET qty                       = p_new_qty_pieces::NUMERIC / NULLIF(v_units_per_uom, 0),
      qty_pieces                = p_new_qty_pieces,
      unit_price_mvr            = p_new_unit_price_mvr,
      line_total_mvr            = v_new_line_total,
      landed_cost_per_piece_mvr = v_avg_cost,
      actual_margin_pct         = v_margin
  WHERE id = p_line_id
  RETURNING * INTO v_line;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('sales_order_lines', p_line_id, 'update', 'line edited — stock re-deducted via FIFO', v_user);

  RETURN v_line;
END $$;

GRANT EXECUTE ON FUNCTION edit_sales_order_line(UUID, INTEGER, NUMERIC) TO authenticated;

-- ── Lock down the old blunt-delete path for confirmed orders ────────────────
-- so_mgr_all was FOR ALL (is_admin_or_manager()), which in Postgres RLS
-- applies to SELECT/INSERT/UPDATE/DELETE alike with no status restriction —
-- so a manager could delete a confirmed order and silently lose its stock
-- reversal, the exact bug this migration fixes. Replaced with one policy per
-- command: SELECT/INSERT/UPDATE unchanged in effect, DELETE now scoped to
-- true drafts only (no stock ever posted). Anything past draft must go
-- through void_sales_order() above, which reverses stock before cancelling.
DROP POLICY IF EXISTS so_mgr_all ON sales_orders;
CREATE POLICY so_mgr_select ON sales_orders FOR SELECT USING (is_admin_or_manager());
CREATE POLICY so_mgr_insert ON sales_orders FOR INSERT WITH CHECK (is_admin_or_manager());
CREATE POLICY so_mgr_update ON sales_orders FOR UPDATE USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY so_mgr_delete ON sales_orders FOR DELETE USING (is_admin_or_manager() AND status = 'draft');

-- Same problem, same fix, on sales_order_lines: sol_mgr_all (FOR ALL) let a
-- manager delete a line straight from a confirmed order via deleteOrderLine(),
-- desyncing stock_movements from the line just like the order-level bug.
-- Line deletion on anything past draft must go through edit_sales_order_line()
-- (set qty to reflect the removal) — direct delete stays draft-only.
DROP POLICY IF EXISTS sol_mgr_all ON sales_order_lines;
CREATE POLICY sol_mgr_select ON sales_order_lines FOR SELECT USING (is_admin_or_manager());
CREATE POLICY sol_mgr_insert ON sales_order_lines FOR INSERT WITH CHECK (is_admin_or_manager());
CREATE POLICY sol_mgr_update ON sales_order_lines FOR UPDATE USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY sol_mgr_delete ON sales_order_lines FOR DELETE USING (
  is_admin_or_manager()
  AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = sales_order_lines.order_id AND so.status = 'draft')
);

COMMIT;

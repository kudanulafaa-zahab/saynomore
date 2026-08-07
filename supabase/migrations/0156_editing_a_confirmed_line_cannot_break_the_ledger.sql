-- 0156 — editing a confirmed order line can no longer break the ledger.
--
-- Found by continuing the audit that produced 0154. The returns bug was
-- hiding in a money path that had never been tested AND never been used in
-- production. So I listed every function that mutates stock or money and
-- checked both: 10 of 15 had no test, and exactly two of those had also never
-- run in production — edit_sales_order_line and record_cod_collection. That
-- is the same profile the returns bug had.
--
-- edit_sales_order_line had three bugs. All three were reproduced end to end
-- on a clean database before this was written.
--
-- 1. IT COULD INVENT STOCK OUT OF NOTHING.
--
--    The edit deletes the line's 'out' movements and re-deducts FIFO for the
--    new quantity. It does NOT touch the 'return_in' movements a customer
--    return wrote against the same order. Reduce the line below what was
--    already returned and the return outweighs the sale:
--
--      sold 170, customer returns 136 (restocked)   -> stock 986 of 1,020
--      edit the line down to 34 pieces              -> stock 1,122 of 1,020
--
--    A hundred and two pieces conjured from nowhere, and a customer recorded
--    as returning 136 of a 34-piece purchase. Every stock value, margin and
--    reorder figure downstream reads that number.
--
--    Fixed by refusing the edit. You cannot sell someone less than they have
--    already sent back; the correction is to void the return first. This is
--    the same shape as the existing guard in record_customer_return, which
--    checks the sold quantity at return time — but nothing stopped a later
--    EDIT from retroactively invalidating it.
--
-- 2. A NON-WHOLE QUANTITY CRASHED WITH A RAW DATABASE ERROR.
--
--    qty is numeric(12,3) and the check constraint allows the line total to
--    differ from qty x price by at most 0.02. The function computed the total
--    from the UNROUNDED quantity, so editing to 100 pieces of a 34-piece pack
--    stored qty 2.941 while charging 2,058.82 — the recorded quantity is
--    worth 2,058.70. Off by 0.12, six times the tolerance, and it surfaced as
--    "violates check constraint sol_line_total_matches".
--
--    Two fixes. The total is now computed from the same rounded quantity that
--    gets stored, so the money always matches what is recorded. And a whole-
--    unit guard rejects the input first with a plain sentence, because a
--    business that sells packs and cartons does not sell 2.941 packs.
--
-- 3. THE PAYMENT STATUS WENT STALE.
--
--    Cut a fully paid MVR 3,500 line down to MVR 700 and the customer is
--    2,800 in credit — the balance view says so — while sales_orders.
--    payment_status still reads 'paid'. Money owed back to a customer,
--    invisible on the orders list. record_customer_return already calls
--    recalculate_order_payment_status for exactly this reason; the edit path
--    never did.
--
-- Nothing else changes: authorisation, the status whitelist, the FIFO
-- re-deduction, the re-locked landed cost and the audit entry are all
-- carried over as they were.

BEGIN;

CREATE OR REPLACE FUNCTION public.edit_sales_order_line(
  p_line_id uuid,
  p_new_qty_pieces integer,
  p_new_unit_price_mvr numeric
)
RETURNS sales_order_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_line            sales_order_lines%ROWTYPE;
  v_order           sales_orders%ROWTYPE;
  v_user            UUID := auth.uid();
  v_batch           RECORD;
  v_remaining       INTEGER;
  v_take            INTEGER;
  v_cost_sum        NUMERIC := 0;
  v_qty_sold        INTEGER := 0;
  v_avg_cost        NUMERIC;
  v_price_per_piece NUMERIC;
  v_margin          NUMERIC;
  v_units_per_uom   NUMERIC;
  v_qty_uom         NUMERIC;
  v_new_line_total  NUMERIC;
  v_returned        INTEGER;
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

  -- How many pieces make up one of whatever this line is sold in. Needed
  -- before the guards below, not just for the money at the end.
  SELECT CASE v_line.uom
    WHEN 'carton' THEN s.pcs_per_pack * s.packs_per_carton
    WHEN 'pack'   THEN s.pcs_per_pack
    ELSE 1
  END INTO v_units_per_uom
  FROM skus s WHERE s.id = v_line.sku_id;

  -- ── Guard 1: whole selling units only ───────────────────────────────────
  -- The business sells packs and cartons, never a fraction of one. Without
  -- this the fraction reaches the line, qty rounds to 3 decimals, and the
  -- money no longer matches the quantity — which surfaced as a raw check
  -- constraint violation rather than anything a human could act on.
  IF v_units_per_uom > 1 AND mod(p_new_qty_pieces, v_units_per_uom::integer) <> 0 THEN
    RAISE EXCEPTION 'This line is sold by the % of %. Choose a whole number of %s — % or %, not %.',
      v_line.uom,
      v_units_per_uom::integer,
      v_line.uom,
      floor(p_new_qty_pieces::numeric / v_units_per_uom)::integer,
      ceil(p_new_qty_pieces::numeric / v_units_per_uom)::integer,
      round(p_new_qty_pieces::numeric / v_units_per_uom, 2);
  END IF;

  -- ── Guard 2: never below what has already come back ─────────────────────
  -- The edit rewrites this line's 'out' movements but leaves the 'return_in'
  -- movements a return wrote. Reducing the line below the returned quantity
  -- therefore creates stock that was never received.
  SELECT COALESCE(SUM(qty_pieces), 0) INTO v_returned
  FROM sales_returns
  WHERE order_id = v_order.id AND sku_id = v_line.sku_id;

  IF p_new_qty_pieces < v_returned THEN
    RAISE EXCEPTION '% %s have already been returned on this line — it cannot be reduced to %. Void the return first.',
      round(v_returned::numeric / NULLIF(v_units_per_uom, 0), 2),
      v_line.uom,
      round(p_new_qty_pieces::numeric / NULLIF(v_units_per_uom, 0), 2) || ' ' || v_line.uom || 's';
  END IF;

  -- Reverse this line's existing stock impact (scoped to this SKU within this
  -- order — the unique constraint guarantees no other line shares it).
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
    RAISE EXCEPTION 'Insufficient stock for SKU % in selected godown — only % of % pieces available',
      v_line.sku_id, v_qty_sold, p_new_qty_pieces;
  END IF;

  v_avg_cost := CASE WHEN v_qty_sold > 0 THEN v_cost_sum / v_qty_sold ELSE NULL END;

  v_price_per_piece := p_new_unit_price_mvr / NULLIF(v_units_per_uom, 0);
  v_margin := CASE
    WHEN v_avg_cost IS NOT NULL AND v_price_per_piece IS NOT NULL AND v_price_per_piece > 0
      THEN ROUND((1 - v_avg_cost / v_price_per_piece) * 100, 2)
    ELSE NULL
  END;

  -- The quantity as it will be STORED, and the total derived from that same
  -- value. Computing the total from the unrounded quantity is what let the
  -- money drift from the recorded amount.
  v_qty_uom        := ROUND(p_new_qty_pieces::NUMERIC / NULLIF(v_units_per_uom, 0), 3);
  v_new_line_total := ROUND(v_qty_uom * p_new_unit_price_mvr, 2);

  UPDATE sales_order_lines
  SET qty                       = v_qty_uom,
      qty_pieces                = p_new_qty_pieces,
      unit_price_mvr            = p_new_unit_price_mvr,
      line_total_mvr            = v_new_line_total,
      landed_cost_per_piece_mvr = v_avg_cost,
      actual_margin_pct         = v_margin
  WHERE id = p_line_id
  RETURNING * INTO v_line;

  -- The order is worth a different amount now, so what the customer owes has
  -- changed. Without this a fully paid order that shrinks stays 'paid' while
  -- the customer is silently in credit.
  PERFORM recalculate_order_payment_status(v_order.id);

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('sales_order_lines', p_line_id, 'update', 'line edited — stock re-deducted via FIFO', v_user);

  RETURN v_line;
END $function$;

REVOKE EXECUTE ON FUNCTION public.edit_sales_order_line(uuid, integer, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.edit_sales_order_line(uuid, integer, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.edit_sales_order_line(uuid, integer, numeric) TO authenticated;

COMMIT;

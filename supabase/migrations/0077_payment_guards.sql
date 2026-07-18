-- ============================================================================
-- 0077 — Payment money-safety guards (2026-07-18 expert audit)
-- ============================================================================
-- Two holes in the payment path, both of the "losing money by accident"
-- class the project forbids:
--
-- 1) record_order_payment accepted any amount against any order: a typo
--    (extra zero) silently recorded an overpayment and flipped the order
--    to paid; money could also be recorded against draft or cancelled
--    orders, where no receivable exists — the Owed screen never shows it.
--    Now: positive payments only on live (non-draft, non-cancelled)
--    orders, and never more than the outstanding balance. Reversals
--    (negative amounts) stay allowed on any status — that's exactly the
--    cleanup path for refunds.
--
-- 2) void_sales_order blocked voiding fully-paid orders but happily
--    voided PARTIALLY-paid ones. The part-payment then sat orphaned on a
--    cancelled order — a refund owed to the customer, tracked nowhere
--    (receivables excludes cancelled orders). Now: any order with net
--    payments recorded must have them reversed first; the error says
--    exactly how much and what to do.
--
-- Both functions already exist, so CREATE OR REPLACE keeps their grants
-- (authenticated); the 0076 default-privileges lockdown covers the rest.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_order_payment(
  p_order_id uuid,
  p_amount_mvr numeric,
  p_method text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS order_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row         order_payments;
  v_order       sales_orders%ROWTYPE;
  v_total       numeric;
  v_paid        numeric;
  v_outstanding numeric;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only an admin or manager can record a payment';
  END IF;
  IF p_amount_mvr = 0 THEN
    RAISE EXCEPTION 'Payment amount cannot be zero';
  END IF;

  SELECT * INTO v_order FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  -- Positive payments only against a live receivable. Reversals (negative)
  -- stay allowed on any status — that's how orphaned money gets cleaned up.
  IF p_amount_mvr > 0 THEN
    IF v_order.status = 'draft' THEN
      RAISE EXCEPTION 'This order is still a draft — confirm it first, then record the payment';
    END IF;
    IF v_order.status = 'cancelled' THEN
      RAISE EXCEPTION 'This order is cancelled — there is nothing owed on it';
    END IF;

    SELECT COALESCE(SUM(sol.line_total_mvr), 0) INTO v_total
    FROM sales_order_lines sol WHERE sol.order_id = p_order_id;
    SELECT COALESCE(SUM(op.amount_mvr), 0) INTO v_paid
    FROM order_payments op WHERE op.order_id = p_order_id;
    v_outstanding := v_total - v_paid;

    IF p_amount_mvr > v_outstanding + 0.005 THEN
      RAISE EXCEPTION 'Only MVR % is outstanding on this order — MVR % would overpay it by MVR %. Check the amount.',
        to_char(v_outstanding, 'FM999,999,990.00'),
        to_char(p_amount_mvr,  'FM999,999,990.00'),
        to_char(p_amount_mvr - v_outstanding, 'FM999,999,990.00');
    END IF;
  END IF;

  INSERT INTO order_payments (order_id, amount_mvr, method, paid_at, reference, note, is_reversal, created_by)
  VALUES (p_order_id, p_amount_mvr, COALESCE(p_method,'transfer'), COALESCE(p_paid_at, now()),
          p_reference, p_note, p_amount_mvr < 0, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.void_sales_order(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order    sales_orders%ROWTYPE;
  v_user     UUID := auth.uid();
  v_reversed INTEGER;
  v_paid     numeric;
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

  -- NEW (0077): a partially-paid order must have its payments reversed first,
  -- otherwise the customer's money sits orphaned on a cancelled order that no
  -- screen tracks (receivables excludes cancelled orders by design).
  SELECT COALESCE(SUM(op.amount_mvr), 0) INTO v_paid
  FROM order_payments op WHERE op.order_id = p_order_id;
  IF v_paid > 0.005 THEN
    RAISE EXCEPTION 'MVR % has already been paid on this order — remove or reverse the payment first, then void.',
      to_char(v_paid, 'FM999,999,990.00');
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

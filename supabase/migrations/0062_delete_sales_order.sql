-- 0062_delete_sales_order.sql
-- Hard-delete a sales order, returning any posted stock to inventory first.
--
-- Context: the app already had void_sales_order() (0060), which reverses FIFO
-- stock and marks an order 'cancelled' but keeps the row for audit. There was
-- no way to REMOVE an order once cancelled — the RLS DELETE policy only allows
-- deleting 'draft' rows (so_mgr_delete), so cancelled orders piled up on the
-- Sales list with no delete affordance, and a client-side delete on them
-- silently affected 0 rows. Ali asked to be able to delete a sale outright and
-- have the stock go back to inventory (confirmed: hard delete, no trace).
--
-- This RPC does it safely and atomically:
--   * admin/manager only;
--   * reverses stock exactly like void (delete the 'out' movements this order
--     created — stock = SUM(stock_movements), so removing an 'out' row restores
--     that quantity to the same batch it was drawn from);
--   * blocks when money is settled (paid/deposited) or cash was collected on
--     delivery — erasing a paid order with no record is an accounting hole, so
--     those must go through void + a credit note instead;
--   * audit-logs BEFORE deleting (captures order number + reason), then hard
--     deletes. sales_order_lines and order_payments cascade with the order.
--
-- Idempotent to re-run (CREATE OR REPLACE). No schema change to tables.

CREATE OR REPLACE FUNCTION public.delete_sales_order(p_order_id uuid, p_reason text DEFAULT NULL)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_order    sales_orders%ROWTYPE;
  v_user     UUID := auth.uid();
  v_reversed INTEGER := 0;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only a manager or admin can delete an order';
  END IF;

  SELECT * INTO v_order FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Money guard: a settled order must not vanish without a trace.
  IF v_order.payment_status IN ('paid', 'deposited') THEN
    RAISE EXCEPTION 'Cannot delete: payment already settled (%). Void the order and issue a credit note instead.', v_order.payment_status;
  END IF;
  IF COALESCE(v_order.cash_collected_mvr, 0) > 0 THEN
    RAISE EXCEPTION 'Cannot delete: cash already collected on delivery. Void the order and issue a credit note instead.';
  END IF;

  -- Return stock to inventory: remove the 'out' movements this order posted.
  -- Cancelled orders already had these removed by void → this is a no-op for
  -- them (v_reversed = 0). Draft orders never posted stock → also 0.
  DELETE FROM stock_movements
  WHERE source_type = 'sales_order'
    AND source_id   = p_order_id
    AND movement_type = 'out';
  GET DIAGNOSTICS v_reversed = ROW_COUNT;

  -- Audit BEFORE the row is gone (record_id kept for traceability).
  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('sales_orders', p_order_id, 'delete',
          format('deleted order %s (was %s) — %s stock movement(s) reversed.%s',
                 v_order.order_number, v_order.status, v_reversed,
                 CASE WHEN p_reason IS NULL OR trim(p_reason) = '' THEN ''
                      ELSE ' Reason: ' || p_reason END),
          v_user);

  -- Hard delete; lines + payments cascade (FKs verified ON DELETE CASCADE).
  DELETE FROM sales_orders WHERE id = p_order_id;
END $function$;

-- Lock down execute: authenticated users only (RPC self-checks admin/manager).
REVOKE ALL ON FUNCTION public.delete_sales_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_sales_order(uuid, text) TO authenticated;

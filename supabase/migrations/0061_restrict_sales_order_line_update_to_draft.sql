-- ============================================================================
-- 0061 — Restrict direct UPDATE on sales_order_lines to draft orders only
-- ============================================================================
-- 0060 closed the DELETE path (a manager could delete a confirmed order's
-- line via deleteOrderLine(), desyncing stock_movements). The same gap exists
-- for UPDATE: sol_mgr_update (0060) had no status restriction, so the
-- LineDialog's "edit" path (updateOrderLine() in lib/queries/sales.ts) could
-- silently change qty/price on a line whose stock was already FIFO-deducted
-- by post_sale(), leaving stock_movements permanently out of sync with the
-- line and corrupting every report built on SUM(qty_pieces) or
-- landed_cost_per_piece_mvr.
--
-- Once an order is past draft, qty/price corrections must go through
-- edit_sales_order_line() (0060), which reverses old stock impact and
-- re-applies FIFO for the new quantity inside one transaction. Draft-status
-- lines (the brief window between createOrder and postSale during initial
-- order entry) have no stock impact yet, so direct UPDATE there is still safe
-- and unrestricted.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS sol_mgr_update ON sales_order_lines;
CREATE POLICY sol_mgr_update ON sales_order_lines FOR UPDATE
  USING (
    is_admin_or_manager()
    AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = sales_order_lines.order_id AND so.status = 'draft')
  )
  WITH CHECK (
    is_admin_or_manager()
    AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = sales_order_lines.order_id AND so.status = 'draft')
  );

COMMIT;

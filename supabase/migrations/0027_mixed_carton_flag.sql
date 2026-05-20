-- ============================================================================
-- 0027 — Mixed carton flag on sales_order_lines
-- ============================================================================
-- Adds is_mixed_carton_fill to record that individual pieces on a line were
-- sold at carton rate (customer assembled their own mixed carton).
--
-- No change to:
--   • stock_movements  — still deducts qty_pieces per SKU (correct)
--   • post_sale RPC    — still FIFO-depletes by qty_pieces per SKU (correct)
--   • unit_price_mvr   — already stores the price charged (carton÷pcs or piece)
--   • line_total_mvr   — always qty × unit_price_mvr (unchanged)
--
-- This flag is informational: it tells the UI and reports "this piece was
-- priced at carton rate as part of a customer-assembled mixed carton."
-- ============================================================================

ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS is_mixed_carton_fill BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN sales_order_lines.is_mixed_carton_fill IS
  'True when the customer assembled their own mixed carton from individual pieces '
  'but was charged at the carton-rate-per-piece price instead of the retail piece price.';

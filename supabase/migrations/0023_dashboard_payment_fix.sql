-- Dashboard v5: restore correct pending_payments_mvr
-- The split in 0022 was wrong — it excluded COD-pending orders from the AR figure.
-- Correct definition: all delivered orders where money has not yet been received,
-- regardless of payment method. Undelivered orders (confirmed/out_for_delivery)
-- are excluded — the money does not exist yet and is not a receivable.
--
-- Also adds pending_payments_count so the dashboard can show "X orders unpaid"
-- alongside the MVR figure, giving the owner enough context without drilling in.

DROP FUNCTION IF EXISTS get_dashboard_metrics();

CREATE OR REPLACE FUNCTION get_dashboard_metrics()
RETURNS TABLE (
  -- Revenue
  revenue_today_mvr           NUMERIC,
  revenue_this_month_mvr      NUMERIC,
  revenue_last_month_mvr      NUMERIC,
  -- Gross profit
  gross_profit_this_month_mvr NUMERIC,
  gross_margin_pct            NUMERIC,
  -- Orders
  orders_awaiting_dispatch    BIGINT,
  orders_out_for_delivery     BIGINT,
  orders_dispatched_today     BIGINT,
  orders_delivered_today      BIGINT,
  overdue_orders_count        BIGINT,
  -- Stock
  low_stock_sku_count         BIGINT,
  total_stock_value_mvr       NUMERIC,
  -- Shipments
  shipments_in_transit        BIGINT,
  -- Payments
  pending_payments_mvr        NUMERIC,  -- delivered orders, money not yet received
  pending_payments_count      BIGINT,   -- how many such orders
  cod_undeposited_mvr         NUMERIC   -- subset: COD cash held by drivers, not yet banked
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  this_month_start AS (SELECT DATE_TRUNC('month', CURRENT_DATE) AS d),
  last_month_start AS (SELECT DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' AS d),
  last_month_end   AS (SELECT DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day' AS d),

  sales_revenue AS (
    SELECT sol.line_total_mvr, so.created_at::DATE AS sale_date
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    WHERE so.status NOT IN ('draft','cancelled')
  ),

  gross_cost AS (
    SELECT COALESCE(SUM(sm.qty_pieces * ib.landed_per_piece_mvr), 0) AS total_cost
    FROM stock_movements sm
    JOIN inventory_batches ib ON ib.id = sm.batch_id
    JOIN sales_orders so ON so.id = sm.source_id
    WHERE sm.source_type = 'sales_order'
      AND sm.movement_type = 'out'
      AND so.created_at::DATE >= (SELECT d FROM this_month_start)
      AND so.status NOT IN ('draft','cancelled')
  ),

  revenue_month AS (
    SELECT COALESCE(SUM(line_total_mvr), 0) AS total
    FROM sales_revenue
    WHERE sale_date >= (SELECT d FROM this_month_start)
  ),

  out_for_delivery_now AS (
    SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'out_for_delivery'
  ),

  delivered_today AS (
    SELECT COUNT(*) AS cnt FROM sales_orders
    WHERE status = 'delivered' AND delivered_at::DATE = CURRENT_DATE
  ),

  dispatched_today AS (
    SELECT COUNT(*) AS cnt FROM sales_orders
    WHERE status = 'out_for_delivery' AND updated_at::DATE = CURRENT_DATE
  ),

  awaiting_dispatch AS (
    SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'confirmed'
  ),

  overdue AS (
    SELECT COUNT(*) AS cnt FROM sales_orders
    WHERE status = 'confirmed' AND created_at < NOW() - INTERVAL '24 hours'
  ),

  -- All delivered orders where money has not yet been received.
  -- Includes COD not collected, COD collected but not deposited, and credit unpaid.
  -- Does NOT include undelivered orders (money does not exist yet).
  pending_pay AS (
    SELECT
      COALESCE(SUM(sol.line_total_mvr), 0) AS total,
      COUNT(DISTINCT so.id)                 AS cnt
    FROM sales_orders so
    JOIN sales_order_lines sol ON sol.order_id = so.id
    WHERE so.status = 'delivered'
      AND so.payment_status IN ('pending','partial')
  ),

  -- Subset of above: COD cash physically held by drivers, not yet banked.
  -- Useful secondary figure — different urgency, different action.
  cod_undeposited AS (
    SELECT COALESCE(SUM(so.cash_collected_mvr), 0) AS total
    FROM sales_orders so
    WHERE so.status = 'delivered'
      AND so.payment_method = 'cod'
      AND so.payment_status = 'paid'   -- collected but not deposited
      AND so.cash_deposited_at IS NULL
      AND so.cash_collected_mvr > 0
  ),

  transit AS (
    SELECT COUNT(*) AS cnt FROM shipments WHERE status = 'in_transit'
  ),

  stock_val AS (
    SELECT COALESCE(SUM(
      (sm_in.qty_pieces - COALESCE(sm_out.out_pieces, 0)) * ib.landed_per_piece_mvr
    ), 0) AS total
    FROM inventory_batches ib
    JOIN stock_movements sm_in ON sm_in.batch_id = ib.id AND sm_in.movement_type = 'in'
    LEFT JOIN (
      SELECT batch_id, SUM(qty_pieces) AS out_pieces
      FROM stock_movements
      WHERE movement_type IN ('out','damage_out','transfer_out')
      GROUP BY batch_id
    ) sm_out ON sm_out.batch_id = ib.id
    WHERE (sm_in.qty_pieces - COALESCE(sm_out.out_pieces, 0)) > 0
  ),

  low_stock AS (
    SELECT COUNT(*) AS cnt FROM (
      SELECT
        s.id,
        COALESCE(SUM(CASE WHEN sm.movement_type IN ('in','transfer_in','return_in') THEN sm.qty_pieces ELSE -sm.qty_pieces END), 0) AS stock_pcs,
        COALESCE(SUM(CASE WHEN sm.movement_type = 'out' AND sm.created_at >= NOW() - INTERVAL '30 days' THEN sm.qty_pieces ELSE 0 END) / 30.0, 0) AS daily_avg
      FROM skus s LEFT JOIN stock_movements sm ON sm.sku_id = s.id
      WHERE s.is_active = TRUE GROUP BY s.id
    ) x WHERE daily_avg > 0 AND stock_pcs / daily_avg < 10
  )

  SELECT
    COALESCE(SUM(CASE WHEN sr.sale_date = CURRENT_DATE THEN sr.line_total_mvr ELSE 0 END), 0),
    (SELECT total FROM revenue_month),
    COALESCE(SUM(CASE WHEN sr.sale_date >= (SELECT d FROM last_month_start) AND sr.sale_date <= (SELECT d FROM last_month_end) THEN sr.line_total_mvr ELSE 0 END), 0),
    GREATEST((SELECT total FROM revenue_month) - (SELECT total_cost FROM gross_cost), 0),
    CASE WHEN (SELECT total FROM revenue_month) > 0
         THEN ROUND(GREATEST((SELECT total FROM revenue_month) - (SELECT total_cost FROM gross_cost), 0) / (SELECT total FROM revenue_month) * 100, 1)
         ELSE 0 END,
    (SELECT cnt  FROM awaiting_dispatch),
    (SELECT cnt  FROM out_for_delivery_now),
    (SELECT cnt  FROM dispatched_today),
    (SELECT cnt  FROM delivered_today),
    (SELECT cnt  FROM overdue),
    (SELECT cnt  FROM low_stock),
    (SELECT total FROM stock_val),
    (SELECT cnt  FROM transit),
    (SELECT total FROM pending_pay),
    (SELECT cnt  FROM pending_pay),
    (SELECT total FROM cod_undeposited)
  FROM sales_revenue sr;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_metrics() TO authenticated;

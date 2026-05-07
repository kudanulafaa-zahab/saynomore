-- get_dashboard_metrics: returns all KPIs for the dashboard in one call
-- Returns a single row with all metrics.

CREATE OR REPLACE FUNCTION get_dashboard_metrics()
RETURNS TABLE (
  -- Revenue
  revenue_today_mvr         NUMERIC,
  revenue_this_month_mvr    NUMERIC,
  revenue_last_month_mvr    NUMERIC,
  -- Orders
  orders_active             BIGINT,  -- confirmed + picked + out_for_delivery
  orders_delivered_today    BIGINT,
  -- Stock
  low_stock_sku_count       BIGINT,  -- SKUs with < 10 days of stock
  total_stock_value_mvr     NUMERIC, -- sum(qty_pieces * landed_per_piece) across all batches
  -- Shipments
  shipments_in_transit      BIGINT,  -- status = 'in_transit'
  -- Payments
  pending_payments_mvr      NUMERIC  -- delivered orders with payment_status = 'pending' or 'partial'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  today AS (SELECT CURRENT_DATE AS d),

  -- Revenue from confirmed+ sales (by line totals, not draft)
  sales_revenue AS (
    SELECT
      sol.line_total_mvr,
      so.status,
      so.created_at::DATE AS sale_date,
      DATE_TRUNC('month', CURRENT_DATE) AS this_month_start,
      DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' AS last_month_start,
      DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day' AS last_month_end
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    WHERE so.status NOT IN ('draft', 'cancelled')
  ),

  -- Active orders (pending fulfilment)
  active_orders AS (
    SELECT COUNT(*) AS cnt
    FROM sales_orders
    WHERE status IN ('confirmed', 'picked', 'out_for_delivery')
  ),

  -- Delivered today
  delivered_today AS (
    SELECT COUNT(*) AS cnt
    FROM sales_orders
    WHERE status = 'delivered'
      AND delivered_at::DATE = CURRENT_DATE
  ),

  -- Pending payments (delivered but not fully paid)
  pending_pay AS (
    SELECT COALESCE(SUM(sol.line_total_mvr), 0) AS total
    FROM sales_orders so
    JOIN sales_order_lines sol ON sol.order_id = so.id
    WHERE so.status = 'delivered'
      AND so.payment_status IN ('pending', 'partial')
  ),

  -- Shipments in transit
  transit AS (
    SELECT COUNT(*) AS cnt
    FROM shipments
    WHERE status = 'in_transit'
  ),

  -- Stock value: sum over all 'in' movements net of 'out' by batch
  stock_val AS (
    SELECT COALESCE(SUM(
      (sm_in.qty_pieces - COALESCE(sm_out.out_pieces, 0)) * ib.landed_per_piece_mvr
    ), 0) AS total
    FROM inventory_batches ib
    JOIN stock_movements sm_in ON sm_in.batch_id = ib.id AND sm_in.movement_type = 'in'
    LEFT JOIN (
      SELECT batch_id, SUM(qty_pieces) AS out_pieces
      FROM stock_movements
      WHERE movement_type IN ('out', 'damage_out', 'transfer_out')
      GROUP BY batch_id
    ) sm_out ON sm_out.batch_id = ib.id
    WHERE (sm_in.qty_pieces - COALESCE(sm_out.out_pieces, 0)) > 0
  ),

  -- Low stock: SKUs with < 10 days of average daily sales
  low_stock AS (
    SELECT COUNT(*) AS cnt
    FROM (
      SELECT
        s.id AS sku_id,
        COALESCE(SUM(CASE WHEN sm.movement_type IN ('in','transfer_in','return_in') THEN sm.qty_pieces ELSE -sm.qty_pieces END), 0) AS stock_pcs,
        -- avg daily sold over last 30 days
        COALESCE(
          SUM(CASE WHEN sm.movement_type = 'out' AND sm.created_at >= NOW() - INTERVAL '30 days' THEN sm.qty_pieces ELSE 0 END) / 30.0,
          0
        ) AS daily_avg
      FROM skus s
      LEFT JOIN stock_movements sm ON sm.sku_id = s.id
      WHERE s.is_active = TRUE
      GROUP BY s.id
    ) x
    WHERE daily_avg > 0 AND stock_pcs / daily_avg < 10
  )

  SELECT
    -- Revenue today
    COALESCE(SUM(CASE WHEN sr.sale_date = CURRENT_DATE THEN sr.line_total_mvr ELSE 0 END), 0) AS revenue_today_mvr,
    -- Revenue this month
    COALESCE(SUM(CASE WHEN sr.sale_date >= sr.this_month_start THEN sr.line_total_mvr ELSE 0 END), 0) AS revenue_this_month_mvr,
    -- Revenue last month
    COALESCE(SUM(CASE WHEN sr.sale_date >= sr.last_month_start AND sr.sale_date <= sr.last_month_end THEN sr.line_total_mvr ELSE 0 END), 0) AS revenue_last_month_mvr,
    -- Active orders
    (SELECT cnt FROM active_orders) AS orders_active,
    -- Delivered today
    (SELECT cnt FROM delivered_today) AS orders_delivered_today,
    -- Low stock count
    (SELECT cnt FROM low_stock) AS low_stock_sku_count,
    -- Stock value
    (SELECT total FROM stock_val) AS total_stock_value_mvr,
    -- Shipments in transit
    (SELECT cnt FROM transit) AS shipments_in_transit,
    -- Pending payments
    (SELECT total FROM pending_pay) AS pending_payments_mvr
  FROM sales_revenue sr;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_metrics() TO authenticated;

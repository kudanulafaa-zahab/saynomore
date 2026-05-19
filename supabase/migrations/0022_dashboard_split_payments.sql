-- Dashboard v4: split pending_payments_mvr into two honest accounting figures
--   ar_outstanding_mvr  — credit/invoice customers who owe money (true AR)
--   cod_undeposited_mvr — COD cash collected by drivers not yet banked
-- Replaces get_dashboard_metrics() from migration 0021.

DROP FUNCTION IF EXISTS get_dashboard_metrics();

CREATE OR REPLACE FUNCTION get_dashboard_metrics()
RETURNS TABLE (
  -- Revenue
  revenue_today_mvr           NUMERIC,
  revenue_this_month_mvr      NUMERIC,
  revenue_last_month_mvr      NUMERIC,
  -- Gross profit (cost via FIFO batches)
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
  -- Payments (split — these are different business concepts)
  ar_outstanding_mvr          NUMERIC,   -- non-COD delivered orders unpaid (invoice/credit AR)
  cod_undeposited_mvr         NUMERIC    -- COD cash in drivers' hands, not yet banked
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

  -- Revenue: all confirmed+ lines
  sales_revenue AS (
    SELECT
      sol.line_total_mvr,
      sol.order_id,
      so.created_at::DATE AS sale_date
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    WHERE so.status NOT IN ('draft', 'cancelled')
  ),

  -- Gross profit this month: FIFO cost from stock_movements → inventory_batches
  gross_cost AS (
    SELECT COALESCE(SUM(sm.qty_pieces * ib.landed_per_piece_mvr), 0) AS total_cost
    FROM stock_movements sm
    JOIN inventory_batches ib ON ib.id = sm.batch_id
    JOIN sales_orders so ON so.id = sm.source_id
    WHERE sm.source_type = 'sales_order'
      AND sm.movement_type = 'out'
      AND so.created_at::DATE >= (SELECT d FROM this_month_start)
      AND so.status NOT IN ('draft', 'cancelled')
  ),

  revenue_month AS (
    SELECT COALESCE(SUM(line_total_mvr), 0) AS total
    FROM sales_revenue
    WHERE sale_date >= (SELECT d FROM this_month_start)
  ),

  -- Live: currently out for delivery
  out_for_delivery_now AS (
    SELECT COUNT(*) AS cnt
    FROM sales_orders
    WHERE status = 'out_for_delivery'
  ),

  -- Delivered today
  delivered_today AS (
    SELECT COUNT(*) AS cnt
    FROM sales_orders
    WHERE status = 'delivered'
      AND delivered_at::DATE = CURRENT_DATE
  ),

  -- Dispatched today
  dispatched_today AS (
    SELECT COUNT(*) AS cnt
    FROM sales_orders
    WHERE status = 'out_for_delivery'
      AND updated_at::DATE = CURRENT_DATE
  ),

  -- Awaiting dispatch
  awaiting_dispatch AS (
    SELECT COUNT(*) AS cnt
    FROM sales_orders
    WHERE status = 'confirmed'
  ),

  -- Overdue: confirmed > 24 hours
  overdue AS (
    SELECT COUNT(*) AS cnt
    FROM sales_orders
    WHERE status = 'confirmed'
      AND created_at < NOW() - INTERVAL '24 hours'
  ),

  -- AR outstanding: non-COD delivered orders where payment is pending or partial
  -- These are credit/invoice customers — a genuine receivable on the books
  ar_outstanding AS (
    SELECT COALESCE(SUM(sol.line_total_mvr), 0) AS total
    FROM sales_orders so
    JOIN sales_order_lines sol ON sol.order_id = so.id
    WHERE so.status = 'delivered'
      AND so.payment_status IN ('pending', 'partial')
      AND (so.payment_method IS NULL OR so.payment_method != 'cod')
  ),

  -- COD undeposited: cash physically held by drivers, not yet banked
  -- This is a treasury float, NOT a receivable — the cash exists, it's just not in the bank yet
  cod_undeposited AS (
    SELECT COALESCE(SUM(so.cash_collected_mvr), 0) AS total
    FROM sales_orders so
    WHERE so.status = 'delivered'
      AND so.payment_method = 'cod'
      AND so.payment_status != 'deposited'
      AND so.cash_collected_mvr > 0
  ),

  -- Shipments in transit
  transit AS (
    SELECT COUNT(*) AS cnt
    FROM shipments
    WHERE status = 'in_transit'
  ),

  -- Current stock value at landed cost
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

  -- Low stock: active SKUs with < 10 days of average daily sales
  low_stock AS (
    SELECT COUNT(*) AS cnt
    FROM (
      SELECT
        s.id AS sku_id,
        COALESCE(SUM(CASE WHEN sm.movement_type IN ('in','transfer_in','return_in') THEN sm.qty_pieces ELSE -sm.qty_pieces END), 0) AS stock_pcs,
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
    COALESCE(SUM(CASE WHEN sr.sale_date = CURRENT_DATE THEN sr.line_total_mvr ELSE 0 END), 0)                                AS revenue_today_mvr,
    -- Revenue this month
    (SELECT total FROM revenue_month)                                                                                         AS revenue_this_month_mvr,
    -- Revenue last month
    COALESCE(SUM(CASE WHEN sr.sale_date >= (SELECT d FROM last_month_start) AND sr.sale_date <= (SELECT d FROM last_month_end) THEN sr.line_total_mvr ELSE 0 END), 0) AS revenue_last_month_mvr,
    -- Gross profit this month
    GREATEST((SELECT total FROM revenue_month) - (SELECT total_cost FROM gross_cost), 0)                                     AS gross_profit_this_month_mvr,
    -- Gross margin %
    CASE WHEN (SELECT total FROM revenue_month) > 0
         THEN ROUND(GREATEST((SELECT total FROM revenue_month) - (SELECT total_cost FROM gross_cost), 0) / (SELECT total FROM revenue_month) * 100, 1)
         ELSE 0
    END                                                                                                                       AS gross_margin_pct,
    -- Orders
    (SELECT cnt FROM awaiting_dispatch)                                                                                       AS orders_awaiting_dispatch,
    (SELECT cnt FROM out_for_delivery_now)                                                                                    AS orders_out_for_delivery,
    (SELECT cnt FROM dispatched_today)                                                                                        AS orders_dispatched_today,
    (SELECT cnt FROM delivered_today)                                                                                         AS orders_delivered_today,
    (SELECT cnt FROM overdue)                                                                                                  AS overdue_orders_count,
    -- Stock
    (SELECT cnt FROM low_stock)                                                                                               AS low_stock_sku_count,
    (SELECT total FROM stock_val)                                                                                             AS total_stock_value_mvr,
    -- Shipments
    (SELECT cnt FROM transit)                                                                                                  AS shipments_in_transit,
    -- Payments (two separate concepts)
    (SELECT total FROM ar_outstanding)                                                                                         AS ar_outstanding_mvr,
    (SELECT total FROM cod_undeposited)                                                                                        AS cod_undeposited_mvr
  FROM sales_revenue sr;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_metrics() TO authenticated;

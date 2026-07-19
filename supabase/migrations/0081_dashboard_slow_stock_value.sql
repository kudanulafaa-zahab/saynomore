-- ============================================================================
-- 0081 — Dashboard: money tied up in slow-moving stock (at a glance)
-- ============================================================================
-- Ali's ask: "cash tied up in slow movers, shown as money." The set already
-- exists — get_promo_suggestions() is the exact "slow movers tying up cash"
-- list the morning briefing references — and it already carries value_mvr
-- (landed value of the stock sitting there). This surfaces its total + count
-- on the dashboard so the single biggest lever for freeing cash is a glance,
-- not a drill-down.
--
-- Two columns are appended to the RETURNS TABLE. Changing a function's return
-- type needs DROP + CREATE (CREATE OR REPLACE can't alter columns), so the
-- grant is restated (0076 lockdown = a recreated function has no grants).
-- Columns are APPENDED at the end so every existing positional client mapping
-- is untouched.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_dashboard_metrics();

CREATE FUNCTION public.get_dashboard_metrics()
 RETURNS TABLE(revenue_today_mvr numeric, revenue_this_month_mvr numeric, revenue_last_month_mvr numeric, gross_profit_this_month_mvr numeric, gross_margin_pct numeric, orders_awaiting_dispatch bigint, orders_out_for_delivery bigint, orders_dispatched_today bigint, orders_delivered_today bigint, overdue_orders_count bigint, low_stock_sku_count bigint, total_stock_value_mvr numeric, shipments_in_transit bigint, pending_payments_mvr numeric, pending_payments_count bigint, cod_undeposited_mvr numeric, shipments_arriving_soon bigint, overstock_sku_count bigint, reorder_needed_count bigint, slow_stock_value_mvr numeric, slow_stock_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT COALESCE(SUM(sm.qty_pieces * ib.landed_per_piece_mvr),0) AS total_cost
    FROM stock_movements sm
    JOIN inventory_batches ib ON ib.id = sm.batch_id
    JOIN sales_orders so ON so.id = sm.source_id
    WHERE sm.source_type = 'sales_order' AND sm.movement_type = 'out'
      AND so.created_at::DATE >= (SELECT d FROM this_month_start)
      AND so.status NOT IN ('draft','cancelled')
  ),
  revenue_month AS (
    SELECT COALESCE(SUM(line_total_mvr),0) AS total FROM sales_revenue
    WHERE sale_date >= (SELECT d FROM this_month_start)
  ),
  out_for_delivery_now AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'out_for_delivery'),
  delivered_today      AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'delivered' AND delivered_at::DATE = CURRENT_DATE),
  dispatched_today     AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'out_for_delivery' AND updated_at::DATE = CURRENT_DATE),
  awaiting_dispatch    AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'confirmed'),
  overdue              AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'confirmed' AND created_at < NOW() - INTERVAL '24 hours'),
  pending_pay AS (
    SELECT COALESCE(SUM(outstanding_mvr),0) AS total,
           COALESCE(SUM(orders_count),0)    AS cnt
    FROM get_receivables_aging()
  ),
  cod_undeposited AS (
    SELECT COALESCE(SUM(so.cash_collected_mvr),0) AS total
    FROM sales_orders so
    WHERE so.status = 'delivered'
      AND so.payment_method = 'cod'
      AND so.payment_status = 'paid'
      AND so.cash_deposited_at IS NULL
      AND so.cash_collected_mvr > 0
  ),
  transit AS (SELECT COUNT(*) AS cnt FROM shipments WHERE status = 'in_transit'),
  arriving_soon AS (
    SELECT COUNT(*) AS cnt FROM shipments
    WHERE status = 'in_transit'
      AND expected_arrival_date IS NOT NULL
      AND expected_arrival_date >= CURRENT_DATE
      AND expected_arrival_date <= CURRENT_DATE + INTERVAL '3 days'
  ),
  stock_val AS (
    SELECT COALESCE(SUM(on_hand.qty * ib.landed_per_piece_mvr),0) AS total
    FROM inventory_batches ib
    JOIN (
      SELECT batch_id, SUM(stock_signed_delta(movement_type, qty_pieces)) AS qty
      FROM stock_movements
      WHERE batch_id IS NOT NULL
      GROUP BY batch_id
    ) on_hand ON on_hand.batch_id = ib.id
    WHERE on_hand.qty > 0
  ),
  low_stock AS (
    SELECT COUNT(*) AS cnt FROM (
      SELECT s.id,
        COALESCE(SUM(stock_signed_delta(sm.movement_type, sm.qty_pieces)),0) AS stock_pcs,
        COALESCE(SUM(CASE WHEN sm.movement_type = 'out' AND sm.source_type = 'sales_order'
                          AND sm.created_at >= NOW() - INTERVAL '30 days'
                     THEN sm.qty_pieces ELSE 0 END) / 30.0, 0) AS daily_avg
      FROM skus s LEFT JOIN stock_movements sm ON sm.sku_id = s.id
      WHERE s.is_active = TRUE GROUP BY s.id
    ) x WHERE daily_avg > 0 AND stock_pcs / daily_avg < 10
  ),
  reorder_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'overstock') AS overstock_cnt,
      COUNT(*) FILTER (WHERE status IN ('critical', 'low')) AS reorder_cnt
    FROM get_reorder_suggestions()
  ),
  -- 0081: cash sitting in slow-moving stock — the same set the briefing calls
  -- "slow movers tying up cash" (get_promo_suggestions), summed as money.
  slow_stock AS (
    SELECT COALESCE(SUM(stock_value_mvr),0) AS val, COUNT(*) AS cnt
    FROM get_promo_suggestions()
  )

  SELECT
    COALESCE(SUM(CASE WHEN sr.sale_date = CURRENT_DATE THEN sr.line_total_mvr ELSE 0 END),0),
    (SELECT total FROM revenue_month),
    COALESCE(SUM(CASE WHEN sr.sale_date >= (SELECT d FROM last_month_start) AND sr.sale_date <= (SELECT d FROM last_month_end) THEN sr.line_total_mvr ELSE 0 END),0),
    GREATEST((SELECT total FROM revenue_month) - (SELECT total_cost FROM gross_cost),0),
    CASE WHEN (SELECT total FROM revenue_month) > 0
         THEN ROUND(GREATEST((SELECT total FROM revenue_month) - (SELECT total_cost FROM gross_cost),0) / (SELECT total FROM revenue_month) * 100,1)
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
    (SELECT total FROM cod_undeposited),
    (SELECT cnt  FROM arriving_soon),
    (SELECT overstock_cnt FROM reorder_stats),
    (SELECT reorder_cnt FROM reorder_stats),
    (SELECT val FROM slow_stock),
    (SELECT cnt FROM slow_stock)
  FROM sales_revenue sr;
$function$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics() TO authenticated, service_role;

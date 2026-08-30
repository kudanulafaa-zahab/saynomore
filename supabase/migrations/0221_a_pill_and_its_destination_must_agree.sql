-- 0221 — a pill and its destination must agree.
--
-- Ali, 2026-08-30, with a screenshot of the dashboard:
--   *"In today 'needs attention' 2 SKUs out of stock but when I click the pill
--    it takes me to 'stock' module 'on hand' and it doesn't show any SKUs out
--    of stock. Check all pills and functions and make sure everything is
--    accurate. If you show a pill with a function it must always take me to
--    the correct destination."*
--
-- ── IT WAS NOT THE LINK. IT WAS THE NUMBER, AND THE NUMBER BROKE A RULE ─────
--
-- The link is right: /inventory?filter=out, and Inventory reads that parameter.
-- The two ends simply counted different things.
--
--   the pill          get_sku_reorder_alerts()  where alert_level = 'out'  -> 2
--   the destination   get_reorder_suggestions() where status      = 'out'  -> 0
--
-- And the two SKUs behind the difference are MAMY-SKIN-XL-36x3 and
-- MAMY-ROYA-B-M-64x4 — Skin Comfort and Royal Soft Boy. Both are
-- DISCONTINUED LINES.
--
-- get_reorder_suggestions joins product_models on discontinued_at IS NULL, so
-- it correctly refuses to nag about a range Ali has stopped buying.
-- get_sku_reorder_alerts filters only on is_active and has no such join. So the
-- dashboard was saying "2 SKUs out of stock — losing sales — Reorder now"
-- about two products he deliberately stopped reordering on 2026-08-14, and
-- CLAUDE.md is explicit about that case:
--
--   "Never reorder them. They must not appear in reorder suggestions, shipment
--    planning or any 'you are running low' alert. Running low is now the plan."
--
-- So this is not a cosmetic mismatch. Running out of a discontinued line is the
-- INTENDED outcome, and the home screen was reporting the plan working as an
-- emergency — while pointing at a screen that correctly showed nothing wrong.
--
-- ── THE FIX: ONE SOURCE, NOT TWO ───────────────────────────────────────────
--
-- The count now comes from get_reorder_suggestions(), which is what the
-- destination lists. It inherits the discontinued exclusion for free, and the
-- pill can no longer drift from the screen it opens because there is only one
-- number. It also folds into the reorder_stats CTE, which already called that
-- function — so this is one call fewer, not one more.
--
-- ── THE OTHER SEVEN PILLS WERE CHECKED, AND ARE CORRECT ────────────────────
--
-- Measured against production before touching anything. overstock 8 = 8,
-- reorder needed 0 = 0, slow movers 13 = 13, unpaid orders 3 = 3, overdue 1 =
-- 1, awaiting dispatch 1 = 1, in transit 0 = 0. One defect out of eight, and
-- dashboard_pills.test.sql now holds all eight so the next one cannot ship
-- quietly.

create or replace function public.get_dashboard_metrics()
returns table(
  revenue_today_mvr numeric, revenue_this_month_mvr numeric, revenue_last_month_mvr numeric,
  gross_profit_this_month_mvr numeric, gross_margin_pct numeric,
  orders_awaiting_dispatch bigint, orders_out_for_delivery bigint, orders_dispatched_today bigint,
  orders_delivered_today bigint, overdue_orders_count bigint, low_stock_sku_count bigint,
  total_stock_value_mvr numeric, shipments_in_transit bigint, pending_payments_mvr numeric,
  pending_payments_count bigint, cod_undeposited_mvr numeric, shipments_arriving_soon bigint,
  overstock_sku_count bigint, reorder_needed_count bigint, slow_stock_value_mvr numeric,
  slow_stock_count bigint, out_of_stock_count bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with
  today_mv AS (SELECT (now() AT TIME ZONE 'Indian/Maldives')::date AS d),
  this_month_start AS (SELECT DATE_TRUNC('month', (SELECT d FROM today_mv)) AS d),
  last_month_start AS (SELECT DATE_TRUNC('month', (SELECT d FROM today_mv)) - INTERVAL '1 month' AS d),
  last_month_end   AS (SELECT DATE_TRUNC('month', (SELECT d FROM today_mv)) - INTERVAL '1 day' AS d),
  sales_revenue AS (
    SELECT sol.line_total_mvr, (so.created_at AT TIME ZONE 'Indian/Maldives')::DATE AS sale_date
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
      AND (so.created_at AT TIME ZONE 'Indian/Maldives')::DATE >= (SELECT d FROM this_month_start)
      AND so.status NOT IN ('draft','cancelled')
  ),
  revenue_month AS (
    SELECT COALESCE(SUM(line_total_mvr),0) AS total FROM sales_revenue
    WHERE sale_date >= (SELECT d FROM this_month_start)
  ),
  out_for_delivery_now AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'out_for_delivery'),
  delivered_today      AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'delivered' AND (delivered_at AT TIME ZONE 'Indian/Maldives')::DATE = (SELECT d FROM today_mv)),
  dispatched_today     AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'out_for_delivery' AND (updated_at AT TIME ZONE 'Indian/Maldives')::DATE = (SELECT d FROM today_mv)),
  awaiting_dispatch    AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'confirmed'),
  overdue              AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'confirmed' AND created_at < NOW() - INTERVAL '24 hours'),
  pending_pay AS (
    SELECT COALESCE(SUM(outstanding_mvr),0) AS total, COALESCE(SUM(orders_count),0) AS cnt
    FROM get_receivables_aging()
  ),
  cod_undeposited AS (
    SELECT COALESCE(SUM(so.cash_collected_mvr),0) AS total
    FROM sales_orders so
    WHERE so.status = 'delivered' AND so.payment_method = 'cod' AND so.payment_status = 'paid'
      AND so.cash_deposited_at IS NULL AND so.cash_collected_mvr > 0
  ),
  transit AS (SELECT COUNT(*) AS cnt FROM shipments WHERE status = 'in_transit'),
  arriving_soon AS (
    SELECT COUNT(*) AS cnt FROM shipments
    WHERE status = 'in_transit' AND expected_arrival_date IS NOT NULL
      AND expected_arrival_date >= (SELECT d FROM today_mv) AND expected_arrival_date <= (SELECT d FROM today_mv) + INTERVAL '3 days'
  ),
  stock_val AS (
    SELECT COALESCE(SUM(on_hand.qty * ib.landed_per_piece_mvr),0) AS total
    FROM inventory_batches ib
    JOIN (
      SELECT batch_id, SUM(stock_signed_delta(movement_type, qty_pieces)) AS qty
      FROM stock_movements WHERE batch_id IS NOT NULL GROUP BY batch_id
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
    ) x WHERE daily_avg > 0 AND stock_pcs > 0 AND stock_pcs / daily_avg < 10
  ),
  -- ONE SOURCE FOR THE THREE STOCK PILLS, and it is the one their destinations
  -- list. out_of_stock used to be its own CTE over get_sku_reorder_alerts(),
  -- which has no discontinued_at join — so it counted ranges Ali has stopped
  -- buying and told him to reorder them, while /inventory?filter=out correctly
  -- showed nothing. Same function as the destination now, so the pill and the
  -- screen cannot disagree, and it is one call fewer than before.
  reorder_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'overstock')          AS overstock_cnt,
      COUNT(*) FILTER (WHERE status IN ('critical', 'low')) AS reorder_cnt,
      COUNT(*) FILTER (WHERE status = 'out')                AS out_cnt
    FROM get_reorder_suggestions()
  ),
  slow_stock AS (
    SELECT COALESCE(SUM(stock_value_mvr),0) AS val, COUNT(*) AS cnt FROM get_promo_suggestions()
  )
  SELECT
    COALESCE(SUM(CASE WHEN sr.sale_date = (SELECT d FROM today_mv) THEN sr.line_total_mvr ELSE 0 END),0),
    (SELECT total FROM revenue_month),
    COALESCE(SUM(CASE WHEN sr.sale_date >= (SELECT d FROM last_month_start) AND sr.sale_date <= (SELECT d FROM last_month_end) THEN sr.line_total_mvr ELSE 0 END),0),
    (SELECT total FROM revenue_month) - (SELECT total_cost FROM gross_cost),
    CASE WHEN (SELECT total FROM revenue_month) > 0
         THEN ROUND(((SELECT total FROM revenue_month) - (SELECT total_cost FROM gross_cost)) / (SELECT total FROM revenue_month) * 100,1)
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
    (SELECT cnt FROM slow_stock),
    (SELECT out_cnt FROM reorder_stats)
  FROM sales_revenue sr;
$function$;

revoke execute on function public.get_dashboard_metrics() from public, anon;
grant  execute on function public.get_dashboard_metrics() to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_src text := regexp_replace(
    pg_get_functiondef('public.get_dashboard_metrics()'::regprocedure), '--[^\n]*', '', 'g');
begin
  if v_src ~ 'get_sku_reorder_alerts' then
    raise exception 'the out-of-stock pill is counting a source its destination does not list';
  end if;
  if v_src !~ 'FILTER \(WHERE status = ''out''\)' then
    raise exception 'the out-of-stock count no longer comes from get_reorder_suggestions';
  end if;
  -- Every other pill kept its source; a rebuild that dropped one would leave
  -- the dashboard reporting zeros that look like good news.
  if v_src !~ 'get_receivables_aging' or v_src !~ 'get_promo_suggestions' then
    raise exception 'a dashboard metric lost its source in the rewrite';
  end if;
  if has_function_privilege('anon', 'public.get_dashboard_metrics()', 'execute') then
    raise exception 'anon can read the dashboard metrics';
  end if;
end $$;

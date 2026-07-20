-- 0084: Out-of-stock is a first-class, top-severity signal.
--
-- The bug: get_sku_reorder_alerts ended with `AND stock_pieces > 0`, so the
-- moment a SKU hit zero it dropped out of the reorder engine entirely — no
-- 'critical', no row at all. That cascaded: the reorder list, the inventory
-- badge, and the daily digest all stopped seeing the one product that most
-- needs attention. An out-of-stock bestseller was the single thing the system
-- hid. This makes "out of stock" its own alert level above 'critical'.
--
-- Definitions (multi-godown aware — zero means zero across ALL godowns):
--   out      = on-hand <= 0 AND it still sells (30-day velocity > 0)
--   critical = < 7 days of cover        low = < 14 days
-- A zero-stock SKU with no recent sales stays 'ok' (dormant, not a live leak).

-- 1) Reorder alerts: keep in-stock SKUs plus zero-stock sellers; add 'out'.
create or replace function public.get_sku_reorder_alerts()
returns table(sku_id uuid, stock_pieces numeric, daily_avg_pieces numeric, dir numeric, reorder_point_pcs numeric, alert_level text)
language sql stable security definer
set search_path to 'public'
as $function$
  WITH
  stock AS (
    SELECT sm.sku_id,
      COALESCE(SUM(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0) AS stock_pieces
    FROM stock_movements sm
    GROUP BY sm.sku_id
  ),
  velocity AS (
    SELECT sm.sku_id, SUM(sm.qty_pieces)::NUMERIC / 30.0 AS daily_avg
    FROM stock_movements sm
    JOIN sales_orders so ON so.id = sm.source_id
    WHERE sm.movement_type = 'out'
      AND sm.source_type   = 'sales_order'
      AND sm.created_at   >= NOW() - INTERVAL '30 days'
      AND so.status NOT IN ('draft', 'cancelled')
    GROUP BY sm.sku_id
  )
  SELECT
    s.id AS sku_id,
    GREATEST(COALESCE(st.stock_pieces, 0), 0) AS stock_pieces,
    COALESCE(v.daily_avg, 0) AS daily_avg_pieces,
    CASE WHEN COALESCE(v.daily_avg, 0) > 0
      THEN ROUND(GREATEST(COALESCE(st.stock_pieces, 0), 0) / v.daily_avg, 1)
      ELSE NULL END AS dir,
    ROUND(COALESCE(v.daily_avg, 0) * 21, 0) AS reorder_point_pcs,
    CASE
      WHEN COALESCE(v.daily_avg, 0) <= 0 THEN 'ok'
      WHEN GREATEST(COALESCE(st.stock_pieces, 0), 0) <= 0 THEN 'out'
      WHEN GREATEST(COALESCE(st.stock_pieces, 0), 0) / v.daily_avg < 7  THEN 'critical'
      WHEN GREATEST(COALESCE(st.stock_pieces, 0), 0) / v.daily_avg < 14 THEN 'low'
      ELSE 'ok'
    END AS alert_level
  FROM skus s
  LEFT JOIN stock    st ON st.sku_id = s.id
  LEFT JOIN velocity v  ON v.sku_id  = s.id
  WHERE s.is_active = TRUE
    AND (COALESCE(st.stock_pieces, 0) > 0 OR COALESCE(v.daily_avg, 0) > 0);
$function$;

-- 2) Reorder suggestions: 'out' passes through as status; sort it to the top.
create or replace function public.get_reorder_suggestions(p_lead_weeks numeric default 6, p_safety_weeks numeric default 4)
returns table(sku_id uuid, brand_name text, model_name text, variant_display text, internal_code text, stock_pieces numeric, stock_cartons numeric, daily_avg_pieces numeric, dir numeric, cover_days numeric, suggested_pieces numeric, suggested_cartons integer, pcs_per_carton integer, revenue_per_day numeric, status text, supplier_name text, lead_days numeric, order_by_date date)
language sql stable security definer
set search_path to 'public'
as $function$
  WITH
  cover AS (SELECT (COALESCE(p_lead_weeks, 6) + COALESCE(p_safety_weeks, 4)) * 7.0 AS cover_days),
  lead_hist AS (
    SELECT sl.sku_id, s.created_at, s.grn_confirmed_at, sup.name AS supplier_name,
           ROW_NUMBER() OVER (PARTITION BY sl.sku_id ORDER BY s.grn_confirmed_at DESC) AS rn
    FROM (SELECT DISTINCT shipment_id, sku_id FROM shipment_lines) sl
    JOIN shipments s ON s.id = sl.shipment_id AND s.grn_confirmed_at IS NOT NULL
    LEFT JOIN suppliers sup ON sup.id = s.supplier_id
  ),
  sku_lead AS (
    SELECT lh.sku_id,
           ROUND((AVG(EXTRACT(epoch FROM (lh.grn_confirmed_at - lh.created_at)) / 86400.0)
                  FILTER (WHERE lh.rn <= 3))::numeric, 0) AS lead_days,
           MAX(lh.supplier_name) FILTER (WHERE lh.rn = 1) AS supplier_name
    FROM lead_hist lh GROUP BY lh.sku_id
  ),
  base AS (SELECT a.*, c.cover_days FROM get_sku_reorder_alerts() a CROSS JOIN cover c)
  SELECT
    b.sku_id, vs.brand_name, vs.model_name, vs.variant_display, vs.internal_code,
    b.stock_pieces,
    ROUND(b.stock_pieces / NULLIF(vs.pcs_per_carton, 0), 1) AS stock_cartons,
    b.daily_avg_pieces, b.dir, b.cover_days,
    GREATEST(0, ROUND(b.daily_avg_pieces * b.cover_days - b.stock_pieces, 0)) AS suggested_pieces,
    CEIL(GREATEST(0, b.daily_avg_pieces * b.cover_days - b.stock_pieces) / NULLIF(vs.pcs_per_carton, 0))::INTEGER AS suggested_cartons,
    vs.pcs_per_carton,
    ROUND(b.daily_avg_pieces * COALESCE(vs.selling_price_per_piece_mvr, 0), 2) AS revenue_per_day,
    CASE
      WHEN b.dir IS NOT NULL AND b.dir > 90 THEN 'overstock'
      ELSE b.alert_level
    END AS status,
    sl.supplier_name, sl.lead_days,
    CASE WHEN b.dir IS NOT NULL THEN GREATEST(
      CURRENT_DATE,
      CURRENT_DATE + (b.dir - COALESCE(sl.lead_days, COALESCE(p_lead_weeks, 6) * 7))::int
    ) END AS order_by_date
  FROM base b
  JOIN v_skus vs ON vs.id = b.sku_id
  LEFT JOIN sku_lead sl ON sl.sku_id = b.sku_id
  ORDER BY
    CASE
      WHEN b.alert_level = 'out' THEN 0
      WHEN b.dir IS NOT NULL AND b.dir > 90 THEN 3
      WHEN b.alert_level = 'critical' THEN 1
      WHEN b.alert_level = 'low' THEN 2
      ELSE 4
    END,
    (b.daily_avg_pieces * COALESCE(vs.selling_price_per_piece_mvr, 0)) DESC;
$function$;

-- 3) Dashboard: distinct out_of_stock_count; low_stock no longer counts zero
--    (out and low are now disjoint). Adding a return column requires a drop.
drop function if exists public.get_dashboard_metrics();
create function public.get_dashboard_metrics()
returns table(revenue_today_mvr numeric, revenue_this_month_mvr numeric, revenue_last_month_mvr numeric, gross_profit_this_month_mvr numeric, gross_margin_pct numeric, orders_awaiting_dispatch bigint, orders_out_for_delivery bigint, orders_dispatched_today bigint, orders_delivered_today bigint, overdue_orders_count bigint, low_stock_sku_count bigint, total_stock_value_mvr numeric, shipments_in_transit bigint, pending_payments_mvr numeric, pending_payments_count bigint, cod_undeposited_mvr numeric, shipments_arriving_soon bigint, overstock_sku_count bigint, reorder_needed_count bigint, slow_stock_value_mvr numeric, slow_stock_count bigint, out_of_stock_count bigint)
language sql stable security definer
set search_path to 'public'
as $function$
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
      AND expected_arrival_date >= CURRENT_DATE AND expected_arrival_date <= CURRENT_DATE + INTERVAL '3 days'
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
  out_of_stock AS (
    SELECT COUNT(*) AS cnt FROM get_sku_reorder_alerts() WHERE alert_level = 'out'
  ),
  reorder_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'overstock') AS overstock_cnt,
      COUNT(*) FILTER (WHERE status IN ('critical', 'low')) AS reorder_cnt
    FROM get_reorder_suggestions()
  ),
  slow_stock AS (
    SELECT COALESCE(SUM(stock_value_mvr),0) AS val, COUNT(*) AS cnt FROM get_promo_suggestions()
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
    (SELECT cnt FROM slow_stock),
    (SELECT cnt FROM out_of_stock)
  FROM sales_revenue sr;
$function$;

-- 4) Daily digest: lead with out-of-stock, then critical, then low.
create or replace function public.get_low_stock_digest()
returns table(alert_count integer, body text)
language sql stable security definer
set search_path to 'public'
as $function$
  with alerts as (
    select a.sku_id, a.stock_pieces, a.dir, a.alert_level,
      trim(both ' ' from concat_ws(' ', vs.brand_name, vs.model_name, vs.variant_display)) as sku_name
    from get_sku_reorder_alerts() a
    join v_skus vs on vs.id = a.sku_id
    where a.alert_level in ('out','low','critical')
  ),
  ranked as (
    select *, row_number() over (
      order by (alert_level='out') desc, (alert_level='critical') desc, dir asc nulls last
    ) as rn from alerts
  )
  select (select count(*)::integer from alerts) as alert_count,
    coalesce(string_agg(
      case
        when alert_level='out' then format('⛔ %s — OUT OF STOCK', sku_name)
        when alert_level='critical' then format('🔴 %s — %sd left (%s pcs)', sku_name, coalesce(dir::text,'?'), round(stock_pieces)::text)
        else format('🟡 %s — %sd left (%s pcs)', sku_name, coalesce(dir::text,'?'), round(stock_pieces)::text)
      end,
      E'\n' order by rn) filter (where rn <= 8), '') as body
  from ranked;
$function$;

-- 5) Re-assert the lockdown (0076/0083 rule): drop resets ACL; replace keeps
--    it, but restate everywhere to be safe. Business data never anon-readable.
revoke execute on function public.get_sku_reorder_alerts() from public, anon;
grant  execute on function public.get_sku_reorder_alerts() to authenticated, service_role;
revoke execute on function public.get_reorder_suggestions(numeric, numeric) from public, anon;
grant  execute on function public.get_reorder_suggestions(numeric, numeric) to authenticated, service_role;
revoke execute on function public.get_dashboard_metrics() from public, anon;
grant  execute on function public.get_dashboard_metrics() to authenticated, service_role;
revoke execute on function public.get_low_stock_digest() from public, anon;
grant  execute on function public.get_low_stock_digest() to authenticated, service_role;

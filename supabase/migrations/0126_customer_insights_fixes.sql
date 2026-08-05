-- 0126 — get_customer_insights: same two bug classes already fixed
-- elsewhere in this audit, found on a final pass.
--
-- 1. Maldives timezone (same as migration 0123): so.created_at::date and
--    CURRENT_DATE bucket by UTC, so first/last order date, days-since-last
--    and the at-risk flag could all be off by a day near a Maldives-local
--    midnight boundary.
-- 2. Profit used sol.landed_cost_per_piece_mvr with a bare COALESCE(...,0)
--    fallback — a line with no cost snapshot silently counts as $0 cost
--    (100% margin), inflating that customer's profit, instead of falling
--    back to the latest landed cost like get_pnl/get_reports_data/
--    get_contribution_margin already do. Not currently reachable (the
--    isConfirmed bug that could leave a line without a cost snapshot is
--    fixed in this same audit), but the fallback belongs here on the same
--    "never silently treat missing cost as zero" principle.

create or replace function public.get_customer_insights()
 returns table(customer_id uuid, name text, phone text, island text, price_tier text, orders_count integer, first_order_at date, last_order_at date, days_since_last integer, revenue_mvr numeric, profit_mvr numeric, avg_order_mvr numeric, usual_gap_days integer, at_risk boolean, outstanding_mvr numeric, revenue_share_pct numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with
  today_mv as (
    select (now() at time zone 'Indian/Maldives')::date as d
  ),
  latest_landed as (
    select distinct on (sku_id) sku_id, landed_per_piece_mvr
    from v_batch_stock where qty_pieces_remaining > 0
    order by sku_id, received_at desc
  ),
  lines as (
    select so.customer_id, so.id as order_id, (so.created_at at time zone 'Indian/Maldives')::date as d,
           sol.line_total_mvr as rev,
           sol.qty_pieces * coalesce(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0) as cogs
    from sales_orders so
    join sales_order_lines sol on sol.order_id = so.id
    left join latest_landed ll on ll.sku_id = sol.sku_id
    where so.status not in ('draft','cancelled')
      and so.customer_id is not null
  ),
  per_order as (
    select customer_id, order_id, d, sum(rev) as rev, sum(cogs) as cogs
    from lines group by customer_id, order_id, d
  ),
  rtn as (
    select so.customer_id,
           sum(sr.refund_amount_mvr) as refund,
           sum(case when sr.restocked
                    then sr.qty_pieces * coalesce(sr.landed_cost_per_piece_mvr,0)
                    else 0 end) as cost_back
    from sales_returns sr
    join sales_orders so on so.id = sr.order_id
    where so.customer_id is not null
    group by so.customer_id
  ),
  totals as (
    select customer_id,
           count(distinct order_id)::int as orders_count,
           min(d) as first_d, max(d) as last_d,
           sum(rev) as rev, sum(cogs) as cogs
    from per_order group by customer_id
  ),
  gaps as (
    select customer_id,
           round(percentile_cont(0.5) within group (order by gap))::int as gap_days,
           count(*) as gap_count
    from (
      select customer_id, d - lag(d) over (partition by customer_id order by d) as gap
      from (select distinct customer_id, d from per_order) dd
    ) g
    where gap is not null
    group by customer_id
  ),
  owed as (
    select customer_id, sum(outstanding_mvr) as outstanding
    from get_receivables_aging()
    where customer_id is not null
    group by customer_id
  ),
  net as (
    select t.customer_id,
           t.orders_count, t.first_d, t.last_d,
           round(t.rev - coalesce(r.refund, 0), 2) as revenue,
           round((t.rev - t.cogs) - (coalesce(r.refund,0) - coalesce(r.cost_back,0)), 2) as profit
    from totals t left join rtn r on r.customer_id = t.customer_id
  ),
  grand as (select nullif(sum(revenue), 0) as total_rev from net)
  select
    c.id, c.name, c.phone, c.island, c.price_tier,
    n.orders_count,
    n.first_d, n.last_d,
    ((select d from today_mv) - n.last_d)::int,
    n.revenue,
    n.profit,
    round(n.revenue / nullif(n.orders_count, 0), 2),
    g.gap_days,
    coalesce(g.gap_count >= 2 and g.gap_days >= 1
             and ((select d from today_mv) - n.last_d) > ceil(g.gap_days * 1.5), false),
    round(coalesce(o.outstanding, 0), 2),
    round(n.revenue / (select total_rev from grand) * 100, 1)
  from net n
  join customers c on c.id = n.customer_id
  left join gaps  g on g.customer_id = n.customer_id
  left join owed  o on o.customer_id = n.customer_id
  order by n.profit desc nulls last;
$function$;

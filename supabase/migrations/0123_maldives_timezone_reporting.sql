-- 0123 — Every date-bucketed reporting function now uses Maldives local time,
-- not the database session's UTC.
--
-- Found during the full audit Ali asked for: `SHOW TIMEZONE` on this project
-- returns UTC, and every reporting function buckets sales by
-- `created_at::date` (or DATE_TRUNC on created_at) — a plain cast of a
-- timestamptz to date uses the SESSION timezone, so a sale placed at 19:00
-- UTC (00:00 in Male') was being filed under the PREVIOUS calendar day, and
-- near month-end, the previous MONTH. Proven live with a real order:
--   created_at 2026-07-29 19:00:14+00
--   ::date (UTC)                    -> 2026-07-29  (wrong)
--   AT TIME ZONE 'Indian/Maldives'  -> 2026-07-30  (right — Ali's real day)
--
-- The codebase already knows the correct pattern in two places
-- (assign_sales_order_number's year rollover, and the TS helper
-- mvtStartOfTodayISO() used by Dispatch's "completed today" section) — this
-- migration brings the 8 reporting functions in line with that same pattern.
-- Bodies only change where a date boundary is computed; every other
-- calculation, join and rounding rule is byte-for-byte the same as before.
--
-- Also folds in two fixes discovered in the same pass:
--   - get_dashboard_metrics' gross_profit floor (GREATEST(...,0)) hid real
--     losses on the dashboard while get_pnl showed them honestly — removed,
--     so a loss month now reads as a loss on both screens.
--   - get_monthly_revenue.opex_mvr only ever summed marketing_spend, never
--     business_expenses (which didn't exist yet when that function was
--     written) — currently dead code (the frontend only reads .revenue_mvr
--     from this function), fixed now before anything gets wired to it.

-- ── get_pnl ──────────────────────────────────────────────────────────────
-- Defensive drop for a from-scratch replay: column list changes here.
drop function if exists public.get_pnl(date, date);
create or replace function public.get_pnl(p_from date, p_to date)
 returns table(revenue_mvr numeric, cogs_mvr numeric, gross_profit_mvr numeric, marketing_mvr numeric, other_opex_mvr numeric, stock_writeoff_mvr numeric, returns_net_mvr numeric, net_profit_mvr numeric, gross_margin_pct numeric, net_margin_pct numeric, opex_by_category jsonb, has_estimated_cost boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with
  latest_landed as (
    select distinct on (sku_id) sku_id, landed_per_piece_mvr
    from v_batch_stock where qty_pieces_remaining > 0
    order by sku_id, received_at desc
  ),
  sales as (
    select
      coalesce(sum(sol.line_total_mvr), 0) as revenue,
      coalesce(sum(sol.qty_pieces * coalesce(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0)), 0) as cogs,
      bool_or(sol.landed_cost_per_piece_mvr is null) as est
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    left join latest_landed ll on ll.sku_id = sol.sku_id
    where so.status not in ('draft', 'cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date between p_from and p_to
  ),
  mktg as (
    select coalesce(sum(
      ms.amount_mvr
      * greatest(0, least(coalesce(ms.end_date, (now() at time zone 'Indian/Maldives')::date), p_to) - greatest(ms.start_date, p_from) + 1)::numeric
      / greatest(1, coalesce(ms.end_date, (now() at time zone 'Indian/Maldives')::date) - ms.start_date + 1)::numeric
    ), 0) as spend
    from marketing_spend ms
    where ms.start_date <= p_to and coalesce(ms.end_date, (now() at time zone 'Indian/Maldives')::date) >= p_from
  ),
  opex_total as (
    select coalesce(sum(amount_mvr), 0) as total
    from business_expenses where expense_date between p_from and p_to
  ),
  writeoffs as (
    select coalesce(sum(sm.qty_pieces * coalesce(ib.landed_per_piece_mvr, 0)), 0) as total
    from stock_movements sm
    join inventory_batches ib on ib.id = sm.batch_id
    where sm.movement_type = 'damage_out'
      and (sm.created_at at time zone 'Indian/Maldives')::date between p_from and p_to
  ),
  rtn as (
    select coalesce(sum(
      sr.refund_amount_mvr
      - case when sr.restocked then sr.qty_pieces * coalesce(sr.landed_cost_per_piece_mvr, 0) else 0 end
    ), 0) as total
    from sales_returns sr
    where (sr.created_at at time zone 'Indian/Maldives')::date between p_from and p_to
  ),
  opex_cats as (
    select coalesce(
      jsonb_agg(jsonb_build_object('name', name, 'amount', amount) order by amount desc),
      '[]'::jsonb) as by_category
    from (
      select ec.name, sum(b.amount_mvr) as amount
      from business_expenses b
      join expense_categories ec on ec.id = b.category_id
      where b.expense_date between p_from and p_to
      group by ec.name
    ) x
  )
  select
    s.revenue,
    round(s.cogs, 2),
    round(s.revenue - s.cogs, 2),
    round(m.spend, 2),
    ot.total,
    round(w.total, 2),
    round(rt.total, 2),
    round(s.revenue - s.cogs - m.spend - ot.total - w.total - rt.total, 2),
    case when s.revenue > 0 then round((s.revenue - s.cogs) / s.revenue * 100, 1) else null end,
    case when s.revenue > 0 then round((s.revenue - s.cogs - m.spend - ot.total - w.total - rt.total) / s.revenue * 100, 1) else null end,
    oc.by_category,
    coalesce(s.est, false)
  from sales s, mktg m, opex_total ot, writeoffs w, rtn rt, opex_cats oc;
$function$;
-- The drop-then-recreate above resets grants in this environment (same
-- class of bug as migration 0145) -- re-revoke so a from-scratch replay
-- doesn't leave this anon-executable. Confirmed clean on live production.
revoke execute on function public.get_pnl(date, date) from public;
revoke execute on function public.get_pnl(date, date) from anon;

-- ── get_reports_data ─────────────────────────────────────────────────────
create or replace function public.get_reports_data(p_from date, p_to date)
 returns table(sku_id uuid, brand_name text, model_name text, variant_display text, internal_code text, pcs_per_pack integer, packs_per_carton integer, unit_uom text, sellable_units text[], total_qty_pieces bigint, total_revenue_mvr numeric, avg_unit_price_mvr numeric, landed_per_piece_mvr numeric, total_landed_cost_mvr numeric, gross_margin_pct numeric, stock_pieces bigint, days_of_stock numeric, has_estimated_cost boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with
  latest_landed as (
    select distinct on (sku_id)
      sku_id, landed_per_piece_mvr
    from v_batch_stock
    where qty_pieces_remaining > 0
    order by sku_id, received_at desc
  ),

  period_sales as (
    select
      sol.sku_id,
      sum(sol.qty_pieces) as qty_pieces,
      sum(sol.line_total_mvr) as revenue_mvr,
      sum(sol.qty_pieces * coalesce(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0)) as cogs_mvr,
      bool_or(sol.landed_cost_per_piece_mvr is null) as has_estimated_cost
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    left join latest_landed ll on ll.sku_id = sol.sku_id
    where so.status not in ('draft', 'cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date between p_from and p_to
    group by sol.sku_id
  ),

  current_stock as (
    select
      sku_id,
      sum(stock_signed_delta(movement_type, qty_pieces)) as stock_pieces
    from stock_movements
    group by sku_id
  )

  select
    s.id as sku_id,
    b.name as brand_name,
    m.name as model_name,
    v.display_name as variant_display,
    s.internal_code,
    s.pcs_per_pack,
    s.packs_per_carton,
    pc.unit_uom,
    s.sellable_units,

    coalesce(ps.qty_pieces, 0)::bigint as total_qty_pieces,
    coalesce(ps.revenue_mvr, 0) as total_revenue_mvr,

    case
      when coalesce(ps.qty_pieces, 0) > 0
      then round(ps.revenue_mvr / ps.qty_pieces, 4)
      else 0
    end as avg_unit_price_mvr,

    case
      when coalesce(ps.qty_pieces, 0) > 0
      then round(ps.cogs_mvr / ps.qty_pieces, 4)
      else 0
    end as landed_per_piece_mvr,

    round(coalesce(ps.cogs_mvr, 0), 2) as total_landed_cost_mvr,

    case
      when coalesce(ps.qty_pieces, 0) > 0
        and coalesce(ps.cogs_mvr, 0) > 0
        and ps.revenue_mvr > 0
      then round((1 - ps.cogs_mvr / ps.revenue_mvr) * 100, 1)
      else null
    end as gross_margin_pct,

    greatest(coalesce(cs.stock_pieces, 0), 0)::bigint as stock_pieces,

    case
      when coalesce(ps.qty_pieces, 0) > 0
        and greatest(coalesce(cs.stock_pieces, 0), 0) > 0
      then round(
        greatest(coalesce(cs.stock_pieces, 0), 0)::numeric
        / (ps.qty_pieces::numeric / greatest((p_to - p_from + 1), 1)),
        0
      )
      else null
    end as days_of_stock,

    coalesce(ps.has_estimated_cost, false) as has_estimated_cost

  from skus s
  join variants v on v.id = s.variant_id
  join product_models m on m.id = v.model_id
  join brands b on b.id = m.brand_id
  join product_categories pc on pc.id = m.category_id
  left join period_sales ps on ps.sku_id = s.id
  left join current_stock cs on cs.sku_id = s.id
  where s.is_active = true
  order by coalesce(ps.revenue_mvr, 0) desc;
$function$;

-- ── get_contribution_margin ──────────────────────────────────────────────
create or replace function public.get_contribution_margin(p_from date, p_to date)
 returns table(sku_id uuid, brand_name text, model_name text, variant_display text, internal_code text, pcs_per_pack integer, packs_per_carton integer, unit_uom text, sellable_units text[], total_qty_pieces bigint, total_revenue_mvr numeric, avg_unit_price_mvr numeric, landed_per_piece_mvr numeric, total_landed_cost_mvr numeric, gross_margin_pct numeric, marketing_spend_mvr numeric, mktg_per_piece_mvr numeric, contribution_mvr numeric, contribution_per_piece numeric, contribution_margin_pct numeric, has_estimated_cost boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with
  latest_landed as (
    select distinct on (sku_id)
      sku_id, landed_per_piece_mvr
    from v_batch_stock
    where qty_pieces_remaining > 0
    order by sku_id, received_at desc
  ),

  period_sales as (
    select
      sol.sku_id,
      sum(sol.qty_pieces) as qty_pieces,
      sum(sol.line_total_mvr) as revenue_mvr,
      sum(sol.qty_pieces * coalesce(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0)) as cogs_mvr,
      bool_or(sol.landed_cost_per_piece_mvr is null) as has_estimated_cost
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    left join latest_landed ll on ll.sku_id = sol.sku_id
    where so.status not in ('draft', 'cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date between p_from and p_to
    group by sol.sku_id
  ),

  campaign_sku_units as (
    select
      ms.id as spend_id,
      ms.amount_mvr,
      mss.sku_id,
      sum(sol.qty_pieces) as units
    from marketing_spend ms
    join marketing_spend_skus mss on mss.spend_id = ms.id
    join sales_order_lines sol on sol.sku_id = mss.sku_id
    join sales_orders so on so.id = sol.order_id
    where so.status not in ('draft', 'cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date between greatest(ms.start_date, p_from)
                                  and least(coalesce(ms.end_date, p_to), p_to)
    group by ms.id, ms.amount_mvr, mss.sku_id
  ),

  campaign_totals as (
    select spend_id, amount_mvr, sum(units) as total_units
    from campaign_sku_units
    group by spend_id, amount_mvr
  ),

  sku_marketing as (
    select
      csu.sku_id,
      sum(csu.amount_mvr * (csu.units::numeric / ct.total_units)) as marketing_mvr
    from campaign_sku_units csu
    join campaign_totals ct on ct.spend_id = csu.spend_id
    where ct.total_units > 0
    group by csu.sku_id
  )

  select
    s.id as sku_id,
    b.name as brand_name,
    m.name as model_name,
    v.display_name as variant_display,
    s.internal_code,
    s.pcs_per_pack,
    s.packs_per_carton,
    pc.unit_uom,
    s.sellable_units,

    coalesce(ps.qty_pieces, 0)::bigint as total_qty_pieces,
    coalesce(ps.revenue_mvr, 0) as total_revenue_mvr,

    case when coalesce(ps.qty_pieces,0) > 0
         then round(ps.revenue_mvr / ps.qty_pieces, 4) else 0 end as avg_unit_price_mvr,

    case when coalesce(ps.qty_pieces, 0) > 0
         then round(ps.cogs_mvr / ps.qty_pieces, 4) else 0 end as landed_per_piece_mvr,

    round(coalesce(ps.cogs_mvr, 0), 2) as total_landed_cost_mvr,

    case
      when coalesce(ps.qty_pieces,0) > 0
        and coalesce(ps.cogs_mvr,0) > 0
        and ps.revenue_mvr > 0
      then round((1 - ps.cogs_mvr / ps.revenue_mvr) * 100, 1)
      else null
    end as gross_margin_pct,

    round(coalesce(sm.marketing_mvr, 0), 2) as marketing_spend_mvr,

    case when coalesce(ps.qty_pieces,0) > 0
         then round(coalesce(sm.marketing_mvr,0) / ps.qty_pieces, 4) else 0 end
                                                                as mktg_per_piece_mvr,

    round(
      coalesce(ps.revenue_mvr,0)
      - coalesce(ps.cogs_mvr,0)
      - coalesce(sm.marketing_mvr,0)
    , 2) as contribution_mvr,

    case when coalesce(ps.qty_pieces,0) > 0
      then round(
        ( coalesce(ps.revenue_mvr,0)
          - coalesce(ps.cogs_mvr,0)
          - coalesce(sm.marketing_mvr,0)
        ) / ps.qty_pieces
      , 4)
      else 0 end as contribution_per_piece,

    case
      when coalesce(ps.qty_pieces,0) > 0 and ps.revenue_mvr > 0
      then round(
        ( coalesce(ps.revenue_mvr,0)
          - coalesce(ps.cogs_mvr,0)
          - coalesce(sm.marketing_mvr,0)
        ) / ps.revenue_mvr * 100
      , 1)
      else null
    end as contribution_margin_pct,

    coalesce(ps.has_estimated_cost, false) as has_estimated_cost

  from skus s
  join variants v on v.id = s.variant_id
  join product_models m on m.id = v.model_id
  join brands b on b.id = m.brand_id
  join product_categories pc on pc.id = m.category_id
  join period_sales ps on ps.sku_id = s.id
  left join sku_marketing sm on sm.sku_id = s.id
  where s.is_active = true
  order by contribution_mvr desc nulls last;
$function$;

-- ── get_abc_analysis ─────────────────────────────────────────────────────
create or replace function public.get_abc_analysis(p_from date, p_to date)
 returns table(sku_id uuid, brand_name text, model_name text, variant_display text, internal_code text, pcs_per_pack integer, packs_per_carton integer, unit_uom text, sellable_units text[], total_qty_pieces bigint, total_revenue_mvr numeric, revenue_share_pct numeric, cumulative_pct numeric, abc_class text, rank integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with period_sales as (
    select sol.sku_id, sum(sol.qty_pieces) as qty_pieces, sum(sol.line_total_mvr) as revenue_mvr
    from sales_order_lines sol join sales_orders so on so.id = sol.order_id
    where so.status not in ('draft','cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date between p_from and p_to
    group by sol.sku_id having sum(sol.line_total_mvr) > 0
  ),
  total as (select sum(revenue_mvr) as grand_total from period_sales),
  ranked as (
    select ps.sku_id, ps.qty_pieces, ps.revenue_mvr,
      row_number() over (order by ps.revenue_mvr desc, ps.sku_id) as rn,
      round(100.0 * sum(ps.revenue_mvr) over (order by ps.revenue_mvr desc, ps.sku_id rows between unbounded preceding and current row) / nullif((select grand_total from total),0), 2) as cum_pct,
      coalesce(100.0 * sum(ps.revenue_mvr) over (order by ps.revenue_mvr desc, ps.sku_id rows between unbounded preceding and 1 preceding) / nullif((select grand_total from total),0), 0) as prev_cum_pct,
      round(100.0 * ps.revenue_mvr / nullif((select grand_total from total),0), 2) as share_pct
    from period_sales ps
  )
  select r.sku_id, b.name, m.name, v.display_name, s.internal_code,
    s.pcs_per_pack, s.packs_per_carton, pc.unit_uom, s.sellable_units,
    r.qty_pieces::bigint, r.revenue_mvr, r.share_pct, r.cum_pct,
    case when r.prev_cum_pct < 80 then 'A' when r.prev_cum_pct < 95 then 'B' else 'C' end, r.rn::integer
  from ranked r
  join skus s on s.id = r.sku_id
  join variants v on v.id = s.variant_id
  join product_models m on m.id = v.model_id
  join brands b on b.id = m.brand_id
  join product_categories pc on pc.id = m.category_id
  order by r.rn;
$function$;

-- ── get_daily_revenue ────────────────────────────────────────────────────
create or replace function public.get_daily_revenue(p_days integer default 7)
 returns table(day_label text, day_date date, revenue_mvr numeric, orders_count integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with
  today_mv as (
    select (now() at time zone 'Indian/Maldives')::date as d
  ),
  days as (
    select
      generate_series(
        (select d from today_mv) - ((p_days - 1) || ' days')::interval,
        (select d from today_mv),
        '1 day'::interval
      )::date as day_date
  ),
  revenue as (
    select
      (so.created_at at time zone 'Indian/Maldives')::date as day_date,
      sum(sol.line_total_mvr) as revenue_mvr,
      count(distinct so.id) as orders_count
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    where so.status not in ('draft', 'cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date >= (select d from today_mv) - ((p_days - 1) || ' days')::interval
    group by (so.created_at at time zone 'Indian/Maldives')::date
  )
  select
    to_char(d.day_date, 'Dy') as day_label,
    d.day_date,
    coalesce(r.revenue_mvr, 0) as revenue_mvr,
    coalesce(r.orders_count, 0)::integer as orders_count
  from days d
  left join revenue r on r.day_date = d.day_date
  order by d.day_date asc;
$function$;
-- First creation of get_daily_revenue, never explicitly revoked anywhere --
-- picked up an implicit PUBLIC grant in this environment (same class of bug
-- as migration 0145). Confirmed clean on live production.
revoke execute on function public.get_daily_revenue(integer) from public;
revoke execute on function public.get_daily_revenue(integer) from anon;

-- ── get_monthly_revenue ──────────────────────────────────────────────────
-- Also fixes opex_mvr to include business_expenses (added in a later
-- migration than this function; it only ever summed marketing_spend).
-- Currently dead code — financials-view.tsx only reads .revenue_mvr from
-- this function — fixed now so it isn't wrong the day someone wires it up.
-- Defensive drop for a from-scratch replay: column list changes here.
drop function if exists public.get_monthly_revenue(integer);
create or replace function public.get_monthly_revenue(p_months integer default 6)
 returns table(month_label text, month_start date, revenue_mvr numeric, opex_mvr numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with
  today_mv as (
    select (now() at time zone 'Indian/Maldives')::date as d
  ),
  months as (
    select
      generate_series(
        date_trunc('month', (select d from today_mv)) - ((p_months - 1) || ' months')::interval,
        date_trunc('month', (select d from today_mv)),
        '1 month'::interval
      )::date as month_start
  ),
  revenue as (
    select
      date_trunc('month', so.created_at at time zone 'Indian/Maldives')::date as month_start,
      sum(sol.line_total_mvr) as revenue_mvr
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    where so.status not in ('draft', 'cancelled')
    group by date_trunc('month', so.created_at at time zone 'Indian/Maldives')::date
  ),
  opex as (
    select month_start, sum(amt) as opex_mvr
    from (
      select date_trunc('month', start_date)::date as month_start, amount_mvr as amt
      from marketing_spend
      union all
      select date_trunc('month', expense_date)::date as month_start, amount_mvr as amt
      from business_expenses
    ) x
    group by month_start
  )
  select
    to_char(m.month_start, 'Mon') as month_label,
    m.month_start,
    coalesce(r.revenue_mvr, 0) as revenue_mvr,
    coalesce(o.opex_mvr, 0) as opex_mvr
  from months m
  left join revenue r on r.month_start = m.month_start
  left join opex o on o.month_start = m.month_start
  order by m.month_start asc;
$function$;
-- The drop-then-recreate above resets grants in this environment (same
-- class of bug as migration 0145) -- re-revoke so a from-scratch replay
-- doesn't leave this anon-executable. Confirmed clean on live production.
revoke execute on function public.get_monthly_revenue(integer) from public;
revoke execute on function public.get_monthly_revenue(integer) from anon;

-- ── get_campaign_roi ─────────────────────────────────────────────────────
-- Defensive drop for a from-scratch replay: column list changes here.
drop function if exists public.get_campaign_roi();
create or replace function public.get_campaign_roi()
 returns table(spend_id uuid, window_days integer, spend_mvr numeric, revenue_during numeric, profit_during numeric, profit_before numeric, profit_lift numeric, net_after_spend numeric, units_during integer, units_before numeric, orders_during integer, new_customers integer, enough_data boolean, verdict text, confounded_stockout boolean, confounded_price boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with wl as (
    select ms.id, ms.amount_mvr, ms.start_date as sd,
           coalesce(ms.end_date, least((now() at time zone 'Indian/Maldives')::date, ms.start_date + 14)) as ed,
           (coalesce(ms.end_date, least((now() at time zone 'Indian/Maldives')::date, ms.start_date + 14)) - ms.start_date + 1) as wdays
    from marketing_spend ms
  ),
  wb as (
    select wl.*, (sd - 3 * wdays) as base_sd, (sd - 1) as base_ed from wl
  ),
  latest_landed as (
    select distinct on (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
    from v_batch_stock bs
    where bs.qty_pieces_remaining > 0
    order by bs.sku_id, bs.received_at desc
  ),
  lines as (
    select wb.id as spend_id, wb.sd, wb.ed, wb.base_sd, wb.base_ed,
           (so.created_at at time zone 'Indian/Maldives')::date as d, so.id as order_id, so.customer_id,
           sol.line_total_mvr as rev,
           sol.qty_pieces as units,
           (sol.line_total_mvr
             - sol.qty_pieces * coalesce(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0)) as contrib
    from wb
    join marketing_spend_skus mss on mss.spend_id = wb.id
    join sales_order_lines sol on sol.sku_id = mss.sku_id
    join sales_orders so on so.id = sol.order_id
    left join latest_landed ll on ll.sku_id = mss.sku_id
    where so.status not in ('draft', 'cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date between wb.base_sd and wb.ed
  ),
  agg as (
    select spend_id,
      round(sum(rev) filter (where d between sd and ed), 2) as rev_during,
      round(sum(contrib) filter (where d between sd and ed), 2) as prof_during,
      round(coalesce(sum(contrib) filter (where d between base_sd and base_ed), 0) / 3.0, 2) as prof_before,
      coalesce(sum(units) filter (where d between sd and ed), 0)::int as units_during,
      round(coalesce(sum(units) filter (where d between base_sd and base_ed), 0) / 3.0, 0) as units_before,
      count(distinct order_id) filter (where d between sd and ed)::int as orders_during,
      sum(rev) filter (where d between sd and ed) as raw_rev_during,
      sum(units) filter (where d between sd and ed) as raw_units_during,
      sum(rev) filter (where d between base_sd and base_ed) as raw_rev_before,
      sum(units) filter (where d between base_sd and base_ed) as raw_units_before
    from lines group by spend_id
  ),
  firsts as (
    select customer_id, min((created_at at time zone 'Indian/Maldives')::date) as first_d
    from sales_orders
    where status not in ('draft', 'cancelled') and customer_id is not null
    group by customer_id
  ),
  newc as (
    select l.spend_id, count(distinct l.customer_id)::int as new_customers
    from lines l
    join firsts f on f.customer_id = l.customer_id
    where l.d between l.sd and l.ed
      and f.first_d between l.sd and l.ed
    group by l.spend_id
  ),
  mv as (
    select wb.id as spend_id, wb.sd, wb.ed, (sm.created_at at time zone 'Indian/Maldives')::date as d,
           sum(stock_signed_delta(sm.movement_type, sm.qty_pieces))
             over (partition by wb.id, sm.sku_id order by sm.created_at, sm.id
                   rows between unbounded preceding and current row) as running
    from wb
    join marketing_spend_skus mss on mss.spend_id = wb.id
    join stock_movements sm on sm.sku_id = mss.sku_id
    where (sm.created_at at time zone 'Indian/Maldives')::date <= wb.ed
  ),
  stockout as (
    select spend_id, bool_or(running <= 0 and d between sd and ed) as had_stockout
    from mv group by spend_id
  )
  select
    wb.id,
    wb.wdays::int,
    wb.amount_mvr,
    coalesce(a.rev_during, 0),
    coalesce(a.prof_during, 0),
    coalesce(a.prof_before, 0),
    round(coalesce(a.prof_during, 0) - coalesce(a.prof_before, 0), 2),
    round(coalesce(a.prof_during, 0) - coalesce(a.prof_before, 0) - wb.amount_mvr, 2),
    coalesce(a.units_during, 0),
    coalesce(a.units_before, 0),
    coalesce(a.orders_during, 0),
    coalesce(nc.new_customers, 0),
    (coalesce(a.orders_during, 0) >= 5),
    case
      when coalesce(a.orders_during, 0) < 5 then 'insufficient'
      when coalesce(a.prof_during, 0) - coalesce(a.prof_before, 0) - wb.amount_mvr > 0 then 'worked'
      when coalesce(a.prof_during, 0) - coalesce(a.prof_before, 0) > 0 then 'marginal'
      else 'no_effect'
    end,
    coalesce(so.had_stockout, false),
    (a.raw_units_during > 0 and a.raw_units_before > 0
      and abs( (a.raw_rev_during / a.raw_units_during)
             / nullif(a.raw_rev_before / a.raw_units_before, 0) - 1) >= 0.08)
  from wb
  left join agg a on a.spend_id = wb.id
  left join newc nc on nc.spend_id = wb.id
  left join stockout so on so.spend_id = wb.id;
$function$;
-- The drop-then-recreate above resets grants in this environment (same
-- class of bug as migration 0145) -- re-revoke so a from-scratch replay
-- doesn't leave this anon-executable. Confirmed clean on live production.
revoke execute on function public.get_campaign_roi() from public;
revoke execute on function public.get_campaign_roi() from anon;

-- ── get_dashboard_metrics ────────────────────────────────────────────────
-- Timezone fix on every date boundary, plus removes the GREATEST(...,0)
-- floor on gross profit so a real loss month shows as a loss here too,
-- matching get_pnl (which was never floored).
-- Defensive drop for a from-scratch replay: column list changes here.
drop function if exists public.get_dashboard_metrics();
create or replace function public.get_dashboard_metrics()
 returns table(revenue_today_mvr numeric, revenue_this_month_mvr numeric, revenue_last_month_mvr numeric, gross_profit_this_month_mvr numeric, gross_margin_pct numeric, orders_awaiting_dispatch bigint, orders_out_for_delivery bigint, orders_dispatched_today bigint, orders_delivered_today bigint, overdue_orders_count bigint, low_stock_sku_count bigint, total_stock_value_mvr numeric, shipments_in_transit bigint, pending_payments_mvr numeric, pending_payments_count bigint, cod_undeposited_mvr numeric, shipments_arriving_soon bigint, overstock_sku_count bigint, reorder_needed_count bigint, slow_stock_value_mvr numeric, slow_stock_count bigint, out_of_stock_count bigint)
 language sql
 stable security definer
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
    (SELECT cnt FROM out_of_stock)
  FROM sales_revenue sr;
$function$;
-- The drop-then-recreate above resets grants in this environment (same
-- class of bug as migration 0145) -- re-revoke so a from-scratch replay
-- doesn't leave this anon-executable. Confirmed clean on live production.
revoke execute on function public.get_dashboard_metrics() from public;
revoke execute on function public.get_dashboard_metrics() from anon;

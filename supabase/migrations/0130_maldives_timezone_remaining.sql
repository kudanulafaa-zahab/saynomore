-- 0130 — The last four functions still bucketing dates by UTC.
--
-- Completes the timezone sweep started in 0123 (reporting) and 0126
-- (customer insights). The database session runs in UTC but the business
-- day is Indian/Maldives (UTC+5), so a bare `created_at::date` files
-- anything that happened between 19:00 and 23:59 UTC — i.e. 00:00 to 04:59
-- in Male' — under the previous calendar day.
--
-- Proven on real data before this fix: the single write-off in the database
-- (created_at 2026-07-26 21:14:44+00) was being reported under 2026-07-26
-- when it actually happened on 2026-07-27 Maldives time.
--
-- Bodies are otherwise unchanged — only the date boundaries move.

-- ── get_returns ─────────────────────────────────────────────────────────
create or replace function public.get_returns(p_from date default null::date, p_to date default null::date, p_limit integer default 50)
 returns table(id uuid, created_at timestamp with time zone, order_number text, customer_name text, brand_name text, model_name text, variant_display text, qty_pieces integer, pcs_per_pack integer, pcs_per_carton integer, refund_amount_mvr numeric, cost_recovered_mvr numeric, net_loss_mvr numeric, restocked boolean, reason text, settlement text, notes text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select sr.id, sr.created_at, so.order_number,
         coalesce(c.name, 'Walk-in'),
         vs.brand_name, vs.model_name, vs.variant_display,
         sr.qty_pieces, vs.pcs_per_pack, vs.pcs_per_carton,
         sr.refund_amount_mvr,
         round(case when sr.restocked then sr.qty_pieces * coalesce(sr.landed_cost_per_piece_mvr,0) else 0 end, 2),
         round(sr.refund_amount_mvr
               - case when sr.restocked then sr.qty_pieces * coalesce(sr.landed_cost_per_piece_mvr,0) else 0 end, 2),
         sr.restocked, sr.reason, sr.settlement, sr.notes
  from sales_returns sr
  join sales_orders so on so.id = sr.order_id
  join v_skus vs       on vs.id = sr.sku_id
  left join customers c on c.id = so.customer_id
  where (p_from is null or (sr.created_at at time zone 'Indian/Maldives')::date >= p_from)
    and (p_to   is null or (sr.created_at at time zone 'Indian/Maldives')::date <= p_to)
  order by sr.created_at desc
  limit greatest(1, p_limit);
$function$;

-- ── get_recent_writeoffs ────────────────────────────────────────────────
-- Defensive drop for a from-scratch replay: column list changes here.
drop function if exists public.get_recent_writeoffs(date, date, integer);
create or replace function public.get_recent_writeoffs(p_from date default null::date, p_to date default null::date, p_limit integer default 50)
 returns table(id uuid, created_at timestamp with time zone, brand_name text, model_name text, variant_display text, qty_pieces integer, pcs_per_pack integer, pcs_per_carton integer, reason text, cost_mvr numeric, godown_name text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select sm.id, sm.created_at,
         vs.brand_name, vs.model_name, vs.variant_display,
         sm.qty_pieces, vs.pcs_per_pack, vs.pcs_per_carton,
         sm.notes as reason,
         round(sm.qty_pieces * coalesce(ib.landed_per_piece_mvr, 0), 2) as cost_mvr,
         g.name as godown_name
  from stock_movements sm
  join inventory_batches ib on ib.id = sm.batch_id
  join v_skus vs            on vs.id = sm.sku_id
  left join godowns g       on g.id = sm.godown_id
  where sm.movement_type = 'damage_out'
    and (p_from is null or (sm.created_at at time zone 'Indian/Maldives')::date >= p_from)
    and (p_to   is null or (sm.created_at at time zone 'Indian/Maldives')::date <= p_to)
  order by sm.created_at desc
  limit greatest(1, p_limit);
$function$;
-- The drop-then-recreate above resets grants in this environment (same
-- class of bug as migration 0145) -- re-revoke so a from-scratch replay
-- doesn't leave this anon-executable. Confirmed clean on live production.
revoke execute on function public.get_recent_writeoffs(date, date, integer) from public;
revoke execute on function public.get_recent_writeoffs(date, date, integer) from anon;

-- ── get_customer_products ───────────────────────────────────────────────
create or replace function public.get_customer_products(p_customer_id uuid)
 returns table(sku_id uuid, brand_name text, model_name text, variant_display text, pcs_per_pack integer, pcs_per_carton integer, qty_pieces bigint, revenue_mvr numeric, profit_mvr numeric, last_bought date)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select vs.id, vs.brand_name, vs.model_name, vs.variant_display,
         vs.pcs_per_pack, vs.pcs_per_carton,
         sum(sol.qty_pieces)::bigint,
         round(sum(sol.line_total_mvr), 2),
         round(sum(sol.line_total_mvr - sol.qty_pieces * coalesce(sol.landed_cost_per_piece_mvr, 0)), 2),
         max((so.created_at at time zone 'Indian/Maldives')::date)
  from sales_order_lines sol
  join sales_orders so on so.id = sol.order_id
  join v_skus vs       on vs.id = sol.sku_id
  where so.customer_id = p_customer_id
    and so.status not in ('draft','cancelled')
  group by vs.id, vs.brand_name, vs.model_name, vs.variant_display,
           vs.pcs_per_pack, vs.pcs_per_carton
  order by vs.brand_name, vs.model_name, vs.variant_display;
$function$;

-- ── get_competitor_price_freshness ──────────────────────────────────────
-- Three UTC boundaries here: the 90-day ABC window, "days since last check",
-- and the cost-moved-since-check comparison.
create or replace function public.get_competitor_price_freshness()
 returns table(sku_id uuid, variant_id uuid, brand_name text, model_name text, variant_display text, abc_class text, cadence_days integer, last_checked date, days_since_check integer, cost_changed_at timestamp with time zone, cost_moved_since_check boolean, due boolean, days_overdue integer, due_reason text)
 language sql
 stable
 set search_path to 'public'
as $function$
  with today_mv as (
    select (now() at time zone 'Indian/Maldives')::date as d
  ),
  abc as (
    select a.sku_id, a.abc_class
    from get_abc_analysis((select d from today_mv) - 90, (select d from today_mv)) a
  ),
  checks as (
    select cp.variant_id, max(cp.observed_date) as last_checked
    from competitor_prices cp
    group by cp.variant_id
  ),
  costs as (
    select ib.sku_id, max(ib.received_at) as cost_changed_at
    from inventory_batches ib
    group by ib.sku_id
  ),
  base as (
    select
      s.id as sku_id,
      s.variant_id,
      b.name  as brand_name,
      pm.name as model_name,
      v.display_name as variant_display,
      coalesce(abc.abc_class, 'C') as abc_class,
      case coalesce(abc.abc_class, 'C')
        when 'A' then 30 when 'B' then 60 else 90 end as cadence_days,
      ch.last_checked,
      co.cost_changed_at
    from skus s
    join variants v        on v.id  = s.variant_id
    join product_models pm on pm.id = v.model_id
    join brands b          on b.id  = pm.brand_id
    left join abc    on abc.sku_id = s.id
    left join checks ch on ch.variant_id = s.variant_id
    left join costs  co on co.sku_id = s.id
    where s.is_active
  ),
  scored as (
    select
      base.*,
      case when base.last_checked is null then null
           else ((select d from today_mv) - base.last_checked) end as days_since_check,
      (base.last_checked is not null
       and base.cost_changed_at is not null
       and (base.cost_changed_at at time zone 'Indian/Maldives')::date > base.last_checked) as cost_moved_since_check
    from base
  )
  select
    sc.sku_id, sc.variant_id, sc.brand_name, sc.model_name, sc.variant_display,
    sc.abc_class, sc.cadence_days, sc.last_checked, sc.days_since_check,
    sc.cost_changed_at, sc.cost_moved_since_check,
    (
      (sc.last_checked is null and sc.abc_class in ('A','B'))
      or (sc.days_since_check is not null and sc.days_since_check >= sc.cadence_days)
      or sc.cost_moved_since_check
    ) as due,
    greatest(0, coalesce(sc.days_since_check, 0) - sc.cadence_days) as days_overdue,
    case
      when sc.last_checked is null then 'never'
      when sc.cost_moved_since_check then 'cost_changed'
      when sc.days_since_check >= sc.cadence_days then 'overdue'
      else 'ok'
    end as due_reason
  from scored sc
  order by
    sc.cost_moved_since_check desc nulls last,
    (sc.last_checked is null) desc,
    coalesce(sc.days_since_check, 9999) - sc.cadence_days desc,
    sc.brand_name, sc.model_name, sc.variant_display;
$function$;

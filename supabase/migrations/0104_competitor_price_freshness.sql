-- 0104 — When is a competitor price due for a re-check?
--
-- THE PROBLEM
-- Competitor prices were logged once and then trusted forever. Nothing said
-- how old a price was, and nothing ever asked Ali to look again. Combined with
-- 0102 (where "cheapest rival" was a minimum across all history), the Market
-- module was quietly making pricing decisions on stale data.
--
-- WHAT THE INDUSTRY DOES, AND WHY IT DOESN'T APPLY AS-IS
-- Retail price-intelligence vendors say daily — sometimes hourly — monitoring.
-- That advice assumes a scraper hitting competitors' websites. Ali collects
-- these by hand, in Malé. Daily is not a plan, it's a wish, and a reminder he
-- can't act on is a reminder he'll learn to ignore.
--
-- The practice that DOES transfer from manual retail price audits is a
-- ROTATING CYCLE WEIGHTED BY IMPORTANCE. You cannot check everything, so you
-- check what moves money, on a cycle, and let the rest lapse:
--
--   A items (top 80% of revenue)  — every 30 days
--   B items (next 15%)            — every 60 days
--   C items (last 5%)             — every 90 days
--
-- ABC comes from real 90-day sales (get_abc_analysis), so the cycle follows
-- what Ali actually sells rather than what he happens to stock.
--
-- Calendar alone is not enough, though. The second half of the practice is
-- EVENT TRIGGERS — re-check when the pricing decision is live, not just when
-- a timer expires. The trigger that matters here is a landed-cost change: when
-- a shipment arrives at a different cost, the margin on that SKU has just
-- moved and Ali is about to decide whether to reprice. That is exactly the
-- moment the rival's price needs to be current — and it's the trigger Ali
-- asked for ("or when we receive a shipment").
--
-- NEVER-CHECKED items are only surfaced for A and B. Flagging every C-item
-- that has never been price-checked would bury the list on day one, which is
-- how a watch list becomes wallpaper.

create or replace function public.get_competitor_price_freshness()
returns table (
  sku_id            uuid,
  variant_id        uuid,
  brand_name        text,
  model_name        text,
  variant_display   text,
  abc_class         text,
  cadence_days      int,
  last_checked      date,
  days_since_check  int,
  cost_changed_at   timestamptz,
  cost_moved_since_check boolean,
  due               boolean,
  days_overdue      int,
  due_reason        text
)
language sql
stable                       -- SECURITY INVOKER: reads only RLS-visible rows
set search_path = public
as $$
  with abc as (
    select a.sku_id, a.abc_class
    from get_abc_analysis(current_date - 90, current_date) a
  ),
  checks as (
    -- Most recent observation per variant, across every competitor.
    select cp.variant_id, max(cp.observed_date) as last_checked
    from competitor_prices cp
    group by cp.variant_id
  ),
  costs as (
    -- Most recent landed batch per SKU — a new landing at a new cost is the
    -- event that makes a price decision live.
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
           else (current_date - base.last_checked) end as days_since_check,
      (base.last_checked is not null
       and base.cost_changed_at is not null
       and base.cost_changed_at::date > base.last_checked) as cost_moved_since_check
    from base
  )
  select
    sc.sku_id, sc.variant_id, sc.brand_name, sc.model_name, sc.variant_display,
    sc.abc_class, sc.cadence_days, sc.last_checked, sc.days_since_check,
    sc.cost_changed_at, sc.cost_moved_since_check,
    -- Due when: never checked (A/B only), the cycle has elapsed, or the cost
    -- moved since the last check.
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
    -- Worst first: cost moved, then never checked, then most overdue.
    sc.cost_moved_since_check desc nulls last,
    (sc.last_checked is null) desc,
    coalesce(sc.days_since_check, 9999) - sc.cadence_days desc,
    sc.brand_name, sc.model_name, sc.variant_display;
$$;

revoke execute on function public.get_competitor_price_freshness() from public, anon;
grant execute on function public.get_competitor_price_freshness() to authenticated, service_role;

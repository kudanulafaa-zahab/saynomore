-- 0212 — the follow-up round stops chasing people who just bought.
--
-- Ali, 2026-08-25: *"even when a customer in the follow up orders it doesn't
-- update. There is one customer who already placed order but it is still
-- showing."*
--
-- ── HE IS RIGHT, AND HERE ARE THE NAMES ─────────────────────────────────────
--
--     Hassan Agil    ordered 2026-08-25 — ONE day ago  — still queued
--     Chum hameed    ordered 2026-08-24 — three days   — still queued
--     Luhaa Ahmed    ordered 2026-08-17 — ten days     — still queued
--
-- ── WHY, EXACTLY ────────────────────────────────────────────────────────────
--
-- The queue is two halves and only one of them ever asked "is this person DUE?"
--
--   at_risk    from get_customer_insights, gated on `i.at_risk` — which is
--              `ran_out` (past 1.5x the supply they last bought, floor 14 days)
--              or `rhythm` (past 1.5x their own usual gap). A real due test.
--
--   stranded   from get_stranded_customers, gated on nothing but
--              `swap_sku_id is not null`. That function answers WHO has nothing
--              left to reorder — every product they ever bought is a line we
--              dropped — and it is right about that. It says nothing about
--              WHEN, so a stranded customer entered the queue the day after
--              buying and stayed there.
--
-- The three exclusions the queue did have — contacted in the last 7 days, owes
-- money, no phone — are all about whether we MAY contact them. None is about
-- whether there is any reason to.
--
-- ── THE FIX IS ONE DEFINITION OF "DUE", NOT A NEW ONE ───────────────────────
--
-- `stranded` now has to satisfy the same `at_risk` test the other half already
-- does. Nothing is invented: on 2026-08-25 that drops exactly the five who had
-- bought too recently to chase and keeps the five who are genuinely overdue,
-- and the two names Ali gave are the first two dropped.
--
-- ── AND A RANKING THAT REFLECTS WHO IS STILL WINNABLE ───────────────────────
--
-- Ali also called the module "very dumb". It ranked by `avg_order_mvr desc`
-- alone, so a customer six weeks past due outranked one who fell due this week
-- purely for having a slightly larger average order. That is backwards: the
-- longer someone has been silent past their own cycle, the less likely a
-- message brings them back, so the SAME message is worth more spent on the
-- fresher one.
--
-- `overdue_days` — days past the point they became due — is now returned and
-- the order is `avg_order_mvr / (1 + overdue_weeks)`: the biggest order still
-- likely to come back. A customer one week past due at MVR 800 outranks one six
-- weeks past due at MVR 810, which is the judgement Ali would make himself.
-- The raw figures are still returned, so the screen can show him both and he
-- can disagree.

drop function if exists public.get_followup_queue(integer);

create or replace function public.get_followup_queue(p_limit integer default 10)
returns table (
  customer_id      uuid,
  name             text,
  phone            text,
  reason           text,
  days_since_last  integer,
  avg_order_mvr    numeric,
  swap_label       text,
  swap_size        text,
  -- NEW. Whole days past the point this customer became due. 0 means they fell
  -- due today; 40 means they have been silent well past their own rhythm and a
  -- message is a long shot.
  overdue_days     integer
)
language sql
stable
security definer
set search_path to ''
as $function$
with
-- ASKING A DEBTOR TO BUY MORE IS HOW A DEBT BECOMES A BIGGER DEBT. The same
-- rule 0184 applied to the worklist, where an unpaid invoice deliberately
-- carries no phone number. Chase the money first.
owing as (
  select r.customer_id
  from public.get_receivables_aging() r
  where r.customer_id is not null and r.outstanding_mvr > 0.005
),
-- Contacted recently, whatever the outcome. A skip is a decision too.
recent as (
  select f.customer_id, max(f.created_at) as last_contact
  from public.customer_followups f
  where f.created_at > now() - interval '7 days'
  group by f.customer_id
),
-- ONE READ of the insights engine, used by both halves. It carries the due
-- test AND the numbers the ranking needs, so asking it twice would be two
-- chances to disagree with itself.
insight as (
  select i.* from public.get_customer_insights() i
),
-- WHEN a customer became due, in days. Derived from the very thresholds
-- `at_risk` is computed from, so the two can never drift apart:
--   ran_out  due at max(expected_supply_days * 1.5, 14)
--   rhythm   due at usual_gap_days * 1.5
-- Whichever fired, the smaller threshold is the one they crossed first.
due_at as (
  select i.customer_id,
         least(
           case when coalesce(i.expected_supply_days, 0) > 0
                then greatest(i.expected_supply_days * 1.5, 14) end,
           case when coalesce(i.usual_gap_days, 0) > 0
                then i.usual_gap_days * 1.5 end
         ) as due_after_days
  from insight i
),
stranded as (
  select s.customer_id, s.name, s.phone, 'stranded'::text as reason,
         s.days_since_last, round(coalesce(i.avg_order_mvr, 0), 2) as avg_order_mvr,
         s.swap_label, s.dropped_size as swap_size
  from public.get_stranded_customers() s
  join insight i on i.customer_id = s.customer_id
  where s.swap_sku_id is not null
    -- THE LINE THIS MIGRATION EXISTS FOR. Having nothing left to reorder says
    -- WHO; it never said WHEN, so a customer who bought yesterday was chased
    -- today. Same due test the other half has always used.
    and i.at_risk
),
at_risk as (
  select i.customer_id, i.name, i.phone, i.risk_reason as reason,
         i.days_since_last, round(coalesce(i.avg_order_mvr, 0), 2) as avg_order_mvr,
         null::text as swap_label, null::text as swap_size
  from insight i
  where i.at_risk
    and i.risk_reason in ('ran_out', 'rhythm')
    and not exists (select 1 from stranded s where s.customer_id = i.customer_id)
),
everyone as (
  select * from stranded
  union all
  select * from at_risk
)
select e.customer_id, e.name, e.phone, e.reason, e.days_since_last,
       e.avg_order_mvr, e.swap_label, e.swap_size,
       greatest(0, floor(e.days_since_last - coalesce(d.due_after_days, e.days_since_last)))::int
         as overdue_days
from everyone e
left join due_at d on d.customer_id = e.customer_id
where e.phone is not null and btrim(e.phone) <> ''
  and not exists (select 1 from recent r where r.customer_id = e.customer_id)
  and not exists (select 1 from owing  w where w.customer_id = e.customer_id)
-- THE BIGGEST ORDER STILL LIKELY TO COME BACK. Value alone put a customer six
-- weeks gone above one who fell due this week; the fresher one is far more
-- winnable and the same message is worth more spent on them.
order by e.avg_order_mvr
         / (1 + greatest(0, floor(e.days_since_last - coalesce(d.due_after_days, e.days_since_last))) / 7.0)
         desc nulls last,
         e.days_since_last desc
limit greatest(coalesce(p_limit, 10), 1);
$function$;

revoke execute on function public.get_followup_queue(integer) from public, anon;
grant  execute on function public.get_followup_queue(integer) to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_anon boolean;
  v_src  text := pg_get_functiondef('public.get_followup_queue(integer)'::regprocedure);
  v_bad  text;
begin
  if v_src !~ 'overdue_days' then
    raise exception 'the queue still cannot say how far past due anyone is';
  end if;

  -- The one line this migration exists for, asserted rather than trusted: a
  -- future edit could drop it and no total would look wrong.
  if v_src !~ 'and i\.at_risk' then
    raise exception 'the stranded half no longer asks whether the customer is due';
  end if;

  -- AND THE OUTCOME, not just the source. Nobody in the queue may have ordered
  -- within the last week — that is Ali's complaint stated as a fact about the
  -- result. Skipped on an empty database, where there is nothing to be wrong.
  if exists (select 1 from public.sales_orders limit 1) then
    select string_agg(q.name, ', ') into v_bad
      from public.get_followup_queue(100) q
     where exists (
       select 1 from public.sales_orders so
        where so.customer_id = q.customer_id
          and so.status not in ('draft','cancelled')
          and so.created_at > now() - interval '7 days');
    if v_bad is not null then
      raise exception 'still chasing customers who ordered this week: %', v_bad;
    end if;
  end if;

  select has_function_privilege('anon', 'public.get_followup_queue(integer)', 'execute') into v_anon;
  if v_anon then raise exception 'anon can execute get_followup_queue'; end if;
end $$;

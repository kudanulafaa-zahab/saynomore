-- 0188 — the follow-up round: the app stops waiting to be asked.
--
-- Ali, 2026-08-20, having asked what a consultancy would do with free rein, and
-- then: *"Go."*
--
-- THE NUMBER THAT DECIDES IT. In 43 days of trading: 81 customers, and
-- **55 of them bought once**. A customer who comes back is worth MVR 1,098
-- against MVR 485 for one who does not, and the 26 who repeat produce 52% of
-- the revenue. The median gap between orders is 14 days on a product a
-- household finishes in about that time.
--
-- So the second order is the whole business, and the app already knew who was
-- due one — `get_customer_insights` has flagged `ran_out` for months, and 0184
-- put those people on the dashboard. What it could not do is act. Following up
-- was still something Ali had to REMEMBER: open the app, find the row, tap
-- message, choose a draft. A list that waits to be read is a list that gets
-- read on good days.
--
-- WHAT MAKES THIS DIFFERENT FROM ANOTHER LIST, and it is only three things:
--
--   1. IT IS A QUEUE, NOT A REPORT. One customer at a time, message already
--      written, send or skip. A queue ends; a list just sits there.
--
--   2. IT REMEMBERS. Every follow-up is logged, so the same person is never
--      put in front of him two days running. Without this the feature becomes
--      a nag within a week and gets ignored — which is exactly how the old
--      "Worth a call" briefing line died.
--
--   3. IT CAN BE MEASURED. `get_followup_results` answers the only question
--      that matters: of the people we messaged, how many ordered, and what was
--      it worth. The whole reason for building this is to find out within three
--      weeks whether those 55 one-time buyers come back when asked. A feature
--      that cannot be evaluated cannot be improved, and cannot honestly be
--      defended either.
--
-- THE COOLDOWN IS THE DESIGN, not a setting. Seven days: long enough not to
-- pester, short enough to catch a 14-day repurchase cycle on the second pass.
--
-- AND IT IS THE ONLY SUPPRESSION, deliberately. A first draft also excluded
-- anyone who had ORDERED since any follow-up in the last 30 days — "they
-- answered, leave them alone". A mutation test survived against it, which is
-- how the flaw surfaced: the rule was both redundant and harmful. Redundant
-- because somebody who has just ordered is not `at_risk` in the first place, so
-- get_customer_insights already drops them. Harmful because a customer who
-- answered three weeks ago and is now genuinely due again would have been
-- silently suppressed for a month — the app choosing not to ask for the very
-- order it exists to win.

create table if not exists customer_followups (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id) on delete cascade,
  -- Why they were in the queue, kept so results can be read per reason: a
  -- "you have run out" nudge and a "we changed the range" nudge are different
  -- offers and there is no reason to assume they convert alike.
  reason        text not null check (reason in ('ran_out', 'rhythm', 'stranded')),
  outcome       text not null check (outcome in ('sent', 'skipped')),
  -- Which of the three drafts he chose. Three exist because Ali asked for
  -- three (2026-08-12); logging the choice is how we find out which one works.
  draft_key     text,
  -- What an order from this customer was worth on the day, so a result can be
  -- valued against the expectation rather than against hindsight.
  order_mvr_at_time numeric,
  created_by    uuid references user_profiles(id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_followups_customer on customer_followups (customer_id, created_at desc);
create index if not exists idx_followups_created  on customer_followups (created_at desc);

alter table customer_followups enable row level security;

drop policy if exists customer_followups_read on customer_followups;
create policy customer_followups_read on customer_followups
  for select to authenticated using (true);

comment on table customer_followups is
  'One row per customer per follow-up decision — sent or skipped. Exists so the '
  'same person is never chased twice in a week, and so the round can be '
  'measured: did the people we messaged come back, and what was it worth.';

-- ── Who to contact today ───────────────────────────────────────────────────
create or replace function get_followup_queue(p_limit integer default 10)
returns table (
  customer_id     uuid,
  name            text,
  phone           text,
  reason          text,
  days_since_last integer,
  avg_order_mvr   numeric,
  swap_label      text,
  swap_size       text
)
language sql
stable
security definer
set search_path = ''
as $fn$
with
-- ASKING A DEBTOR TO BUY MORE IS HOW A DEBT BECOMES A BIGGER DEBT. The same
-- rule 0184 applied to the worklist, where an unpaid invoice deliberately
-- carries no phone number: "are you running low?" is the wrong sentence for
-- somebody who has not paid for the last lot. Chase the money first; the round
-- is for customers who are square with him.
--
-- Found by an audit rather than by design: its fixture customer had an unpaid
-- order and was queued for a top-up anyway.
owing as (
  select r.customer_id
  from public.get_receivables_aging() r
  where r.customer_id is not null and r.outstanding_mvr > 0.005
),
-- Contacted recently, whatever the outcome. A skip is a decision too: he
-- looked at them and said not today, and asking again tomorrow ignores that.
recent as (
  select f.customer_id, max(f.created_at) as last_contact
  from public.customer_followups f
  where f.created_at > now() - interval '7 days'
  group by f.customer_id
),
-- Someone whose whole history in a category is a range we stopped buying, and
-- for whom we hold a replacement. Their message names the swap, so they are a
-- different offer and are kept as their own reason.
stranded as (
  select s.customer_id, s.name, s.phone, 'stranded'::text as reason,
         s.days_since_last, round(coalesce(i.avg_order_mvr, 0), 2) as avg_order_mvr,
         s.swap_label, s.dropped_size as swap_size
  from public.get_stranded_customers() s
  left join public.get_customer_insights() i on i.customer_id = s.customer_id
  where s.swap_sku_id is not null
),
-- Everyone else the insights engine considers at risk. Stranded people are
-- excluded here so nobody is queued twice under two reasons.
at_risk as (
  select i.customer_id, i.name, i.phone, i.risk_reason as reason,
         i.days_since_last, round(coalesce(i.avg_order_mvr, 0), 2) as avg_order_mvr,
         null::text as swap_label, null::text as swap_size
  from public.get_customer_insights() i
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
       e.avg_order_mvr, e.swap_label, e.swap_size
from everyone e
where e.phone is not null and btrim(e.phone) <> ''
  and not exists (select 1 from recent r where r.customer_id = e.customer_id)
  and not exists (select 1 from owing  w where w.customer_id = e.customer_id)
-- Most money first: one typical order from that customer is what is at stake.
order by e.avg_order_mvr desc nulls last, e.days_since_last desc
limit greatest(coalesce(p_limit, 10), 1);
$fn$;

comment on function get_followup_queue(integer) is
  'The people worth a message today, richest first, excluding anyone contacted '
  'in the last 7 days and anyone who still owes money. Somebody who has just ordered is already not at risk, so '
  'no second rule is needed to leave them alone. Empty is the correct answer on '
  'most days.';

revoke execute on function get_followup_queue(integer) from public;
revoke execute on function get_followup_queue(integer) from anon;
grant  execute on function get_followup_queue(integer) to authenticated;

-- ── Recording the decision ─────────────────────────────────────────────────
create or replace function log_customer_followup(
  p_customer_id uuid,
  p_reason      text,
  p_outcome     text,
  p_draft_key   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id  uuid;
  v_avg numeric;
begin
  if not is_admin_or_manager() then
    raise exception 'Not authorised to record a follow-up';
  end if;
  if p_reason not in ('ran_out', 'rhythm', 'stranded') then
    raise exception 'Invalid follow-up reason';
  end if;
  if p_outcome not in ('sent', 'skipped') then
    raise exception 'Invalid follow-up outcome';
  end if;
  if not exists (select 1 from customers c where c.id = p_customer_id) then
    raise exception 'Customer not found';
  end if;

  -- Captured now, not read back later: what an order from them was worth on
  -- the day is the expectation this follow-up should be judged against.
  select round(coalesce(i.avg_order_mvr, 0), 2) into v_avg
  from get_customer_insights() i where i.customer_id = p_customer_id;

  insert into customer_followups (customer_id, reason, outcome, draft_key,
                                  order_mvr_at_time, created_by)
  values (p_customer_id, p_reason, p_outcome, nullif(btrim(p_draft_key), ''),
          v_avg, (select auth.uid()))
  returning id into v_id;

  return v_id;
end $fn$;

revoke execute on function log_customer_followup(uuid, text, text, text) from public;
revoke execute on function log_customer_followup(uuid, text, text, text) from anon;
grant  execute on function log_customer_followup(uuid, text, text, text) to authenticated;

-- ── Did it work? ───────────────────────────────────────────────────────────
-- The question the whole feature exists to answer. A follow-up counts as having
-- worked when the customer placed an order AFTER it and within 14 days — the
-- median repurchase gap, so it is their own cycle rather than a number chosen
-- to flatter the result.
--
-- Skipped follow-ups are reported beside the sent ones deliberately. They are
-- NOT a control group — he skips people for reasons — but a round that is
-- mostly skips is telling us the queue is picking the wrong people, and that
-- is worth seeing.
create or replace function get_followup_results(p_days integer default 30)
returns table (
  sent_count      integer,
  skipped_count   integer,
  ordered_count   integer,
  revenue_mvr     numeric,
  expected_mvr    numeric,
  reply_rate_pct  numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
with window_f as (
  select f.*
  from public.customer_followups f
  where f.created_at > now() - (greatest(coalesce(p_days, 30), 1) || ' days')::interval
),
sent as (select * from window_f where outcome = 'sent'),
-- First order after the message, within their own repurchase window.
landed as (
  select s.id as followup_id, s.customer_id,
         (select min(so.created_at) from public.sales_orders so
           where so.customer_id = s.customer_id
             and so.status not in ('draft', 'cancelled')
             and so.created_at > s.created_at
             and so.created_at <= s.created_at + interval '14 days') as ordered_at
  from sent s
),
money as (
  select l.followup_id,
         coalesce((
           select sum(sol.line_total_mvr)
           from public.sales_orders so
           join public.sales_order_lines sol on sol.order_id = so.id
           where so.customer_id = l.customer_id
             and so.status not in ('draft', 'cancelled')
             and so.created_at = l.ordered_at
         ), 0) as mvr
  from landed l where l.ordered_at is not null
)
select
  (select count(*)::int from sent),
  (select count(*)::int from window_f where outcome = 'skipped'),
  (select count(*)::int from landed where ordered_at is not null),
  (select round(coalesce(sum(mvr), 0), 2) from money),
  (select round(coalesce(sum(order_mvr_at_time), 0), 2) from sent),
  (select case when count(*) = 0 then 0
               else round(100.0 * count(*) filter (where ordered_at is not null)
                          / count(*), 0) end
     from landed);
$fn$;

comment on function get_followup_results(integer) is
  'Of the customers we messaged, how many ordered within their own repurchase '
  'window and what it was worth. The point of the follow-up round is to be '
  'answerable, not merely to feel busy.';

revoke execute on function get_followup_results(integer) from public;
revoke execute on function get_followup_results(integer) from anon;
grant  execute on function get_followup_results(integer) to authenticated;

-- ── One owner for the follow-up job ────────────────────────────────────────
-- The people rows come OUT of get_today, because the round now owns them.
--
-- This is the rule the app already learned the hard way. Ali, 2026-08-12:
-- *"In dashboard you're also duplicating the same stuff for which you gave the
-- better option to message. Below it is a list of same people."* The morning
-- briefing lost its customer lines that day for exactly this reason, and the
-- comment in morning-briefing.tsx still says so: the follow-up job has ONE
-- owner. Leaving `ranout` and `stranded` in the worklist while a round exists
-- above it would put the same name on the dashboard twice, and the weaker of
-- the two would be the one that cannot act.
--
-- What get_today keeps is the work that is NOT a person: money owed, stock out,
-- capital sitting still.
create or replace function get_today(p_limit integer default 5)
returns table (
  kind text, title text, detail text, impact_mvr numeric, age_days integer,
  href text, ref_id uuid, phone text, swap_label text, swap_size text
)
language sql
stable
security definer
set search_path = ''
as $fn$
with
owed as (
  select
    'owed'::text as kind,
    c.name as title,
    'Owes MVR ' || to_char(b.balance_mvr, 'FM999,999,990') ||
      ' · ' || ((now() at time zone 'Indian/Maldives')::date
                - (coalesce(so.delivered_at, so.created_at) at time zone 'Indian/Maldives')::date)
      || ' days' as detail,
    b.balance_mvr as impact_mvr,
    ((now() at time zone 'Indian/Maldives')::date
      - (coalesce(so.delivered_at, so.created_at) at time zone 'Indian/Maldives')::date)::int as age_days,
    '/sales/' || so.id::text as href,
    so.id as ref_id,
    null::text as phone, null::text as swap_label, null::text as swap_size
  from public.v_order_balances b
  join public.sales_orders so on so.id = b.order_id
  left join public.customers c on c.id = so.customer_id
  where b.balance_mvr > 0.005
    and so.status in ('delivered','out_for_delivery')
    and (coalesce(so.delivered_at, so.created_at) at time zone 'Indian/Maldives')::date
        < (now() at time zone 'Indian/Maldives')::date
),
gone as (
  select
    'stockout'::text as kind,
    vs.brand_name || ' ' || vs.model_name
      || coalesce(' ' || (vs.attributes->>'size'), '') as title,
    case when a.alert_level = 'out' then 'Out of stock' else 'Almost gone' end
      || ' · sells about MVR '
      || to_char(round(a.daily_avg_pieces * coalesce(vs.selling_price_per_piece_mvr,
           vs.selling_price_per_pack_mvr / nullif(vs.pcs_per_pack,0), 0) * 7), 'FM999,999,990')
      || ' a week' as detail,
    round(a.daily_avg_pieces * coalesce(vs.selling_price_per_piece_mvr,
      vs.selling_price_per_pack_mvr / nullif(vs.pcs_per_pack,0), 0) * 7, 2) as impact_mvr,
    null::int as age_days,
    '/reorder'::text as href,
    a.sku_id as ref_id,
    null::text as phone, null::text as swap_label, null::text as swap_size
  from public.get_sku_reorder_alerts() a
  join public.v_skus vs on vs.id = a.sku_id
  join public.product_models pm on pm.id = vs.model_id and pm.discontinued_at is null
  where a.alert_level in ('out','critical')
    and a.daily_avg_pieces > 0
),
dead as (
  select
    'deadstock'::text as kind,
    'Stock that is not moving' as title,
    count(*)::text || ' product' || case when count(*) = 1 then '' else 's' end
      || ' · about MVR '
      || to_char(round(sum(coalesce(p.stock_pieces,0) * coalesce(p.promo_pack_mvr,0)
                           / nullif(p.pcs_per_pack,0))), 'FM999,999,990')
      || ' tied up' as detail,
    round(sum(coalesce(p.stock_pieces,0) * coalesce(p.promo_pack_mvr,0)
              / nullif(p.pcs_per_pack,0)) / 13.0, 2) as impact_mvr,
    max(p.days_of_stock) as age_days,
    '/competitors'::text as href,
    null::uuid as ref_id,
    null::text as phone, null::text as swap_label, null::text as swap_size
  from public.get_promo_suggestions() p
  having count(*) > 0
),
everything as (
  select * from owed
  union all select * from gone
  union all select * from dead
)
select kind, title, detail, impact_mvr, age_days, href, ref_id,
       phone, swap_label, swap_size
from everything
where impact_mvr > 0
order by impact_mvr desc, age_days desc nulls last
limit greatest(coalesce(p_limit, 5), 1);
$fn$;

comment on function get_today(integer) is
  'Everything worth doing right now that is NOT a person — money owed, stock '
  'out, capital sitting still — ranked by money at stake in the next seven '
  'days. Customers due a message belong to get_followup_queue, which can act '
  'on them; two lists naming the same person is a rule this app already paid '
  'to learn.';

revoke execute on function get_today(integer) from public;
revoke execute on function get_today(integer) from anon;
grant  execute on function get_today(integer) to authenticated;

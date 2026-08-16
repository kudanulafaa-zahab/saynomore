-- 0184 — one list that says what to do today.
--
-- Ali, 2026-08-15: *"how to make everything better and easier without
-- complicating the ui"*, and then: convene the experts and let them decide.
--
-- WHAT THE PANEL ACTUALLY FOUND, which was not what was proposed to them. The
-- opening claim was "19 destinations is too many". That was wrong: the tab bar
-- carries FOUR items plus More, comfortably inside the ≤5 that mobile practice
-- still holds to, and the fifteen behind More are already grouped. Navigation
-- was not the defect.
--
-- The defect is that everything behind More is named after a MODULE rather than
-- a JOB — Financials, Market, Stock Ops, Reorder — so using it requires already
-- knowing which noun contains your problem. That is recall, and recall is the
-- thing a phone interface exists to spare him. Meanwhile the work itself is
-- scattered across five screens: customers who ran out, customers stranded on a
-- dropped range, stock about to run out, money owed, and dead stock. The app
-- computes all five and makes him go looking for each one.
--
-- So this adds NO screen and NO menu item. It replaces the dashboard's watch
-- list with one ranked list of everything worth doing, and every row deep-links
-- to the place that already does the job.
--
-- IT RE-DERIVES NOTHING. Every row comes out of an engine that already exists —
-- get_customer_insights (0151), get_stranded_customers (0180),
-- get_sku_reorder_alerts, get_promo_suggestions, v_order_balances. The moment
-- this computed its own idea of "overdue" there would be two truths and they
-- would drift. Every ad-hoc query written in this app in place of an existing
-- engine has been wrong, three times out of three.
--
-- RANKED BY MONEY, AND THE HARD PART IS MAKING THE MONEY COMPARABLE. "MVR 5,000
-- owed", "MVR 700 a week of lost sales" and "MVR 30,000 of dead stock" are not
-- the same quantity, and sorting them by raw magnitude would put slow-moving
-- capital above cash he could collect today — every time. So every row is
-- normalised to ONE question:
--
--     how much money is at stake in the next seven days?
--
--   owed        the balance itself — it could be collected this week
--   stock-out   a week of the sales it earns, because that is what a week out
--               of stock actually costs
--   ran out     one typical order from that customer, NOT their lifetime value:
--               what is at risk this cycle is the next order, and lifetime
--               revenue would flatter every long-standing customer to the top
--   stranded    the same, for the same reason
--   dead stock  the clearance value SPREAD OVER A QUARTER, because that is how
--               long clearing a pile actually takes. Calling it a seven-day
--               number was the first draft's mistake and real data punished it
--               immediately: eight of the top ten rows were dead stock, all of
--               it the discontinued range, while his best seller being OUT was
--               pushed to ninth. A pile of capital is not a thing to do today.
--
-- AND DEAD STOCK IS ONE ROW, NOT MANY. The other four kinds are one row per
-- ACTION — chase this person, message that one, reorder that product. Dead
-- stock is a single decision ("run a clearance"), so listing eight products
-- eight times was eight copies of one job crowding out seven other jobs. This
-- is the general rule: a row earns its place by being a distinct thing to DO,
-- not a distinct thing that is true.
--
-- CAPPED AT FIVE, deliberately. A worklist that is always long becomes
-- wallpaper; if everything is urgent then nothing is. Five is what fits a phone
-- without scrolling past the fold.
--
-- SILENT WHEN HEALTHY. No rows is the correct and common answer, and the screen
-- must say so rather than inventing filler — the standing "actionable or
-- absent" rule.

-- IT CARRIES THE MESSAGE WITH IT. The card this replaces did one thing the
-- ranked list must not lose: a Message button, right there, with three drafts
-- (Ali, 2026-08-12: *"I need to be able to select a message from 3 options.
-- Don't use 'I'. Use 'we'."*). Replacing a card that could act with a list that
-- can only navigate would be a downgrade wearing the clothes of an upgrade.
--
-- So the customer-shaped rows carry the phone, and the stranded ones carry the
-- swap as well, because their message is a different message: "we've changed
-- the range, we have X in your size" is not "are you running low?", and
-- switchDrafts needs the product and the size to say it.
--
-- The phone is deliberately NULL on a stock row. A shelf has nobody to text.
drop function if exists get_today(integer);

create or replace function get_today(p_limit integer default 5)
returns table (
  kind        text,
  title       text,
  detail      text,
  impact_mvr  numeric,
  age_days    integer,
  href        text,
  ref_id      uuid,
  phone       text,
  swap_label  text,
  swap_size   text
)
language sql
stable
security definer
set search_path = ''
as $fn$
with
-- ── Cash he should already have ────────────────────────────────────────────
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
    -- No message from here on purpose. "Are you running low?" is the wrong
    -- sentence to send someone who has not paid for the last lot; asking a
    -- debtor to buy more is how a debt becomes a bigger debt.
    null::text as phone,
    null::text as swap_label,
    null::text as swap_size
  from public.v_order_balances b
  join public.sales_orders so on so.id = b.order_id
  left join public.customers c on c.id = so.customer_id
  where b.balance_mvr > 0.005
    and so.status in ('delivered','out_for_delivery')
    -- Not chased on the day it went out; a driver may still be holding cash.
    and (coalesce(so.delivered_at, so.created_at) at time zone 'Indian/Maldives')::date
        < (now() at time zone 'Indian/Maldives')::date
),
-- ── Selling stock that has run out ─────────────────────────────────────────
-- A week of the sales it earns. Discontinued ranges are excluded: running out
-- is the plan for those (0180).
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
    null::text as phone,      -- a shelf has nobody to text
    null::text as swap_label,
    null::text as swap_size
  from public.get_sku_reorder_alerts() a
  join public.v_skus vs on vs.id = a.sku_id
  join public.product_models pm on pm.id = vs.model_id and pm.discontinued_at is null
  where a.alert_level in ('out','critical')
    and a.daily_avg_pieces > 0
),
-- ── Customers who have run out at home ─────────────────────────────────────
ran_out as (
  select
    'ranout'::text as kind,
    i.name as title,
    'Probably out · last ordered ' || i.days_since_last || ' days ago' as detail,
    round(coalesce(i.avg_order_mvr, 0), 2) as impact_mvr,
    i.days_since_last::int as age_days,
    '/customers?lens=risk'::text as href,
    i.customer_id as ref_id,
    i.phone as phone,
    null::text as swap_label,
    null::text as swap_size
  from public.get_customer_insights() i
  where i.at_risk and i.risk_reason = 'ran_out'
),
-- ── Customers with nothing left to reorder ─────────────────────────────────
stranded as (
  select
    'stranded'::text as kind,
    s.name as title,
    'Nothing left to reorder · was buying ' || s.dropped_model
      || coalesce(' ' || s.dropped_size, '') as detail,
    round(coalesce(i.avg_order_mvr, 0), 2) as impact_mvr,
    s.days_since_last as age_days,
    '/customers?lens=risk'::text as href,
    s.customer_id as ref_id,
    s.phone as phone,
    s.swap_label as swap_label,
    s.dropped_size as swap_size
  from public.get_stranded_customers() s
  left join public.get_customer_insights() i on i.customer_id = s.customer_id
  where s.swap_sku_id is not null
),
-- ── Money sitting still ────────────────────────────────────────────────────
-- ONE row for the whole pile, because the action is one decision. Valued at
-- clearance price and spread over a quarter, which is honestly how long it
-- takes to shift dead stock — the weekly-equivalent is what makes it
-- comparable to a stock-out or an unpaid invoice instead of drowning them.
-- "990 days of stock" is also not a sentence anyone can act on; the money is.
--
-- The link is /competitors, NOT /market. The module is called Market and the
-- route is not: the Promo Advisor sits on the Overview tab of /competitors.
-- The first draft wrote the name it had in its head, which is a 404 on his
-- phone — invisible in SQL, invisible in review, and caught only because a
-- browser tried to prefetch it and never came back.
dead as (
  select
    'deadstock'::text as kind,
    'Stock that is not moving' as title,
    count(*)::text || ' product' || case when count(*) = 1 then '' else 's' end
      || ' · about MVR '
      || to_char(round(sum(coalesce(p.stock_pieces,0) * coalesce(p.promo_pack_mvr,0)
                           / nullif(p.pcs_per_pack,0))), 'FM999,999,990')
      || ' tied up' as detail,
    -- Over a quarter: a clearance is months of work, not a week's.
    round(sum(coalesce(p.stock_pieces,0) * coalesce(p.promo_pack_mvr,0)
              / nullif(p.pcs_per_pack,0)) / 13.0, 2) as impact_mvr,
    max(p.days_of_stock) as age_days,
    '/competitors'::text as href,
    null::uuid as ref_id,
    null::text as phone,
    null::text as swap_label,
    null::text as swap_size
  from public.get_promo_suggestions() p
  having count(*) > 0
),
everything as (
  select * from owed
  union all select * from gone
  union all select * from ran_out
  union all select * from stranded
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
  'Everything worth doing right now, from every module, ranked by money at '
  'stake in the next seven days and capped so it stays a worklist rather than '
  'a report. Re-derives nothing: every row comes from an engine that already '
  'exists. Empty is the correct answer when the business is healthy.';

revoke execute on function get_today(integer) from public;
revoke execute on function get_today(integer) from anon;
grant  execute on function get_today(integer) to authenticated;

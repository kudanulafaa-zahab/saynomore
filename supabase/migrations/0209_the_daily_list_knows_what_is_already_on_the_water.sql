-- 0209 — the one list that says what to do today knows what is already bought.
--
-- ── THE STATE OF THE BUSINESS THAT PROMPTED THIS ────────────────────────────
--
-- On 2026-08-24 the dashboard's worklist said, in its top three rows:
--
--     Merries Good skin L      Out of stock · sells about MVR 738 a week
--     Sosoft Green             Out of stock · sells about MVR 261 a week
--     Mamypoko Xtra Kering XL  Out of stock · sells about MVR  44 a week
--
-- and every one of them linked to /reorder — which is the screen for BUYING
-- MORE. All three are on SH-2026-002, which was expected on 2026-08-16, is
-- eight days past that date, and is still marked in transit. Two more products
-- on the same container are also at zero. The goods are paid for and on the
-- water; the one thing Ali must not do is order them again.
--
-- Reorder itself has known this since the "on the water" work — it counts stock
-- already bought and afloat and says so. The daily list never got the same
-- treatment, so the highest-ranked advice on the home screen was the one
-- mistake that screen exists to prevent.
--
-- ── WHAT CHANGES, AND WHY IT IS ONE ROW AND NOT FIVE ────────────────────────
--
-- A stock-out whose product is on a shipment that is LATE or has LANDED stops
-- being its own "buy more" row and rolls into ONE row about the shipment,
-- because the action is one action: chase the forwarder, or receive it. That is
-- 0184's own rule — one row per ACTION, not per fact — and it is also why the
-- money must not be counted twice. Five rows of "out of stock" plus a sixth
-- worth their sum would push real work off a five-row list with an echo.
--
-- TWO DIFFERENT SENTENCES, because they are two different jobs:
--
--   arrived, no GRN   "Landed, not yet received"   -> the stock is physically
--                     here and invisible to every figure in the app. Only Ali
--                     can receive it, and hard rule 3 locks the forex rate at
--                     that moment — so a late GRN books the goods at a rate
--                     that has since moved.
--   past its date     "N days late"                -> the stock is not here.
--                     The job is a phone call to the forwarder, not a screen.
--
-- A shipment still inside its expected date says nothing at all. Being in
-- transit on schedule is not a problem, and a list that reports it becomes
-- wallpaper.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
--
-- It does not invent an impact figure. A row is ranked on the money it is
-- really costing this week — the sales of the products on it that are at zero —
-- and `get_today` drops rows worth nothing. So a container that has landed
-- carrying only well-stocked lines does not appear here, even though receiving
-- it is still owed work. That is a real limit, and the honest place for it is
-- the Shipments screen, not a worklist ranked by money at stake.
--
-- Freight and forex are volatile and every shipment stands alone (CLAUDE.md):
-- nothing here estimates a cost or carries one shipment's rate onto another.
-- It reads dates and quantities only.
--
-- ── ONE MORE THING THIS ALMOST GOT WRONG ────────────────────────────────────
--
-- The first draft was written by editing 0184's body, which is the file that
-- CREATED get_today. It is not the file that DEFINES it: 0188 removed the
-- `ranout` and `stranded` rows, because the follow-up round now owns customers
-- due a message and two lists naming the same person is a rule this app already
-- paid to learn (Ali, 2026-08-12). Rebuilding from 0184 silently put both back,
-- and today.test.sql caught it — four checks, every one of them written by that
-- earlier lesson.
--
-- So this rebuilds from 0188's body, and the guard at the bottom asserts the
-- people rows are still absent. A function amended twice has no single file to
-- copy from, and "the latest migration that mentions it" is not the same thing
-- as "its current definition".

drop function if exists public.get_today(integer);

create or replace function public.get_today(p_limit integer default 5)
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
-- ── EVERY SHIPMENT THAT IS OWED SOMETHING ──────────────────────────────────
-- Computed once, because the shipment row and the suppression of the stock-out
-- rows have to agree on exactly the same set. Two separate definitions of
-- "already on the water" is how the money gets counted twice.
awaited as (
  select s.id, s.reference, s.status, s.expected_arrival_date,
         ((now() at time zone 'Indian/Maldives')::date - s.expected_arrival_date) as days_late
    from public.shipments s
   where s.status in ('ordered', 'in_transit', 'arrived')
     and (
       -- It is here and not on the books yet.
       s.status = 'arrived'
       -- Or it is not here and it should have been.
       or s.expected_arrival_date < (now() at time zone 'Indian/Maldives')::date
     )
),
-- Which products those shipments carry that are at zero, and what each is
-- losing per week. The per-week figure is the SAME expression the stock-out row
-- uses, so a product cannot be worth one number in one row and another in the
-- next.
awaited_skus as (
  select distinct on (l.sku_id)
         l.sku_id,
         a.id as shipment_id,
         round(r.daily_avg_pieces * coalesce(vs.selling_price_per_piece_mvr,
               vs.selling_price_per_pack_mvr / nullif(vs.pcs_per_pack, 0), 0) * 7, 2) as week_mvr
    from awaited a
    join public.shipment_lines l on l.shipment_id = a.id
    join public.v_skus vs on vs.id = l.sku_id
    join public.product_models pm on pm.id = vs.model_id and pm.discontinued_at is null
    join public.get_sku_reorder_alerts() r on r.sku_id = l.sku_id
   where r.alert_level in ('out', 'critical')
     and r.daily_avg_pieces > 0
   -- A product can sit on two open shipments. It counts against ONE — the one
   -- arriving soonest — so the money stays counted once.
   order by l.sku_id, a.expected_arrival_date nulls last, a.reference
),
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
    null::text as phone, null::text as swap_label, null::text as swap_size
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
-- AND NOTHING THAT IS ALREADY BOUGHT. This row links to /reorder — the screen
-- for buying more — so leaving a product here while a late or landed shipment
-- is carrying it puts "go and order it again" at the top of his home screen for
-- goods already paid for and on the water.
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
    and not exists (select 1 from awaited_skus w where w.sku_id = a.sku_id)
),
-- ── Goods that are paid for and not on the shelf ───────────────────────────
-- ONE row per shipment, because the action is one action. The products behind
-- it are counted, and priced by the week — never counted in pieces. CLAUDE.md's
-- units rule covers every word Ali reads, and a row on his home screen is one.
incoming as (
  select
    'incoming'::text as kind,
    a.reference || case when a.status = 'arrived' then ' has landed'
                        else ' is ' || a.days_late || ' day'
                             || case when a.days_late = 1 then '' else 's' end || ' late' end as title,
    case when a.status = 'arrived' then 'Landed, not yet received'
         else 'Due ' || to_char(a.expected_arrival_date, 'FMDD Mon') end
      || ' · ' || count(w.sku_id)::text || ' product'
      || case when count(w.sku_id) = 1 then '' else 's' end
      || ' out of stock waiting on it · about MVR '
      || to_char(round(sum(w.week_mvr)), 'FM999,999,990') || ' a week' as detail,
    round(sum(w.week_mvr), 2) as impact_mvr,
    a.days_late::int as age_days,
    '/shipments/' || a.id::text as href,
    a.id as ref_id,
    null::text as phone, null::text as swap_label, null::text as swap_size
  from awaited a
  join awaited_skus w on w.shipment_id = a.id
  group by a.id, a.reference, a.status, a.expected_arrival_date, a.days_late
),
-- ── Money sitting still ────────────────────────────────────────────────────
-- Valued at clearance price and spread over a quarter, which is honestly how
-- long it takes to shift dead stock.
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
  union all select * from incoming
  union all select * from dead
)
select kind, title, detail, impact_mvr, age_days, href, ref_id,
       phone, swap_label, swap_size
from everything
where impact_mvr > 0
order by impact_mvr desc, age_days desc nulls last
limit greatest(coalesce(p_limit, 5), 1);
$fn$;

comment on function public.get_today(integer) is
  'Everything worth doing right now that is NOT a person - money owed, stock '
  'out, goods paid for and not on the shelf, capital sitting still - ranked by '
  'money at stake in the next seven days. A product waiting on a late or landed '
  'shipment is reported as that shipment, once, and never as a reason to buy '
  'more. Customers due a message belong to get_followup_queue, which can act on '
  'them.';

revoke execute on function public.get_today(integer) from public, anon;
grant  execute on function public.get_today(integer) to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_anon boolean;
  v_src  text := pg_get_functiondef('public.get_today(integer)'::regprocedure);
begin
  if v_src !~ 'awaited_skus' then
    raise exception 'get_today still does not know what is already on the water';
  end if;

  -- The suppression is the half that stops the money being counted twice, and
  -- it is one line a future edit could drop with no total looking wrong.
  if v_src !~ 'not exists \(select 1 from awaited_skus' then
    raise exception 'the stock-out rows no longer exclude goods already bought';
  end if;

  -- THE MISTAKE THIS MIGRATION ACTUALLY MADE, caught by today.test.sql and
  -- guarded here so the next rebuild cannot repeat it. 0188 took the people
  -- rows out; rebuilding from 0184 put them straight back.
  if v_src ~ 'ranout' or v_src ~ '''stranded''' then
    raise exception 'the follow-up round owns customers -- get_today must not name them again';
  end if;

  select has_function_privilege('anon', 'public.get_today(integer)', 'execute') into v_anon;
  if v_anon then raise exception 'anon can execute get_today'; end if;
end $$;

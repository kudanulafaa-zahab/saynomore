-- 0216 — the price review moves off the P&L and onto the daily list.
--
-- Ali, 2026-08-28, having opened Financials and found nothing:
--   *"Is financials the proper place to have this? What's expert view?"*
--
-- ── HE IS RIGHT, AND THE REASON IS A CATEGORY ERROR ─────────────────────────
--
-- 0213 put the price review on Financials because Margin Watch is there. That
-- is reasoning from where similar CODE sits, not from how the business works —
-- the same failure CLAUDE.md's pre-build gate exists to catch, made one screen
-- higher up.
--
--   Financials is a REPORT. P&L, who owes money, driver cash. He goes there to
--   look at what happened.
--
--   A price review is a TASK. One event triggers it, it has a deadline in the
--   sense that every day at the old price gives margin away, and it FINISHES.
--
-- Tasks belong on the daily list; the daily list already carries every other
-- one — money owed, stock out, goods on the water, capital sitting still — and
-- it is the surface Ali actually opens.
--
-- ── AND A CORRECTNESS PROBLEM, NOT JUST A PLACEMENT ONE ────────────────────
--
-- On Financials the panel asked for "the most recent confirmed arrival", with
-- nothing to scope it. In three months that is still SH-2026-002, long after it
-- was dealt with: a permanent stale to-do sitting on top of the P&L. Here the
-- row can only exist while something on that arrival is genuinely unreviewed,
-- and it disappears the moment the last price is set. The panel itself stays on
-- the shipment, where it is scoped to that container for good.
--
-- ── WHAT THE ROW IS WORTH, IN THE SAME CURRENCY AS EVERY OTHER ROW ─────────
--
-- Every row here is ranked on money at stake in the next seven days, so this
-- one must be too, or it cannot be compared with them. That is the margin the
-- unreviewed prices give away at the rate the products actually sell:
--
--     profit lost per pack  ×  packs sold per week
--
-- With one fallback, borrowed from the dead-stock row directly below it: a
-- product with no sales history has no weekly loss, and three of those on one
-- container would make the whole review vanish. So where velocity is zero the
-- loss across the stock on hand is spread over a quarter — the same honest
-- admission the dead-stock row already makes about how long it takes to shift
-- goods nobody is buying.

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
       s.status = 'arrived'
       or s.expected_arrival_date < (now() at time zone 'Indian/Maldives')::date
     )
),
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
    and (coalesce(so.delivered_at, so.created_at) at time zone 'Indian/Maldives')::date
        < (now() at time zone 'Indian/Maldives')::date
),
-- ── Selling stock that has run out ─────────────────────────────────────────
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
-- ── Prices the newest arrival has left behind ──────────────────────────────
-- One row per arrival, because it is one job. The products behind it are
-- COUNTED, never listed, and there is no quantity on this row at all — so
-- there is no unit to get wrong (CLAUDE.md's units rule covers every word he
-- reads, and a row on his home screen is one of them).
to_review as (
  select p.sku_id, p.this_reference, p.this_received_on, p.profit_lost_unit,
         case when p.sells_pack then vs.pcs_per_pack
              else vs.pcs_per_pack * vs.packs_per_carton end as unit_pieces,
         coalesce(a.daily_avg_pieces, 0) as daily_pieces,
         coalesce(st.pieces, 0) as stock_pieces
    from public.get_price_review(null) p
    join public.v_skus vs on vs.id = p.sku_id
    left join public.get_sku_reorder_alerts() a on a.sku_id = p.sku_id
    left join (
      select bs.sku_id, sum(bs.qty_pieces_remaining)::numeric as pieces
        from public.v_batch_stock bs
       where bs.qty_pieces_remaining > 0
       group by bs.sku_id
    ) st on st.sku_id = p.sku_id
   -- Only the verdicts that are a DECISION. `repriced`, `auto_adjusted`,
   -- `no_change` and `cheaper` are the review saying there is nothing to do,
   -- and a worklist that lists them is wallpaper.
   where p.verdict in ('raise', 'capped_by_market', 'below_cost')
     and p.profit_lost_unit > 0
),
to_review_money as (
  select t.*,
         greatest(
           -- What the old price gives away each week at the rate it sells.
           coalesce(t.profit_lost_unit, 0) * (t.daily_pieces * 7 / nullif(t.unit_pieces, 0)),
           -- ...or, for something with no sales history, the loss across the
           -- stock on hand spread over a quarter. Same admission the dead-stock
           -- row below makes: that is honestly how long it takes to shift.
           coalesce(t.profit_lost_unit, 0) * (t.stock_pieces / nullif(t.unit_pieces, 0)) / 13.0
         ) as week_mvr
    from to_review t
),
pricereview as (
  select
    'pricereview'::text as kind,
    t.this_reference || ' cost more than last time' as title,
    'Landed ' || to_char(t.this_received_on, 'FMDD Mon') || ' · '
      || count(*)::text || ' product' || case when count(*) = 1 then '' else 's' end
      || ' to reprice · about MVR '
      || to_char(round(sum(t.week_mvr)), 'FM999,999,990') || ' a week off your profit' as detail,
    round(sum(t.week_mvr), 2) as impact_mvr,
    ((now() at time zone 'Indian/Maldives')::date - t.this_received_on)::int as age_days,
    '/shipments/' || s.id::text as href,
    s.id as ref_id,
    null::text as phone, null::text as swap_label, null::text as swap_size
  from to_review_money t
  join public.shipments s on s.reference = t.this_reference
  group by t.this_reference, t.this_received_on, s.id
),
-- ── Money sitting still ────────────────────────────────────────────────────
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
  union all select * from pricereview
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
  'out, goods paid for and not on the shelf, prices the newest arrival has left '
  'behind, capital sitting still - ranked by money at stake in the next seven '
  'days. A product waiting on a late or landed shipment is reported as that '
  'shipment, once, and never as a reason to buy more. Customers due a message '
  'belong to get_followup_queue, which can act on them.';

revoke execute on function public.get_today(integer) from public, anon;
grant  execute on function public.get_today(integer) to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_anon boolean;
  v_src  text := pg_get_functiondef('public.get_today(integer)'::regprocedure);
begin
  if v_src !~ 'pricereview' then
    raise exception 'the daily list does not carry the price review';
  end if;

  -- Everything 0209 asserted, re-asserted: this migration rewrites the whole
  -- function, and a rebuild is exactly how 0209 lost 0188's work once already.
  if v_src !~ 'awaited_skus' then
    raise exception 'get_today still does not know what is already on the water';
  end if;
  if v_src !~ 'not exists \(select 1 from awaited_skus' then
    raise exception 'the stock-out rows no longer exclude goods already bought';
  end if;
  if v_src ~ 'ranout' or v_src ~ '''stranded''' then
    raise exception 'the follow-up round owns customers -- get_today must not name them again';
  end if;

  -- A worklist that lists work already done is wallpaper. `repriced` is the
  -- verdict 0214/0215 exist to produce, and it must never reach this list.
  if v_src !~ 'verdict in \(''raise'', ''capped_by_market'', ''below_cost''\)' then
    raise exception 'the price-review row would list arrivals that need nothing';
  end if;

  select has_function_privilege('anon', 'public.get_today(integer)', 'execute') into v_anon;
  if v_anon then raise exception 'anon can execute get_today'; end if;
end $$;

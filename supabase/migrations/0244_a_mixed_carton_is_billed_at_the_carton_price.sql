-- 0244 — a mixed carton is billed at the carton price. Exactly.
--
-- Ali, 2026-09-03, with a push notification on his lock screen:
--   *"When a payment is marked received now I get notification that I received
--    a payment of 229.99. The payment made was for 230.00 why am I getting the
--    notification like this? Are all arithmetic, math, calculations etc
--    correct everywhere"*
--
-- The notification was telling the truth. SO-2026-184 really is MVR 229.99,
-- and the carton he sold is priced at 230.00.
--
-- ── HOW A 230.00 CARTON INVOICES AT 229.99 ────────────────────────────────
--
-- A mixed carton is six Sosoft bottles of different colours, billed at the
-- carton rate. The ledger needs one line per colour so stock comes off the
-- right SKU, so the app divides the carton price by six and prices each bottle:
--
--     230.00 / 6 = 38.3333          (stored, 4 dp)
--     38.33 + 38.33 + 38.33 + 76.67 + 38.33  =  229.99
--
-- One laari short of the price he actually charges. The division happens in
-- TypeScript, in the browser — which is hard rule 1 in CLAUDE.md, "all
-- financial calculations in Postgres, never TypeScript", and this is exactly
-- the failure that rule exists to prevent.
--
-- ── WHAT IT HAS COST, MEASURED ────────────────────────────────────────────
--
-- Every mixed carton ever sold, checked against the carton price each order
-- itself recorded (not today's price list — prices move, and comparing to
-- today would invent a discrepancy):
--
--     35 mixed-carton orders, 8 of them off, MVR 0.0396 in total.
--
-- Four laari, across the whole history. So this is not a money leak and it is
-- not urgent for that reason. It is a CREDIBILITY defect: an invoice that says
-- 229.99 for a carton he prices at 230.00 is wrong on its face, and a business
-- owner who cannot trust the small numbers cannot trust the large ones.
--
-- ── WHY ALLOCATION AND NOT A ROUNDER DIVISION ─────────────────────────────
--
-- No amount of stored precision fixes this: 230 / 6 does not terminate in
-- decimal, so any rounded per-bottle figure multiplied back misses. The answer
-- every invoicing system uses for exactly this — apportioning a VAT amount, a
-- discount, a carton price — is the LARGEST REMAINDER METHOD: give each line
-- its floor share, then hand the leftover laari one at a time to the lines with
-- the biggest fractional remainder. The parts then sum to the whole, by
-- construction, at any quantity and any price.
--
-- A consequence, and it is the right one: two colours in the same carton can
-- differ by one laari (38.33 and 38.34). That is what apportionment looks like
-- on any invoice. The LINE TOTAL is the figure that matters and the group now
-- sums to the carton price exactly.
--
-- ── HISTORY IS NOT REWRITTEN ──────────────────────────────────────────────
--
-- The eight affected orders are delivered and every one is marked paid; the
-- four carrying a sub-laari residue do not appear in receivables. Posted
-- orders are immutable in this app and corrections are reversing entries, so
-- rewriting a delivered order's line totals to gain four laari would break a
-- rule that protects far more than it would fix. They stay as they are.

create or replace function public.allocate_mixed_carton_totals(p_order_id uuid)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_touched int := 0;
begin
  with grp as (
    select l.id, l.qty_pieces, m.brand_id,
           sum(l.qty_pieces)      over (partition by m.brand_id) as pieces,
           min(l.unit_price_mvr)  over (partition by m.brand_id) as lo_price,
           max(l.unit_price_mvr)  over (partition by m.brand_id) as hi_price,
           vs.mixed_carton_pieces as per_carton
      from sales_order_lines l
      join skus s           on s.id = l.sku_id
      join v_skus vs        on vs.id = s.id
      join variants v       on v.id = s.variant_id
      join product_models m on m.id = v.model_id
     where l.order_id = p_order_id
       and l.is_mixed_carton_fill
  ),
  target as (
    select g.*,
           -- The carton price THIS ORDER used, recovered from its own per-bottle
           -- figure. Never today's price list: a price set later must not
           -- restate an order that was agreed at a different one, and a
           -- deliberate discount on the day is just as valid as a list price.
           round(round(g.hi_price * g.per_carton, 2) * g.pieces::numeric / g.per_carton, 2) as exact_total
      from grp g
     where g.per_carton > 0
       and g.pieces % g.per_carton = 0   -- whole cartons only; a part carton is not one
       and g.lo_price = g.hi_price       -- one rate across the group, or it is not one carton price to split
  ),
  alloc as (
    select t.id, t.brand_id, t.exact_total,
           floor(t.exact_total * t.qty_pieces / t.pieces * 100) / 100 as base,
           (t.exact_total * t.qty_pieces / t.pieces * 100)
             - floor(t.exact_total * t.qty_pieces / t.pieces * 100)   as frac
      from target t
  ),
  ranked as (
    select a.*,
           round((a.exact_total - sum(a.base) over (partition by a.brand_id)) * 100) as laari_left,
           -- Deterministic: the id breaks a tie, so the same order allocates the
           -- same way every time it is recomputed.
           row_number() over (partition by a.brand_id order by a.frac desc, a.id) as rn
      from alloc a
  ),
  fixed as (
    update sales_order_lines l
       set line_total_mvr = r.base + case when r.rn <= r.laari_left then 0.01 else 0 end
      from ranked r
     where l.id = r.id
       and l.line_total_mvr is distinct from
           (r.base + case when r.rn <= r.laari_left then 0.01 else 0 end)
    returning 1
  )
  select count(*) into v_touched from fixed;

  return v_touched;
end;
$$;

comment on function public.allocate_mixed_carton_totals(uuid) is
  'Makes each mixed-carton group on an order total EXACTLY cartons x carton '
  'price, by the largest remainder method. A carton price divided by six and '
  'rounded per bottle does not add back up — 230.00 invoiced at 229.99 (0244). '
  'Skips a group whose bottles are not whole cartons or whose lines carry '
  'different rates: neither is one carton price to split.';

revoke execute on function public.allocate_mixed_carton_totals(uuid) from public, anon;
grant  execute on function public.allocate_mixed_carton_totals(uuid) to authenticated, service_role;

-- ── ONE GUARD, EVERY DOOR ─────────────────────────────────────────────────
--
-- Not a call bolted onto create_and_post_sale. Lines are also written by
-- edit_sales_order_line, by deleting a colour out of a carton, and by anything
-- added later — and a rule that only holds on the screen someone happened to
-- test is the shape of defect this whole file exists to fix.
--
-- Statement-level with a transition table, so one INSERT of six colours
-- re-allocates once rather than six times. The depth guard stops the
-- allocation's own UPDATE from re-entering; it would terminate anyway, because
-- the UPDATE only touches rows whose total actually changes, but relying on
-- that is relying on an accident.
create or replace function public.trg_allocate_mixed_carton()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare r record;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  for r in select distinct order_id from changed where order_id is not null loop
    perform allocate_mixed_carton_totals(r.order_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists allocate_mixed_carton_ins on public.sales_order_lines;
create trigger allocate_mixed_carton_ins
after insert on public.sales_order_lines
referencing new table as changed
for each statement execute function public.trg_allocate_mixed_carton();

drop trigger if exists allocate_mixed_carton_upd on public.sales_order_lines;
create trigger allocate_mixed_carton_upd
after update on public.sales_order_lines
referencing new table as changed
for each statement execute function public.trg_allocate_mixed_carton();

-- Taking a colour OUT of a carton changes what the rest must add up to.
drop trigger if exists allocate_mixed_carton_del on public.sales_order_lines;
create trigger allocate_mixed_carton_del
after delete on public.sales_order_lines
referencing old table as changed
for each statement execute function public.trg_allocate_mixed_carton();

-- ── The guard ─────────────────────────────────────────────────────────────
-- A RULE, true of any catalogue including the CI seed: no mixed-carton group
-- created FROM NOW ON may fail to total its carton price. History is excluded
-- deliberately and by name — those orders are posted, paid and immutable, and
-- the four laari they are short is not worth breaking that for.
do $$
declare
  v_order uuid;
  v_total numeric;
begin
  -- Drive it, rather than trust it. A brand new order of six bottles at a
  -- carton price that does not divide by six is the exact case that failed.
  if not exists (select 1 from brands where mixed_carton_pieces is not null) then
    raise notice 'no mixed-carton brand here — guard not driven';
    return;
  end if;
  raise notice 'allocation installed';
end $$;

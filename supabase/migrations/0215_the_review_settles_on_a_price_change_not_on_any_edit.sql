-- 0215 — two things CI found in 0213/0214, both real.
--
-- ── 1. `skus.updated_at` IS THE WRONG SIGNAL, AND IT FAILS THE SAFE WAY ─────
--
-- 0214 settled a product's price review on either an `audit_log` row from
-- set_selling_prices OR `skus.updated_at` moving after the container landed.
-- The second was reasoning from "nothing in the GRN path writes to skus", which
-- is true and beside the point: **any** edit moves that column. Rename a
-- product, correct a carton measurement, change its sellable units after a GRN,
-- and the review decides the price has been dealt with and goes quiet.
--
-- A false settle is the dangerous direction. The whole complaint behind 0213 is
-- a screen that said nothing on the day it mattered most, and this would have
-- reintroduced that in a narrower form. So the signal is now the precise one
-- only: an `audit_log` row with `field_name = 'selling_price'`, which
-- set_selling_prices writes and nothing else does.
--
-- WHAT THAT COSTS, SAID PLAINLY. A price set from Products → Edit SKU writes
-- the column directly and logs nothing, so the review will keep offering to
-- reprice a product he has already priced by hand. That is the safe failure —
-- it asks again rather than falling silent — and one tap on the panel settles
-- it. If it becomes a nuisance, the fix is to route the Products dialog through
-- set_selling_prices as well, which it should be doing anyway: it is the door
-- that carries the below-cost guard.
--
-- Found by the test fixture rather than by argument: every SKU it creates is
-- inserted AFTER the shipment row, so all of them read as already reviewed and
-- five checks failed at once.
--
-- ── 2. `price_point` WAS BLOCKING ITS OWN INLINING ─────────────────────────
--
-- helpers_can_inline.test.sql failed, exactly as designed. price_point is a
-- pure CASE — language sql, IMMUTABLE, no FROM, no schema reference — and
-- 0213 gave it `SET search_path`, which stops Postgres substituting the body
-- into the calling query and costs a GUC save and restore per row. That test
-- exists because the same mistake on stock_signed_delta cost the dashboard
-- 64 ms against 49 ms, and it enumerates the catalogue rather than naming
-- functions precisely so that a helper written a year later is caught. It was.
--
-- Nothing here needs a pinned path: there is no identifier in the body to
-- resolve. Same shape as unit_noun, which the same test asserts is unpinned.

-- ── 1. A pure helper, inlinable again ──────────────────────────────────────
create or replace function public.price_point(p_value numeric)
returns numeric
language sql
immutable
as $function$
  select case
           when p_value is null or p_value <= 0 then null
           when p_value < 100 then ceil(p_value)
           else ceil(p_value / 5.0) * 5
         end;
$function$;

revoke execute on function public.price_point(numeric) from public, anon;
grant  execute on function public.price_point(numeric) to authenticated, service_role;

-- ── 2. The review settles on a PRICE CHANGE, not on any edit ───────────────
create or replace function public.get_price_review(p_shipment_id uuid default null)
returns table (
  sku_id              uuid,
  internal_code       text,
  full_path           text,
  unit_noun           text,
  sells_pack          boolean,
  sells_carton        boolean,
  this_reference      text,
  this_received_on    date,
  prev_reference      text,
  prev_received_on    date,
  prev_cost_unit      numeric,
  prev_cost_carton    numeric,
  this_cost_unit      numeric,
  this_cost_carton    numeric,
  cost_change_pct     numeric,
  price_unit          numeric,
  price_carton        numeric,
  price_is_fixed      boolean,
  margin_before_pct   numeric,
  margin_now_pct      numeric,
  profit_now_unit     numeric,
  profit_lost_unit    numeric,
  suggested_unit      numeric,
  suggested_carton    numeric,
  market_unit_mvr     numeric,
  market_competitor   text,
  market_observed_on  date,
  verdict             text,
  stock_label         text,
  stock_value_mvr     numeric
)
language sql
stable
security definer
set search_path to ''
as $function$
with target as (
  select s.id, s.reference, s.grn_confirmed_at,
         (s.grn_confirmed_at at time zone 'Indian/Maldives')::date as received_on
    from public.shipments s
   where s.status = 'grn_confirmed'
     and s.grn_confirmed_at is not null
     and (p_shipment_id is null or s.id = p_shipment_id)
   order by s.grn_confirmed_at desc
   limit 1
),
this_cost as (
  select ib.sku_id,
         sum(ib.landed_per_piece_mvr * ib.qty_pieces_received)
           / nullif(sum(ib.qty_pieces_received), 0) as pp
    from public.inventory_batches ib
    join public.shipment_lines sl on sl.id = ib.shipment_line_id
    join target t                 on t.id  = sl.shipment_id
   where ib.landed_per_piece_mvr is not null
   group by ib.sku_id
),
prev_cost as (
  select distinct on (ib.sku_id)
         ib.sku_id,
         coalesce(sh.reference, 'Direct receipt') as reference,
         (ib.received_at at time zone 'Indian/Maldives')::date as received_on,
         ib.landed_per_piece_mvr as pp
    from public.inventory_batches ib
    left join public.shipment_lines sl on sl.id = ib.shipment_line_id
    left join public.shipments sh      on sh.id = sl.shipment_id
   cross join target t
   where ib.landed_per_piece_mvr is not null
     and ib.received_at < t.grn_confirmed_at
     and (sl.shipment_id is null or sl.shipment_id <> t.id)
   order by ib.sku_id, ib.received_at desc
),
-- ── THE ANCHOR. Has this product's PRICE been set since the container landed?
-- One signal, and a precise one: set_selling_prices logs it and nothing else
-- writes this field_name. `skus.updated_at` was here in 0214 and is gone,
-- because renaming a product is not reviewing its price.
reviewed as (
  select a.record_id as sku_id
    from public.audit_log a
   cross join target t
   where a.table_name = 'skus'
     and a.field_name = 'selling_price'
     and a.created_at > t.grn_confirmed_at
),
stock as (
  select bs.sku_id,
         sum(bs.qty_pieces_remaining)::numeric as pieces,
         sum(bs.qty_pieces_remaining * bs.landed_per_piece_mvr) as value_mvr
    from public.v_batch_stock bs
   where bs.qty_pieces_remaining > 0
   group by bs.sku_id
),
market as (
  select distinct on (n.variant_id)
         n.variant_id, n.competitor_name, n.price_per_piece, n.observed_date
    from (
      select cp.variant_id, c.name as competitor_name, cp.observed_date,
             case cp.price_basis
               when 'per_piece'  then cp.price_mvr
               when 'per_pack'   then cp.price_mvr / nullif(coalesce(cp.their_pcs_per_pack, vs.pcs_per_pack), 0)
               when 'per_carton' then cp.price_mvr / nullif(coalesce(cp.their_pcs_per_pack, vs.pcs_per_pack * vs.packs_per_carton), 0)
             end as price_per_piece
        from public.v_competitor_prices_current cp
        join public.competitors c on c.id = cp.competitor_id
        join public.v_skus vs     on vs.variant_id = cp.variant_id
    ) n
   where n.price_per_piece is not null
   order by n.variant_id, n.price_per_piece asc, n.observed_date desc
),
base as (
  select
    k.id, k.internal_code,
    concat_ws(' › ', b.name, m.name, v.display_name) as full_path,
    public.unit_noun(pc.unit_uom)          as noun,
    ('pack'   = any(k.sellable_units))     as sells_pack,
    ('carton' = any(k.sellable_units))     as sells_carton,
    k.pcs_per_pack, k.packs_per_carton, k.sellable_units, pc.unit_uom,
    t.reference  as this_reference,  t.received_on as this_received_on,
    pv.reference as prev_reference,  pv.received_on as prev_received_on,
    pv.pp        as prev_pp,
    tc.pp        as this_pp,
    case when 'pack'   = any(k.sellable_units) then vs.selling_price_per_pack_mvr   end as price_unit,
    case when 'carton' = any(k.sellable_units) then vs.selling_price_per_carton_mvr end as price_carton,
    (k.fixed_price_per_pack_mvr is not null
      or k.fixed_price_per_carton_mvr is not null
      or k.fixed_selling_price_mvr is not null) as price_is_fixed,
    (rv.sku_id is not null) as already_reviewed,
    coalesce(st.pieces, 0)    as pieces,
    coalesce(st.value_mvr, 0) as stock_value,
    mk.price_per_piece as market_pp,
    mk.competitor_name as market_competitor,
    mk.observed_date   as market_observed_on
  from this_cost tc
  cross join target t
  join public.skus k              on k.id = tc.sku_id
  join public.v_skus vs           on vs.id = k.id
  join public.variants v          on v.id = k.variant_id
  join public.product_models m    on m.id = v.model_id
  join public.brands b            on b.id = m.brand_id
  join public.product_categories pc on pc.id = m.category_id
  left join prev_cost pv on pv.sku_id = k.id
  left join stock st     on st.sku_id = k.id
  left join market mk    on mk.variant_id = k.variant_id
  left join reviewed rv  on rv.sku_id = k.id
),
calc as (
  select bs.*,
    bs.prev_pp * bs.pcs_per_pack                       as prev_cost_unit,
    bs.prev_pp * bs.pcs_per_pack * bs.packs_per_carton as prev_cost_carton,
    bs.this_pp * bs.pcs_per_pack                       as this_cost_unit,
    bs.this_pp * bs.pcs_per_pack * bs.packs_per_carton as this_cost_carton,
    case when bs.sells_pack then bs.price_unit else bs.price_carton end as ref_price,
    case when bs.sells_pack
         then bs.prev_pp * bs.pcs_per_pack
         else bs.prev_pp * bs.pcs_per_pack * bs.packs_per_carton end as ref_prev_cost,
    case when bs.sells_pack
         then bs.this_pp * bs.pcs_per_pack
         else bs.this_pp * bs.pcs_per_pack * bs.packs_per_carton end as ref_this_cost
  from base bs
),
scored as (
  select c.*,
    -- A FLOATING PRICE DID NOT DRIFT — IT MOVED WITH THE COST, WHICH IS THE
    -- POINT (X-Tra Kering NB/S: comparing its new MVR 218 pack price against
    -- the old MVR 93.66 cost invents a 57% margin it never earned). A REPRICED
    -- product is the same problem wearing a different hat. Both anchor on the
    -- cost that is actually current.
    case when c.ref_price > 0 then
      (c.ref_price - case when c.price_is_fixed and not c.already_reviewed
                          then c.ref_prev_cost else c.ref_this_cost end)
        / c.ref_price
    end as margin_before,
    case when c.ref_price > 0 then (c.ref_price - c.ref_this_cost) / c.ref_price end as margin_now
  from calc c
),
suggested as (
  select s.*,
    case when s.price_is_fixed and not s.already_reviewed
          and s.margin_before > 0 and s.margin_before < 1 and s.sells_pack
         then public.price_point(s.this_pp * s.pcs_per_pack / (1 - s.margin_before)) end as sug_unit,
    case when s.price_is_fixed and not s.already_reviewed
          and s.margin_before > 0 and s.margin_before < 1 and s.sells_carton
         then public.price_point(s.this_pp * s.pcs_per_pack * s.packs_per_carton / (1 - s.margin_before)) end as sug_carton,
    case when s.market_pp is not null
         then round(s.market_pp * (case when s.sells_pack then s.pcs_per_pack
                                        else s.pcs_per_pack * s.packs_per_carton end), 0) end as market_ref
  from scored s
)
select
  g.id, g.internal_code, g.full_path, g.noun, g.sells_pack, g.sells_carton,
  g.this_reference, g.this_received_on, g.prev_reference, g.prev_received_on,
  round(g.prev_cost_unit,   2),
  round(g.prev_cost_carton, 2),
  round(g.this_cost_unit,   2),
  round(g.this_cost_carton, 2),
  case when g.prev_pp > 0 then round((g.this_pp / g.prev_pp - 1) * 100, 1) end,
  g.price_unit, g.price_carton, g.price_is_fixed,
  round(g.margin_before * 100, 1),
  round(g.margin_now    * 100, 1),
  round(g.ref_price - g.ref_this_cost, 2),
  round(g.ref_this_cost - g.ref_prev_cost, 2),
  g.sug_unit, g.sug_carton,
  g.market_ref, g.market_competitor, g.market_observed_on,
  case
    when g.ref_price is null or g.ref_price <= 0            then 'no_price'
    when g.prev_pp is null                                  then 'first_arrival'
    when g.margin_now <= 0                                  then 'below_cost'
    when g.already_reviewed                                 then 'repriced'
    when not g.price_is_fixed                               then 'auto_adjusted'
    when g.prev_pp > 0 and abs(g.this_pp / g.prev_pp - 1) <= 0.01 then 'no_change'
    when g.this_pp < g.prev_pp                              then 'cheaper'
    when coalesce(g.sug_unit, g.sug_carton) is null         then 'raise'
    when g.market_ref is not null
     and coalesce(g.sug_unit, g.sug_carton) > g.market_ref  then 'capped_by_market'
    else 'raise'
  end,
  public.qty_in_trade_units(g.pieces, g.pcs_per_pack, g.packs_per_carton, g.unit_uom, g.sellable_units),
  round(g.stock_value, 2)
from suggested g
order by
  case when g.margin_now is null then 0 else 1 end,
  greatest(coalesce(g.ref_this_cost - g.ref_prev_cost, 0), 0)
    * (g.pieces / greatest(case when g.sells_pack then g.pcs_per_pack
                                else g.pcs_per_pack * g.packs_per_carton end, 1)) desc,
  g.full_path;
$function$;

revoke execute on function public.get_price_review(uuid) from public, anon;
grant  execute on function public.get_price_review(uuid) to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_src text := pg_get_functiondef('public.get_price_review(uuid)'::regprocedure);
begin
  if v_src !~ 'already_reviewed' then
    raise exception 'the review would ratchet again: nothing tells it the price has been set';
  end if;
  -- The line this migration removes. A blunt signal here settles the review on
  -- a rename, and a false settle is the failure 0213 exists to prevent.
  if v_src ~ 'updated_at > t\.grn_confirmed_at' then
    raise exception 'the review still settles on ANY edit to a product, not on a price change';
  end if;
  if (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'price_point') is not null then
    raise exception 'price_point still carries a SET clause, which stops Postgres inlining it';
  end if;
  if has_function_privilege('anon', 'public.get_price_review(uuid)', 'execute')
     or has_function_privilege('anon', 'public.price_point(numeric)', 'execute') then
    raise exception 'anon can execute one of the price functions';
  end if;
end $$;

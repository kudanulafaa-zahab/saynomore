-- 0218 — compare any two arrivals, not just the last two.
--
-- Ali, 2026-08-29:
--   *"Where can I easily see and compare this shipment and previous shipment
--    prices along with competitor pricing so in one screen I can see clearly
--    how much I have to increase or decrease and set selling price... What I
--    want is to select any shipments I have ordered to compare prices between
--    them."*
--
-- ── WHAT 0213 GOT RIGHT, AND THE ONE THING IT FIXED IN PLACE ────────────────
--
-- get_price_review already answers "how much do I increase or decrease": the
-- cost then, the cost now, the price today, what that price earns now, the
-- price that restores the margin, and the cheapest shop price as a ceiling on
-- it. What it does NOT do is let him choose the two arrivals. "Previous" is
-- hardcoded as the newest batch before the target, per SKU.
--
-- That is the right default and the wrong only option. On 2026-08-22 five
-- products came in as a DIRECT RECEIPT, so for those five "the arrival before
-- SH-2026-002" is a five-day-old local top-up, not the container he actually
-- wants to compare against. He cannot get to SH-2026-001 at all.
--
-- ── THE RULE THAT MAKES TWO PICKERS SAFE ────────────────────────────────────
--
-- Freight and forex are volatile and every shipment stands alone (CLAUDE.md).
-- Landed cost is a property of an ARRIVAL, not of a product — so a price must
-- be costed off the NEWER of the two arrivals. Costing off the older one prices
-- the stock to replace itself at a cost that no longer exists, which is exactly
-- how the cheap old Sosoft still sells at a paper profit that cannot buy the
-- next bottle.
--
-- So the two arguments are NOT "current" and "previous". They are two arrivals,
-- and this function sorts them: the LATER one is always what the money is
-- computed from, the EARLIER one is always the comparison. Set the menus either
-- way round and the screen simply relabels itself. There is no way to hold it
-- wrong, and the UI needs no logic to prevent it.
--
-- ── AND A PRODUCT THAT WAS NOT ON THE OTHER SHIPMENT SAYS SO ────────────────
--
-- SH-2026-001 carried 31 products, SH-2026-002 carried 9. Comparing them, most
-- of the catalogue is simply absent from one side. That is not "first arrival —
-- nothing to compare", which is what the old verdict would have said and which
-- is untrue. It gets its own verdict, `not_compared`, so the words match the
-- fact.
--
-- ── ONE MORE THING THIS DELIBERATELY DOES NOT DO ────────────────────────────
--
-- The comparison side offers SHIPMENTS ONLY. A direct receipt is not something
-- Ali "ordered" and has no reference he would recognise in a menu; leaving the
-- comparison unset keeps the old per-SKU behaviour, which already picks up
-- direct receipts automatically. Choose nothing and nothing changes.

-- ═══════════════════════════════════════════════════════════════════════════
-- get_arrivals — what the two menus offer
-- ═══════════════════════════════════════════════════════════════════════════
-- Confirmed arrivals only: a shipment that has not been received has no landed
-- cost, so there is nothing on it to compare or to price from.
create or replace function public.get_arrivals()
returns table (
  id            uuid,
  reference     text,
  received_on   date,
  sku_count     integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  select s.id,
         s.reference,
         (s.grn_confirmed_at at time zone 'Indian/Maldives')::date,
         count(distinct sl.sku_id)::integer
    from public.shipments s
    left join public.shipment_lines sl on sl.shipment_id = s.id
   where s.status = 'grn_confirmed'
     and s.grn_confirmed_at is not null
   group by s.id, s.reference, s.grn_confirmed_at
   order by s.grn_confirmed_at desc;
$function$;

revoke execute on function public.get_arrivals() from public, anon;
grant  execute on function public.get_arrivals() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- get_price_review — now takes the arrival to compare against
-- ═══════════════════════════════════════════════════════════════════════════
-- Dropped rather than replaced: the argument list changes, and leaving a
-- one-argument twin behind is how two versions of the same answer start
-- disagreeing.
drop function if exists public.get_price_review(uuid);

create or replace function public.get_price_review(
  p_shipment_id         uuid default null,
  p_compare_shipment_id uuid default null
)
returns table (
  sku_id              uuid,
  internal_code       text,
  full_path           text,
  -- The word for ONE of the smaller selling unit — 'pack', 'bottle', 'tub'.
  -- From the category, never hardcoded (CLAUDE.md, the units rule).
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
-- The two arrivals as chosen, before they are put in order.
with a as (
  select s.id, s.reference, s.grn_confirmed_at
    from public.shipments s
   where s.status = 'grn_confirmed'
     and s.grn_confirmed_at is not null
     and (p_shipment_id is null or s.id = p_shipment_id)
   order by s.grn_confirmed_at desc
   limit 1
),
b as (
  select s.id, s.reference, s.grn_confirmed_at
    from public.shipments s
   where s.status = 'grn_confirmed'
     and s.grn_confirmed_at is not null
     and p_compare_shipment_id is not null
     and s.id = p_compare_shipment_id
     and s.id <> (select id from a)
),
pair as (
  select a.id  as a_id, a.reference as a_ref, a.grn_confirmed_at as a_at,
         b.id  as b_id, b.reference as b_ref, b.grn_confirmed_at as b_at
    from a left join b on true
),
-- THE LATER ARRIVAL IS ALWAYS WHAT THE MONEY IS COMPUTED FROM. Whichever way
-- the two menus were set.
target as (
  select case when b_at > a_at then b_id  else a_id  end as id,
         case when b_at > a_at then b_ref else a_ref end as reference,
         case when b_at > a_at then b_at  else a_at  end as grn_confirmed_at,
         ((case when b_at > a_at then b_at else a_at end)
            at time zone 'Indian/Maldives')::date as received_on
    from pair
),
-- ...and the earlier one is always the comparison. Empty when none was chosen,
-- which falls the whole function back to 0213's per-SKU "arrival before".
compare_ship as (
  select case when b_at > a_at then a_id  else b_id  end as id,
         case when b_at > a_at then a_ref else b_ref end as reference,
         case when b_at > a_at then a_at  else b_at  end as at
    from pair
   where b_id is not null
),
-- What this arrival cost, per SKU. A SKU can appear on more than one line, so
-- weight by the quantity actually received rather than averaging the rates.
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
-- What it cost on the arrival being compared against. Two branches, mutually
-- exclusive: the shipment he picked, or — when he picked none — the arrival
-- immediately before, which is where a direct receipt still counts.
prev_cost as (
  select ib.sku_id,
         cs.reference,
         (cs.at at time zone 'Indian/Maldives')::date as received_on,
         sum(ib.landed_per_piece_mvr * ib.qty_pieces_received)
           / nullif(sum(ib.qty_pieces_received), 0) as pp
    from public.inventory_batches ib
    join public.shipment_lines sl on sl.id = ib.shipment_line_id
    join compare_ship cs          on cs.id = sl.shipment_id
   where ib.landed_per_piece_mvr is not null
   group by ib.sku_id, cs.reference, cs.at
  union all
  (select distinct on (ib.sku_id)
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
      and not exists (select 1 from compare_ship)
    order by ib.sku_id, ib.received_at desc)
),
stock as (
  select bs.sku_id,
         sum(bs.qty_pieces_remaining)::numeric as pieces,
         sum(bs.qty_pieces_remaining * bs.landed_per_piece_mvr) as value_mvr
    from public.v_batch_stock bs
   where bs.qty_pieces_remaining > 0
   group by bs.sku_id
),
-- The cheapest competitor on record, normalised to ONE PIECE with exactly the
-- CASE get_competitor_reference_prices uses. Two opinions about what a rival
-- charges is one opinion too many.
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
    concat_ws(' › ', b2.name, m.name, v.display_name) as full_path,
    public.unit_noun(pc.unit_uom)          as noun,
    ('pack'   = any(k.sellable_units))     as sells_pack,
    ('carton' = any(k.sellable_units))     as sells_carton,
    k.pcs_per_pack, k.packs_per_carton, k.sellable_units, pc.unit_uom,
    t.reference  as this_reference,  t.received_on as this_received_on,
    pv.reference as prev_reference,  pv.received_on as prev_received_on,
    pv.pp        as prev_pp,
    tc.pp        as this_pp,
    -- Was a comparison arrival explicitly chosen? Decides whether a missing
    -- previous cost means "first arrival" or "not on that shipment".
    exists (select 1 from compare_ship) as compared_explicitly,
    case when 'pack'   = any(k.sellable_units) then vs.selling_price_per_pack_mvr   end as price_unit,
    case when 'carton' = any(k.sellable_units) then vs.selling_price_per_carton_mvr end as price_carton,
    (k.fixed_price_per_pack_mvr is not null
      or k.fixed_price_per_carton_mvr is not null
      or k.fixed_selling_price_mvr is not null) as price_is_fixed,
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
  join public.brands b2           on b2.id = m.brand_id
  join public.product_categories pc on pc.id = m.category_id
  left join prev_cost pv on pv.sku_id = k.id
  left join stock st     on st.sku_id = k.id
  left join market mk    on mk.variant_id = k.variant_id
),
calc as (
  select bs.*,
    bs.prev_pp * bs.pcs_per_pack                       as prev_cost_unit,
    bs.prev_pp * bs.pcs_per_pack * bs.packs_per_carton as prev_cost_carton,
    bs.this_pp * bs.pcs_per_pack                       as this_cost_unit,
    bs.this_pp * bs.pcs_per_pack * bs.packs_per_carton as this_cost_carton,
    -- Margin is measured against the unit ACTUALLY SOLD (migration 0139).
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
    -- POINT. Where Ali set no fixed figure the price is derived from his target
    -- margin and the newest landed cost, so (today's price − old cost) is a
    -- margin that never existed. Say so instead of inventing one.
    case when c.ref_price > 0 then
      (c.ref_price - case when c.price_is_fixed then c.ref_prev_cost else c.ref_this_cost end)
        / c.ref_price
    end as margin_before,
    case when c.ref_price > 0 then (c.ref_price - c.ref_this_cost) / c.ref_price end as margin_now
  from calc c
),
suggested as (
  select s.*,
    case when s.price_is_fixed and s.margin_before > 0 and s.margin_before < 1 and s.sells_pack
         then public.price_point(s.this_pp * s.pcs_per_pack / (1 - s.margin_before)) end as sug_unit,
    case when s.price_is_fixed and s.margin_before > 0 and s.margin_before < 1 and s.sells_carton
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
  -- ── THE VERDICT ────────────────────────────────────────────────────────
  -- Ordered most-serious first, because more than one can be true at once and
  -- Ali should be told the worst one.
  case
    when g.ref_price is null or g.ref_price <= 0            then 'no_price'
    -- Absent from the shipment he chose to compare against is a DIFFERENT
    -- fact from never having arrived before, and saying the second when the
    -- first is true reads as "this product is new", which it is not.
    when g.prev_pp is null and g.compared_explicitly        then 'not_compared'
    when g.prev_pp is null                                  then 'first_arrival'
    when g.margin_now <= 0                                  then 'below_cost'
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
-- Worst damage first, in RUFIYAA across the stock on hand — the money actually
-- at stake, not the biggest percentage on a product he holds three of.
order by
  case when g.margin_now is null then 0 else 1 end,
  greatest(coalesce(g.ref_this_cost - g.ref_prev_cost, 0), 0)
    * (g.pieces / greatest(case when g.sells_pack then g.pcs_per_pack
                                else g.pcs_per_pack * g.packs_per_carton end, 1)) desc,
  g.full_path;
$function$;

revoke execute on function public.get_price_review(uuid, uuid) from public, anon;
grant  execute on function public.get_price_review(uuid, uuid) to authenticated, service_role;

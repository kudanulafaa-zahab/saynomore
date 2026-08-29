-- 0219 — a rebuild must not drop the ratchet.
--
-- ── WHAT WENT WRONG, PLAINLY ────────────────────────────────────────────────
--
-- 0218 added the second argument to get_price_review so any two arrivals can
-- be compared. It was written by copying 0213's body and editing it — and
-- 0213 is three versions out of date. 0214 added the `repriced` verdict and
-- 0215 corrected its signal, and BOTH were silently discarded.
--
-- This is the exact failure CLAUDE.md names about get_today: *"a rebuild is
-- how 0209 lost 0188's work once already."* It happened again, and this time
-- it reached production, because migrations are applied the moment they are
-- written.
--
-- ── WHAT THE LOST WORK DOES, AND WHY IT IS NOT COSMETIC ─────────────────────
--
-- Without it the review NEVER FINISHES. Accepting a suggestion re-anchors
-- "the margin this price used to earn" on the price just set:
--
--     price 200 → accept 250 → (250 − 100) / 250 reads as 60%
--                → suggests 313 → accept → suggests 391 → ...
--
-- Nothing looks out of balance on screen. The row simply comes back, and each
-- tap talks Ali into a bigger rise than the last. On a screen whose whole job
-- is to tell him what to charge, that is a machine for overpricing his own
-- catalogue one tap at a time.
--
-- The anchor is one precise signal: set_selling_prices writes an audit_log row
-- with field_name 'selling_price', and nothing else writes that field_name. So
-- "has the price been set since this container landed?" is answerable exactly.
-- 0214 originally used `skus.updated_at`, and 0215 removed it because renaming
-- a product is not reviewing its price.
--
-- ── HOW THIS IS PREVENTED FROM HAPPENING A THIRD TIME ───────────────────────
--
-- The guard at the foot of this file asserts BOTH generations at once: the
-- arrival-comparison work from 0218 AND the ratchet from 0214/0215. Any future
-- rebuild that drops either half is refused at apply time rather than
-- discovered by a test — and the test that caught this one only caught it
-- because a SECOND defect had been masking it (the anon check was pinned to
-- the old one-argument signature, so the file aborted before reaching these
-- assertions at all).

create or replace function public.get_price_review(
  p_shipment_id         uuid default null,
  p_compare_shipment_id uuid default null
)
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
-- THE LATER ARRIVAL IS ALWAYS WHAT THE MONEY IS COMPUTED FROM (0218).
target as (
  select case when b_at > a_at then b_id  else a_id  end as id,
         case when b_at > a_at then b_ref else a_ref end as reference,
         case when b_at > a_at then b_at  else a_at  end as grn_confirmed_at,
         ((case when b_at > a_at then b_at else a_at end)
            at time zone 'Indian/Maldives')::date as received_on
    from pair
),
compare_ship as (
  select case when b_at > a_at then a_id  else b_id  end as id,
         case when b_at > a_at then a_ref else b_ref end as reference,
         case when b_at > a_at then a_at  else b_at  end as at
    from pair
   where b_id is not null
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
-- ── THE ANCHOR (0214, corrected by 0215, dropped by 0218, restored here).
-- Has this product's PRICE been set since the container landed? One signal,
-- and a precise one: set_selling_prices logs it and nothing else writes this
-- field_name. `skus.updated_at` was the 0214 signal and is deliberately gone,
-- because renaming a product is not reviewing its price.
reviewed as (
  select a2.record_id as sku_id
    from public.audit_log a2
   cross join target t
   where a2.table_name = 'skus'
     and a2.field_name = 'selling_price'
     and a2.created_at > t.grn_confirmed_at
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
    concat_ws(' › ', b2.name, m.name, v.display_name) as full_path,
    public.unit_noun(pc.unit_uom)          as noun,
    ('pack'   = any(k.sellable_units))     as sells_pack,
    ('carton' = any(k.sellable_units))     as sells_carton,
    k.pcs_per_pack, k.packs_per_carton, k.sellable_units, pc.unit_uom,
    t.reference  as this_reference,  t.received_on as this_received_on,
    pv.reference as prev_reference,  pv.received_on as prev_received_on,
    pv.pp        as prev_pp,
    tc.pp        as this_pp,
    (rv.sku_id is not null)                as already_reviewed,
    exists (select 1 from compare_ship)    as compared_explicitly,
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
  left join reviewed rv  on rv.sku_id = k.id
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
    -- A FLOATING PRICE DID NOT DRIFT — IT MOVED WITH THE COST. Where Ali set
    -- no fixed figure the price is derived from his target margin and the
    -- newest landed cost, so (today's price − old cost) is a margin that never
    -- existed. A REPRICED product is the same problem wearing a different hat:
    -- the price he just accepted was never charged against the old cost
    -- either. Both anchor on the cost that is actually current.
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
  -- ── THE VERDICT ────────────────────────────────────────────────────────
  -- Ordered most-serious first, because more than one can be true at once and
  -- Ali should be told the worst one.
  case
    when g.ref_price is null or g.ref_price <= 0            then 'no_price'
    -- Absent from the shipment he chose is a DIFFERENT fact from never having
    -- arrived before (0218).
    when g.prev_pp is null and g.compared_explicitly        then 'not_compared'
    when g.prev_pp is null                                  then 'first_arrival'
    when g.margin_now <= 0                                  then 'below_cost'
    -- THE RATCHET STOPS HERE (0214/0215). Ranked above auto_adjusted because
    -- a repriced product must be reported as settled even when its price is
    -- now floating.
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

revoke execute on function public.get_price_review(uuid, uuid) from public, anon;
grant  execute on function public.get_price_review(uuid, uuid) to authenticated, service_role;

-- ── PROVE BOTH GENERATIONS SURVIVED ─────────────────────────────────────────
-- The point of this block. 0218's guard asserted only 0218's own additions, so
-- it passed while quietly shipping a function with 0214 and 0215 missing. A
-- guard that only checks what its own migration added cannot catch a rebuild —
-- it has to assert everything the function is still expected to do.
do $$
declare
  v_src text := regexp_replace(
    pg_get_functiondef('public.get_price_review(uuid,uuid)'::regprocedure),
    '--[^\n]*', '', 'g');
begin
  -- 0218 — any two arrivals, put in date order.
  if v_src !~ 'compare_ship' then
    raise exception 'the review cannot be pointed at a chosen arrival (0218 lost)';
  end if;
  if v_src !~ 'not_compared' then
    raise exception 'a product absent from the chosen shipment would report first_arrival (0218 lost)';
  end if;
  if v_src !~ 'b_at > a_at' then
    raise exception 'the two arrivals are no longer put in date order (0218 lost)';
  end if;
  if to_regprocedure('public.get_price_review(uuid)') is not null then
    raise exception 'the one-argument twin is back -- two versions of one answer';
  end if;

  -- 0214/0215 — the ratchet. Three separate places, because dropping any one
  -- of them brings the endless rise back on its own.
  if v_src !~ 'already_reviewed' then
    raise exception 'a product already repriced would be offered a higher price again (0214 lost)';
  end if;
  if v_src !~ '''repriced''' then
    raise exception 'the review never reports itself finished for a product (0214 lost)';
  end if;
  if v_src !~ 'field_name = ''selling_price''' then
    raise exception 'the anchor is not the price-change log (0215 lost)';
  end if;
  -- 0215 removed this deliberately: renaming a product is not reviewing it.
  if v_src ~ 'updated_at > t\.grn_confirmed_at' then
    raise exception 'skus.updated_at is back as the review signal (0215 undone)';
  end if;

  if has_function_privilege('anon', 'public.get_price_review(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_arrivals()', 'execute') then
    raise exception 'anon can read the price review';
  end if;
end $$;

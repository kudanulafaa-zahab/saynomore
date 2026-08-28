-- 0213 — the price review that happens when a container lands.
--
-- Ali, 2026-08-27, the morning after SH-2026-002 was received:
--   *"My usd to MVR and freight have gone up. I have received the stock. For me
--    to set the selling price with the best profit how do I see it? Is there an
--    easy way? ... Also how do I know compared the 001 shipment price."*
--
-- ── THE ANSWER TO "HOW DO I SEE IT" WAS: YOU DON'T ──────────────────────────
--
-- SH-2026-002 landed on 2026-08-27. Against SH-2026-001 the same goods cost
-- MVR 5,979 more, and at unchanged prices the profit on the container falls
-- from about MVR 16,500 to MVR 10,500. Per pack, in his units:
--
--     Sosoft, every colour   22.16 → 33.14 a bottle   40% margin → 10%
--     Merries Good Skin L   127.87 → 164.88 a pack    36%        → 17%
--     X-Tra Kering L        117.17 → 147.81 a pack    41%        → 26%
--     X-Tra Kering XL       125.69 → 156.14 a pack    39%        → 25%
--
-- Margin Watch — the screen whose entire job is to catch this — said
-- **"No price is below cost."** True, and useless.
--
-- ── WHY THE EXISTING WARNING CANNOT FIRE, EVER ──────────────────────────────
--
-- get_pricing_health has two useful verdicts: `below_cost` (price under landed
-- cost) and `below_target` (price under `target_margin_pct`). A margin that
-- halves but stays positive is neither, unless a target margin is set.
--
-- A target margin is set on 2 SKUs out of 36. And here is the trap: v_skus
-- DERIVES the selling price from the target margin whenever no fixed price
-- exists. So the only SKUs that can be measured against a target are the ones
-- whose price is computed from that target — and those can never fall below
-- it. **`below_target` is structurally dead.** It is not that nobody set the
-- targets; it is that setting one moves the SKU out of the warning's reach.
--
-- ── THE CONTROLLED EXPERIMENT ALREADY IN HIS DATA ───────────────────────────
--
-- MamyPoko X-Tra Kering NB/S rode the same container, took the same 28% cost
-- rise, and held 44.9% margin — its price moved from about MVR 170 to MVR 218
-- a pack by itself, because it is one of the two SKUs with a target margin and
-- no fixed price. Every other product kept the price Ali typed once and paid
-- for the freight out of its margin.
--
-- So the doctrine is not new, it is demonstrated: **price off what it costs to
-- REPLACE the stock, not what it cost to buy it.** The old cheap Sosoft still
-- in the godown sells at a paper profit that can no longer buy the next bottle.
--
-- ── WHAT THIS MIGRATION ADDS ────────────────────────────────────────────────
--
--   get_price_review(shipment)   one row per product that landed: what it cost
--                                on the PREVIOUS arrival (named and dated),
--                                what it costs now, the price today, what that
--                                price earns now, and the price that restores
--                                the margin it used to earn — per pack AND per
--                                carton, in the product's own unit noun.
--
--   set_selling_prices(...)      the writer. Fixed prices are Ali's; nothing
--                                moves without a tap, below cost needs an
--                                explicit flag, every change is audit-logged.
--
-- ── AND IT CHECKS THE MARKET BEFORE IT OPENS ITS MOUTH ──────────────────────
--
-- Restoring a margin percentage is arithmetic. Whether the price is SELLABLE is
-- not, and a screen that suggests a number above what the shops charge is worse
-- than one that suggests nothing. Every suggestion is therefore compared with
-- the cheapest competitor price on record, converted to Ali's own pack size,
-- and a suggestion that lands above the market is labelled `capped_by_market`
-- rather than presented as an answer.
--
-- This is not hypothetical. On the two diapers the market has room —
-- X-Tra Kering L restores at MVR 255 against VB's MVR 269, XL at MVR 260
-- against VB's MVR 324, so putting the margin back still leaves him the
-- cheapest. On Sosoft it does not: Ali reports the shops at MVR 36 a bottle
-- against his 37, so the MVR 60 that restores 40% is unsellable and the honest
-- verdict is that this container's freight, not the product, is the problem.
--
-- ── ONE MORE THING THE COMPARISON MUST NOT DO ───────────────────────────────
--
-- "Previous cost" is the newest arrival BEFORE this one — not an average over
-- all history. Freight and forex are volatile and every shipment stands alone
-- (CLAUDE.md); the question being answered is "what changed since the price was
-- last sensible", and that is one step, not a trend. Direct receipts count as
-- arrivals too, labelled as such.

-- ═══════════════════════════════════════════════════════════════════════════
-- A price point, not a raw quotient.
-- ═══════════════════════════════════════════════════════════════════════════
-- Always rounds UP, so a suggestion can never land under the margin it claims
-- to restore. Whole rufiyaa below MVR 100 (a bottle at 34, not 35), nearest 5
-- above it (a pack at 255, not 251) — the granularity Ali already prices at.
create or replace function public.price_point(p_value numeric)
returns numeric
language sql
immutable
set search_path to ''
as $function$
  select case
           when p_value is null or p_value <= 0 then null
           when p_value < 100 then ceil(p_value)
           else ceil(p_value / 5.0) * 5
         end;
$function$;

revoke execute on function public.price_point(numeric) from public, anon;
grant  execute on function public.price_point(numeric) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- get_price_review
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists public.get_price_review(uuid);

create or replace function public.get_price_review(p_shipment_id uuid default null)
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
  -- Rufiyaa first, percentages second (skills.md Seat 4). What one sale earns
  -- today, and how much of that the new cost took.
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
-- What it cost on the arrival BEFORE this one. Newest first, one row, and a
-- direct receipt counts — it is still stock that landed at a price.
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
    concat_ws(' › ', b.name, m.name, v.display_name) as full_path,
    public.unit_noun(pc.unit_uom)          as noun,
    ('pack'   = any(k.sellable_units))     as sells_pack,
    ('carton' = any(k.sellable_units))     as sells_carton,
    k.pcs_per_pack, k.packs_per_carton, k.sellable_units, pc.unit_uom,
    t.reference  as this_reference,  t.received_on as this_received_on,
    pv.reference as prev_reference,  pv.received_on as prev_received_on,
    pv.pp        as prev_pp,
    tc.pp        as this_pp,
    -- The price as the app would quote it today: the fixed figure when Ali set
    -- one, otherwise the one derived from his target margin. Never offer a
    -- price on a unit the SKU does not sell.
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
  join public.brands b            on b.id = m.brand_id
  join public.product_categories pc on pc.id = m.category_id
  left join prev_cost pv on pv.sku_id = k.id
  left join stock st     on st.sku_id = k.id
  left join market mk    on mk.variant_id = k.variant_id
),
-- Everything below is arithmetic on `base`, named once so the verdict and the
-- suggestion cannot disagree about which number they are looking at.
calc as (
  select bs.*,
    bs.prev_pp * bs.pcs_per_pack                       as prev_cost_unit,
    bs.prev_pp * bs.pcs_per_pack * bs.packs_per_carton as prev_cost_carton,
    bs.this_pp * bs.pcs_per_pack                       as this_cost_unit,
    bs.this_pp * bs.pcs_per_pack * bs.packs_per_carton as this_cost_carton,
    -- Margin is measured against the unit ACTUALLY SOLD (migration 0139): the
    -- smaller selling unit when there is one, the carton when there is not.
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
    -- POINT. Where Ali set no fixed figure, v_skus derives the price from his
    -- target margin and the newest landed cost, so today's price was never
    -- charged against the old cost and (today's price − old cost) is a margin
    -- that never existed. X-Tra Kering NB/S is the live case: comparing its new
    -- MVR 218 pack price against SH-2026-001's MVR 93.66 cost invents a 57%
    -- margin it never earned, and would then "restore" it by pushing the price
    -- to MVR 279. Its margin did not move at all. Say so.
    case when c.ref_price > 0 then
      (c.ref_price - case when c.price_is_fixed then c.ref_prev_cost else c.ref_this_cost end)
        / c.ref_price
    end as margin_before,
    case when c.ref_price > 0 then (c.ref_price - c.ref_this_cost) / c.ref_price end as margin_now
  from calc c
),
suggested as (
  select s.*,
    -- The price that puts the OLD margin back. Only meaningful while that
    -- margin was positive: restoring a loss is not a suggestion.
    case when s.price_is_fixed and s.margin_before > 0 and s.margin_before < 1 and s.sells_pack
         then public.price_point(s.this_pp * s.pcs_per_pack / (1 - s.margin_before)) end as sug_unit,
    case when s.price_is_fixed and s.margin_before > 0 and s.margin_before < 1 and s.sells_carton
         then public.price_point(s.this_pp * s.pcs_per_pack * s.packs_per_carton / (1 - s.margin_before)) end as sug_carton,
    -- The market, converted to Ali's own pack size so the two numbers are
    -- comparable at a glance.
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
    when g.prev_pp is null                                  then 'first_arrival'
    when g.margin_now <= 0                                  then 'below_cost'
    -- It looked after itself. The one behaviour worth copying, so it is named
    -- rather than hidden among the products that need nothing done.
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

revoke execute on function public.get_price_review(uuid) from public, anon;
grant  execute on function public.get_price_review(uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- set_selling_prices — the writer, with the guard on it
-- ═══════════════════════════════════════════════════════════════════════════
-- Prices have been written by a plain UPDATE from the Products dialog since the
-- beginning, which means the below-cost guard (hard rule 7 — "losing money is a
-- decision, never an accident") lives only in whichever screen remembers it.
-- The price review is a NEW door onto the same money, so it gets the guard in
-- Postgres where no screen can forget it.
drop function if exists public.set_selling_prices(uuid, numeric, numeric, boolean, text);

create or replace function public.set_selling_prices(
  p_sku_id           uuid,
  p_price_unit       numeric default null,
  p_price_carton     numeric default null,
  p_allow_below_cost boolean default false,
  p_reason           text    default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sku    public.skus%rowtype;
  v_landed numeric;
  v_noun   text;
  v_old_u  numeric;
  v_old_c  numeric;
begin
  select * into v_sku from public.skus where id = p_sku_id;
  if not found then
    raise exception 'No such product';
  end if;

  if p_price_unit is null and p_price_carton is null then
    raise exception 'Nothing to set — give a price for at least one selling unit';
  end if;

  -- NEVER OFFER — OR ACCEPT — A UNIT THE SKU DOES NOT SELL. Same guard the
  -- sale sheets carry; a writer that accepts a carton price for a pack-only
  -- product would put a number on screen that can never be charged.
  if p_price_unit is not null and not ('pack' = any(v_sku.sellable_units)) then
    raise exception 'This product is not sold by the single unit';
  end if;
  if p_price_carton is not null and not ('carton' = any(v_sku.sellable_units)) then
    raise exception 'This product is not sold by the carton';
  end if;

  select public.unit_noun(pc.unit_uom) into v_noun
    from public.variants v
    join public.product_models m      on m.id = v.model_id
    join public.product_categories pc on pc.id = m.category_id
   where v.id = v_sku.variant_id;

  -- The cost this price has to beat is the cost of REPLACING the stock: the
  -- newest arrival, in stock or not. Pricing off an older, cheaper batch is
  -- exactly the mistake this migration exists to stop.
  select ib.landed_per_piece_mvr into v_landed
    from public.inventory_batches ib
   where ib.sku_id = p_sku_id and ib.landed_per_piece_mvr is not null
   order by ib.received_at desc
   limit 1;

  if v_landed is not null and not p_allow_below_cost then
    if p_price_unit is not null and p_price_unit < v_landed * v_sku.pcs_per_pack then
      raise exception 'MVR % per % is below what it costs you (MVR %). Confirm the loss to set it anyway.',
        round(p_price_unit, 2), v_noun, round(v_landed * v_sku.pcs_per_pack, 2);
    end if;
    if p_price_carton is not null
       and p_price_carton < v_landed * v_sku.pcs_per_pack * v_sku.packs_per_carton then
      raise exception 'MVR % per carton is below what it costs you (MVR %). Confirm the loss to set it anyway.',
        round(p_price_carton, 2),
        round(v_landed * v_sku.pcs_per_pack * v_sku.packs_per_carton, 2);
    end if;
  end if;

  v_old_u := v_sku.fixed_price_per_pack_mvr;
  v_old_c := v_sku.fixed_price_per_carton_mvr;

  update public.skus set
    fixed_price_per_pack_mvr   = coalesce(p_price_unit,   fixed_price_per_pack_mvr),
    fixed_price_per_carton_mvr = coalesce(p_price_carton, fixed_price_per_carton_mvr),
    updated_at = now()
  where id = p_sku_id;

  insert into public.audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  values ('skus', p_sku_id, 'update', 'selling_price',
          format('%s/%s, %s/carton', coalesce(v_old_u::text, '—'), v_noun, coalesce(v_old_c::text, '—')),
          format('%s/%s, %s/carton',
                 coalesce(coalesce(p_price_unit,   v_old_u)::text, '—'), v_noun,
                 coalesce(coalesce(p_price_carton, v_old_c)::text, '—')),
          coalesce(p_reason, 'Price review')
            || case when p_allow_below_cost then ' — set BELOW COST deliberately' else '' end
            || case when v_landed is not null
                    then format(' (landed MVR %s per %s)', round(v_landed * v_sku.pcs_per_pack, 2), v_noun)
                    else '' end,
          (select auth.uid()));
end $function$;

revoke execute on function public.set_selling_prices(uuid, numeric, numeric, boolean, text) from public, anon;
grant  execute on function public.set_selling_prices(uuid, numeric, numeric, boolean, text) to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_anon boolean;
  v_src  text := pg_get_functiondef('public.get_price_review(uuid)'::regprocedure);
begin
  if v_src !~ 'capped_by_market' then
    raise exception 'the review can suggest a price without checking what the shops charge';
  end if;
  if v_src !~ 'unit_noun' then
    raise exception 'the review would have to guess the unit word';
  end if;

  -- Rounding always goes UP, or a "restored" margin quietly comes back short.
  if public.price_point(251.03) <> 255 then
    raise exception 'price_point rounded a 251.03 suggestion to % instead of 255', public.price_point(251.03);
  end if;
  if public.price_point(33.2) <> 34 then
    raise exception 'price_point rounded a small unit price to % instead of 34', public.price_point(33.2);
  end if;

  foreach v_anon in array array[
    has_function_privilege('anon', 'public.get_price_review(uuid)', 'execute'),
    has_function_privilege('anon', 'public.set_selling_prices(uuid,numeric,numeric,boolean,text)', 'execute'),
    has_function_privilege('anon', 'public.price_point(numeric)', 'execute')
  ] loop
    if v_anon then raise exception 'anon can execute one of the new price functions'; end if;
  end loop;
end $$;

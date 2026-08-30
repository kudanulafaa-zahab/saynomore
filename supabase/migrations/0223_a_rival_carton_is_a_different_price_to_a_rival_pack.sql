-- 0223 — a rival's carton price is a DIFFERENT price, not a cheaper pack.
--
-- Ali, 2026-08-30:
--   *"In prices/market/competitors I should be able to add competitor carton
--    prices too since they also offer discount on cartons sales. Right now it
--    only adds the packs price. It must also know how many packs in a carton
--    for competitor since it can vary from ours."*
--
-- ── WHAT WAS ACTUALLY THERE, BECAUSE IT IS NOT WHAT IT LOOKED LIKE ─────────
--
-- The sheet DOES already offer "Per carton". What it never asks is how their
-- carton is BUILT. There is one number field, `their_pcs_per_pack`, and it
-- silently changes meaning with the basis pill:
--
--   per_pack    -> pieces in one of their packs      (34)
--   per_carton  -> pieces in one of their cartons    (102)
--
-- So a rival carton of 3 packs of 34 was flattened to "102" and the pack
-- structure — the thing Ali is asking to record — was lost. Worse, one column
-- meaning two things is a trap for every reader: four separate places convert
-- these prices to per-piece, and they do not agree.
--
--   get_competitor_price_gaps         divides by pcs_per_pack OR pcs_per_carton
--   get_competitor_reference_prices   same, duplicated
--   get_product_card                  divides by their_pcs_per_pack ALWAYS
--   competitors-view.tsx              same CASE, written twice in TypeScript
--
-- The third one is already wrong. It applies the pack divisor to every basis,
-- so a per_piece row reads far too cheap and a per_100ml row is nonsense. It
-- has never misfired only because all 12 rows on production today are
-- per_pack. The moment Ali logs the carton price he is asking for, the Product
-- Card's rival figure goes wrong — silently, on the screen built to be the one
-- trustworthy summary of a product.
--
-- ── THE FIX HAS THREE PARTS ────────────────────────────────────────────────
--
-- 1. `their_pcs_per_pack` now means pieces in one of their PACKS. Always. One
--    column, one meaning. New `their_packs_per_carton` carries the rest, so a
--    rival carton is recorded the way Ali describes it: 3 packs of 34.
--    Nothing to backfill — every existing row is per_pack.
--
-- 2. ONE conversion, in `v_competitor_price_normalized`. Every consumer reads
--    it. Four copies of a rule is four chances to be the wrong one, and we
--    already had a wrong one.
--
-- 3. LIKE FOR LIKE, which is the part that matters most and the part nobody
--    asked for. Every consumer took the CHEAPEST rival price regardless of
--    basis. A carton is discounted per piece by definition — so the first
--    carton price logged would win everywhere, and the app would start
--    comparing Ali's PACK price against a rival's CARTON rate. His margin
--    would read worse than it is and the Promo Advisor would push him to cut a
--    price that did not need cutting.
--
--    A shelf price and a carton rate are two prices for two buyers: a shopper
--    buying one pack, and a shop buying a case. Standard retail-buying
--    practice compares shelf to shelf and case to case. So the view carries
--    `buys_like` ('shelf' | 'carton') and every consumer picks its own side.
--    The headline "what rivals charge" stays the SHELF price, because that is
--    what Ali's customer sees when they choose between him and the shop next
--    door.
--
-- ── per_100ml AND per_100g ARE LEFT ALONE, DELIBERATELY ────────────────────
--
-- They stay in the basis list (Ali, 2026-08-30: he has not logged competitor
-- prices for many SKUs yet and may want them). They still normalise to NULL,
-- because they CANNOT be converted: nothing in this database records how many
-- millilitres are in one of our bottles. `product_categories.unit_uom` says
-- 'ml' for Sosoft but carries no number, and `skus` has no size column at all.
-- Switching them on needs one figure per product, entered in Products — a
-- separate change with its own screen. What this migration does add is that a
-- price which cannot be compared is now VISIBLE as such (`price_per_piece` is
-- null and `buys_like` says 'uncomparable') instead of vanishing from every
-- screen with no trace.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. THEIR CARTON, RECORDED THE WAY HE DESCRIBES IT
-- ══════════════════════════════════════════════════════════════════════════

alter table public.competitor_prices
  add column if not exists their_packs_per_carton integer;

comment on column public.competitor_prices.their_pcs_per_pack is
  'Pieces in ONE of THEIR packs. Always pack-level, never carton-level — it '
  'used to mean pieces-per-carton on a per_carton row, which lost the pack '
  'structure and made one column mean two things (0223).';

comment on column public.competitor_prices.their_packs_per_carton is
  'Packs in ONE of THEIR cartons. Theirs can differ from ours: a rival may '
  'sell 3 packs of 34 where we sell 4 packs of 22 (0223).';

-- A conversion cannot be guessed. The old code fell back to OUR pack size
-- when theirs was blank, which is invisible on screen and produced a rival
-- price that looked authoritative and was not. Blank is now refused at the
-- door, for the basis that needs it.
alter table public.competitor_prices
  drop constraint if exists competitor_prices_pack_size_chk;
alter table public.competitor_prices
  add  constraint competitor_prices_pack_size_chk check (
    price_basis <> 'per_pack'
    or (their_pcs_per_pack is not null and their_pcs_per_pack > 0)
  );

alter table public.competitor_prices
  drop constraint if exists competitor_prices_carton_size_chk;
alter table public.competitor_prices
  add  constraint competitor_prices_carton_size_chk check (
    price_basis <> 'per_carton'
    or (their_pcs_per_pack      is not null and their_pcs_per_pack      > 0
    and their_packs_per_carton  is not null and their_packs_per_carton  > 0)
  );

-- ══════════════════════════════════════════════════════════════════════════
-- 2. THE CURRENT-PRICE VIEW CARRIES THE NEW COLUMN
-- ══════════════════════════════════════════════════════════════════════════
-- their_packs_per_carton joins the DISTINCT ON key for the same reason
-- their_pcs_per_pack is in it: two observations of genuinely different pack
-- formats are two facts, not one fact superseding another.
--
-- It is APPENDED, not slotted in beside their_pcs_per_pack where it belongs
-- by meaning. CREATE OR REPLACE VIEW may only add columns at the END — a view
-- with a column inserted mid-list is rejected outright, and the alternative
-- (drop and recreate) would cascade through every dependent. Position is
-- cosmetic; the cascade is not.

create or replace view public.v_competitor_prices_current
with (security_invoker = on) as
  select distinct on (competitor_id, variant_id, price_basis, their_pcs_per_pack, their_packs_per_carton)
    id, competitor_id, variant_id,
    their_pcs_per_pack,
    their_unit_size, their_unit_uom,
    price_mvr, price_basis, observed_date, notes, created_at,
    their_packs_per_carton
  from public.competitor_prices cp
  order by competitor_id, variant_id, price_basis, their_pcs_per_pack, their_packs_per_carton,
           observed_date desc, created_at desc;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. ONE CONVERSION, AND ONE PLACE THAT SAYS WHICH BUYER A PRICE IS FOR
-- ══════════════════════════════════════════════════════════════════════════

create or replace view public.v_competitor_price_normalized
with (security_invoker = on) as
  select
    cp.id,
    cp.competitor_id,
    c.name as competitor_name,
    cp.variant_id,
    cp.price_mvr,
    cp.price_basis,
    cp.observed_date,
    cp.their_pcs_per_pack,
    cp.their_packs_per_carton,
    -- WHICH BUYER THIS PRICE IS FOR. Never compare across this line.
    case
      when cp.price_basis = 'per_carton'              then 'carton'
      when cp.price_basis in ('per_piece','per_pack') then 'shelf'
      else 'uncomparable'   -- per_100ml / per_100g — see the header
    end as buys_like,
    case cp.price_basis
      when 'per_piece'  then cp.price_mvr
      when 'per_pack'   then cp.price_mvr / nullif(cp.their_pcs_per_pack, 0)
      when 'per_carton' then cp.price_mvr
                             / nullif(cp.their_pcs_per_pack * cp.their_packs_per_carton, 0)
      else null
    end as price_per_piece
  from public.v_competitor_prices_current cp
  join public.competitors c on c.id = cp.competitor_id;

comment on view public.v_competitor_price_normalized is
  'The ONE place a competitor price becomes a per-piece number. Read this; '
  'never re-derive it. buys_like separates a shelf price from a carton rate — '
  'a carton is discounted per piece, so mixing them makes our margin read '
  'worse than it is (0223).';

grant select on public.v_competitor_price_normalized to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. PRICE GAPS — SHELF AGAINST SHELF
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.get_competitor_price_gaps(p_threshold_pct numeric default 10)
returns table(
  sku_id uuid, brand_name text, model_name text, variant_display text,
  internal_code text, our_price_mvr numeric, cheapest_competitor_mvr numeric,
  cheapest_competitor_name text, gap_pct numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with cheapest as (
    -- SHELF ONLY. Our per-piece selling price is derived from the pack Ali
    -- sells on the shelf, so the only fair opposite number is the pack a
    -- shopper buys from them.
    select distinct on (n.variant_id)
      n.variant_id, n.competitor_name, n.price_per_piece
    from public.v_competitor_price_normalized n
    where n.buys_like = 'shelf' and n.price_per_piece is not null
    order by n.variant_id, n.price_per_piece asc, n.observed_date desc
  )
  select
    vs.id, vs.brand_name, vs.model_name, vs.variant_display, vs.internal_code,
    vs.selling_price_per_piece_mvr,
    ch.price_per_piece,
    ch.competitor_name,
    round((vs.selling_price_per_piece_mvr - ch.price_per_piece)
          / nullif(ch.price_per_piece, 0) * 100, 1) as gap_pct
  from cheapest ch
  join public.v_skus vs on vs.variant_id = ch.variant_id
  where vs.selling_price_per_piece_mvr is not null
    and (vs.selling_price_per_piece_mvr - ch.price_per_piece)
        / nullif(ch.price_per_piece, 0) * 100 > p_threshold_pct
  order by gap_pct desc;
$function$;

revoke execute on function public.get_competitor_price_gaps(numeric) from public, anon;
grant  execute on function public.get_competitor_price_gaps(numeric) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. REFERENCE PRICES — BOTH SIDES, NAMED
-- ══════════════════════════════════════════════════════════════════════════
-- Used by the costing simulator to answer "what does this category sell for
-- out there". It returned one cheapest price and three columns derived from
-- it, so a carton rate arriving would have quietly restated the whole
-- category's shelf price. Shelf and carton are now separate columns, each
-- from its own side of the line, and either may be null.
--
-- Dropped first, not replaced: the OUT columns change, and Postgres refuses
-- CREATE OR REPLACE when the row type moves. Nothing else depends on it (it is
-- called from the costing simulator through PostgREST), so the drop is safe —
-- but it is why this one is a DROP and the others are not.

drop function if exists public.get_competitor_reference_prices(uuid, integer, integer);

create or replace function public.get_competitor_reference_prices(
  p_category_id uuid, p_pcs_per_pack integer, p_packs_per_carton integer
)
returns table(
  variant_id uuid, brand_name text, model_name text, variant_display text,
  competitor_name text,
  price_per_piece_mvr numeric, price_per_pack_mvr numeric, price_per_carton_mvr numeric,
  carton_competitor_name text, carton_price_per_piece_mvr numeric,
  carton_price_per_carton_mvr numeric, carton_observed_date date,
  observed_date date
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with in_category as (
    select distinct variant_id, brand_name, model_name, variant_display
    from public.v_skus
    where category_id = p_category_id
  ),
  priced as (
    select n.*
    from public.v_competitor_price_normalized n
    join in_category p on p.variant_id = n.variant_id
    where n.price_per_piece is not null
  ),
  shelf as (
    select distinct on (variant_id) variant_id, competitor_name, price_per_piece, observed_date
    from priced where buys_like = 'shelf'
    order by variant_id, price_per_piece asc, observed_date desc
  ),
  carton as (
    select distinct on (variant_id) variant_id, competitor_name, price_per_piece, observed_date
    from priced where buys_like = 'carton'
    order by variant_id, price_per_piece asc, observed_date desc
  )
  select
    p.variant_id, p.brand_name, p.model_name, p.variant_display,
    sh.competitor_name,
    round(sh.price_per_piece, 4),
    round(sh.price_per_piece * greatest(p_pcs_per_pack, 1), 2),
    round(sh.price_per_piece * greatest(p_pcs_per_pack, 1) * greatest(p_packs_per_carton, 1), 2),
    ct.competitor_name,
    round(ct.price_per_piece, 4),
    round(ct.price_per_piece * greatest(p_pcs_per_pack, 1) * greatest(p_packs_per_carton, 1), 2),
    ct.observed_date,
    sh.observed_date
  from in_category p
  left join shelf  sh on sh.variant_id = p.variant_id
  left join carton ct on ct.variant_id = p.variant_id
  where sh.variant_id is not null or ct.variant_id is not null
  order by p.brand_name, p.model_name, p.variant_display;
$function$;

revoke execute on function public.get_competitor_reference_prices(uuid, integer, integer) from public, anon;
grant  execute on function public.get_competitor_reference_prices(uuid, integer, integer) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. THE PRODUCT CARD — THE COPY THAT WAS ALREADY WRONG
-- ══════════════════════════════════════════════════════════════════════════
-- Only the `rival` CTE and the two rival blocks of the JSON change. Everything
-- else is reproduced verbatim from the live definition so a rebuild cannot
-- quietly drop a fact the card already showed.

create or replace function public.get_product_card(p_sku_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
with sku as (select * from public.v_skus where id = p_sku_id),
last_grn as (
  select sl.*, sh.reference, sh.grn_confirmed_at, sh.rate_idr_to_mvr, sh.rate_usd_to_mvr
  from public.shipment_lines sl join public.shipments sh on sh.id = sl.shipment_id
  where sl.sku_id = p_sku_id and sh.status = 'grn_confirmed'
  order by sh.grn_confirmed_at desc limit 1),
incoming as (
  select sl.qty_cartons, sl.fob_per_carton, sl.fob_currency, sh.reference,
         sh.expected_arrival_date, sh.status, sh.rate_idr_to_mvr, sh.rate_usd_to_mvr
  from public.shipment_lines sl join public.shipments sh on sh.id = sl.shipment_id
  where sl.sku_id = p_sku_id and sh.status <> 'grn_confirmed'
  order by sh.expected_arrival_date nulls last limit 1),
stock as (select coalesce(sum(qty_pieces),0)::numeric as pcs from public.v_stock_levels where sku_id = p_sku_id),
stock_by_godown as (
  select jsonb_agg(jsonb_build_object('godown', g.name, 'pieces', l.qty_pieces) order by l.qty_pieces desc) as rows
  from public.v_stock_levels l join public.godowns g on g.id = l.godown_id
  where l.sku_id = p_sku_id and l.qty_pieces <> 0),
sales as (
  select count(distinct l.order_id) as orders, count(distinct o.customer_id) as customers,
         coalesce(sum(l.qty_pieces),0)::numeric as pcs_sold,
         coalesce(sum(l.line_total_mvr),0)::numeric as revenue_mvr,
         coalesce(sum(l.line_total_mvr - l.qty_pieces * coalesce(l.landed_cost_per_piece_mvr,0)),0)::numeric as gross_profit_mvr,
         max(o.created_at) as last_sold_at
  from public.sales_order_lines l join public.sales_orders o on o.id = l.order_id
  where l.sku_id = p_sku_id and o.status in ('confirmed','out_for_delivery','delivered')),
-- WAS: price_mvr / their_pcs_per_pack, applied to EVERY basis. Correct only
-- while every row happened to be a pack price.
rival as (
  select n.competitor_name as competitor, n.price_mvr as their_price_mvr,
         n.their_pcs_per_pack, n.observed_date, n.price_per_piece as their_per_piece
  from public.v_competitor_price_normalized n
  join sku s on s.variant_id = n.variant_id
  where n.buys_like = 'shelf' and n.price_per_piece is not null
  order by n.price_per_piece asc, n.observed_date desc limit 1),
rival_carton as (
  select n.competitor_name as competitor, n.price_mvr as their_price_mvr,
         n.their_pcs_per_pack, n.their_packs_per_carton, n.observed_date,
         n.price_per_piece as their_per_piece
  from public.v_competitor_price_normalized n
  join sku s on s.variant_id = n.variant_id
  where n.buys_like = 'carton' and n.price_per_piece is not null
  order by n.price_per_piece asc, n.observed_date desc limit 1)
select jsonb_build_object(
  'sku_id', s.id, 'internal_code', s.internal_code, 'brand', s.brand_name, 'model', s.model_name,
  'variant', s.variant_display, 'category', s.category_name, 'is_active', s.is_active,
  'unit_noun', public.unit_noun(s.unit_uom), 'sellable_units', s.sellable_units,
  'pack', jsonb_build_object('pcs_per_pack', s.pcs_per_pack, 'packs_per_carton', s.packs_per_carton,
    'length_cm', s.carton_length_cm, 'width_cm', s.carton_width_cm, 'height_cm', s.carton_height_cm,
    'cbm_per_carton', s.cbm_per_carton, 'duty_rate_pct', s.duty_rate_pct),
  'cost', case when lg.id is null then null else jsonb_build_object(
    'shipment_ref', lg.reference, 'received_at', lg.grn_confirmed_at, 'qty_cartons', lg.qty_cartons,
    'fob_currency', lg.fob_currency, 'fob_per_carton', lg.fob_per_carton,
    'fx_rate', case lg.fob_currency when 'IDR' then lg.rate_idr_to_mvr when 'USD' then lg.rate_usd_to_mvr end,
    'fob_mvr', lg.fob_total_mvr, 'freight_mvr', lg.apportioned_freight_mvr,
    'local_mvr', lg.apportioned_local_mvr, 'duty_mvr', lg.apportioned_duty_mvr,
    'landed_total_mvr', lg.landed_total_mvr, 'per_carton_mvr', lg.landed_per_carton_mvr,
    'per_pack_mvr', lg.landed_per_pack_mvr, 'per_piece_mvr', lg.landed_per_piece_mvr) end,
  'price', jsonb_build_object('per_pack_mvr', s.selling_price_per_pack_mvr,
    'per_carton_mvr', s.selling_price_per_carton_mvr, 'pack_cost_mvr', lg.landed_per_pack_mvr,
    'carton_cost_mvr', lg.landed_per_carton_mvr,
    'pack_profit_mvr', round(s.selling_price_per_pack_mvr - lg.landed_per_pack_mvr, 2),
    'carton_profit_mvr', round(s.selling_price_per_carton_mvr - lg.landed_per_carton_mvr, 2),
    'pack_margin_pct', round((s.selling_price_per_pack_mvr - lg.landed_per_pack_mvr) / nullif(s.selling_price_per_pack_mvr,0) * 100, 1),
    'carton_margin_pct', round((s.selling_price_per_carton_mvr - lg.landed_per_carton_mvr) / nullif(s.selling_price_per_carton_mvr,0) * 100, 1),
    'carton_discount_mvr', round(s.selling_price_per_pack_mvr * s.packs_per_carton - s.selling_price_per_carton_mvr, 2)),
  'stock', jsonb_build_object('pieces', st.pcs, 'by_godown', coalesce(sbg.rows,'[]'::jsonb), 'in_stock', st.pcs > 0),
  'incoming', case when inc.reference is null then null else jsonb_build_object(
    'shipment_ref', inc.reference, 'status', inc.status, 'qty_cartons', inc.qty_cartons,
    'expected_date', inc.expected_arrival_date, 'fob_currency', inc.fob_currency,
    'fob_per_carton', inc.fob_per_carton,
    'fx_rate', case inc.fob_currency when 'IDR' then inc.rate_idr_to_mvr when 'USD' then inc.rate_usd_to_mvr end,
    'fob_mvr_per_carton', round(inc.fob_per_carton * case inc.fob_currency when 'IDR' then inc.rate_idr_to_mvr when 'USD' then inc.rate_usd_to_mvr else 1 end, 2),
    'last_fob_mvr_per_carton', round(lg.fob_per_carton * case lg.fob_currency when 'IDR' then lg.rate_idr_to_mvr when 'USD' then lg.rate_usd_to_mvr else 1 end, 2)) end,
  'sales', jsonb_build_object('orders', sa.orders, 'customers', sa.customers,
    'packs_sold', round(sa.pcs_sold / nullif(s.pcs_per_pack,0), 1),
    'revenue_mvr', round(sa.revenue_mvr,2), 'gross_profit_mvr', round(sa.gross_profit_mvr,2),
    'last_sold_at', sa.last_sold_at),
  'rival', case when r.competitor is null then null else jsonb_build_object(
    'competitor', r.competitor, 'observed_date', r.observed_date,
    'days_old', ((now() at time zone 'Indian/Maldives')::date - r.observed_date),
    'their_pack_size', r.their_pcs_per_pack, 'their_price_mvr', r.their_price_mvr,
    'their_price_at_our_pack_size', round(r.their_per_piece * s.pcs_per_pack, 2),
    'our_price_mvr', s.selling_price_per_pack_mvr,
    'we_are_cheaper_by_mvr', round(r.their_per_piece * s.pcs_per_pack - s.selling_price_per_pack_mvr, 2),
    'we_are_cheaper_by_pct', round((r.their_per_piece * s.pcs_per_pack - s.selling_price_per_pack_mvr) / nullif(r.their_per_piece * s.pcs_per_pack,0) * 100, 1)) end,
  -- Their CARTON rate, against our carton price. Never netted against the
  -- shelf figure above and never allowed to replace it.
  'rival_carton', case when rc.competitor is null then null else jsonb_build_object(
    'competitor', rc.competitor, 'observed_date', rc.observed_date,
    'days_old', ((now() at time zone 'Indian/Maldives')::date - rc.observed_date),
    'their_pack_size', rc.their_pcs_per_pack,
    'their_packs_per_carton', rc.their_packs_per_carton,
    'their_price_mvr', rc.their_price_mvr,
    'their_price_at_our_carton_size', round(rc.their_per_piece * s.pcs_per_pack * s.packs_per_carton, 2),
    'our_price_mvr', s.selling_price_per_carton_mvr,
    'we_are_cheaper_by_mvr', round(rc.their_per_piece * s.pcs_per_pack * s.packs_per_carton - s.selling_price_per_carton_mvr, 2),
    'we_are_cheaper_by_pct', round((rc.their_per_piece * s.pcs_per_pack * s.packs_per_carton - s.selling_price_per_carton_mvr) / nullif(rc.their_per_piece * s.pcs_per_pack * s.packs_per_carton,0) * 100, 1)) end)
from sku s
left join last_grn lg on true left join incoming inc on true left join stock st on true
left join stock_by_godown sbg on true left join sales sa on true
left join rival r on true left join rival_carton rc on true;
$function$;

revoke execute on function public.get_product_card(uuid) from public, anon;
grant  execute on function public.get_product_card(uuid) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- PROVE IT LANDED
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_card  text := regexp_replace(pg_get_functiondef('public.get_product_card(uuid)'::regprocedure), '--[^\n]*', '', 'g');
  v_gaps  text := regexp_replace(pg_get_functiondef('public.get_competitor_price_gaps(numeric)'::regprocedure), '--[^\n]*', '', 'g');
  v_ref   text := regexp_replace(pg_get_functiondef('public.get_competitor_reference_prices(uuid,integer,integer)'::regprocedure), '--[^\n]*', '', 'g');
begin
  -- The four copies are gone: every consumer reads the one view.
  if v_card ~ 'their_pcs_per_pack,0\)' then
    raise exception 'the product card is still dividing by pack size on every basis';
  end if;
  if v_card !~ 'v_competitor_price_normalized' or v_gaps !~ 'v_competitor_price_normalized'
     or v_ref !~ 'v_competitor_price_normalized' then
    raise exception 'a consumer is still converting competitor prices for itself';
  end if;

  -- Like for like. A rebuild that dropped this reads as a small tidy-up and
  -- silently restores pack-vs-carton comparison.
  if v_gaps !~ 'buys_like = ''shelf''' or v_card !~ 'buys_like = ''shelf''' then
    raise exception 'a shelf comparison is no longer restricted to shelf prices';
  end if;
  if v_card !~ 'buys_like = ''carton''' or v_ref !~ 'buys_like = ''carton''' then
    raise exception 'the carton rate is no longer read as its own price';
  end if;

  -- The card kept everything it had.
  if v_card !~ 'carton_discount_mvr' or v_card !~ 'by_godown' or v_card !~ 'last_fob_mvr_per_carton' then
    raise exception 'the product card lost a fact in the rewrite';
  end if;

  -- A conversion is never guessed from our own pack size any more.
  if v_gaps ~ 'coalesce\(cp\.their_pcs_per_pack' or v_ref ~ 'coalesce\(cp\.their_pcs_per_pack' then
    raise exception 'a competitor price still falls back to our pack size';
  end if;

  if has_function_privilege('anon', 'public.get_product_card(uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_competitor_price_gaps(numeric)', 'execute')
     or has_function_privilege('anon', 'public.get_competitor_reference_prices(uuid,integer,integer)', 'execute') then
    raise exception 'anon can read competitor pricing';
  end if;
end $$;

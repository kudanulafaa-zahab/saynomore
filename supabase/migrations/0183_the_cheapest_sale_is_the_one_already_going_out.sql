-- 0183 — the cheapest sale is the one already going out the door.
--
-- The finding, from his own ledger on 2026-08-14: 55 customers buy nappies, 19
-- buy detergent, and NOT ONE buys both. Across 101 orders, not a single one
-- contains two categories. Every one of those detergent sales needed its own
-- conversation, its own delivery and its own trip.
--
-- A bottle added to a nappy order that is ALREADY being packed costs nothing to
-- win: no advertising, no new customer, no extra delivery run — and detergent
-- carries a higher margin than nappies. It is the cheapest revenue available in
-- this business and nothing in the app has ever mentioned it.
--
-- WHY POPULARITY AND NOT AFFINITY, which matters because affinity is what a
-- textbook would reach for. Market-basket analysis ranks "people who bought A
-- also bought B" — and here the co-occurrence matrix is EMPTY. Zero orders
-- contain both categories, so every affinity score would be zero and the
-- ranking would be noise dressed as intelligence. Until baskets actually mix,
-- the honest proxy is "what do most people buy", which is a real signal from
-- real orders. When overlap exists this function should be revisited; the
-- comment is here so the next reader knows it was a decision, not an oversight.
--
-- THE RULES IT WILL NOT BREAK, each one already law somewhere in this app:
--
--   * Only a category the customer has NEVER bought. Suggesting more of what
--     they already buy is not cross-sell, it is a reorder nudge, and that
--     already exists (get_customer_insights, 0151).
--   * Only stock in THE SAME WAREHOUSE the order ships from. The entire economic
--     argument is that it travels in a box already going out; a bottle in the
--     other godown is a second delivery and the saving disappears.
--   * Never a discontinued range (0180). Winning someone onto a line that will
--     not be restocked is worse than not winning them.
--   * Never below cost. Losing money is a decision, never an accident — and a
--     suggestion the app volunteers is the last place a loss should hide.
--   * Nothing already in the basket.
--
-- ONE SUGGESTION, NOT A LIST. Order entry is speed-first; a panel of options at
-- the till is friction, and friction at the till is how the order gets smaller
-- rather than bigger.
--
-- UNITS: packs and cartons. The conversion happens here so no piece count can
-- reach the screen.

create or replace function get_cross_sell_suggestion(
  p_customer_id  uuid,
  p_godown_id    uuid,
  p_exclude_skus uuid[] default '{}'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
with
-- Every category this customer has ever bought from, at any time. A single
-- past purchase is enough to disqualify the category: they know we sell it.
theirs as (
  select distinct pm.category_id
  from public.sales_orders so
  join public.sales_order_lines sl on sl.order_id = so.id
  join public.skus s   on s.id = sl.sku_id
  join public.variants v on v.id = s.variant_id
  join public.product_models pm on pm.id = v.model_id
  where so.customer_id = p_customer_id
    and so.status in ('confirmed','out_for_delivery','delivered')
),
-- What is actually on the shelf in the warehouse this order ships from.
on_hand as (
  select bs.sku_id, sum(bs.qty_pieces_remaining) as pcs
  from public.v_batch_stock bs
  where bs.godown_id = p_godown_id and bs.qty_pieces_remaining > 0
  group by bs.sku_id
),
-- Units sold in the last 90 days, across everyone. The popularity signal.
moved as (
  select sl.sku_id, sum(sl.qty_pieces) as pcs_90
  from public.sales_order_lines sl
  join public.sales_orders so on so.id = sl.order_id
  where so.status in ('confirmed','out_for_delivery','delivered')
    and (coalesce(so.delivered_at, so.created_at) at time zone 'Indian/Maldives')::date
        >= (now() at time zone 'Indian/Maldives')::date - 89
  group by sl.sku_id
),
candidate as (
  select vs.id, vs.brand_name, vs.model_name, vs.variant_display,
         vs.category_name, vs.pcs_per_pack, vs.pcs_per_carton,
         vs.sellable_units, vs.unit_uom,
         vs.selling_price_per_pack_mvr, vs.selling_price_per_carton_mvr,
         vs.landed_per_piece_mvr,
         -- The per-piece price DERIVED from however this product is priced.
         -- v_skus.selling_price_per_piece_mvr is null whenever a product is
         -- priced per pack or per carton — which is how this business prices
         -- almost everything — so comparing against it directly excluded every
         -- correctly-priced product from ever being suggested. Found by the
         -- pgTAP fixture, which prices per pack exactly as Price Lists does.
         coalesce(
           vs.selling_price_per_piece_mvr,
           vs.selling_price_per_pack_mvr    / nullif(vs.pcs_per_pack, 0),
           vs.selling_price_per_carton_mvr  / nullif(vs.pcs_per_carton, 0)
         ) as price_pc,
         oh.pcs as pcs_on_hand,
         coalesce(m.pcs_90, 0) as pcs_90
  from public.v_skus vs
  join on_hand oh on oh.sku_id = vs.id
  left join moved m on m.sku_id = vs.id
  join public.product_models pm on pm.id = vs.model_id
  where vs.is_active
    and pm.discontinued_at is null
    and vs.category_id not in (select category_id from theirs)
    and not (vs.id = any(coalesce(p_exclude_skus, '{}')))
    -- Never volunteer a loss. Null cost means we do not know, and an unknown
    -- margin is not a margin we can vouch for in a suggestion.
    and vs.landed_per_piece_mvr is not null
    and coalesce(
          vs.selling_price_per_piece_mvr,
          vs.selling_price_per_pack_mvr   / nullif(vs.pcs_per_pack, 0),
          vs.selling_price_per_carton_mvr / nullif(vs.pcs_per_carton, 0)
        ) > vs.landed_per_piece_mvr
    -- At least one whole sellable unit on the shelf; half a pack is not an offer.
    and oh.pcs >= coalesce(vs.pcs_per_pack, 1)
),
best as (
  select * from candidate
  -- Most-moved first; ties broken by the better margin per piece, so when two
  -- products are equally wanted the app suggests the one worth more.
  order by pcs_90 desc,
           (price_pc - landed_per_piece_mvr) desc,
           model_name
  limit 1
)
select case when exists (select 1 from best) then (
  select jsonb_build_object(
    'sku_id',        b.id,
    'label',         b.brand_name || ' ' || b.model_name
                       || coalesce(' · ' || b.variant_display, ''),
    'category',      b.category_name,
    -- The unit it is actually sold in, and its price in that unit. Never a
    -- piece price for our own goods.
    'sell_unit',     case when 'pack' = any(b.sellable_units) then 'pack' else 'carton' end,
    'price_mvr',     case when 'pack' = any(b.sellable_units)
                          then b.selling_price_per_pack_mvr
                          else b.selling_price_per_carton_mvr end,
    'packs_on_hand', floor(b.pcs_on_hand / nullif(b.pcs_per_pack, 0)),
    -- Said plainly on screen, and true: this is how many OTHER customers buy it.
    'buyers',        (select count(distinct so.customer_id)
                        from public.sales_order_lines sl
                        join public.sales_orders so on so.id = sl.order_id
                       where sl.sku_id = b.id
                         and so.customer_id is distinct from p_customer_id
                         and so.status in ('confirmed','out_for_delivery','delivered'))
  ) from best b
) else null end;
$fn$;

comment on function get_cross_sell_suggestion(uuid, uuid, uuid[]) is
  'One product to offer alongside this order: a category this customer has '
  'never bought, in stock in the warehouse the order ships from, still stocked, '
  'and sold above cost. Ranked by what actually moves, because zero orders '
  'contain two categories so affinity is uncomputable. NULL when there is '
  'nothing honest to suggest. Quantities in packs.';

revoke execute on function get_cross_sell_suggestion(uuid, uuid, uuid[]) from public;
revoke execute on function get_cross_sell_suggestion(uuid, uuid, uuid[]) from anon;
grant  execute on function get_cross_sell_suggestion(uuid, uuid, uuid[]) to authenticated;

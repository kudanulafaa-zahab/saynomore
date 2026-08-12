-- 0178 — one place that tells you everything about a product.
--
-- Ali, 2026-08-12: "How about a new module where I can get all details about an
-- sku when I search… For example fob price, landed cost, selling price, profit
-- by MVR and percentage and any other detail I might have missed… Must have
-- competitor price if applicable too."
--
-- WHY THIS IS NOT DUPLICATION. Today, to understand one product you open
-- Shipments (what you paid), Price Lists (what you charge), Inventory (what is
-- left), Market (what rivals charge) and Reports (what it earned). Every number
-- exists; none of them sit together. This is the consolidation, and "item card"
-- is what retail ERP has called it for thirty years.
--
-- WHY IT IS AN RPC AND NOT A SCREEN DOING SUMS. Hard rule 1: all money math in
-- Postgres. A fact sheet that recomputed margin in TypeScript would be a fifth
-- opinion about margin, and the whole point of the card is that it agrees with
-- the ledger. Everything below is derived from the same rows the rest of the
-- app reads: shipment_lines for landed cost, v_skus for price, stock_movements
-- for stock, sales_order_lines for what it earned.
--
-- UNITS. Packs and cartons throughout — never a piece price for our own goods.
-- The ONE exception is the rival comparison, and even there the rival's
-- per-piece price is converted into OUR pack size before it is returned, so no
-- screen ever has to print a piece figure. Rivals sell 22s, 40s and 46s, so
-- per-piece is the only way to compare at all; converting it back is what makes
-- the answer readable ("their price for a pack your size").
--
-- THE COST BASIS IS THE LAST CONFIRMED GRN, and it is labelled as such. Forex
-- locks at GRN (hard rule 3), so a product's landed cost is a historical fact
-- about a specific arrival, not a live figure. The card therefore also returns
-- the NEXT shipment's supplier price and rate, because that is the number that
-- changes the margin — and on real data it moves the wrong way: the supplier's
-- IDR price fell 0.06% while the rufiyaa rate moved 4.9% against us.

create or replace function get_product_card(p_sku_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with sku as (
  select * from public.v_skus where id = p_sku_id
),
-- ── The last CONFIRMED arrival. This is where landed cost comes from, and the
--    forex rate on it is locked for ever (hard rule 3). ────────────────────
last_grn as (
  select sl.*, sh.reference, sh.grn_confirmed_at, sh.rate_idr_to_mvr, sh.rate_usd_to_mvr
  from public.shipment_lines sl
  join public.shipments sh on sh.id = sl.shipment_id
  where sl.sku_id = p_sku_id and sh.status = 'grn_confirmed'
  order by sh.grn_confirmed_at desc
  limit 1
),
-- ── What is on the water. Not a cost yet: freight and local charges are only
--    apportioned at GRN, so this returns the supplier price and the rate and
--    lets the screen say what it can honestly say. ─────────────────────────
incoming as (
  select sl.qty_cartons, sl.fob_per_carton, sl.fob_currency,
         sh.reference, sh.expected_arrival_date, sh.status,
         sh.rate_idr_to_mvr, sh.rate_usd_to_mvr
  from public.shipment_lines sl
  join public.shipments sh on sh.id = sl.shipment_id
  where sl.sku_id = p_sku_id and sh.status <> 'grn_confirmed'
  order by sh.expected_arrival_date nulls last
  limit 1
),
stock as (
  select coalesce(sum(qty_pieces), 0)::numeric as pcs
  from public.v_stock_levels where sku_id = p_sku_id
),
stock_by_godown as (
  select jsonb_agg(jsonb_build_object(
           'godown', g.name,
           'pieces', l.qty_pieces
         ) order by l.qty_pieces desc) as rows
  from public.v_stock_levels l
  join public.godowns g on g.id = l.godown_id
  where l.sku_id = p_sku_id and l.qty_pieces <> 0
),
-- ── What it has earned. Only orders that really happened: a draft is not a
--    sale, and counting one would overstate every figure on the card. ──────
sales as (
  select count(distinct l.order_id)                              as orders,
         count(distinct o.customer_id)                           as customers,
         coalesce(sum(l.qty_pieces), 0)::numeric                  as pcs_sold,
         coalesce(sum(l.line_total_mvr), 0)::numeric              as revenue_mvr,
         coalesce(sum(l.line_total_mvr
           - l.qty_pieces * coalesce(l.landed_cost_per_piece_mvr, 0)), 0)::numeric as gross_profit_mvr,
         max(o.created_at)                                        as last_sold_at
  from public.sales_order_lines l
  join public.sales_orders o on o.id = l.order_id
  where l.sku_id = p_sku_id
    and o.status in ('confirmed', 'out_for_delivery', 'delivered')
),
-- ── The rival. Converted into OUR pack size on the way out, so nothing
--    downstream has to think in pieces. Cheapest rival wins the headline:
--    the one undercutting us is the one that matters. ──────────────────────
rival as (
  select c.name as competitor,
         cp.price_mvr        as their_price_mvr,
         cp.their_pcs_per_pack,
         cp.observed_date,
         round(cp.price_mvr / nullif(cp.their_pcs_per_pack, 0), 4) as their_per_piece
  from public.v_competitor_prices_current cp
  join public.competitors c on c.id = cp.competitor_id
  join sku s on s.variant_id = cp.variant_id
  where cp.their_pcs_per_pack > 0
  order by (cp.price_mvr / nullif(cp.their_pcs_per_pack, 0)) asc
  limit 1
)
select jsonb_build_object(
  'sku_id',        s.id,
  'internal_code', s.internal_code,
  'brand',         s.brand_name,
  'model',         s.model_name,
  'variant',       s.variant_display,
  'category',      s.category_name,
  'is_active',     s.is_active,
  'unit_noun',     public.unit_noun(s.unit_uom),
  'sellable_units', s.sellable_units,

  'pack', jsonb_build_object(
    'pcs_per_pack',     s.pcs_per_pack,
    'packs_per_carton', s.packs_per_carton,
    'length_cm',        s.carton_length_cm,
    'width_cm',         s.carton_width_cm,
    'height_cm',        s.carton_height_cm,
    'cbm_per_carton',   s.cbm_per_carton,
    'duty_rate_pct',    s.duty_rate_pct
  ),

  -- COST. Every component of the landed figure, so the total can be checked by
  -- adding up the rows above it — which the audit does.
  'cost', case when lg.id is null then null else jsonb_build_object(
    'shipment_ref',     lg.reference,
    'received_at',      lg.grn_confirmed_at,
    'qty_cartons',      lg.qty_cartons,
    'fob_currency',     lg.fob_currency,
    'fob_per_carton',   lg.fob_per_carton,
    'fx_rate',          case lg.fob_currency when 'IDR' then lg.rate_idr_to_mvr
                                             when 'USD' then lg.rate_usd_to_mvr end,
    'fob_mvr',          lg.fob_total_mvr,
    'freight_mvr',      lg.apportioned_freight_mvr,
    'local_mvr',        lg.apportioned_local_mvr,
    'duty_mvr',         lg.apportioned_duty_mvr,
    'landed_total_mvr', lg.landed_total_mvr,
    'per_carton_mvr',   lg.landed_per_carton_mvr,
    'per_pack_mvr',     lg.landed_per_pack_mvr,
    'per_piece_mvr',    lg.landed_per_piece_mvr
  ) end,

  -- PRICE AND PROFIT, in the units actually sold. Margin is on the SELLING
  -- price (gross margin), the convention every accountant and supplier uses —
  -- not markup on cost, which would read ~9 points higher and flatter nobody.
  'price', jsonb_build_object(
    'per_pack_mvr',    s.selling_price_per_pack_mvr,
    'per_carton_mvr',  s.selling_price_per_carton_mvr,
    'pack_cost_mvr',   lg.landed_per_pack_mvr,
    'carton_cost_mvr', lg.landed_per_carton_mvr,
    'pack_profit_mvr',   round(s.selling_price_per_pack_mvr   - lg.landed_per_pack_mvr, 2),
    'carton_profit_mvr', round(s.selling_price_per_carton_mvr - lg.landed_per_carton_mvr, 2),
    'pack_margin_pct',   round((s.selling_price_per_pack_mvr   - lg.landed_per_pack_mvr)
                               / nullif(s.selling_price_per_pack_mvr, 0)   * 100, 1),
    'carton_margin_pct', round((s.selling_price_per_carton_mvr - lg.landed_per_carton_mvr)
                               / nullif(s.selling_price_per_carton_mvr, 0) * 100, 1),
    -- Buying a carton instead of that many packs: what the customer saves and
    -- Ali gives up. Nothing showed this anywhere, and on a real diaper it is
    -- MVR 20 a carton.
    'carton_discount_mvr', round(s.selling_price_per_pack_mvr * s.packs_per_carton
                                 - s.selling_price_per_carton_mvr, 2)
  ),

  'stock', jsonb_build_object(
    'pieces',     st.pcs,
    'by_godown',  coalesce(sbg.rows, '[]'::jsonb),
    'in_stock',   st.pcs > 0
  ),

  'incoming', case when inc.reference is null then null else jsonb_build_object(
    'shipment_ref',   inc.reference,
    'status',         inc.status,
    'qty_cartons',    inc.qty_cartons,
    'expected_date',  inc.expected_arrival_date,
    'fob_currency',   inc.fob_currency,
    'fob_per_carton', inc.fob_per_carton,
    'fx_rate',        case inc.fob_currency when 'IDR' then inc.rate_idr_to_mvr
                                            when 'USD' then inc.rate_usd_to_mvr end,
    -- Supplier price in MVR at each shipment's own locked rate. The comparison
    -- is the useful part: a cheaper foreign price can still land dearer.
    'fob_mvr_per_carton',      round(inc.fob_per_carton
      * case inc.fob_currency when 'IDR' then inc.rate_idr_to_mvr
                              when 'USD' then inc.rate_usd_to_mvr else 1 end, 2),
    'last_fob_mvr_per_carton', round(lg.fob_per_carton
      * case lg.fob_currency when 'IDR' then lg.rate_idr_to_mvr
                             when 'USD' then lg.rate_usd_to_mvr else 1 end, 2)
  ) end,

  'sales', jsonb_build_object(
    'orders',           sa.orders,
    'customers',        sa.customers,
    'packs_sold',       round(sa.pcs_sold / nullif(s.pcs_per_pack, 0), 1),
    'revenue_mvr',      round(sa.revenue_mvr, 2),
    'gross_profit_mvr', round(sa.gross_profit_mvr, 2),
    'last_sold_at',     sa.last_sold_at
  ),

  'rival', case when r.competitor is null then null else jsonb_build_object(
    'competitor',      r.competitor,
    'observed_date',   r.observed_date,
    -- Maldives day, never the server's UTC day. `money_rules` test 9 exists
    -- precisely to catch this and caught it here — migration 0170 fixed the
    -- same slip in the recurring-cost generator. UTC+5 means a card opened
    -- before 5am local would age a rival price by an extra day.
    'days_old',        ((now() at time zone 'Indian/Maldives')::date - r.observed_date),
    'their_pack_size', r.their_pcs_per_pack,
    'their_price_mvr', r.their_price_mvr,
    -- THEIR price for a pack OUR size. This is the whole trick: it keeps the
    -- comparison honest across different pack formats without ever printing a
    -- per-piece figure on screen.
    'their_price_at_our_pack_size', round(r.their_per_piece * s.pcs_per_pack, 2),
    'our_price_mvr',                s.selling_price_per_pack_mvr,
    'we_are_cheaper_by_mvr',        round(r.their_per_piece * s.pcs_per_pack
                                          - s.selling_price_per_pack_mvr, 2),
    'we_are_cheaper_by_pct',        round((r.their_per_piece * s.pcs_per_pack
                                          - s.selling_price_per_pack_mvr)
                                          / nullif(r.their_per_piece * s.pcs_per_pack, 0) * 100, 1)
  ) end
)
from sku s
left join last_grn lg on true
left join incoming inc on true
left join stock st on true
left join stock_by_godown sbg on true
left join sales sa on true
left join rival r on true;
$$;

comment on function get_product_card(uuid) is
  'Everything known about one SKU, in one row: landed cost with its components, '
  'price and profit per pack and carton, stock by godown, what is inbound, what '
  'it has earned, and the cheapest rival converted to our pack size. Money in '
  'packs and cartons only.';

-- Least privilege. Supabase grants EXECUTE to `authenticated` by DEFAULT on new
-- functions in public (see 0169 — the REVOKEs in 0167 silently did nothing
-- because of this), so revoking from anon alone is not enough to reason about.
-- Here `authenticated` SHOULD keep it: every signed-in role may read the
-- catalogue. anon and public must not.
revoke execute on function get_product_card(uuid) from public;
revoke execute on function get_product_card(uuid) from anon;
grant  execute on function get_product_card(uuid) to authenticated;

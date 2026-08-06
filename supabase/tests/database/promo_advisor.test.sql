-- Pass 5: the Promo Advisor must never suggest discounting a product that
-- sells well. Regression guard for migration 0150.
--
-- The incident: get_promo_suggestions() ranked Mamypoko Xtra Kering M FIRST
-- on production -- the single best-selling product in the business -- with a
-- suggested clearance discount, because it admitted any SKU with more than
-- 180 days of cover regardless of whether it was selling. Three of its
-- siblings sat right behind it. The advisor was recommending that margin be
-- given away on the four lines carrying the company.
--
-- "Too much stock" and "no demand" are opposite diagnoses:
--   over-bought -> order less next time  (Reorder, status 'overstock')
--   not selling -> move the price        (here)
-- Nothing but a test keeps that boundary in place, because both look
-- identical from a days-of-cover figure alone.
--
-- Three SKUs, identical in every respect except how fast they sell, so the
-- only thing any assertion below can be responding to is velocity:
--   A  over-bought  30 cartons (90 packs) on hand, 30 packs sold in 90d -> ~270 days
--   B  dead         30 cartons (90 packs) on hand,  0 packs sold in 90d -> no cover
--   C  stagnant     30 cartons (90 packs) on hand,  6 packs sold in 90d -> ~1,350 days
-- All three carry the same cost (MVR 14/piece) and the same pack price
-- (MVR 700), so all three have identical margin headroom and none can be
-- included or excluded on money grounds.

begin;
select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000050', 'test-promo@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000050';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000050', true);

-- ── SKU A: the seed SKU, cast as the over-bought best seller ──────────────
update skus
   set fixed_price_per_pack_mvr = 700,
       sellable_units           = array['pack','carton']
 where id = '00000000-0000-0000-0000-000000000005';

-- ── SKUs B and C: same variant, same pack config, different codes ─────────
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000004',
   'TEST-MODEL-DEAD-34x3', 34, 3, 40, 30, 30, 700, array['pack','carton']),
  ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000004',
   'TEST-MODEL-STAGNANT-34x3', 34, 3, 40, 30, 30, 700, array['pack','carton']);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000053', 'TEST-PROMO',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);

-- One shipment line, batch and 'in' movement per SKU. 30 cartons each, at
-- MVR 14/piece landed -> promo price 14 x 34 / 0.90 = MVR 529 a pack, which
-- is comfortably under the MVR 700 shelf price, so every SKU clears the
-- margin-headroom filter and only velocity can decide the outcome.
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
select ('00000000-0000-0000-0000-00000000005' || n)::uuid,
       '00000000-0000-0000-0000-000000000053', sku, 30, 0.036, 10, 'USD',
       '00000000-0000-0000-0000-000000000006'
from (values (4, '00000000-0000-0000-0000-000000000005'::uuid),
             (5, '00000000-0000-0000-0000-000000000051'::uuid),
             (6, '00000000-0000-0000-0000-000000000052'::uuid)) as t(n, sku);

insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
select ('00000000-0000-0000-0000-00000000006' || n)::uuid,
       ('00000000-0000-0000-0000-00000000005' || n)::uuid, sku,
       '00000000-0000-0000-0000-000000000006', now() - interval '120 days',
       30, 3060, 14.0000, 476.0000, 1428.0000
from (values (4, '00000000-0000-0000-0000-000000000005'::uuid),
             (5, '00000000-0000-0000-0000-000000000051'::uuid),
             (6, '00000000-0000-0000-0000-000000000052'::uuid)) as t(n, sku);

insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
select ('00000000-0000-0000-0000-00000000006' || n)::uuid, sku,
       '00000000-0000-0000-0000-000000000006', 'in', 3060, 'shipment'
from (values (4, '00000000-0000-0000-0000-000000000005'::uuid),
             (5, '00000000-0000-0000-0000-000000000051'::uuid),
             (6, '00000000-0000-0000-0000-000000000052'::uuid)) as t(n, sku);

-- Sales inside the 90-day velocity window. Lines only -- no stock movement --
-- so on-hand stays identical across all three and velocity is the sole
-- variable. SKU B gets no order at all.
insert into sales_orders (id, order_number, status, channel, source_godown_id, created_at)
values ('00000000-0000-0000-0000-000000000070', 'SO-TEST-PROMO-A', 'confirmed', 'walkin',
        '00000000-0000-0000-0000-000000000006', now() - interval '10 days'),
       ('00000000-0000-0000-0000-000000000071', 'SO-TEST-PROMO-C', 'confirmed', 'walkin',
        '00000000-0000-0000-0000-000000000006', now() - interval '10 days');

insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-000000000005',
        'pack', 30, 1020, 700, 21000),
       ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000052',
        'pack', 6, 204, 700, 4200);

-- ── The rule ──────────────────────────────────────────────────────────────

select is_empty(
  $$select internal_code from get_promo_suggestions()
     where sku_id = '00000000-0000-0000-0000-000000000005'$$,
  'a product that keeps selling is NOT offered for discount, however much of it was bought -- this is the Xtra Kering M regression'
);

select is(
  (select reason from get_promo_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000051'),
  'dead',
  'a product with no sales at all in 90 days is flagged dead'
);

select is(
  (select reason from get_promo_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000052'),
  'stagnant',
  'a product that trickles out over more than a year of cover is flagged stagnant'
);

-- The over-bought SKU is the one with the MOST cover-days pressure and the
-- most cash on the shelf, so if the filter were value- or cover-driven at all
-- it would be first. It has to be velocity that excludes it.
select is(
  (select count(*) from get_promo_suggestions()
    where sku_id in ('00000000-0000-0000-0000-000000000005',
                     '00000000-0000-0000-0000-000000000051',
                     '00000000-0000-0000-0000-000000000052')),
  2::bigint,
  'exactly two of the three identically-stocked, identically-priced SKUs are suggested'
);

-- ── The suggested price must still make money ─────────────────────────────
-- A "clearance" that sells below landed cost is not a promo, it is a loss
-- with a discount label on it (skills.md Seat 4: losing money is a decision,
-- never an accident).
select is(
  (select promo_pack_mvr from get_promo_suggestions()
    where sku_id = '00000000-0000-0000-0000-000000000051'),
  529::numeric,
  'the promo price is the 10% floor margin on landed cost: 14 x 34 / 0.90 = MVR 529 a pack'
);

select ok(
  (select bool_and(promo_pack_mvr > pcs_per_pack * 14.0) from get_promo_suggestions()
    where sku_id in ('00000000-0000-0000-0000-000000000051',
                     '00000000-0000-0000-0000-000000000052')),
  'every suggested promo price is above landed cost -- the advisor never proposes selling at a loss'
);

-- ── Ordering: dead before stagnant ────────────────────────────────────────
-- The screen shows three rows before collapsing the rest, so what sits at the
-- top is the whole recommendation as far as Ali is concerned.
select is(
  (select array_agg(reason order by ord)
     from (select reason, row_number() over () as ord
             from get_promo_suggestions()
            where sku_id in ('00000000-0000-0000-0000-000000000051',
                             '00000000-0000-0000-0000-000000000052')) t),
  array['dead','stagnant'],
  'never-sells is ranked above barely-sells'
);

-- ── The briefing counts the same set ──────────────────────────────────────
-- get_morning_briefing reads get_promo_suggestions, so a product excluded
-- from the advisor must not reappear in the briefing's stuck-stock line.
select is(
  (get_morning_briefing() ->> 'stuck_stock_count')::int,
  (select count(*)::int from get_promo_suggestions()),
  'the briefing''s stuck-stock count is exactly the advisor''s list -- one source, no second definition of "slow"'
);

select * from finish();
rollback;

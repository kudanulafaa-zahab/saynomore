-- Pass 23: a Sosoft bottle can be sold and given away on its own, and the mixed
-- carton is exactly as it was. Regression guard for migration 0208.
--
-- Ali, 2026-08-24: *"I'm also giving away sosoft bottles. I must be able to give
-- away sosoft individual bottles too. I also must have an option to sell the
-- sosoft bottle individually if I want. But leave the current setup for mix a
-- case and whole carton as it is."*
--
-- ── WHY THIS IS NOT A HOLE IN THE UNITS RULE ────────────────────────────────
--
-- It looks like one. Every Sosoft SKU is `1 x 6` — ONE PIECE IS ONE WHOLE
-- BOTTLE — so the PACK tier is a single bottle, not a loose fraction of a pack.
-- `sellUnitLabel` has said so all along, in a comment naming this product:
-- "Sosoft's carton holds 6 packs of 1, so its loose unit is a bottle."
--
-- Nothing here adds a `piece` tier. Ali reads "bottle", the ledger records a
-- pack, and 0201's rule that piece may never be the only tier is untouched.
-- Test 3 is what stops this becoming the door that opens loose diapers.
--
-- ── AND THE HALF HE ASKED ME NOT TO TOUCH ───────────────────────────────────
--
-- "Leave the current setup for mix a case and whole carton as it is." The
-- mixed carton is gated on `brands.mixed_carton_pieces`, never on
-- sellable_units, so adding a tier cannot reach it — but "cannot reach it" is
-- an argument, and tests 6 and 7 are evidence.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000230', 'test-bottle@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000230';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000230', true);

-- A Sosoft-shaped product: 1 x 6, mixed-carton brand, carton priced, and a
-- per-unit figure of MVR 36.67 — the carton price divided by six, which is what
-- four of the five real ones carry.
insert into brands (id, name, mixed_carton_pieces)
values ('00000000-0000-0000-0000-000000000231', 'Bottle Audit Brand', 6);
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000231',
        (select id from product_categories where unit_uom = 'ml' order by sort_order limit 1),
        'Cleaning Liquid');
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000233', '00000000-0000-0000-0000-000000000232',
        'Rose 700ml', '{"scent":"Rose"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_selling_price_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000234', '00000000-0000-0000-0000-000000000233',
        'BOTTLE-ROSE-1x6', 1, 6, 40, 30, 30, 36.67, 220, array['pack','carton']);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000235', 'SH-TEST-BOTTLE',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-000000000236', '00000000-0000-0000-0000-000000000235',
        '00000000-0000-0000-0000-000000000234', 4, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000237', '00000000-0000-0000-0000-000000000236',
        '00000000-0000-0000-0000-000000000234', '00000000-0000-0000-0000-000000000006',
        now() - interval '4 days', 4, 24, 17.50, 17.50, 105.00);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-000000000237', '00000000-0000-0000-0000-000000000234',
        '00000000-0000-0000-0000-000000000006', 'in', 24, 'shipment');

-- ── THE WORD HE READS IS "BOTTLE", NOT "PIECE" ─────────────────────────────
-- The whole reason this is not an exception to the units rule.
-- unit_noun is the Postgres twin of containerLabel, and it is what every view
-- and RPC uses to name a unit. The first version of this test called a
-- `sell_unit_word` that does not exist — invented, not looked up.
select is(
  unit_noun('ml'), 'bottle',
  'one of them is called a BOTTLE, not a piece -- because one piece IS one whole bottle'
);

-- ── HE CAN SELL ONE ────────────────────────────────────────────────────────
-- ONE ORDER PER CASE. `sales_order_lines` is unique on (order_id, sku_id), so a
-- single order can hold only one line for this SKU — the first version of this
-- file put all four on one order and three of them failed on the unique key,
-- which looked exactly like the feature being broken.
insert into sales_orders (id, order_number, status, payment_status, channel,
                          customer_id, source_godown_id)
values ('00000000-0000-0000-0000-000000000238', 'SO-TEST-BOTTLE-1', 'draft', 'pending',
        'walkin', null, '00000000-0000-0000-0000-000000000006'),
       ('00000000-0000-0000-0000-00000000023a', 'SO-TEST-BOTTLE-2', 'draft', 'pending',
        'walkin', null, '00000000-0000-0000-0000-000000000006'),
       ('00000000-0000-0000-0000-00000000023b', 'SO-TEST-BOTTLE-3', 'draft', 'pending',
        'walkin', null, '00000000-0000-0000-0000-000000000006'),
       ('00000000-0000-0000-0000-00000000023c', 'SO-TEST-BOTTLE-4', 'draft', 'pending',
        'walkin', null, '00000000-0000-0000-0000-000000000006');

select lives_ok(
  $$insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces,
                                   unit_price_mvr, line_total_mvr)
    values ('00000000-0000-0000-0000-000000000238',
            '00000000-0000-0000-0000-000000000234', 'pack', 1, 1, 37, 37)$$,
  'a single bottle can be sold -- the tier the catalogue now offers'
);

-- ── AND STILL NOT A LOOSE PIECE ────────────────────────────────────────────
-- THE GUARD THAT STOPS THIS BECOMING THE DOOR FOR LOOSE DIAPERS. A bottle is a
-- whole trade unit; a piece line is still only legitimate as a mixed-carton
-- fill, and the constraint trigger is deferred so it must be made immediate to
-- be observed at all (money_rules.test.sql carries the same note).
set constraints trg_assert_whole_mixed_cartons immediate;
select throws_ok(
  $$insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces,
                                   unit_price_mvr, line_total_mvr)
    values ('00000000-0000-0000-0000-00000000023a',
            '00000000-0000-0000-0000-000000000234', 'piece', 1, 1, 37, 37)$$,
  '23514',
  null,
  'a LOOSE piece line is still refused -- selling a bottle is a pack, never a piece'
);

-- ── HE CAN GIVE ONE AWAY ───────────────────────────────────────────────────
-- One bottle at MVR 17.50 landed. Not MVR 36.67, which is what it sells for.
select is(
  give_away_stock('00000000-0000-0000-0000-000000000234',
                  '00000000-0000-0000-0000-000000000006',
                  1, 'Instagram bottle giveaway'),
  17.50::numeric,
  'a single bottle can be given away, costed at what it landed at (MVR 17.50), not the MVR 36.67 it sells for'
);

select is(
  (select round(amount_mvr, 2) from marketing_spend
    where campaign_name = 'Instagram bottle giveaway'),
  17.50::numeric,
  'and that cost is charged to the campaign as marketing'
);

-- ── THE MIXED CARTON IS EXACTLY AS IT WAS ──────────────────────────────────
-- "Leave the current setup for mix a case and whole carton as it is."
select is(
  (select mixed_carton_pieces from brands where id = '00000000-0000-0000-0000-000000000231'),
  6,
  'the brand still fills a carton with six mixed bottles -- the mixed carton is gated on the BRAND, never on sellable_units'
);

select lives_ok(
  $$insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces,
                                   unit_price_mvr, line_total_mvr, is_mixed_carton_fill)
    values ('00000000-0000-0000-0000-00000000023b',
            '00000000-0000-0000-0000-000000000234', 'piece', 6, 6, 37, 222, true)$$,
  'and a mixed-carton fill of six still posts, untouched by the new tier'
);

-- ── AND THE WHOLE CARTON STILL SELLS ───────────────────────────────────────
select lives_ok(
  $$insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces,
                                   unit_price_mvr, line_total_mvr)
    values ('00000000-0000-0000-0000-00000000023c',
            '00000000-0000-0000-0000-000000000234', 'carton', 1, 6, 220, 220)$$,
  'the whole carton sells exactly as before'
);

-- ── A MISSING BOTTLE PRICE IS NOW VISIBLE ──────────────────────────────────
-- get_setup_gaps had a branch for "no carton price" and NO MIRROR. So enabling
-- the bottle tier would have hidden the one real SKU that cannot be quoted a
-- bottle at all: SOSO-BLUE-ROSEWA-1x6 carries no per-unit figure.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000239', '00000000-0000-0000-0000-000000000233',
        'BOTTLE-NOUNIT-1x6', 1, 6, 40, 30, 30, 220, array['pack','carton']);

select is(
  (select headline from get_setup_gaps() where sku_id = '00000000-0000-0000-0000-000000000239'),
  'No price for one bottle',
  'a carton-priced product with no single-bottle price is reported, in the product''s own word'
);

select * from finish();
rollback;

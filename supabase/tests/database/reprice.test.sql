-- Pass 11: the reprice button, and the whole pricing surface's first test.
-- Regression guard for migration 0158.
--
-- The earlier audit passes swept functions writing stock_movements,
-- order_payments or inventory_batches. That scope had a hole: PRICE writes
-- were never in the list, and a wrong price is money just as surely as a
-- wrong payment. Re-run against price-writing functions, the entire pricing
-- surface came back with no tests at all. This is the first.
--
-- THE BUG: apply_target_prices read landed cost from IN-STOCK batches only,
-- so the moment a product sold out the one-tap reprice refused with "No
-- landed cost yet — receive stock via a GRN first" — while the app knew the
-- cost perfectly well.
--
-- On production this bites the only SKU that has a target margin at all:
-- Xtra Kering NB/S, out of stock, cost known to be MVR 2.1287/piece. The one
-- product the feature exists for is the one it failed on. Third instance of a
-- class already fixed in get_price_book (0092) and v_skus (0149).
--
-- The fixture mirrors that exactly: a SKU received, priced, then sold to
-- zero, and repriced from an empty shelf.
--
--   landed        MVR 10.00 a piece
--   pack          34 pieces  -> cost MVR 340 a pack
--   target margin 50%        -> piece 20, pack 680

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e0', 'test-reprice@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000e0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e0', true);

update skus
   set target_margin_pct        = 50,
       fixed_selling_price_mvr  = 99,
       fixed_price_per_pack_mvr = 999,
       fixed_price_per_carton_mvr = null
 where id = '00000000-0000-0000-0000-000000000005';

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000000e1', 'SH-TEST-REPRICE',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-000000000005', 1, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e2',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        now() - interval '10 days', 1, 102, 10, 340, 1020);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 102, 'shipment');

-- ── With stock on the shelf (unchanged behaviour) ─────────────────────────
select lives_ok(
  $$select apply_target_prices('00000000-0000-0000-0000-000000000005')$$,
  'repricing works with stock on hand'
);

select is(
  (select fixed_price_per_pack_mvr from skus where id = '00000000-0000-0000-0000-000000000005'),
  680::numeric,
  'a pack costing MVR 340 is priced at 680 for a 50% margin'
);

select is(
  (select fixed_selling_price_mvr from skus where id = '00000000-0000-0000-0000-000000000005'),
  20::numeric,
  'and the per-piece price follows the same target'
);

select is(
  (select fixed_price_per_carton_mvr from skus where id = '00000000-0000-0000-0000-000000000005'),
  null,
  'a SKU with no carton price does not acquire one by being repriced'
);

-- ── THE bug: sell out, then reprice ───────────────────────────────────────
-- This is the Xtra Kering NB/S situation: nothing on the shelf, a target
-- margin set, and a cost the app has known all along.
insert into sales_orders (id, order_number, status, payment_status, channel,
                          source_godown_id, created_at)
values ('00000000-0000-0000-0000-0000000000e4', 'SO-TEST-REPRICE', 'draft', 'pending',
        'walkin', '00000000-0000-0000-0000-000000000006', now());
insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000005',
        'pack', 3, 102, 680, 2040);
select post_sale('00000000-0000-0000-0000-0000000000e4');

select is(
  (select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)), 0)::numeric
     from stock_movements where sku_id = '00000000-0000-0000-0000-000000000005'),
  0::numeric,
  'the shelf is now empty'
);

-- Prove the old lookup finds nothing, so the assertion below is really
-- exercising the fallback rather than passing for some other reason.
select is_empty(
  $$select bs.landed_per_piece_mvr from v_batch_stock bs
     where bs.sku_id = '00000000-0000-0000-0000-000000000005'
       and bs.qty_pieces_remaining > 0$$,
  'and the in-stock lookup the old code used returns nothing at all'
);

update skus set fixed_price_per_pack_mvr = 999
 where id = '00000000-0000-0000-0000-000000000005';

select lives_ok(
  $$select apply_target_prices('00000000-0000-0000-0000-000000000005')$$,
  'repricing STILL works with an empty shelf -- it used to refuse with "No landed cost yet"'
);

select is(
  (select fixed_price_per_pack_mvr from skus where id = '00000000-0000-0000-0000-000000000005'),
  680::numeric,
  'and it uses the last known cost, giving the same MVR 680 as when stock was on hand'
);

-- ── A SKU never received still has nothing to go on ───────────────────────
-- The fallback must not invent a cost, only remember one.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  target_margin_pct, fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000004',
        'TEST-NEVER-RECEIVED-34x3', 34, 3, 40, 30, 30, 50, 500, array['pack','carton']);

select throws_ok(
  $$select apply_target_prices('00000000-0000-0000-0000-0000000000e5')$$,
  'No landed cost yet — receive stock via a GRN first',
  'a SKU that has genuinely never been received still refuses, with the message it always had'
);

select * from finish();
rollback;

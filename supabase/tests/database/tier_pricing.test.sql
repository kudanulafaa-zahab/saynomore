-- Pass 12: the tier pricing engine — precedence, and a sold-out cost.
-- Regression guard for migration 0159.
--
-- get_tier_prices_for_skus is what order entry asks for a price when a
-- product is added to a sale. It resolves three sources in order:
--
--   price_list  > sku_default > margin
--
-- Nothing tested any of it. This covers the precedence itself and the bug.
--
-- THE BUG: the margin path read landed cost from IN-STOCK batches via an
-- INNER lateral join, so a SKU priced by target margin with nothing on the
-- shelf produced no row at all — the engine returned nothing for it.
--
-- On production exactly one active SKU came back unpriced, and it was Xtra
-- Kering NB/S again: target margin, no fixed price, sold out. v_skus priced
-- it at MVR 170 a pack while the tier engine returned nothing, so the two
-- pricing paths disagreed on one real product.
--
-- Nothing looked broken on the phone only because sales-list.tsx quietly
-- falls back to v_skus when the server returns no price — money resolved in
-- TypeScript, which rule 6 forbids. This makes the server answer, so that
-- fallback stops being load-bearing.
--
-- Fourth instance of the class: 0092 get_price_book, 0149 v_skus,
-- 0158 apply_target_prices, 0159 here.

begin;
select plan(13);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f0', 'test-tier@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000f0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', true);

-- A SKU priced ONLY by target margin — no fixed price of any kind, which is
-- what makes the margin path the one that has to answer. 34 pieces a pack.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  target_margin_pct, sellable_units)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000004',
        'TEST-MARGIN-ONLY-34x3', 34, 3, 40, 30, 30, 50, array['pack','carton']);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000000f2', 'SH-TEST-TIER',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2',
        '00000000-0000-0000-0000-0000000000f1', 1, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f3',
        '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000006',
        now() - interval '10 days', 1, 102, 10, 340, 1020);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-000000000006', 'in', 102, 'shipment');

-- ── The margin source, with stock ─────────────────────────────────────────
select is(
  (select source from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f1', 'retail')),
  'margin',
  'a SKU with only a target margin is priced from that margin'
);

select is(
  (select price_per_pack_mvr from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f1', 'retail')),
  680::numeric,
  'a pack costing MVR 340 prices at 680 for a 50% margin'
);

-- ── THE bug: sell out, and it must still answer ───────────────────────────
insert into sales_orders (id, order_number, status, payment_status, channel,
                          source_godown_id, created_at)
values ('00000000-0000-0000-0000-0000000000f5', 'SO-TEST-TIER', 'draft', 'pending',
        'walkin', '00000000-0000-0000-0000-000000000006', now());
insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000f1',
        'pack', 3, 102, 680, 2040);
select post_sale('00000000-0000-0000-0000-0000000000f5');

select is(
  (select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)), 0)::numeric
     from stock_movements where sku_id = '00000000-0000-0000-0000-0000000000f1'),
  0::numeric,
  'the shelf is now empty'
);

-- Prove the old in-stock-only lookup finds nothing, so the next assertion is
-- really exercising the fallback and not passing for another reason.
select is_empty(
  $$select bs.landed_per_piece_mvr from v_batch_stock bs
     where bs.sku_id = '00000000-0000-0000-0000-0000000000f1'
       and bs.qty_pieces_remaining > 0$$,
  'and the in-stock lookup the old code used returns nothing at all'
);

select is(
  (select count(*) from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f1', 'retail')),
  1::bigint,
  'the engine STILL returns a price with an empty shelf -- it used to return no row, and the browser papered over it'
);

select is(
  (select price_per_pack_mvr from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f1', 'retail')),
  680::numeric,
  'and it is the same MVR 680, from the last known cost'
);

-- The authoritative engine and the view must agree on one product.
select is(
  (select price_per_pack_mvr from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f1', 'retail')),
  (select selling_price_per_pack_mvr from v_skus where id = '00000000-0000-0000-0000-0000000000f1'),
  'the tier engine and v_skus agree -- they disagreed on Xtra Kering NB/S in production'
);

-- ── Precedence ────────────────────────────────────────────────────────────
-- A fixed price on the SKU outranks the margin calculation.
update skus set fixed_price_per_pack_mvr = 900
 where id = '00000000-0000-0000-0000-0000000000f1';

select is(
  (select source from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f1', 'retail')),
  'sku_default',
  'a fixed price on the SKU outranks the margin calculation'
);

-- And a price list for the tier outranks the SKU's own fixed price.
insert into price_lists (id, name, tier, effective_from)
values ('00000000-0000-0000-0000-0000000000f6', 'Test Retail List', 'retail',
        (now() at time zone 'Indian/Maldives')::date - 1);
insert into price_list_items (price_list_id, sku_id, price_per_piece_mvr,
                              price_per_pack_mvr, price_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000f1',
        25, 850, 2550);

select is(
  (select source from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f1', 'retail')),
  'price_list',
  'an active price list for the tier outranks the SKU''s own fixed price'
);

select is(
  (select price_per_pack_mvr from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f1', 'retail')),
  850::numeric,
  'and the list price is what order entry is given'
);

-- ── Only units the product is actually sold in are quoted (0160) ──────────
-- Ali, 2026-08-07: "Sosoft I sell in cartons. Not bottles. But customer can
-- make mixed carton of six bottles not less." So the carton is the only
-- selling unit, and a pack price for one is an offer that cannot be filled.
-- The engine used to return "MVR 37 a pack" for a MVR 220 carton-only bottle.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-000000000004',
        'TEST-CARTON-ONLY-1x6', 1, 6, 40, 30, 30, 220, array['carton']);

select is(
  (select price_per_carton_mvr from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f7', 'retail')),
  220::numeric,
  'a carton-only product is quoted its carton price'
);

select is(
  (select price_per_pack_mvr from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f7', 'retail')),
  null,
  'and NOT a pack price -- it used to answer MVR 37 for a unit never sold'
);

-- Per-piece is deliberately kept: no SKU sells by the piece, so it cannot be
-- mistaken for a selling unit, and the Market screen needs it to compare
-- against rivals who sell 30s, 34s and 48s (the sanctioned carve-out).
select isnt(
  (select price_per_piece_mvr from get_tier_price_for_sku('00000000-0000-0000-0000-0000000000f7', 'retail')),
  null,
  'per-piece is still returned -- it is the comparison figure, never a selling unit'
);

select * from finish();
rollback;

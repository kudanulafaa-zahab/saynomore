-- A rival's carton price is a DIFFERENT price, not a cheaper pack.
--
-- Ali, 2026-08-30:
--   *"In prices/market/competitors I should be able to add competitor carton
--    prices too since they also offer discount on cartons sales. Right now it
--    only adds the packs price. It must also know how many packs in a carton
--    for competitor since it can vary from ours."*
--
-- ── WHAT THIS SUITE IS ACTUALLY DEFENDING ─────────────────────────────────
--
-- Not "can we store a carton price" — we could already. Two things:
--
-- 1. THE CONVERSION. Their carton is built from THEIR packs, which can differ
--    from ours. A carton price divided by the wrong number is a rival price
--    that looks authoritative and is invented, and it feeds the price gaps
--    screen, the Product Card and the costing simulator.
--
-- 2. THE LINE BETWEEN TWO BUYERS. A carton is discounted per piece by
--    definition. Every consumer used to take the CHEAPEST rival price
--    regardless of basis, so the first carton price logged would win
--    everywhere and the app would compare our PACK price against their CARTON
--    rate — our margin reads worse than it is and the Promo Advisor argues for
--    a price cut that was never needed.
--
-- The second one is the dangerous half, because nothing about it looks wrong
-- on screen. A number simply gets smaller.

begin;
select plan(14);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000009a0', 'test-carton@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a0', true);

-- ── Fixture ───────────────────────────────────────────────────────────────
-- One product whose pack format we control, and a rival who builds a carton
-- DIFFERENTLY: we sell 4 packs of 25, they sell 2 packs of 50. Same 100 pieces
-- in a carton, arrived at from different pack sizes — which is precisely the
-- case that a single overloaded "pieces" field could not express.
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-0000000009b0',
        (select id from brands limit 1),
        (select id from product_categories limit 1),
        'Test Carton Range');

insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009b0',
        'CartonTest L', '{"size":"L-carton"}'::jsonb);

--
-- All three price tiers are set and they agree: 10.00 x 25 = 250 a pack,
-- 250 x 4 = 1000 against a 900 carton price (a genuine carton discount).
-- The pack tier is the one that matters here — since 0227 the gap is measured
-- in the unit he sells, so get_competitor_price_gaps reads
-- selling_price_per_pack_mvr rather than a per-piece figure nobody is charged.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_selling_price_mvr, fixed_price_per_pack_mvr,
                  fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000009b2', '00000000-0000-0000-0000-0000000009b1',
        'TEST-CARTON-25x4', 25, 4, 40, 30, 30, 10, 250, 900, array['pack','carton']);

insert into competitors (id, name)
values ('00000000-0000-0000-0000-0000000009c0', 'Test Rival Shop');

-- ══════════════════════════════════════════════════════════════════════════
-- THE CONSTRAINTS: a conversion is never guessed.
-- ══════════════════════════════════════════════════════════════════════════
-- The old code fell back to OUR pack size when theirs was blank. That is
-- invisible on screen, so it is refused at the door instead.

select throws_ok(
  $$insert into competitor_prices (competitor_id, variant_id, price_mvr, price_basis, their_pcs_per_pack)
    values ('00000000-0000-0000-0000-0000000009c0', '00000000-0000-0000-0000-0000000009b1',
            800, 'per_carton', 50)$$,
  '23514',
  null,
  'a carton price without their packs-per-carton is refused, not guessed at'
);

select throws_ok(
  $$insert into competitor_prices (competitor_id, variant_id, price_mvr, price_basis)
    values ('00000000-0000-0000-0000-0000000009c0', '00000000-0000-0000-0000-0000000009b1',
            260, 'per_pack')$$,
  '23514',
  null,
  'and a pack price without their pack size is refused too'
);

-- ── The two prices Ali actually logs ──────────────────────────────────────
--   Shelf   MVR 260 for one of their 50-piece packs -> 260 / 50      = 5.20/pc
--   Carton  MVR 400 for 2 of those packs            -> 400 / (50x2)  = 4.00/pc
--
-- The carton rate is deliberately BELOW the shelf rate per piece, because that
-- is what a carton discount IS — and it is what makes a basis-blind "cheapest
-- rival price" pick the wrong one. That trap is the point of this fixture.
insert into competitor_prices (competitor_id, variant_id, price_mvr, price_basis,
                               their_pcs_per_pack, observed_date)
values ('00000000-0000-0000-0000-0000000009c0', '00000000-0000-0000-0000-0000000009b1',
        260, 'per_pack', 50, current_date);

insert into competitor_prices (competitor_id, variant_id, price_mvr, price_basis,
                               their_pcs_per_pack, their_packs_per_carton, observed_date)
values ('00000000-0000-0000-0000-0000000009c0', '00000000-0000-0000-0000-0000000009b1',
        400, 'per_carton', 50, 2, current_date);

-- ══════════════════════════════════════════════════════════════════════════
-- THE CONVERSION: their carton, built from THEIR packs.
-- ══════════════════════════════════════════════════════════════════════════
-- 260 / 50 = 5.20 a piece on the shelf.
select is(
  (select round(price_per_piece, 4) from v_competitor_price_normalized
    where variant_id = '00000000-0000-0000-0000-0000000009b1' and price_basis = 'per_pack'),
  5.2000::numeric,
  'a shelf price divides by THEIR pack size, not ours'
);

-- 400 / (50 x 2) = 4.00 a piece by the carton. If this divided by their PACK
-- size alone it would read 8.00 — exactly twice — and if it divided by OUR
-- carton size (100) it would read 4.00 by coincidence, which is why the
-- fixture makes their pack size differ from ours.
select is(
  (select round(price_per_piece, 4) from v_competitor_price_normalized
    where variant_id = '00000000-0000-0000-0000-0000000009b1' and price_basis = 'per_carton'),
  4.0000::numeric,
  'a carton price divides by THEIR pieces per pack TIMES their packs per carton'
);

select is(
  (select buys_like from v_competitor_price_normalized
    where variant_id = '00000000-0000-0000-0000-0000000009b1' and price_basis = 'per_carton'),
  'carton',
  'and it is marked as a price for a different buyer'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE LINE: the carton rate is cheaper, and must NOT win the shelf comparison.
-- ══════════════════════════════════════════════════════════════════════════
-- This is the whole point. 4.00 < 5.20, so any "cheapest rival price" that
-- ignores the basis picks the carton — and then compares it to our pack price.
select cmp_ok(
  (select price_per_piece from v_competitor_price_normalized
    where variant_id = '00000000-0000-0000-0000-0000000009b1' and price_basis = 'per_carton'),
  '<',
  (select price_per_piece from v_competitor_price_normalized
    where variant_id = '00000000-0000-0000-0000-0000000009b1' and price_basis = 'per_pack'),
  'the fixture really does make the carton cheaper per piece, or this proves nothing'
);

-- We charge MVR 250 a pack. Their shelf price at OUR 25-pack is 5.20 x 25 =
-- MVR 130, so the gap is (250 - 130) / 130 = 92.3%. Against their CARTON rate
-- it would read (250 - 100) / 100 = 150% — a fictitious 58-point overstatement
-- that would drive a real price cut.
select is(
  (select round(gap_pct, 1) from get_competitor_price_gaps(1)
    where sku_id = '00000000-0000-0000-0000-0000000009b2'),
  92.3::numeric,
  'the price gap is measured against their SHELF price, never their carton rate'
);

-- Both sides are PACK prices (0227): the gap used to be struck against
-- selling_price_per_piece_mvr, which v_skus rounds to a whole rufiyaa and
-- which nobody is ever charged for a product sold by the pack.
select is(
  (select round(our_price_mvr, 2) from get_competitor_price_gaps(1)
    where sku_id = '00000000-0000-0000-0000-0000000009b2'),
  250.00::numeric,
  'our side of it is the pack price we actually charge'
);

select is(
  (select round(cheapest_competitor_mvr, 2) from get_competitor_price_gaps(1)
    where sku_id = '00000000-0000-0000-0000-0000000009b2'),
  130.00::numeric,
  'and theirs is their SHELF price at our pack size, checkable in a shop'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE PRODUCT CARD: two sections, never one.
-- ══════════════════════════════════════════════════════════════════════════
-- This is the copy that was already wrong before 0223: it divided by
-- their_pcs_per_pack whatever the basis, so this carton price would have read
-- 8.00 a piece — double.
select is(
  round((get_product_card('00000000-0000-0000-0000-0000000009b2')
         -> 'rival' ->> 'their_price_at_our_pack_size')::numeric, 2),
  130.00::numeric,
  'the card shows their shelf price at OUR pack size (5.20 x 25)'
);

select is(
  round((get_product_card('00000000-0000-0000-0000-0000000009b2')
         -> 'rival_carton' ->> 'their_price_at_our_carton_size')::numeric, 2),
  400.00::numeric,
  'and their carton rate at OUR carton size (4.00 x 100), as its own figure'
);

select is(
  (get_product_card('00000000-0000-0000-0000-0000000009b2')
   -> 'rival_carton' ->> 'their_packs_per_carton')::int,
  2,
  'the card states how THEIR carton is built, because it differs from ours'
);

-- ══════════════════════════════════════════════════════════════════════════
-- per_100ml / per_100g: kept, and honest about being uncomparable.
-- ══════════════════════════════════════════════════════════════════════════
-- Ali may use these (2026-08-30). Nothing records how many millilitres are in
-- one of our own bottles, so they cannot be converted — but the row must say
-- so rather than vanishing without trace, which is what used to happen.
insert into competitor_prices (competitor_id, variant_id, price_mvr, price_basis, observed_date)
values ('00000000-0000-0000-0000-0000000009c0', '00000000-0000-0000-0000-0000000009b1',
        12, 'per_100ml', current_date);

select is(
  (select buys_like from v_competitor_price_normalized
    where variant_id = '00000000-0000-0000-0000-0000000009b1' and price_basis = 'per_100ml'),
  'uncomparable',
  'a per-100ml price is kept and openly marked uncomparable'
);

select is(
  (select gap_pct is not null from get_competitor_price_gaps(1)
    where sku_id = '00000000-0000-0000-0000-0000000009b2'),
  true,
  'and it never displaces the shelf price it cannot be compared against'
);

select * from finish();
rollback;

-- A price gap is measured in the unit he SELLS.
--
-- Ali, 2026-08-30, with a screenshot of Prices -> Market:
--   *"For NB/S and S a message saying I am pricier. But the pack price I am
--    cheaper than competitor. What's going on here?"*
--
-- Two figures on one card, disagreeing. The banner said MVR 12.90/pk PRICIER;
-- the cards underneath said MVR 160.00 against MVR 163.10, which is 3.10
-- CHEAPER. Both were arithmetically correct — they were reading different
-- prices of his.
--
-- ── THE CAUSE, AND THE FIX THAT WOULD HAVE BEEN WRONG ─────────────────────
--
-- v_skus computes selling_price_per_piece_mvr as round(fixed, 0) — a whole
-- rufiyaa. NB/S is MVR 3.64 a nappy and becomes 4.00: 9.9% high before a rival
-- is involved. Across the catalogue 26 SKUs are distorted between -8.8% and
-- +12.7%, and none of them is sold by the piece.
--
-- The tempting fix is to stop rounding. It is WRONG, and this suite pins that
-- down: for a product where one piece IS one pack — a Sosoft bottle — the
-- rounded whole rufiyaa is the price he actually charges, and new-sale-sheet
-- reads it for real sales. Un-rounding would mis-price live orders to tidy a
-- report.
--
-- The bug is using a per-piece price at all for something not sold by the
-- piece. So the gap is measured pack against pack, which is also exactly what
-- the card shows — the two can no longer disagree.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000b10', 'test-gapunit@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000b10';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000b10', true);

-- ── Fixture: the real shape of the incident ───────────────────────────────
-- 44 to a pack, priced MVR 160 a pack. That is MVR 3.6364 a nappy — which
-- rounds to 4.00 and is where the false "pricier" came from.
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000b20',
        (select id from brands limit 1), (select id from product_categories limit 1),
        'Test Gap Unit Range');
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000b21', '00000000-0000-0000-0000-000000000b20',
        'GapUnit NBS', '{"size":"NBS-gapunit"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_selling_price_mvr, fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000b22', '00000000-0000-0000-0000-000000000b21',
        'TEST-GAPUNIT-44x4', 44, 4, 35, 20, 45, 3.64, 160, array['pack','carton']);

-- The rival, exactly as in the screenshot: 58 to a pack, MVR 215 a pack.
-- 215 / 58 = MVR 3.7069 a nappy, which at OUR 44-pack is MVR 163.10.
insert into competitors (id, name) values ('00000000-0000-0000-0000-000000000b30', 'Test VB');
insert into competitor_prices (competitor_id, variant_id, price_mvr, price_basis,
                               their_pcs_per_pack, observed_date)
values ('00000000-0000-0000-0000-000000000b30', '00000000-0000-0000-0000-000000000b21',
        215, 'per_pack', 58, current_date);

-- ══════════════════════════════════════════════════════════════════════════
-- THE DISTORTION IS REAL, AND IS THE THING BEING WORKED AROUND
-- ══════════════════════════════════════════════════════════════════════════
-- WRITTEN BEFORE 0228, AND 0228 FIXED THE THING IT DESCRIBED. The assertion
-- used to read "the per-piece column rounds MVR 3.64 up to a whole rufiyaa"
-- and expect 4. That rounding is gone: per-piece is now derived from the pack
-- price at full precision. Kept rather than deleted, flipped to state the rule
-- that replaced it — a test that documents a defect must not outlive the fix.
select is(
  (select round(selling_price_per_piece_mvr, 4) from v_skus
    where id = '00000000-0000-0000-0000-000000000b22'),
  3.6364::numeric,
  'the per-piece figure is the pack price divided by the pack size, not rounded to a rufiyaa'
);

select is(
  (select round(selling_price_per_pack_mvr / pcs_per_pack, 4) from v_skus
    where id = '00000000-0000-0000-0000-000000000b22'),
  3.6364::numeric,
  'which is exactly what the pack price he charges works out at'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE GAP IS MEASURED PACK AGAINST PACK
-- ══════════════════════════════════════════════════════════════════════════
-- Their MVR 3.7069 a nappy at our 44-pack is MVR 163.10. We charge 160. We are
-- CHEAPER by 3.10, which is -1.9%. The old per-piece comparison read
-- (4.00 - 3.7069) / 3.7069 = +7.9% and called it 12.90/pk pricier.
select is(
  (select round(our_price_mvr, 2) from get_competitor_price_gaps(-100)
    where sku_id = '00000000-0000-0000-0000-000000000b22'),
  160.00::numeric,
  'our side of the comparison is the pack price he charges'
);

select is(
  (select round(cheapest_competitor_mvr, 2) from get_competitor_price_gaps(-100)
    where sku_id = '00000000-0000-0000-0000-000000000b22'),
  163.10::numeric,
  'and theirs is their shelf price restated at our pack size'
);

select is(
  (select round(gap_pct, 1) from get_competitor_price_gaps(-100)
    where sku_id = '00000000-0000-0000-0000-000000000b22'),
  -1.9::numeric,
  'so the verdict is CHEAPER, which is what the card said all along'
);

-- The bug in one assertion: at the default 10% threshold this product must not
-- appear at all. Under the old arithmetic it read +7.9% and, on a slightly
-- larger rounding error, would have been flagged as needing a price cut.
select is(
  (select count(*) from get_competitor_price_gaps(10)
    where sku_id = '00000000-0000-0000-0000-000000000b22'),
  0::bigint,
  'and a product we undercut is never listed as dearer than the competition'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE ROUNDING MUST SURVIVE, BECAUSE SOMETIMES A PIECE IS THE TRADE UNIT
-- ══════════════════════════════════════════════════════════════════════════
-- One bottle per pack: the per-piece price IS the bottle price, and the whole
-- rufiyaa is what he charges. new-sale-sheet reads this column for a real
-- piece sale, so "just stop rounding" would mis-price live orders.
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000b23', '00000000-0000-0000-0000-000000000b20',
        'GapUnit Bottle', '{"size":"bottle-gapunit"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_selling_price_mvr, fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000b24', '00000000-0000-0000-0000-000000000b23',
        'TEST-GAPUNIT-1x6', 1, 6, 30, 20, 25, 36.67, 37, array['pack','carton']);

select is(
  (select selling_price_per_piece_mvr from v_skus where id = '00000000-0000-0000-0000-000000000b24'),
  37::numeric,
  'a bottle still prices at the whole rufiyaa he charges, not 36.67'
);

select is(
  (select selling_price_per_pack_mvr from v_skus where id = '00000000-0000-0000-0000-000000000b24'),
  37::numeric,
  'and for one-piece packs the pack price and the piece price are the same number'
);

-- Which means the pack-based comparison needs no special case for it.
select is(
  (select round(selling_price_per_pack_mvr / pcs_per_pack, 2) from v_skus
    where id = '00000000-0000-0000-0000-000000000b24'),
  37.00::numeric,
  'so measuring in the unit sold is one rule, not a diaper exception'
);

select * from finish();
rollback;

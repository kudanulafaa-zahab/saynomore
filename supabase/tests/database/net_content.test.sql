-- How much is in one bottle, so per-100ml can be compared.
--
-- Ali, 2026-08-30: *"Sosoft bottles are all 700ml."*
--
-- Per 100ml and Per 100g have been offered by the competitor sheet since it was
-- built, and both always normalised to NULL: a price logged that way was stored
-- and then never appeared in any comparison. 0223 made that VISIBLE rather than
-- silent; 0232 makes it work, by recording how much is in one of our own
-- containers.
--
-- ── WHY THIS MATTERS FOR DETERGENT AND NOT FOR NAPPIES ────────────────────
--
-- A rival's nappies are compared per nappy: their 30s against our 44s needs
-- only a count. Detergent has no count — their bottle may be 500ml, 1L or
-- 700ml, and MVR 40 means nothing until you know how much is in it.
--
-- These assertions are about the CONVERSION and about what happens when it
-- cannot be made, not about any particular price.
--
-- ── THE FIRST ASSERTION CAUGHT A REAL ONE ─────────────────────────────────
--
-- Driven against the live schema before being trusted, "a size with no unit"
-- reported NO ERROR RAISED: 0232's constraint evaluated to NULL for that row
-- and CHECK only rejects FALSE, so it accepted exactly what it was written to
-- refuse. 0233 fixed it. A constraint looks identical whether or not it works
-- — nothing goes wrong until someone leans on it — so it must be driven from
-- both sides, which is why the mirror case below is now here too.

begin;
select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000e10', 'test-netcontent@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000e10';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000e10', true);

insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000e20',
        (select id from brands limit 1), (select id from product_categories limit 1),
        'Test NetContent Range');

-- Our bottle: 700ml, one to a "pack", six to a carton — the Sosoft shape.
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000e21', '00000000-0000-0000-0000-000000000e20',
        'NetContent Bottle 700ml', '{"size":"nc-bottle"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  unit_size, unit_size_uom, fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000e22', '00000000-0000-0000-0000-000000000e21',
        'TEST-NC-1x6', 1, 6, 30, 20, 25, 700, 'ml', 37, array['pack','carton']);

-- A product with NO net content recorded — the Body Shop case, and the state
-- every product was in before 0232.
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000e23', '00000000-0000-0000-0000-000000000e20',
        'NetContent Unknown', '{"size":"nc-unknown"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000e24', '00000000-0000-0000-0000-000000000e23',
        'TEST-NC-UNKNOWN-1x6', 1, 6, 30, 20, 25, 40, array['pack','carton']);

insert into competitors (id, name) values ('00000000-0000-0000-0000-000000000e30', 'Test NC Rival');

-- ══════════════════════════════════════════════════════════════════════════
-- THE SIZE IS BOTH-OR-NEITHER
-- ══════════════════════════════════════════════════════════════════════════
-- A number with no unit is not a size. 700 of what?
select throws_ok(
  $$update skus set unit_size = 500, unit_size_uom = null
     where id = '00000000-0000-0000-0000-000000000e22'$$,
  '23514',
  null,
  'a net content with no unit is refused — 700 of what?'
);

-- The mirror. Both halves fell through the same NULL hole, and testing only
-- one of them would have left the other open.
select throws_ok(
  $$update skus set unit_size = null, unit_size_uom = 'ml'
     where id = '00000000-0000-0000-0000-000000000e22'$$,
  '23514',
  null,
  'and a unit with no size is refused too — millilitres of what?'
);

select throws_ok(
  $$update skus set unit_size = 0, unit_size_uom = 'ml'
     where id = '00000000-0000-0000-0000-000000000e22'$$,
  '23514',
  null,
  'and a bottle cannot hold nothing'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE CONVERSION: THEIR PRICE PER 100ML, AT OUR BOTTLE SIZE
-- ══════════════════════════════════════════════════════════════════════════
-- MVR 6.50 per 100ml. Our bottle is 700ml, so bottle-for-bottle they charge
-- 6.50 x 7 = MVR 45.50 against our 37.
insert into competitor_prices (competitor_id, variant_id, price_mvr, price_basis, observed_date)
values ('00000000-0000-0000-0000-000000000e30', '00000000-0000-0000-0000-000000000e21',
        6.50, 'per_100ml', current_date);

select is(
  (select round(price_per_piece, 2) from v_competitor_price_normalized
    where variant_id = '00000000-0000-0000-0000-000000000e21' and price_basis = 'per_100ml'),
  45.50::numeric,
  'a per-100ml price is restated at our own bottle size'
);

select is(
  (select buys_like from v_competitor_price_normalized
    where variant_id = '00000000-0000-0000-0000-000000000e21' and price_basis = 'per_100ml'),
  'shelf',
  'and counts as a shelf price, so it reaches the comparison like any other'
);

-- It is a real comparison, so the gap must be real too: 45.50 against our 37.
select is(
  (select round(gap_pct, 1) from get_competitor_price_gaps(-100)
    where sku_id = '00000000-0000-0000-0000-000000000e22'),
  -18.7::numeric,
  'we are 18.7% cheaper than a rival charging MVR 6.50 per 100ml'
);

-- ══════════════════════════════════════════════════════════════════════════
-- WITHOUT OUR OWN SIZE IT STAYS HONEST
-- ══════════════════════════════════════════════════════════════════════════
-- The Body Shop tubs are in this state deliberately: Ali gave a figure for
-- Sosoft and not for those, and an invented net content is worse than a blank.
insert into competitor_prices (competitor_id, variant_id, price_mvr, price_basis, observed_date)
values ('00000000-0000-0000-0000-000000000e30', '00000000-0000-0000-0000-000000000e23',
        6.50, 'per_100ml', current_date);

select is(
  (select buys_like from v_competitor_price_normalized
    where variant_id = '00000000-0000-0000-0000-000000000e23' and price_basis = 'per_100ml'),
  'uncomparable',
  'a per-100ml price against a product of unknown size says so'
);

-- And never guesses a number for it.
select ok(
  (select price_per_piece is null from v_competitor_price_normalized
    where variant_id = '00000000-0000-0000-0000-000000000e23' and price_basis = 'per_100ml'),
  'rather than inventing a size to make the arithmetic work'
);

select * from finish();
rollback;

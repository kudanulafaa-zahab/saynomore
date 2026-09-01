-- A carton he cannot sell should be SAID, not forbidden.
--
-- Ali, 2026-08-30, blocked mid-sale:
--   *"mamypoko xtra kering xxxl 32pcs/pack which comes in 3 packs per carton.
--    I cannot sell by carton. The feature is not there."*
--
-- MAMY-XTRA-XXXL-32x3 was `sellable_units = {pack}` while arriving 3 packs to a
-- carton and carrying a carton price of MVR 790. Every screen obeyed {pack},
-- correctly — sellableTiers() offers exactly what a SKU says it sells.
--
-- ── THE FIRST FIX WAS WRONG AND THIS SUITE IS THE SECOND ──────────────────
--
-- 0234 fixed the row and then added a CHECK: a carton of more than one pack
-- must be sellable. Four suites stopped mid-file, and they were right to.
-- pricing_health.test.sql keeps a pack-only 34x3 with a catastrophic carton
-- price precisely to prove the carton is IGNORED — "the product is never sold
-- by the carton, so it is not a real loss and must not be flagged" — and
-- price_review.test.sql has set_selling_prices REFUSE a carton price on a
-- pack-only SKU. Pack-only is a supported, defended state.
--
-- So the defect was never an illegal row. It was a legal one that NOTHING TOLD
-- HIM ABOUT, found with a customer waiting. That is a job for Setup Gaps — the
-- panel on Products that already says "no price for a carton" — not for DDL.
--
-- These assertions therefore pin BOTH directions: the gap must appear, and the
-- state must stay legal. A future guard that forbids it again fails here.

begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000f10', 'test-cartonsell@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000f10';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000f10', true);

insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000f20',
        (select id from brands limit 1), (select id from product_categories limit 1),
        'Test Carton Sellable Range');
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000f21', '00000000-0000-0000-0000-000000000f20',
        'CartonSell XXXL', '{"size":"XXXL-cartonsell"}'::jsonb);

-- ══════════════════════════════════════════════════════════════════════════
-- THE STATE STAYS LEGAL — WITH A CARTON PRICE ON IT, AS pricing_health NEEDS
-- ══════════════════════════════════════════════════════════════════════════
-- Exactly the shape 0234 outlawed: arrives 3 packs to a carton, sold only by
-- the pack, and carrying a carton price that must simply be ignored.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000f22', '00000000-0000-0000-0000-000000000f21',
        'TEST-CARTONSELL-32x3', 32, 3, 40, 30, 25, 290, 100, array['pack']);

select is(
  (select sellable_units from skus where id = '00000000-0000-0000-0000-000000000f22'),
  array['pack'],
  'a product that arrives in cartons may still be sold only by the pack'
);

-- ══════════════════════════════════════════════════════════════════════════
-- ...AND IT IS SAID OUT LOUD
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from get_setup_gaps()
    where sku_id = '00000000-0000-0000-0000-000000000f22' and gap = 'carton_not_sellable'),
  1,
  'and Setup Gaps says so, which is what nobody ever told Ali'
);

select is(
  (select headline from get_setup_gaps()
    where sku_id = '00000000-0000-0000-0000-000000000f22' and gap = 'carton_not_sellable'),
  'Cannot be sold by the carton',
  'in the words of the problem he hit, not a field name'
);

-- The line must name the real container. A diaper arrives in PACKS to a carton
-- and a Sosoft in BOTTLES — never a hardcoded "pack", and never a piece count.
select ok(
  (select blocks like '%to a carton%' and blocks not like '%piece%'
     from get_setup_gaps()
    where sku_id = '00000000-0000-0000-0000-000000000f22' and gap = 'carton_not_sellable'),
  'and counts what arrives in the unit the product is traded in'
);

-- ══════════════════════════════════════════════════════════════════════════
-- IT DOES NOT FIRE WHERE THERE IS NO CARTON TO SELL
-- ══════════════════════════════════════════════════════════════════════════
-- A carton holding one pack is the same thing twice — Body Shop's tubs. Saying
-- "cannot be sold by the carton" there would be noise, and this panel is
-- silent when healthy on purpose.
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-000000000f23', '00000000-0000-0000-0000-000000000f20',
        'CartonSell Tub', '{"size":"tub-cartonsell"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000f24', '00000000-0000-0000-0000-000000000f23',
        'TEST-CARTONSELL-1x1', 1, 1, 20, 20, 20, 120, array['pack']);

select is(
  (select count(*)::int from get_setup_gaps()
    where sku_id = '00000000-0000-0000-0000-000000000f24' and gap = 'carton_not_sellable'),
  0,
  'a carton holding one pack raises nothing — there is no second unit'
);

-- And the fixed product is quiet, which is the state Ali is now in.
update skus set sellable_units = array['pack','carton']
 where id = '00000000-0000-0000-0000-000000000f22';

select is(
  (select count(*)::int from get_setup_gaps()
    where sku_id = '00000000-0000-0000-0000-000000000f22' and gap = 'carton_not_sellable'),
  0,
  'and once the carton is sellable the panel goes quiet again'
);

select * from finish();
rollback;

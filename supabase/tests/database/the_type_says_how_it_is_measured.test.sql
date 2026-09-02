-- Grams or millilitres is a fact about the KIND of product, not about each one.
--
-- Ali, 2026-09-02, asked which unit the Body Shop tubs are measured in:
--   *"Bodyshop in g"*
--
-- One answer, five products. Edit SKU asked each of them separately with an
-- ml/g pill that defaulted to "ml", and the product type — the authority
-- 0236/0238 established for how a kind of product behaves — had no opinion at
-- all. Worse, the type COULD not have one: creating a type asks "what do you
-- call one of them?" and that single list mixes container nouns (Tub, Bottle,
-- Bar) with measures (Liquid, Powder), so picking "Tub" forced cost_basis
-- 'piece' and a body butter could be a tub or be weighed, never both.
--
-- These assertions are about the RULE — the type decides, it cannot walk away
-- from a unit its own products are written in, and it says what is left to
-- type — not about any particular product.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000009c1', 'test-measure@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009c1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009c1', true);

-- A kind of product that is a CONTAINER and is also MEASURED — the body butter
-- shape, and the combination the app could not express.
insert into product_categories (id, name, unit_uom, cost_basis, variant_attributes,
                                default_sellable_units, duty_rate_pct)
values ('00000000-0000-0000-0000-0000000009c2', 'Test Butter', 'tub', 'piece',
        '["size"]'::jsonb, array['pack'], 0);

insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-0000000009c3',
        (select id from brands limit 1), '00000000-0000-0000-0000-0000000009c2',
        'Test Butter Range');
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-0000000009c4', '00000000-0000-0000-0000-0000000009c3',
        'Moringa', '{"size":"measure-moringa"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000009c5', '00000000-0000-0000-0000-0000000009c4',
        'TEST-MEASURE-1x1', 1, 1, 20, 20, 20, 380, array['pack']);

-- ══════════════════════════════════════════════════════════════════════════
-- 1. A TUB CAN BE WEIGHED
-- ══════════════════════════════════════════════════════════════════════════
-- The whole point. Its container noun stays "tub" and its contents are grams;
-- before this the two answers competed for one field.
select is(
  (select set_category_measure('00000000-0000-0000-0000-0000000009c2'::uuid, 'g')),
  1,
  'a type can be told it is measured by weight, and says 1 product still needs a size'
);

select is(
  (select cost_basis from product_categories where id = '00000000-0000-0000-0000-0000000009c2'),
  'per_100g',
  'so a rival price per 100g finally has something to compare against'
);

select is(
  (select unit_uom from product_categories where id = '00000000-0000-0000-0000-0000000009c2'),
  'tub',
  'and it is still a tub — the container and the measure are separate facts'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. THE COUNT IS WHAT IS LEFT TO TYPE
-- ══════════════════════════════════════════════════════════════════════════
-- A net content nobody has entered is the difference between a comparison and
-- a blank, so the number the screen shows him has to be the real one.
update skus set unit_size = 200, unit_size_uom = 'g'
 where id = '00000000-0000-0000-0000-0000000009c5';

select is(
  (select set_category_measure('00000000-0000-0000-0000-0000000009c2'::uuid, 'g')),
  0,
  'once every product carries a size, nothing is left to ask for'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. A TYPE CANNOT WALK AWAY FROM THE UNIT ITS PRODUCTS ARE WRITTEN IN
-- ══════════════════════════════════════════════════════════════════════════
-- 200 g is not 200 ml, and the difference is density rather than arithmetic.
-- Relabelling silently would be a data loss nobody could see.
select throws_ok(
  $$select set_category_measure('00000000-0000-0000-0000-0000000009c2'::uuid, 'ml')$$,
  '22023',
  null,
  'switching g to ml is refused while a product records a size in grams'
);

select throws_ok(
  $$select set_category_measure('00000000-0000-0000-0000-0000000009c2'::uuid, null)$$,
  '22023',
  null,
  'and so is dropping the measure altogether'
);

select is(
  (select unit_size_uom from skus where id = '00000000-0000-0000-0000-0000000009c5'),
  'g',
  'the size already recorded is left exactly as it was'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 4. ONLY ml, g, OR NOT MEASURED
-- ══════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$select set_category_measure('00000000-0000-0000-0000-0000000009c2'::uuid, 'oz')$$,
  '22023',
  null,
  'a unit nothing in the app can display is refused at the door'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. AND NOT BY ANYONE HOLDING THE PUBLISHABLE KEY
-- ══════════════════════════════════════════════════════════════════════════
-- CREATE FUNCTION grants EXECUTE to PUBLIC and Supabase grants it to anon
-- separately; revoking either one alone leaves it callable. This asks the only
-- question that settles it, and it has already caught two attempts that read
-- as closed.
select ok(
  not has_function_privilege('anon', 'public.set_category_measure(uuid, text)', 'execute'),
  'and anon cannot change how anything is measured'
);

select * from finish();
rollback;

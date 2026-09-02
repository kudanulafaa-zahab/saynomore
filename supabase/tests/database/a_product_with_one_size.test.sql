-- A product with one size does not have a size.
--
-- Ali, 2026-09-02, with a screenshot of Edit Product:
--   *"When you edited the size field you have entered bodymilk there. Now I
--    can't change it. Even when I delete it and save the name 'bodymilk' is
--    still there."*
--
-- A Body Shop tub is one product — no 200 ml against 400 ml to choose between.
-- The catalogue is three levels, so a variant had to exist, and the product
-- name was copied into it. Renaming the product left the copy behind, and the
-- form read a cleared box as "no change" and reported success.
--
-- `variants.attributes` is what makes a variant a real size. Empty means there
-- is no size axis, and for those the name is not information — it is the
-- product's name written twice. So it is DERIVED, like CBM.
--
-- These assertions are about the rule in both directions: a name with no size
-- axis follows its product and cannot be typed; a real size is never touched.

begin;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000009d1', 'test-onesize@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009d1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009d1', true);

insert into brands (id, name) values ('00000000-0000-0000-0000-0000000009d2', 'Test OneSize Brand');
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-0000000009d3', '00000000-0000-0000-0000-0000000009d2',
        (select id from product_categories limit 1), 'Bodymilk');

-- A product with NO size axis — the tub.
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-0000000009d4', '00000000-0000-0000-0000-0000000009d3',
        'Bodymilk', '{}'::jsonb);

-- ...and one WITH a real size, under its own product, to prove the rule is
-- narrow. A diaper's "XXL" must survive everything below.
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-0000000009d5', '00000000-0000-0000-0000-0000000009d2',
        (select id from product_categories limit 1), 'Test OneSize Nappies');
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-0000000009d6', '00000000-0000-0000-0000-0000000009d5',
        'XXL', '{"size":"XXL"}'::jsonb);

-- ══════════════════════════════════════════════════════════════════════════
-- 1. RENAMING THE PRODUCT RENAMES THE SIZE THAT IS NOT A SIZE
-- ══════════════════════════════════════════════════════════════════════════
-- The exact correction Ali made and could not finish.
select lives_ok(
  $$select rename_catalogue_part('model', '00000000-0000-0000-0000-0000000009d3', 'Almond Milk')$$,
  'a product with one size can be renamed'
);

select is(
  (select display_name from variants where id = '00000000-0000-0000-0000-0000000009d4'),
  'Almond Milk',
  'and the size that was only ever a copy of its name follows it'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. A REAL SIZE IS NOT TOUCHED BY ITS PRODUCT'S NAME
-- ══════════════════════════════════════════════════════════════════════════
-- The rule has to be narrow, or renaming "Xtra Kering" would rewrite XXL.
select lives_ok(
  $$select rename_catalogue_part('model', '00000000-0000-0000-0000-0000000009d5', 'Xtra Test')$$,
  'a product with real sizes can be renamed too'
);

select is(
  (select display_name from variants where id = '00000000-0000-0000-0000-0000000009d6'),
  'XXL',
  'and its sizes keep their own names — XXL is not a copy of anything'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. A SIZE THAT IS NOT A SIZE CANNOT BE NAMED SEPARATELY
-- ══════════════════════════════════════════════════════════════════════════
-- Typing here is what let the two drift apart in the first place. The screen
-- no longer asks; this closes the door behind it.
select throws_ok(
  $$select rename_catalogue_part('variant', '00000000-0000-0000-0000-0000000009d4', 'Bodymilk')$$,
  '22023',
  null,
  'and it cannot be given a name of its own — that is what drifted'
);

-- A real size still can be, which is the whole point of keeping them apart.
select lives_ok(
  $$select rename_catalogue_part('variant', '00000000-0000-0000-0000-0000000009d6', 'XXXL')$$,
  'while a real size is still renamed by hand'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 4. AND NOT BY ANYONE HOLDING THE PUBLISHABLE KEY
-- ══════════════════════════════════════════════════════════════════════════
-- CREATE OR REPLACE preserves existing grants, so a rewritten function can
-- carry an old one forward. This asks the only question that settles it.
select ok(
  not has_function_privilege('anon', 'public.rename_catalogue_part(text, uuid, text)', 'execute'),
  'anon cannot rename anything in the catalogue'
);

select * from finish();
rollback;

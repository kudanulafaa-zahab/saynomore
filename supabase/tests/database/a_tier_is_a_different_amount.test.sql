-- A selling tier is only a tier if it is a DIFFERENT AMOUNT.
--
-- Ali, 2026-09-02, with a screenshot of Edit Product on a Body Shop tub:
--   *"what is this single tub and tub and carton in 'sold in'? ... This is not
--    intelligent I don't even know what sold in tub, single tub means"*
--   *"Bodyshop are sold in tubs. I can sell x number of tubs. It's never
--    cartons."*
--
-- Three buttons for one object: that tub is 1 to a pack and 1 to a carton, so
-- "Single tub", "Tub" and "Carton" are the same thing at the same price.
--
-- The forms are fixed alongside this. These assertions cover the two doors the
-- forms cannot close — a product INHERITING a carton from its type, and the
-- type PROPAGATING one onto a product that has no room for it. A rule enforced
-- only on the screen he happened to be looking at is not a rule.

begin;
select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000009e1', 'test-tier@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009e1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009e1', true);

-- A kind of product that genuinely sells BOTH ways — the trap. Everything
-- below is about a single product under it that has no carton.
insert into product_categories (id, name, unit_uom, cost_basis, variant_attributes,
                                default_sellable_units, duty_rate_pct)
values ('00000000-0000-0000-0000-0000000009e2', 'Test Tier Cat', 'tub', 'piece',
        '["size"]'::jsonb, array['pack','carton'], 0);

-- ══════════════════════════════════════════════════════════════════════════
-- 1. A NEW PRODUCT NEVER INHERITS A CARTON IT HAS NO ROOM FOR
-- ══════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$select create_sku_full('Test Tier Brand',
      '00000000-0000-0000-0000-0000000009e2'::uuid,
      'Tub Range', 'Plain', 'TEST-TIER-1x1', 1, 1)$$,
  'a one-to-a-carton product can be created under a type that sells cartons'
);

select is(
  (select sellable_units from skus where internal_code = 'TEST-TIER-1x1'),
  array['pack'],
  'and it is sold one way only — a carton of one tub is not a second amount'
);

-- The same type, a product that DOES have a carton. The rule has to be narrow.
select lives_ok(
  $$select create_sku_full('Test Tier Brand',
      '00000000-0000-0000-0000-0000000009e2'::uuid,
      'Tub Range', 'Big', 'TEST-TIER-34x3', 34, 3)$$,
  'and a product with a real carton is created under the same type'
);

select is(
  (select sellable_units from skus where internal_code = 'TEST-TIER-34x3'),
  array['pack','carton'],
  'and it keeps both, because 3 packs really is a different amount'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. NOR DOES THE TYPE PUSH ONE ON LATER
-- ══════════════════════════════════════════════════════════════════════════
-- 0238 propagates the type to every active product. Without this, one tap on
-- the type sheet would undo the form fix for every tub at once.
select is(
  (select set_category_sellable_units('00000000-0000-0000-0000-0000000009e2'::uuid,
                                      array['pack','carton'])),
  0,
  'setting the type to what it already says moves nothing'
);

select is(
  (select sellable_units from skus where internal_code = 'TEST-TIER-1x1'),
  array['pack'],
  'and the tub is still sold one way after the type says cartons'
);

-- Going the other way DOES reach both, because pack-only is available to any
-- product — proving the filter is about room, not about refusing to propagate.
select is(
  (select set_category_sellable_units('00000000-0000-0000-0000-0000000009e2'::uuid,
                                      array['pack'])),
  1,
  'narrowing the type to packs moves only the product that had a carton'
);

select is(
  (select sellable_units from skus where internal_code = 'TEST-TIER-34x3'),
  array['pack'],
  'and that product follows its type'
);

select * from finish();
rollback;

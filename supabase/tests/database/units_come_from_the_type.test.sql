-- How a product is sold comes from its TYPE. One place, inherited, propagated.
--
-- Ali, 2026-09-01:
--   *"I can sell diapers by packs or cartons/cases. But it never comes as
--    individual pieces. But I can sell detergent as individual bottles or mixed
--    bottles of x amount cartons or one variant of a whole carton... So you're
--    just editing what I specifically ask in that instance and doing adhoc job
--    corrections and making things complicated. Never applying expert
--    research."*
--
-- He was right. 0234 invented a constraint for one row, 0235 withdrew it, and
-- both were about a single product. The rule he was describing — a kind of
-- product is sold one way — is the UNIT OF MEASURE GROUP every ERP implements
-- (Sage, SYSPRO), the packaging hierarchy in Oracle, packagings in Odoo:
-- declared once on the item CATEGORY, inherited by every item.
--
-- `product_categories.default_sellable_units` had existed all along and was
-- read NOWHERE. create_sku_full defaulted to ARRAY['pack','carton'] and then
-- coalesced to it again, and the TypeScript caller passed the same guess a
-- third time, so every product was born hand-typed and free to drift.
--
-- These assertions are about the RULE in all three directions: a new product
-- inherits, a changed type brings its products with it, and a product that
-- disagrees is said out loud with somewhere to go.

begin;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000009a1', 'test-typeunits@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009a1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009a1', true);

-- A kind of product sold two ways, like diapers.
insert into product_categories (id, name, unit_uom, cost_basis, variant_attributes,
                                default_sellable_units, duty_rate_pct)
values ('00000000-0000-0000-0000-0000000009a2', 'Test Nappies', 'pcs', 'piece',
        '["size"]'::jsonb, array['pack','carton'], 0);

-- ══════════════════════════════════════════════════════════════════════════
-- 1. A NEW PRODUCT INHERITS ITS TYPE
-- ══════════════════════════════════════════════════════════════════════════
-- Created WITHOUT saying how it is sold — which is the normal case, and the one
-- that used to silently receive a guess.
select lives_ok(
  $$select create_sku_full('Test TypeUnits Brand',
      '00000000-0000-0000-0000-0000000009a2'::uuid,
      'Range A', 'XXXL', 'TEST-TYPEUNITS-32x3', 32, 3)$$,
  'a product can be created without being told how it is sold'
);

select is(
  (select sellable_units from skus where internal_code = 'TEST-TYPEUNITS-32x3'),
  array['pack','carton'],
  'and it inherits both units from its product type'
);

-- An explicit value is still an override, as in every ERP that has UoM groups.
select lives_ok(
  $$select create_sku_full('Test TypeUnits Brand',
      '00000000-0000-0000-0000-0000000009a2'::uuid,
      'Range A', 'XL', 'TEST-TYPEUNITS-30x4', 30, 4, array['pack'])$$,
  'and a deliberate override is still allowed'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. ...AND AN OVERRIDE IS NEVER SILENT
-- ══════════════════════════════════════════════════════════════════════════
-- This is what nobody ever told Ali about MAMY-XTRA-XXXL-32x3.
select is(
  (select count(*)::int from get_setup_gaps() g
     join skus s on s.id = g.sku_id
    where s.internal_code = 'TEST-TYPEUNITS-30x4' and g.gap = 'units_differ_from_type'),
  1,
  'a product sold differently from its kind is said out loud'
);

-- And it carries WHERE to fix it — the type, not the product. Every other gap
-- is fixed on the product; this one is the first that is not.
select is(
  (select category_id from get_setup_gaps() g
     join skus s on s.id = g.sku_id
    where s.internal_code = 'TEST-TYPEUNITS-30x4' and g.gap = 'units_differ_from_type'),
  '00000000-0000-0000-0000-0000000009a2'::uuid,
  'and points at the product type, which is the only screen that can change it'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. CHANGING THE TYPE BRINGS ITS PRODUCTS WITH IT
-- ══════════════════════════════════════════════════════════════════════════
-- "I must be change product conditions when I want it at any given time." A
-- setting that only affects products not yet created is not a setting.
select is(
  (select set_category_sellable_units('00000000-0000-0000-0000-0000000009a2'::uuid,
                                      array['pack','carton'])),
  1,
  'changing the type updates the products that disagree — and only those'
);

select is(
  (select sellable_units from skus where internal_code = 'TEST-TYPEUNITS-30x4'),
  array['pack','carton'],
  'so the overridden product now follows its kind'
);

-- Setting a type to what it already says must touch nothing, or the audit log
-- fills with entries recording that nothing happened.
select is(
  (select set_category_sellable_units('00000000-0000-0000-0000-0000000009a2'::uuid,
                                      array['pack','carton'])),
  0,
  'and saying it again changes nothing at all'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 4. A KIND OF PRODUCT NOBODY CAN BUY IS NOT A KIND OF PRODUCT
-- ══════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$select set_category_sellable_units('00000000-0000-0000-0000-0000000009a2'::uuid,
                                       array[]::text[])$$,
  '22023',
  null,
  'and a type must be sold as something'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. A CARTON OF ONE PACK CANNOT DISAGREE ABOUT ANYTHING
-- ══════════════════════════════════════════════════════════════════════════
-- A tub is 1 to a pack and 1 to a carton, so for it a carton IS the pack —
-- "sells cartons too" and "does not" describe the same object. Flagging that
-- is noise on a panel whose discipline is that every line is actionable, and
-- the action would be to tick a box that changes nothing anyone can buy.
-- 0234 and 0235 both carved this out; 0236 generalised the rule and dropped
-- the carve-out on the way past, which is what 0239 put back.
insert into variants (id, model_id, display_name, attributes)
values ('00000000-0000-0000-0000-0000000009a3',
        (select id from product_models where name = 'Range A'
          and category_id = '00000000-0000-0000-0000-0000000009a2' limit 1),
        'Tub', '{"size":"tub-typeunits"}'::jsonb);
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000009a4', '00000000-0000-0000-0000-0000000009a3',
        'TEST-TYPEUNITS-1x1', 1, 1, 20, 20, 20, 380, array['pack']);

select is(
  (select count(*)::int from get_setup_gaps()
    where sku_id = '00000000-0000-0000-0000-0000000009a4' and gap = 'units_differ_from_type'),
  0,
  'a product whose carton holds one pack is never reported as sold differently'
);

select * from finish();
rollback;

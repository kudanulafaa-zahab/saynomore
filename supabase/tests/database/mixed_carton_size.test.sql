-- A mixed carton holds whatever a carton holds.
--
-- Ali sells Sosoft three ways: a single bottle, a MIXED carton of 6 assorted
-- colours, and a whole carton of one colour.
--
-- `brands.mixed_carton_pieces` said 6. Every Sosoft product independently said
-- pcs_per_pack 1 x packs_per_carton 6, which is also 6. Two copies of one fact
-- in two tables, with nothing keeping them in step — and a mixed carton is a
-- carton somebody filled with different colours, so its size was never a
-- separate fact to begin with.
--
-- ── WHAT THE SECOND COPY COSTS ────────────────────────────────────────────
--
-- The day a supplier changes the case, they part company. Driven on production
-- before this was written: set a Sosoft carton to 12 bottles and the mixed
-- carton would still have priced at 6 x the bottle rate — MVR 222 against the
-- MVR 444 of goods actually in the box — while every whole-carton line on the
-- SAME product billed 12. One product, two arithmetics, no complaint from
-- anywhere.
--
-- So the size is derived and the brand column keeps only the part that is
-- genuinely a policy: WHETHER this brand may be sold assorted at all.

begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000009c1', 'test-mixsize@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009c1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009c1', true);

insert into product_categories (id, name, unit_uom, cost_basis, variant_attributes,
                                default_sellable_units, duty_rate_pct)
values ('00000000-0000-0000-0000-0000000009c2', 'Test Mix Liquid', 'ml', 'per_100ml',
        '["colour"]'::jsonb, array['pack','carton'], 0);

-- A brand that MAY be sold assorted, and one that may not.
insert into brands (id, name, mixed_carton_pieces)
values ('00000000-0000-0000-0000-0000000009c3', 'Test Mix Brand', 6);
insert into brands (id, name)
values ('00000000-0000-0000-0000-0000000009c4', 'Test Plain Brand');

insert into product_models (id, brand_id, category_id, name) values
  ('00000000-0000-0000-0000-0000000009c5', '00000000-0000-0000-0000-0000000009c3',
   '00000000-0000-0000-0000-0000000009c2', 'Mix Model'),
  ('00000000-0000-0000-0000-0000000009c6', '00000000-0000-0000-0000-0000000009c4',
   '00000000-0000-0000-0000-0000000009c2', 'Plain Model');

insert into variants (id, model_id, display_name, attributes) values
  ('00000000-0000-0000-0000-0000000009c7', '00000000-0000-0000-0000-0000000009c5',
   'Red', '{"colour":"red-mixsize"}'::jsonb),
  ('00000000-0000-0000-0000-0000000009c8', '00000000-0000-0000-0000-0000000009c6',
   'Plain', '{"colour":"plain-mixsize"}'::jsonb);

-- One bottle to a "pack", six to a carton — the Sosoft shape.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units) values
  ('00000000-0000-0000-0000-0000000009c9', '00000000-0000-0000-0000-0000000009c7',
   'TEST-MIXSIZE-1x6', 1, 6, 30, 20, 25, 37, array['pack','carton']),
  ('00000000-0000-0000-0000-0000000009ca', '00000000-0000-0000-0000-0000000009c8',
   'TEST-PLAINSIZE-1x6', 1, 6, 30, 20, 25, 37, array['pack','carton']);

-- ══════════════════════════════════════════════════════════════════════════
-- THE SIZE IS THE CARTON'S SIZE
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select mixed_carton_pieces from v_skus where internal_code = 'TEST-MIXSIZE-1x6'),
  6,
  'a mixed carton holds what the product''s own carton holds'
);

-- ...AND THE FLAG IS STILL THE FLAG. A brand that is not sold assorted has no
-- mixed carton at all, which is what the sale sheet reads to decide whether to
-- offer one.
select ok(
  (select mixed_carton_pieces is null from v_skus where internal_code = 'TEST-PLAINSIZE-1x6'),
  'and a brand not sold assorted offers no mixed carton'
);

-- ══════════════════════════════════════════════════════════════════════════
-- THE DRIFT IS NOW IMPOSSIBLE, NOT MERELY UNLIKELY
-- ══════════════════════════════════════════════════════════════════════════
-- The supplier changes the case to 12. The stored 6 on the brand is untouched
-- and now WRONG; the number the app reads must follow the goods.
select set_config('app.pack_restatement', 'on', true);
update skus set packs_per_carton = 12 where internal_code = 'TEST-MIXSIZE-1x6';

select is(
  (select mixed_carton_pieces from v_skus where internal_code = 'TEST-MIXSIZE-1x6'),
  12,
  'change the case and the mixed carton follows it'
);

select is(
  (select mixed_carton_pieces from brands where id = '00000000-0000-0000-0000-0000000009c3'),
  6,
  'even though the old copy on the brand still says 6 — which is why it is no longer read'
);

-- The money, said plainly: at MVR 37 a bottle a full mixed carton is 12 x 37,
-- not 6 x 37. Under the old model this product quoted half of what was in it.
select is(
  (select 37 * mixed_carton_pieces from v_skus where internal_code = 'TEST-MIXSIZE-1x6'),
  444,
  'so a full mixed carton is priced on what is actually in the box'
);

-- ══════════════════════════════════════════════════════════════════════════
-- AND THE VIEW KEEPS ITS ROW SECURITY
-- ══════════════════════════════════════════════════════════════════════════
-- pg_get_viewdef returns the query and NOT the options, so every rebuild of
-- v_skus silently drops security_invoker. That happened for real in 0230.
-- 0240 rebuilds it again, so the guard belongs beside the change.
select ok(
  (select 'security_invoker=on' = any(coalesce(c.reloptions, '{}'))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_skus'),
  'and rebuilding v_skus did not drop security_invoker'
);

select * from finish();
rollback;

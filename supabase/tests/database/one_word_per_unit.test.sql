-- Pass 25: a product never sells the same unit under two names.
-- Regression guard for migration 0210.
--
-- Ali, 2026-08-25, with a screenshot of the Giveaway sheet:
-- *"there is 2 bottles option when I choose sosoft. Check what it is without
-- breaking anything."*
--
-- ── WHAT IT WAS ─────────────────────────────────────────────────────────────
--
-- The unit toggle read `ctn | btl | btl`. The five Sosoft SKUs carried
-- sellable_units = {carton, pack, piece}, and for a 1 x 6 product `pack` and
-- `piece` are the same physical thing — one bottle. `sellUnitLabel` gives them
-- the same word on purpose ("never says 'piece' for a product whose pack IS one
-- unit"), so the same choice appeared twice.
--
-- Migration 0208 could not have caught it: it only rewrote SKUs whose tiers
-- were exactly {carton}, so a SKU already carrying `piece` was skipped, and
-- 0208's own guard still passed because `'pack' = any(sellable_units)` was
-- already true. The rule lived in prose in CLAUDE.md and in a comment in
-- lib/trade-units.ts — and in nobody's code, which is how five SKUs drifted for
-- weeks with no test going red.
--
-- ── AND THE HALF THAT MUST NOT BREAK ────────────────────────────────────────
--
-- "Without breaking anything" were his words. A real pack of MANY may still
-- carry a loose tier, because there a pack and a piece are genuinely different
-- things — CLAUDE.md keeps the loose tier in Stock Ops deliberately, since a
-- torn pack is real. Test 3 is what stops this constraint quietly taking the
-- write-off tier away from every diaper.

begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000250', 'test-oneword@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000250';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000250', true);

insert into product_categories (id, name, unit_uom, cost_basis)
values ('00000000-0000-0000-0000-000000000251', 'OneWord Liquid', 'ml', 'per_100ml');
insert into brands (id, name) values ('00000000-0000-0000-0000-000000000252', 'OneWord Brand');
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000253', '00000000-0000-0000-0000-000000000252',
        '00000000-0000-0000-0000-000000000251', 'OneWord Model');
insert into variants (id, model_id, display_name)
values ('00000000-0000-0000-0000-000000000254', '00000000-0000-0000-0000-000000000253', 'OneWord 700ml');

-- ── THE WORD IS THE SAME, WHICH IS WHY THE TIERS CANNOT BOTH EXIST ─────────
-- Asserted first, because it is the whole argument: if a bottle were called a
-- "piece" the two tiers would at least be distinguishable on screen, and this
-- constraint would be about tidiness instead of about a real ambiguity.
select is(
  unit_noun('ml'), 'bottle',
  'one of them is called a BOTTLE, so a pack tier and a piece tier print the same word'
);

-- ── A 1-PER-PACK SKU CANNOT CARRY BOTH ─────────────────────────────────────
select throws_ok(
  $$insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, sellable_units)
    values ('00000000-0000-0000-0000-000000000254', 'ONEWORD-DUP-1x6', 1, 6,
            array['pack','piece','carton']::text[])$$,
  '23514',
  null,
  'a product whose pack IS one unit is refused when it also claims a piece tier'
);

-- ── BUT A REAL PACK OF MANY MAY ────────────────────────────────────────────
-- THE GUARD ON THE GUARD. A constraint that also refused this would silently
-- remove the loose tier from every diaper, and the write-off screen with it.
select lives_ok(
  $$insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, sellable_units)
    values ('00000000-0000-0000-0000-000000000254', 'ONEWORD-REAL-48x4', 48, 4,
            array['pack','piece','carton']::text[])$$,
  'a real pack of 48 may still carry a loose tier — there a pack and a piece are different things'
);

-- ── AND THE ORDINARY SHAPE IS UNTOUCHED ────────────────────────────────────
select lives_ok(
  $$insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, sellable_units)
    values ('00000000-0000-0000-0000-000000000254', 'ONEWORD-BOTTLE-1x6', 1, 6,
            array['pack','carton']::text[])$$,
  'a bottle that sells singly and by the carton is exactly as before'
);

-- ── NOTHING IN THE CATALOGUE STILL DOES IT ─────────────────────────────────
-- The data half. The constraint stops the next one; this proves the five that
-- were already wrong were actually repaired rather than merely forbidden.
select is(
  (select count(*)::int from skus
    where pcs_per_pack = 1
      and 'piece' = any(sellable_units) and 'pack' = any(sellable_units)),
  0,
  'and no product in the catalogue still offers the same unit twice'
);

-- ── THE MIXED CARTON IS UNTOUCHED ──────────────────────────────────────────
-- The thing Ali has twice asked to be left alone. It is gated on the BRAND, not
-- on sellable_units, so removing a tier cannot reach it — but "cannot reach it"
-- is an argument, and this is evidence.
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'assert_whole_mixed_cartons'
      and pg_get_functiondef(p.oid) ~ 'sellable_units'),
  0,
  'the whole-carton rule never reads sellable_units, so the mixed carton cannot be affected'
);

select * from finish();
rollback;

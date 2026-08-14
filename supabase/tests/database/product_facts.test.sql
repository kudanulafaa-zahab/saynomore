-- product_claims / product_size_ladders — nothing may be said that no source says.
--
-- These tables exist to be a CONSTRAINT, not a convenience. Everything built on
-- top of them (marketing copy, the size-up prompt, customer education) will be
-- generating sentences about real products that a real parent reads, and the
-- only thing standing between that and an invented claim is whether a row here
-- exists. So the tests below are mostly about what the schema REFUSES.
--
-- The fixture is built inside this file rather than taken from seed.sql, on
-- purpose. seed.sql has one generic "Test Category / Test Brand" chain and no
-- size ladder at all, so a test written against it would pass by finding
-- nothing — the vacuous green that reorder_censored_demand.test.sql was
-- rewritten to avoid. Two brands are created in ONE laddered category because
-- that is the case that actually bites: MamyPoko publishes ranges and Merries
-- publishes different ones, and a Merries baby must never be placed on
-- MamyPoko's ladder just because both sell nappies.

begin;
select plan(16);

-- ── Fixture ─────────────────────────────────────────────────────────────────
do $$
declare v_cat uuid; v_flat uuid; v_dup uuid; v_alpha uuid; v_beta uuid;
        v_am uuid; v_bm uuid; v_fm uuid; v_av uuid; v_bv uuid; v_fv uuid;
begin
  insert into product_categories (name, unit_uom, cost_basis, progression_unit, progression_noun)
  values ('Test Nappies', 'pcs', 'piece', 'kg', 'weight') returning id into v_cat;

  -- A category with NO progression, to prove the ladder is opt-in.
  insert into product_categories (name, unit_uom, cost_basis)
  values ('Test Soap', 'btl', 'piece') returning id into v_flat;

  -- A third category used only by the duplicate-default constraint check. It is
  -- kept apart from 'Test Nappies' deliberately: a brand_id-null row there would
  -- become the category DEFAULT ladder, and Beta — which is meant to have no
  -- ladder at all — would silently inherit it and turn that test green for the
  -- wrong reason.
  insert into product_categories (name, unit_uom, cost_basis)
  values ('Test Ladder Only', 'pcs', 'piece') returning id into v_dup;
  insert into product_size_ladders (category_id, brand_id, size_label, min_value, max_value, sort_order)
  values (v_dup, null, 'M', 7, 12, 2);

  insert into brands (name) values ('Alpha') returning id into v_alpha;
  insert into brands (name) values ('Beta')  returning id into v_beta;

  insert into product_models (brand_id, category_id, name)
  values (v_alpha, v_cat, 'Alpha Pants') returning id into v_am;
  insert into product_models (brand_id, category_id, name)
  values (v_beta, v_cat, 'Beta Pants') returning id into v_bm;
  insert into product_models (brand_id, category_id, name)
  values (v_alpha, v_flat, 'Alpha Soap') returning id into v_fm;

  -- Alpha publishes a ladder. Beta does not — that is the point.
  insert into product_size_ladders (category_id, brand_id, size_label, min_value, max_value, sort_order)
  values (v_cat, v_alpha, 'S', 4, 8, 1),
         (v_cat, v_alpha, 'M', 7, 12, 2),
         (v_cat, v_alpha, 'L', 9, 14, 3);

  -- One SKU per case: Alpha mid-ladder, Alpha top-of-ladder, Beta (no ladder),
  -- and a soap (category with no progression at all).
  insert into variants (id, model_id, display_name, attributes)
  values (gen_random_uuid(), v_am, 'Alpha M', '{"size":"M"}'::jsonb) returning id into v_av;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v_av, 'ALPHA-M-10x2', 10, 2);

  insert into variants (id, model_id, display_name, attributes)
  values (gen_random_uuid(), v_am, 'Alpha L', '{"size":"L"}'::jsonb) returning id into v_av;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v_av, 'ALPHA-L-10x2', 10, 2);

  insert into variants (id, model_id, display_name, attributes)
  values (gen_random_uuid(), v_bm, 'Beta M', '{"size":"M"}'::jsonb) returning id into v_bv;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v_bv, 'BETA-M-10x2', 10, 2);

  insert into variants (id, model_id, display_name, attributes)
  values (gen_random_uuid(), v_fm, 'Alpha Soap', '{}'::jsonb) returning id into v_fv;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v_fv, 'ALPHA-SOAP-1x6', 1, 6);

  -- A brand-wide claim and a model-specific one, so ordering can be checked.
  insert into product_claims (brand_id, claim_text, source_name, source_url, checked_on, sort_order)
  values (v_alpha, 'Brand level claim', 'Alpha Co', 'https://example.test/alpha', current_date, 1);
  insert into product_claims (model_id, claim_text, source_name, source_url, checked_on, sort_order)
  values (v_am, 'Model level claim', 'Alpha Co', 'https://example.test/pants', current_date, 1);
end $$;

-- ── What the schema REFUSES ────────────────────────────────────────────────

select throws_ok(
  $$insert into product_categories (name, unit_uom, cost_basis, progression_unit)
    values ('Half Declared', 'pcs', 'piece', 'kg')$$,
  '23514',
  null,
  'a category cannot declare a progression unit without saying what it measures'
);

select throws_ok(
  $$insert into product_claims (claim_text, source_name, source_url, checked_on)
    values ('orphan', 'X', 'https://x.test', current_date)$$,
  '23514',
  null,
  'a claim with no owner is refused — it could never be shown against a product'
);

select throws_ok(
  $$insert into product_claims (brand_id, model_id, claim_text, source_name, source_url, checked_on)
    select b.id, m.id, 'both', 'X', 'https://x.test', current_date
    from brands b, product_models m where b.name='Alpha' and m.name='Alpha Pants' limit 1$$,
  '23514',
  null,
  'a claim cannot belong to a brand AND a model — one owner, so precedence is never ambiguous'
);

select throws_ok(
  $$insert into product_claims (brand_id, claim_text, source_name, source_url, checked_on)
    select id, 'no source', 'Hearsay', 'i heard it somewhere', current_date from brands where name='Alpha'$$,
  '23514',
  null,
  'a claim without a real link is refused — an unsourced claim is the thing this table exists to stop'
);

select throws_ok(
  $$insert into product_size_ladders (category_id, brand_id, size_label, min_value, max_value, sort_order)
    select c.id, b.id, 'BAD', 12, 7, 9 from product_categories c, brands b
    where c.name='Test Nappies' and b.name='Alpha'$$,
  '23514',
  null,
  'a size range that ends before it begins is refused'
);

-- NULLS NOT DISTINCT: without it Postgres treats every null brand_id as unique
-- and a category could quietly hold two conflicting default ranges for one size.
select throws_ok(
  $$insert into product_size_ladders (category_id, brand_id, size_label, min_value, max_value, sort_order)
    select c.id, null, 'M', 6, 11, 2 from product_categories c where c.name='Test Ladder Only'$$,
  '23505',
  null,
  'a category cannot hold two default ranges for the same size'
);

-- ── What the reader ANSWERS ────────────────────────────────────────────────

select is(
  (select get_product_facts(id) #>> '{progression,next,label}' from skus where internal_code='ALPHA-M-10x2'),
  'L',
  'mid-ladder, the next size up is named'
);

select is(
  (select get_product_facts(id) #>> '{progression,current,max}' from skus where internal_code='ALPHA-M-10x2'),
  '12.00',
  'and the size a customer is on carries its published range'
);

-- JSON null, not SQL null: jsonb_build_object turns an empty scalar subquery
-- into the JSON literal `null`, so `is(..., null)` here would compare a jsonb
-- value against SQL NULL and fail. Verified on real data before being written.
select is(
  (select get_product_facts(id) #> '{progression,next}' from skus where internal_code='ALPHA-L-10x2'),
  'null'::jsonb,
  'at the top of the ladder there is no next size — never an invented one'
);

-- The case that motivated brand-scoping. Beta sells nappies in a category that
-- HAS a ladder, but Beta has not published one, so it gets nothing rather than
-- inheriting Alpha's ranges.
select is(
  (select get_product_facts(id) -> 'progression' from skus where internal_code='BETA-M-10x2'),
  'null'::jsonb,
  'a brand with no published ladder never inherits another brand''s ranges'
);

select is(
  (select get_product_facts(id) -> 'progression' from skus where internal_code='ALPHA-SOAP-1x6'),
  'null'::jsonb,
  'a category with no progression returns none — nothing is diaper-shaped by default'
);

select is(
  (select get_product_facts(id) #>> '{claims,0,text}' from skus where internal_code='ALPHA-M-10x2'),
  'Model level claim',
  'the claim about THIS product outranks the claim about the whole brand'
);

select is(
  (select jsonb_array_length(get_product_facts(id) -> 'claims') from skus where internal_code='ALPHA-M-10x2'),
  2,
  'and the brand-wide claim is still offered underneath it'
);

-- has_facts is the single flag every caller branches on, so both of its states
-- are checked. Beta has neither claims nor a ladder; Alpha's soap has a claim
-- through its brand but no ladder at all.
select is(
  (select (get_product_facts(id) ->> 'has_facts')::boolean from skus where internal_code='BETA-M-10x2'),
  false,
  'a product nothing is known about says so — the caller then claims nothing'
);

select is(
  (select (get_product_facts(id) ->> 'has_facts')::boolean from skus where internal_code='ALPHA-SOAP-1x6'),
  true,
  'a brand claim alone is enough to have facts, with no ladder in sight'
);

-- ── Least privilege (0169's lesson: check the grant, do not assume it) ──────
select is(
  (select has_function_privilege('anon', 'public.get_product_facts(uuid)', 'execute')),
  false,
  'anon cannot read product facts'
);

select * from finish();
rollback;

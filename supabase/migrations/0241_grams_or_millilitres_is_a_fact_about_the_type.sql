-- 0241 — grams or millilitres is a fact about the KIND of product.
--
-- Ali, 2026-09-02, asked which unit the Body Shop tubs are measured in:
--   *"Bodyshop in g"*
--
-- He answered a question the app could not have stored. Edit SKU offered an
-- ml/g pill per product, defaulting to "ml" for everything, so grams was a
-- choice he had to remember to make five times — and the product type, the
-- place 0236/0238 established as the authority on how a kind of product
-- behaves, had no opinion at all.
--
-- ── THE CONFLATION THAT MADE IT IMPOSSIBLE ────────────────────────────────
--
-- Creating a product type asks ONE question — "what do you call one of them?"
-- — and that list mixes two different kinds of answer:
--
--     Pack · Set · Bottle · Tub · Jar · Tube · Bar · Sachet · Item   (a NOUN)
--     Liquid · Powder                                                (a MEASURE)
--
-- Picking a noun forced cost_basis = 'piece'; only "Liquid" and "Powder"
-- reached per_100ml and per_100g. So a body butter, which is a TUB and is
-- measured in GRAMS, could be one or the other and never both. That is why
-- Bodybutter sat at cost_basis 'piece' while the answer to "how much is in
-- one" is 200 g.
--
-- These are independent facts about a consumer item and every product-
-- information standard treats them so: Nivea sells a 200 ml bottle and a
-- 200 g tub of near enough the same thing. The container is packaging; the net
-- content is a quantity with a dimension. This separates them.
--
-- ── NO NEW COLUMN, DELIBERATELY ───────────────────────────────────────────
--
-- product_categories.cost_basis ALREADY says the dimension: per_100ml is
-- millilitres, per_100g is grams, piece is not measured. A second column named
-- net_content_uom would have been the same fact in two places, which is the
-- exact thing Ali asked me to stop doing on 2026-09-01. What was missing was
-- not storage — it was a way for him to SET it, and a screen that reads it.
--
-- ── WHY THIS REFUSES RATHER THAN CONVERTS ─────────────────────────────────
--
-- Changing a type from ml to g cannot rewrite the sizes already recorded
-- under it: 700 ml is not 700 g, and the difference is density, not
-- arithmetic. So the function refuses and names the products, the same way
-- every other restatement in this app is a decision rather than an accident.
-- Clearing those sizes first is a deliberate act; silently relabelling them
-- would be a data loss nobody could see.

create or replace function public.set_category_measure(
  p_category_id uuid,
  p_measure     text          -- 'ml', 'g', or null for "not measured"
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name  text;
  v_old   text;
  v_basis text;
  v_stuck text[];
  v_blank int;
begin
  if not is_admin_or_manager() then
    raise exception 'Only an admin or manager can change how a product type is measured.'
      using errcode = '42501';
  end if;

  if p_measure is not null and p_measure not in ('ml', 'g') then
    raise exception 'A net content is measured in ml or g.' using errcode = '22023';
  end if;

  select name, cost_basis into v_name, v_old
    from product_categories where id = p_category_id;
  if v_name is null then
    raise exception 'That product type no longer exists.' using errcode = '22023';
  end if;

  v_basis := case p_measure when 'ml' then 'per_100ml'
                            when 'g'  then 'per_100g'
                            else 'piece' end;

  -- THE SIZES ALREADY RECORDED ARE THE THING AT RISK. A product holding 700 ml
  -- does not hold 700 g, so a type cannot walk away from the unit its own
  -- products are written in. Named, not counted — he has to know which ones.
  select array_agg(s.internal_code order by s.internal_code)
    into v_stuck
    from skus s
    join variants v       on v.id = s.variant_id
    join product_models m on m.id = v.model_id
   where m.category_id = p_category_id
     and s.is_active
     and s.unit_size is not null
     and s.unit_size_uom is distinct from p_measure;

  if v_stuck is not null then
    raise exception
      '% product(s) already record a size in a different unit (%). Clear those sizes first, or leave % measured as it is.',
      cardinality(v_stuck),
      array_to_string(v_stuck[1:3], ', ') || case when cardinality(v_stuck) > 3 then ', …' else '' end,
      v_name
      using errcode = '22023';
  end if;

  if v_basis is distinct from v_old then
    update product_categories set cost_basis = v_basis where id = p_category_id;

    insert into audit_log (table_name, record_id, action, field_name,
                           old_value, new_value, reason, changed_by)
    values ('product_categories', p_category_id, 'update', 'cost_basis',
            v_old, v_basis,
            'How ' || v_name || ' is measured, changed on the product type. '
            'No size already recorded was altered.',
            (select auth.uid()));
  end if;

  -- HOW MANY STILL HAVE NO SIZE. The number is the point of the whole feature:
  -- a rival's price per 100 g means nothing until our own tubs carry one, so
  -- the screen can say "5 products still need their size" and he knows what is
  -- left to type. Zero when the type is not measured — there is nothing to ask.
  if p_measure is null then
    return 0;
  end if;

  select count(*) into v_blank
    from skus s
    join variants v       on v.id = s.variant_id
    join product_models m on m.id = v.model_id
   where m.category_id = p_category_id
     and s.is_active
     and s.unit_size is null;

  return v_blank;
end;
$$;

comment on function public.set_category_measure(uuid, text) is
  'The ONE place the unit a net content is measured in is decided — ml, g, or '
  'not measured — stored as the type''s cost_basis. Refuses to walk away from a '
  'unit its own products are already written in, because 700ml is not 700g. '
  'Returns how many active products of that type still have no size (0241).';

-- FROM BOTH. There are two separate grants and removing either one alone
-- leaves the function open: CREATE FUNCTION grants EXECUTE to PUBLIC, and
-- Supabase's ALTER DEFAULT PRIVILEGES grants it to anon in its own right.
revoke execute on function public.set_category_measure(uuid, text) from public, anon;
grant  execute on function public.set_category_measure(uuid, text) to authenticated, service_role;

-- ── Ali's answer, recorded ────────────────────────────────────────────────
-- *"Bodyshop in g"* (2026-09-02). Five tubs, none of them sized yet, so
-- nothing is being relabelled — this only decides the unit the app will ask
-- in, instead of asking for millilitres of body butter.
do $$
declare
  v_cat uuid;
begin
  select id into v_cat from product_categories where name = 'Bodybutter';
  if v_cat is null then return; end if;

  update product_categories set cost_basis = 'per_100g'
   where id = v_cat and cost_basis is distinct from 'per_100g';

  if found then
    insert into audit_log (table_name, record_id, action, field_name,
                           old_value, new_value, reason, changed_by)
    values ('product_categories', v_cat, 'update', 'cost_basis',
            'piece', 'per_100g',
            'Body butter is measured by weight — Ali, 2026-09-02 (0241).', null);
  end if;
end $$;

-- ── The guard ─────────────────────────────────────────────────────────────
-- A RULE, not a census. It must be true of any catalogue, including the CI
-- seed that has no Body Shop in it at all: no product may record a net
-- content in a unit its own type does not use. That is the invariant this
-- migration exists to make reachable, and it is checkable everywhere.
do $$
declare
  v_bad text;
begin
  select string_agg(s.internal_code, ', ')
    into v_bad
    from skus s
    join variants v         on v.id = s.variant_id
    join product_models m   on m.id = v.model_id
    join product_categories c on c.id = m.category_id
   where s.is_active
     and s.unit_size is not null
     and s.unit_size_uom is distinct from
         (case c.cost_basis when 'per_100ml' then 'ml'
                            when 'per_100g'  then 'g' end);

  if v_bad is not null then
    raise exception 'these products are sized in a unit their type does not use: %', v_bad;
  end if;
end $$;

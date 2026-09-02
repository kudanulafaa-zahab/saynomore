-- 0242 — a product with one size does not have a size.
--
-- Ali, 2026-09-02, with a screenshot of Edit Product:
--   *"In products SKUs I can change the previous mistakenly named bodymilk to
--    the actual name 'Almond Milk'. When you edited the size field you have
--    entered bodymilk there. Now I can't change it. Even when I delete it and
--    save the name 'bodymilk' is still there."*
--
-- ── WHAT WAS ACTUALLY WRONG ───────────────────────────────────────────────
--
-- A Body Shop tub is one product. There is no 200 ml against 400 ml to choose
-- between — no size AXIS at all. But the catalogue is three levels (brand →
-- product → size) and every SKU must hang off a variant, so when those five
-- were created the product name was copied into the size as well:
--
--     Dewberry / Dewberry      Moringa / Moringa      Satsuma / Satsuma
--
-- Harmless right up to the moment one of them is renamed. He corrected the
-- product to "Almond Milk" and the copy sitting in the size stayed "Bodymilk",
-- because nothing has ever kept the two in step. Deleting it did nothing: the
-- form only renames when the box is non-empty, so a blank read as "no change"
-- rather than "clear it", and it reported success either way.
--
-- ── THE RULE, WHICH IS NOT SPECIFIC TO BODY BUTTER ────────────────────────
--
-- `variants.attributes` is what says a variant is a real size: the size-range
-- builder writes {"size": "XXL"} and the uniqueness constraint reads it.
-- Six variants in the whole catalogue have `{}` — the five tubs and Mama Lime
-- — and every one of them is the ONLY variant of its product. That is the
-- signature of a product with no size axis, and for those the display name is
-- not information. It is a duplicate of the product name, kept by hand.
--
-- This is what every PIM does with a product that has no variant axis (Odoo's
-- single product.variant, a GS1 base item): the variant exists so stock and
-- prices have something to hang on, and it is never NAMED separately.
--
-- So the name is DERIVED, not typed — the same rule CLAUDE.md already states
-- for CBM. Renaming the product renames it; the screen stops asking.
--
-- Variants that DO carry attributes are untouched. "XXL" and "Sakura Blossom
-- Bottle 700ml" are real sizes and are named by hand, exactly as now.

-- ── 1. Renaming a product renames the size it does not really have ────────
create or replace function public.rename_catalogue_part(
  p_kind text,
  p_id   uuid,
  p_name text
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old   text;
  v_name  text := btrim(coalesce(p_name, ''));
  v_clash text;
  v_user  uuid := (select auth.uid());
begin
  -- Row security on these tables is is_admin_or_manager(). This function is
  -- SECURITY DEFINER so it bypasses that and must reimpose it explicitly — a
  -- definer function that forgets is how a viewer renames the catalogue.
  if not is_admin_or_manager() then
    raise exception 'Only an admin or manager can rename a product';
  end if;

  if v_name = '' then
    raise exception 'A name cannot be blank';
  end if;
  if length(v_name) > 120 then
    raise exception 'That name is too long — keep it under 120 characters';
  end if;

  if p_kind = 'brand' then
    select name into v_old from brands where id = p_id;
    if v_old is null then raise exception 'That brand no longer exists'; end if;

    -- MERGING TWO BRANDS IS A DIFFERENT OPERATION and is deliberately not done
    -- here: it would move every product under a brand Ali did not choose.
    select name into v_clash from brands where lower(name) = lower(v_name) and id <> p_id;
    if v_clash is not null then
      raise exception 'There is already a brand called "%". Two brands cannot share a name — rename that one first, or pick a different spelling.', v_clash;
    end if;

    if v_old = v_name then return v_old; end if;
    update brands set name = v_name where id = p_id;

  elsif p_kind = 'model' then
    select name into v_old from product_models where id = p_id;
    if v_old is null then raise exception 'That product no longer exists'; end if;

    select m2.name into v_clash
      from product_models m1
      join product_models m2 on m2.brand_id = m1.brand_id and m2.id <> m1.id
     where m1.id = p_id and lower(m2.name) = lower(v_name);
    if v_clash is not null then
      raise exception 'This brand already has a product called "%". Pick a different name.', v_clash;
    end if;

    if v_old = v_name then return v_old; end if;
    update product_models set name = v_name where id = p_id;

    -- ...AND THE SIZE THAT IS NOT A SIZE FOLLOWS IT. Only a variant with no
    -- attributes, because that is the one whose name was never information —
    -- it was the product's name written a second time. A real size ("XXL",
    -- "Sakura Blossom Bottle 700ml") is left exactly alone.
    --
    -- This is the whole defect: "Almond Milk" and "Bodymilk" were the same
    -- fact, kept in two places, and only one of them could be corrected.
    update variants
       set display_name = v_name, updated_at = now()
     where model_id = p_id
       and attributes = '{}'::jsonb
       and display_name is distinct from v_name;

  elsif p_kind = 'variant' then
    select display_name into v_old from variants where id = p_id;
    if v_old is null then raise exception 'That size no longer exists'; end if;
    if v_old = v_name then return v_old; end if;

    -- A SIZE THAT IS NOT A SIZE CANNOT BE NAMED SEPARATELY. Its name follows
    -- the product; letting it be typed here is what let the two drift apart.
    -- The screen no longer asks, so this only ever fires on a stale client.
    if (select attributes from variants where id = p_id) = '{}'::jsonb then
      raise exception 'This product has one size, so its size takes the product name. Rename the product instead.'
        using errcode = '22023';
    end if;

    -- The size WORD and the size ATTRIBUTE are different things, and only the
    -- word is editable here. `variants.attributes` is what the uniqueness
    -- constraint and the size-range builder use; rewriting it from a free-text
    -- box would let two sizes collide on an error nobody can act on.
    update variants set display_name = v_name where id = p_id;

  else
    raise exception 'Unknown kind "%" — expected brand, model or variant', p_kind;
  end if;

  -- ONE AUDIT ROW, IN THE SAME TRANSACTION AS THE CHANGE.
  insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  values (
    case p_kind when 'brand' then 'brands'
                when 'model' then 'product_models'
                else 'variants' end,
    p_id, 'update',
    case p_kind when 'variant' then 'display_name' else 'name' end,
    v_old, v_name, 'renamed in Products', v_user
  );

  return v_old;
end $function$;

comment on function public.rename_catalogue_part(text, uuid, text) is
  'Renames a brand, product or size, keeping every past order, batch and stock '
  'movement attached. Renaming a PRODUCT also renames its attribute-less '
  'variant, which has no size of its own and is named after the product '
  '(0242). A real size is never rewritten.';

-- FROM BOTH. CREATE FUNCTION grants EXECUTE to PUBLIC and Supabase's ALTER
-- DEFAULT PRIVILEGES grants it to anon in its own right; removing either one
-- alone leaves the function callable with the publishable key.
revoke execute on function public.rename_catalogue_part(text, uuid, text) from public, anon;
grant  execute on function public.rename_catalogue_part(text, uuid, text) to authenticated, service_role;

-- ── 2. The one that already drifted ───────────────────────────────────────
-- "Bodymilk" under the product now called "Almond Milk". Every other
-- attribute-less variant already matches its product, so this touches one row
-- here and none on a fresh database.
do $$
declare r record;
begin
  for r in
    select v.id, v.display_name as old_name, m.name as new_name
      from variants v
      join product_models m on m.id = v.model_id
     where v.attributes = '{}'::jsonb
       and v.display_name is distinct from m.name
  loop
    update variants set display_name = r.new_name, updated_at = now() where id = r.id;

    insert into audit_log (table_name, record_id, action, field_name,
                           old_value, new_value, reason, changed_by)
    values ('variants', r.id, 'update', 'display_name', r.old_name, r.new_name,
            'A product with one size takes the product''s name — it had been '
            'left behind when the product was renamed (0242).', null);
  end loop;
end $$;

-- ── The guard ─────────────────────────────────────────────────────────────
-- A RULE, true of any catalogue including the CI seed: a variant with no
-- attributes carries its product's name. If this ever fails, the two have
-- drifted again and the screen is showing a name nobody can correct.
do $$
declare v_bad text;
begin
  select string_agg(format('%s (product is %s)', v.display_name, m.name), ', ')
    into v_bad
    from variants v
    join product_models m on m.id = v.model_id
   where v.attributes = '{}'::jsonb
     and v.display_name is distinct from m.name;

  if v_bad is not null then
    raise exception 'a size with no size axis disagrees with its product: %', v_bad;
  end if;
end $$;

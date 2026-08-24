-- 0205 — a name typed wrong can be typed right.
--
-- Ali, 2026-08-24, with a screenshot of the Products screen: *"I entered a
-- product name by mistake. Example Bodyshop bodymilk. I don't have a bodymilk
-- it's a mistake. How can I correct this and any other future mistakes? Like
-- spelling mistakes or a different name by mistake?"* — and, asked whether the
-- product itself was real or invented: *"Wrong name."*
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────
--
-- He could not. Checked before answering: `BODY-BODY-1x1` has 4 tubs in stock
-- and has never been sold, which left him stuck in BOTH directions.
--
--   DELETE      correctly blocked. admin_delete_sku refuses anything with a
--               batch or a stock movement, and it should — deleting it would
--               destroy the landed cost that stock figure depends on.
--   RENAME      did not exist. `updateBrand`, `updateModel` and `updateVariant`
--               have been in lib/queries/products.ts the whole time and are
--               called from NOWHERE; the dialogs that used them were deleted as
--               dead code on 2026-08-10 with the note "brands, models and
--               variants are edited through products-explorer's own sheets".
--               They are not. Nothing in the app edits a name.
--
-- So a typo was permanent, in the one part of the app where a typo is most
-- likely: a product is created in a hurry, from a phone, the day it is heard
-- about.
--
-- ── WHY RENAME AND NOT DELETE-AND-RECREATE ──────────────────────────────────
--
-- Because the product is real. A rename touches no transaction: every batch,
-- movement, order line and audit row keeps pointing at the same row, so they
-- all simply start reading the corrected name. Delete-and-recreate would
-- detach 4 tubs from their landed cost and reset the product's history to
-- nothing — which is why the ERP triad is three separate operations and not a
-- spectrum:
--
--   RENAME      the thing is right, the words are wrong        history intact
--   DEACTIVATE  the thing is real, you stopped selling it      history intact
--   DELETE      it was never real and was never used           nothing to keep
--
-- Deactivate and delete already exist. This adds the missing third.
--
-- ── THE SKU CODE DOES NOT CHANGE, AND THAT IS DELIBERATE ────────────────────
--
-- `internal_code` is built once at creation from the brand, model, size and
-- pack config, and stored. After a rename, `BODY-BODY-1x1` will describe a
-- product no longer called Bodymilk.
--
-- That is correct and it is the universal convention — SAP's material number,
-- Oracle's item number, NetSuite's item ID all behave this way. The code is the
-- PERMANENT REFERENCE: it is printed on labels, quoted in shipment paperwork
-- and written in notes. The name is the DESCRIPTION and is expected to change.
-- Regenerating a code that has already been written down somewhere is a worse
-- failure than a stale prefix, and CLAUDE.md already treats the code as
-- authoritative for the one thing that must never drift — the `{pcs}x{packs}`
-- pack config, which a rename cannot touch.
--
-- ── WHY IT IS AN RPC AND NOT THREE TABLE UPDATES ────────────────────────────
--
-- Three reasons, none of them style:
--
--   1. THE AUDIT ROW AND THE CHANGE MUST BE ONE TRANSACTION. A rename changes
--      what every historical document says. `trg_brands_upd` and its siblings
--      only stamp updated_at — nothing recorded who changed a name, from what,
--      to what. Doing it client-side means two round trips and a window where
--      the change is live and unlogged.
--   2. UNIQUENESS FAILS AS A CONSTRAINT ERROR. `brands_name_key` and
--      `product_models_brand_id_name_key` would surface to Ali as
--      "duplicate key value violates unique constraint" — the exact class of
--      message that produced "Can't create bodybutter" (migration 0176). Named
--      here, in words.
--   3. ONE DOOR. A rename reachable from one place cannot drift from a rename
--      reachable from another.

create or replace function public.rename_catalogue_part(
  p_kind text,   -- 'brand' | 'model' | 'variant'
  p_id   uuid,
  p_name text
) returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_old   text;
  v_name  text := btrim(coalesce(p_name, ''));
  v_clash text;
  v_user  uuid := (select auth.uid());
begin
  -- Row security on brands/product_models/variants is is_admin_or_manager().
  -- This function is SECURITY DEFINER, so it bypasses that and must reimpose
  -- it explicitly — a definer function that forgets is how a viewer ends up
  -- able to rename the catalogue.
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
    -- here. Renaming Bodyshop to an existing "Body Shop" would either violate
    -- brands_name_key or, if it silently merged, move every product under a
    -- brand Ali did not choose. Refused, in words, naming the clash.
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

  elsif p_kind = 'variant' then
    select display_name into v_old from variants where id = p_id;
    if v_old is null then raise exception 'That size no longer exists'; end if;
    if v_old = v_name then return v_old; end if;

    -- The size WORD and the size ATTRIBUTE are two different things, and only
    -- the word is editable here. `variants.attributes` is what
    -- variants_model_id_attributes_key is unique on, what the size range
    -- builder writes, and what the SKU code was derived from — rewriting it
    -- from a free-text box would let two sizes collide on a constraint whose
    -- error message says nothing a person can act on. So this renames the
    -- LABEL only; the underlying size is changed by editing the SKU.
    update variants set display_name = v_name where id = p_id;

  else
    raise exception 'Unknown kind "%" — expected brand, model or variant', p_kind;
  end if;

  -- ONE AUDIT ROW, IN THE SAME TRANSACTION AS THE CHANGE. A rename rewrites
  -- what every past invoice, batch and stock movement appears to say, so "who
  -- changed this name, and from what" is not optional history.
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
end $$;

comment on function public.rename_catalogue_part(text, uuid, text) is
  'Corrects a mistyped brand, product or size name. History stays attached — '
  'every past document simply starts reading the corrected name — and the SKU '
  'code deliberately does NOT change, because it is the permanent reference '
  'that ends up on labels and paperwork. Migration 0205.';

-- REVOKE FROM PUBLIC **AND** anon — they are different grants (0203), and this
-- one WRITES to the catalogue, so it is not a place to get that wrong.
revoke execute on function public.rename_catalogue_part(text, uuid, text) from public, anon;
grant  execute on function public.rename_catalogue_part(text, uuid, text) to authenticated;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare v_anon boolean;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'rename_catalogue_part'
  ) then
    raise exception 'rename_catalogue_part was not created';
  end if;
  select has_function_privilege('anon', 'public.rename_catalogue_part(text, uuid, text)', 'execute')
    into v_anon;
  if v_anon then raise exception 'anon can rename the catalogue'; end if;
end $$;

-- 0193 — a product can have more than one size, and a bedding set is a "set".
--
-- Ali is adding IKEA bedding: patterns as models, and Single / Queen / King as
-- sizes under each. He also asked how professional systems add a category with
-- variants, "in the simplest and most efficient way".
--
-- ── THE ANSWER, AND THE APP ALREADY HAS MOST OF IT ────────────────────────────
--
-- Every serious platform uses one pattern: define the product once, name its
-- options, and let the system generate the combinations. Shopify calls them
-- options and variants, Odoo calls them attributes on a product template, and
-- NetSuite calls them matrix items — and NetSuite names home goods as the case
-- it exists for, which is exactly bedding.
--
-- This app was already built that way and it is worth saying so plainly:
-- `product_categories.variant_attributes` IS the per-category attribute set.
-- Diapers declare ['size']; Liquid Detergent declares ['scent','format',
-- 'volume_ml']; body butter declares []. The New SKU wizard reads that schema
-- and renders a pill or a field per attribute. The stored data matches it
-- exactly: 28 diaper variants carry {"size": ...}, the Sosoft variants carry
-- all three of theirs, and the three sold-singly products carry {}.
--
-- ── THE ONE BROKEN LINK ───────────────────────────────────────────────────────
--
-- create_sku_full THREW THOSE ATTRIBUTES AWAY. The wizard collects them, joins
-- them into a display name, and the function stored `'{}'::jsonb` regardless.
--
-- `variants` is UNIQUE (model_id, attributes). So every variant the wizard has
-- ever made is {} — and a model can hold exactly ONE of those. Adding a second
-- size to the same model fails with:
--
--     duplicate key value violates unique constraint
--     "variants_model_id_attributes_key"
--
-- Verified by doing it: creating "Single" then "Queen" under one pattern fails
-- on the second. Ali would have hit it on his second bedding size and it would
-- have looked like the app was broken.
--
-- It also explains something already in the data. His two Body Shop scents are
-- two separate MODELS ("Dewberry", "Strawberry") rather than two variants of
-- one body butter, because two variants of one model was impossible through the
-- app. The diapers escaped only because they were loaded before the wizard
-- existed.
--
-- THE FIX IS TO STOP DISCARDING WHAT THE WIZARD ALREADY KNOWS. p_attributes
-- carries the structured values through, and they are stored as the variant's
-- attributes — which is what makes siblings distinct, and what the existing
-- diaper rows have always looked like.
--
-- THE OLD SIGNATURE IS DROPPED, NOT LEFT BESIDE THE NEW ONE. Adding a
-- parameter to a Postgres function creates an OVERLOAD; it does not replace.
-- Both would then exist, a thirteen-argument call would match both, and the
-- database would refuse it as ambiguous — which would take out product creation
-- entirely, including for the app version currently running. Because the new
-- parameter has a default, a caller that passes the old thirteen still resolves
-- against the new function, so dropping the old one is safe for the JavaScript
-- already in someone's browser mid-deploy.
--
-- ── AND A BEDDING SET IS NOT A "PACK" ─────────────────────────────────────────
-- unit_noun() had no word for a bedding set, so it fell through to 'pack' — the
-- diaper default. Ali would have read "3 packs" for three duvet sets. 'set' is
-- added to the category unit vocabulary and to unit_noun, whose TypeScript twin
-- (containerLabel in lib/trade-units.ts) gains the same word in the same commit.

-- ── 1. the unit word ─────────────────────────────────────────────────────────
alter table public.product_categories
  drop constraint if exists product_categories_unit_uom_check;
alter table public.product_categories
  add constraint product_categories_unit_uom_check
  check (unit_uom = any (array[
    'pcs','ml','g','tub','jar','tube','bar','sachet','bottle','unit','set'
  ]));

create or replace function public.unit_noun(p_unit_uom text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_unit_uom
           when 'ml'     then 'bottle'
           when 'g'      then 'pouch'
           when 'tub'    then 'tub'
           when 'jar'    then 'jar'
           when 'tube'   then 'tube'
           when 'bar'    then 'bar'
           when 'sachet' then 'sachet'
           when 'bottle' then 'bottle'
           when 'set'    then 'set'
           when 'unit'   then 'unit'
           else 'pack'
         end;
$$;

-- ── 2. the variant attributes reach the variant ──────────────────────────────
-- Dropped first, for the overload reason in the header. Named explicitly by its
-- full argument list so this can only ever remove the signature it means to.
drop function if exists public.create_sku_full(
  text, uuid, text, text, text, integer, integer, text[],
  numeric, numeric, numeric, numeric, text);

create or replace function public.create_sku_full(
  p_brand         text,
  p_category_id   uuid,
  p_model         text,
  p_variant       text,
  p_internal_code text,
  p_pcs_per_pack     integer,
  p_packs_per_carton integer,
  p_sellable_units   text[]  default array['pack','carton'],
  p_length_cm  numeric default null,
  p_width_cm   numeric default null,
  p_height_cm  numeric default null,
  p_weight_kg  numeric default null,
  p_barcode    text    default null,
  p_attributes jsonb   default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand   uuid;
  v_model   uuid;
  v_variant uuid;
  v_sku     uuid;
  v_name    text;
  v_attrs   jsonb;
begin
  if not is_admin_or_manager() then
    raise exception 'Only an admin or manager can create products.' using errcode = '42501';
  end if;

  v_name := btrim(coalesce(p_brand, ''));
  if v_name = '' then raise exception 'Enter a brand.' using errcode = '22023'; end if;

  -- Reuse rather than duplicate, case-insensitively: "Bodyshop" and "bodyshop"
  -- are the same brand to a person, and two of them in the list is a mess
  -- nobody can unpick later.
  select id into v_brand from brands where lower(name) = lower(v_name) limit 1;
  if v_brand is null then
    insert into brands (name) values (v_name) returning id into v_brand;
  end if;

  v_name := btrim(coalesce(p_model, ''));
  if v_name = '' then raise exception 'Enter a model name.' using errcode = '22023'; end if;

  select id into v_model from product_models
   where brand_id = v_brand and lower(name) = lower(v_name) limit 1;
  if v_model is null then
    insert into product_models (brand_id, category_id, name)
    values (v_brand, p_category_id, v_name) returning id into v_model;
  end if;

  -- The variant display defaults to the model name when the category has no
  -- variant attributes to distinguish one from another (body butter has none).
  v_name := btrim(coalesce(nullif(btrim(coalesce(p_variant, '')), ''), p_model));

  -- Blank values are DROPPED rather than stored as "". {"size": ""} is not the
  -- same key as {} to the unique index, so a half-filled form would quietly
  -- carve out a second slot that looks identical on screen.
  v_attrs := coalesce(
    (select jsonb_object_agg(k, btrim(v))
       from jsonb_each_text(coalesce(p_attributes, '{}'::jsonb)) as t(k, v)
      where btrim(coalesce(v, '')) <> ''),
    '{}'::jsonb);

  -- Match on the ATTRIBUTES, because that is what the unique index is on.
  -- Matching on display_name instead would find a same-named variant carrying
  -- different attributes, hand it back, and the insert would then collide on a
  -- row this query never looked at.
  select id into v_variant from variants
   where model_id = v_model and attributes = v_attrs limit 1;
  if v_variant is null then
    insert into variants (model_id, display_name, attributes)
    values (v_model, v_name, v_attrs) returning id into v_variant;
  end if;

  insert into skus (
    variant_id, internal_code, supplier_barcode,
    pcs_per_pack, packs_per_carton,
    carton_length_cm, carton_width_cm, carton_height_cm, carton_weight_kg,
    sellable_units
  ) values (
    v_variant, btrim(p_internal_code), nullif(btrim(coalesce(p_barcode,'')), ''),
    p_pcs_per_pack, p_packs_per_carton,
    -- 0 from a form means "no carton", which is NULL — not a zero-sized box.
    nullif(p_length_cm, 0), nullif(p_width_cm, 0), nullif(p_height_cm, 0),
    nullif(p_weight_kg, 0),
    coalesce(p_sellable_units, array['pack','carton'])
  ) returning id into v_sku;

  insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  values ('skus', v_sku, 'insert', 'internal_code', null, btrim(p_internal_code),
          'Product created: ' || p_brand || ' / ' || p_model || ' / ' || v_name,
          (select auth.uid()));

  return v_sku;
end;
$$;

comment on function public.create_sku_full(text, uuid, text, text, text, integer, integer, text[], numeric, numeric, numeric, numeric, text, jsonb) is
  'Create a product in ONE transaction: brand, model, variant and SKU. Reuses '
  'an existing brand/model by name and an existing variant by ATTRIBUTES, so a '
  'retry after a failure heals instead of colliding. p_attributes carries the '
  'category''s variant attributes (0193) — without them every variant was {} '
  'and a model could hold only one, so a second size failed on the unique '
  'index. Call it once per size to build a size range.';

revoke execute on function public.create_sku_full(text, uuid, text, text, text, integer, integer, text[], numeric, numeric, numeric, numeric, text, jsonb) from public, anon;
grant  execute on function public.create_sku_full(text, uuid, text, text, text, integer, integer, text[], numeric, numeric, numeric, numeric, text, jsonb) to authenticated;

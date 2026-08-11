-- 0177 — creating a SKU is all or nothing.
--
-- The New SKU card inserted four rows in sequence: brand, model, variant, sku.
-- Any failure at step 4 left steps 1-3 behind — and because a variant is
-- unique on (model_id, attributes), and this catalogue mostly has NO variant
-- attributes so every variant under a model is {}, the NEXT attempt could not
-- even reach the real error. It collided on the orphan and reported that
-- instead. Ali hit exactly this and saw a duplicate-key message for a problem
-- that was actually about carton dimensions (0176).
--
-- A half-created product is worse than a failed one: invisible in the
-- catalogue (no SKU), blocking the retry, and nothing tells you it is there.
--
-- One function, one transaction. If any part fails, none of it happened.
--
-- It is also IDEMPOTENT BY NAME: an existing brand/model/variant is reused
-- rather than duplicated, so orphans left by earlier attempts HEAL on the next
-- try instead of blocking it for ever. That is what made this safe to ship
-- without a cleanup script — Ali's stuck "Bodyshop / Dewberry" rows were
-- adopted by the first successful call.

create or replace function create_sku_full(
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
  p_barcode    text    default null
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

  select id into v_variant from variants
   where model_id = v_model and lower(display_name) = lower(v_name) limit 1;
  if v_variant is null then
    insert into variants (model_id, display_name, attributes)
    values (v_model, v_name, '{}'::jsonb) returning id into v_variant;
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

comment on function create_sku_full(text, uuid, text, text, text, integer, integer, text[], numeric, numeric, numeric, numeric, text) is
  'Create a product in ONE transaction: brand, model, variant and SKU. Reuses '
  'existing brand/model/variant by name (case-insensitive) so a retry after a '
  'failure heals instead of colliding. Carton dimensions are optional — 0 or '
  'NULL means the product has no carton to measure.';

revoke execute on function create_sku_full(text, uuid, text, text, text, integer, integer, text[], numeric, numeric, numeric, numeric, text) from public, anon;
grant  execute on function create_sku_full(text, uuid, text, text, text, integer, integer, text[], numeric, numeric, numeric, numeric, text) to authenticated;

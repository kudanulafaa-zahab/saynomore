-- 0243 — a selling tier is only a tier if it is a DIFFERENT AMOUNT.
--
-- Ali, 2026-09-02, with a screenshot of Edit Product on a Body Shop tub:
--   *"what is this single tub and tub and carton in 'sold in'? I must be able
--    to choose one or two and switch off the other or select all if I want.
--    But that must mean on other screens it must be same. This is not
--    intelligent I don't even know what sold in tub, single tub means"*
--
-- and then, plainly:
--   *"Bodyshop are sold in tubs. I can sell x number of tubs. It's never
--    cartons."*
--
-- ── WHAT HE WAS LOOKING AT ────────────────────────────────────────────────
--
-- Three buttons — Single tub, Tub, Carton — on a product that is 1 to a pack
-- and 1 to a carton. All three are the same object at the same price. Both
-- editors hardcoded those three for EVERY product without ever asking whether
-- they are different quantities: true on a 34-per-pack diaper, meaningless on
-- a tub.
--
-- The forms are fixed in the same change. This is the half that has to be in
-- Postgres, because two other doors can put a carton on a product that has no
-- carton, and a rule enforced only on the screen he happened to be looking at
-- is not a rule:
--
--   1. create_sku_full inherits `default_sellable_units` from the product type.
--      A type that sells packs AND cartons would hand a carton to a 1×1 tub
--      created under it.
--   2. set_category_sellable_units (0238) PROPAGATES the type's units to every
--      active product of that type — so one tap on the type sheet could push a
--      carton back onto every tub, undoing the form fix immediately.
--
-- ── WHY 'pack' IS ALWAYS THE ONE THAT SURVIVES ────────────────────────────
--
-- It is the base unit he trades in: for a tub it IS the tub, for a diaper it
-- is the pack of 34. `packs_per_carton > 1` is the whole test for whether a
-- carton is a second amount. This is the packaging hierarchy every ERP models
-- — a level exists when it holds more than one of the level below it.
--
-- Nothing here touches how stock is RECORDED. A mixed Sosoft carton still
-- posts its lines with uom='piece'; that is a ledger event, not a tier this
-- ever offered.

-- ── 1. Creating a product ─────────────────────────────────────────────────
create or replace function public.create_sku_full(
  p_brand text, p_category_id uuid, p_model text, p_variant text,
  p_internal_code text, p_pcs_per_pack integer, p_packs_per_carton integer,
  p_sellable_units text[] default null::text[],
  p_length_cm numeric default null::numeric,
  p_width_cm numeric default null::numeric,
  p_height_cm numeric default null::numeric,
  p_weight_kg numeric default null::numeric,
  p_barcode text default null::text,
  p_attributes jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_brand   uuid;
  v_model   uuid;
  v_variant uuid;
  v_sku     uuid;
  v_name    text;
  v_attrs   jsonb;
  v_units   text[];
begin
  if not is_admin_or_manager() then
    raise exception 'Only an admin or manager can create products.' using errcode = '42501';
  end if;

  v_name := btrim(coalesce(p_brand, ''));
  if v_name = '' then raise exception 'Enter a brand.' using errcode = '22023'; end if;

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

  if p_sellable_units is null or cardinality(p_sellable_units) = 0 then
    select pc.default_sellable_units into v_units
      from product_models m
      join product_categories pc on pc.id = m.category_id
     where m.id = v_model;
    if v_units is null or cardinality(v_units) = 0 then
      raise exception
        'This kind of product does not say how it is sold yet. Set it on the '
        'product type in Products > Categories, and every product of that kind '
        'will follow.'
        using errcode = '22023';
    end if;
  else
    v_units := p_sellable_units;
  end if;

  -- A CARTON THAT HOLDS ONE PACK IS NOT A SECOND WAY TO SELL IT (0243). The
  -- type may well sell cartons — Liquid Detergent does — but this particular
  -- product does not have one, and inheriting a unit nobody can buy is what
  -- put three identical buttons in front of Ali.
  if coalesce(p_packs_per_carton, 1) <= 1 then
    v_units := array_remove(v_units, 'carton');
  end if;
  if v_units is null or cardinality(v_units) = 0 then
    v_units := array['pack'];
  end if;

  v_name := btrim(coalesce(nullif(btrim(coalesce(p_variant, '')), ''), p_model));

  v_attrs := coalesce(
    (select jsonb_object_agg(k, btrim(v))
       from jsonb_each_text(coalesce(p_attributes, '{}'::jsonb)) as t(k, v)
      where btrim(coalesce(v, '')) <> ''),
    '{}'::jsonb);

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
    nullif(p_length_cm, 0), nullif(p_width_cm, 0), nullif(p_height_cm, 0),
    nullif(p_weight_kg, 0),
    v_units
  ) returning id into v_sku;

  insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  values ('skus', v_sku, 'insert', 'internal_code', null, btrim(p_internal_code),
          'Product created: ' || p_brand || ' / ' || p_model || ' / ' || v_name
            || ' — sold as ' || array_to_string(v_units, '+')
            || case when p_sellable_units is null then ' (from its product type)'
                    else ' (set on this product)' end,
          (select auth.uid()));

  return v_sku;
end;
$function$;

revoke execute on function public.create_sku_full(text, uuid, text, text, text, integer, integer, text[], numeric, numeric, numeric, numeric, text, jsonb) from public, anon;
grant  execute on function public.create_sku_full(text, uuid, text, text, text, integer, integer, text[], numeric, numeric, numeric, numeric, text, jsonb) to authenticated, service_role;

-- ── 2. Changing the product type ──────────────────────────────────────────
create or replace function public.set_category_sellable_units(
  p_category_id uuid,
  p_units       text[]
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name    text;
  v_old     text[];
  v_touched int := 0;
  v_want    text[];
  r         record;
begin
  if not is_admin_or_manager() then
    raise exception 'Only an admin or manager can change how a product type is sold.'
      using errcode = '42501';
  end if;

  select name, default_sellable_units into v_name, v_old
    from product_categories where id = p_category_id;
  if v_name is null then
    raise exception 'That product type no longer exists.' using errcode = '22023';
  end if;

  -- A kind of product nobody can buy is not a kind of product.
  if p_units is null or cardinality(p_units) = 0 then
    raise exception 'Choose at least one way this is sold.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_units) u where u not in ('piece','pack','carton')) then
    raise exception 'Unknown selling unit.' using errcode = '22023';
  end if;

  update product_categories
     set default_sellable_units = p_units
   where id = p_category_id;

  insert into audit_log (table_name, record_id, action, field_name,
                         old_value, new_value, reason, changed_by)
  values ('product_categories', p_category_id, 'update', 'default_sellable_units',
          array_to_string(v_old, ','), array_to_string(p_units, ','),
          'How ' || v_name || ' is sold, changed on the product type.',
          (select auth.uid()));

  -- ...AND EVERY ACTIVE PRODUCT OF THAT KIND FOLLOWS. Only rows that actually
  -- differ, so the count is the truth and the audit log has no no-op entries.
  for r in
    select s.id, s.internal_code, s.sellable_units, s.packs_per_carton
      from skus s
      join variants v       on v.id = s.variant_id
      join product_models m on m.id = v.model_id
     where m.category_id = p_category_id
       and s.is_active
  loop
    -- PER PRODUCT, because the type's answer is not automatically available to
    -- every product of that type (0243). A tub whose carton holds one tub has
    -- no carton to sell, however the type is set — pushing one onto it is what
    -- put "Single tub / Tub / Carton" in front of Ali.
    v_want := case when r.packs_per_carton > 1 then p_units
                   else array_remove(p_units, 'carton') end;
    if v_want is null or cardinality(v_want) = 0 then
      v_want := array['pack'];
    end if;

    continue when (select array_agg(u order by u) from unnest(r.sellable_units) u)
                  is not distinct from
                  (select array_agg(u order by u) from unnest(v_want) u);

    update skus set sellable_units = v_want, updated_at = now() where id = r.id;

    insert into audit_log (table_name, record_id, action, field_name,
                           old_value, new_value, reason, changed_by)
    values ('skus', r.id, 'update', 'sellable_units',
            array_to_string(r.sellable_units, ','), array_to_string(v_want, ','),
            'Followed its product type (' || v_name || '). No price, cost, stock '
            'or pack configuration changed.',
            (select auth.uid()));

    v_touched := v_touched + 1;
  end loop;

  return v_touched;
end;
$$;

comment on function public.set_category_sellable_units(uuid, text[]) is
  'The ONE place how a kind of product is sold is decided. Sets it on the type '
  'and brings every active product of that type with it, audit-logged row by '
  'row — minus any tier that product has no room for: a carton holding one '
  'pack is not a second amount (0243). Inactive products are left alone.';

revoke execute on function public.set_category_sellable_units(uuid, text[]) from public, anon;
grant  execute on function public.set_category_sellable_units(uuid, text[]) to authenticated, service_role;

-- ── The guard ─────────────────────────────────────────────────────────────
-- A RULE, true of any catalogue including the CI seed: no active product is
-- offered a carton it does not have. Production already satisfies this — the
-- defect was that both doors could break it at any moment.
do $$
declare v_bad text;
begin
  select string_agg(s.internal_code, ', ')
    into v_bad
    from skus s
   where s.is_active
     and s.packs_per_carton <= 1
     and 'carton' = any(s.sellable_units);

  if v_bad is not null then
    raise exception 'these products are sold by a carton that holds one pack: %', v_bad;
  end if;
end $$;

-- 0236 — the PRODUCT TYPE decides how a product is sold. One place, inherited.
--
-- Ali, 2026-09-01:
--   *"I have x,y,z products as an example. They can come in cartons of x amount
--    per carton, they can also come as individual pieces like the Bodyshop
--    bodybutter... I can sell diapers by packs or cartons/cases. But it never
--    comes as individual pieces. But I can sell detergent as individual bottles
--    or mixed bottles of x amount cartons or one variant of a whole carton...
--    So you're just editing what I specifically ask in that instance and doing
--    adhoc job corrections."*
--
-- He is right, and 0234/0235 are the evidence: one product could not be sold by
-- the carton, so a constraint was invented, then withdrawn, then a warning was
-- added. Three migrations about ONE ROW, because there was no rule to fix —
-- only rows.
--
-- ── WHAT PROFESSIONALS DO ─────────────────────────────────────────────────
--
-- This is a solved problem and it has a name: a UNIT OF MEASURE GROUP (Sage,
-- SYSPRO), a PACKAGING HIERARCHY (Oracle), PACKAGINGS (Odoo). The pattern is
-- the same everywhere:
--
--   * one base unit, and alternate units with conversion factors
--   * declared ONCE as master data on the item CATEGORY
--   * every item INHERITS it; an item never re-types its own copy
--   * the units an item may be SOLD in must belong to that group
--
-- A beverage distributor declares bottle / case-of-12 / pallet-of-80 once, not
-- per drink. That is exactly Ali's sentence, in the industry's words.
--
-- ── WHAT THIS APP HAD ─────────────────────────────────────────────────────
--
-- The right shape existed and was never wired up. `product_categories` has
-- carried `default_sellable_units` all along, and it was consulted NOWHERE:
--
--   * create_sku_full defaults p_sellable_units to ARRAY['pack','carton'] and
--     then coalesces to ARRAY['pack','carton'] again — the category is ignored
--     twice, so every new product is born with a guess.
--   * the TypeScript caller passes `?? ["pack","carton"]`, a third copy of the
--     same guess.
--   * nothing ever compared a product against its type.
--
-- So the type was decoration and each row was hand-typed. MAMY-XTRA-XXXL-32x3
-- was hand-typed wrong and stayed wrong, and Liquid Detergent's type is STILL
-- wrong today: it says carton-only while all five Sosoft products sell single
-- bottles, which is one of the three ways Ali describes selling them.
--
-- ── WHAT CHANGES ──────────────────────────────────────────────────────────
--
-- 1. The type becomes the authority a new product inherits from.
-- 2. Liquid Detergent is corrected to bottle + carton.
-- 3. Any product that disagrees with its type is SAID, with both sides named.
--
-- Deliberately not a constraint. 0234 tried that and had to be withdrawn: an
-- item is allowed to override its group in every ERP that implements this, it
-- just must not do so silently. Verified after this migration: zero products
-- disagree with their type, across all 36.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. LIQUID DETERGENT SELLS BOTTLES. IT ALWAYS DID.
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_id  uuid;
  v_old text[];
begin
  select id, default_sellable_units into v_id, v_old
    from public.product_categories where name = 'Liquid Detergent';

  if v_id is null then
    raise notice 'no Liquid Detergent type here — nothing to correct';
    return;
  end if;

  if 'pack' = any(v_old) then
    raise notice 'Liquid Detergent already sells single bottles';
    return;
  end if;

  update public.product_categories
     set default_sellable_units = array['pack','carton']
   where id = v_id;

  insert into audit_log (table_name, record_id, action, field_name,
                         old_value, new_value, reason, changed_by)
  values ('product_categories', v_id, 'update', 'default_sellable_units',
          array_to_string(v_old, ','), 'pack,carton',
          'The type said cartons only while all five Sosoft products sell single '
          'bottles as well — one of the three ways Ali sells them (single bottle, '
          'mixed carton, whole carton). The type was the thing that was wrong.',
          null);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. A NEW PRODUCT INHERITS ITS TYPE
-- ══════════════════════════════════════════════════════════════════════════
-- p_sellable_units now defaults to NULL, meaning "whatever this kind of product
-- is sold as". Passing a value still works and is an explicit override, which
-- is how every ERP implementing UoM groups behaves.
--
-- It reads the category of the MODEL actually used, not p_category_id: when the
-- model already exists its own category is the truth, and the two can differ.
create or replace function public.create_sku_full(
  p_brand text, p_category_id uuid, p_model text, p_variant text,
  p_internal_code text, p_pcs_per_pack integer, p_packs_per_carton integer,
  p_sellable_units text[] default null,
  p_length_cm numeric default null, p_width_cm numeric default null,
  p_height_cm numeric default null, p_weight_kg numeric default null,
  p_barcode text default null, p_attributes jsonb default '{}'::jsonb)
returns uuid
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

  -- INHERIT. This is the whole point of the migration.
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

-- FROM BOTH. There are two separate grants and removing either one alone
-- leaves the function open: CREATE FUNCTION grants EXECUTE to PUBLIC, and
-- Supabase's ALTER DEFAULT PRIVILEGES grants it to anon in its own right.
revoke execute on function public.create_sku_full(text, uuid, text, text, text, integer, integer, text[], numeric, numeric, numeric, numeric, text, jsonb) from public, anon;
grant  execute on function public.create_sku_full(text, uuid, text, text, text, integer, integer, text[], numeric, numeric, numeric, numeric, text, jsonb) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. A PRODUCT THAT DISAGREES WITH ITS TYPE IS SAID OUT LOUD
-- ══════════════════════════════════════════════════════════════════════════
-- Replaces 0235's `carton_not_sellable`, which named one instance of this. The
-- general rule covers it and every other shape: sold by the pack when its kind
-- is sold by the carton, sold loose when its kind is not, and so on.
create or replace function public.get_setup_gaps()
returns table(sku_id uuid, internal_code text, full_path text, gap text,
              headline text, blocks text, stock_label text, stock_pieces integer,
              severity integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  with stock as (
    select bs.sku_id, sum(bs.qty_pieces_remaining)::integer as pieces
      from v_batch_stock bs
     where bs.qty_pieces_remaining > 0
     group by bs.sku_id
  ),
  cost as (
    select distinct on (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
      from v_batch_stock bs
     where bs.qty_pieces_remaining > 0
     order by bs.sku_id, bs.received_at desc
  ),
  base as (
    select
      s.id, s.internal_code,
      concat_ws(' › ', b.name, m.name, v.display_name) as full_path,
      coalesce(st.pieces, 0) as pieces,
      c.landed_per_piece_mvr as landed,
      s.sellable_units, s.pcs_per_pack, s.packs_per_carton,
      pc.unit_uom, pc.name as category_name,
      pc.default_sellable_units as type_units,
      coalesce(s.cbm_per_carton, 0) as cbm,
      -- THE SELL SHEET'S OWN NUMBERS (0204).
      case when 'pack'   = any(s.sellable_units) then vs.selling_price_per_pack_mvr   end as price_pack,
      case when 'carton' = any(s.sellable_units) then vs.selling_price_per_carton_mvr end as price_carton
    from skus s
    join v_skus vs        on vs.id = s.id
    join variants v       on v.id = s.variant_id
    join product_models m on m.id = v.model_id
    join brands b         on b.id = m.brand_id
    join product_categories pc on pc.id = m.category_id
    left join stock st on st.sku_id = s.id
    left join cost  c  on c.sku_id  = s.id
    where s.is_active
  ),
  labelled as (
    select *,
      qty_in_trade_units(pieces, pcs_per_pack, packs_per_carton, unit_uom, sellable_units) as stock_label,
      unit_noun(unit_uom) as noun
      from base
  )
  select id, internal_code, full_path, 'no_price',
         'No selling price yet',
         case when pieces > 0
              then 'Cannot be sold — there is ' || stock_label || ' waiting'
              else 'Cannot be sold' end,
         stock_label, pieces,
         case when pieces > 0 then 0 else 2 end
    from labelled
   where price_pack is null and price_carton is null

  union all

  select id, internal_code, full_path, 'no_carton_price',
         'No price for a carton',
         'Sells by the ' || noun || ', but a carton cannot be quoted',
         stock_label, pieces, 1
    from labelled
   where 'carton' = any(sellable_units)
     and price_carton is null
     and price_pack is not null

  union all

  -- ...AND ITS MIRROR, WHICH DID NOT EXIST UNTIL 0208.
  select id, internal_code, full_path, 'no_unit_price',
         'No price for one ' || noun,
         'Sells by the carton, but a single ' || noun || ' cannot be quoted',
         stock_label, pieces, 1
    from labelled
   where 'pack' = any(sellable_units)
     and price_pack is null
     and price_carton is not null

  union all

  -- ── THE GENERAL RULE (0236) ───────────────────────────────────────────
  -- Names BOTH sides, because either one can be the mistake: the XXXL diaper
  -- was the product, Liquid Detergent was the type. Whichever it is, the fix
  -- is one tap away on the product type.
  select id, internal_code, full_path, 'units_differ_from_type',
         'Sold differently from other ' || lower(category_name),
         lower(category_name) || ' normally sell by the '
           || (select string_agg(case when u = 'carton' then 'carton'
                                      when u = 'pack'   then l.noun
                                      else u end, ' and ' order by case u when 'piece' then 1 when 'pack' then 2 when 'carton' then 3 else 4 end)
                 from unnest(l.type_units) u)
           || ' — this one sells by the '
           || (select string_agg(case when u = 'carton' then 'carton'
                                      when u = 'pack'   then l.noun
                                      else u end, ' and ' order by case u when 'piece' then 1 when 'pack' then 2 when 'carton' then 3 else 4 end)
                 from unnest(l.sellable_units) u)
           || ' only',
         stock_label, pieces, 1
    from labelled l
   where type_units is not null
     and cardinality(type_units) > 0
     and (select array_agg(u order by u) from unnest(sellable_units) u)
         is distinct from
         (select array_agg(u order by u) from unnest(type_units) u)

  union all

  select id, internal_code, full_path, 'no_carton_size',
         'No carton measurements',
         'A shipment carrying it cannot be received — freight has nothing to split on',
         stock_label, pieces, 1
    from labelled
   where cbm <= 0

  union all

  select id, internal_code, full_path, 'no_cost',
         'No landed cost recorded',
         'There is ' || stock_label || ' in the godown with no cost, so margin cannot be checked',
         stock_label, pieces, 1
    from labelled
   where pieces > 0 and landed is null

  order by 9, 8 desc, 3;
$function$;

-- FROM BOTH. There are two separate grants and removing either one alone
-- leaves the function open: CREATE FUNCTION grants EXECUTE to PUBLIC, and
-- Supabase's ALTER DEFAULT PRIVILEGES grants it to anon in its own right.
revoke execute on function public.get_setup_gaps() from public, anon;
grant  execute on function public.get_setup_gaps() to authenticated, service_role;

do $$
declare
  v_n int;
begin
  if (select default_sellable_units from public.product_categories where name = 'Liquid Detergent')
     is distinct from array['pack','carton'] then
    raise exception 'Liquid Detergent still does not sell single bottles';
  end if;

  select count(*) into v_n from public.get_setup_gaps() where gap = 'units_differ_from_type';
  if v_n <> 0 then
    raise exception '% product(s) still disagree with their type', v_n;
  end if;
end $$;

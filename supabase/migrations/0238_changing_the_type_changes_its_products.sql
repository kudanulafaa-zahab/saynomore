-- 0238 — changing the type changes its products, in one place, on purpose.
--
-- Ali, 2026-09-01:
--   *"But it should apply to future products too. And I must be change product
--    conditions when I want it at any given time. It should not be complicated
--    and must be at the correct module or place. It shouldn't exist in multiple
--    places."*
--
-- 0236 made the product type the authority a NEW product inherits from. That is
-- half of what he asked for. The other half is that changing his mind later has
-- to actually change things — otherwise the type is a setting that only affects
-- products he has not created yet, which is exactly the kind of half-answer he
-- is complaining about.
--
-- ── WHY THIS PROPAGATES, WHEN ERPs USUALLY DO NOT ─────────────────────────
--
-- In a large ERP, changing a UoM group does not silently rewrite thousands of
-- items: there are too many deliberate per-item exceptions, so it is a mass-
-- update run with a preview. The reasoning is about SCALE and about overrides
-- being common.
--
-- Neither holds here. This catalogue is 36 products, every product agrees with
-- its type today, and Ali has said plainly that a kind of product is sold one
-- way — diapers by the pack and carton, detergent by the bottle and carton,
-- body butter by the tub. In that world a type that does not propagate is not
-- master data, it is a second place to keep the same fact in sync by hand,
-- which is the thing he asked me to stop doing.
--
-- So it propagates, and it says how many products it touched. Every row is
-- audit-logged individually with its before and after, because this is one tap
-- that can change 25 products.
--
-- It deliberately does NOT touch inactive products: they are history, and
-- rewriting what a discontinued line could be sold as would rewrite the past.

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
    select s.id, s.internal_code, s.sellable_units
      from skus s
      join variants v       on v.id = s.variant_id
      join product_models m on m.id = v.model_id
     where m.category_id = p_category_id
       and s.is_active
       and (select array_agg(u order by u) from unnest(s.sellable_units) u)
           is distinct from
           (select array_agg(u order by u) from unnest(p_units) u)
  loop
    update skus set sellable_units = p_units, updated_at = now() where id = r.id;

    insert into audit_log (table_name, record_id, action, field_name,
                           old_value, new_value, reason, changed_by)
    values ('skus', r.id, 'update', 'sellable_units',
            array_to_string(r.sellable_units, ','), array_to_string(p_units, ','),
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
  'row. Inactive products are left alone — they are history (0238).';

-- FROM PUBLIC, not just anon. CREATE FUNCTION grants EXECUTE to PUBLIC by
-- default, and anon inherits it — so revoking anon alone leaves the
-- function callable by anyone holding the publishable key.
revoke execute on function public.set_category_sellable_units(uuid, text[]) from public;
grant  execute on function public.set_category_sellable_units(uuid, text[]) to authenticated, service_role;

do $$
declare
  v_cat uuid;
  v_n   int;
begin
  select id into v_cat from product_categories where name = 'Diapers';
  if v_cat is null then
    raise notice 'no Diapers type here — guard not driven';
    return;
  end if;

  -- Already correct, so a no-op must report zero rather than rewriting 25 rows.
  select public.set_category_sellable_units(v_cat, array['pack','carton']) into v_n;
  if v_n <> 0 then
    raise exception 'setting a type to what it already is touched % product(s)', v_n;
  end if;

  if (select count(*) from public.get_setup_gaps() where gap = 'units_differ_from_type') <> 0 then
    raise exception 'a product disagrees with its type after the no-op';
  end if;
end $$;

-- 0237 — a gap carries the place it is fixed.
--
-- Ali, 2026-09-01:
--   *"It shouldn't exist in multiple places. And when something refers to it,
--    it must be able to take me to the correct place."*
--
-- Every Setup Gaps row already deep-links to where it is fixed: tapping a
-- product opens its edit sheet, through the `?editSku=` link that already
-- existed. That works because every gap so far has been fixed ON THE PRODUCT —
-- a missing price, a missing measurement, a missing cost.
--
-- `units_differ_from_type` (0236) is the first gap whose fix is somewhere else.
-- How a kind of product is sold now lives on the PRODUCT TYPE, so sending him
-- to the product's own sheet would be sending him to the one screen that cannot
-- fix it. The row therefore has to carry the type's id, and that means the
-- function has to return it.
--
-- Appended at the end of the return, which needs a DROP first: Postgres cannot
-- change a function's OUT columns with CREATE OR REPLACE (42P13).

drop function if exists public.get_setup_gaps();

create function public.get_setup_gaps()
returns table(sku_id uuid, internal_code text, full_path text, gap text,
              headline text, blocks text, stock_label text, stock_pieces integer,
              severity integer, category_id uuid)
language sql
stable security definer
set search_path to 'public'
as $function$
  with stock as (
    select bs.sku_id, sum(bs.qty_pieces_remaining)::integer as pieces
      from v_batch_stock bs where bs.qty_pieces_remaining > 0 group by bs.sku_id
  ),
  cost as (
    select distinct on (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
      from v_batch_stock bs where bs.qty_pieces_remaining > 0
     order by bs.sku_id, bs.received_at desc
  ),
  base as (
    select s.id, s.internal_code,
      concat_ws(' › ', b.name, m.name, v.display_name) as full_path,
      coalesce(st.pieces, 0) as pieces, c.landed_per_piece_mvr as landed,
      s.sellable_units, s.pcs_per_pack, s.packs_per_carton,
      pc.unit_uom, pc.name as category_name, pc.id as cat_id,
      pc.default_sellable_units as type_units,
      coalesce(s.cbm_per_carton, 0) as cbm,
      case when 'pack'   = any(s.sellable_units) then vs.selling_price_per_pack_mvr   end as price_pack,
      case when 'carton' = any(s.sellable_units) then vs.selling_price_per_carton_mvr end as price_carton
    from skus s
    join v_skus vs on vs.id = s.id
    join variants v on v.id = s.variant_id
    join product_models m on m.id = v.model_id
    join brands b on b.id = m.brand_id
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
  select id, internal_code, full_path, 'no_price', 'No selling price yet',
         case when pieces > 0 then 'Cannot be sold — there is ' || stock_label || ' waiting'
              else 'Cannot be sold' end,
         stock_label, pieces, case when pieces > 0 then 0 else 2 end, cat_id
    from labelled where price_pack is null and price_carton is null

  union all

  select id, internal_code, full_path, 'no_carton_price', 'No price for a carton',
         'Sells by the ' || noun || ', but a carton cannot be quoted',
         stock_label, pieces, 1, cat_id
    from labelled
   where 'carton' = any(sellable_units) and price_carton is null and price_pack is not null

  union all

  select id, internal_code, full_path, 'no_unit_price', 'No price for one ' || noun,
         'Sells by the carton, but a single ' || noun || ' cannot be quoted',
         stock_label, pieces, 1, cat_id
    from labelled
   where 'pack' = any(sellable_units) and price_pack is null and price_carton is not null

  union all

  -- Names BOTH sides, because either one can be the mistake: the XXXL diaper
  -- was the product, Liquid Detergent was the type. Whichever it is, cat_id
  -- takes him to the one place that decides it.
  select id, internal_code, full_path, 'units_differ_from_type',
         'Sold differently from other ' || lower(category_name),
         lower(l.category_name) || ' normally sell by the '
           || (select string_agg(case when u = 'carton' then 'carton'
                                      when u = 'pack'   then l.noun else u end, ' and '
                       order by case u when 'piece' then 1 when 'pack' then 2 when 'carton' then 3 else 4 end)
                 from unnest(l.type_units) u)
           || ' — this one sells by the '
           || (select string_agg(case when u = 'carton' then 'carton'
                                      when u = 'pack'   then l.noun else u end, ' and '
                       order by case u when 'piece' then 1 when 'pack' then 2 when 'carton' then 3 else 4 end)
                 from unnest(l.sellable_units) u)
           || ' only',
         stock_label, pieces, 1, cat_id
    from labelled l
   where type_units is not null and cardinality(type_units) > 0
     and (select array_agg(u order by u) from unnest(l.sellable_units) u)
         is distinct from (select array_agg(u order by u) from unnest(l.type_units) u)

  union all

  select id, internal_code, full_path, 'no_carton_size', 'No carton measurements',
         'A shipment carrying it cannot be received — freight has nothing to split on',
         stock_label, pieces, 1, cat_id
    from labelled where cbm <= 0

  union all

  select id, internal_code, full_path, 'no_cost', 'No landed cost recorded',
         'There is ' || stock_label || ' in the godown with no cost, so margin cannot be checked',
         stock_label, pieces, 1, cat_id
    from labelled where pieces > 0 and landed is null

  order by 9, 8 desc, 3;
$function$;

revoke execute on function public.get_setup_gaps() from anon;
grant  execute on function public.get_setup_gaps() to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_proc p
     where p.proname = 'get_setup_gaps' and p.pronamespace = 'public'::regnamespace
       and 'category_id' = any(p.proargnames)
  ) then
    raise exception 'get_setup_gaps does not return the product type to fix it on';
  end if;

  if exists (select 1 from public.get_setup_gaps() where category_id is null) then
    raise exception 'a gap came back with no product type to go to';
  end if;
end $$;

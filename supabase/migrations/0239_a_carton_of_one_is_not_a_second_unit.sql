-- 0239 — a carton holding one pack is not a second unit, so it cannot disagree.
--
-- 0236 flags a product sold differently from its kind. Two existing suites
-- stopped on it, and both were right:
--
--   setup_gaps.test.sql   a tub, 1 per pack and 1 per carton, sold by the pack,
--                         in a type that says pack + carton. Reported as
--                         "sold differently from other test category".
--
-- It is not sold differently. For that product a carton IS the pack — one tub
-- either way — so "sells cartons too" and "does not" describe the same thing.
-- Flagging it is noise on a panel whose whole discipline is that every line is
-- actionable or absent, and the action here would be to tick a box that changes
-- nothing about what can be bought.
--
-- This is the same reasoning already applied twice: 0234's constraint exempted
-- `packs_per_carton <= 1`, and so did the gap 0235 introduced. 0236 generalised
-- the rule and dropped the exemption on the way through — the generalisation
-- was right, losing the exemption was not.
--
-- So the comparison is against the type's units MINUS the carton when a carton
-- holds one pack. Everything else is untouched: a real multi-pack carton that
-- the product refuses is still reported, which is Ali's actual case.

create or replace function public.get_setup_gaps()
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
      -- THE TYPE, AS IT APPLIES TO THIS PRODUCT. A carton of one pack is the
      -- pack, so the type's carton is not a unit this product can differ about.
      case when s.packs_per_carton <= 1
           then array_remove(pc.default_sellable_units, 'carton')
           else pc.default_sellable_units end as type_units,
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

-- FROM PUBLIC, not just anon. CREATE FUNCTION grants EXECUTE to PUBLIC by
-- default and every role inherits it, so revoking anon alone leaves the
-- function callable by anyone holding the publishable key. CREATE OR REPLACE
-- keeps existing grants, but this is stated on every rebuild so a future DROP
-- and CREATE cannot silently re-open it.
revoke execute on function public.get_setup_gaps() from public;
grant  execute on function public.get_setup_gaps() to authenticated, service_role;

do $$
begin
  if (select count(*) from public.get_setup_gaps() where gap = 'units_differ_from_type') <> 0 then
    raise exception 'a product still disagrees with its type';
  end if;

  if has_function_privilege('anon', 'public.get_setup_gaps()', 'execute') then
    raise exception 'get_setup_gaps is still callable without signing in';
  end if;
end $$;

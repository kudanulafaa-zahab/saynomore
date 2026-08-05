-- 0137 — Speak packs and cartons, and roll a shipment up so it can be read.
--
-- Two of Ali's standing points, both about the same thing: the app was
-- printing pieces at him when nobody in this trade counts diapers in pieces.
-- The vendor sells packs and cartons; he sells packs and cartons.
--
-- Where pieces genuinely stay (all internal, none of it on screen):
--   * the stock ledger — stock is SUM(stock_movements.qty_pieces), which is
--     what allows a part-opened carton to exist at all;
--   * landed cost — a carton's cost must divide down to a piece before it can
--     be compared against a selling price at any unit;
--   * competitor comparison — rivals sell 30s/34s/48s, so per-piece is the
--     only comparable unit (Ali's own observation, and correct);
--   * mixed cartons — a Sosoft carton holding four scents can only be counted
--     below the carton.
--
-- 1. sales_order_item_summary now reads "1 carton (4 packs of 48)" instead of
--    "1 carton (4×48 = 192 pcs)". Pack SIZE is kept because that is how a
--    diaper variant is identified in the trade — a 48s and a 34s are different
--    products. The unit noun (piece/bottle) is derived from the product
--    category rather than hardcoded.
--
-- 2. get_shipment_summary answers "how many cases of each brand did I order?"
--    without anyone scrolling the line list and adding up by hand. Grouped
--    category → brand → model, counted in CARTONS, with ordered and received
--    kept separate so a short shipment is impossible to miss.
--
-- Both were applied live via MCP; this file is the tracked copy. See
-- migrations named order_summary_speaks_packs_and_cartons,
-- order_summary_unit_noun and shipment_order_summary in the remote log.

create or replace function public.sales_order_item_summary(p_order_id uuid)
returns text
language sql
stable
set search_path to 'public'
as $function$
  with l as (
    select
      sol.uom, sol.qty, sol.qty_pieces, sol.line_total_mvr,
      sol.is_mixed_carton_fill,
      b.name as brand, m.name as model, v.display_name as variant,
      s.pcs_per_pack, s.packs_per_carton,
      case pc.unit_uom
        when 'ml' then 'bottle'
        when 'g'  then 'pack'
        else 'piece'
      end as unit_noun
    from sales_order_lines sol
    join skus s             on s.id = sol.sku_id
    join variants v         on v.id = s.variant_id
    join product_models m   on m.id = v.model_id
    join brands b           on b.id = m.brand_id
    join product_categories pc on pc.id = m.category_id
    where sol.order_id = p_order_id
  ),
  agg as (
    select count(*) as n,
           bool_and(l.is_mixed_carton_fill) as all_mixed,
           count(distinct l.brand) as brands,
           sum(l.qty_pieces) as pieces,
           min(l.brand) as one_brand,
           min(l.unit_noun) as one_noun
    from l
  ),
  top_line as (
    select l.*,
           trim(trailing '.' from trim(trailing '0' from l.qty::text)) as qty_txt
    from l
    order by l.line_total_mvr desc, l.model, l.variant
    limit 1
  )
  select case
    when (select n from agg) = 0 then null
    when (select all_mixed from agg) and (select n from agg) > 1 and (select brands from agg) = 1 then
      (select one_brand from agg) || ' mixed carton - ' || (select pieces from agg) || ' '
      || (select one_noun from agg) || case when (select pieces from agg) = 1 then '' else 's' end
      || ' ('
      || (select string_agg(x.model || ' ' || x.q, ' · ' order by x.qty_pieces desc, x.model)
          from (select l.model, l.qty_pieces,
                       trim(trailing '.' from trim(trailing '0' from l.qty::text)) as q
                from l) x)
      || ')'
    else
      (select
         btrim(t.model || ' ' || t.variant) || ' - ' ||
         case t.uom
           when 'carton' then
             t.qty_txt || ' carton' || case when t.qty = 1 then '' else 's' end
             || ' (' || t.packs_per_carton || ' packs of ' || t.pcs_per_pack || ')'
           when 'pack' then
             t.qty_txt || ' pack' || case when t.qty = 1 then '' else 's' end
             || ' of ' || t.pcs_per_pack
           else
             t.qty_pieces || ' ' || t.unit_noun
             || case when t.qty_pieces = 1 then '' else 's' end
         end
         || case when (select n from agg) > 1
                 then '  +' || ((select n from agg) - 1) || ' more'
                 else '' end
       from top_line t)
  end;
$function$;

revoke execute on function public.sales_order_item_summary(uuid) from public, anon;
grant  execute on function public.sales_order_item_summary(uuid) to authenticated, service_role;


create or replace function public.get_shipment_summary(p_shipment_id uuid)
returns table (
  category_name       text,
  category_sort_order integer,
  brand_name          text,
  model_name          text,
  sku_count           integer,
  cartons_ordered     numeric,
  cartons_received    numeric,
  loose_packs         numeric,
  cbm_total           numeric,
  fob_total_mvr       numeric,
  landed_total_mvr    numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select
    coalesce(pc.name, 'Uncategorised'),
    pc.sort_order,
    b.name,
    m.name,
    count(distinct sl.sku_id)::integer,
    sum(sl.qty_cartons)::numeric,
    sum(coalesce(sl.qty_cartons_actual, sl.qty_cartons))::numeric,
    sum(coalesce(sl.qty_loose_packs, 0))::numeric,
    round(sum(coalesce(sl.qty_cartons_actual, sl.qty_cartons) * sl.cbm_per_carton), 4),
    round(sum(coalesce(sl.fob_total_mvr, 0)), 2),
    round(sum(coalesce(sl.landed_total_mvr, 0)), 2)
  from shipment_lines sl
  join skus s                on s.id = sl.sku_id
  join variants v            on v.id = s.variant_id
  join product_models m      on m.id = v.model_id
  join brands b              on b.id = m.brand_id
  left join product_categories pc on pc.id = m.category_id
  where sl.shipment_id = p_shipment_id
  group by pc.name, pc.sort_order, b.name, m.name
  order by pc.sort_order nulls last, b.name, m.name;
$function$;

revoke execute on function public.get_shipment_summary(uuid) from public, anon;
grant  execute on function public.get_shipment_summary(uuid) to authenticated, service_role;

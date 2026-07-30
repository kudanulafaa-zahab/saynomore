-- Body Care category (for The Body Shop Body Butter, single-tub, no pack/carton
-- tier) + a general seasonal/on-sale mechanism on product_models, surfaced
-- through get_storefront_catalogue().

insert into product_categories (
  name, unit_uom, cost_basis, variant_attributes, sort_order,
  default_sellable_units, duty_rate_pct, storefront_visible
) values (
  'Body Care', 'pcs', 'piece', '["scent"]'::jsonb, 110,
  '{piece}', 0, true
);

alter table product_models
  add column is_seasonal boolean not null default false,
  add column is_on_sale  boolean not null default false;

drop function if exists public.get_storefront_catalogue();

create function public.get_storefront_catalogue()
 returns table(sku_id uuid, brand_id uuid, brand_name text, model_id uuid, model_name text, variant_id uuid, variant_display text, attributes jsonb, image_url text, category_id uuid, category_name text, category_sort_order integer, pcs_per_pack integer, packs_per_carton integer, pcs_per_carton integer, sellable_units text[], mixed_carton_pieces integer, is_seasonal boolean, is_on_sale boolean, selling_price_per_piece_mvr numeric, selling_price_per_pack_mvr numeric, selling_price_per_carton_mvr numeric, is_orderable boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with latest_landed as (
    select distinct on (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
    from v_batch_stock bs
    where bs.qty_pieces_remaining > 0
    order by bs.sku_id, bs.received_at desc
  ),
  web_stock as (
    select bs.sku_id, sum(bs.qty_pieces_remaining) as qty_pieces
    from v_batch_stock bs
    where bs.godown_id = get_web_fulfilment_godown_id()
    group by bs.sku_id
  )
  select
    s.id                    as sku_id,
    b.id                    as brand_id,
    b.name                  as brand_name,
    m.id                    as model_id,
    m.name                  as model_name,
    v.id                    as variant_id,
    v.display_name          as variant_display,
    v.attributes,
    v.image_url,
    pc.id                   as category_id,
    pc.name                 as category_name,
    pc.sort_order           as category_sort_order,
    s.pcs_per_pack,
    s.packs_per_carton,
    s.pcs_per_pack * s.packs_per_carton as pcs_per_carton,
    s.sellable_units,
    b.mixed_carton_pieces,
    m.is_seasonal,
    m.is_on_sale,
    case
      when s.fixed_selling_price_mvr is not null then round(s.fixed_selling_price_mvr, 0)
      when s.target_margin_pct is not null and ll.landed_per_piece_mvr is not null
        then round(ll.landed_per_piece_mvr / (1 - s.target_margin_pct / 100.0), 0)
      else null
    end as selling_price_per_piece_mvr,
    case
      when s.fixed_price_per_pack_mvr is not null then round(s.fixed_price_per_pack_mvr, 0)
      when s.fixed_selling_price_mvr is not null then round(s.fixed_selling_price_mvr * s.pcs_per_pack, 0)
      when s.target_margin_pct is not null and ll.landed_per_piece_mvr is not null
        then round(ll.landed_per_piece_mvr * s.pcs_per_pack / (1 - s.target_margin_pct / 100.0), 0)
      else null
    end as selling_price_per_pack_mvr,
    case
      when s.fixed_price_per_carton_mvr is not null then round(s.fixed_price_per_carton_mvr, 0)
      when s.fixed_selling_price_mvr is not null then round(s.fixed_selling_price_mvr * s.pcs_per_pack * s.packs_per_carton, 0)
      when s.target_margin_pct is not null and ll.landed_per_piece_mvr is not null
        then round(ll.landed_per_piece_mvr * s.pcs_per_pack * s.packs_per_carton / (1 - s.target_margin_pct / 100.0), 0)
      else null
    end as selling_price_per_carton_mvr,
    (s.is_active and coalesce(ws.qty_pieces, 0) > 0) as is_orderable
  from skus s
  join variants v         on v.id = s.variant_id
  join product_models m   on m.id = v.model_id
  join brands b           on b.id = m.brand_id
  join product_categories pc on pc.id = m.category_id
  left join latest_landed ll on ll.sku_id = s.id
  left join web_stock ws     on ws.sku_id = s.id
  where s.is_active and pc.storefront_visible;
$function$;

revoke all on function public.get_storefront_catalogue() from public;
grant execute on function public.get_storefront_catalogue() to anon, authenticated;

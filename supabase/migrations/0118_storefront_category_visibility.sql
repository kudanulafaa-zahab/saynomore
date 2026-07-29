-- 0118 — Age-restricted categories must never surface in the guest web shop.
--
-- Found while building the storefront browse UI: get_storefront_catalogue()
-- (migration 0115) filters only on skus.is_active — a Tobacco category
-- exists in this catalogue, and it would appear the moment a tobacco SKU is
-- switched active, with no age gate at all (this is guest checkout — no
-- accounts, no verification of any kind). Nothing is live-broken today (0
-- active Tobacco SKUs right now), but shipping the browse UI without this
-- guard would make "sell tobacco to an unverified stranger online" an
-- accident waiting on someone flipping is_active, not a decision anyone
-- actually made.
--
-- A boolean on the category (not a hardcoded 'Tobacco' string inside the
-- function) so any future restricted category is a one-row flip, not a new
-- migration.

alter table public.product_categories
  add column if not exists storefront_visible boolean not null default true;

update public.product_categories set storefront_visible = false where name = 'Tobacco';

-- Reproduced verbatim from 0115 except the added `and pc.storefront_visible`
-- in the final WHERE — every price/column expression is byte-for-byte the
-- same as the original so nothing about existing pricing changes.
create or replace function public.get_storefront_catalogue()
returns table (
  sku_id                      uuid,
  brand_id                    uuid,
  brand_name                  text,
  model_id                    uuid,
  model_name                  text,
  variant_id                  uuid,
  variant_display             text,
  attributes                  jsonb,
  image_url                   text,
  category_id                 uuid,
  category_name               text,
  category_sort_order         int,
  pcs_per_pack                int,
  packs_per_carton            int,
  pcs_per_carton              int,
  sellable_units              text[],
  mixed_carton_pieces         int,
  selling_price_per_piece_mvr numeric,
  selling_price_per_pack_mvr  numeric,
  selling_price_per_carton_mvr numeric,
  is_orderable                boolean
)
language sql
stable
security definer
set search_path = public
as $$
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
$$;

comment on function public.get_storefront_catalogue() is
  'Public storefront catalogue read. SECURITY DEFINER and anon-granted on '
  'purpose — see migration 0115 for why a plain view does not work here. '
  'Never add a column without checking it against the excluded-fields list '
  'in that file''s header comment first. Excludes any category where '
  'storefront_visible = false (e.g. Tobacco) regardless of stock/is_active.';

revoke execute on function public.get_storefront_catalogue() from public;
grant execute on function public.get_storefront_catalogue() to anon, authenticated, service_role;

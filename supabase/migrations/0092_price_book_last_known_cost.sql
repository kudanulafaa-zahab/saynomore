-- ============================================================================
-- 0092 — Price Book: fall back to last-known landed cost when out of stock
-- ============================================================================
-- Bug (Ali, screenshot): Xtra Kering NB/S showed "No landed cost yet" even
-- though a cost was captured. Cause: get_price_book reads
-- v_skus.landed_per_piece_mvr, which is the CURRENT FIFO cost of IN-STOCK
-- batches — so the instant a SKU sells out, its cost (and therefore its margin)
-- vanishes from the Price Book, even though we know exactly what the last batch
-- landed at. NB/S has a real landed cost of ~MVR 2.13/piece on a now-depleted
-- batch.
--
-- Fix: when the live in-stock cost is null, fall back to the SKU's most recent
-- batch landed cost (depleted or not). A SKU that has genuinely never been
-- received still has no batch → still correctly "no_cost". Same return shape,
-- so CREATE OR REPLACE (grants preserved).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_price_book()
RETURNS TABLE(
  sku_id uuid, brand_name text, category_name text, category_sort_order integer,
  model_name text, variant_display text, internal_code text,
  pcs_per_pack integer, packs_per_carton integer, trade_unit text,
  landed_cost_mvr numeric, price_mvr numeric, profit_mvr numeric, margin_pct numeric,
  target_margin_pct numeric, flag text
)
LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$
  with last_landed as (
    -- Most recent batch cost per SKU, including depleted batches, so a SKU that
    -- is currently out of stock still shows the cost it last landed at.
    select distinct on (ib.sku_id) ib.sku_id, ib.landed_per_piece_mvr
    from public.inventory_batches ib
    where ib.landed_per_piece_mvr is not null
    order by ib.sku_id, ib.received_at desc nulls last, ib.created_at desc
  ),
  base as (
    select
      s.id, s.brand_name, s.category_name, s.category_sort_order,
      s.model_name, s.variant_display, s.internal_code,
      s.pcs_per_pack, s.packs_per_carton, s.pcs_per_carton,
      coalesce(s.landed_per_piece_mvr, ll.landed_per_piece_mvr) as landed_per_piece_mvr,
      s.selling_price_per_piece_mvr, s.selling_price_per_pack_mvr, s.selling_price_per_carton_mvr,
      s.target_margin_pct,
      case
        when s.mixed_carton_pieces is not null then 'carton'
        when 'pack'   = any(s.default_sellable_units::text[]) then 'pack'
        when 'carton' = any(s.default_sellable_units::text[]) then 'carton'
        else 'piece'
      end as trade_unit
    from public.v_skus s
    left join last_landed ll on ll.sku_id = s.id
    where s.is_active
  ),
  unitised as (
    select b.*,
      case b.trade_unit
        when 'carton' then b.landed_per_piece_mvr * b.pcs_per_carton
        when 'pack'   then b.landed_per_piece_mvr * b.pcs_per_pack
        else b.landed_per_piece_mvr
      end as cost,
      case b.trade_unit
        when 'carton' then b.selling_price_per_carton_mvr
        when 'pack'   then b.selling_price_per_pack_mvr
        else b.selling_price_per_piece_mvr
      end as price
    from base b
  )
  select
    id, brand_name, category_name, category_sort_order, model_name, variant_display, internal_code,
    pcs_per_pack, packs_per_carton, trade_unit,
    round(cost, 2),
    round(price, 2),
    case when price is not null and cost is not null then round(price - cost, 2) else null end,
    case when price > 0 and cost is not null then round((price - cost) / price * 100, 1) else null end,
    target_margin_pct,
    case
      when cost is null then 'no_cost'
      when price is null or price = 0 then 'no_price'
      when price - cost < 0 then 'loss'
      when (price - cost) / price * 100 < 20 then 'thin'
      else 'ok'
    end
  from unitised
  order by brand_name, category_sort_order, model_name, variant_display;
$function$;

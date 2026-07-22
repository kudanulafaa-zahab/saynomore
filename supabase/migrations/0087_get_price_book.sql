-- 0087 — Price Book engine
--
-- One row per active SKU with the numbers a price book needs, all computed in
-- Postgres (never TS): landed cost, selling price and PROFIT + true current
-- margin per the unit the product actually trades in (carton for mixed-carton
-- brands, else pack, else piece). v_skus already computes landed cost and
-- prices; the missing piece is the live margin for target-priced SKUs (v_skus
-- only fills actual_margin_pct for fixed prices), so we derive it here from
-- price and today's cost. The UI is a pure renderer over this.

create or replace function public.get_price_book()
returns table (
  sku_id             uuid,
  brand_name         text,
  category_name      text,
  category_sort_order int,
  model_name         text,
  variant_display    text,
  internal_code      text,
  pcs_per_pack       int,
  packs_per_carton   int,
  trade_unit         text,
  landed_cost_mvr    numeric,
  price_mvr          numeric,
  profit_mvr         numeric,
  margin_pct         numeric,
  target_margin_pct  numeric,
  flag               text
)
language sql
security definer
set search_path = ''
as $$
  with base as (
    select
      s.id, s.brand_name, s.category_name, s.category_sort_order,
      s.model_name, s.variant_display, s.internal_code,
      s.pcs_per_pack, s.packs_per_carton, s.pcs_per_carton,
      s.landed_per_piece_mvr,
      s.selling_price_per_piece_mvr, s.selling_price_per_pack_mvr, s.selling_price_per_carton_mvr,
      s.target_margin_pct,
      case
        when s.mixed_carton_pieces is not null then 'carton'
        when 'pack'   = any(s.default_sellable_units::text[]) then 'pack'
        when 'carton' = any(s.default_sellable_units::text[]) then 'carton'
        else 'piece'
      end as trade_unit
    from public.v_skus s
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
$$;

revoke all on function public.get_price_book() from anon, public;
grant execute on function public.get_price_book() to authenticated;

comment on function public.get_price_book() is
  'Price Book: per-SKU landed cost, price, profit and live margin at the trade unit, computed in Postgres. Read-only; used by Market -> Price Book.';

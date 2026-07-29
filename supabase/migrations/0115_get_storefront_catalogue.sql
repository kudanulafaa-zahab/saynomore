-- 0115 — get_storefront_catalogue(): what an anonymous shopper is allowed to see.
--
-- WHY A FUNCTION, NOT A VIEW (a real bug caught while building this — read
-- before changing this again)
--
-- The first draft was a plain `create view v_storefront_catalogue` without
-- `security_invoker` (the Postgres default: a view runs as its OWNER for
-- permission purposes). That still failed for anon:
--   ERROR: permission denied for function is_admin_or_manager
--
-- Cause, confirmed empirically, twice, with two different query shapes:
-- `inventory_batches` and `stock_movements` (which `v_batch_stock` joins, and
-- which this catalogue needs for stock/cost) each carry a permissive
-- `FOR ALL USING (is_admin_or_manager())` policy OR'd against their plain
-- `SELECT ... USING (auth.uid() IS NOT NULL)` read policy. For anon,
-- `auth.uid() IS NOT NULL` evaluates false, so Postgres must evaluate the
-- second disjunct to resolve the OR — and evaluating a function anon has no
-- EXECUTE on is a hard error, not a false. A non-invoker VIEW elevates the
-- base-table SELECT *privilege* check to the view owner, but does NOT extend
-- that elevation into function calls embedded inside RLS POLICY EXPRESSIONS
-- on the tables it reaches — those still run under the actual connecting
-- role. Verified: `has_function_privilege('anon',
-- 'public.is_admin_or_manager()', 'EXECUTE')` = false.
--
-- A SECURITY DEFINER FUNCTION does not have this gap — its entire body,
-- including any RLS policy evaluation triggered along the way, runs as the
-- function's owner. This is exactly why every other public read surface
-- built this session (get_sales_orders, get_order_audit,
-- get_stock_count_sessions, ...) is a function, never a bare view, and why
-- none of them hit this wall. Same pattern here, for the same reason.
--
-- SECURITY MODEL (unchanged from the view draft)
--   1. The column list is hand-curated and excludes, BY NAME, every cost/
--      margin/internal field: internal_code, supplier_barcode, notes,
--      landed_per_piece_mvr, actual_margin_pct, target_margin_pct,
--      fixed_selling_price_mvr, fixed_price_per_pack_mvr,
--      fixed_price_per_carton_mvr. Only a derived selling PRICE is exposed —
--      never the cost or margin that produced it.
--   2. `anon` is granted EXECUTE on this function and NOTHING ELSE — not on
--      skus/variants/product_models/brands/product_categories/v_skus/
--      v_batch_stock/inventory_batches/stock_movements, all of which remain
--      exactly as locked down as before this migration.
-- Any addition to the column list must extend this comment and justify why
-- the new column is safe for a stranger on the internet to read.
--
-- Selling-price logic is copied verbatim from v_skus (migration 0075) so
-- storefront prices always match what staff see internally.
--
-- is_orderable is the one stock signal exposed, and it is a boolean, not a
-- count: whether the web fulfilment godown (migration 0113, looked up via
-- get_web_fulfilment_godown_id() from 0115's first draft — also a SECURITY
-- DEFINER function, for the identical reason) currently holds any of this
-- SKU. Raw per-godown stock quantities are internal ops data.

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
  where s.is_active;
$$;

comment on function public.get_storefront_catalogue() is
  'Public storefront catalogue read. SECURITY DEFINER and anon-granted on '
  'purpose — see the migration header for why a plain view does not work '
  'here. Never add a column without checking it against the excluded-fields '
  'list in this file''s header comment first.';

revoke execute on function public.get_storefront_catalogue() from public;
grant execute on function public.get_storefront_catalogue() to anon, authenticated, service_role;

-- Superseded by the function above — a security_invoker=false view cannot
-- safely reach RLS-guarded stock tables for anon (see header). Drop it so
-- there is exactly one public catalogue read surface, not two.
drop view if exists public.v_storefront_catalogue;

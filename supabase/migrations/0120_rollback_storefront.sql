-- 0120 — Roll back the customer storefront (migrations 0112-0119).
--
-- Ali reviewed the built shop end-to-end and asked to roll back to exactly
-- before the storefront work started, to redesign it fresh. This migration
-- reverses every storefront-only schema/function change. Nothing here is a
-- data-loss risk: verified live, immediately before writing this migration,
-- that zero real web orders exist (order_source='web' / channel='web'),
-- zero real customers have channel='web', zero products sit under the
-- 'Body Care' category, and zero product_models are flagged
-- is_seasonal/is_on_sale — every object dropped below is empty scaffolding,
-- not business data.
--
-- Explicitly KEPT, on purpose: variants.image_url, the product-images storage
-- bucket, and the photo-upload UI in the internal Edit Variant dialog
-- (migration 0114). These were built FOR the storefront (to populate
-- get_storefront_catalogue()'s image_url column) but the feature itself is
-- staff-facing, not customer-facing, and has no dependency on anything else
-- being dropped here — 7 real staff-uploaded product photos already exist
-- through this path and would otherwise be lost for no reason.
--
-- sales_orders.order_source itself is also kept (not dropped back to
-- untracked/nullable): it predates this work live in the database and is
-- harmless as NOT NULL default 'walk-in'. Only 'web' is removed from the two
-- check constraints that allowed it, so no new web order can be recorded.

-- ── 1. The public write path ────────────────────────────────────────────────
drop function if exists public.place_customer_order(text, text, text, text, text, jsonb, text, text);
drop table if exists public.storefront_order_attempts;

-- ── 2. The public read path ─────────────────────────────────────────────────
drop function if exists public.get_storefront_catalogue();
drop function if exists public.get_web_fulfilment_godown_id();

-- ── 3. Sales list/Dispatch — restore the exact pre-0117 signatures ─────────
-- Byte-for-byte the original bodies from migration 0101, minus order_source
-- (which that migration never returned) and minus p_order_source (which it
-- never accepted).
drop function if exists public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int, text);
drop function if exists public.get_sales_orders_count(text, text, boolean, uuid, text);

create function public.get_sales_orders(
  p_status            text        default null,
  p_search            text        default null,
  p_unpaid            boolean     default false,
  p_customer_id       uuid        default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 30
)
returns table (
  id                     uuid,
  order_number           text,
  customer_id            uuid,
  status                 text,
  channel                text,
  payment_status         text,
  payment_method         text,
  payment_proof_url      text,
  source_godown_id       uuid,
  delivery_address_line1 text,
  delivery_address_line2 text,
  delivery_island        text,
  delivery_to_boat       boolean,
  assigned_driver_id     uuid,
  picked_at              timestamptz,
  delivered_at           timestamptz,
  cash_collected_mvr     numeric,
  cash_deposited_at      timestamptz,
  notes                  text,
  created_by             uuid,
  created_at             timestamptz,
  updated_at             timestamptz,
  order_total_mvr        numeric
)
language sql
stable
set search_path = public
as $$
  select
    o.id, o.order_number, o.customer_id, o.status, o.channel,
    o.payment_status, o.payment_method, o.payment_proof_url,
    o.source_godown_id, o.delivery_address_line1, o.delivery_address_line2,
    o.delivery_island, o.delivery_to_boat, o.assigned_driver_id,
    o.picked_at, o.delivered_at, o.cash_collected_mvr, o.cash_deposited_at,
    o.notes, o.created_by, o.created_at, o.updated_at,
    coalesce((select sum(l.line_total_mvr)
                from sales_order_lines l
               where l.order_id = o.id), 0)::numeric as order_total_mvr
  from sales_orders o
  left join customers c on c.id = o.customer_id
  where
    (p_status is null or p_status = 'all' or o.status = p_status)
    and (p_customer_id is null or o.customer_id = p_customer_id)
    and (not p_unpaid or (
          o.status not in ('draft', 'cancelled')
          and o.payment_status in ('pending', 'partial')))
    and (
      p_search is null or btrim(p_search) = ''
      or o.order_number  ilike '%' || btrim(p_search) || '%'
      or c.name          ilike '%' || btrim(p_search) || '%'
      or c.phone         ilike '%' || btrim(p_search) || '%'
    )
    and (
      p_cursor_created_at is null
      or (o.created_at, o.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by o.created_at desc, o.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

create function public.get_sales_orders_count(
  p_status      text    default null,
  p_search      text    default null,
  p_unpaid      boolean default false,
  p_customer_id uuid    default null
)
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)
  from sales_orders o
  left join customers c on c.id = o.customer_id
  where
    (p_status is null or p_status = 'all' or o.status = p_status)
    and (p_customer_id is null or o.customer_id = p_customer_id)
    and (not p_unpaid or (
          o.status not in ('draft', 'cancelled')
          and o.payment_status in ('pending', 'partial')))
    and (
      p_search is null or btrim(p_search) = ''
      or o.order_number  ilike '%' || btrim(p_search) || '%'
      or c.name          ilike '%' || btrim(p_search) || '%'
      or c.phone         ilike '%' || btrim(p_search) || '%'
    );
$$;

revoke execute on function public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int) from public, anon;
revoke execute on function public.get_sales_orders_count(text, text, boolean, uuid)                    from public, anon;

grant execute on function public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int)  to authenticated, service_role;
grant execute on function public.get_sales_orders_count(text, text, boolean, uuid)                     to authenticated, service_role;

-- ── 4. Storefront-only category/model flags and the empty Body Care row ────
delete from public.product_categories where name = 'Body Care';

alter table public.product_models
  drop column if exists is_seasonal,
  drop column if exists is_on_sale;

alter table public.product_categories
  drop column if exists storefront_visible;

alter table public.godowns
  drop column if exists is_web_fulfilment;

-- ── 5. 'web' is no longer an accepted channel or order_source ──────────────
alter table public.sales_orders
  drop constraint if exists sales_orders_channel_check;

alter table public.sales_orders
  add constraint sales_orders_channel_check
  check (channel in (
    'whatsapp','viber','messenger','instagram','tiktok','facebook',
    'walkin','phone','other'
  ));

alter table public.sales_orders
  drop constraint if exists sales_orders_order_source_check;

alter table public.sales_orders
  add constraint sales_orders_order_source_check
  check (order_source in ('walk-in'));

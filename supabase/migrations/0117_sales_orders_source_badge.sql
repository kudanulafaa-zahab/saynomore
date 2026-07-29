-- 0117 — Surface order_source through get_sales_orders, add a Web filter.
--
-- migration 0112 backfilled order_source into the tracked schema, but the
-- curated get_sales_orders/get_sales_orders_count RPCs (migration 0101)
-- still don't return or filter on it — the Sales list's OrderRow can't show
-- a "Web" badge for something it never receives. (Dispatch and My Deliveries
-- need no change here: they call `.select("*")` directly on sales_orders,
-- so they already receive order_source for free.)
--
-- Dropped first: adding an OUT column changes the function's return row
-- type, which CREATE OR REPLACE cannot do (same reason 0108 had to drop
-- get_stock_count_sessions before redefining it).

drop function if exists public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int);

create function public.get_sales_orders(
  p_status            text        default null,
  p_search            text        default null,
  p_unpaid            boolean     default false,
  p_customer_id       uuid        default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 30,
  p_order_source      text        default null   -- null or 'all' = any source
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
  order_source           text,
  order_total_mvr        numeric
)
-- SECURITY INVOKER, unchanged from 0101: sales_orders is RLS-protected and a
-- staff driver must keep seeing only their own assigned runs.
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
    o.notes, o.created_by, o.created_at, o.updated_at, o.order_source,
    coalesce((select sum(l.line_total_mvr)
                from sales_order_lines l
               where l.order_id = o.id), 0)::numeric as order_total_mvr
  from sales_orders o
  left join customers c on c.id = o.customer_id
  where
    (p_status is null or p_status = 'all' or o.status = p_status)
    and (p_customer_id is null or o.customer_id = p_customer_id)
    and (p_order_source is null or p_order_source = 'all' or o.order_source = p_order_source)
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

revoke execute on function public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int, text) from public, anon;
grant execute on function public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int, text) to authenticated, service_role;

-- get_sales_orders_count's RETURN shape (bigint) is unchanged, but its
-- PARAMETER list is gaining p_order_source — and that alone is enough to
-- make CREATE OR REPLACE create a second, ambiguous overload instead of
-- replacing the first, exactly the mistake migration 0108 made with
-- record_verification (fixed in 0110: "function ... is not unique"). Drop
-- the old 4-argument signature explicitly before defining the 5-argument one.
drop function if exists public.get_sales_orders_count(text, text, boolean, uuid);

create function public.get_sales_orders_count(
  p_status       text    default null,
  p_search       text    default null,
  p_unpaid       boolean default false,
  p_customer_id  uuid    default null,
  p_order_source text    default null
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
    and (p_order_source is null or p_order_source = 'all' or o.order_source = p_order_source)
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

revoke execute on function public.get_sales_orders_count(text, text, boolean, uuid, text) from public, anon;
grant execute on function public.get_sales_orders_count(text, text, boolean, uuid, text) to authenticated, service_role;

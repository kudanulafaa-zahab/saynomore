-- 0101 — Server-side, keyset-paginated Sales list.
--
-- WHY
-- The Sales screen called listOrders(), which downloaded EVERY order ever —
-- with every order line joined — and then showed 20. The render was capped;
-- the download was not. At 53 orders that is invisible; at three years of
-- trading it is the whole ledger over mobile data on every open.
--
-- WHAT (the standard, not an invention)
-- 1. KEYSET pagination, not OFFSET. OFFSET n makes Postgres walk and discard
--    n rows first, so page 50 costs 50x page 1. Keyset carries the last row's
--    sort key as a cursor — (created_at, id) — and seeks straight to it, so
--    page 500 costs the same as page 1. The id is part of the cursor because
--    created_at is not unique: without it, two orders on the same timestamp
--    can be shown twice or skipped entirely.
-- 2. FILTERING MOVES TO THE SERVER. Once the client only holds one page,
--    filtering the client's array is wrong — searching would only search the
--    rows already downloaded. Status, unpaid and text search all run here.
-- 3. THE TOTAL IS COMPUTED HERE. listOrders() summed line totals in
--    TypeScript. Project hard rule: money math lives in Postgres.
--
-- Also fixes a quiet bug: the New Sale dialog previewed the next order number
-- by scanning the downloaded orders client-side. The number is actually
-- assigned by the assign_sales_order_number trigger from an atomic counter,
-- so the preview was already only a guess — and with pagination it would guess
-- from one page. peek_next_order_number() reads the real counter instead.

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Matches the ORDER BY exactly so the keyset seek is an index scan, not a sort.
create index if not exists idx_sales_orders_keyset
  on public.sales_orders (created_at desc, id desc);

-- Status chips filter on this before the keyset seek.
create index if not exists idx_sales_orders_status_keyset
  on public.sales_orders (status, created_at desc, id desc);

-- ── The page reader ─────────────────────────────────────────────────────────
create or replace function public.get_sales_orders(
  p_status            text        default null,   -- null or 'all' = any status
  p_search            text        default null,   -- order no. / customer name / phone
  p_unpaid            boolean     default false,  -- live orders still owing money
  p_customer_id       uuid        default null,   -- one customer's orders
  p_cursor_created_at timestamptz default null,   -- last row of the previous page
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
-- SECURITY INVOKER on purpose. sales_orders is RLS-protected: managers and
-- admins see everything, a staff driver sees only orders assigned to them.
-- A SECURITY DEFINER function would run as the owner and hand every order to
-- whoever called it. Running as the caller keeps RLS in force, so this reads
-- exactly what the old direct-table query read — no more, no less.
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
    -- Unpaid = every LIVE order still owing money. Deliberately spans
    -- confirmed -> out_for_delivery -> delivered so this matches
    -- get_receivables_aging and the dashboard tile that links in.
    and (not p_unpaid or (
          o.status not in ('draft', 'cancelled')
          and o.payment_status in ('pending', 'partial')))
    and (
      p_search is null or btrim(p_search) = ''
      or o.order_number  ilike '%' || btrim(p_search) || '%'
      or c.name          ilike '%' || btrim(p_search) || '%'
      or c.phone         ilike '%' || btrim(p_search) || '%'
    )
    -- Keyset seek. Row-value comparison, so Postgres can use the composite
    -- index directly instead of expanding it into OR branches.
    and (
      p_cursor_created_at is null
      or (o.created_at, o.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by o.created_at desc, o.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- ── How many match (for the banner, not for paging) ─────────────────────────
create or replace function public.get_sales_orders_count(
  p_status      text    default null,
  p_search      text    default null,
  p_unpaid      boolean default false,
  p_customer_id uuid    default null
)
returns bigint
language sql
stable                -- SECURITY INVOKER: counts only what RLS lets you see
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

-- ── Customers view of the same list ─────────────────────────────────────────
-- The "Customers" toggle groups orders by customer. Grouping client-side needs
-- every order in memory — the exact thing we just stopped downloading — so the
-- grouping moves here: customers ordered by most recent order, paginated, with
-- their counts already totted up. Expanding one calls get_sales_orders with
-- p_customer_id, so the rows are the same shape as the flat list.
create or replace function public.get_sales_order_customers(
  p_search              text        default null,
  p_status              text        default null,
  p_unpaid              boolean     default false,
  p_cursor_last_order_at timestamptz default null,
  p_cursor_customer_id  uuid        default null,
  p_limit               int         default 20
)
returns table (
  customer_id     uuid,
  name            text,
  phone           text,
  island          text,
  orders_count    bigint,
  active_count    bigint,
  delivered_count bigint,
  last_order_at   timestamptz
)
language sql
stable                -- SECURITY INVOKER: rolls up only RLS-visible orders
set search_path = public
as $$
  with matched as (
    select o.*, c.name, c.phone, c.island
    from sales_orders o
    left join customers c on c.id = o.customer_id
    where
      (p_status is null or p_status = 'all' or o.status = p_status)
      and (not p_unpaid or (
            o.status not in ('draft', 'cancelled')
            and o.payment_status in ('pending', 'partial')))
      and (
        p_search is null or btrim(p_search) = ''
        or o.order_number ilike '%' || btrim(p_search) || '%'
        or c.name         ilike '%' || btrim(p_search) || '%'
        or c.phone        ilike '%' || btrim(p_search) || '%'
      )
  ),
  rolled as (
    select
      m.customer_id,
      max(m.name)   as name,
      max(m.phone)  as phone,
      max(m.island) as island,
      count(*)                                                              as orders_count,
      count(*) filter (where m.status not in ('delivered', 'cancelled'))    as active_count,
      count(*) filter (where m.status = 'delivered')                        as delivered_count,
      max(m.created_at)                                                     as last_order_at
    from matched m
    group by m.customer_id
  )
  select
    r.customer_id, r.name, r.phone, r.island,
    r.orders_count, r.active_count, r.delivered_count, r.last_order_at
  from rolled r
  where
    p_cursor_last_order_at is null
    or (r.last_order_at, coalesce(r.customer_id, '00000000-0000-0000-0000-000000000000'::uuid))
       < (p_cursor_last_order_at, coalesce(p_cursor_customer_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by r.last_order_at desc,
           coalesce(r.customer_id, '00000000-0000-0000-0000-000000000000'::uuid) desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- ── Honest next-order-number preview ────────────────────────────────────────
-- Reads the same counter the insert trigger uses. Still only a preview (the
-- trigger is what actually assigns it, atomically, on save) but it no longer
-- depends on how many orders the client happens to have downloaded.
create or replace function public.peek_next_order_number()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'SO-' || y || '-' || lpad(
    (coalesce((select last_seq from order_number_counters where year = y), 0) + 1)::text, 3, '0')
  from (select extract(year from (now() at time zone 'Indian/Maldives'))::int as y) t;
$$;

-- ── Grants: authenticated only, never anon ──────────────────────────────────
-- REVOKE FROM public as well as anon — revoking anon alone leaves PUBLIC's
-- implicit EXECUTE in place, which is how get_pricing_health once shipped
-- readable by the world.
revoke execute on function public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int)          from public, anon;
revoke execute on function public.get_sales_orders_count(text, text, boolean, uuid)                            from public, anon;
revoke execute on function public.get_sales_order_customers(text, text, boolean, timestamptz, uuid, int)       from public, anon;
revoke execute on function public.peek_next_order_number()                                                     from public, anon;

grant execute on function public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int)           to authenticated, service_role;
grant execute on function public.get_sales_orders_count(text, text, boolean, uuid)                             to authenticated, service_role;
grant execute on function public.get_sales_order_customers(text, text, boolean, timestamptz, uuid, int)        to authenticated, service_role;
grant execute on function public.peek_next_order_number()                                                      to authenticated, service_role;

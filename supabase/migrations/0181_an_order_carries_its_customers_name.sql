-- 0181 — an order carries its customer's name.
--
-- Ali, 2026-08-15: "When a new customer is created by selecting WhatsApp it
-- shows as walk-in customer. There's no name on display. When I click and go
-- back the name appears."
--
-- WHAT WAS ACTUALLY WRONG, and it is worse than a stale screen. `get_sales_orders`
-- returned `customer_id` and no name. The Sales list then looked the name up in
-- a SEPARATE list of customers that it loads once per mount and caches for five
-- minutes, and rendered this:
--
--     {cust?.name ?? "Walk-in"}
--
-- So "Walk-in" was printed for two completely different situations: an order
-- that genuinely has no customer (customer_id IS NULL), and an order whose
-- customer the client simply had not loaded yet. A brand-new customer is
-- exactly the second case, which is why his order was attributed to nobody and
-- why coming back later fixed it — by then the cache had caught up.
--
-- An order silently attributed to the wrong person is a reporting bug, not a
-- refresh bug. Who owes money is read off this screen.
--
-- THE FIX IS TO STOP GUESSING. The function ALREADY joins customers — it has
-- done since the search filter was added, matching on c.name and c.phone — it
-- just never selected them. Returning the name and phone with the row means the
-- list never derives identity from a second, independently-aged source, and
-- "Walk-in" now means exactly one thing: customer_id IS NULL. The left join
-- guarantees it, so the two cases can no longer collide.
--
-- THE PHONE IS RETURNED FOR THE SAME REASON. The row's WhatsApp action reads
-- `cust?.phone`, so the identical staleness made the message button vanish from
-- a new customer's order — the one order most likely to need a follow-up.
--
-- Same class of bug as the unit noun and the card recipe: a value that exists
-- in one place being re-derived in another, and the copies aging apart.

-- Adding columns to the returned TABLE requires a drop; there is no view or
-- other function depending on this one (checked), only the client.
drop function if exists get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, integer);

create or replace function get_sales_orders(
  p_status            text        default null,
  p_search            text        default null,
  p_unpaid            boolean     default false,
  p_customer_id       uuid        default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             integer     default 30
)
returns table (
  id uuid, order_number text, customer_id uuid, status text, channel text,
  payment_status text, payment_method text, payment_proof_url text,
  source_godown_id uuid, delivery_address_line1 text, delivery_address_line2 text,
  delivery_island text, delivery_to_boat boolean, assigned_driver_id uuid,
  picked_at timestamptz, delivered_at timestamptz, cash_collected_mvr numeric,
  cash_deposited_at timestamptz, notes text, created_by uuid,
  created_at timestamptz, updated_at timestamptz,
  order_total_mvr numeric, items_summary text, balance_mvr numeric,
  -- NULL exactly when the order has no customer. That equivalence is the whole
  -- point of this migration and the screen depends on it.
  customer_name text, customer_phone text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    o.id, o.order_number, o.customer_id, o.status, o.channel,
    o.payment_status, o.payment_method, o.payment_proof_url,
    o.source_godown_id, o.delivery_address_line1, o.delivery_address_line2,
    o.delivery_island, o.delivery_to_boat, o.assigned_driver_id,
    o.picked_at, o.delivered_at, o.cash_collected_mvr, o.cash_deposited_at,
    o.notes, o.created_by, o.created_at, o.updated_at,
    coalesce((select sum(l.line_total_mvr)
                from public.sales_order_lines l
               where l.order_id = o.id), 0)::numeric as order_total_mvr,
    public.sales_order_item_summary(o.id) as items_summary,
    round(
      coalesce((select sum(l.line_total_mvr) from public.sales_order_lines l where l.order_id = o.id), 0)
      - coalesce((select sum(p.amount_mvr) from public.order_payments p where p.order_id = o.id), 0)
      - coalesce((select sum(r.refund_amount_mvr) from public.sales_returns r where r.order_id = o.id), 0)
    , 2) as balance_mvr,
    c.name  as customer_name,
    c.phone as customer_phone
  from public.sales_orders o
  left join public.customers c on c.id = o.customer_id
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
$fn$;

comment on function get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, integer) is
  'Orders for the Sales list, newest first, keyset-paged. Carries the customer''s '
  'name and phone so the screen never re-derives identity from a separately '
  'cached list — customer_name is NULL exactly when the order has no customer, '
  'which is the only thing that may be shown as "Walk-in".';

revoke execute on function get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, integer) from public;
revoke execute on function get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, integer) from anon;
grant  execute on function get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, integer) to authenticated;

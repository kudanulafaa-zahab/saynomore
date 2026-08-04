-- 0128 — create_and_post_sale(): one order, its lines and the stock
-- deduction in a single transaction.
--
-- WHY. SO-2026-076 reached 'delivered' with real revenue but zero stock
-- deducted and zero cost recorded. The New Sale flow
-- (components/sales/sales-list.tsx handleSubmit) did THREE sequential
-- client-side writes:
--     1. createOrder()      -> sales_orders row (status 'draft')
--     2. createOrderLine()  -> sales_order_lines rows
--     3. postSale()         -> the RPC that deducts FIFO stock, snapshots
--                             landed cost/margin, flips status to confirmed
-- Steps 1 and 2 are permanent the moment they succeed. If anything
-- interrupts before step 3 completes — a dropped 4G connection at a shop,
-- the phone locking, the PWA being swiped away — the order and its lines
-- exist forever as an unposted draft with stock never deducted. That is a
-- money-wrong half-committed state that no amount of UI polish can prevent,
-- because the atomicity has to live where the transaction lives: in
-- Postgres.
--
-- This function makes that state structurally impossible. A plpgsql
-- function runs in one transaction: either the order, every line AND the
-- stock deduction all commit, or none of them do.
--
-- IDEMPOTENCY. p_offline_key lets a client retry safely (the offline queue
-- replays writes on reconnect and must never create the same sale twice).
-- The key is stored on the order behind a unique index; a replay with a key
-- that already exists returns the original order instead of creating a
-- second one. Callers that don't need it pass null.
--
-- MONEY MATH MOVES SERVER-SIDE (hard rule 1). qty_pieces and line_total_mvr
-- were previously computed in TypeScript and inserted verbatim. They are now
-- computed here from the SKU's own pack/carton configuration and the quantity
-- and unit price. unit_price_mvr is still an input on purpose — it is a real
-- human decision (Ali's fixed prices, a manual override, mixed-carton
-- pricing), not a derived figure. Verified before writing this: the TS
-- formulas were line_total = qty * unit_price and
-- qty_pieces = round(qty * pieces-per-uom) in all three places lines are
-- built (the editor, quick-add, repeat-last-order), so these produce
-- identical numbers — the difference is that they can no longer drift or be
-- tampered with client-side.
--
-- SECURITY INVOKER on purpose: the inserts then run under the caller's own
-- RLS policies (which already require admin/manager to write an order),
-- so this function can never become a privilege-escalation path. post_sale()
-- stays SECURITY DEFINER and performs its own role check, unchanged.

alter table public.sales_orders
  add column if not exists offline_key text;

create unique index if not exists sales_orders_offline_key_uniq
  on public.sales_orders (offline_key)
  where offline_key is not null;

comment on column public.sales_orders.offline_key is
  'Client-supplied idempotency key for create_and_post_sale(). Lets an '
  'offline write be replayed on reconnect without creating a duplicate '
  'sale. Null for orders created through any other path.';

create or replace function public.create_and_post_sale(
  p_order       jsonb,
  p_lines       jsonb,
  p_offline_key text default null
)
returns table (order_id uuid, order_number text)
language plpgsql
set search_path to 'public'
as $function$
declare
  v_order_id     uuid;
  v_order_number text;
  v_existing_id  uuid;
  v_existing_no  text;
  v_line         jsonb;
  v_sku          skus%rowtype;
  v_sku_id       uuid;
  v_uom          text;
  v_qty          numeric;
  v_unit_price   numeric;
  v_qty_pieces   integer;
  v_line_total   numeric;
  v_per_uom      integer;
  v_n            int := 0;
begin
  if not is_admin_or_manager() then
    raise exception 'Only an admin or manager can create a sale';
  end if;

  -- Idempotent replay: this exact sale was already committed.
  if p_offline_key is not null and btrim(p_offline_key) <> '' then
    select id, sales_orders.order_number into v_existing_id, v_existing_no
    from sales_orders where offline_key = p_offline_key;
    if found then
      return query select v_existing_id, v_existing_no;
      return;
    end if;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale needs at least one product line';
  end if;

  insert into sales_orders (
    customer_id, status, channel, payment_status, payment_method,
    source_godown_id, delivery_address_line1, delivery_address_line2,
    delivery_island, delivery_to_boat, notes, offline_key, created_by
  ) values (
    nullif(p_order->>'customer_id', '')::uuid,
    'draft',
    coalesce(nullif(p_order->>'channel', ''), 'walkin'),
    coalesce(nullif(p_order->>'payment_status', ''), 'pending'),
    nullif(p_order->>'payment_method', ''),
    nullif(p_order->>'source_godown_id', '')::uuid,
    nullif(p_order->>'delivery_address_line1', ''),
    nullif(p_order->>'delivery_address_line2', ''),
    nullif(p_order->>'delivery_island', ''),
    coalesce((p_order->>'delivery_to_boat')::boolean, false),
    nullif(p_order->>'notes', ''),
    nullif(btrim(coalesce(p_offline_key, '')), ''),
    (select auth.uid())
  )
  returning id, sales_orders.order_number into v_order_id, v_order_number;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_n := v_n + 1;

    v_sku_id := nullif(v_line->>'sku_id', '')::uuid;
    select * into v_sku from skus where id = v_sku_id;
    if not found then
      raise exception 'Line %: that product no longer exists', v_n;
    end if;

    v_uom := v_line->>'uom';
    if v_uom is null or v_uom not in ('piece', 'pack', 'carton') then
      raise exception 'Line %: unit must be piece, pack or carton', v_n;
    end if;

    v_qty        := nullif(v_line->>'qty', '')::numeric;
    v_unit_price := nullif(v_line->>'unit_price_mvr', '')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Line %: quantity must be more than zero', v_n;
    end if;
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'Line %: a price is required', v_n;
    end if;

    v_per_uom := case v_uom
      when 'carton' then v_sku.pcs_per_pack * v_sku.packs_per_carton
      when 'pack'   then v_sku.pcs_per_pack
      else 1
    end;

    v_qty_pieces := round(v_qty * v_per_uom)::int;
    v_line_total := round(v_qty * v_unit_price, 2);

    if v_qty_pieces <= 0 then
      raise exception 'Line %: that quantity works out to zero pieces', v_n;
    end if;

    insert into sales_order_lines (
      order_id, sku_id, uom, qty, qty_pieces,
      unit_price_mvr, line_total_mvr, is_mixed_carton_fill, notes
    ) values (
      v_order_id, v_sku_id, v_uom, v_qty, v_qty_pieces,
      v_unit_price, v_line_total,
      coalesce((v_line->>'is_mixed_carton_fill')::boolean, false),
      nullif(v_line->>'notes', '')
    );
  end loop;

  -- Deducts FIFO stock, snapshots landed cost + margin onto every line and
  -- flips the order to 'confirmed'. Same RPC the app already used — the
  -- difference is that it now runs inside this transaction, so a failure
  -- here rolls the order and its lines back instead of stranding them.
  perform post_sale(v_order_id);

  return query select v_order_id, v_order_number;

exception
  when unique_violation then
    -- Two lines for the same SKU (sales_order_lines_order_sku_uniq), or a
    -- concurrent replay of the same offline_key. Both are user-fixable, so
    -- say so plainly rather than surfacing a raw constraint name.
    if position('offline_key' in sqlerrm) > 0 then
      select id, sales_orders.order_number into v_existing_id, v_existing_no
      from sales_orders where offline_key = p_offline_key;
      if found then
        return query select v_existing_id, v_existing_no;
        return;
      end if;
    end if;
    raise exception 'The same product appears twice in this sale — combine those lines into one and try again';
end
$function$;

comment on function public.create_and_post_sale(jsonb, jsonb, text) is
  'Creates a sales order, its lines, and deducts FIFO stock in ONE '
  'transaction. Replaces the three separate client writes that could leave '
  'an order committed with stock never deducted (see SO-2026-076). '
  'qty_pieces and line_total_mvr are computed here, never trusted from the '
  'client. p_offline_key makes replay idempotent.';

revoke execute on function public.create_and_post_sale(jsonb, jsonb, text) from public, anon;
grant  execute on function public.create_and_post_sale(jsonb, jsonb, text) to authenticated, service_role;

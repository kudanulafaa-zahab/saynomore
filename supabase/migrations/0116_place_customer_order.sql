-- 0116 — place_customer_order: the one public write.
--
-- This is the single most sensitive function in the storefront build: it
-- lets a stranger on the internet, with no login, insert real rows into
-- sales_orders/sales_order_lines. Every other function and table in this
-- database explicitly revokes anon; this is the one deliberate exception,
-- and everything below exists to make that exception safe.
--
-- WHAT MAKES THIS SAFE
--   1. It NEVER accepts a price from the caller. The signature has no price
--      parameter at all — every line is priced here, server-side, from
--      get_storefront_catalogue() at the instant of placing the order. There
--      is nothing for a client to spoof because there is nowhere to put a
--      spoofed value.
--   2. It NEVER touches stock or money. The order is inserted as
--      status='draft', order_source='web' — exactly the same draft state a
--      WhatsApp order sits in before a human confirms it. This function does
--      not call post_sale. Stock_movements and audit_log are untouched by a
--      successful call. The worst outcome of abuse is extra draft rows a
--      staff member deletes — never a stock or money loss.
--   3. Every line is re-validated against get_storefront_catalogue()
--      (is_active, is_orderable, uom in sellable_units) — never trusted from
--      the client, which might be reading a stale page.
--   4. A honeypot field and a per-phone throttle (3 orders / 15 minutes,
--      tracked in storefront_order_attempts) exist purely to keep junk drafts
--      off the dispatch queue — proportionate to that actual risk, not an
--      attempt to defeat a determined attacker.
--   5. Guest customers are matched or created in the real `customers` table
--      by phone number, exactly like a staff-entered customer — never a
--      second, parallel "web customer" concept. A returning phone number
--      reuses its existing customer_id (and is NOT overwritten by a new
--      order's typed name/address, so one order can't silently rewrite
--      another's stored customer details); a new phone number gets a real
--      customers row with channel='web'. This means a repeat online shopper
--      shows up correctly in the customer-insights/order-history features
--      already built this session — no parallel system.
--
-- Mirrors the existing safe order lifecycle exactly (lib/queries/sales.ts +
-- migration 0086's assign_sales_order_number trigger, which fires
-- automatically on this insert): draft order + lines only. Staff confirm
-- exactly as they do today, via the existing post_sale RPC, from Dispatch or
-- Sales — nothing about that path changes for a web order.

create table if not exists public.storefront_order_attempts (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_storefront_order_attempts_phone_time
  on public.storefront_order_attempts (phone, created_at desc);

comment on table public.storefront_order_attempts is
  'Per-phone-number throttle for place_customer_order (3 per 15 minutes). '
  'Only place_customer_order (SECURITY DEFINER) touches this table — no '
  'grants exist on it directly for any role, including authenticated.';

-- No RLS policies at all — access only through the SECURITY DEFINER
-- function, same shape as order_number_counters (migration 0086).
alter table public.storefront_order_attempts enable row level security;
revoke all on public.storefront_order_attempts from public, anon, authenticated;

create or replace function public.place_customer_order(
  p_customer_name   text,
  p_customer_phone  text,
  p_delivery_island text,
  p_delivery_address text,
  p_payment_method  text,      -- 'cod' | 'bank_transfer'
  p_lines           jsonb,     -- [{sku_id, uom, qty}, ...] — NO price accepted
  p_notes           text default null,
  p_honeypot        text default null
)
returns table (order_number text, order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name       text := btrim(coalesce(p_customer_name, ''));
  v_phone      text := btrim(coalesce(p_customer_phone, ''));
  v_island     text := btrim(coalesce(p_delivery_island, ''));
  v_address    text := btrim(coalesce(p_delivery_address, ''));
  v_recent_attempts int;
  v_line       jsonb;
  v_sku_id     uuid;
  v_uom        text;
  v_qty        numeric;
  v_cat        record;
  v_unit_price numeric;
  v_qty_pieces int;
  v_line_total numeric;
  v_customer_id uuid;
  v_godown_id  uuid;
  v_order_id   uuid;
  v_order_number text;
  v_line_count int := 0;
begin
  -- 1. Honeypot: a hidden field real shoppers never see or fill. Any value
  -- here means a bot filled every field on the form. Same generic error as
  -- every other validation failure — nothing distinguishes "bot caught" from
  -- "bad input" in the response.
  if p_honeypot is not null and btrim(p_honeypot) <> '' then
    raise exception 'Could not place order — please check your details and try again.';
  end if;

  -- 2. Throttle, checked BEFORE this attempt is logged, then logged
  -- regardless of what happens next so repeated tries all count.
  if v_phone = '' then
    raise exception 'A phone number is required.';
  end if;
  select count(*) into v_recent_attempts
  from storefront_order_attempts
  where phone = v_phone and created_at > now() - interval '15 minutes';
  if v_recent_attempts >= 3 then
    raise exception 'Too many orders placed with this number recently — please wait a few minutes and try again, or contact us directly.';
  end if;
  insert into storefront_order_attempts (phone) values (v_phone);

  -- 3. Basic shape validation.
  if v_name = '' then
    raise exception 'A name is required.';
  end if;
  if v_island = '' then
    raise exception 'A delivery island is required.';
  end if;
  if v_address = '' then
    raise exception 'A delivery address is required.';
  end if;
  if p_payment_method not in ('cod', 'bank_transfer') then
    raise exception 'Choose Cash on Delivery or Bank Transfer.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Your cart is empty.';
  end if;
  if jsonb_array_length(p_lines) > 20 then
    raise exception 'Too many different items in one order — please split into a second order.';
  end if;

  -- 4. Find or create the guest customer by phone. An existing match is
  -- reused as-is (never overwritten by this order's typed details) so a
  -- repeat shopper accumulates one real order history, exactly like a
  -- staff-entered customer.
  select id into v_customer_id from customers where phone = v_phone limit 1;
  if v_customer_id is null then
    insert into customers (name, phone, island, address, channel, price_tier)
    values (v_name, v_phone, v_island, v_address, 'web', 'retail')
    returning id into v_customer_id;
  end if;

  v_godown_id := get_web_fulfilment_godown_id();
  if v_godown_id is null then
    raise exception 'Ordering is temporarily unavailable — please try again shortly.';
  end if;

  -- 5. Insert the order first (draft, untouched stock) — lines reference it.
  insert into sales_orders (
    customer_id, status, channel, order_source, payment_status, payment_method,
    source_godown_id, delivery_address_line1, delivery_island, notes
  ) values (
    v_customer_id, 'draft', 'web', 'web', 'pending', p_payment_method,
    v_godown_id, v_address, v_island, p_notes
  )
  returning id, sales_orders.order_number into v_order_id, v_order_number;

  -- 6. Validate and price every line server-side. The whole order is
  -- rejected if any single line fails — never a partial order — because a
  -- customer silently missing an item they thought they ordered is worse
  -- than being asked to refresh and retry.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_count := v_line_count + 1;
    v_sku_id := nullif(v_line->>'sku_id', '')::uuid;
    v_uom    := v_line->>'uom';
    v_qty    := nullif(v_line->>'qty', '')::numeric;

    if v_sku_id is null or v_uom is null or v_qty is null or v_qty <= 0 or v_qty > 50 then
      raise exception 'One of the items in your cart has an invalid quantity — please refresh and try again.';
    end if;

    select * into v_cat from get_storefront_catalogue() c where c.sku_id = v_sku_id;
    if not found or not v_cat.is_orderable or not (v_uom = any(v_cat.sellable_units)) then
      raise exception 'One of the items in your cart just went out of stock — please refresh and try again.';
    end if;

    v_unit_price := case v_uom
      when 'carton' then v_cat.selling_price_per_carton_mvr
      when 'pack'   then v_cat.selling_price_per_pack_mvr
      else               v_cat.selling_price_per_piece_mvr
    end;
    if v_unit_price is null then
      raise exception 'One of the items in your cart is not available to order right now — please refresh and try again.';
    end if;

    v_qty_pieces := (v_qty * case v_uom
      when 'carton' then v_cat.pcs_per_pack * v_cat.packs_per_carton
      when 'pack'   then v_cat.pcs_per_pack
      else 1
    end)::int;
    v_line_total := round(v_qty * v_unit_price, 2);

    insert into sales_order_lines (
      order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr
    ) values (
      v_order_id, v_sku_id, v_uom, v_qty, v_qty_pieces, v_unit_price, v_line_total
    );
  end loop;

  return query select v_order_number, v_order_id;
end;
$$;

comment on function public.place_customer_order(text, text, text, text, text, jsonb, text, text) is
  'The one function anon may call to write data. Inserts a draft, order_source=web order — never touches stock, never calls post_sale. Every line is re-priced and re-validated here, server-side, from get_storefront_catalogue(); the signature deliberately has no price parameter.';

revoke execute on function public.place_customer_order(text, text, text, text, text, jsonb, text, text) from public;
grant execute on function public.place_customer_order(text, text, text, text, text, jsonb, text, text) to anon, authenticated, service_role;

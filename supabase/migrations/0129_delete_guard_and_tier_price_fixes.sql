-- 0129 — Two confirmed money/data-loss defects from the second audit pass.
--
-- ── 1. delete_sales_order could destroy customer payment records ─────────
--
-- Same bug class as admin_force_void_grn (fixed in 0124), still open here.
-- order_payments.order_id is ON DELETE CASCADE. void_sales_order was
-- hardened in migration 0077 — it SUMs order_payments and refuses if any
-- money is attached. delete_sales_order never got that fix: it only checks
-- the denormalised header fields
--     payment_status IN ('paid','deposited')   and   cash_collected_mvr > 0
-- but 'partial' and 'cod' are both legal payment_status values. A
-- part-paid order therefore passes both guards, the DELETE fires, and every
-- order_payments row cascades away with no trace — the audit row records
-- only how many stock movements were reversed, never the money destroyed.
--
-- Verified before writing: 0 orders are currently in that state, so nothing
-- has been lost yet. This closes the door.
--
-- Also adds a status guard. Deleting a DELIVERED order erased a completed
-- sale from history entirely; voiding is the correct action there (it
-- reverses stock and keeps the record). BEHAVIOUR CHANGE, deliberate:
-- delivered orders can no longer be deleted, only voided.

create or replace function public.delete_sales_order(p_order_id uuid, p_reason text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order    sales_orders%ROWTYPE;
  v_user     uuid := auth.uid();
  v_reversed integer := 0;
  v_paid     numeric;
begin
  if not coalesce(is_admin_or_manager(), false) then
    raise exception 'Only a manager or admin can delete an order';
  end if;

  select * into v_order from sales_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.payment_status in ('paid', 'deposited') then
    raise exception 'Cannot delete: payment already settled (%). Void the order and issue a credit note instead.', v_order.payment_status;
  end if;
  if coalesce(v_order.cash_collected_mvr, 0) > 0 then
    raise exception 'Cannot delete: cash already collected on delivery. Void the order and issue a credit note instead.';
  end if;

  -- The real guard: any money in the payments ledger, whatever the header
  -- status says. Deleting the order would cascade these away silently.
  select coalesce(sum(amount_mvr), 0) into v_paid
  from order_payments where order_id = p_order_id;

  if abs(v_paid) > 0.005 then
    raise exception 'Cannot delete: MVR % has been recorded against this order. Void it and refund or credit the customer instead.',
      to_char(v_paid, 'FM999,999,990.00');
  end if;

  if v_order.status = 'delivered' then
    raise exception 'Cannot delete a delivered order — that would erase a completed sale from your records. Void it instead, which returns the stock and keeps the history.';
  end if;

  delete from stock_movements
  where source_type = 'sales_order'
    and source_id   = p_order_id
    and movement_type = 'out';
  get diagnostics v_reversed = row_count;

  insert into audit_log (table_name, record_id, action, reason, changed_by)
  values ('sales_orders', p_order_id, 'delete',
          format('deleted order %s (was %s) — %s stock movement(s) reversed.%s',
                 v_order.order_number, v_order.status, v_reversed,
                 case when p_reason is null or trim(p_reason) = '' then ''
                      else ' Reason: ' || p_reason end),
          v_user);

  delete from sales_orders where id = p_order_id;
end $function$;

-- ── 2. get_tier_prices_for_skus returned no price for carton-only SKUs ──
--
-- This is THE pricing path real sales use. sku_defaults derived pack and
-- carton prices UPWARD from fixed_selling_price_mvr, but never derived
-- piece or pack DOWNWARD from a carton price. A SKU priced only per carton
-- (e.g. Sosoft Blue 700ml, fixed_price_per_carton_mvr = 220) returned NULL
-- for piece and pack — and because the row still won the waterfall at rank
-- 2, the target-margin fallback that could have filled the gap was
-- suppressed (margin_prices requires ALL three fixed prices to be null).
-- Selling that SKU by the piece or pack got no price from the engine at all.
--
-- Fixed by making the derivation work in both directions, with NULLIF
-- guards so a zero pack/carton configuration can never divide by zero.
-- Every existing upward derivation is preserved in the same precedence, so
-- no currently-working price changes.
--
-- Also: the active price list was selected with `effective_from <=
-- CURRENT_DATE`, which is UTC — a list effective "today" did not activate
-- until 05:00 Maldives time. Now uses the Maldives business day, matching
-- the timezone fixes in migrations 0123/0126.

create or replace function public.get_tier_prices_for_skus(p_sku_ids uuid[], p_tier text default 'retail'::text)
 returns table(sku_id uuid, price_per_piece_mvr numeric, price_per_pack_mvr numeric, price_per_carton_mvr numeric, source text, price_list_name text, price_list_date date)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with active_list as (
    select id, name, effective_from
    from price_lists
    where tier = p_tier
      and effective_from <= (now() at time zone 'Indian/Maldives')::date
    order by effective_from desc
    limit 1
  ),
  list_prices as (
    select
      pli.sku_id,
      round(pli.price_per_piece_mvr, 0)  as price_per_piece_mvr,
      round(pli.price_per_pack_mvr, 0)   as price_per_pack_mvr,
      round(pli.price_per_carton_mvr, 0) as price_per_carton_mvr,
      'price_list'::text  as source,
      al.name             as price_list_name,
      al.effective_from   as price_list_date
    from price_list_items pli
    join active_list al on al.id = pli.price_list_id
    where pli.sku_id = any(p_sku_ids)
  ),
  sku_defaults as (
    select
      s.id as sku_id,
      round(coalesce(
        s.fixed_selling_price_mvr,
        s.fixed_price_per_pack_mvr   / nullif(s.pcs_per_pack, 0),
        s.fixed_price_per_carton_mvr / nullif(s.pcs_per_pack * s.packs_per_carton, 0)
      ), 0) as price_per_piece_mvr,
      round(coalesce(
        s.fixed_price_per_pack_mvr,
        s.fixed_selling_price_mvr * s.pcs_per_pack,
        s.fixed_price_per_carton_mvr / nullif(s.packs_per_carton, 0)
      ), 0) as price_per_pack_mvr,
      round(coalesce(
        s.fixed_price_per_carton_mvr,
        s.fixed_price_per_pack_mvr * s.packs_per_carton,
        s.fixed_selling_price_mvr * s.pcs_per_pack * s.packs_per_carton
      ), 0) as price_per_carton_mvr,
      'sku_default'::text as source,
      null::text          as price_list_name,
      null::date          as price_list_date
    from skus s
    where s.id = any(p_sku_ids)
      and (s.fixed_selling_price_mvr is not null
           or s.fixed_price_per_pack_mvr is not null
           or s.fixed_price_per_carton_mvr is not null)
  ),
  margin_prices as (
    select
      s.id as sku_id,
      round(ll.landed_per_piece_mvr / (1 - s.target_margin_pct / 100.0), 0) as price_per_piece_mvr,
      round((ll.landed_per_piece_mvr * s.pcs_per_pack)
            / (1 - s.target_margin_pct / 100.0), 0) as price_per_pack_mvr,
      round((ll.landed_per_piece_mvr * s.pcs_per_pack * s.packs_per_carton)
            / (1 - s.target_margin_pct / 100.0), 0) as price_per_carton_mvr,
      'margin'::text as source,
      null::text     as price_list_name,
      null::date     as price_list_date
    from skus s
    join lateral (
      select bs.landed_per_piece_mvr
      from v_batch_stock bs
      where bs.sku_id = s.id
        and bs.qty_pieces_remaining > 0
      order by bs.received_at desc
      limit 1
    ) ll on true
    where s.id = any(p_sku_ids)
      and s.fixed_selling_price_mvr is null
      and s.fixed_price_per_pack_mvr is null
      and s.fixed_price_per_carton_mvr is null
      and s.target_margin_pct is not null
      and s.target_margin_pct > 0
      and s.target_margin_pct < 100
      and ll.landed_per_piece_mvr is not null
  )
  select distinct on (all_prices.sku_id)
    all_prices.sku_id,
    all_prices.price_per_piece_mvr,
    all_prices.price_per_pack_mvr,
    all_prices.price_per_carton_mvr,
    all_prices.source,
    all_prices.price_list_name,
    all_prices.price_list_date
  from (
    select * from list_prices
    union all
    select * from sku_defaults
    union all
    select * from margin_prices
  ) all_prices
  order by all_prices.sku_id,
    case all_prices.source
      when 'price_list'  then 1
      when 'sku_default' then 2
      when 'margin'      then 3
      else 4
    end;
$function$;

-- ── 3. Cheap hardening found in the same pass ───────────────────────────
-- is_admin_or_manager() returns NULL (not false) when auth.uid() is null,
-- and `IF NOT NULL THEN` is not true — so the role guard silently passed.
-- Only reachable as postgres/service_role (anon has no EXECUTE on any of
-- these), so not exploitable, but a guard that can evaluate to NULL is not
-- a guard. post_sale and create_and_post_sale get the same treatment.
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
  if not coalesce(is_admin_or_manager(), false) then
    raise exception 'Only an admin or manager can create a sale';
  end if;

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

  perform post_sale(v_order_id);

  return query select v_order_id, v_order_number;

exception
  when unique_violation then
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

revoke execute on function public.create_and_post_sale(jsonb, jsonb, text) from public, anon;
grant  execute on function public.create_and_post_sale(jsonb, jsonb, text) to authenticated, service_role;

-- v_verification_history carried a stray SELECT grant to anon that the other
-- five views don't have. Harmless today (the underlying table's RLS is
-- authenticated-only so anon reads zero rows) but it is an inconsistency in
-- a security boundary — remove it.
revoke select on public.v_verification_history from anon;

-- 0124 — Remaining fixes from the full audit Ali asked for.
--
-- 1. Returns weren't netted into "how much is still owed on this order" in
--    three places that all needed it (v_order_balances — Sale Detail's
--    Outstanding display + Record Payment default/quick-fill —,
--    record_order_payment's overpayment guard, and
--    sync_order_payment_status's paid/partial/pending classification), and
--    a fourth (get_customer_orders' "unpaid" flag on the customer's order
--    history). Only get_receivables_aging (the dashboard/Finance Owed
--    source) and record_customer_return's own credit-guard had it right.
--    Currently latent — zero credit-settlement returns exist in live data —
--    but would show a wrong, higher balance and let staff overpay the
--    moment a "credit" (less-to-pay) return is recorded on a part-paid
--    order. Fixed with the same formula get_receivables_aging already uses:
--    total - paid - returned (paid already nets any refund-type negative
--    order_payments row, so this never double-counts a refund).
--
-- 2. get_tier_price_for_sku ignored per-UOM fixed prices
--    (fixed_price_per_pack_mvr / fixed_price_per_carton_mvr), silently
--    falling back to piece-price * pack size — while its sibling
--    get_tier_prices_for_skus (the one real Sales pricing actually uses)
--    was fixed for this exact bug in migration 0068. Proven live: SKU
--    MAMY-XTRA-XL-38x4 has fixed_price_per_carton_mvr=810 but this function
--    returned 828. Only affects the Competitor Price Gaps screen, not real
--    sale totals. Fixed by delegating to the already-correct plural
--    function instead of duplicating its logic.
--
-- 3. admin_force_void_grn deleted sales_orders (and, via ON DELETE CASCADE,
--    any order_payments on them) for any order that drew stock from the
--    voided GRN, with no check for existing payments — a real hard-rule
--    violation ("immutable once posted; corrections are reversing
--    entries"). It has been called 3 times historically (2026-07-03/05/08);
--    whether any of those orders had real payments can't be reconstructed
--    from current data because the function never recorded what it
--    destroyed. Fixed to block (like admin_void_grn already blocks on
--    stock already sold) whenever any affected order has payment_status
--    IN ('paid','deposited') or any order_payments rows — forcing a
--    reversal first, same as void/delete_sales_order already require.
--
-- 4. admin_void_grn's "already sold" pre-check only looked at
--    movement_type='out', so a batch that was transferred or written off
--    (not sold) before voiding would fall through to a raw foreign-key
--    error instead of a clear message. Broadened to all non-'in' movement
--    types, matching what reopen_grn already checks correctly.
--
-- 5. v_batch_stock / v_stock_levels reimplemented stock_signed_delta's sign
--    logic inline instead of calling it — today they agree, but it's the
--    exact "two definitions of the same rule, drifting silently" pattern
--    this whole audit was about. Collapsed to call the one function.
--
-- 6. A stale RLS policy from the original schema (0001/0002, before
--    post_sale() existed) let a 'staff'-role session INSERT directly into
--    stock_movements for out/transfer_out/damage_out with zero validation
--    — no FIFO, no audit_log, no stock-level check. Nothing in the current
--    app uses this path (verified: zero direct stock_movements inserts
--    anywhere in driver-facing code), so it's dropped.
--
-- 7. get_promo_suggestions divided by vs.selling_price_per_pack_mvr with
--    only an IS NOT NULL guard, not a >0 guard (defensive only — zero live
--    SKUs are at 0 price today), and used CURRENT_DATE for its 90-day
--    velocity window instead of Maldives local time, same class of bug as
--    migration 0123.

-- ── 1a. v_order_balances ─────────────────────────────────────────────────
create or replace view public.v_order_balances as
 select so.id as order_id,
    so.order_number,
    so.customer_id,
    so.payment_status,
    so.payment_method,
    coalesce(lt.order_total, 0::numeric) as order_total_mvr,
    coalesce(pd.paid, 0::numeric) as paid_mvr,
    round(coalesce(lt.order_total, 0::numeric) - coalesce(pd.paid, 0::numeric) - coalesce(rt.returned, 0::numeric), 2) as balance_mvr,
    pd.last_paid_at,
    pd.payment_count
   from sales_orders so
     left join lateral ( select coalesce(sum(sales_order_lines.line_total_mvr), 0::numeric) as order_total
           from sales_order_lines
          where sales_order_lines.order_id = so.id) lt on true
     left join lateral ( select sum(order_payments.amount_mvr) as paid,
            max(order_payments.paid_at) as last_paid_at,
            count(*) as payment_count
           from order_payments
          where order_payments.order_id = so.id) pd on true
     left join lateral ( select coalesce(sum(sales_returns.refund_amount_mvr), 0::numeric) as returned
           from sales_returns
          where sales_returns.order_id = so.id) rt on true;

-- ── 1b. record_order_payment ─────────────────────────────────────────────
create or replace function public.record_order_payment(p_order_id uuid, p_amount_mvr numeric, p_method text default null::text, p_paid_at timestamp with time zone default null::timestamp with time zone, p_reference text default null::text, p_note text default null::text)
 returns order_payments
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row         order_payments;
  v_order       sales_orders%ROWTYPE;
  v_total       numeric;
  v_paid        numeric;
  v_returned    numeric;
  v_outstanding numeric;
begin
  if not is_admin_or_manager() then
    raise exception 'Only an admin or manager can record a payment';
  end if;
  if p_amount_mvr = 0 then
    raise exception 'Payment amount cannot be zero';
  end if;

  select * into v_order from sales_orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;

  if p_amount_mvr > 0 then
    if v_order.status = 'draft' then
      raise exception 'This order is still a draft — confirm it first, then record the payment';
    end if;
    if v_order.status = 'cancelled' then
      raise exception 'This order is cancelled — there is nothing owed on it';
    end if;

    select coalesce(sum(sol.line_total_mvr), 0) into v_total
    from sales_order_lines sol where sol.order_id = p_order_id;
    select coalesce(sum(op.amount_mvr), 0) into v_paid
    from order_payments op where op.order_id = p_order_id;
    select coalesce(sum(sr.refund_amount_mvr), 0) into v_returned
    from sales_returns sr where sr.order_id = p_order_id;
    v_outstanding := v_total - v_paid - v_returned;

    if p_amount_mvr > v_outstanding + 0.005 then
      raise exception 'Only MVR % is outstanding on this order — MVR % would overpay it by MVR %. Check the amount.',
        to_char(v_outstanding, 'FM999,999,990.00'),
        to_char(p_amount_mvr,  'FM999,999,990.00'),
        to_char(p_amount_mvr - v_outstanding, 'FM999,999,990.00');
    end if;
  end if;

  insert into order_payments (order_id, amount_mvr, method, paid_at, reference, note, is_reversal, created_by)
  values (p_order_id, p_amount_mvr, coalesce(p_method,'transfer'), coalesce(p_paid_at, now()),
          p_reference, p_note, p_amount_mvr < 0, auth.uid())
  returning * into v_row;

  return v_row;
end;
$function$;

-- ── 1c. sync_order_payment_status — split into a plain, callable core ───
create or replace function public.recalculate_order_payment_status(p_order_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_cur      text;
  v_paid     numeric;
  v_returned numeric;
  v_total    numeric;
begin
  select payment_status into v_cur from sales_orders where id = p_order_id;

  if v_cur in ('cod','deposited') then
    return;
  end if;

  select coalesce(sum(amount_mvr), 0) into v_paid
  from order_payments where order_id = p_order_id;

  select coalesce(sum(refund_amount_mvr), 0) into v_returned
  from sales_returns where order_id = p_order_id;

  select coalesce(sum(line_total_mvr), 0) into v_total
  from sales_order_lines where order_id = p_order_id;

  update sales_orders set payment_status =
    case
      when (v_paid + v_returned) <= 0.005            then 'pending'
      when (v_paid + v_returned) >= v_total - 0.005  then 'paid'
      else                                                 'partial'
    end,
    updated_at = now()
  where id = p_order_id;
end $function$;

create or replace function public.sync_order_payment_status()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  perform recalculate_order_payment_status(coalesce(new.order_id, old.order_id));
  return null;
end $function$;

-- ── 1d. record_customer_return — recalculate status after a credit return ─
-- (a 'refund' settlement already inserts into order_payments above, which
-- fires trg_sync_order_payment_status on its own; a 'credit' settlement
-- touches nothing that trigger listens to, so it never recalculated at
-- all until now — this call covers both, harmlessly redundant for refund).
create or replace function public.record_customer_return(p_order_id uuid, p_sku_id uuid, p_qty_pieces integer, p_reason text, p_settlement text, p_restock boolean default true, p_notes text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_line        record;
  v_sold        integer;
  v_returned    integer;
  v_price_pc    numeric;
  v_refund      numeric;
  v_cost_pc     numeric;
  v_batch       uuid;
  v_godown      uuid;
  v_outstanding numeric;
  v_id          uuid;
begin
  if not is_admin_or_manager() then
    raise exception 'Not authorised to record returns';
  end if;
  if p_qty_pieces is null or p_qty_pieces <= 0 then
    raise exception 'Return quantity must be more than zero';
  end if;
  if p_reason not in ('unwanted','wrong_item','defective','other') then
    raise exception 'Invalid return reason';
  end if;
  if p_settlement not in ('refund','credit') then
    raise exception 'Invalid settlement type';
  end if;

  select sol.qty_pieces, sol.line_total_mvr, sol.landed_cost_per_piece_mvr
    into v_line
  from sales_order_lines sol
  join sales_orders so on so.id = sol.order_id
  where sol.order_id = p_order_id and sol.sku_id = p_sku_id
    and so.status not in ('draft','cancelled')
  limit 1;

  if v_line is null then
    raise exception 'That product is not on this order (or the order is not confirmed)';
  end if;

  v_sold := v_line.qty_pieces;
  select coalesce(sum(qty_pieces), 0) into v_returned
  from sales_returns where order_id = p_order_id and sku_id = p_sku_id;

  if p_qty_pieces > (v_sold - v_returned) then
    raise exception 'Only % pieces can still be returned on this order (% sold, % already returned)',
      (v_sold - v_returned), v_sold, v_returned;
  end if;

  v_price_pc := v_line.line_total_mvr / nullif(v_sold, 0);
  v_refund   := round(p_qty_pieces * v_price_pc, 2);
  v_cost_pc  := v_line.landed_cost_per_piece_mvr;

  select sm.batch_id, sm.godown_id into v_batch, v_godown
  from stock_movements sm
  where sm.source_id = p_order_id and sm.sku_id = p_sku_id and sm.movement_type = 'out'
  order by sm.created_at desc limit 1;

  if v_cost_pc is null and v_batch is not null then
    select landed_per_piece_mvr into v_cost_pc from inventory_batches where id = v_batch;
  end if;

  if p_settlement = 'credit' then
    select coalesce(sum(sol.line_total_mvr), 0)
           - coalesce((select sum(op.amount_mvr) from order_payments op where op.order_id = p_order_id), 0)
           - coalesce((select sum(sr.refund_amount_mvr) from sales_returns sr where sr.order_id = p_order_id), 0)
      into v_outstanding
    from sales_order_lines sol where sol.order_id = p_order_id;

    if v_outstanding < v_refund - 0.005 then
      raise exception 'This order only has MVR % still owed — record this as a money-back refund instead',
        round(greatest(v_outstanding, 0), 2);
    end if;
  end if;

  if p_restock and v_batch is not null then
    insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces,
                                 source_type, source_id, notes, created_by)
    values (v_batch, p_sku_id, v_godown, 'return_in', p_qty_pieces, 'return', p_order_id,
            'Customer return: ' || p_reason, (select auth.uid()));
  end if;

  insert into sales_returns (order_id, sku_id, godown_id, qty_pieces, refund_amount_mvr,
                             landed_cost_per_piece_mvr, restocked, reason, settlement, notes, created_by)
  values (p_order_id, p_sku_id, v_godown, p_qty_pieces, v_refund, v_cost_pc,
          coalesce(p_restock, true) and v_batch is not null, p_reason, p_settlement,
          nullif(btrim(p_notes), ''), (select auth.uid()))
  returning id into v_id;

  if p_settlement = 'refund' then
    insert into order_payments (order_id, amount_mvr, method, paid_at, note, is_reversal, created_by)
    values (p_order_id, -v_refund, 'other', now(),
            'Refund for returned goods (' || p_reason || ')', true, (select auth.uid()));
  end if;

  perform recalculate_order_payment_status(p_order_id);

  insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  values ('sales_returns', v_id, 'insert', 'refund_amount_mvr', '0', v_refund::text,
          'Return: ' || p_qty_pieces || ' pcs (' || p_reason || ', ' || p_settlement || ')'
            || case when p_restock then ' — restocked' else ' — NOT restocked' end,
          (select auth.uid()));

  return jsonb_build_object(
    'id', v_id,
    'refund_mvr', v_refund,
    'cost_recovered_mvr', case when p_restock and v_batch is not null
                               then round(p_qty_pieces * coalesce(v_cost_pc, 0), 2) else 0 end,
    'restocked', (p_restock and v_batch is not null),
    'settlement', p_settlement
  );
end;
$function$;

-- ── 1e. get_customer_orders — add a returns-aware balance_mvr ───────────
drop function if exists public.get_customer_orders(uuid, integer);
create function public.get_customer_orders(p_customer_id uuid, p_limit integer default 100)
 returns table(order_id uuid, order_number text, created_at timestamp with time zone, status text, payment_status text, channel text, total_mvr numeric, paid_mvr numeric, balance_mvr numeric, items integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select so.id, so.order_number, so.created_at, so.status, so.payment_status, so.channel,
         round(coalesce(sum(sol.line_total_mvr), 0), 2) as total_mvr,
         round(coalesce((select sum(op.amount_mvr) from order_payments op where op.order_id = so.id), 0), 2) as paid_mvr,
         round(
           coalesce(sum(sol.line_total_mvr), 0)
           - coalesce((select sum(op.amount_mvr) from order_payments op where op.order_id = so.id), 0)
           - coalesce((select sum(sr.refund_amount_mvr) from sales_returns sr where sr.order_id = so.id), 0)
         , 2) as balance_mvr,
         count(sol.id)::int as items
  from sales_orders so
  left join sales_order_lines sol on sol.order_id = so.id
  where so.customer_id = p_customer_id
    and so.status <> 'draft'
  group by so.id
  order by so.created_at desc
  limit greatest(1, p_limit);
$function$;

revoke execute on function public.get_customer_orders(uuid, integer) from public, anon;
grant execute on function public.get_customer_orders(uuid, integer) to authenticated, service_role;

-- ── 2. get_tier_price_for_sku — delegate to the already-correct plural fn ─
create or replace function public.get_tier_price_for_sku(p_sku_id uuid, p_tier text default 'retail'::text)
 returns table(price_per_piece_mvr numeric, price_per_pack_mvr numeric, price_per_carton_mvr numeric, source text, price_list_name text, price_list_date date)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select price_per_piece_mvr, price_per_pack_mvr, price_per_carton_mvr, source, price_list_name, price_list_date
  from get_tier_prices_for_skus(array[p_sku_id], p_tier)
  where sku_id = p_sku_id
  limit 1;
$function$;

-- ── 3. admin_force_void_grn — never destroy a paid order silently ───────
create or replace function public.admin_force_void_grn(p_shipment_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user        uuid := auth.uid();
  v_status      text;
  v_line_ids    uuid[];
  v_batch_ids   uuid[];
  v_order_ids   uuid[];
  v_paid_orders integer;
begin
  if not is_admin_or_manager() then
    raise exception 'Only admin or manager can force-void a GRN';
  end if;

  select status into v_status from shipments where id = p_shipment_id;
  if v_status is null then
    raise exception 'Shipment not found';
  end if;

  select array_agg(id) into v_line_ids
  from shipment_lines
  where shipment_id = p_shipment_id;

  if v_line_ids is not null then
    select array_agg(id) into v_batch_ids
    from inventory_batches
    where shipment_line_id = any(v_line_ids);

    if v_batch_ids is not null then
      select array_agg(distinct source_id) into v_order_ids
      from stock_movements
      where batch_id   = any(v_batch_ids)
        and movement_type = 'out'
        and source_type   = 'sales_order'
        and source_id is not null;

      if v_order_ids is not null then
        select count(*) into v_paid_orders
        from sales_orders so
        where so.id = any(v_order_ids)
          and (so.payment_status in ('paid','deposited')
               or exists (select 1 from order_payments op where op.order_id = so.id));

        if v_paid_orders > 0 then
          raise exception 'Cannot force-void: % of the orders that used this shipment''s stock already have payment recorded. Void/refund those orders first, then force-void the GRN.', v_paid_orders;
        end if;

        delete from sales_order_lines where order_id = any(v_order_ids);
        delete from sales_orders       where id       = any(v_order_ids);
      end if;

      delete from stock_movements where batch_id = any(v_batch_ids);
      delete from inventory_batches where id = any(v_batch_ids);
    end if;
  end if;

  delete from shipment_lines where shipment_id = p_shipment_id;
  delete from shipments      where id          = p_shipment_id;

  insert into audit_log (table_name, record_id, action, reason, changed_by)
  values ('shipments', p_shipment_id, 'delete', 'GRN force-voided (admin/manager) — all linked data deleted', v_user);
end $function$;

-- ── 4. admin_void_grn — broaden the pre-check to any non-'in' movement ──
create or replace function public.admin_void_grn(p_shipment_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user       uuid := auth.uid();
  v_status     text;
  v_batch_ids  uuid[];
  v_moved      bigint;
begin
  if not is_admin_or_manager() then
    raise exception 'Only admin or manager can void a confirmed GRN';
  end if;

  select status into v_status from shipments where id = p_shipment_id;
  if v_status is null then
    raise exception 'Shipment not found';
  end if;
  if v_status <> 'grn_confirmed' then
    raise exception 'Only locked (GRN-confirmed) shipments can be voided this way.';
  end if;

  select array_agg(ib.id) into v_batch_ids
  from inventory_batches ib
  join shipment_lines sl on sl.id = ib.shipment_line_id
  where sl.shipment_id = p_shipment_id;

  if v_batch_ids is not null then
    select count(*) into v_moved
    from stock_movements
    where batch_id = any(v_batch_ids)
      and movement_type <> 'in';

    if v_moved > 0 then
      raise exception 'Cannot void: % stock movement(s) already moved this shipment''s stock (sold, transferred or written off). Reverse those first.', v_moved;
    end if;

    delete from stock_movements
    where batch_id = any(v_batch_ids)
      and movement_type = 'in';

    delete from inventory_batches where id = any(v_batch_ids);
  end if;

  delete from shipment_lines where shipment_id = p_shipment_id;
  delete from shipments      where id = p_shipment_id;

  insert into audit_log (table_name, record_id, action, reason, changed_by)
  values ('shipments', p_shipment_id, 'delete', 'GRN voided (admin/manager) — stock reversed', v_user);
end $function$;

-- ── 5. v_batch_stock / v_stock_levels — call stock_signed_delta, don't
--       duplicate its sign logic ────────────────────────────────────────
create or replace view public.v_batch_stock as
 select b.id as batch_id,
    b.sku_id,
    sm.godown_id,
    b.received_at,
    b.landed_per_piece_mvr,
    coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0::bigint)::integer as qty_pieces_remaining
   from inventory_batches b
     join stock_movements sm on sm.batch_id = b.id
  group by b.id, sm.godown_id;

create or replace view public.v_stock_levels as
 select sku_id,
    godown_id,
    coalesce(sum(stock_signed_delta(movement_type, qty_pieces)), 0::bigint)::integer as qty_pieces
   from stock_movements sm
  group by sku_id, godown_id;

-- ── 6. Drop the stale pre-post_sale() staff insert policy ───────────────
drop policy if exists sm_staff_out on public.stock_movements;

-- ── 7. get_promo_suggestions — defensive NULLIF + Maldives velocity window
create or replace function public.get_promo_suggestions()
 returns table(sku_id uuid, internal_code text, full_path text, stock_pieces integer, stock_value_mvr numeric, days_of_stock integer, expiry_days_left integer, current_pack_mvr numeric, promo_pack_mvr numeric, discount_pct numeric, pcs_per_pack integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with stock as (
    select bs.sku_id,
           sum(bs.qty_pieces_remaining)::integer as pieces,
           round(sum(bs.qty_pieces_remaining * coalesce(bs.landed_per_piece_mvr, 0)), 2) as value_mvr
    from v_batch_stock bs
    where bs.qty_pieces_remaining > 0
    group by bs.sku_id
  ),
  latest_landed as (
    select distinct on (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
    from v_batch_stock bs
    where bs.qty_pieces_remaining > 0
    order by bs.sku_id, bs.received_at desc
  ),
  velocity as (
    select sol.sku_id, sum(sol.qty_pieces)::numeric / 90.0 as per_day
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    where so.status not in ('draft', 'cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date >= (now() at time zone 'Indian/Maldives')::date - 90
    group by sol.sku_id
  ),
  expiring as (
    select es.sku_id, min(es.days_left)::integer as days_left
    from v_expiring_stock es
    group by es.sku_id
  )
  select
    s.id,
    s.internal_code,
    concat_ws(' › ', b.name, m.name, v.display_name),
    st.pieces,
    st.value_mvr,
    case when coalesce(vel.per_day, 0) > 0
         then round(st.pieces / vel.per_day)::integer end,
    ex.days_left,
    vs.selling_price_per_pack_mvr,
    round(ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90, 0),
    round((1 - (ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90)
              / nullif(vs.selling_price_per_pack_mvr, 0)) * 100, 0),
    s.pcs_per_pack
  from skus s
  join stock st            on st.sku_id = s.id
  join latest_landed ll    on ll.sku_id = s.id
  join v_skus vs           on vs.id = s.id
  left join velocity vel   on vel.sku_id = s.id
  left join expiring ex    on ex.sku_id = s.id
  join variants v          on v.id = s.variant_id
  join product_models m    on m.id = v.model_id
  join brands b            on b.id = m.brand_id
  where s.is_active
    and vs.selling_price_per_pack_mvr is not null and vs.selling_price_per_pack_mvr > 0
    and (coalesce(vel.per_day, 0) = 0
         or st.pieces / vel.per_day > 180
         or ex.days_left is not null and ex.days_left <= 180)
    and round(ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90, 0)
        < vs.selling_price_per_pack_mvr
  order by
    case when ex.days_left is not null and ex.days_left <= 180 then 0 else 1 end,
    case when coalesce(vel.per_day, 0) = 0 then 0 else 1 end,
    st.value_mvr desc;
$function$;

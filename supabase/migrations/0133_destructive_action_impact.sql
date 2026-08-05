-- 0133 — Tell the user what a destructive button will actually destroy.
--
-- Every "Delete?" sheet in the app names the record and nothing else:
-- "SH-2026-011 — all inventory batches, stock movements, and linked sales
-- orders will be permanently deleted." True, but useless. Is that 40 pieces
-- and no sales, or 1,248 pieces and MVR 18,420 of orders? The person holding
-- the phone cannot tell, so the warning carries no weight.
--
-- These two functions return the real figures so the sheet can show them.
-- They live in Postgres, not the browser, for the usual reason (rule 1: money
-- math is not done in TypeScript) and for a second one: they must agree with
-- the delete functions exactly. Every `blocked_reason` below mirrors a RAISE
-- in admin_force_void_grn / delete_sales_order, so the sheet can refuse up
-- front instead of letting someone commit to a hold and then eat an error
-- toast. If those guards ever change, these strings are the paired copy that
-- has to change with them.
--
-- SECURITY DEFINER + is_admin_or_manager(): the preview is exactly as
-- privileged as the action it previews. A driver can't see it because a
-- driver can't perform it.

-- ── What a shipment force-void destroys ────────────────────────────────────
create or replace function public.get_shipment_void_impact(p_shipment_id uuid)
returns table (
  reference          text,
  status             text,
  line_count         integer,
  batch_count        integer,
  pieces_received    integer,
  pieces_on_hand     integer,
  orders_affected    integer,
  orders_value_mvr   numeric,
  paid_orders        integer,
  blocked_reason     text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_ref        text;
  v_status     text;
  v_line_ids   uuid[];
  v_batch_ids  uuid[];
  v_order_ids  uuid[];
begin
  if not coalesce(is_admin_or_manager(), false) then
    raise exception 'Only admin or manager can preview a shipment void';
  end if;

  select s.reference, s.status into v_ref, v_status
  from shipments s where s.id = p_shipment_id;
  if v_ref is null then
    raise exception 'Shipment not found';
  end if;

  select array_agg(sl.id) into v_line_ids
  from shipment_lines sl where sl.shipment_id = p_shipment_id;

  if v_line_ids is not null then
    select array_agg(ib.id) into v_batch_ids
    from inventory_batches ib where ib.shipment_line_id = any(v_line_ids);
  end if;

  -- Orders that consumed stock from those batches. These are the rows
  -- admin_force_void_grn deletes outright.
  if v_batch_ids is not null then
    select array_agg(distinct sm.source_id) into v_order_ids
    from stock_movements sm
    where sm.batch_id       = any(v_batch_ids)
      and sm.movement_type  = 'out'
      and sm.source_type    = 'sales_order'
      and sm.source_id is not null;
  end if;

  return query
  select
    v_ref,
    v_status,
    coalesce(array_length(v_line_ids, 1), 0),
    coalesce(array_length(v_batch_ids, 1), 0),
    coalesce((select sum(ib.qty_pieces_received)::integer
                from inventory_batches ib
               where v_batch_ids is not null and ib.id = any(v_batch_ids)), 0),
    -- What is still physically in the godown from this shipment. Signed sum
    -- over the movement ledger, same as every other stock figure in the app.
    coalesce((select sum(stock_signed_delta(sm.movement_type, sm.qty_pieces))::integer
                from stock_movements sm
               where v_batch_ids is not null and sm.batch_id = any(v_batch_ids)), 0),
    coalesce(array_length(v_order_ids, 1), 0),
    -- Rounded here, not in the browser: older line rows predate the rounding
    -- trigger (0131) and carry sub-cent dust, which would surface as
    -- "MVR 35,929.0004" on a confirmation screen.
    round(coalesce((select sum(sol.line_total_mvr)
                      from sales_order_lines sol
                     where v_order_ids is not null and sol.order_id = any(v_order_ids)), 0), 2)::numeric,
    coalesce((select count(*)::integer
                from sales_orders so
               where v_order_ids is not null
                 and so.id = any(v_order_ids)
                 and (so.payment_status in ('paid', 'deposited')
                      or exists (select 1 from order_payments op where op.order_id = so.id))), 0),
    -- Mirrors the RAISE in admin_force_void_grn.
    (select case
       when count(*) = 0 then null
       else 'Money has already been taken on ' || count(*) ||
            ' of the orders that used this stock. Void or refund those orders first.'
     end
     from sales_orders so
     where v_order_ids is not null
       and so.id = any(v_order_ids)
       and (so.payment_status in ('paid', 'deposited')
            or exists (select 1 from order_payments op where op.order_id = so.id)));
end $function$;

comment on function public.get_shipment_void_impact(uuid) is
  'Figures shown in the shipment-delete confirmation: stock, orders and MVR '
  'destroyed, plus the reason the delete would be refused. Mirrors the guards '
  'in admin_force_void_grn — change both together.';

revoke execute on function public.get_shipment_void_impact(uuid) from public, anon;
grant  execute on function public.get_shipment_void_impact(uuid) to authenticated, service_role;


-- ── What deleting a sales order destroys ───────────────────────────────────
create or replace function public.get_sales_order_delete_impact(p_order_id uuid)
returns table (
  order_number    text,
  customer_name   text,
  status          text,
  total_mvr       numeric,
  paid_mvr        numeric,
  balance_mvr     numeric,
  line_count      integer,
  pieces_restored integer,
  blocked_reason  text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_order sales_orders%ROWTYPE;
  v_paid  numeric;
begin
  if not coalesce(is_admin_or_manager(), false) then
    raise exception 'Only a manager or admin can preview an order delete';
  end if;

  select * into v_order from sales_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  select coalesce(sum(op.amount_mvr), 0) into v_paid
  from order_payments op where op.order_id = p_order_id;

  return query
  select
    v_order.order_number,
    (select c.name from customers c where c.id = v_order.customer_id),
    v_order.status,
    round(coalesce((select sum(sol.line_total_mvr) from sales_order_lines sol
                     where sol.order_id = p_order_id), 0), 2)::numeric,
    round(v_paid, 2),
    round(
      coalesce((select sum(sol.line_total_mvr) from sales_order_lines sol
                 where sol.order_id = p_order_id), 0)
      - v_paid
      - coalesce((select sum(sr.refund_amount_mvr) from sales_returns sr
                   where sr.order_id = p_order_id), 0)
    , 2),
    coalesce((select count(*)::integer from sales_order_lines sol
               where sol.order_id = p_order_id), 0),
    -- Stock that flows back when the 'out' movements are deleted.
    coalesce((select sum(sm.qty_pieces)::integer
                from stock_movements sm
               where sm.source_type   = 'sales_order'
                 and sm.source_id     = p_order_id
                 and sm.movement_type = 'out'), 0),
    -- Mirrors, in order, every RAISE in delete_sales_order.
    case
      when v_order.payment_status in ('paid', 'deposited') then
        'This order is already settled. Void it and issue a credit note instead of deleting it.'
      when coalesce(v_order.cash_collected_mvr, 0) > 0 then
        'Cash was already collected on delivery. Void it and issue a credit note instead.'
      when abs(v_paid) > 0.005 then
        'MVR ' || to_char(v_paid, 'FM999,999,990.00') ||
        ' has been recorded against this order. Remove the payment first, or void the order instead.'
      when v_order.status = 'delivered' then
        'This order was delivered — deleting it would erase a completed sale. Void it instead: the stock comes back and the history stays.'
      else null
    end;
end $function$;

comment on function public.get_sales_order_delete_impact(uuid) is
  'Figures shown in the order-delete confirmation, plus the reason the delete '
  'would be refused. Mirrors the guards in delete_sales_order — change both '
  'together.';

revoke execute on function public.get_sales_order_delete_impact(uuid) from public, anon;
grant  execute on function public.get_sales_order_delete_impact(uuid) to authenticated, service_role;

-- 0136 — Cash collected on delivery becomes a payments-ledger row.
--
-- Ali's screenshot: SO-2026-072 (Abu bilal) shows a red "OWES 776" pill in the
-- Sales list, but opening it says the cash was collected AND deposited to the
-- bank. Both statements came from the same database, and both were "right"
-- according to the field each one read.
--
-- Root cause: there were TWO places money could be recorded as received.
--   1. order_payments — the ledger. Used by get_receivables_aging, and by the
--      balance_mvr I added in migration 0132.
--   2. sales_orders.cash_collected_mvr + payment_status='deposited' — written
--      directly by the COD delivery flow, with NO ledger row.
-- SO-2026-072 is the only order in the whole database settled by route 2
-- (verified: it has cash_collected_mvr = 776 and zero order_payments rows;
-- every other settled order has a ledger row). balance_mvr never saw that 776,
-- so it reported the full amount outstanding.
--
-- This is the same class of defect migration 0121 fixed once already for the
-- unpaid COUNT, and which balance_mvr then reintroduced for the AMOUNT. The
-- durable fix is not another special case in the balance formula — it is to
-- stop having a second place where money can be recorded.
--
-- After this migration: order_payments is the single ledger. cash_collected_mvr
-- stays as a denormalised convenience for the driver/COD screens, but it is
-- written only alongside a ledger row, by the function below. Do not go back to
-- updating it with a bare table UPDATE.

-- ── One way in for COD cash ────────────────────────────────────────────────
create or replace function public.record_cod_collection(
  p_order_id       uuid,
  p_amount_mvr     numeric,
  p_mark_deposited boolean default false,
  p_mark_delivered boolean default false,
  p_note           text    default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order    sales_orders%ROWTYPE;
  v_user     uuid := (select auth.uid());
  v_existing numeric;
begin
  select * into v_order from sales_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;
  if p_amount_mvr is null or p_amount_mvr < 0 then
    raise exception 'Cash collected cannot be negative';
  end if;

  -- What the ledger already holds for this order, so re-recording a collection
  -- (a driver correcting a typo, a re-submitted offline write) tops up the
  -- difference instead of adding a second full payment.
  select coalesce(sum(op.amount_mvr), 0) into v_existing
  from order_payments op where op.order_id = p_order_id;

  if p_amount_mvr - v_existing > 0.005 then
    insert into order_payments (order_id, amount_mvr, method, reference, note, created_by)
    values (p_order_id,
            round(p_amount_mvr - v_existing, 2),
            'cash',
            'Cash collected on delivery',
            p_note,
            v_user);
  elsif v_existing - p_amount_mvr > 0.005 then
    -- Collected less than the ledger says: post a reversing entry rather than
    -- editing history. Corrections are entries, never edits.
    insert into order_payments (order_id, amount_mvr, method, reference, note, is_reversal, created_by)
    values (p_order_id,
            round(p_amount_mvr - v_existing, 2),
            'cash',
            'COD collection corrected',
            p_note,
            true,
            v_user);
  end if;

  -- Delivery and the cash that came with it settle together or not at all.
  -- Split across two calls, an offline driver could sync the delivery and lose
  -- the cash, or bank cash against an order that never showed as delivered.
  update sales_orders
     set cash_collected_mvr = p_amount_mvr,
         cash_deposited_at  = case when p_mark_deposited
                                   then coalesce(cash_deposited_at, now())
                                   else cash_deposited_at end,
         status             = case when p_mark_delivered then 'delivered' else status end,
         delivered_at       = case when p_mark_delivered
                                   then coalesce(delivered_at, now())
                                   else delivered_at end
   where id = p_order_id;

  -- payment_status is derived, never asserted by the caller.
  perform recalculate_order_payment_status(p_order_id);

  insert into audit_log (table_name, record_id, action, reason, changed_by)
  values ('sales_orders', p_order_id, 'update',
          format('COD cash recorded: MVR %s%s%s',
                 to_char(p_amount_mvr, 'FM999,999,990.00'),
                 case when p_mark_delivered then ' (delivered)' else '' end,
                 case when p_mark_deposited then ' (deposited)' else '' end),
          v_user);
end $function$;

comment on function public.record_cod_collection(uuid, numeric, boolean, boolean, text) is
  'The only supported way to record cash collected on delivery. Writes an '
  'order_payments row AND the denormalised cash_collected_mvr together, so the '
  'ledger can never disagree with the order. Never set cash_collected_mvr with '
  'a bare UPDATE.';

revoke execute on function public.record_cod_collection(uuid, numeric, boolean, boolean, text) from public, anon;
grant  execute on function public.record_cod_collection(uuid, numeric, boolean, boolean, text) to authenticated, service_role;


-- ── Backfill the one order that predates the rule ──────────────────────────
-- SO-2026-072: Ali confirmed on 2026-08-04 that MVR 776 was genuinely
-- collected and banked. Migration 0127 recorded it on the order; this gives it
-- the matching ledger row so every screen agrees.
do $$
declare
  v_id     uuid;
  v_amount numeric;
begin
  select o.id, o.cash_collected_mvr into v_id, v_amount
  from sales_orders o
  where o.order_number = 'SO-2026-072'
    and coalesce(o.cash_collected_mvr, 0) > 0
    and not exists (select 1 from order_payments p where p.order_id = o.id);

  if v_id is not null then
    insert into order_payments (order_id, amount_mvr, method, reference, note)
    values (v_id, v_amount, 'cash', 'Cash collected on delivery',
            'Backfilled by migration 0136 — cash was recorded on the order but '
            'never reached the payments ledger, so the Sales list showed it as '
            'still owed. Confirmed collected and banked by Ali 2026-08-04.');

    perform recalculate_order_payment_status(v_id);

    insert into audit_log (table_name, record_id, action, reason)
    values ('order_payments', v_id, 'insert',
            'Backfill: COD cash of MVR ' || to_char(v_amount, 'FM999,999,990.00') ||
            ' moved into the payments ledger (migration 0136)');
  end if;
end $$;

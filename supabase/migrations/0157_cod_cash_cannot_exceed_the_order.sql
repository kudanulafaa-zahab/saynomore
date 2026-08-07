-- 0157 — COD cash cannot quietly exceed what the order is worth.
--
-- Third pass of the audit that produced 0154 and 0156. The method: list every
-- function that mutates stock or money, and check which have NEITHER a test
-- NOR any production use. That shortlist had two entries.
-- edit_sales_order_line was the first (0156, three bugs).
-- record_cod_collection is the second.
--
-- Two problems, both reproduced on a clean database.
--
-- 1. A DRIVER COULD RECORD COLLECTING ANY AMOUNT AT ALL.
--
--    Nothing compared the cash against the invoice. Recording MVR 10,000
--    collected on a MVR 3,500 order was accepted silently:
--
--      collected 10,000   balance -6,500   payment_status 'cod'   no warning
--
--    That is MVR 6,500 of a customer's money recorded as taken, and it
--    surfaces nowhere: get_receivables_aging filters to outstanding > 0, so a
--    negative balance is invisible, and 'cod' is not a status any screen
--    treats as a problem. A driver typing 10000 for 1000 is an ordinary
--    mis-key, and the app's job is to catch it at the door.
--
--    CLAUDE.md rule 7 says losing money is a decision, never an accident.
--    Taking more money than the invoice is the same shape: it may be a typo,
--    or it may be real, but either way it is a decision and not something to
--    record silently. The database cannot show a confirm dialog, so the
--    honest equivalent is to refuse and name both figures.
--
--    Deliberately NOT refused: collecting LESS. Part payment on delivery is
--    ordinary trade, the balance is already visible, and blocking it would
--    stop a driver recording what actually happened.
--
-- 2. "DEPOSITED" HAD TWO SOURCES OF TRUTH THAT DISAGREED.
--
--    p_mark_deposited set cash_deposited_at but left payment_status alone,
--    while sale-detail.tsx and financials-view.tsx both decide whether cash
--    is banked by reading `payment_status === 'deposited'`. Marking a
--    collection deposited through this function therefore banked the cash in
--    one place and not the other, and the money would have read as never
--    deposited for ever.
--
--    Latent rather than live: no caller passes markDeposited: true today (the
--    UI banks cash with a direct table update that sets both fields). Fixed
--    anyway, because the parameter exists and the next person to use it would
--    have no reason to expect it to half-work.
--
-- What already worked, and is now covered by tests so it keeps working: the
-- normal collect-and-deliver path, and the correction path, where recording a
-- smaller amount afterwards writes a reversing entry so the payments net to
-- the corrected figure rather than stacking.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_cod_collection(
  p_order_id uuid,
  p_amount_mvr numeric,
  p_mark_deposited boolean DEFAULT false,
  p_mark_delivered boolean DEFAULT false,
  p_note text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_order    sales_orders%ROWTYPE;
  v_user     uuid := (select auth.uid());
  v_existing numeric;
  v_total    numeric;
begin
  select * into v_order from sales_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;
  if p_amount_mvr is null or p_amount_mvr < 0 then
    raise exception 'Cash collected cannot be negative';
  end if;

  -- The invoice this cash is against. Collecting less is ordinary (part
  -- payment on delivery); collecting MORE is either a mis-key or something
  -- that needs a decision, and there is nowhere for the excess to show up.
  select coalesce(sum(line_total_mvr), 0) into v_total
  from sales_order_lines where order_id = p_order_id;

  if p_amount_mvr - v_total > 0.005 then
    raise exception 'This order is MVR %, but MVR % was entered as collected. Check the amount — the extra MVR % has nowhere to go.',
      to_char(v_total, 'FM999,999,990.00'),
      to_char(p_amount_mvr, 'FM999,999,990.00'),
      to_char(p_amount_mvr - v_total, 'FM999,999,990.00');
  end if;

  select coalesce(sum(op.amount_mvr), 0) into v_existing
  from order_payments op where op.order_id = p_order_id;

  if p_amount_mvr - v_existing > 0.005 then
    insert into order_payments (order_id, amount_mvr, method, reference, note, created_by)
    values (p_order_id, round(p_amount_mvr - v_existing, 2), 'cash',
            'Cash collected on delivery', p_note, v_user);
  elsif v_existing - p_amount_mvr > 0.005 then
    insert into order_payments (order_id, amount_mvr, method, reference, note, is_reversal, created_by)
    values (p_order_id, round(p_amount_mvr - v_existing, 2), 'cash',
            'COD collection corrected', p_note, true, v_user);
  end if;

  -- Delivery and the cash that came with it settle together or not at all.
  -- Split across two calls, an offline driver could sync the delivery and lose
  -- the cash, or bank cash against an order that never showed as delivered.
  --
  -- payment_status moves to 'deposited' alongside cash_deposited_at: two
  -- screens read the status to decide whether the cash is banked, so setting
  -- only the timestamp banked it in one place and not the other.
  update sales_orders
     set cash_collected_mvr = p_amount_mvr,
         cash_deposited_at  = case when p_mark_deposited
                                   then coalesce(cash_deposited_at, now())
                                   else cash_deposited_at end,
         payment_status     = case when p_mark_deposited then 'deposited'
                                   else payment_status end,
         status             = case when p_mark_delivered then 'delivered' else status end,
         delivered_at       = case when p_mark_delivered
                                   then coalesce(delivered_at, now())
                                   else delivered_at end
   where id = p_order_id;

  perform recalculate_order_payment_status(p_order_id);

  insert into audit_log (table_name, record_id, action, reason, changed_by)
  values ('sales_orders', p_order_id, 'update',
          format('COD cash recorded: MVR %s%s%s',
                 to_char(p_amount_mvr, 'FM999,999,990.00'),
                 case when p_mark_delivered then ' (delivered)' else '' end,
                 case when p_mark_deposited then ' (deposited)' else '' end),
          v_user);
end $function$;

REVOKE EXECUTE ON FUNCTION public.record_cod_collection(uuid, numeric, boolean, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_cod_collection(uuid, numeric, boolean, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_cod_collection(uuid, numeric, boolean, boolean, text) TO authenticated;

COMMIT;

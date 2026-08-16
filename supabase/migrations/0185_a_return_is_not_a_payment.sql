-- 0185 — a return is not a payment, and "unpaid" means one thing.
--
-- Ali, 2026-08-16, on SO-2026-117: *"I did create the return but the dashboard
-- still showed customer owes money. I then again went in to the sales and
-- marked as delivered. Now it shows paid in full. This is very wrong and
-- confusing."*
--
-- He is right, and his screenshot shows the contradiction in two adjacent
-- lines:
--
--     ✓ Paid in full
--     Paid MVR 0 of MVR 207
--
-- FIRST, WHAT IS *NOT* WRONG, because it matters for how far this fix reaches.
-- The money is correct. The customer bought 1 pack of Xtra Kering XXL for
-- MVR 207, paid nothing, rejected it at the door, and it came back opened and
-- unsellable. The return was recorded as a credit (nothing to refund because
-- nothing was paid), the pack was correctly NOT put back on the shelf, and the
-- P&L already reverses the MVR 207 of revenue while keeping the MVR 126 of
-- cost as the loss it is. `v_order_balances` says he is owed MVR 0. Every
-- number is right.
--
-- What is wrong is the WORD. Three defects, one root.
--
-- 1. A RETURN IS COUNTED AS MONEY. `recalculate_order_payment_status` adds
--    `v_returned` to `v_paid` and calls the total "paid". Cash received and
--    goods sent back both leave nothing to collect, and they are not the same
--    event. In ordinary accounts an invoice closed by a credit note is
--    SETTLED; it is "paid" only when the customer's money covered it. Saying
--    "paid" of an invoice nobody paid makes it impossible to answer "how much
--    did we actually collect", and it is what put a green tick above
--    "MVR 0 of MVR 207".
--
-- 2. THE FLAG BLOCKS THE BUTTONS ON HIS OWN SCREEN. `void_sales_order` and
--    `delete_sales_order` both refuse when `payment_status in
--    ('paid','deposited')` — "Cannot void: payment already settled". On
--    SO-2026-117 that sentence is false and the Void button next to it is
--    dead. Both functions ALREADY have the correct guard four lines further
--    down (`v_paid > 0.005`, real money in the ledger), so the flag check adds
--    nothing but a wrong reason.
--
-- 3. "UNPAID" MEANS THREE DIFFERENT THINGS. Found while tracing the above,
--    and it has nothing to do with returns:
--      get_sales_orders        payment_status in ('pending','partial')
--      get_sales_orders_count  payment_status not in ('paid','deposited')
--      get_receivables_aging   the flag AND the arithmetic
--    So the unpaid filter counts 'cod' and 'credit' orders in its total and
--    then does not list them. One question, three answers. The arithmetic is
--    the only one that cannot drift, so all three now use it.
--
-- 4. AND HE HAD TO FINISH THE JOB BY HAND. The order sat on the dispatch board
--    as still out for delivery for two days after the goods were back in his
--    godown, which is why he went and marked it delivered — an action that
--    then flipped the flag and produced the screen he photographed. A return
--    that takes the whole order back ends the trip; the app should say so
--    itself.
--
-- THE RULE, STATED ONCE:
--
--   pending    nothing has come in and nothing has come back
--   partial    some of it is settled
--   paid       THE CUSTOMER'S MONEY covered the invoice
--   settled    nothing left to collect, because goods came back — NEW
--   credit     more was taken than was kept; money is owed BACK
--   cod        cash to be collected on delivery      } cash-handling states,
--   deposited  cash collected and banked             } untouched by this
--
-- 'paid' now requires `paid >= total`. If a return was needed to close the
-- invoice, it is 'settled'. That is the whole change, and everything below
-- follows from it.

-- ── The new state ──────────────────────────────────────────────────────────
alter table sales_orders drop constraint if exists sales_orders_payment_status_check;
alter table sales_orders add constraint sales_orders_payment_status_check
  check (payment_status in ('pending','partial','paid','settled','cod','deposited','credit'));

comment on column sales_orders.payment_status is
  'Derived from the payments ledger and the returns ledger — never set by hand. '
  '"paid" means the customer''s money covered the invoice; "settled" means '
  'nothing is left to collect because goods came back. Both leave a zero '
  'balance and they are not the same event.';

-- ── One rule for what the flag says ────────────────────────────────────────
create or replace function recalculate_order_payment_status(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cur      text;
  v_paid     numeric;
  v_returned numeric;
  v_total    numeric;
begin
  select payment_status into v_cur from sales_orders where id = p_order_id;

  -- Cash-handling states describe how the money was collected, not whether the
  -- balance is settled. Over-collection on COD is refused at the door.
  if v_cur in ('cod', 'deposited') then
    return;
  end if;

  select coalesce(sum(amount_mvr), 0)        into v_paid     from order_payments   where order_id = p_order_id;
  select coalesce(sum(refund_amount_mvr), 0) into v_returned from sales_returns    where order_id = p_order_id;
  select coalesce(sum(line_total_mvr), 0)    into v_total    from sales_order_lines where order_id = p_order_id;

  update sales_orders
  set payment_status = case
        when (v_paid + v_returned) <= 0.005 then 'pending'
        -- Before 'paid': an overpaid order also clears the "at least the
        -- total" test, and used to be reported as settled.
        when (v_paid + v_returned) > v_total + 0.005 then 'credit'
        -- THE FIX. Both branches leave nothing to collect; only one of them
        -- involved the customer's money. Splitting them is the entire point of
        -- this migration — 'paid' now has to be earned by a payment.
        when (v_paid + v_returned) >= v_total - 0.005 then
          case when v_paid >= v_total - 0.005 then 'paid' else 'settled' end
        else 'partial'
      end,
      updated_at = now()
  where id = p_order_id;
end $fn$;

revoke execute on function recalculate_order_payment_status(uuid) from public;
revoke execute on function recalculate_order_payment_status(uuid) from anon;

-- ── The screen can say WHY the balance is zero ─────────────────────────────
-- The view already subtracted returns to get the balance; it just never said
-- so, which left the panel with "Paid MVR 0" as the only number it had and a
-- zero balance it could not explain. Exposing the figure the view already
-- computes keeps the arithmetic in Postgres (hard rule 1) instead of having
-- the screen reconstruct it from three other columns.
create or replace view v_order_balances as
  SELECT so.id AS order_id,
         so.order_number,
         so.customer_id,
         so.payment_status,
         so.payment_method,
         COALESCE(lt.order_total, 0::numeric) AS order_total_mvr,
         COALESCE(pd.paid, 0::numeric) AS paid_mvr,
         ROUND(COALESCE(lt.order_total, 0::numeric)
               - COALESCE(pd.paid, 0::numeric)
               - COALESCE(rt.returned, 0::numeric), 2) AS balance_mvr,
         pd.last_paid_at,
         pd.payment_count,
         -- Appended rather than slotted in beside paid_mvr where it reads
         -- better: CREATE OR REPLACE VIEW can only add columns at the end, and
         -- dropping the view would take every dependent object with it.
         ROUND(COALESCE(rt.returned, 0::numeric), 2) AS returned_mvr
  FROM sales_orders so
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(l.line_total_mvr), 0::numeric) AS order_total
    FROM sales_order_lines l WHERE l.order_id = so.id) lt ON true
  LEFT JOIN LATERAL (
    SELECT sum(p.amount_mvr) AS paid, max(p.paid_at) AS last_paid_at, count(*) AS payment_count
    FROM order_payments p WHERE p.order_id = so.id) pd ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(r.refund_amount_mvr), 0::numeric) AS returned
    FROM sales_returns r WHERE r.order_id = so.id) rt ON true;

revoke all on v_order_balances from anon;
grant select on v_order_balances to authenticated;

-- ── It can no longer go stale ──────────────────────────────────────────────
-- `order_payments` has had this trigger since 0069. `sales_returns` never did:
-- the only thing keeping the flag current after a return was one explicit call
-- inside record_customer_return, so any other path that touched the table — a
-- correction, a removal, a future admin fix — left the flag lying. A derived
-- value with one hand-written updater is a value that will be wrong one day.
drop trigger if exists trg_sync_order_payment_status on sales_returns;
create trigger trg_sync_order_payment_status
  after insert or update or delete on sales_returns
  for each row execute function sync_order_payment_status();

-- ── One definition of "unpaid": the arithmetic ─────────────────────────────
-- The flag is now only ever a LABEL. Nothing that counts money reads it,
-- because the ledger cannot drift from itself.
--
-- Dropping the flag from the gate here is safe on COD specifically:
-- record_cod_collection writes the cash into order_payments (it has since
-- 0136), so a collected COD order nets to zero through the arithmetic alone.
-- A COD order banked but SHORT now correctly shows its shortfall, which is
-- money genuinely owed.
create or replace function get_receivables_aging()
returns table (
  customer_id uuid, customer_name text, phone text,
  orders_count integer, outstanding_mvr numeric, oldest_days integer, bucket text
)
language sql
stable
security definer
set search_path = public
as $fn$
  WITH order_totals AS (
    SELECT so.id, so.customer_id,
           COALESCE((so.delivered_at at time zone 'Indian/Maldives')::date,
                    (so.created_at   at time zone 'Indian/Maldives')::date) AS due_start,
           COALESCE(SUM(sol.line_total_mvr), 0) AS total
    FROM sales_orders so
    JOIN sales_order_lines sol ON sol.order_id = so.id
    WHERE so.status NOT IN ('draft', 'cancelled')
    GROUP BY so.id
  ),
  order_paid AS (
    SELECT op.order_id, COALESCE(SUM(op.amount_mvr), 0) AS paid
    FROM order_payments op GROUP BY op.order_id
  ),
  order_returned AS (
    SELECT sr.order_id, COALESCE(SUM(sr.refund_amount_mvr), 0) AS returned
    FROM sales_returns sr GROUP BY sr.order_id
  ),
  owed AS (
    SELECT ot.customer_id,
           ot.total - COALESCE(p.paid, 0) - COALESCE(r.returned, 0) AS outstanding,
           ((now() at time zone 'Indian/Maldives')::date - ot.due_start) AS age_days
    FROM order_totals ot
    LEFT JOIN order_paid     p ON p.order_id = ot.id
    LEFT JOIN order_returned r ON r.order_id = ot.id
    WHERE ot.total - COALESCE(p.paid, 0) - COALESCE(r.returned, 0) > 0.005
  )
  SELECT
    o.customer_id,
    COALESCE(c.name, 'Walk-in / no customer'),
    c.phone,
    COUNT(*)::integer,
    ROUND(SUM(o.outstanding), 2),
    MAX(o.age_days)::integer,
    CASE WHEN MAX(o.age_days) > 60 THEN 'overdue'
         WHEN MAX(o.age_days) > 30 THEN 'watch'
         ELSE 'current' END
  FROM owed o
  LEFT JOIN customers c ON c.id = o.customer_id
  GROUP BY o.customer_id, c.name, c.phone
  ORDER BY MAX(o.age_days) DESC, SUM(o.outstanding) DESC;
$fn$;

revoke execute on function get_receivables_aging() from public;
revoke execute on function get_receivables_aging() from anon;
grant  execute on function get_receivables_aging() to authenticated;

-- ── The list and its own count now agree ───────────────────────────────────
-- Same predicate, written once here and copied verbatim into all three, so a
-- future edit to one is visibly an edit to all three:
--
--   the order is live, and total - paid - returned > 0.005
do $$
declare
  v_src text;
begin
  -- get_sales_orders and get_sales_orders_count and get_sales_order_customers
  -- differ only in what they select; the WHERE clause below is identical. They
  -- are rewritten by replacing the old flag test with the arithmetic, so no
  -- other behaviour of these functions is touched by this migration.
  for v_src in
    select pg_get_functiondef(oid) from pg_proc
    where proname in ('get_sales_orders','get_sales_orders_count','get_sales_order_customers')
  loop
    v_src := replace(v_src,
      'o.payment_status in (''pending'', ''partial'')',
      'round(coalesce((select sum(l.line_total_mvr) from public.sales_order_lines l where l.order_id = o.id), 0)
             - coalesce((select sum(p2.amount_mvr) from public.order_payments p2 where p2.order_id = o.id), 0)
             - coalesce((select sum(r2.refund_amount_mvr) from public.sales_returns r2 where r2.order_id = o.id), 0), 2) > 0.005');
    v_src := replace(v_src,
      'o.payment_status not in (''paid'', ''deposited'')',
      'round(coalesce((select sum(l.line_total_mvr) from public.sales_order_lines l where l.order_id = o.id), 0)
             - coalesce((select sum(p2.amount_mvr) from public.order_payments p2 where p2.order_id = o.id), 0)
             - coalesce((select sum(r2.refund_amount_mvr) from public.sales_returns r2 where r2.order_id = o.id), 0), 2) > 0.005');
    execute v_src;
  end loop;
end $$;

-- ── The buttons on his screen stop lying ───────────────────────────────────
-- Both of these already refuse when real money sits on the order (`v_paid`)
-- and when cash was collected on delivery. The flag test fired FIRST and gave
-- a false reason, which is how a never-paid order became un-voidable.
--
-- A new guard replaces it, and it is a stock guard rather than a money one:
-- voiding deletes the sale's 'out' movements to put the stock back, but a
-- returned pack that was NOT restocked never came back sellable. Voiding such
-- an order would invent stock that does not exist on the shelf. Returns and
-- voids are two ways of undoing one sale and using both double-counts it.
create or replace function void_sales_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
DECLARE
  v_order    sales_orders%ROWTYPE;
  v_user     UUID := (select auth.uid());
  v_reversed INTEGER;
  v_paid     numeric;
  v_returns  integer;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only a manager or admin can void a confirmed order';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to void an order';
  END IF;

  SELECT * INTO v_order FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.status IN ('cancelled') THEN
    RAISE EXCEPTION 'Order already cancelled';
  END IF;
  IF v_order.status = 'draft' THEN
    RAISE EXCEPTION 'Draft order has no stock to reverse — delete it directly instead';
  END IF;

  SELECT count(*) INTO v_returns FROM sales_returns WHERE order_id = p_order_id;
  IF v_returns > 0 THEN
    RAISE EXCEPTION 'This order already has a return recorded against it, which is how it was undone. Voiding it as well would put stock back on the shelf twice.';
  END IF;

  IF v_order.status = 'delivered' AND COALESCE(v_order.cash_collected_mvr, 0) > 0 THEN
    RAISE EXCEPTION 'Cannot void: cash already collected on delivery. Issue a credit note instead.';
  END IF;

  -- A partially-paid order must have its payments reversed first, otherwise
  -- the customer's money sits orphaned on a cancelled order that no screen
  -- tracks (receivables excludes cancelled orders by design).
  SELECT COALESCE(SUM(op.amount_mvr), 0) INTO v_paid
  FROM order_payments op WHERE op.order_id = p_order_id;
  IF v_paid > 0.005 THEN
    RAISE EXCEPTION 'MVR % has already been paid on this order — remove or reverse the payment first, then void.',
      to_char(v_paid, 'FM999,999,990.00');
  END IF;

  DELETE FROM stock_movements
  WHERE source_type = 'sales_order' AND source_id = p_order_id AND movement_type = 'out';
  GET DIAGNOSTICS v_reversed = ROW_COUNT;

  UPDATE sales_orders SET status = 'cancelled' WHERE id = p_order_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('sales_orders', p_order_id, 'update',
          format('voided — %s stock movement(s) reversed. Reason: %s', v_reversed, p_reason), v_user);
END $fn$;

revoke execute on function void_sales_order(uuid, text) from public;
revoke execute on function void_sales_order(uuid, text) from anon;
grant  execute on function void_sales_order(uuid, text) to authenticated;

create or replace function delete_sales_order(p_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_order    sales_orders%ROWTYPE;
  v_user     uuid := (select auth.uid());
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

  if exists (select 1 from sales_returns where order_id = p_order_id) then
    raise exception 'This order has a return recorded against it. Deleting it would erase the return and the stock decision that went with it.';
  end if;
  if coalesce(v_order.cash_collected_mvr, 0) > 0 then
    raise exception 'Cannot delete: cash already collected on delivery. Void the order and issue a credit note instead.';
  end if;

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
  where source_type = 'sales_order' and source_id = p_order_id and movement_type = 'out';
  get diagnostics v_reversed = row_count;

  insert into audit_log (table_name, record_id, action, reason, changed_by)
  values ('sales_orders', p_order_id, 'delete',
          format('deleted order %s (was %s) — %s stock movement(s) reversed.%s',
                 v_order.order_number, v_order.status, v_reversed,
                 case when p_reason is null or trim(p_reason) = '' then ''
                      else ' Reason: ' || p_reason end),
          v_user);

  delete from sales_orders where id = p_order_id;
end $fn$;

revoke execute on function delete_sales_order(uuid, text) from public;
revoke execute on function delete_sales_order(uuid, text) from anon;
grant  execute on function delete_sales_order(uuid, text) to authenticated;

-- The preview has to say the same thing the button will say, or the confirm
-- sheet promises something the RPC then refuses.
create or replace function get_sales_order_delete_impact(p_order_id uuid)
returns table (
  order_number text, customer_name text, status text, total_mvr numeric,
  paid_mvr numeric, balance_mvr numeric, line_count integer,
  pieces_restored integer, stock_restored_summary text, blocked_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
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
  with restored as (
    select sm.sku_id, sum(sm.qty_pieces) as pieces, m.name as model,
           v.display_name as variant, s.pcs_per_pack, s.packs_per_carton,
           s.sellable_units, pc.unit_uom
    from stock_movements sm
    join skus s                on s.id = sm.sku_id
    join variants v            on v.id = s.variant_id
    join product_models m      on m.id = v.model_id
    join product_categories pc on pc.id = m.category_id
    where sm.source_type = 'sales_order'
      and sm.source_id   = p_order_id
      and sm.movement_type = 'out'
    group by sm.sku_id, m.name, v.display_name, s.pcs_per_pack,
             s.packs_per_carton, s.sellable_units, pc.unit_uom
  )
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
    coalesce((select sum(r.pieces)::integer from restored r), 0),
    (select string_agg(
        public.qty_in_trade_units(r.pieces, r.pcs_per_pack, r.packs_per_carton,
                                  r.unit_uom, r.sellable_units)
        || ' ' || btrim(r.model || ' ' || r.variant),
        ' · ' order by r.pieces desc)
     from restored r),
    case
      when exists (select 1 from sales_returns sr where sr.order_id = p_order_id) then
        'This order has a return recorded against it. Deleting it would erase the return and the stock decision that went with it.'
      when coalesce(v_order.cash_collected_mvr, 0) > 0 then
        'Cash has been collected against this order. Void it instead of deleting it.'
      when abs(v_paid) > 0.005 then
        'A payment has been recorded against this order. Void it instead of deleting it.'
      else null
    end;
end $fn$;

revoke execute on function get_sales_order_delete_impact(uuid) from public;
revoke execute on function get_sales_order_delete_impact(uuid) from anon;
grant  execute on function get_sales_order_delete_impact(uuid) to authenticated;

-- ── The trip is over when everything comes back ────────────────────────────
-- SO-2026-117 sat on the dispatch board as still out for delivery for two days
-- after the goods were back in the godown. That is why he went and marked it
-- delivered by hand — and that hand-action is what produced the screen he
-- photographed. An order whose entire contents have been returned is finished;
-- the app closes it itself, and the return record is the story of what
-- happened at the door.
--
-- 'delivered' rather than 'cancelled' on purpose: the goods physically left
-- the warehouse, stock moved, and a cancel would try to unwind a journey that
-- really happened. Void is the tool for a sale that should never have existed;
-- this one existed and was refused.
create or replace function complete_order_if_fully_returned(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sold     numeric;
  v_returned numeric;
  v_status   text;
begin
  select status into v_status from sales_orders where id = p_order_id;
  if v_status is null or v_status in ('draft','cancelled','delivered') then
    return;
  end if;

  select coalesce(sum(qty_pieces), 0) into v_sold
  from sales_order_lines where order_id = p_order_id;
  select coalesce(sum(qty_pieces), 0) into v_returned
  from sales_returns where order_id = p_order_id;

  if v_sold > 0 and v_returned >= v_sold then
    update sales_orders
    set status = 'delivered', delivered_at = coalesce(delivered_at, now())
    where id = p_order_id;

    insert into audit_log (table_name, record_id, action, reason, changed_by)
    values ('sales_orders', p_order_id, 'update',
            'Closed automatically: every item on this order has been returned, so the delivery run is over.',
            (select auth.uid()));
  end if;
end $fn$;

revoke execute on function complete_order_if_fully_returned(uuid) from public;
revoke execute on function complete_order_if_fully_returned(uuid) from anon;

-- record_customer_return is rewritten only to add the two lines that call the
-- helper above; everything else is byte-for-byte what 0182 shipped.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc where proname = 'record_customer_return';
  v_src := replace(v_src,
    'perform recalculate_order_payment_status(p_order_id);',
    'perform recalculate_order_payment_status(p_order_id);
  perform complete_order_if_fully_returned(p_order_id);');
  execute v_src;
end $$;

-- ── Bring every existing order onto the new rule ───────────────────────────
-- Only SO-2026-117 changes today (it is the one order in the business whose
-- flag says 'paid' while the payments ledger says MVR 0), but the backfill is
-- written for all of them so the column is provably consistent afterwards.
do $$
declare r record;
begin
  for r in select id from sales_orders where payment_status not in ('cod','deposited') loop
    perform recalculate_order_payment_status(r.id);
  end loop;
end $$;

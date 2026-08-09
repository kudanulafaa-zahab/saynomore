-- 0161 — money owed BACK to a customer stops being invisible.
--
-- Flagged when 0156 fixed the order-line edit, and left deliberately for its
-- own change because it needs a new status value, a constraint change and a
-- place to show it. Ali, 2026-08-07: "Credit gap you correct based on best
-- professional way."
--
-- THE GAP
--
-- Shrink a paid order — edit a line down, or take a return — and the customer
-- has paid more than they now owe. v_order_balances says so correctly:
--
--   order 3,500 paid in full, line edited down to 700  ->  balance -2,800
--
-- But nothing surfaced it:
--
--   * payment_status had no value for it. The allowed set was
--     pending / partial / paid / cod / deposited, and the rule
--     "paid + returned >= total" collapsed an overpayment to 'paid'. An
--     order the customer is owed 2,800 on read as settled.
--   * get_receivables_aging filters to outstanding > 0.005, so a negative
--     balance is dropped from the one report about who owes what.
--
-- Money owed back is a liability. In accounts receivable a customer with a
-- negative balance holds a CREDIT, and standard practice is to report credits
-- explicitly rather than net them away or hide them — a hidden credit is a
-- customer who paid twice and was never told, or a refund that never went out.
--
-- THE FIX, in three parts
--
-- 1. 'credit' joins the payment_status set, and recalculate_order_payment_
--    status emits it when settled value exceeds the order total. Ordering
--    matters: credit is tested BEFORE paid, since an overpaid order also
--    satisfies ">= total".
--
--    'cod' and 'deposited' keep their early return. Those describe how cash
--    was handled rather than whether the balance is settled, and over-
--    collection on a COD order is already refused at the door (0157). Mixing
--    the two meanings in one column is a real design smell, but untangling it
--    is a bigger change than this one and not needed to close the gap.
--
-- 2. get_customer_credits() reports them, per order, worst first. It reads
--    v_order_balances rather than recomputing: that view already defines the
--    balance as total - paid - returned, and a fourth copy of that arithmetic
--    is how two figures start to disagree.
--
--    Draft and cancelled orders are excluded — an order that never happened
--    cannot owe anyone anything.
--
-- 3. The morning briefing says it out loud, with the money and the customer
--    named, alongside the money owed TO him. Both directions in one place.
--
-- get_receivables_aging is left exactly as it is. Aging answers "who owes me",
-- credits answer "who do I owe", and folding a negative into an aging bucket
-- would quietly reduce the overdue total — the briefing's overdue_mvr reads
-- `bucket <> 'current'`, so a credit landing in a bucket would net against
-- real debt. Two questions, two functions.

BEGIN;

-- ── 1. A status for it ────────────────────────────────────────────────────
ALTER TABLE public.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_payment_status_check;
ALTER TABLE public.sales_orders
  ADD CONSTRAINT sales_orders_payment_status_check
  CHECK (payment_status = ANY (ARRAY['pending','partial','paid','cod','deposited','credit']));

-- Invoker rights, exactly as it has been since 0124. A first draft of this
-- migration added SECURITY DEFINER while rewriting the body, and the anon-grant
-- sweep in security_and_stock_rules.test.sql caught it before it shipped: a
-- definer function carries an implicit PUBLIC execute grant, so the helper
-- would have become anon-callable. It is called from the sync trigger and from
-- definer functions that already hold the privileges it needs — it does not
-- need any of its own, and a logic fix is never a reason to widen a security
-- model.
CREATE OR REPLACE FUNCTION public.recalculate_order_payment_status(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  v_cur      text;
  v_paid     numeric;
  v_returned numeric;
  v_total    numeric;
begin
  select payment_status into v_cur from sales_orders where id = p_order_id;

  -- Cash-handling states describe how the money was collected, not whether
  -- the balance is settled. Over-collection on COD is refused at the door.
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
      -- Before 'paid': an overpaid order also clears the "at least the total"
      -- test, and used to be reported as settled.
      when (v_paid + v_returned) > v_total + 0.005   then 'credit'
      when (v_paid + v_returned) >= v_total - 0.005  then 'paid'
      else                                                'partial'
    end,
    updated_at = now()
  where id = p_order_id;
end $function$;

-- ── 2. A report of who is owed what ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_customer_credits()
RETURNS TABLE (
  order_id      uuid,
  order_number  text,
  customer_id   uuid,
  customer_name text,
  phone         text,
  credit_mvr    numeric,
  days_since    integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select
    b.order_id,
    b.order_number,
    b.customer_id,
    coalesce(c.name, 'Walk-in / no customer'),
    c.phone,
    -- balance_mvr is total - paid - returned, so a credit is its negation.
    round(-b.balance_mvr, 2),
    ((now() at time zone 'Indian/Maldives')::date
       - (so.created_at at time zone 'Indian/Maldives')::date)::int
  from v_order_balances b
  join sales_orders so on so.id = b.order_id
  left join customers c on c.id = b.customer_id
  where so.status not in ('draft','cancelled')
    and b.balance_mvr < -0.005
  order by b.balance_mvr asc;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_customer_credits() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_customer_credits() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_customer_credits() TO authenticated;

-- ── 3. Say it in the briefing, next to the money owed TO him ──────────────
CREATE OR REPLACE FUNCTION public.get_morning_briefing()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with mvt as (
    select (now() at time zone 'Indian/Maldives')::date as today
  ),
  y as (select (select today from mvt) - 1 as d),
  demand as (
    select sol.sku_id, sum(sol.qty_pieces) as pcs_30d
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    where so.status not in ('draft','cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date > (select today from mvt) - 30
    group by sol.sku_id
  ),
  on_hand as (
    select sm.sku_id, sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)) as pcs
    from stock_movements sm group by sm.sku_id
  ),
  cover as (
    select v.id,
           concat_ws(' ', v.model_name, v.variant_display) as product,
           round(d.pcs_30d::numeric / nullif(v.pcs_per_pack, 0), 1) as packs_30d,
           round(coalesce(oh.pcs, 0)::numeric / nullif(v.pcs_per_pack, 0), 1) as packs_left,
           coalesce(oh.pcs, 0) as pcs_left,
           round( (d.pcs_30d::numeric / nullif(v.pcs_per_pack, 0))
                  * coalesce(v.selling_price_per_pack_mvr, 0) ) as mvr_30d,
           case when d.pcs_30d > 0
                then coalesce(oh.pcs, 0)::numeric / (d.pcs_30d::numeric / 30.0)
           end as days_left
    from v_skus v
    join demand d on d.sku_id = v.id
    left join on_hand oh on oh.sku_id = v.id
    where v.is_active
  ),
  stuck as (
    select p.stock_value_mvr, p.reason,
           concat_ws(' ', vs.model_name, vs.variant_display) as product
    from get_promo_suggestions() p
    join v_skus vs on vs.id = p.sku_id
  ),
  at_risk_customers as (
    select name, phone, usual_gap_days, days_since_last,
           expected_supply_days, risk_reason, revenue_mvr
    from get_customer_insights() where at_risk
  ),
  credits as (
    select customer_name, credit_mvr from get_customer_credits()
  )
  select jsonb_build_object(
    'yesterday_revenue', coalesce((
      select sum(sol.line_total_mvr) from sales_order_lines sol
      join sales_orders so on so.id = sol.order_id
      where so.status not in ('draft','cancelled')
        and (so.created_at at time zone 'Indian/Maldives')::date = (select d from y)), 0),
    'yesterday_orders', (
      select count(*) from sales_orders
      where status not in ('draft','cancelled')
        and (created_at at time zone 'Indian/Maldives')::date = (select d from y)),
    'yesterday_delivered', (
      select count(*) from sales_orders
      where (delivered_at at time zone 'Indian/Maldives')::date = (select d from y)),
    'yesterday_collected', coalesce((
      select sum(amount_mvr) from order_payments
      where (paid_at at time zone 'Indian/Maldives')::date = (select d from y)), 0),

    'stockout_count', (select count(*) from cover where pcs_left <= 0),
    'stockout_mvr_month', coalesce((select sum(mvr_30d) from cover where pcs_left <= 0), 0),
    'stockouts', coalesce((
      select jsonb_agg(jsonb_build_object('product', x.product,
               'packs_per_month', x.packs_30d, 'mvr_per_month', x.mvr_30d))
      from (select product, packs_30d, mvr_30d from cover
             where pcs_left <= 0 order by mvr_30d desc, packs_30d desc limit 3) x), '[]'::jsonb),

    'running_out_count', (
      select count(*) from cover where pcs_left > 0 and days_left is not null and days_left < 7),
    'running_out', coalesce((
      select jsonb_agg(jsonb_build_object('product', x.product,
               'packs_left', x.packs_left, 'days_left', round(x.days_left)))
      from (select product, packs_left, days_left from cover
             where pcs_left > 0 and days_left is not null and days_left < 7
             order by days_left asc limit 3) x), '[]'::jsonb),

    'overdue_count', (
      select count(*) from get_receivables_aging() where bucket <> 'current'),
    'overdue_mvr', coalesce((
      select sum(outstanding_mvr) from get_receivables_aging() where bucket <> 'current'), 0),

    -- Money owed BACK, beside the money owed TO him.
    'credits_count', (select count(*) from credits),
    'credits_mvr', coalesce((select sum(credit_mvr) from credits), 0),
    'credits_top', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.customer_name, 'mvr', x.credit_mvr))
      from (select customer_name, credit_mvr from credits
             order by credit_mvr desc limit 2) x), '[]'::jsonb),

    'stuck_stock_count', (select count(*) from stuck),
    'stuck_stock_mvr', coalesce((select sum(stock_value_mvr) from stuck), 0),
    'stuck_stock_top', coalesce((
      select jsonb_agg(jsonb_build_object('product', x.product,
               'mvr', x.stock_value_mvr, 'reason', x.reason))
      from (select product, stock_value_mvr, reason from stuck
             order by stock_value_mvr desc limit 2) x), '[]'::jsonb),

    'expiring_value_mvr', coalesce((
      select sum(value_mvr) from v_expiring_stock where days_left <= 60), 0),
    'batches_without_expiry', (
      select count(*) from inventory_batches ib
      where ib.expiry_date is null
        and (select coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0)
               from stock_movements sm where sm.batch_id = ib.id) > 0),
    'stock_value_without_expiry_mvr', coalesce((
      select sum( (select coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0)
                     from stock_movements sm where sm.batch_id = ib.id)
                  * coalesce(ib.landed_per_piece_mvr, 0) )
      from inventory_batches ib
      where ib.expiry_date is null
        and (select coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0)
               from stock_movements sm where sm.batch_id = ib.id) > 0), 0),
    'price_checks_due', (
      select count(*) from get_competitor_price_freshness() f where f.due),
    'price_checks_cost_changed', (
      select count(*) from get_competitor_price_freshness() f
       where f.due_reason = 'cost_changed'),

    'at_risk_count', (select count(*) from at_risk_customers),
    'overdue_customers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', x.name, 'phone', x.phone,
               'usual_gap_days', x.usual_gap_days,
               'days_since_last', x.days_since_last,
               'expected_supply_days', x.expected_supply_days,
               'reason', x.risk_reason))
      from (select * from at_risk_customers
             order by revenue_mvr desc nulls last, days_since_last desc
             limit 3) x), '[]'::jsonb)
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.get_morning_briefing() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_morning_briefing() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_morning_briefing() TO authenticated;

COMMIT;

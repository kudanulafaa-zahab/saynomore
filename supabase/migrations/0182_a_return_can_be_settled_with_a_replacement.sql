-- 0182 — a return can be settled with a replacement.
--
-- Ali, 2026-08-15: "Customer didn't pay for the order when delivered. Customer
-- opened the pack and returned it. Now the pack is not sellable because it was
-- opened… What if customer paid and returned the product and needs a refund and
-- what if the customer paid, returned the product and needs a replacement
-- product. Same to unpaid customers."
--
-- WHAT ALREADY WORKED, and is not being rebuilt. A return is three independent
-- facts and the app already separates them properly:
--
--   1. WHAT CAME BACK   — product and quantity, in packs and cartons
--   2. WHERE IT GOES    — back into sellable stock, or written off (`restocked`)
--   3. HOW IT IS SETTLED — money back, or less to pay
--
-- Keeping (2) apart from (3) is the part most systems get wrong, and this one
-- had it right from the start: whether the goods can be sold again has nothing
-- to do with how the customer is squared up. Ali's own case needs exactly that
-- combination — nothing to refund because he was never paid, and nothing to put
-- back because the pack was opened.
--
-- WHAT WAS MISSING is the third settlement every shop actually uses: send
-- another one. Until now that meant recording a return and then building a
-- whole second order by hand — the "jumping to different menus" he asked not to
-- do — and the replacement's cost landed nowhere.
--
-- WHY A REPLACEMENT IS NOT A REFUND OF ZERO. The bill does not move: the
-- customer keeps what they paid (or still owes what they owed) because they are
-- getting the goods they bought. So refund_amount_mvr is 0 and the balance is
-- untouched. But a SECOND unit physically leaves the godown, and that unit costs
-- money. COGS in get_pnl is summed from sales_order_lines, so a replacement
-- issued outside those lines would be invisible: stock would fall, cost would
-- not, and every margin on the screen would be overstated. That is why
-- replacement_cost_mvr is recorded on the return and subtracted in the P&L.
--
-- The honest arithmetic, and it is worth stating because it is the whole reason
-- a replacement is expensive: replace + write off the returned goods = you paid
-- for the item twice and were paid for it once. Replace + put the returned goods
-- back = you shipped a different unit and are square. The difference is
-- decided by `restock`, which is exactly where that decision belongs.
--
-- THE REPLACEMENT COMES OUT OF REAL STOCK, FIFO, from the warehouse the order
-- shipped from — the same v_batch_stock ordering post_sale uses, so a
-- replacement consumes stock exactly like a sale does. If there is not enough,
-- it refuses and says how much is short. Stock is SUM(stock_movements) (hard
-- rule 2) and a replacement that shipped from nothing would be a lie in the
-- ledger as well as in the godown.

alter table sales_returns drop constraint if exists sales_returns_settlement_check;
alter table sales_returns add constraint sales_returns_settlement_check
  check (settlement = any (array['refund'::text, 'credit'::text, 'replace'::text]));

alter table sales_returns
  add column if not exists replacement_cost_mvr numeric(14,2) not null default 0;

comment on column sales_returns.replacement_cost_mvr is
  'Landed cost of the goods sent out as a replacement, FIFO, at the moment it '
  'was issued. Zero for refunds and credits. Subtracted in get_pnl because this '
  'stock leaves without an order line, so nothing else would ever expense it.';

-- ── The engine ──────────────────────────────────────────────────────────────

create or replace function record_customer_return(
  p_order_id   uuid,
  p_sku_id     uuid,
  p_qty_pieces integer,
  p_reason     text,
  p_settlement text,
  p_restock    boolean default true,
  p_notes      text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_line        record;
  v_mv          record;
  v_sold        integer;
  v_returned    integer;
  v_price_pc    numeric;
  v_refund      numeric;
  v_cost_pc     numeric;
  v_batch       uuid;
  v_godown      uuid;
  v_outstanding numeric;
  v_id          uuid;
  v_left        integer;
  v_take        integer;
  v_cost_back   numeric := 0;
  v_put_back    integer := 0;
  v_rep_cost    numeric := 0;
  v_rep_left    integer := 0;
  v_avail       integer := 0;
  v_godown_name text;
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
  if p_settlement not in ('refund','credit','replace') then
    raise exception 'Invalid settlement type';
  end if;

  select sol.qty_pieces, sol.line_total_mvr, sol.landed_cost_per_piece_mvr
    into v_line
  from sales_order_lines sol
  join sales_orders so on so.id = sol.order_id
  where sol.order_id = p_order_id and sol.sku_id = p_sku_id
    and so.status not in ('draft','cancelled')
  limit 1;

  if not found then
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
  -- A replacement moves no money: they keep what they paid, or still owe what
  -- they owed, because they are getting the goods they bought.
  v_refund   := case when p_settlement = 'replace' then 0
                     else round(p_qty_pieces * v_price_pc, 2) end;
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

  -- Refusing to hand money back to someone who never paid. Without this the
  -- ledger takes a negative payment against a bill that was never settled, and
  -- the customer ends up owing the same amount with a phantom refund beside it.
  if p_settlement = 'refund' then
    select coalesce(sum(op.amount_mvr), 0) into v_outstanding
    from order_payments op where op.order_id = p_order_id;
    if v_outstanding < v_refund - 0.005 then
      raise exception 'Only MVR % has been paid on this order — take it off what they owe instead of refunding',
        round(greatest(v_outstanding, 0), 2);
    end if;
  end if;

  -- ── Put the pieces back where they came from ────────────────────────────
  -- Most recently issued batch first (reverse of FIFO consumption), each one
  -- capped at what it still has outstanding from this order.
  if p_restock and v_batch is not null then
    v_left := p_qty_pieces;

    for v_mv in
      -- Ordered by the BATCH's own age, newest first — the exact reverse of
      -- the FIFO that consumed it. Deliberately NOT by movement timestamp:
      -- post_sale writes every out-movement in one statement, so they share a
      -- created_at and the tiebreak fell to a random batch_id, once worth
      -- MVR 340 of stock value on a single return.
      select sm.batch_id,
             sm.godown_id,
             sum(case when sm.movement_type = 'out'       then sm.qty_pieces else 0 end)
           - sum(case when sm.movement_type = 'return_in' then sm.qty_pieces else 0 end) as net_out
        from stock_movements sm
        join inventory_batches ib on ib.id = sm.batch_id
       where sm.source_id = p_order_id
         and sm.sku_id    = p_sku_id
         and sm.movement_type in ('out','return_in')
       group by sm.batch_id, sm.godown_id, ib.received_at
      having sum(case when sm.movement_type = 'out'       then sm.qty_pieces else 0 end)
           - sum(case when sm.movement_type = 'return_in' then sm.qty_pieces else 0 end) > 0
       order by ib.received_at desc, sm.batch_id
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_mv.net_out);

      insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces,
                                   source_type, source_id, notes, created_by)
      values (v_mv.batch_id, p_sku_id, v_mv.godown_id, 'return_in', v_take, 'return', p_order_id,
              'Customer return: ' || p_reason, (select auth.uid()));

      v_cost_back := v_cost_back
                   + v_take * coalesce((select landed_per_piece_mvr
                                          from inventory_batches where id = v_mv.batch_id), 0);
      v_put_back  := v_put_back + v_take;
      v_left      := v_left - v_take;
    end loop;

    if v_put_back > 0 then
      v_cost_pc := round(v_cost_back / v_put_back, 4);
    end if;
  end if;

  -- ── Send another one ────────────────────────────────────────────────────
  -- FIFO out of the warehouse this order shipped from, exactly as post_sale
  -- issues a sale, and only AFTER any restock above — so a good pack coming
  -- back is available to go straight out again rather than being refused for
  -- lack of stock it is itself holding.
  if p_settlement = 'replace' then
    if v_godown is null then
      raise exception 'This order has no warehouse recorded, so a replacement cannot be issued from stock';
    end if;

    select coalesce(sum(bs.qty_pieces_remaining), 0) into v_avail
    from v_batch_stock bs
    where bs.sku_id = p_sku_id and bs.godown_id = v_godown and bs.qty_pieces_remaining > 0;

    if v_avail < p_qty_pieces then
      select name into v_godown_name from godowns where id = v_godown;
      raise exception 'Not enough stock at % to replace this — % pieces there, % needed. Receive stock first, or settle it as money back instead.',
        coalesce(v_godown_name, 'that warehouse'), v_avail, p_qty_pieces;
    end if;

    v_rep_left := p_qty_pieces;
    for v_mv in
      select bs.batch_id, bs.qty_pieces_remaining, bs.landed_per_piece_mvr
      from v_batch_stock bs
      where bs.sku_id = p_sku_id and bs.godown_id = v_godown and bs.qty_pieces_remaining > 0
      order by bs.received_at asc
    loop
      exit when v_rep_left <= 0;
      v_take := least(v_rep_left, v_mv.qty_pieces_remaining);

      insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces,
                                   source_type, source_id, notes, created_by)
      values (v_mv.batch_id, p_sku_id, v_godown, 'out', v_take, 'return', p_order_id,
              'Replacement issued for returned goods', (select auth.uid()));

      v_rep_cost := v_rep_cost + v_take * coalesce(v_mv.landed_per_piece_mvr, 0);
      v_rep_left := v_rep_left - v_take;
    end loop;
  end if;

  insert into sales_returns (order_id, sku_id, godown_id, qty_pieces, refund_amount_mvr,
                             landed_cost_per_piece_mvr, restocked, reason, settlement, notes,
                             replacement_cost_mvr, created_by)
  values (p_order_id, p_sku_id, v_godown, p_qty_pieces, v_refund, v_cost_pc,
          (v_put_back > 0), p_reason, p_settlement,
          nullif(btrim(p_notes), ''), round(v_rep_cost, 2), (select auth.uid()))
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
            || case when v_put_back > 0 then ' — restocked' else ' — NOT restocked' end
            || case when v_rep_cost > 0 then ' — replacement cost MVR ' || round(v_rep_cost, 2) else '' end,
          (select auth.uid()));

  return jsonb_build_object(
    'id', v_id,
    'refund_mvr', v_refund,
    'cost_recovered_mvr', round(v_cost_back, 2),
    'replacement_cost_mvr', round(v_rep_cost, 2),
    'restocked', (v_put_back > 0),
    'settlement', p_settlement
  );
end;
$fn$;

revoke execute on function record_customer_return(uuid, uuid, integer, text, text, boolean, text) from public;
revoke execute on function record_customer_return(uuid, uuid, integer, text, text, boolean, text) from anon;
grant  execute on function record_customer_return(uuid, uuid, integer, text, text, boolean, text) to authenticated;
-- ── The P&L has to see the second unit ──────────────────────────────────────
-- Rewritten wholesale rather than patched in place so the file is the complete
-- definition; the only change is the replacement_cost_mvr term inside `rtn`.

create or replace function get_pnl(p_from date, p_to date)
returns table (revenue_mvr numeric, cogs_mvr numeric, gross_profit_mvr numeric,
  marketing_mvr numeric, other_opex_mvr numeric, stock_writeoff_mvr numeric,
  returns_net_mvr numeric, net_profit_mvr numeric, gross_margin_pct numeric,
  net_margin_pct numeric, opex_by_category jsonb, has_estimated_cost boolean)
language sql
stable
security definer
set search_path = public
as $pnl$
  with
  latest_landed as (
    select distinct on (sku_id) sku_id, landed_per_piece_mvr
    from v_batch_stock where qty_pieces_remaining > 0
    order by sku_id, received_at desc
  ),
  sales as (
    select
      coalesce(sum(sol.line_total_mvr), 0) as revenue,
      coalesce(sum(sol.qty_pieces * coalesce(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0)), 0) as cogs,
      bool_or(sol.landed_cost_per_piece_mvr is null) as est
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    left join latest_landed ll on ll.sku_id = sol.sku_id
    where so.status not in ('draft', 'cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date between p_from and p_to
  ),
  mktg as (
    select coalesce(sum(
      ms.amount_mvr
      * greatest(0, least(coalesce(ms.end_date, (now() at time zone 'Indian/Maldives')::date), p_to) - greatest(ms.start_date, p_from) + 1)::numeric
      / greatest(1, coalesce(ms.end_date, (now() at time zone 'Indian/Maldives')::date) - ms.start_date + 1)::numeric
    ), 0) as spend
    from marketing_spend ms
    where ms.start_date <= p_to and coalesce(ms.end_date, (now() at time zone 'Indian/Maldives')::date) >= p_from
  ),
  opex_total as (
    select coalesce(sum(amount_mvr), 0) as total
    from business_expenses where expense_date between p_from and p_to
  ),
  writeoffs as (
    select coalesce(sum(sm.qty_pieces * coalesce(ib.landed_per_piece_mvr, 0)), 0) as total
    from stock_movements sm
    join inventory_batches ib on ib.id = sm.batch_id
    where sm.movement_type = 'damage_out'
      and (sm.created_at at time zone 'Indian/Maldives')::date between p_from and p_to
  ),
  rtn as (
    select coalesce(sum(
      sr.refund_amount_mvr
      - case when sr.restocked then sr.qty_pieces * coalesce(sr.landed_cost_per_piece_mvr, 0) else 0 end
      -- A replacement refunds nothing, so the line above is zero for it — but a
      -- second unit left the godown and COGS is summed from order lines, which
      -- that unit is not on. Without this the stock falls and the cost never
      -- appears, and every margin on the screen is overstated.
      + coalesce(sr.replacement_cost_mvr, 0)
    ), 0) as total
    from sales_returns sr
    where (sr.created_at at time zone 'Indian/Maldives')::date between p_from and p_to
  ),
  opex_cats as (
    select coalesce(
      jsonb_agg(jsonb_build_object('name', name, 'amount', amount) order by amount desc),
      '[]'::jsonb) as by_category
    from (
      select ec.name, sum(b.amount_mvr) as amount
      from business_expenses b
      join expense_categories ec on ec.id = b.category_id
      where b.expense_date between p_from and p_to
      group by ec.name
    ) x
  )
  select
    s.revenue,
    round(s.cogs, 2),
    round(s.revenue - s.cogs, 2),
    round(m.spend, 2),
    ot.total,
    round(w.total, 2),
    round(rt.total, 2),
    round(s.revenue - s.cogs - m.spend - ot.total - w.total - rt.total, 2),
    case when s.revenue > 0 then round((s.revenue - s.cogs) / s.revenue * 100, 1) else null end,
    case when s.revenue > 0 then round((s.revenue - s.cogs - m.spend - ot.total - w.total - rt.total) / s.revenue * 100, 1) else null end,
    oc.by_category,
    coalesce(s.est, false)
  from sales s, mktg m, opex_total ot, writeoffs w, rtn rt, opex_cats oc;
$pnl$;

revoke execute on function get_pnl(date, date) from public;
revoke execute on function get_pnl(date, date) from anon;
grant  execute on function get_pnl(date, date) to authenticated;

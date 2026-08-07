-- 0154 — a return puts stock back into the batches it actually came out of.
--
-- Found auditing the returns path before Ali's first return. Nothing here has
-- ever run on real data: zero returns have been recorded in production, so
-- every rule in record_customer_return has only ever been reasoned about, not
-- exercised. That made it worth testing rather than trusting.
--
-- THE BUG
--
-- A sale that crosses a batch boundary comes out of two batches under FIFO.
-- The return path picked ONE:
--
--     select sm.batch_id, sm.godown_id into v_batch, v_godown
--     from stock_movements sm
--     where sm.source_id = p_order_id and ...  and sm.movement_type = 'out'
--     order by sm.created_at desc limit 1;
--
-- and then wrote the WHOLE returned quantity back into that single batch.
--
-- Reproduced end-to-end on a clean database. Two batches of 102 pieces, one
-- landed at MVR 10 a piece and one at MVR 20. Sell 5 packs (170 pieces): FIFO
-- takes all 102 cheap, then 68 dear, leaving 0 and 34. Return 136, restocked:
--
--   before   batch@10  received 102  remaining   0
--            batch@20  received 102  remaining  34     stock value MVR   680
--   after    batch@10  received 102  remaining 136  <-- IMPOSSIBLE
--            batch@20  received 102  remaining  34     stock value MVR 2,040
--
-- A batch holding 136 pieces it never received is not a rounding difference,
-- it is a broken ledger. Three things follow from it:
--
--   1. Stock VALUE is wrong. The 136 pieces are valued at whichever batch won
--      the LIMIT 1 — here MVR 10 a piece. Correct is 68 back at 20 and 68 at
--      10, so MVR 2,720 rather than MVR 2,040: understated by MVR 680, a 25%
--      error on this SKU, and it lands in v_batch_stock, the Promo Advisor's
--      cash-to-free figure, and the dashboard's stock value.
--   2. The function CONTRADICTED ITSELF. It returned cost_recovered_mvr =
--      1,904 (136 x the sale's blended cost of 14) while writing 1,360 worth
--      of movements. The receipt and the ledger disagreed by MVR 544.
--   3. Which batch "wins" is arbitrary. Both out-movements are written in the
--      same statement, so `order by created_at desc` is a coin toss between
--      two identical timestamps — the same return could value stock two
--      different ways on two different days.
--
-- Not yet triggered in production only because no sale has yet drawn from two
-- batches (checked: zero). That is a fact about how new the business is, not a
-- safety property — it becomes routine as soon as a second shipment of a
-- moving SKU lands.
--
-- THE FIX
--
-- Put the pieces back where they came from: walk the sale's own out-movements
-- most-recent-first, giving each batch back at most what it actually issued
-- (net of anything already returned to it), until the returned quantity is
-- used up. Reversing the FIFO consumption is the standard treatment — the
-- goods coming back are the ones most recently taken.
--
-- Two consequences are deliberate:
--
--   * `landed_cost_per_piece_mvr` on the return row is now the BLENDED cost of
--     what actually went back, not the sale line's average. get_pnl reverses
--     COGS as qty x that figure, so this is what keeps the P&L reversal equal
--     to the value written to the stock ledger. They disagreed before.
--   * `cost_recovered_mvr` reports the same real number, so the receipt Ali
--     sees and the ledger agree.
--
-- A return that is NOT restocked is unchanged: no movements, and the line's
-- locked cost is kept on the row for reference (get_pnl ignores it, because
-- goods that did not come back do not reverse any cost).
--
-- Everything else — authorisation, the reason/settlement whitelists, the
-- over-return check, the credit-vs-refund guard, the negative payment row and
-- the audit entry — is carried over unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_customer_return(
  p_order_id uuid,
  p_sku_id uuid,
  p_qty_pieces integer,
  p_reason text,
  p_settlement text,
  p_restock boolean DEFAULT true,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_refund   := round(p_qty_pieces * v_price_pc, 2);
  v_cost_pc  := v_line.landed_cost_per_piece_mvr;

  -- The godown the goods left from, for the return row.
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

  -- ── Put the pieces back where they came from ────────────────────────────
  -- Most recently issued batch first (reverse of FIFO consumption), each one
  -- capped at what it still has outstanding from this order.
  if p_restock and v_batch is not null then
    v_left := p_qty_pieces;

    for v_mv in
      -- Ordered by the BATCH's own age, newest first — the exact reverse of
      -- the FIFO that consumed it, so the pieces coming back are the ones
      -- most recently taken.
      --
      -- Deliberately NOT ordered by the movement timestamp. post_sale writes
      -- every out-movement for a sale in one statement, so they share a
      -- created_at to the microsecond and the tiebreak fell to batch_id --
      -- which is random. Measured on the scenario in the header: ordering by
      -- movement time returned 102 pieces to the cheap batch and 34 to the
      -- dear one (stock value MVR 2,380), where reversing FIFO properly
      -- returns 68 to each (MVR 2,720). Same quantity, MVR 340 apart, decided
      -- by a UUID. received_at is stable and means something.
      --
      -- Grouped by godown as well as batch: a batch lives in one godown, and
      -- there is no max() for uuid to collapse it with.
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

    -- The cost that actually came back, per piece. This is what get_pnl
    -- multiplies by qty to reverse COGS, so it must match the ledger.
    if v_put_back > 0 then
      v_cost_pc := round(v_cost_back / v_put_back, 4);
    end if;
  end if;

  insert into sales_returns (order_id, sku_id, godown_id, qty_pieces, refund_amount_mvr,
                             landed_cost_per_piece_mvr, restocked, reason, settlement, notes, created_by)
  values (p_order_id, p_sku_id, v_godown, p_qty_pieces, v_refund, v_cost_pc,
          (v_put_back > 0), p_reason, p_settlement,
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
            || case when v_put_back > 0 then ' — restocked' else ' — NOT restocked' end,
          (select auth.uid()));

  return jsonb_build_object(
    'id', v_id,
    'refund_mvr', v_refund,
    -- The real figure now: what the movements above actually put back.
    'cost_recovered_mvr', round(v_cost_back, 2),
    'restocked', (v_put_back > 0),
    'settlement', p_settlement
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_customer_return(uuid, uuid, integer, text, text, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_customer_return(uuid, uuid, integer, text, text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_customer_return(uuid, uuid, integer, text, text, boolean, text) TO authenticated;

COMMIT;

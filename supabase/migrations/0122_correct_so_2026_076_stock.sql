-- 0122 — One-off correction: SO-2026-076 was delivered with zero stock ever
-- deducted, because of a real UI bug (fixed in the same commit as this
-- migration): components/sales/sale-detail.tsx's `isConfirmed` flag used to
-- include status='draft', so a draft order — created but never successfully
-- run through post_sale() — showed the exact same "ready to dispatch" screen
-- as a genuinely confirmed order, and was walked all the way to 'delivered'
-- with real revenue recognised (line_total_mvr = 220.00 MVR) but stock never
-- deducted and cost never recorded (all 4 lines had
-- landed_cost_per_piece_mvr = NULL, zero stock_movements existed for it).
--
-- Root cause of how it got stuck in draft in the first place: the New Sale
-- flow (components/sales/sales-list.tsx handleSubmit) creates the order and
-- lines, then calls post_sale() as a third step inside the same
-- withOfflineFallback() — if a network error strikes between line creation
-- succeeding and post_sale() completing, the order+lines are already real,
-- permanent rows, but post_sale() never ran. That gap is not closed by this
-- migration (it needs its own fix to the offline-write retry logic, flagged
-- separately) — this migration only corrects the one order it already hit.
--
-- This block performs exactly what post_sale() would have done for this one
-- order: FIFO-deduct each line's stock from the batches in its source
-- godown and snapshot the actual landed cost / margin onto the line. All 4
-- SKUs have ample stock in Veesange (96/138/54/36 pieces vs. 2/1/2/1
-- needed), so nothing here can go negative or fail.
do $$
declare
  v_order_id  uuid := '88c16afa-9567-47d8-ba6a-a5c8c3e46c86';
  v_godown_id uuid;
  v_line      record;
  v_batch     record;
  v_remaining integer;
  v_take      integer;
  v_cost_sum  numeric;
  v_qty_sold  integer;
  v_avg_cost  numeric;
  v_price_per_piece numeric;
  v_margin    numeric;
begin
  select source_godown_id into v_godown_id from sales_orders where id = v_order_id;

  if exists (select 1 from stock_movements where source_id = v_order_id and source_type = 'sales_order') then
    raise exception 'SO-2026-076 already has stock movements — this correction has already run or is no longer needed';
  end if;

  for v_line in
    select id, sku_id, qty_pieces, uom, unit_price_mvr
    from sales_order_lines where order_id = v_order_id
  loop
    v_remaining := v_line.qty_pieces;
    v_cost_sum  := 0;
    v_qty_sold  := 0;

    for v_batch in
      select bs.batch_id, bs.qty_pieces_remaining, bs.received_at, bs.landed_per_piece_mvr
      from v_batch_stock bs
      where bs.sku_id = v_line.sku_id
        and bs.godown_id = v_godown_id
        and bs.qty_pieces_remaining > 0
      order by bs.received_at asc
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_batch.qty_pieces_remaining);
      insert into stock_movements
        (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, notes, created_by)
      values
        (v_batch.batch_id, v_line.sku_id, v_godown_id, 'out',
         v_take, 'sales_order', v_order_id,
         'Retroactive correction (migration 0122) — order was delivered without post_sale() ever running', null);
      v_cost_sum := v_cost_sum + (v_take * coalesce(v_batch.landed_per_piece_mvr, 0));
      v_qty_sold := v_qty_sold + v_take;
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      raise exception 'Insufficient stock for SKU % — correction aborted, investigate manually', v_line.sku_id;
    end if;

    v_avg_cost := case when v_qty_sold > 0 then v_cost_sum / v_qty_sold else null end;

    select
      v_line.unit_price_mvr / case v_line.uom
        when 'carton' then (s.pcs_per_pack * s.packs_per_carton)
        when 'pack'   then s.pcs_per_pack
        else 1
      end
    into v_price_per_piece
    from skus s where s.id = v_line.sku_id;

    v_margin := case
      when v_avg_cost is not null and v_price_per_piece is not null and v_price_per_piece > 0
        then round((1 - v_avg_cost / v_price_per_piece) * 100, 2)
      else null
    end;

    update sales_order_lines
    set landed_cost_per_piece_mvr = v_avg_cost,
        actual_margin_pct         = v_margin
    where id = v_line.id;
  end loop;

  insert into audit_log (table_name, record_id, action, reason, changed_by)
  values ('sales_orders', v_order_id, 'update',
          'Retroactive stock correction (migration 0122): order was marked delivered on 2026-08-03 without post_sale() ever running, due to a UI bug (isConfirmed wrongly included draft status). Stock was deducted FIFO and cost/margin snapshotted here, matching what post_sale() would have recorded at delivery time. No status or payment fields changed — this order was already correctly status=delivered.',
          null);
end $$;

-- Settling a return: money back, less to pay, or send another one.
--
-- Ali, 2026-08-15, describing four situations in one message: "What if customer
-- paid and returned the product and needs a refund and what if the customer
-- paid, returned the product and needs a replacement product. Same to unpaid
-- customers."
--
-- Those four are the whole matrix, and each settles differently:
--
--                    | returned + refund        | returned + replacement
--   -----------------|--------------------------|-------------------------------
--   already PAID     | money goes back          | no money moves, goods go out
--   NOT paid yet     | comes off what they owe  | no money moves, goods go out
--
-- The trap this file exists to hold shut is the bottom-left/right pair. A
-- replacement is NOT a refund of zero: the bill genuinely does not move, but a
-- second physical unit leaves the godown. COGS is summed from sales_order_lines
-- and that unit is on no line, so unless its cost is recorded and subtracted
-- the stock falls while the cost does not — and every margin on the screen is
-- overstated by exactly the thing that went out of the door.
--
-- Companion to customer_returns.test.sql, which covers WHERE returned stock
-- lands (reverse FIFO across batches). This one covers WHAT HAPPENS TO THE
-- MONEY. Separate files because they are separate failures.

begin;
select plan(12);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b0', 'test-settle@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b0', true);

-- One deep batch at a round cost, so every figure below is checkable by hand:
-- 10 MVR a piece, 34 pieces to a pack, so one pack costs exactly MVR 340.
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000000b1', 'SH-TEST-SETTLE',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000005', 10, 0.036, 10, 'USD', '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        now() - interval '5 days', 10, 1020, 10, 340, 1020);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 1020, 'shipment');

-- Four orders, one per box of the matrix. Each is 1 pack at MVR 600.
do $$
declare i int; oid uuid;
begin
  for i in 1..4 loop
    oid := ('00000000-0000-0000-0000-0000000000c' || i)::uuid;
    insert into sales_orders (id, order_number, status, payment_status, channel,
                              source_godown_id, created_at)
    values (oid, 'SO-TEST-SETTLE-' || i, 'draft', 'pending', 'walkin',
            '00000000-0000-0000-0000-000000000006', now());
    insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
    values (oid, '00000000-0000-0000-0000-000000000005', 'pack', 1, 34, 600, 600);
    perform post_sale(oid);
  end loop;
  -- Orders 2 and 3 are PAID in full; 1 and 4 are not.
  insert into order_payments (order_id, amount_mvr, method, paid_at)
  values ('00000000-0000-0000-0000-0000000000c2', 600, 'cash', now()),
         ('00000000-0000-0000-0000-0000000000c3', 600, 'cash', now());
  perform recalculate_order_payment_status('00000000-0000-0000-0000-0000000000c2');
  perform recalculate_order_payment_status('00000000-0000-0000-0000-0000000000c3');
end $$;

-- ── 1. NOT PAID, returned, pack opened so it cannot go back ────────────────
-- This is Ali's own case, SO-2026-117. Nothing to refund because nothing was
-- paid; nothing to restock because the pack was opened.
select lives_ok(
  $$select record_customer_return('00000000-0000-0000-0000-0000000000c1'::uuid,
      '00000000-0000-0000-0000-000000000005'::uuid, 34, 'unwanted', 'credit', false, 'opened')$$,
  'an unpaid return with nothing to put back is recorded'
);

select is(
  (select balance_mvr from v_order_balances where order_id = '00000000-0000-0000-0000-0000000000c1'),
  0::numeric,
  'they owe nothing now — the credit cancelled the bill, and no money changed hands'
);

select is(
  (select count(*)::int from order_payments where order_id = '00000000-0000-0000-0000-0000000000c1'),
  0,
  'and no refund was invented for money that was never paid'
);

select is(
  (select restocked from sales_returns where order_id = '00000000-0000-0000-0000-0000000000c1'),
  false,
  'the opened pack did NOT go back into sellable stock'
);

-- ── 2. PAID, returned, good enough to sell again, money back ───────────────
select lives_ok(
  $$select record_customer_return('00000000-0000-0000-0000-0000000000c2'::uuid,
      '00000000-0000-0000-0000-000000000005'::uuid, 34, 'unwanted', 'refund', true, null)$$,
  'a paid customer can be refunded'
);

select is(
  (select round(sum(amount_mvr), 2) from order_payments where order_id = '00000000-0000-0000-0000-0000000000c2'),
  0::numeric,
  'the money is handed back as a reversing payment, netting the order to zero'
);

-- ── 3. PAID, returned, send another one ────────────────────────────────────
select lives_ok(
  $$select record_customer_return('00000000-0000-0000-0000-0000000000c3'::uuid,
      '00000000-0000-0000-0000-000000000005'::uuid, 34, 'defective', 'replace', false, null)$$,
  'a paid customer can be sent a replacement instead'
);

select is(
  (select round(sum(amount_mvr), 2) from order_payments where order_id = '00000000-0000-0000-0000-0000000000c3'),
  600::numeric,
  'they are not refunded — they keep what they paid, because they get the goods'
);

-- 34 pieces at MVR 10. The whole point: this cost exists nowhere else.
select is(
  (select replacement_cost_mvr from sales_returns where order_id = '00000000-0000-0000-0000-0000000000c3'),
  340.00::numeric,
  'the replacement''s cost is recorded, so the P&L can see the unit that left'
);

-- Sold 34, returned 34 but binned it, sent 34 more: 68 pieces gone for one sale.
select is(
  (select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)), 0)::int
     from stock_movements
    where sku_id = '00000000-0000-0000-0000-000000000005'
      and source_id = '00000000-0000-0000-0000-0000000000c3'),
  -68,
  'two packs left the godown for one sale — replacing a binned pack costs it twice'
);

-- ── 4. The guards ──────────────────────────────────────────────────────────
-- Refunding someone who never paid would write a negative payment against an
-- unsettled bill and leave them still owing, with a phantom refund beside it.
select throws_ok(
  $$select record_customer_return('00000000-0000-0000-0000-0000000000c4'::uuid,
      '00000000-0000-0000-0000-000000000005'::uuid, 34, 'unwanted', 'refund', true, null)$$,
  'P0001',
  null,
  'money cannot be handed back to a customer who never paid'
);

-- A replacement has to come out of real stock (hard rule 2). Emptying the
-- godown first proves the refusal is about stock and not about the settlement.
select throws_ok(
  $$do $inner$
    declare v_left int;
    begin
      select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)), 0) into v_left
        from stock_movements where sku_id = '00000000-0000-0000-0000-000000000005'
         and godown_id = '00000000-0000-0000-0000-000000000006';
      insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
      values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000005',
              '00000000-0000-0000-0000-000000000006', 'damage_out', v_left, 'damage');
      perform record_customer_return('00000000-0000-0000-0000-0000000000c4'::uuid,
        '00000000-0000-0000-0000-000000000005'::uuid, 34, 'unwanted', 'replace', false, null);
    end $inner$;$$,
  'P0001',
  null,
  'a replacement cannot be sent from stock that is not there'
);

select * from finish();
rollback;

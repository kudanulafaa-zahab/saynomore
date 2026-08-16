-- "Paid in full" above "Paid MVR 0 of MVR 207".
--
-- Ali photographed those two lines sitting on top of each other on SO-2026-117
-- and said: *"This is very wrong and confusing."* The customer rejected 1 pack
-- of nappies at the door, never paid a rufiyaa, and the app awarded him a green
-- tick for money he never received.
--
-- Everything underneath was right — the balance, the stock decision, the P&L.
-- What was wrong was the WORD, and the word is load-bearing in three places:
--
--   the label   a return is not a receipt, and calling it one makes "how much
--               did we collect this month" unanswerable
--   the buttons void and delete both refused with "payment already settled" on
--               an order nobody had paid, so the Void button on his screen was
--               dead and its reason was false
--   the filter  three functions each had their own idea of "unpaid", so the
--               unpaid list and the unpaid COUNT beside it disagreed
--
-- So this file is about vocabulary, and every check is a sentence the app is
-- allowed — or not allowed — to say about money.

begin;
select plan(16);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e0', 'test-settled@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000e0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e0', true);

-- One deep batch at MVR 10 a piece, 34 pieces to a pack — the same shape as the
-- real order: 1 pack of Xtra Kering XXL.
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000000e1', 'SH-TEST-SETTLED',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-000000000005', 20, 0.036, 10, 'USD', '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e2',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        now() - interval '5 days', 20, 2040, 10, 340, 1020);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 2040, 'shipment');

-- Five orders, 1 pack at MVR 600 each, all confirmed and dispatched.
--   d1  rejected at the door, never paid          -> the real case
--   d2  paid in full, nothing returned            -> the control
--   d3  paid in full, returned, money handed back
--   d4  paid in full, returned, money KEPT as credit
--   d5  never paid, nothing returned              -> still owes
do $$
declare i int; oid uuid;
begin
  for i in 1..5 loop
    oid := ('00000000-0000-0000-0000-0000000000d' || i)::uuid;
    insert into sales_orders (id, order_number, status, payment_status, channel,
                              source_godown_id, created_at)
    values (oid, 'SO-TEST-SETTLED-' || i, 'draft', 'pending', 'walkin',
            '00000000-0000-0000-0000-000000000006', now() - interval '3 days');
    insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
    values (oid, '00000000-0000-0000-0000-000000000005', 'pack', 1, 34, 600, 600);
    perform post_sale(oid);
    update sales_orders set status = 'out_for_delivery' where id = oid;
  end loop;

  insert into order_payments (order_id, amount_mvr, method, paid_at)
  values ('00000000-0000-0000-0000-0000000000d2', 600, 'cash', now()),
         ('00000000-0000-0000-0000-0000000000d3', 600, 'cash', now()),
         ('00000000-0000-0000-0000-0000000000d4', 600, 'cash', now());
end $$;

-- ── The word ───────────────────────────────────────────────────────────────

select is(
  (select payment_status from sales_orders where id = '00000000-0000-0000-0000-0000000000d2'),
  'paid',
  'money that actually arrived is called PAID'
);

select lives_ok(
  $$select record_customer_return('00000000-0000-0000-0000-0000000000d1'::uuid,
      '00000000-0000-0000-0000-000000000005'::uuid, 34, 'defective', 'credit', false, 'opened at the door')$$,
  'the rejected pack is recorded as a return with nothing to refund'
);

-- THE CHECK THIS FILE EXISTS FOR.
select is(
  (select payment_status from sales_orders where id = '00000000-0000-0000-0000-0000000000d1'),
  'settled',
  'an order closed by goods coming back is SETTLED, never "paid" — nobody paid it'
);

select is(
  (select balance_mvr from v_order_balances where order_id = '00000000-0000-0000-0000-0000000000d1'),
  0::numeric,
  'and there is nothing left to collect on it, which was always true'
);

-- Paid, then the goods came back and the money went with them: the refund is a
-- reversing payment, so the ledger nets to zero and the invoice is closed by
-- the return, not by a receipt.
select lives_ok(
  $$select record_customer_return('00000000-0000-0000-0000-0000000000d3'::uuid,
      '00000000-0000-0000-0000-000000000005'::uuid, 34, 'unwanted', 'refund', true, null)$$,
  'a paid customer can be refunded'
);

select is(
  (select payment_status from sales_orders where id = '00000000-0000-0000-0000-0000000000d3'),
  'settled',
  'a refunded order is settled too — the money it once had went back out'
);

-- A fully paid order cannot be settled by taking it off the bill, because
-- there is no bill left to take it off. 0182 refuses it and names the way out.
-- Worth pinning: it is the guard that stops "credit" quietly meaning two
-- different things depending on whether money had arrived.
select throws_like(
  $$select record_customer_return('00000000-0000-0000-0000-0000000000d4'::uuid,
      '00000000-0000-0000-0000-000000000005'::uuid, 34, 'unwanted', 'credit', true, null)$$,
  '%money-back refund instead%',
  'a return cannot come off a bill that is already paid — that is a refund'
);

-- The one state that really does mean money owed BACK, and the branch this
-- migration deliberately did not touch: more came in than the order was worth.
do $$
begin
  insert into order_payments (order_id, amount_mvr, method, paid_at)
  values ('00000000-0000-0000-0000-0000000000d4', 100, 'cash', now());
end $$;

select is(
  (select payment_status from sales_orders where id = '00000000-0000-0000-0000-0000000000d4'),
  'credit',
  'and paying MORE than the order is worth is still money owed back, not a settled bill'
);

-- ── It cannot go stale ─────────────────────────────────────────────────────
-- record_customer_return recalculated the flag by hand; nothing else did. A
-- derived value with one hand-written updater is a value that will be wrong one
-- day, so the trigger is proven here rather than assumed.
select is(
  (select count(*)::int from pg_trigger
    where not tgisinternal and tgrelid = 'sales_returns'::regclass
      and tgname = 'trg_sync_order_payment_status'),
  1,
  'the returns ledger keeps the flag current by itself'
);

-- ── The buttons on his screen ──────────────────────────────────────────────
-- Both of these refused with "payment already settled" on an order nobody had
-- paid. The refusal is now about STOCK and it is true: the sale was already
-- undone by the return, and voiding would put the pack back on the shelf a
-- second time.
select throws_like(
  $$select void_sales_order('00000000-0000-0000-0000-0000000000d1'::uuid, 'customer changed mind')$$,
  '%return recorded against it%',
  'voiding an order that was already returned is refused, for the real reason'
);

select throws_like(
  $$select delete_sales_order('00000000-0000-0000-0000-0000000000d1'::uuid, 'tidy up')$$,
  '%return recorded against it%',
  'and so is deleting it — that would erase the return and the stock decision'
);

-- The other half: an ordinary unpaid order is still voidable. The old flag
-- check was the only thing that could have stopped this one, and it is gone.
select lives_ok(
  $$select void_sales_order('00000000-0000-0000-0000-0000000000d5'::uuid, 'entered twice')$$,
  'an unpaid order with no return can still be voided'
);

-- ── The trip is over ───────────────────────────────────────────────────────
-- The real order sat on the dispatch board as still out for delivery for two
-- days after the goods were back in the godown. That is why he went and marked
-- it delivered by hand, and that hand-action is what produced the screen he
-- photographed.
select is(
  (select status from sales_orders where id = '00000000-0000-0000-0000-0000000000d1'),
  'delivered',
  'an order whose every item came back closes itself — he should not have to'
);

-- Half a return is not a finished trip: the rest is still owed and still out.
do $$
declare oid uuid := '00000000-0000-0000-0000-0000000000d6';
begin
  insert into sales_orders (id, order_number, status, payment_status, channel, source_godown_id, created_at)
  values (oid, 'SO-TEST-SETTLED-6', 'draft', 'pending', 'walkin',
          '00000000-0000-0000-0000-000000000006', now() - interval '3 days');
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (oid, '00000000-0000-0000-0000-000000000005', 'pack', 2, 68, 600, 1200);
  perform post_sale(oid);
  update sales_orders set status = 'out_for_delivery' where id = oid;
  perform record_customer_return(oid, '00000000-0000-0000-0000-000000000005'::uuid,
                                 34, 'defective', 'credit', false, 'one of the two');
end $$;

select is(
  (select status from sales_orders where id = '00000000-0000-0000-0000-0000000000d6'),
  'out_for_delivery',
  'but a partial return leaves the order exactly where it was'
);

select is(
  (select payment_status from sales_orders where id = '00000000-0000-0000-0000-0000000000d6'),
  'partial',
  'and half settled is partial, not settled'
);

-- ── One definition of "unpaid" ─────────────────────────────────────────────
-- The list said `payment_status in ('pending','partial')` and the count beside
-- it said `not in ('paid','deposited')`, so 'cod' and 'credit' orders were
-- counted and then not shown. Both now ask the ledger.
select is(
  (select get_sales_orders_count(null, null, true, null))::int,
  (select count(*)::int from get_sales_orders(
     p_status => null, p_search => null, p_unpaid => true,
     p_customer_id => null, p_limit => 500)),
  'the unpaid list and the number printed above it are the same set of orders'
);

select * from finish();
rollback;

-- Pass 9: editing a confirmed order line cannot break the ledger.
-- Regression guard for migration 0156.
--
-- Found by continuing the audit that produced 0154. The returns bug lived in a
-- money path that had never been tested AND never been used in production, so
-- every function that mutates stock or money was listed and checked against
-- both. 10 of 15 had no test; exactly two of those had also never run in
-- production. edit_sales_order_line was one, and it had three bugs.
--
-- All three were reproduced end to end before the fix was written:
--
--   1. Reducing a line below what a customer had already returned INVENTED
--      STOCK. Sold 170, returned 136, edit down to 34 -> 1,122 pieces on hand
--      against 1,020 ever received, and a customer recorded as returning 136
--      of a 34-piece purchase. The edit rewrites the 'out' movements and
--      leaves the 'return_in' ones.
--   2. A quantity that was not a whole number of packs crashed with a raw
--      "violates check constraint sol_line_total_matches" — the line total was
--      computed from the unrounded quantity while qty stores 3 decimals, so
--      MVR 2,058.82 was charged for a quantity recorded as worth 2,058.70.
--   3. A fully paid order that was edited kept payment_status 'paid'. Double
--      the line and MVR 3,500 of new debt was invisible on the orders list.
--
-- The fixture is one order of 5 packs (170 pieces) at MVR 700 a pack, from a
-- single 1,020-piece batch, so every number below is checkable by hand.

begin;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c0', 'test-edit@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c0', true);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000000c1', 'SH-TEST-EDIT',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-000000000005', 10, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        now() - interval '5 days', 10, 1020, 10, 340, 1020);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 1020, 'shipment');

insert into sales_orders (id, order_number, status, payment_status, channel,
                          source_godown_id, created_at)
values ('00000000-0000-0000-0000-0000000000c4', 'SO-TEST-EDIT', 'draft', 'pending',
        'walkin', '00000000-0000-0000-0000-000000000006', now());
insert into sales_order_lines (id, order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000c4',
        '00000000-0000-0000-0000-000000000005', 'pack', 5, 170, 700, 3500);
select post_sale('00000000-0000-0000-0000-0000000000c4');

-- ── A normal edit still works ─────────────────────────────────────────────
select lives_ok(
  $$select edit_sales_order_line('00000000-0000-0000-0000-0000000000c5', 204, 700)$$,
  'a whole number of packs (6) is accepted'
);

select is(
  (select qty_pieces from sales_order_lines where id = '00000000-0000-0000-0000-0000000000c5'),
  204,
  'the line carries the new quantity'
);

select is(
  (select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)), 0)::numeric
     from stock_movements where sku_id = '00000000-0000-0000-0000-000000000005'),
  816::numeric,
  'stock is 1,020 less the 204 now sold -- the old deduction was replaced, not stacked on top'
);

-- The invariant the check constraint enforces, asserted directly so a future
-- change that recomputes the total from an unrounded quantity fails here with
-- a readable message rather than as a constraint violation somewhere else.
select is(
  (select round(abs(line_total_mvr - qty * unit_price_mvr), 2)
     from sales_order_lines where id = '00000000-0000-0000-0000-0000000000c5'),
  0.00::numeric,
  'the line total is exactly the STORED quantity times the price -- no rounding drift'
);

-- ── Whole selling units only ──────────────────────────────────────────────
-- The business sells packs and cartons, never 2.94 of one. Before 0156 this
-- surfaced as a raw check-constraint violation.
select throws_ok(
  $$select edit_sales_order_line('00000000-0000-0000-0000-0000000000c5', 100, 700)$$,
  'This line is sold by the pack of 34. Choose a whole number of packs — 2 or 3, not 2.94.',
  'a quantity that is not a whole number of packs is refused, in packs, with the two nearest answers'
);

-- ── Money owed is recalculated ────────────────────────────────────────────
select record_order_payment('00000000-0000-0000-0000-0000000000c4', 4200, 'cash', null, null, null);

select is(
  (select payment_status from sales_orders where id = '00000000-0000-0000-0000-0000000000c4'),
  'paid',
  'paying MVR 4,200 against 6 packs at 700 settles the order'
);

select lives_ok(
  $$select edit_sales_order_line('00000000-0000-0000-0000-0000000000c5', 340, 700)$$,
  'the line is then doubled to 10 packs'
);

select is(
  (select payment_status from sales_orders where id = '00000000-0000-0000-0000-0000000000c4'),
  'partial',
  'and the order stops claiming to be paid -- before 0156 it stayed "paid" and the new debt was invisible'
);

select is(
  (select balance_mvr from v_order_balances where order_id = '00000000-0000-0000-0000-0000000000c4'),
  2800.00::numeric,
  'MVR 2,800 is now owed -- 10 packs at 700 less the 4,200 already paid'
);

-- ── Never below what has already come back ────────────────────────────────
-- THE bug. The edit rewrites this line's 'out' movements but leaves the
-- 'return_in' rows, so reducing below the returned quantity created stock
-- that was never received: 1,122 on hand against 1,020 received.
select record_customer_return('00000000-0000-0000-0000-0000000000c4',
  '00000000-0000-0000-0000-000000000005', 136, 'unwanted', 'credit', true, null);

select throws_ok(
  $$select edit_sales_order_line('00000000-0000-0000-0000-0000000000c5', 34, 700)$$,
  '4.00 packs have already been returned on this line — it cannot be reduced to 1.00 packs. Void the return first.',
  'reducing a line below what the customer already sent back is refused -- it used to invent 102 pieces of stock'
);

select * from finish();
rollback;

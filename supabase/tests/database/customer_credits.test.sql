-- Pass 13: money owed BACK to a customer is visible.
-- Regression guard for migration 0161.
--
-- Flagged when 0156 fixed the order-line edit and left for its own change.
-- Shrink a paid order and the customer has paid more than they now owe.
-- v_order_balances said so correctly; nothing else did:
--
--   * payment_status had no value for it — the allowed set was
--     pending/partial/paid/cod/deposited, and "paid + returned >= total"
--     collapsed an overpayment to 'paid'. An order the customer was owed
--     MVR 2,800 on read as settled.
--   * get_receivables_aging filters to outstanding > 0.005, so the one report
--     about who owes what dropped it.
--
-- A hidden credit is a customer who paid twice and was never told, or a
-- refund that never went out.
--
-- Fixture: 5 packs at MVR 700 = MVR 3,500, paid in full, then the line is cut
-- to 1 pack. The customer is owed 3,500 - 700 = MVR 2,800.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000190', 'test-credit@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000190';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000190', true);

insert into customers (id, name, phone, price_tier)
values ('00000000-0000-0000-0000-000000000191', 'Overpaid Customer', '7200001', 'retail');

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000192', 'SH-TEST-CREDIT',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-000000000193', '00000000-0000-0000-0000-000000000192',
        '00000000-0000-0000-0000-000000000005', 10, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000194', '00000000-0000-0000-0000-000000000193',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        now() - interval '5 days', 10, 1020, 10, 340, 1020);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-000000000194', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 1020, 'shipment');

insert into sales_orders (id, order_number, status, payment_status, channel, customer_id,
                          source_godown_id, created_at)
values ('00000000-0000-0000-0000-000000000195', 'SO-TEST-CREDIT', 'draft', 'pending',
        'walkin', '00000000-0000-0000-0000-000000000191',
        '00000000-0000-0000-0000-000000000006', now() - interval '3 days');
insert into sales_order_lines (id, order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-000000000196', '00000000-0000-0000-0000-000000000195',
        '00000000-0000-0000-0000-000000000005', 'pack', 5, 170, 700, 3500);
select post_sale('00000000-0000-0000-0000-000000000195');
select record_order_payment('00000000-0000-0000-0000-000000000195', 3500, 'cash', null, null, null);

select is(
  (select payment_status from sales_orders where id = '00000000-0000-0000-0000-000000000195'),
  'paid',
  'MVR 3,500 against a MVR 3,500 order settles it'
);

select is_empty(
  $$select order_number from get_customer_credits()$$,
  'and nobody is owed anything yet'
);

-- ── Shrink the order ──────────────────────────────────────────────────────
select edit_sales_order_line('00000000-0000-0000-0000-000000000196', 34, 700);

select is(
  (select balance_mvr from v_order_balances where order_id = '00000000-0000-0000-0000-000000000195'),
  -2800.00::numeric,
  'the balance goes negative -- the view always knew this'
);

select is(
  (select payment_status from sales_orders where id = '00000000-0000-0000-0000-000000000195'),
  'credit',
  'and the order now says so -- it used to keep claiming "paid" while 2,800 was owed back'
);

select is(
  (select count(*) from get_customer_credits()),
  1::bigint,
  'the credit is reported'
);

select is(
  (select credit_mvr from get_customer_credits()),
  2800.00::numeric,
  'for MVR 2,800 -- the 3,500 paid less the 700 the order is now worth'
);

select is(
  (select customer_name from get_customer_credits()),
  'Overpaid Customer',
  'against the customer who is owed it'
);

-- Aging answers "who owes me" and must not be polluted by "who do I owe":
-- folding a negative into a bucket would quietly reduce the overdue total,
-- since the briefing sums outstanding where bucket <> 'current'.
select is_empty(
  $$select customer_name from get_receivables_aging()
     where customer_name = 'Overpaid Customer'$$,
  'and it does NOT appear in the receivables aging -- that report answers a different question'
);

-- ── Paying it back clears it ──────────────────────────────────────────────
select record_order_payment('00000000-0000-0000-0000-000000000195', -2800, 'cash', null, null, 'refund of overpayment');

select is(
  (select payment_status from sales_orders where id = '00000000-0000-0000-0000-000000000195'),
  'paid',
  'refunding the 2,800 settles the order again'
);

select * from finish();
rollback;

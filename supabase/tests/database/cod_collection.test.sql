-- Pass 10: COD cash is checked against the invoice.
-- Regression guard for migration 0157.
--
-- Third pass of the audit that produced 0154 and 0156. The shortlist was every
-- function that mutates stock or money with NEITHER a test NOR any production
-- use; record_cod_collection was the last entry on it.
--
-- The bug: nothing compared the cash to the order. Recording MVR 10,000
-- collected on a MVR 3,500 order was accepted silently, leaving a balance of
-- -6,500 that surfaces nowhere — get_receivables_aging filters to outstanding
-- > 0, so negative balances are invisible, and 'cod' is not a status any
-- screen treats as a problem. A driver typing 10000 for 1000 is an ordinary
-- mis-key.
--
-- Also covered here: the paths that already worked, so they keep working.
-- Collecting the full amount and marking delivered, and correcting a
-- previously recorded figure downwards, which writes a reversing entry rather
-- than stacking a second payment on top.
--
-- One order, 5 packs at MVR 700 = MVR 3,500, so every figure is checkable.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d0', 'test-cod@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000d0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d0', true);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000000d1', 'SH-TEST-COD',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-000000000005', 10, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d2',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        now() - interval '5 days', 10, 1020, 10, 340, 1020);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 1020, 'shipment');

insert into sales_orders (id, order_number, status, payment_status, channel,
                          source_godown_id, created_at)
values ('00000000-0000-0000-0000-0000000000d4', 'SO-TEST-COD', 'draft', 'cod',
        'walkin', '00000000-0000-0000-0000-000000000006', now());
insert into sales_order_lines (id, order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000d4',
        '00000000-0000-0000-0000-000000000005', 'pack', 5, 170, 700, 3500);
select post_sale('00000000-0000-0000-0000-0000000000d4');

-- ── THE bug: cash cannot exceed the invoice ───────────────────────────────
select throws_ok(
  $$select record_cod_collection('00000000-0000-0000-0000-0000000000d4', 10000, false, true, null)$$,
  'This order is MVR 3,500.00, but MVR 10,000.00 was entered as collected. Check the amount — the extra MVR 6,500.00 has nowhere to go.',
  'a driver cannot record collecting more than the order is worth -- it used to be accepted silently, leaving an invisible -6,500 balance'
);

select is(
  (select coalesce(sum(amount_mvr), 0) from order_payments
    where order_id = '00000000-0000-0000-0000-0000000000d4'),
  0::numeric,
  'and the refused call recorded no money at all'
);

-- Collecting LESS is ordinary trade and stays allowed — part payment on
-- delivery happens, and the balance is already visible.
select lives_ok(
  $$select record_cod_collection('00000000-0000-0000-0000-0000000000d4', 2000, false, false, 'part payment')$$,
  'collecting LESS than the invoice is still allowed -- part payment on delivery is normal'
);

select is(
  (select balance_mvr from v_order_balances where order_id = '00000000-0000-0000-0000-0000000000d4'),
  1500.00::numeric,
  'and MVR 1,500 remains owed'
);

-- ── The correction path (already worked; locked in) ───────────────────────
-- Recording a smaller figure afterwards must write a REVERSING entry, not
-- stack a second payment, so the payments net to the corrected amount.
select lives_ok(
  $$select record_cod_collection('00000000-0000-0000-0000-0000000000d4', 3500, false, true, null)$$,
  'the driver then collects the rest'
);

select is(
  (select coalesce(sum(amount_mvr), 0) from order_payments
    where order_id = '00000000-0000-0000-0000-0000000000d4'),
  3500.00::numeric,
  'payments total the full 3,500 -- the second call topped up rather than double-counting'
);

select lives_ok(
  $$select record_cod_collection('00000000-0000-0000-0000-0000000000d4', 3000, false, false, 'miscounted')$$,
  'a correction downwards to 3,000 is accepted'
);

select is(
  (select coalesce(sum(amount_mvr), 0) from order_payments
    where order_id = '00000000-0000-0000-0000-0000000000d4'),
  3000.00::numeric,
  'and the payments net to 3,000 via a reversing entry, not 6,500 stacked up'
);

-- ── Banking the cash agrees with itself ───────────────────────────────────
-- Two screens read payment_status to decide whether cash is banked, so
-- setting only cash_deposited_at banked it in one place and not the other.
select record_cod_collection('00000000-0000-0000-0000-0000000000d4', 3000, true, false, null);

select ok(
  (select cash_deposited_at is not null and payment_status = 'deposited'
     from sales_orders where id = '00000000-0000-0000-0000-0000000000d4'),
  'marking the cash deposited sets BOTH the timestamp and the status -- they used to disagree'
);

select * from finish();
rollback;

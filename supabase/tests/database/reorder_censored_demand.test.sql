-- Pass 8: demand is measured over the days you could actually sell.
-- Regression guard for migration 0155.
--
-- The reorder engine measured the selling rate as units in the last 30 days
-- divided by 30 CALENDAR days, whether or not there was anything on the
-- shelf. So a product out of stock for half the month looked like it sold
-- half as fast — it got re-ordered short, ran out sooner, and the next
-- measurement was lower still. Running out was self-reinforcing, and it
-- punished the fastest sellers hardest.
--
-- Measured on production before the fix: Xtra Kering L in stock 15 of 30
-- days, true rate 1.00 packs/day, measured 0.50 — understated 2x, and the
-- suggested order went from 9 cartons to 19 once corrected.
--
-- Two SKUs here, built to isolate exactly that. They sell the SAME quantity
-- in the same 30-day window, from the same starting stock, at the same price.
-- The only difference is that one of them RAN OUT half way through:
--
--   STEADY  sells 2 a day for 30 days from 120 on hand, never empty -> 60
--   SPIKY   sells 4 a day for 15 days from 60 on hand, then empty  -> 60
--
-- Under the calendar rate both read 2 pieces a day and order identically,
-- which is the bug: SPIKY demonstrably sells twice as fast whenever it is
-- available. Corrected, SPIKY's rate is 4 and its order is larger.

begin;
select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b0', 'test-reorder@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b0', true);

-- Two SKUs on the same variant, 1 piece per pack so quantities read directly.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000004',
        'TEST-STEADY-1x10', 1, 10, 40, 30, 30, 100, array['pack','carton']),
       ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000004',
        'TEST-SPIKY-1x10',  1, 10, 40, 30, 30, 100, array['pack','carton']);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000000b3', 'SH-TEST-REORDER',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000b3',
        '00000000-0000-0000-0000-0000000000b1', 12, 0.036, 10, 'USD', '00000000-0000-0000-0000-000000000006'),
       ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000b3',
        '00000000-0000-0000-0000-0000000000b2', 6, 0.036, 10, 'USD', '00000000-0000-0000-0000-000000000006');

-- Same 60 pieces sold by each. STEADY is given headroom (120 on hand) so it
-- is genuinely never empty -- a control that runs dry on the last day is not
-- a control.
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000b4',
        '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000006',
        now() - interval '31 days', 12, 120, 10, 10, 100),
       ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b5',
        '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000006',
        now() - interval '31 days', 6, 60, 10, 10, 100);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
values ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000006', 'in', 120, 'shipment', now() - interval '31 days'),
       ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b2',
        '00000000-0000-0000-0000-000000000006', 'in', 60, 'shipment', now() - interval '31 days');

-- One order per SKU, so the lines are legal; the DAILY shape that matters is
-- carried by the stock movements below, which are what the rate is read from.
insert into sales_orders (id, order_number, status, payment_status, channel,
                          source_godown_id, created_at)
values ('00000000-0000-0000-0000-0000000000b8', 'SO-TEST-STEADY', 'confirmed', 'pending',
        'walkin', '00000000-0000-0000-0000-000000000006', now() - interval '15 days'),
       ('00000000-0000-0000-0000-0000000000b9', 'SO-TEST-SPIKY', 'confirmed', 'pending',
        'walkin', '00000000-0000-0000-0000-000000000006', now() - interval '23 days');
insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000b1',
        'pack', 60, 60, 100, 6000),
       ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000b2',
        'pack', 60, 60, 100, 6000);

-- STEADY: 2 a day across the whole 30 days — never empty until the last day.
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces,
                             source_type, source_id, created_at)
select '00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000b1',
       '00000000-0000-0000-0000-000000000006', 'out', 2, 'sales_order',
       '00000000-0000-0000-0000-0000000000b8', now() - (g || ' days')::interval
from generate_series(1, 30) g;

-- SPIKY: 4 a day for the FIRST 15 of those days, then nothing on the shelf.
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces,
                             source_type, source_id, created_at)
select '00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b2',
       '00000000-0000-0000-0000-000000000006', 'out', 4, 'sales_order',
       '00000000-0000-0000-0000-0000000000b9', now() - (g || ' days')::interval
from generate_series(16, 30) g;

-- ── The fixture really is symmetric ───────────────────────────────────────
select is(
  (select sold_90d from get_sku_reorder_alerts() where sku_id = '00000000-0000-0000-0000-0000000000b1'),
  (select sold_90d from get_sku_reorder_alerts() where sku_id = '00000000-0000-0000-0000-0000000000b2'),
  'both SKUs sold exactly the same number of pieces -- any difference below is about AVAILABILITY, not volume'
);

select is(
  (select stock_pieces from get_sku_reorder_alerts() where sku_id = '00000000-0000-0000-0000-0000000000b2'),
  0::numeric,
  'the spiky SKU is empty -- it sold out half way through the window'
);

-- ── Availability is detected ──────────────────────────────────────────────
select is(
  (select demand_censored from get_sku_reorder_alerts() where sku_id = '00000000-0000-0000-0000-0000000000b1'),
  false,
  'a SKU that was never empty is not treated as censored'
);

select ok(
  (select days_unavailable_30 >= 10 from get_sku_reorder_alerts()
    where sku_id = '00000000-0000-0000-0000-0000000000b2'),
  'the spiky SKU is counted as unavailable for most of the second half of the month'
);

select is(
  (select demand_censored from get_sku_reorder_alerts() where sku_id = '00000000-0000-0000-0000-0000000000b2'),
  true,
  'and its rate is measured over the days it was actually on the shelf'
);

-- ── The rate, and therefore the order ─────────────────────────────────────
-- This is the whole point: identical sales, but one of them demonstrably
-- sells twice as fast whenever it is available.
select ok(
  (select b.daily_avg_pieces > a.daily_avg_pieces * 1.5
     from get_sku_reorder_alerts() a, get_sku_reorder_alerts() b
    where a.sku_id = '00000000-0000-0000-0000-0000000000b1'
      and b.sku_id = '00000000-0000-0000-0000-0000000000b2'),
  'the spiky SKU is rated at least 1.5x faster than the steady one -- on the calendar rate they were identical'
);

-- Exact rate, because "bigger than the other one" is not a real assertion
-- here: the spiky SKU is empty and the steady one is not, so its suggestion is
-- larger even with the bug in place. Verified by mutation -- a >-comparison
-- passed while the calendar rate was reinstated. The number has to be pinned.
--
-- The spiky SKU sells 4 a day on each of the 14 in-window days it has stock:
-- 56 pieces / 14 days = exactly 4.0. The calendar rate reports 56/30 = 1.87.
select is(
  (select daily_avg_recent from get_sku_reorder_alerts()
    where sku_id = '00000000-0000-0000-0000-0000000000b2'),
  4.0::numeric,
  'the spiky SKU is rated at 4 pieces a day -- what it actually sells when it has stock, not the 1.87 the calendar reports'
);

-- And that carries into the order. 4/day over 70 days of cover from zero
-- stock is ~28 cartons; the calendar rate produces 14. A threshold the bug
-- cannot reach, rather than a comparison it can satisfy by accident.
select ok(
  (select suggested_cartons >= 25 from get_reorder_suggestions()
    where sku_id = '00000000-0000-0000-0000-0000000000b2'),
  'so the next order covers the real rate -- the death spiral (run out, order less, run out sooner) is broken'
);

select * from finish();
rollback;

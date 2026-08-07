-- Pass 7: returns put stock back where it came from.
-- Regression guard for migration 0154.
--
-- Written because NOTHING here had ever run. Production has recorded zero
-- customer returns, so every rule in record_customer_return had only been
-- reasoned about. The existing returns assertions in money_rules.test.sql
-- insert a sales_returns row DIRECTLY — they exercise v_order_balances, not
-- the function, and the scenario they encode is not even one the function can
-- produce (it omits the reversing payment row a 'refund' settlement writes).
-- So the function itself was untested from both directions.
--
-- Testing it found a real bug. A sale crossing a batch boundary comes out of
-- two batches under FIFO; the return path picked ONE with `limit 1` and wrote
-- the whole quantity back into it, leaving a batch holding more pieces than it
-- ever received, and valuing the returned goods at whichever batch won.
--
-- The fixture is built to make that visible rather than plausible: two batches
-- of the same SKU at deliberately far-apart costs (MVR 10 and MVR 20 a piece),
-- a sale that must span both, and a return big enough to cross back over the
-- boundary. Any single-batch shortcut shows up as a wrong number, not a
-- rounding difference.
--
--   stock       batch A  102 pieces @ 10   received 20 days ago
--               batch B  102 pieces @ 20   received 10 days ago
--   sale        5 packs = 170 pieces -> FIFO takes 102 from A, 68 from B
--   left        A 0, B 34                          stock value MVR   680
--   return      136 pieces, restocked
--   correct     B back to 102 (all it issued), A to 68
--                                                  stock value MVR 2,720

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a0', 'test-returns@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a0', true);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000000a1', 'SH-TEST-RETURNS',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-000000000005', 1, 0.036, 10, 'USD', '00000000-0000-0000-0000-000000000006'),
       ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-000000000005', 1, 0.036, 10, 'USD', '00000000-0000-0000-0000-000000000006');

insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        now() - interval '20 days', 1, 102, 10, 340, 1020),
       ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a3',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        now() - interval '10 days', 1, 102, 20, 680, 2040);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 102, 'shipment'),
       ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 102, 'shipment');

insert into sales_orders (id, order_number, status, payment_status, channel,
                          source_godown_id, created_at)
values ('00000000-0000-0000-0000-0000000000a6', 'SO-TEST-RETURNS', 'draft', 'pending',
        'walkin', '00000000-0000-0000-0000-000000000006', now());
insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000005',
        'pack', 5, 170, 600, 3000);
select post_sale('00000000-0000-0000-0000-0000000000a6');

select is(
  (select qty_pieces_remaining from v_batch_stock where batch_id = '00000000-0000-0000-0000-0000000000a4'),
  0,
  'FIFO empties the older batch first -- the fixture really does span two batches'
);

-- ── The return ────────────────────────────────────────────────────────────
select lives_ok(
  $$select record_customer_return('00000000-0000-0000-0000-0000000000a6',
      '00000000-0000-0000-0000-000000000005', 136, 'unwanted', 'credit', true, null)$$,
  'a 136-piece return across a batch boundary is accepted'
);

-- THE bug. A batch cannot hold more than it was ever given; before 0154 the
-- older batch read 136 against 102 received.
select is_empty(
  $$select b.id::text
      from inventory_batches b
      join (select batch_id, sum(qty_pieces_remaining) rem
              from v_batch_stock group by batch_id) s on s.batch_id = b.id
     where s.rem > b.qty_pieces_received$$,
  'no batch holds more pieces than it ever received'
);

select is(
  (select qty_pieces_remaining from v_batch_stock where batch_id = '00000000-0000-0000-0000-0000000000a5'),
  102,
  'the newest batch is refilled FIRST, back to exactly what it issued -- reverse of the FIFO that emptied it'
);

select is(
  (select qty_pieces_remaining from v_batch_stock where batch_id = '00000000-0000-0000-0000-0000000000a4'),
  68,
  'and the remainder goes to the older batch -- 68 + 68, not 136 into whichever one won a LIMIT 1'
);

-- Valuation follows from that split, and is the reason the split matters.
select is(
  (select round(sum(qty_pieces_remaining * landed_per_piece_mvr), 2)
     from v_batch_stock where sku_id = '00000000-0000-0000-0000-000000000005'),
  2720.00::numeric,
  'stock is worth MVR 2,720 -- 68 at 10 plus 102 at 20. The single-batch bug reported MVR 2,040'
);

-- ── The receipt and the ledger must agree ─────────────────────────────────
-- The function used to answer cost_recovered_mvr = 1,904 while writing 1,360
-- of movements. Whatever it claims to have put back must be what it put back.
select is(
  (select round(sr.qty_pieces * sr.landed_cost_per_piece_mvr, 2) from sales_returns sr),
  2040.00::numeric,
  'the cost recorded on the return equals the value actually returned to stock (68x20 + 68x10)'
);

-- get_pnl reverses COGS as qty x landed_cost_per_piece_mvr when restocked, so
-- the above is exactly what the P&L gives back. Ledger and P&L cannot drift.
select is(
  (select round(sr.qty_pieces * sr.landed_cost_per_piece_mvr, 2) from sales_returns sr),
  (select round(sum(qty_pieces_remaining * landed_per_piece_mvr), 2)
     from v_batch_stock where sku_id = '00000000-0000-0000-0000-000000000005')
  - 680.00,
  'the P&L cost reversal equals the RISE in stock value -- the two ledgers agree by construction'
);

-- ── You cannot return more than was bought ────────────────────────────────
select throws_ok(
  $$select record_customer_return('00000000-0000-0000-0000-0000000000a6',
      '00000000-0000-0000-0000-000000000005', 40, 'unwanted', 'credit', true, null)$$,
  'Only 34 pieces can still be returned on this order (170 sold, 136 already returned)',
  'a second return is capped at what is left, counting the first one'
);

select * from finish();
rollback;

-- Pass 3: the sale path -- create_and_post_sale + post_sale. This is where
-- the two worst bugs in this project's history lived:
--   * SO-2026-076: revenue recognized, stock never deducted, no cost recorded
--     (a draft order walked all the way to delivered). Closed by migration
--     0128 making order + lines + FIFO deduction ONE transaction.
--   * The offline replay that silently created duplicate sales. Closed by the
--     same migration's p_offline_key.
-- Both are asserted here directly.
--
-- Batches are inserted with exact landed costs rather than run through
-- confirm_grn, so FIFO is tested in isolation with known numbers -- GRN's
-- own apportionment is already covered in confirm_grn.test.sql.

begin;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000020', 'test-sales@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000020';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000020', true);

-- Two shipment lines, only because inventory_batches requires one (NOT NULL,
-- unique per line). The shipments themselves are never GRN'd here.
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000021', 'TEST-FIFO-A',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400),
       ('00000000-0000-0000-0000-000000000022', 'TEST-FIFO-B',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);

insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                             fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000021',
        '00000000-0000-0000-0000-000000000005', 1, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006'),
       ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000022',
        '00000000-0000-0000-0000-000000000005', 1, 0.036, 20, 'USD',
        '00000000-0000-0000-0000-000000000006');

-- Batch A: OLDER, 1 carton = 102 pieces at MVR 10.0000/piece
-- Batch B: NEWER, 1 carton = 102 pieces at MVR 20.0000/piece
-- Deliberately different costs so the FIFO order is provable from the cost
-- snapshot alone, not just from which rows moved.
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                qty_cartons_received, qty_pieces_received,
                                landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000023',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        '2026-01-01 00:00:00+00', 1, 102, 10.0000, 340.0000, 1020.0000),
       ('00000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000024',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        '2026-06-01 00:00:00+00', 1, 102, 20.0000, 680.0000, 2040.0000);

insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 102, 'shipment'),
       ('00000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 102, 'shipment');

-- ── Sell 5 packs (170 pieces) at MVR 700/pack ─────────────────────────────
-- Crosses the batch boundary on purpose: 102 from the old batch + 68 from
-- the new one. Weighted cost = (102x10 + 68x20) / 170 = MVR 14.0000/piece.
select lives_ok(
  $$select create_and_post_sale(
      '{"source_godown_id":"00000000-0000-0000-0000-000000000006","channel":"walkin"}'::jsonb,
      '[{"sku_id":"00000000-0000-0000-0000-000000000005","uom":"pack","qty":5,"unit_price_mvr":700}]'::jsonb
    )$$,
  'create_and_post_sale posts a sale that spans two batches'
);

select is(
  (select qty_pieces_remaining from v_batch_stock where batch_id = '00000000-0000-0000-0000-000000000025'),
  0,
  'FIFO: the OLDER batch is emptied first'
);

select is(
  (select qty_pieces_remaining from v_batch_stock where batch_id = '00000000-0000-0000-0000-000000000026'),
  34,
  'FIFO: the newer batch is only touched for the remainder (102 - 68 = 34 left)'
);

-- The cost snapshot is what makes a past sale's margin permanent -- migration
-- 0045/0046. If FIFO ran in the wrong order this would be 20.0, not 14.0.
select is(
  (select landed_cost_per_piece_mvr from sales_order_lines
    where sku_id = '00000000-0000-0000-0000-000000000005' limit 1),
  14.0000::numeric,
  'the line snapshots the true weighted FIFO cost (MVR 14.0000/piece), not the latest batch cost'
);

-- 700/pack over 34 pcs/pack = 20.5882/piece; 1 - 14/20.5882 = exactly 32%.
select is(
  (select actual_margin_pct from sales_order_lines
    where sku_id = '00000000-0000-0000-0000-000000000005' limit 1),
  32.00::numeric,
  'margin is measured against the price actually charged, per the unit sold'
);

select is(
  (select status from sales_orders order by created_at limit 1),
  'confirmed',
  'the order lands as confirmed, never left stranded in draft (the SO-2026-076 failure)'
);

-- ── Double-post guard ─────────────────────────────────────────────────────
select throws_ok(
  format($$select post_sale(%L::uuid)$$, (select id from sales_orders order by created_at limit 1)),
  'P0001',
  null,
  'post_sale refuses to run twice on the same order -- stock can never be deducted twice'
);

-- ── Insufficient stock rolls the WHOLE thing back ─────────────────────────
-- 34 pieces remain; asking for 2 packs (68) must fail. The critical part is
-- not the error -- it is that no half-made order survives it. That is the
-- exact gap that let SO-2026-076 exist.
select throws_ok(
  $$select create_and_post_sale(
      '{"source_godown_id":"00000000-0000-0000-0000-000000000006","channel":"walkin"}'::jsonb,
      '[{"sku_id":"00000000-0000-0000-0000-000000000005","uom":"pack","qty":2,"unit_price_mvr":700}]'::jsonb
    )$$,
  'P0001',
  null,
  'a sale larger than available stock is refused'
);

select is(
  (select count(*) from sales_orders),
  1::bigint,
  'the refused sale left NO orphan order behind -- order, lines and stock move as one transaction (migration 0128)'
);

-- ── Offline replay is idempotent, not a duplicate sale ────────────────────
select lives_ok(
  $$select create_and_post_sale(
      '{"source_godown_id":"00000000-0000-0000-0000-000000000006","channel":"walkin"}'::jsonb,
      '[{"sku_id":"00000000-0000-0000-0000-000000000005","uom":"pack","qty":1,"unit_price_mvr":700}]'::jsonb,
      'test-offline-key-1'
    )$$,
  'a sale carrying an offline key posts normally the first time'
);

-- Replaying the same queued write (the real offline-sync path) must return
-- the existing order, not bill the customer twice. Note it replays a sale
-- for 1 more pack than the 0 pieces now left -- proof it never re-runs the
-- stock deduction at all, it just hands back the order it already made.
select create_and_post_sale(
  '{"source_godown_id":"00000000-0000-0000-0000-000000000006","channel":"walkin"}'::jsonb,
  '[{"sku_id":"00000000-0000-0000-0000-000000000005","uom":"pack","qty":1,"unit_price_mvr":700}]'::jsonb,
  'test-offline-key-1'
);

select is(
  (select count(*) from sales_orders),
  2::bigint,
  'replaying the same offline key returns the existing order instead of creating a second one'
);

select * from finish();
rollback;

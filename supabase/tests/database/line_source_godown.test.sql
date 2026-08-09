-- Pass 16: a line can ship from a different godown than the rest of the order.
-- Regression guard for migration 0164.
--
-- Ali, 2026-08-09, on a Purple row reading "No full carton here · 20 cartons at
-- Veesange": "it marks in orange words x cartons at x warehouse but doesn't let
-- me choose from this warehouse." And, asked whether one delivery can collect
-- from two godowns: "Usually one, but sometimes both."
--
-- The location lived only on the order header, so post_sale depleted every line
-- from it and there was nowhere to record that one line comes from elsewhere.
--
-- Two things have to be true at once, and both are tested here:
--   1. A line naming its own godown is depleted from THAT godown.
--   2. A line naming nothing behaves exactly as it always has.
-- The second is what makes this safe to ship: every one of the 93 existing
-- orders has NULL on every line.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000002a0', 'test-godown@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000002a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000002a0', true);

-- A SECOND godown. '...006' is the seeded one the other tests use.
insert into godowns (id, name) values ('00000000-0000-0000-0000-0000000002a1', 'Far Godown');

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000002a2', 'SH-TEST-GODOWN',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);

-- Stock for the SAME sku in BOTH godowns, at different costs so the movements
-- can be told apart by more than location.
create function pg_temp.stock_at(p_godown uuid, p_line uuid, p_batch uuid,
                                 p_pieces integer, p_cost numeric)
returns void language plpgsql as $$
begin
  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (p_line, '00000000-0000-0000-0000-0000000002a2',
          '00000000-0000-0000-0000-000000000005', 10, 0.036, 10, 'USD', p_godown);
  insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
  values (p_batch, p_line, '00000000-0000-0000-0000-000000000005', p_godown,
          now() - interval '4 days', 10, p_pieces, p_cost, p_cost * 34, p_cost * 102);
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (p_batch, '00000000-0000-0000-0000-000000000005', p_godown, 'in', p_pieces, 'shipment');
end $$;

select pg_temp.stock_at('00000000-0000-0000-0000-000000000006',
                        '00000000-0000-0000-0000-0000000002a3',
                        '00000000-0000-0000-0000-0000000002a4', 340, 10);
select pg_temp.stock_at('00000000-0000-0000-0000-0000000002a1',
                        '00000000-0000-0000-0000-0000000002a5',
                        '00000000-0000-0000-0000-0000000002a6', 340, 20);

-- ── 1. A line that names the FAR godown is taken from there ───────────────
insert into sales_orders (id, order_number, status, payment_status, channel, source_godown_id)
values ('00000000-0000-0000-0000-0000000002b0', 'SO-GODOWN-1', 'draft', 'pending', 'walkin',
        '00000000-0000-0000-0000-000000000006');
insert into sales_order_lines (id, order_id, sku_id, uom, qty, qty_pieces,
                               unit_price_mvr, line_total_mvr, source_godown_id)
values ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-0000000002b0',
        '00000000-0000-0000-0000-000000000005', 'pack', 2, 68, 700, 1400,
        '00000000-0000-0000-0000-0000000002a1');

select lives_ok(
  $$select post_sale('00000000-0000-0000-0000-0000000002b0')$$,
  'an order shipping from one godown can carry a line sourced from another'
);

select is(
  (select sum(sm.qty_pieces)::int from stock_movements sm
    where sm.source_id = '00000000-0000-0000-0000-0000000002b0'
      and sm.godown_id = '00000000-0000-0000-0000-0000000002a1'),
  68,
  'the stock came OUT of the far godown, the one the line named'
);

select is_empty(
  $$select sm.id from stock_movements sm
     where sm.source_id = '00000000-0000-0000-0000-0000000002b0'
       and sm.godown_id = '00000000-0000-0000-0000-000000000006'$$,
  'and nothing at all was taken from the order''s own godown'
);

select is(
  (select landed_cost_per_piece_mvr from sales_order_lines
    where id = '00000000-0000-0000-0000-0000000002b1'),
  20::numeric,
  'costing followed the stock -- MVR 20 is the far godown''s batch, not the near one''s 10'
);

-- ── 2. A line that names NOTHING is unchanged ─────────────────────────────
-- This is what makes the change safe: every existing line in the business is
-- NULL here, so every existing order keeps its exact behaviour.
insert into sales_orders (id, order_number, status, payment_status, channel, source_godown_id)
values ('00000000-0000-0000-0000-0000000002c0', 'SO-GODOWN-2', 'draft', 'pending', 'walkin',
        '00000000-0000-0000-0000-000000000006');
insert into sales_order_lines (id, order_id, sku_id, uom, qty, qty_pieces,
                               unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-0000000002c1', '00000000-0000-0000-0000-0000000002c0',
        '00000000-0000-0000-0000-000000000005', 'pack', 2, 68, 700, 1400);

select is(
  (select source_godown_id from sales_order_lines where id = '00000000-0000-0000-0000-0000000002c1'),
  null,
  'a line added without a godown stores NULL -- the shape every existing line has'
);

select lives_ok(
  $$select post_sale('00000000-0000-0000-0000-0000000002c0')$$,
  'and it posts exactly as before'
);

select is(
  (select sum(sm.qty_pieces)::int from stock_movements sm
    where sm.source_id = '00000000-0000-0000-0000-0000000002c0'
      and sm.godown_id = '00000000-0000-0000-0000-000000000006'),
  68,
  'taken from the ORDER''s godown, because the line named none'
);

select is(
  (select landed_cost_per_piece_mvr from sales_order_lines
    where id = '00000000-0000-0000-0000-0000000002c1'),
  10::numeric,
  'and costed from that godown''s batch'
);

-- ── 3. Running out names the godown it looked in ──────────────────────────
-- With two possible answers, "in selected godown" stopped being actionable.
insert into sales_orders (id, order_number, status, payment_status, channel, source_godown_id)
values ('00000000-0000-0000-0000-0000000002d0', 'SO-GODOWN-3', 'draft', 'pending', 'walkin',
        '00000000-0000-0000-0000-000000000006');
insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces,
                               unit_price_mvr, line_total_mvr, source_godown_id)
values ('00000000-0000-0000-0000-0000000002d0', '00000000-0000-0000-0000-000000000005',
        'pack', 100, 3400, 700, 70000, '00000000-0000-0000-0000-0000000002a1');

select throws_like(
  $$select post_sale('00000000-0000-0000-0000-0000000002d0')$$,
  '%Far Godown%',
  'running short says WHICH godown it looked in, by name'
);

select * from finish();
rollback;

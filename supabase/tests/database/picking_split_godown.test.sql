-- Pass 17: the picking data for a split order is complete and correct.
-- Companion to 0164/0165 — those made a split possible; this asserts that
-- everything a picker and a driver need in order to load the right van is
-- actually recorded and readable.
--
-- Why a database test for what looks like a screen problem: the dispatch card,
-- the driver's "Pick up from" block and the order detail all derive the extra
-- stops from the same two facts — the order's godown, and each line's own.
-- If those are wrong or missing, every one of those screens is wrong at once,
-- and no amount of UI care saves it. This pins the data.
--
-- The scenario throughout is Ali's: an order shipping from one warehouse with
-- one line that has to come from the other.

begin;
select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000003a0', 'test-pick@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000003a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000003a0', true);

insert into godowns (id, name) values ('00000000-0000-0000-0000-0000000003a1', 'Second Godown');

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000003a2', 'SH-TEST-PICK',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);

create function pg_temp.stock_at(p_godown uuid, p_line uuid, p_batch uuid, p_pieces integer)
returns void language plpgsql as $$
begin
  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (p_line, '00000000-0000-0000-0000-0000000003a2',
          '00000000-0000-0000-0000-000000000005', 10, 0.036, 10, 'USD', p_godown);
  insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
  values (p_batch, p_line, '00000000-0000-0000-0000-000000000005', p_godown,
          now() - interval '4 days', 10, p_pieces, 10, 340, 1020);
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (p_batch, '00000000-0000-0000-0000-000000000005', p_godown, 'in', p_pieces, 'shipment');
end $$;

select pg_temp.stock_at('00000000-0000-0000-0000-000000000006',
                        '00000000-0000-0000-0000-0000000003a3',
                        '00000000-0000-0000-0000-0000000003a4', 340);
select pg_temp.stock_at('00000000-0000-0000-0000-0000000003a1',
                        '00000000-0000-0000-0000-0000000003a5',
                        '00000000-0000-0000-0000-0000000003a6', 340);

-- An order from godown A, with a line that must come from godown B.
insert into sales_orders (id, order_number, status, payment_status, channel, source_godown_id)
values ('00000000-0000-0000-0000-0000000003b0', 'SO-PICK-1', 'draft', 'pending', 'walkin',
        '00000000-0000-0000-0000-000000000006');
insert into sales_order_lines (id, order_id, sku_id, uom, qty, qty_pieces,
                               unit_price_mvr, line_total_mvr, source_godown_id)
values ('00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-0000000003b0',
        '00000000-0000-0000-0000-000000000005', 'pack', 2, 68, 700, 1400,
        '00000000-0000-0000-0000-0000000003a1');
select post_sale('00000000-0000-0000-0000-0000000003b0');

-- ── What the screens read ─────────────────────────────────────────────────
select is(
  (select source_godown_id from sales_order_lines where id = '00000000-0000-0000-0000-0000000003b1'),
  '00000000-0000-0000-0000-0000000003a1'::uuid,
  'the line records its own godown, so a picker can be told which shelf'
);

select is(
  (select count(distinct sol.source_godown_id)::int
     from sales_order_lines sol
     join sales_orders so on so.id = sol.order_id
    where sol.order_id = '00000000-0000-0000-0000-0000000003b0'
      and sol.source_godown_id is not null
      and sol.source_godown_id <> so.source_godown_id),
  1,
  'and the order reports exactly one EXTRA stop -- the figure the dispatch card and the driver''s pick-up block both derive'
);

select is(
  (select g.name from sales_order_lines sol
     join godowns g on g.id = sol.source_godown_id
    where sol.id = '00000000-0000-0000-0000-0000000003b1'),
  'Second Godown',
  'the extra stop resolves to a NAME -- a driver cannot act on a uuid'
);

-- ── The stock really left the second godown ───────────────────────────────
select is(
  (select sum(sm.qty_pieces)::int from stock_movements sm
    where sm.source_id = '00000000-0000-0000-0000-0000000003b0'
      and sm.godown_id = '00000000-0000-0000-0000-0000000003a1'),
  68,
  'the pick list and the ledger agree: 68 left the second godown'
);

select is_empty(
  $$select sm.id from stock_movements sm
     where sm.source_id = '00000000-0000-0000-0000-0000000003b0'
       and sm.godown_id = '00000000-0000-0000-0000-000000000006'$$,
  'and nothing was taken from the order''s own godown, which is what the old code would have done'
);

-- ── An ordinary order stays silent ────────────────────────────────────────
-- The screens must show NOTHING extra for a normal single-warehouse order, or
-- the warning stops meaning anything.
insert into sales_orders (id, order_number, status, payment_status, channel, source_godown_id)
values ('00000000-0000-0000-0000-0000000003c0', 'SO-PICK-2', 'draft', 'pending', 'walkin',
        '00000000-0000-0000-0000-000000000006');
insert into sales_order_lines (id, order_id, sku_id, uom, qty, qty_pieces,
                               unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-0000000003c1', '00000000-0000-0000-0000-0000000003c0',
        '00000000-0000-0000-0000-000000000005', 'pack', 2, 68, 700, 1400);
select post_sale('00000000-0000-0000-0000-0000000003c0');

select is(
  (select count(*)::int from sales_order_lines sol
     join sales_orders so on so.id = sol.order_id
    where sol.order_id = '00000000-0000-0000-0000-0000000003c0'
      and sol.source_godown_id is not null
      and sol.source_godown_id <> so.source_godown_id),
  0,
  'an ordinary order reports NO extra stop, so the warning stays meaningful'
);

-- ── Reversal follows the split, with no special handling ──────────────────
-- void_sales_order was never taught about godowns: it reverses the exact
-- movements it finds. If that is true, a split order reverses correctly.
select void_sales_order('00000000-0000-0000-0000-0000000003b0', 'test void of a split order');

select is(
  (select coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0)::int
     from stock_movements sm
    where sm.sku_id = '00000000-0000-0000-0000-000000000005'
      and sm.godown_id = '00000000-0000-0000-0000-0000000003a1'),
  340,
  'voiding a split order puts the stock back in the SECOND godown, where it came from'
);

select is(
  (select coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0)::int
     from stock_movements sm
    where sm.sku_id = '00000000-0000-0000-0000-000000000005'
      and sm.godown_id = '00000000-0000-0000-0000-000000000006'),
  272,
  'and the first godown is untouched by that void -- 340 received less the 68 the ordinary order took'
);

select * from finish();
rollback;

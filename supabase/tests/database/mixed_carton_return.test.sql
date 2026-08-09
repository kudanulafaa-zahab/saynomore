-- Pass 18: part of a mixed carton can be returned.
--
-- Ali sells Sosoft only by the carton, so the returns sheet offered only the
-- carton — and a mixed-carton line holds BOTTLES (4 Purple, say). Returning
-- one carton means six, six is more than four, so every attempt was refused
-- and the line could not be returned at all.
--
-- The carton-only rule governs SELLING: a customer cannot buy three bottles.
-- A damaged bottle coming back out of a carton already sold is a different
-- event — the same carve-out CLAUDE.md already makes for Stock Ops, where "a
-- torn pack is real".
--
-- The database always allowed it; only the screen was gating. These tests pin
-- that down so the gate cannot come back, and prove the whole-carton guard
-- (0163) is not disturbed by a return.

begin;
select plan(5);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000004a0', 'test-mcret@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000004a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000004a0', true);

insert into brands (id, name, mixed_carton_pieces)
values ('00000000-0000-0000-0000-0000000004a1', 'Retsoft', 6);
insert into product_categories (id, name, unit_uom, cost_basis)
values ('00000000-0000-0000-0000-0000000004a2', 'Ret Handwash', 'ml', 'per_100ml');
insert into product_models (id, category_id, brand_id, name)
values ('00000000-0000-0000-0000-0000000004a3', '00000000-0000-0000-0000-0000000004a2',
        '00000000-0000-0000-0000-0000000004a1', 'Blue'),
       ('00000000-0000-0000-0000-0000000004a4', '00000000-0000-0000-0000-0000000004a2',
        '00000000-0000-0000-0000-0000000004a1', 'Red');
insert into variants (id, model_id, display_name)
values ('00000000-0000-0000-0000-0000000004a5', '00000000-0000-0000-0000-0000000004a3', 'Rose 700ml'),
       ('00000000-0000-0000-0000-0000000004a6', '00000000-0000-0000-0000-0000000004a4', 'Sakura 700ml');
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000004a7', '00000000-0000-0000-0000-0000000004a5',
        'RETSOFT-BLUE-1x6', 1, 6, 40, 30, 30, 220, array['carton']),
       ('00000000-0000-0000-0000-0000000004a8', '00000000-0000-0000-0000-0000000004a6',
        'RETSOFT-RED-1x6', 1, 6, 40, 30, 30, 220, array['carton']);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000004a9', 'SH-TEST-MCRET',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);

create function pg_temp.stk(p_sku uuid, p_line uuid, p_batch uuid)
returns void language plpgsql as $$
begin
  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (p_line, '00000000-0000-0000-0000-0000000004a9', p_sku, 10, 0.036, 10, 'USD',
          '00000000-0000-0000-0000-000000000006');
  insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received, landed_per_piece_mvr,
                                 landed_per_pack_mvr, landed_per_carton_mvr)
  values (p_batch, p_line, p_sku, '00000000-0000-0000-0000-000000000006',
          now() - interval '3 days', 10, 60, 20, 20, 120);
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (p_batch, p_sku, '00000000-0000-0000-0000-000000000006', 'in', 60, 'shipment');
end $$;
select pg_temp.stk('00000000-0000-0000-0000-0000000004a7',
                   '00000000-0000-0000-0000-0000000004b0','00000000-0000-0000-0000-0000000004b1');
select pg_temp.stk('00000000-0000-0000-0000-0000000004a8',
                   '00000000-0000-0000-0000-0000000004b2','00000000-0000-0000-0000-0000000004b3');

-- One mixed carton: 4 Blue + 2 Red.
insert into sales_orders (id, order_number, status, payment_status, channel, source_godown_id)
values ('00000000-0000-0000-0000-0000000004c0', 'SO-MCRET-1', 'draft', 'pending', 'walkin',
        '00000000-0000-0000-0000-000000000006');
insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr,
                               line_total_mvr, is_mixed_carton_fill)
values ('00000000-0000-0000-0000-0000000004c0','00000000-0000-0000-0000-0000000004a7',
        'piece', 4, 4, 36.67, 146.68, true),
       ('00000000-0000-0000-0000-0000000004c0','00000000-0000-0000-0000-0000000004a8',
        'piece', 2, 2, 36.67, 73.34, true);
select post_sale('00000000-0000-0000-0000-0000000004c0');
-- Paid in full first: a refund cannot exceed what was paid, which is a real
-- guard and not something to work around — so the fixture is a customer who
-- paid for the carton and then brought two bottles back.
select record_order_payment('00000000-0000-0000-0000-0000000004c0', 220.02, 'cash', null, null, null);

-- ── The whole point: TWO bottles come back, not six ───────────────────────
select lives_ok(
  $$select record_customer_return('00000000-0000-0000-0000-0000000004c0',
        '00000000-0000-0000-0000-0000000004a7', 2, 'defective', 'refund', true, null)$$,
  'two bottles of a mixed carton can be returned -- the sheet used to offer only a 6-bottle carton, which is more than the 4 sold'
);

select is(
  (select sum(qty_pieces)::int from sales_returns
    where order_id = '00000000-0000-0000-0000-0000000004c0'),
  2,
  'and the return is recorded as two bottles'
);

select is(
  (select coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0)::int
     from stock_movements sm where sm.sku_id = '00000000-0000-0000-0000-0000000004a7'),
  58,
  'the two bottles are back on the shelf -- 60 received, 4 sold, 2 returned'
);

-- ── The whole-carton guard is not disturbed ───────────────────────────────
-- Returns write to sales_returns and stock_movements, never to
-- sales_order_lines, so 0163 never sees them. The order still says 6 bottles
-- were sold, which is still one whole carton, which is still true.
select is(
  (select sum(qty_pieces)::int from sales_order_lines
    where order_id = '00000000-0000-0000-0000-0000000004c0'),
  6,
  'the ORDER still records a whole carton sold -- a return does not rewrite what was sold'
);

-- And a return bigger than the line is still refused, so this did not open a
-- hole while closing one.
select throws_ok(
  $$select record_customer_return('00000000-0000-0000-0000-0000000004c0',
        '00000000-0000-0000-0000-0000000004a8', 99, 'defective', 'refund', true, null)$$,
  null, null,
  'returning more than was sold on the line is still refused'
);

select * from finish();
rollback;

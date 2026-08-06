-- Pass 5: the guards on destructive actions. Two of these encode bugs that
-- were live in production and could have destroyed real customer money:
--   * migration 0129 -- delete_sales_order only checked the order HEADER
--     (payment_status in 'paid','deposited'). But 'partial' and 'cod' are
--     legal values too, so a part-paid order passed every guard and its
--     order_payments rows cascaded away with no trace. Same bug class had
--     already been fixed once in admin_force_void_grn.
--   * migration 0134 -- "Remove item" deleted the line with a plain table
--     delete, leaving the 'out' stock movements behind. Goods ended up in
--     neither the order nor inventory, permanently, with no audit row.

begin;
select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000040', 'test-guards@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000040';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000040', true);

-- Stock to sell: 4 cartons = 408 pieces at MVR 14.0000/piece.
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000041', 'TEST-GUARDS', '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                             fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000041',
        '00000000-0000-0000-0000-000000000005', 4, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                qty_cartons_received, qty_pieces_received,
                                landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000042',
        '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
        '2026-01-01 00:00:00+00', 4, 408, 14.0000, 476.0000, 1428.0000);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006', 'in', 408, 'shipment');

-- ── A part-paid order must survive a delete attempt (migration 0129) ──────
-- payment_status stays 'partial', which is exactly what slipped past the
-- old header-only guard. The money is real and sits in order_payments.
select order_id from create_and_post_sale(
  '{"source_godown_id":"00000000-0000-0000-0000-000000000006","channel":"walkin"}'::jsonb,
  '[{"sku_id":"00000000-0000-0000-0000-000000000005","uom":"pack","qty":2,"unit_price_mvr":700}]'::jsonb
) \gset paid_

insert into order_payments (order_id, amount_mvr, method, created_by)
values (:'paid_order_id', 500, 'cash', '00000000-0000-0000-0000-000000000040');
update sales_orders set payment_status = 'partial' where id = :'paid_order_id';

select throws_ok(
  format($$select delete_sales_order(%L::uuid)$$, :'paid_order_id'),
  'P0001',
  null,
  'a part-paid order cannot be deleted -- payment_status "partial" passes the header check, so the ledger is what actually guards it (migration 0129)'
);

select is(
  (select count(*) from order_payments where order_id = :'paid_order_id'),
  1::bigint,
  'the customer payment is still there -- it was never cascade-deleted'
);

select is(
  (select count(*) from sales_orders where id = :'paid_order_id'),
  1::bigint,
  'and the order itself survived'
);

-- ── A delivered order can never be deleted, paid or not ──────────────────
select order_id from create_and_post_sale(
  '{"source_godown_id":"00000000-0000-0000-0000-000000000006","channel":"walkin"}'::jsonb,
  '[{"sku_id":"00000000-0000-0000-0000-000000000005","uom":"pack","qty":1,"unit_price_mvr":700}]'::jsonb
) \gset delivered_

update sales_orders set status = 'delivered' where id = :'delivered_order_id';

select throws_ok(
  format($$select delete_sales_order(%L::uuid)$$, :'delivered_order_id'),
  'P0001',
  null,
  'a delivered order cannot be deleted -- voiding is the correct action, it reverses stock and keeps the record'
);

-- ── Deleting a clean order returns its stock (no silent loss) ────────────
-- 408 in stock. Sell 3 packs (102 pieces) -> 306 left. Delete the order ->
-- must go back to 408, because the 'out' movements are reversed. Migration
-- 0134's lesson: goods must never end up in neither place.
select order_id from create_and_post_sale(
  '{"source_godown_id":"00000000-0000-0000-0000-000000000006","channel":"walkin"}'::jsonb,
  '[{"sku_id":"00000000-0000-0000-0000-000000000005","uom":"pack","qty":3,"unit_price_mvr":700}]'::jsonb
) \gset clean_

select is(
  (select sum(stock_signed_delta(movement_type, qty_pieces))
     from stock_movements where sku_id = '00000000-0000-0000-0000-000000000005'),
  (408 - 68 - 34 - 102)::bigint,
  'stock reflects every posted sale so far (408 in, three sales out)'
);

select lives_ok(
  format($$select delete_sales_order(%L::uuid, 'test cleanup')$$, :'clean_order_id'),
  'an unpaid, undelivered order can be deleted'
);

select is(
  (select sum(stock_signed_delta(movement_type, qty_pieces))
     from stock_movements where sku_id = '00000000-0000-0000-0000-000000000005'),
  (408 - 68 - 34)::bigint,
  'deleting it RETURNS its 102 pieces to stock -- goods never end up in neither the order nor inventory (migration 0134)'
);

select isnt_empty(
  format($$select 1 from audit_log where record_id = %L::uuid and action = 'delete'$$, :'clean_order_id'),
  'the deletion is audit-logged -- destructive actions are never silent'
);

select * from finish();
rollback;

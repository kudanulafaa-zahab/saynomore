-- A mixed carton is billed at the carton price. Exactly.
--
-- Ali, 2026-09-03, with a push notification on his lock screen:
--   *"When a payment is marked received now I get notification that I received
--    a payment of 229.99. The payment made was for 230.00 why am I getting the
--    notification like this?"*
--
-- The notification was right and the order was wrong. Six bottles billed at a
-- carton rate of 230.00: the app divided by six, stored 38.3333 a bottle, and
-- the line totals added back to 229.99. 230 / 6 does not terminate in decimal,
-- so no amount of stored precision fixes it — the parts have to be ALLOCATED so
-- they sum to the whole, which is what every invoicing system does with a VAT
-- amount or a discount.
--
-- These assertions are about the rule, at quantities and prices chosen because
-- they are the awkward ones: a price that does not divide by six, a group with
-- an uneven split across colours, and a second carton on top.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000009f1', 'test-mixtotal@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009f1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000009f1', true);

insert into brands (id, name, mixed_carton_pieces)
values ('00000000-0000-0000-0000-0000000009f2', 'Test Mix Brand', 6);
insert into product_categories (id, name, unit_uom, cost_basis, variant_attributes,
                                default_sellable_units, duty_rate_pct)
values ('00000000-0000-0000-0000-0000000009f3', 'Test Mix Cat', 'ml', 'per_100ml',
        '["size"]'::jsonb, array['pack','carton'], 0);
insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-0000000009f4', '00000000-0000-0000-0000-0000000009f2',
        '00000000-0000-0000-0000-0000000009f3', 'Mix Range');

-- Three colours, 1 to a pack and 6 to a carton — the Sosoft shape exactly.
insert into variants (id, model_id, display_name, attributes) values
 ('00000000-0000-0000-0000-0000000009f5','00000000-0000-0000-0000-0000000009f4','Blue', '{"size":"mix-blue"}'::jsonb),
 ('00000000-0000-0000-0000-0000000009f6','00000000-0000-0000-0000-0000000009f4','Green','{"size":"mix-green"}'::jsonb),
 ('00000000-0000-0000-0000-0000000009f7','00000000-0000-0000-0000-0000000009f4','Red',  '{"size":"mix-red"}'::jsonb);

insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_carton_mvr, sellable_units) values
 ('00000000-0000-0000-0000-0000000009f8','00000000-0000-0000-0000-0000000009f5','TEST-MIX-B-1x6',1,6,30,20,25,230, array['pack','carton']),
 ('00000000-0000-0000-0000-0000000009f9','00000000-0000-0000-0000-0000000009f6','TEST-MIX-G-1x6',1,6,30,20,25,230, array['pack','carton']),
 ('00000000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-0000000009f7','TEST-MIX-R-1x6',1,6,30,20,25,230, array['pack','carton']);

insert into sales_orders (id, customer_id, status, channel, payment_status)
values ('00000000-0000-0000-0000-000000000a02', (select id from customers limit 1),
        'draft', 'walkin', 'pending');

-- ══════════════════════════════════════════════════════════════════════════
-- 1. THE EXACT CASE FROM THE NOTIFICATION
-- ══════════════════════════════════════════════════════════════════════════
-- One carton of six, split 3 / 2 / 1 across colours, at 230.00 / 6 = 38.3333.
-- Added up per bottle this is 229.99. It must be 230.00.
insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces,
                               unit_price_mvr, line_total_mvr, is_mixed_carton_fill) values
 ('00000000-0000-0000-0000-000000000a02','00000000-0000-0000-0000-0000000009f8','piece',3,3, 38.3333, 114.99, true),
 ('00000000-0000-0000-0000-000000000a02','00000000-0000-0000-0000-0000000009f9','piece',2,2, 38.3333, 76.67,  true),
 ('00000000-0000-0000-0000-000000000a02','00000000-0000-0000-0000-000000000a01','piece',1,1, 38.3333, 38.33,  true);

select is(
  (select sum(line_total_mvr) from sales_order_lines where order_id = '00000000-0000-0000-0000-000000000a02'),
  230.00::numeric,
  'a mixed carton at MVR 230 invoices 230.00, not 229.99'
);

-- Every line is still a clean two-decimal figure — no 38.3333 reaches a total.
select is(
  (select count(*)::int from sales_order_lines
    where order_id = '00000000-0000-0000-0000-000000000a02'
      and line_total_mvr <> round(line_total_mvr, 2)),
  0,
  'and every colour totals a whole number of laari'
);

-- The allocation is by SIZE, so the biggest share carries the biggest total.
select is(
  (select line_total_mvr from sales_order_lines
    where order_id = '00000000-0000-0000-0000-000000000a02'
      and sku_id = '00000000-0000-0000-0000-0000000009f8'),
  115.00::numeric,
  'three bottles of one colour carry three bottles worth, rounded up to close the gap'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. IT HOLDS AT EVERY DOOR, NOT JUST ON INSERT
-- ══════════════════════════════════════════════════════════════════════════
-- Editing a quantity re-splits the carton. This is the door create_and_post_sale
-- does not own, and a rule that only holds on one screen is the defect itself.
update sales_order_lines set qty = 2, qty_pieces = 2, line_total_mvr = 76.67
 where order_id = '00000000-0000-0000-0000-000000000a02'
   and sku_id = '00000000-0000-0000-0000-0000000009f8';
-- 2 + 2 + 1 = 5 bottles: NOT a whole carton, so nothing is allocated and the
-- lines stand as entered. The cart already refuses to save a part carton.
select is(
  (select round(sum(line_total_mvr), 2) from sales_order_lines
    where order_id = '00000000-0000-0000-0000-000000000a02'),
  191.67::numeric,
  'five bottles are not a carton, so no carton price is forced onto them'
);

-- Back to six, a different split: 2 / 2 / 2.
update sales_order_lines set qty = 2, qty_pieces = 2, line_total_mvr = 76.67
 where order_id = '00000000-0000-0000-0000-000000000a02'
   and sku_id = '00000000-0000-0000-0000-000000000a01';

select is(
  (select sum(line_total_mvr) from sales_order_lines where order_id = '00000000-0000-0000-0000-000000000a02'),
  230.00::numeric,
  'an even split across three colours still totals the carton exactly'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. TWO CARTONS ARE TWO CARTON PRICES
-- ══════════════════════════════════════════════════════════════════════════
update sales_order_lines set qty = 8, qty_pieces = 8, line_total_mvr = 306.67
 where order_id = '00000000-0000-0000-0000-000000000a02'
   and sku_id = '00000000-0000-0000-0000-0000000009f8';

select is(
  (select sum(line_total_mvr) from sales_order_lines where order_id = '00000000-0000-0000-0000-000000000a02'),
  460.00::numeric,
  'twelve bottles are two cartons and cost exactly twice the carton price'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 4. REMOVING A COLOUR RE-SPLITS WHAT IS LEFT
-- ══════════════════════════════════════════════════════════════════════════
delete from sales_order_lines
 where order_id = '00000000-0000-0000-0000-000000000a02'
   and sku_id = '00000000-0000-0000-0000-0000000009f8';

select is(
  (select sum(qty_pieces)::int from sales_order_lines where order_id = '00000000-0000-0000-0000-000000000a02'),
  4,
  'four bottles are left after a colour is taken out'
);

select is(
  (select round(sum(line_total_mvr), 2) from sales_order_lines
    where order_id = '00000000-0000-0000-0000-000000000a02'),
  -- 153.33, MEASURED, not calculated. I wrote 153.34 here first, reasoning
  -- that both survivors would keep the extra laari they were handed when the
  -- group was twelve bottles. Only one of them had it. The whole point of the
  -- allocation is that the leftover goes somewhere specific, so which line
  -- holds it is not something to work out in your head.
  153.33::numeric,
  'and they are not forced to a carton price, because four is not a carton'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. AND NOT BY ANYONE HOLDING THE PUBLISHABLE KEY
-- ══════════════════════════════════════════════════════════════════════════
select ok(
  not has_function_privilege('anon', 'public.allocate_mixed_carton_totals(uuid)', 'execute'),
  'anon cannot rewrite what an order totals'
);

select * from finish();
rollback;

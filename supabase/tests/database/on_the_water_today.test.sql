-- Pass 24: the daily worklist never tells him to buy what he has already
-- bought. Regression guard for migration 0209.
--
-- ── THE STATE OF THE BUSINESS THAT PROMPTED IT ──────────────────────────────
--
-- On 2026-08-24 the top three rows of the dashboard worklist were three
-- products "Out of stock", each linking to /reorder — the screen for BUYING
-- MORE. All three were on SH-2026-002, expected on 2026-08-16, eight days
-- overdue and still in transit. Two more products on the same container were
-- also at zero. The goods were paid for and on the water, and the highest-
-- ranked advice on his home screen was to order them again.
--
-- ── WHAT THIS FILE IS REALLY GUARDING ───────────────────────────────────────
--
-- Not "does a shipment row appear" — that is one join. Two things that are
-- silent when they break:
--
--   THE MONEY IS COUNTED ONCE. The shipment row is worth the sales its
--   out-of-stock products lose in a week. If the stock-out rows survive
--   alongside it, the same MVR is on the list twice, and on a five-row list
--   an echo pushes real work off the bottom.
--
--   ON SCHEDULE IS NOT A PROBLEM. A shipment inside its expected date must say
--   nothing at all. A worklist that reports every open container becomes
--   wallpaper, and the stock-out row it would suppress is the one that is
--   genuinely still a buying decision.

begin;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000240', 'test-water@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000240';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000240', true);

do $$
declare
  c uuid; b uuid; g uuid; sup uuid;
  m_late uuid; m_soon uuid; m_none uuid; m_land uuid;
  v_late uuid; v_soon uuid; v_none uuid; v_land uuid;
  s_late uuid; s_soon uuid; s_none uuid; s_land uuid;
  ship_late uuid; ship_soon uuid; ship_land uuid;
  batch uuid; cust uuid; o uuid;
  sk uuid;
  -- TODAY IN MALDIVES TIME, because get_today counts days in that calendar.
  -- A fixture dated in UTC is a day out for the last five hours of every day,
  -- which is how "7 days late" reads back as 8.
  v_today date := (now() at time zone 'Indian/Maldives')::date;
begin
  select id into g from godowns limit 1;
  select id into sup from suppliers limit 1;

  insert into product_categories (name, unit_uom, cost_basis) values ('OW Nappies','pcs','piece') returning id into c;
  insert into brands (name) values ('OWBrand') returning id into b;

  -- FOUR PRODUCTS, IDENTICAL IN EVERY WAY THAT MATTERS. Same category, same
  -- brand, same pack size, same price, same stock history: received 40 days
  -- ago, sold out 10 days ago, so all four are 'out' with real demand behind
  -- them. The ONLY difference between them is which shipment, if any, is
  -- bringing more — so if the wrong one reaches the list, nothing but the new
  -- rule can be to blame.
  insert into product_models (brand_id, category_id, name) values (b, c, 'OW Late')    returning id into m_late;
  insert into product_models (brand_id, category_id, name) values (b, c, 'OW Soon')    returning id into m_soon;
  insert into product_models (brand_id, category_id, name) values (b, c, 'OW Nothing') returning id into m_none;
  insert into product_models (brand_id, category_id, name) values (b, c, 'OW Landed')  returning id into m_land;

  insert into variants (model_id, display_name, attributes) values (m_late,'Late M', '{"size":"M"}'::jsonb) returning id into v_late;
  insert into variants (model_id, display_name, attributes) values (m_soon,'Soon M', '{"size":"M"}'::jsonb) returning id into v_soon;
  insert into variants (model_id, display_name, attributes) values (m_none,'None M', '{"size":"M"}'::jsonb) returning id into v_none;
  insert into variants (model_id, display_name, attributes) values (m_land,'Land M', '{"size":"M"}'::jsonb) returning id into v_land;

  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v_late,'OW-LATE-M-10x2',10,2,300) returning id into s_late;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v_soon,'OW-SOON-M-10x2',10,2,300) returning id into s_soon;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v_none,'OW-NONE-M-10x2',10,2,300) returning id into s_none;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v_land,'OW-LAND-M-10x2',10,2,300) returning id into s_land;

  -- The same stock story for each: it came in, it all went out, it is at zero.
  foreach sk in array array[s_late, s_soon, s_none, s_land] loop
    insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                   landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr,
                                   source, received_at)
    values (sk, g, 10, 200, 10, 100, 200, 'direct', now() - interval '40 days') returning id into batch;
    insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
    values (batch, sk, g, 'in', 200, 'adjustment', now() - interval '40 days');
    insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
    values (batch, sk, g, 'out', 200, 'sales_order', now() - interval '10 days');
  end loop;

  -- Real sales, so the reorder engine has a velocity to price the loss at.
  insert into customers (name, phone) values ('OW Buyer','7714000') returning id into cust;
  foreach sk in array array[s_late, s_soon, s_none, s_land] loop
    insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
    values ('OW-' || sk::text, cust, 'delivered', g, now() - interval '12 days', now() - interval '12 days')
    returning id into o;
    insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
    values (o, sk, 'pack', 20, 200, 300, 6000);
    insert into order_payments (order_id, amount_mvr, method) values (o, 6000, 'cash');
  end loop;

  -- ── THREE SHIPMENTS, AND ONE PRODUCT ON NO SHIPMENT AT ALL ───────────────
  -- LATE: due a week ago and still not here. The container in the incident.
  insert into shipments (reference, supplier_id, status, expected_arrival_date,
                         rate_usd_to_mvr, rate_usd_to_idr)
  values ('OW-SHIP-LATE', sup, 'in_transit', v_today - 7, 15.4, 15400) returning id into ship_late;
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (ship_late, s_late, 10, 0.05, 100, 'USD', g);

  -- SOON: open, on schedule. Nothing has gone wrong, so nothing is said — and
  -- the product behind it is still a genuine buying decision.
  insert into shipments (reference, supplier_id, status, expected_arrival_date,
                         rate_usd_to_mvr, rate_usd_to_idr)
  values ('OW-SHIP-SOON', sup, 'in_transit', v_today + 14, 15.4, 15400) returning id into ship_soon;
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (ship_soon, s_soon, 10, 0.05, 100, 'USD', g);

  -- LANDED: physically here, not yet received, so every stock figure in the
  -- app is wrong until Ali does the GRN — and hard rule 3 locks the forex rate
  -- at that moment, so waiting books the goods at a rate that has since moved.
  insert into shipments (reference, supplier_id, status, expected_arrival_date,
                         rate_usd_to_mvr, rate_usd_to_idr)
  values ('OW-SHIP-LAND', sup, 'arrived', v_today - 1, 15.4, 15400) returning id into ship_land;
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (ship_land, s_land, 10, 0.05, 100, 'USD', g);
end $$;

-- ── THE CONTROL: nothing changed for a product nobody has bought more of ───
-- Asserted FIRST. If this fails, every check below is meaningless, because the
-- fixture would not be producing stock-out rows at all.
select is(
  (select count(*)::int from get_today(50)
    where kind = 'stockout' and title = 'OWBrand OW Nothing M'),
  1,
  'a product at zero with nothing on order is still a buying decision, exactly as before'
);

-- ── THE INCIDENT: it is one shipment row, not a reason to buy ──────────────
select is(
  (select count(*)::int from get_today(50)
    where kind = 'stockout' and title = 'OWBrand OW Late M'),
  0,
  'a product waiting on a LATE shipment is no longer told to be re-ordered — it is already bought'
);

select is(
  (select title from get_today(50) where kind = 'incoming' and title like 'OW-SHIP-LATE%'),
  'OW-SHIP-LATE is 7 days late',
  'the shipment itself is the row, named and counted in days late'
);

select matches(
  (select detail from get_today(50) where kind = 'incoming' and title like 'OW-SHIP-LATE%'),
  '1 product out of stock waiting on it',
  'and it says how many products are stuck behind it'
);

-- THE MONEY, COUNTED ONCE. The suppressed stock-out row was worth this; the
-- shipment row is worth the same. If both survived, the list would carry MVR
-- 3,500 of one problem twice.
select is(
  (select impact_mvr from get_today(50) where kind = 'incoming' and title like 'OW-SHIP-LATE%'),
  (select impact_mvr from get_today(50) where kind = 'stockout' and title = 'OWBrand OW Nothing M'),
  'and it is worth exactly what the stock-out row was worth — the same money, counted once'
);

select is(
  (select href from get_today(50) where kind = 'incoming' and title like 'OW-SHIP-LATE%'),
  '/shipments/' || (select id::text from shipments where reference = 'OW-SHIP-LATE'),
  'one tap opens the shipment, not the screen for ordering more'
);

-- ── ON SCHEDULE IS NOT A PROBLEM ───────────────────────────────────────────
select is(
  (select count(*)::int from get_today(50) where kind = 'incoming' and title like 'OW-SHIP-SOON%'),
  0,
  'a shipment still inside its expected date says nothing at all'
);

select is(
  (select count(*)::int from get_today(50)
    where kind = 'stockout' and title = 'OWBrand OW Soon M'),
  1,
  'and the product behind it is still a live buying decision — being on order early is not being on order late'
);

-- ── LANDED IS A DIFFERENT JOB, AND A DIFFERENT SENTENCE ────────────────────
-- "Chase the forwarder" and "receive it" are not the same action, so they must
-- not read as the same row.
select is(
  (select title from get_today(50) where kind = 'incoming' and title like 'OW-SHIP-LAND%'),
  'OW-SHIP-LAND has landed',
  'a shipment that has arrived says it has landed, never that it is late'
);

select matches(
  (select detail from get_today(50) where kind = 'incoming' and title like 'OW-SHIP-LAND%'),
  '^Landed, not yet received',
  'and names the job: it is here, and the GRN is owed'
);

-- ── NOT ONE PIECE COUNT ────────────────────────────────────────────────────
-- CLAUDE.md's units rule covers every word Ali reads, and a worklist row on
-- his home screen is one of them. These rows count PRODUCTS and MONEY, which
-- is why they can say nothing about pieces at all.
select is(
  (select count(*)::int from get_today(50)
    where kind = 'incoming' and (detail ~* '\mpcs\M' or detail ~* '\mpieces?\M')),
  0,
  'and no shipment row says pcs or pieces'
);

select * from finish();
rollback;

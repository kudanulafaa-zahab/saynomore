-- The ledger's self-check can actually catch things.
--
-- A guard that only ever returns zero is indistinguishable from a guard that
-- does nothing, and on a freshly replayed database every one of these
-- invariants is true because there is barely any data. So this file does not
-- assert "all clear" and call it a test. It BREAKS each invariant on purpose,
-- one at a time, and asserts the function notices — then puts it back.
--
-- The faults being simulated are not hypothetical. Each one is the shape of a
-- real fault that reached production and was found by hand:
--
--   line pieces vs pack config     2 packs of a 34 recorded as 64 nappies
--   batch pieces vs pack config    1 carton recorded as 128, code says 102
--   batch per-pack vs per-piece    per-pack computed at 32 x, product says 34
--   shipment line split            the same fault in the SECOND place it is
--                                  stored, which the first fix missed
--
-- Several of these are blocked by triggers on the way in — which is good, and
-- is why the app did not create more of them — so the triggers are disabled
-- around the deliberate corruption and restored immediately. That is the only
-- way to prove the detector works on data that already exists.

begin;
select plan(11);

-- Dropped up front, and only here. `sol_line_total_matches` refuses a line
-- whose total does not match qty x price, which is the right place for that
-- rule and makes the function's copy belt-and-braces rather than the only
-- defence. Check 1 below removes the braces to prove the belt holds. It has to
-- happen BEFORE the fixture: once a statement in this transaction has queued
-- trigger events Postgres refuses ALTER TABLE, and the rollback at the end
-- restores it.
-- ALL of the guards this file must step around are lifted HERE, before any
-- insert. Postgres refuses ALTER TABLE once a statement in the transaction has
-- queued trigger events, so it cannot be done next to the check that needs it.
-- Nothing is put back by hand: the rollback at the end restores every one.
--
-- That these guards exist at all is the point — they are why the app has not
-- created more of these faults. The detector is for rows that got in ANYWAY,
-- through a migration, a data load, or a pack size changed after the fact.
alter table sales_order_lines  drop constraint sol_line_total_matches;
alter table sales_order_lines  disable trigger trg_sol_qty_pieces;
alter table inventory_batches  disable trigger trg_block_batch_cost_changes;

-- ── A clean, complete fixture ────────────────────────────────────────────────
do $$
declare
  c uuid; b uuid; m uuid; v uuid; s uuid; g uuid;
  sup uuid; sh uuid; sl uuid; batch uuid; cust uuid; o uuid;
begin
  insert into product_categories (name, unit_uom, cost_basis) values ('LI Nappies','pcs','piece') returning id into c;
  insert into brands (name) values ('LIBrand') returning id into b;
  insert into product_models (brand_id, category_id, name) values (b,c,'LI Model') returning id into m;
  insert into variants (model_id, display_name, attributes) values (m,'L','{"size":"L"}'::jsonb) returning id into v;
  -- 10 to a pack, 4 packs to a carton = 40 a carton. Small numbers so every
  -- assertion below can be checked by eye.
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, sellable_units)
  values (v,'LI-10x4',10,4,array['pack','carton']::text[]) returning id into s;

  insert into godowns (name) values ('LI Godown') returning id into g;
  insert into suppliers (name) values ('LI Supplier') returning id into sup;
  insert into shipments (reference, supplier_id, status) values ('SH-LI-001', sup, 'grn_confirmed') returning id into sh;

  -- 1 carton = 40 pieces, MVR 400 landed => 10/piece, 100/pack, 400/carton.
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, qty_loose_packs, cbm_per_carton,
                              fob_per_carton, fob_currency,
                              landed_total_mvr, landed_per_carton_mvr, landed_per_pack_mvr,
                              landed_per_piece_mvr, landed_per_unit_mvr)
  values (sh, s, 1, 0, 0.05, 100, 'IDR', 400, 400, 100, 10, 10) returning id into sl;

  insert into inventory_batches (sku_id, godown_id, shipment_line_id, qty_cartons_received,
                                 qty_pieces_received, landed_per_piece_mvr, landed_per_pack_mvr,
                                 landed_per_carton_mvr, source)
  values (s, g, sl, 1, 40, 10, 100, 400, 'shipment') returning id into batch;

  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s, g, 'in', 40, 'shipment');

  insert into customers (name) values ('LI Customer') returning id into cust;
  insert into sales_orders (customer_id, status) values (cust,'delivered') returning id into o;
  -- 2 packs = 20 pieces, MVR 150 a pack.
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces,
                                 unit_price_mvr, line_total_mvr, landed_cost_per_piece_mvr)
  values (o, s, 'pack', 2, 20, 150, 300, 10);
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id)
  values (batch, s, g, 'out', 20, 'sales_order', o);
  insert into order_payments (order_id, amount_mvr, method) values (o, 300, 'cash');

  create temp table li as select s as sku, batch as bat, sl as line, o as ord, g as god;
end $$;

-- A clean fixture must be clean. If this fails everything below is noise.
select is(
  (select coalesce(string_agg(check_name, ', ' order by check_name), 'none')
     from get_ledger_integrity() where bad_rows > 0),
  'none',
  'a correctly built business passes every invariant'
);

-- AND SOMETHING WAS ACTUALLY LOOKED AT. Eleven zeroes is also what an empty
-- database returns, which is exactly how a guard stops guarding without anyone
-- noticing.
select cmp_ok(
  (select sum(rows_examined)::int from get_ledger_integrity()),
  '>', 0,
  'and it examined real rows rather than passing on an empty schema'
);

select is(
  (select count(*)::int from get_ledger_integrity()),
  11,
  'all eleven invariants are reported, not a subset'
);

-- ── Now break them, one at a time ────────────────────────────────────────────
-- Helper: does the named check currently report a fault?
create or replace function pg_temp.fires(p_check text) returns boolean
language sql as $$
  select coalesce((select bad_rows > 0 from get_ledger_integrity() where check_name = p_check), false);
$$;

-- 1. The money on a line stops matching qty x price.
--
-- This one cannot be broken by an ordinary write: `sol_line_total_matches`
-- already refuses it at ±0.02, which is the right place for it and means the
-- function's copy is belt-and-braces rather than the only line of defence. The
-- constraint is dropped for one statement to prove the belt works if the braces
-- are ever removed — a constraint can be dropped by a future migration, and
-- then this would be all that is left.
update sales_order_lines set line_total_mvr = 999 where sku_id = (select sku from li);
select ok(pg_temp.fires('order line total vs qty x price'),
  'a line whose total stops matching qty x price is caught');
update sales_order_lines set line_total_mvr = 300 where sku_id = (select sku from li);
-- Not re-added: Postgres refuses ALTER TABLE once a statement in this
-- transaction has queued trigger events, and the whole file rolls back at the
-- end anyway, so the constraint is restored by that.

-- 2. The XXXL sale fault: 2 packs of a 10 recorded as 16 pieces.
update sales_order_lines set qty_pieces = 16 where sku_id = (select sku from li);
select ok(pg_temp.fires('line pieces vs pack config'),
  'a sold line whose pieces disagree with the pack size is caught');

-- 3. The XXXL batch fault: a carton received as more than a carton holds.
update inventory_batches set qty_pieces_received = 48 where id = (select bat from li);
select ok(pg_temp.fires('batch pieces vs pack config'),
  'a batch whose piece count disagrees with the pack size is caught');
update inventory_batches set qty_pieces_received = 40 where id = (select bat from li);

-- 4. The batch's own cost columns disagree with the pack size.
update inventory_batches set landed_per_pack_mvr = 80 where id = (select bat from li);
select ok(pg_temp.fires('batch per-pack vs per-piece'),
  'a batch costed against the wrong pack size is caught');
update inventory_batches set landed_per_pack_mvr = 100 where id = (select bat from li);

-- 5. THE SECOND PLACE. The fault the first fix missed entirely.
-- The ratio between the line's per-pack and per-piece stops matching the pack
-- size — the exact shape of the fault 0192 had to clean up.
update shipment_lines set landed_per_pack_mvr = 80 where id = (select line from li);
select ok(pg_temp.fires('shipment line split vs pack config'),
  'the same fault on the SHIPMENT LINE is caught — the copy the first fix missed');
update shipment_lines set landed_per_pack_mvr = 100 where id = (select line from li);

-- A DIFFERENT fault, and it needs a different break: this one compares the
-- batch's per-piece cost against its own line's, so moving the per-PACK above
-- leaves it correctly silent. Getting that wrong the first time is the same
-- mistake as fixing the batch and calling the job done.
update shipment_lines set landed_per_piece_mvr = 12 where id = (select line from li);
select ok(pg_temp.fires('batch vs its shipment line'),
  'and a batch that stops agreeing with its own shipment line is caught');
update shipment_lines set landed_per_piece_mvr = 10 where id = (select line from li);

-- 6. Stock goes negative.
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ((select bat from li), (select sku from li), (select god from li), 'out', 5000, 'adjustment');
select ok(pg_temp.fires('negative stock bucket'),
  'stock driven below zero is caught');

-- 7. Somebody pays more than the order is worth.
insert into order_payments (order_id, amount_mvr, method) values ((select ord from li), 5000, 'cash');
select ok(pg_temp.fires('overpaid order'),
  'an order paid more than it is worth is caught');

select * from finish();
rollback;

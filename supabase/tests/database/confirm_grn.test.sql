-- Pass 2: confirm_grn, the function that locks landed cost and turns a
-- shipment into real, sellable stock. Uses the shared fixture from
-- supabase/seed.sql (one SKU: 34 pcs/pack, 3 packs/carton).

begin;
select plan(5);

-- A fake admin session -- confirm_grn is is_admin_or_manager()-gated, and
-- auth.uid() just reads a session setting, so this is real Postgres, not a
-- mock framework. set_config(..., true) is transaction-local, so it never
-- escapes this test's begin/rollback. Inserting into auth.users fires
-- handle_new_user(), which auto-creates the user_profiles row as 'staff' --
-- promote it to admin afterward rather than inserting a second row.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000010', 'test-admin@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000010';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000010', true);

-- ── 1. Hard rule 4: a zero-CBM line blocks the GRN ────────────────────────
-- Found while writing this test: the guarantee is actually one layer deeper
-- than confirm_grn's own "All lines must have CBM > 0" check -- a table
-- CHECK constraint (shipment_lines_cbm_per_carton_check) refuses the row at
-- INSERT time, so confirm_grn's own check can never actually fire through
-- the normal write path. Testing the real, reachable guarantee.
-- rate_idr_to_mvr is derived (trigger trg_derive_idr_to_mvr, migration 0042)
-- from rate_usd_to_mvr / rate_usd_to_idr -- never typed directly, so it is
-- never set here either, only its two inputs.
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000011', 'TEST-SHIP-ZEROCBM',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);

select throws_ok(
  $$insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                                 fob_per_carton, fob_currency, destination_godown_id)
    values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000005',
            2, 0, 10, 'USD', '00000000-0000-0000-0000-000000000006')$$,
  'new row for relation "shipment_lines" violates check constraint "shipment_lines_cbm_per_carton_check"',
  'a zero-CBM shipment line is refused at insert time, before confirm_grn is ever called'
);

-- ── 2-5. A valid GRN locks stock at the right quantity ────────────────────
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000012', 'TEST-SHIP-VALID',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);
insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                             fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000005',
        2, 0.036, 10, 'USD', '00000000-0000-0000-0000-000000000006');

select lives_ok(
  $$select confirm_grn('00000000-0000-0000-0000-000000000012'::uuid)$$,
  'confirm_grn succeeds when every line has real CBM and quantity'
);

select is(
  (select status from shipments where id = '00000000-0000-0000-0000-000000000012'),
  'grn_confirmed',
  'shipment status flips to grn_confirmed'
);

-- 2 cartons x 3 packs/carton x 34 pcs/pack = 204 pieces -- the SKU-code
-- convention (skills.md): the code is what's authoritative, never a count
-- that disagrees with it.
select is(
  (select qty_pieces_received from inventory_batches
    where shipment_line_id = (select id from shipment_lines
                               where shipment_id = '00000000-0000-0000-0000-000000000012')),
  204,
  'batch receives exactly qty_cartons x packs_per_carton x pcs_per_pack pieces'
);

select is(
  (select sum(qty_pieces) from stock_movements
    where sku_id = '00000000-0000-0000-0000-000000000005' and movement_type = 'in'),
  204::bigint,
  'the stock ledger (stock_movements) gets a matching in movement -- stock is derived from this sum, never stored directly (hard rule 2)'
);

select * from finish();
rollback;

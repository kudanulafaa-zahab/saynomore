-- Pass 20: a product that is ready is never called unready, and one that is
-- not ready says so. Regression guard for migration 0202.
--
-- Ali, 2026-08-24: *"Solve the problems professionally so it doesn't repeat and
-- I will be able to add any new product without coming back and debugging every
-- time."*
--
-- ── THE ONE THAT WOULD HAVE BROUGHT HIM BACK ────────────────────────────────
--
-- Migration 0201 moved every single-item product — tub, jar, bar, tube, bedding
-- set — onto the `pack` tier, because a piece-only product is one the ledger
-- refuses to sell. The New SKU sheet has always written a single item's price to
-- `fixed_selling_price_mvr`. So from 0201 onward EVERY such product is born with
-- a `pack` tier and its price on the per-piece column, and Margin Watch read
-- exactly that shape as UNPRICED — while the sell sheet charged the customer the
-- number sitting right there.
--
-- Two engines, one row, opposite answers, on every product he adds from now on.
--
-- ── AND THE GUARD IT MUST NOT UNDO ──────────────────────────────────────────
--
-- Migration 0162 made a 32-per-pack diaper carrying only a per-piece figure read
-- 'no_price' ON PURPOSE: MVR 7.19 x 32 is an inference, not a price Ali set. The
-- obvious fix here — scale the per-piece figure by the pack size — would have
-- silently undone that. It is only legitimate when ONE PIECE IS ONE UNIT, where
-- the two columns hold the same number for the same thing. Both cases are
-- asserted below, because a fix that breaks the guard it was meant to respect is
-- worse than the bug.

begin;
select plan(15);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000200', 'test-gaps@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000200';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000200', true);

-- ── The helper, on its own ─────────────────────────────────────────────────
select is(
  price_per_unit(380, null, 1), 380::numeric,
  'a price set for the unit itself is the price'
);
select is(
  price_per_unit(null, 380, 1), 380::numeric,
  'a SINGLE ITEM falls back to its per-piece figure -- one tub is one pack, so it is the same money'
);
select is(
  price_per_unit(null, 7.19, 32), null::numeric,
  'a 32-per-pack product does NOT -- 7.19 x 32 is an inference, and migration 0162 exists to refuse it'
);
select is(
  price_per_unit(230, 7.19, 32), 230::numeric,
  'but its real pack price still wins, so 0162 loses nothing'
);

-- ── The regression: a single item priced the way the app prices it ─────────
--
-- Exactly what the New SKU sheet writes for a tub today: pack tier, one piece
-- per pack, price on the per-piece column. It has stock and a landed cost, so
-- get_pricing_health is in scope for it and CAN report on it.
insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-000000000201', 'SH-TEST-GAPS',
        '00000000-0000-0000-0000-000000000007', 15.4, 15400);

insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_selling_price_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000004',
        'TEST-TUB-1x1', 1, 1, 20, 20, 20, 380, array['pack']);

insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000201',
        '00000000-0000-0000-0000-000000000202', 6, 0.008, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000203',
        '00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000006',
        now() - interval '2 days', 6, 6, 123, 123, 123);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000202',
        '00000000-0000-0000-0000-000000000006', 'in', 6, 'shipment');

select is_empty(
  $$select status from get_pricing_health()
     where sku_id = '00000000-0000-0000-0000-000000000202'$$,
  'a tub priced MVR 380 is HEALTHY -- it used to read "no price" while the till charged 380, on every single-item product the app can now create'
);

-- ...and the catalogue report agrees. Two engines, one answer.
select is_empty(
  $$select gap from get_setup_gaps()
     where sku_id = '00000000-0000-0000-0000-000000000202'$$,
  'and nothing about it is reported unfinished'
);

-- ── A product with no price at all, and NO STOCK ───────────────────────────
--
-- THE CASE NOTHING COULD SEE. get_pricing_health inner-joins stock, by design —
-- its job is the money in the godown. So a product with no price and no stock
-- was invisible until the day a container landed and someone tried to sell it.
-- X-Tra Kering NB/S is in exactly this state on production right now.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm, sellable_units)
values ('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000004',
        'TEST-NOPRICE-44x4', 44, 4, 40, 30, 30, array['pack','carton']);

select is(
  (select gap from get_setup_gaps() where sku_id = '00000000-0000-0000-0000-000000000205'),
  'no_price',
  'a product with no price and no stock is REPORTED -- Margin Watch cannot see it, because it only looks at stock'
);

select is(
  (select blocks from get_setup_gaps() where sku_id = '00000000-0000-0000-0000-000000000205'),
  'Cannot be sold',
  'and it says what that stops him doing, not just that something is missing'
);

-- ── A TARGET MARGIN IS A PRICE (migration 0204) ────────────────────────────
--
-- THE FIRST VERSION OF THIS REPORT WAS WRONG ON PRODUCTION, and it was wrong in
-- the way that costs trust: plausibly. X-Tra Kering NB/S carries no fixed price
-- on any column but does carry target_margin_pct = 44.90, and the sell sheet
-- quotes it at MVR 170 a pack and MVR 680 a carton — computed from that margin
-- against its last known landed cost, as v_skus has always done. The report
-- announced "No price for a carton — sells by the pack, but a carton cannot be
-- quoted". Both halves false.
--
-- 0202's header claimed to remove a second opinion about what a price is. It
-- removed one and built a third: it asked "is a FIXED price stored" when the
-- question that matters is "can a number be quoted today". 0204 makes the report
-- read v_skus — the sell sheet's own columns — so it cannot contradict what a
-- customer would actually be charged.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  target_margin_pct, sellable_units)
values ('00000000-0000-0000-0000-00000000020a', '00000000-0000-0000-0000-000000000004',
        'TEST-MARGINPRICED-44x4', 44, 4, 40, 30, 30, 44.90, array['pack','carton']);

insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-00000000020b', '00000000-0000-0000-0000-000000000201',
        '00000000-0000-0000-0000-00000000020a', 1, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-00000000020c', '00000000-0000-0000-0000-00000000020b',
        '00000000-0000-0000-0000-00000000020a', '00000000-0000-0000-0000-000000000006',
        now() - interval '2 days', 1, 176, 2.13, 93.72, 374.88);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-00000000020c', '00000000-0000-0000-0000-00000000020a',
        '00000000-0000-0000-0000-000000000006', 'in', 176, 'shipment');

-- The premise, asserted rather than assumed: the sell sheet really can quote it.
-- Without this the test below would pass for the wrong reason if v_skus ever
-- stopped deriving from a target margin.
select isnt(
  (select selling_price_per_carton_mvr from v_skus where id = '00000000-0000-0000-0000-00000000020a'),
  null,
  'the sell sheet CAN quote a carton of a target-margin product, from its landed cost'
);

select is_empty(
  $$select gap from get_setup_gaps()
     where sku_id = '00000000-0000-0000-0000-00000000020a'$$,
  'so the report says nothing about it -- a target margin IS a price, and calling it unfinished was a false alarm on real production data'
);

-- ── No carton size: hard rule 4, found before the container, not after ─────
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  fixed_price_per_pack_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000206', '00000000-0000-0000-0000-000000000004',
        'TEST-NOCBM-1x1', 1, 1, 380, array['pack']);

select is(
  (select gap from get_setup_gaps() where sku_id = '00000000-0000-0000-0000-000000000206'),
  'no_carton_size',
  'a product with no carton measurements is reported -- a zero-CBM line blocks the GRN, and today nothing says so until the container is on the water'
);

-- NEVER A PIECE COUNT, ANYWHERE HE READS. The report carries stock figures, so
-- it is a door the units rule has to hold at (CLAUDE.md: it covers every word
-- Ali reads, not only app screens).
select is_empty(
  $$select internal_code from get_setup_gaps()
     where headline || ' ' || blocks || ' ' || stock_label ~* '\mpcs\M|\mpieces?\M'$$,
  'no row says "pcs" or "pieces" -- every quantity is in packs, cartons or the product''s own unit'
);

-- ── A finished product is SILENT ───────────────────────────────────────────
--
-- The rule that makes the list worth reading: it is empty when nothing is
-- wrong. A report that always shows something is one nobody looks at.
--
-- THE CASE IS BUILT, NOT BORROWED. The first version asserted this against a
-- SKU from the shared fixture and failed — because that SKU genuinely has no
-- price, so the test was wrong and the function was right. money_rules.test.sql
-- already carries the same lesson in its header: a money test that leans on
-- whichever seed happens to be loaded is testing the seed, not the rule.
--
-- Deliberately a MULTI-PIECE pack/carton product, which the tub above is not:
-- it exercises the path where the per-piece fallback must NOT fire.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-000000000207', '00000000-0000-0000-0000-000000000004',
        'TEST-COMPLETE-48x4', 48, 4, 40, 30, 30, 199, 776, array['pack','carton']);

insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-000000000208', '00000000-0000-0000-0000-000000000201',
        '00000000-0000-0000-0000-000000000207', 2, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-000000000209', '00000000-0000-0000-0000-000000000208',
        '00000000-0000-0000-0000-000000000207', '00000000-0000-0000-0000-000000000006',
        now() - interval '2 days', 2, 384, 3.00, 144.00, 576.00);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-000000000209', '00000000-0000-0000-0000-000000000207',
        '00000000-0000-0000-0000-000000000006', 'in', 384, 'shipment');

select is_empty(
  $$select gap from get_setup_gaps()
     where sku_id = '00000000-0000-0000-0000-000000000207'$$,
  'a fully set-up product appears nowhere in the list -- the report is silent when nothing is wrong'
);

-- ── anon cannot read the catalogue through either door ─────────────────────
-- REVOKE FROM anon does NOT remove the grant anon holds through PUBLIC, which
-- Postgres gives every new function. 0202's own guard caught that; this asks
-- the question the way an attacker would.
select ok(
  not has_function_privilege('anon', 'public.get_setup_gaps()', 'execute'),
  'anon cannot execute get_setup_gaps -- it lists the whole catalogue with stock'
);
select ok(
  not has_function_privilege('anon', 'public.price_per_unit(numeric, numeric, integer)', 'execute'),
  'and cannot execute price_per_unit either'
);

select * from finish();
rollback;

-- One product, one margin — migration 0217.
--
-- Ali, 2026-08-28, about the app as a whole:
--   *"It's getting too complicated... poorly designed. Convene proper experts
--    and focus on giving a professional app. Not adhoc corrections."*
--
-- Asked what margin Sosoft earns after SH-2026-002, the app gave two answers:
-- **9.6%** in the Price Book and **10.4%** everywhere else. Both were
-- arithmetically right and neither said which question it was answering.
--
--   Price Book       measured per CARTON, from the CATEGORY's
--                    `default_sellable_units`, with any mixed-carton brand
--                    forced to carton outright.
--   Everything else  measured per BOTTLE, from the PRODUCT's own
--                    `sellable_units`.
--
-- The same check found X-Tra Kering NB/S reading 45.0% in one place and BLANK
-- in the other, because `v_skus.actual_margin_pct` rebuilt the price from the
-- FIXED columns only — so a product the app quotes, sells and invoices at
-- MVR 218 a pack had no margin at all.
--
-- WHAT THESE TESTS DEFEND, AND WHY IT IS THE FUNCTION AND NOT THE ANSWER:
-- asserting only that the two agree would pass on two inlined copies that
-- happen to agree today and drift on the next edit. So the shape is checked
-- too — both callers must READ `margin_unit()`, and it must be the kind of
-- helper Postgres can still inline.

begin;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000006a0', 'test-margin@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000006a0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a0', true);

-- ── A. The rule itself ─────────────────────────────────────────────────────
select is(margin_unit(array['pack','carton']), 'pack',
  'a product sold by the pack AND the carton is measured by the PACK -- the smaller unit is the one most sales are in');
select is(margin_unit(array['carton']), 'carton',
  'a carton-only product is measured by the carton');
select is(margin_unit(array['carton','pack']), 'pack',
  'and the ARRAY ORDER does not decide it -- Sosoft stores {carton,pack} and read as a carton product for exactly that reason');
select is(margin_unit(null), 'pack',
  'a legacy row with no units at all falls back to the pack, never to a piece nobody trades in');

-- INLINABLE. helpers_can_inline.test.sql enumerates the catalogue and fails on
-- a pure SQL helper carrying a SET clause; this one is named here as well
-- because it is the newest member of that family and the cost of the mistake
-- (a GUC save and restore per row, on every price screen) is invisible.
select is(
  (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'margin_unit'),
  null,
  'margin_unit carries no SET clause, so Postgres can still inline it'
);

-- ── B. Both callers READ the rule ──────────────────────────────────────────
select matches(
  pg_get_functiondef('public.get_price_book()'::regprocedure),
  'margin_unit',
  'the Price Book reads the shared rule instead of deciding the unit itself'
);
select matches(
  pg_get_viewdef('public.v_skus'::regclass, true),
  'margin_unit',
  'and so does v_skus, which is what every other screen reads'
);
select doesnt_match(
  pg_get_functiondef('public.get_price_book()'::regprocedure),
  'default_sellable_units',
  'the Price Book no longer reads the CATEGORY default, which is a suggestion for NEW products and not a fact about this one'
);

-- ── C. A mixed-carton brand sold three ways ────────────────────────────────
-- The exact shape of Sosoft since 0208: one bottle to a "pack", six to a
-- carton, a brand with mixed_carton_pieces set. The old override forced this
-- to the carton on sight.
insert into brands (id, name, mixed_carton_pieces)
values ('00000000-0000-0000-0000-0000000006b0', 'Test Mixed Brand', 6);
insert into product_categories (id, name, unit_uom, cost_basis, default_sellable_units)
values ('00000000-0000-0000-0000-0000000006b1', 'Test Bottles', 'ml', 'per_100ml', array['carton']);
insert into product_models (id, category_id, brand_id, name)
values ('00000000-0000-0000-0000-0000000006b2', '00000000-0000-0000-0000-0000000006b1',
        '00000000-0000-0000-0000-0000000006b0', 'Test Colour');
insert into variants (id, model_id, display_name)
values ('00000000-0000-0000-0000-0000000006b3', '00000000-0000-0000-0000-0000000006b2', '700ml');
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                  carton_length_cm, carton_width_cm, carton_height_cm,
                  fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
values ('00000000-0000-0000-0000-0000000006b4', '00000000-0000-0000-0000-0000000006b3',
        'TEST-MIXED-1x6', 1, 6, 40, 30, 30, 40, 220, array['carton','pack']);

insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
values ('00000000-0000-0000-0000-0000000006c0', 'SH-TEST-MARGIN',
        '00000000-0000-0000-0000-000000000007', 20.5, 16000);
insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                            fob_per_carton, fob_currency, destination_godown_id)
values ('00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006c0',
        '00000000-0000-0000-0000-0000000006b4', 1, 0.036, 10, 'USD',
        '00000000-0000-0000-0000-000000000006');
insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                               qty_cartons_received, qty_pieces_received,
                               landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
values ('00000000-0000-0000-0000-0000000006c2', '00000000-0000-0000-0000-0000000006c1',
        '00000000-0000-0000-0000-0000000006b4', '00000000-0000-0000-0000-000000000006',
        now() - interval '1 day', 1, 6, 30, 30, 180);
insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
values ('00000000-0000-0000-0000-0000000006c2', '00000000-0000-0000-0000-0000000006b4',
        '00000000-0000-0000-0000-000000000006', 'in', 6, 'shipment');

-- MVR 30 a bottle against a MVR 40 bottle price = 25.0%.
-- By the carton it would be (220 - 180) / 220 = 18.2% — the wrong answer, and
-- the one the Price Book used to give.
select is(
  (select trade_unit from get_price_book() where sku_id = '00000000-0000-0000-0000-0000000006b4'),
  'pack',
  'a mixed-carton brand that also sells single bottles is measured by the BOTTLE -- being a mixed-carton brand is not a pricing basis'
);
select is(
  (select margin_pct from get_price_book() where sku_id = '00000000-0000-0000-0000-0000000006b4'),
  25.0::numeric,
  'so it earns 25.0% on a MVR 40 bottle, not the 18.2% a carton basis reports'
);

-- ── D. THE OUTCOME, over every product there is ────────────────────────────
-- The assertion Ali's question actually asks. It holds for the fixture
-- catalogue and for production, and it is the one that fails first if either
-- caller starts deciding for itself again.
select is_empty(
  $$select pb.internal_code
      from get_price_book() pb
      join v_skus vs on vs.id = pb.sku_id
     where pb.margin_pct is distinct from vs.actual_margin_pct$$,
  'no product reports one margin on one screen and a different one on another'
);

select * from finish();
rollback;

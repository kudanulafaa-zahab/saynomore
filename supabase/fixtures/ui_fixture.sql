-- UI fixture — the data the browser audits drive.
--
-- NOT a seed. It is applied on demand by scripts/audit/seed.mjs against a
-- local, disposable database; nothing here ever runs against production, and
-- supabase/seed.sql is deliberately left alone so the pgTAP suite keeps
-- counting rows it put there itself.
--
-- It mirrors production's SHAPE rather than its size, because that is what the
-- screens react to: one mixed-carton brand with four colours (Sosoft, six
-- bottles to a carton, carton-only) and one ordinary diaper sold by the pack
-- and the carton (Mamypoko). Between them they exercise every branch the cart
-- has — a whole single-colour carton, a mixed carton, and a plain product —
-- which is exactly where every cart bug this month has been.
--
-- IDEMPOTENT, and it has to be: the first version generated fresh UUIDs on each
-- run, so `on conflict (id)` never fired and the second run died on the
-- (brand_id, name) unique key. Worse, the stock movements have no natural key,
-- so a partial re-run would have doubled the stock and quietly invalidated
-- every quantity the audits assert. Everything is a fixed UUID now, and the
-- whole file is one block that returns early if it has already been applied.

do $$
declare
  v_supplier uuid := '00000000-0000-0000-0000-0000000f0001';
  v_godown   uuid := '00000000-0000-0000-0000-0000000f0002';
  v_customer uuid := '00000000-0000-0000-0000-0000000f0003';
  v_cat_liq  uuid := '00000000-0000-0000-0000-0000000f0010';
  v_cat_det  uuid := '00000000-0000-0000-0000-0000000f0012';
  v_brand_dt uuid := '00000000-0000-0000-0000-0000000f0013';
  v_cat_dia  uuid := '00000000-0000-0000-0000-0000000f0011';
  v_brand_so uuid := '00000000-0000-0000-0000-0000000f0020';
  v_brand_mp uuid := '00000000-0000-0000-0000-0000000f0021';
  v_ship     uuid := '00000000-0000-0000-0000-0000000f0030';

  colours text[][] := array[['Blue','Rose & Water Lily Bottle 700ml'],
                            ['Pink','Sweet Peony Bottle 700ml'],
                            ['Purple','Fresia & Pear Bottle 700ml'],
                            ['Red','Sakura Blossom Bottle 700ml']];
  i int;
  v_model uuid; v_variant uuid; v_sku uuid; v_line uuid; v_batch uuid;

  -- Deterministic ids, so a re-run collides on the primary key (which is
  -- handled) instead of on a unique constraint (which is not).
  function_prefix text := '00000000-0000-0000-0000-0000000f';
begin
  if exists (select 1 from brands where id = v_brand_so) then
    raise notice 'ui fixture already applied — nothing to do';
    return;
  end if;

  insert into suppliers (id, name) values (v_supplier, 'Fixture Supplier');
  insert into godowns   (id, name) values (v_godown, 'Veesange');
  insert into customers (id, name, phone, price_tier)
    values (v_customer, 'Ahmed Ziyad', '7771234', 'retail');

  insert into product_categories (id, name, unit_uom, cost_basis, default_sellable_units)
  values (v_cat_liq, 'Fixture Liquid', 'ml', 'per_100ml', array['pack','carton']),
         (v_cat_dia, 'Fixture Diapers', 'pcs', 'piece', array['pack','carton']),
         -- CARTON-ONLY, and it has to be a real one. Sosoft used to be the
         -- fixture's only carton-only product; migration 0208 gave it a bottle
         -- tier because that is what production has, and that quietly removed
         -- the shape `audit:pricing` exists to guard — a product with a carton
         -- price and NO pack price, which once crashed the Pricing Tool
         -- outright. The gate caught the removal, which is the gate working.
         --
         -- Detergent is what carton-only actually IS in this business: both
         -- detergent categories on production still default to {carton}, so
         -- Ali can create one of these tomorrow even though none is stocked
         -- today. The fixture keeps the shape reachable rather than pretending
         -- it cannot happen.
         (v_cat_det, 'Fixture Detergent', 'ml', 'per_100ml', array['carton']);

  insert into brands (id, name, mixed_carton_pieces)
  values (v_brand_so, 'Sosoft', 6),
         (v_brand_mp, 'Mamypoko', null),
         (v_brand_dt, 'Fixture Detergent Co', null);

  insert into shipments (id, reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
  values (v_ship, 'SH-FIXTURE', v_supplier, 15.4, 15400);

  -- ── Sosoft: four colours, carton-only, six bottles to a mixed carton ──────
  for i in 1..4 loop
    v_model   := (function_prefix || '1' || lpad(i::text, 3, '0'))::uuid;
    v_variant := (function_prefix || '2' || lpad(i::text, 3, '0'))::uuid;
    v_sku     := (function_prefix || '3' || lpad(i::text, 3, '0'))::uuid;
    v_line    := (function_prefix || '4' || lpad(i::text, 3, '0'))::uuid;
    v_batch   := (function_prefix || '5' || lpad(i::text, 3, '0'))::uuid;

    insert into product_models (id, category_id, brand_id, name)
      values (v_model, v_cat_liq, v_brand_so, colours[i][1]);
    insert into variants (id, model_id, display_name)
      values (v_variant, v_model, colours[i][2]);
    -- SOLD BY THE CARTON **AND** ONE BOTTLE AT A TIME, as production is since
    -- migration 0208. This said `array['carton']` and re-wrote what the
    -- migration had just set, so every browser audit ran against a Sosoft that
    -- could not be sold singly — the fixture quietly undoing the change it was
    -- meant to exercise, exactly like the audit fixtures that kept writing the
    -- piece-only shape 0200 had repaired.
    --
    -- MVR 40 a bottle, NOT 220/6. A single sells for more than a sixth of a
    -- case; a fixture that prices it at the carton rate would let a screen
    -- charge the wrong figure and still pass.
    insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                      carton_length_cm, carton_width_cm, carton_height_cm,
                      fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
      values (v_sku, v_variant, 'SOSO-' || upper(colours[i][1]) || '-1x6',
              1, 6, 40, 30, 30, 40, 220, array['pack', 'carton']);
    insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                                fob_per_carton, fob_currency, destination_godown_id)
      values (v_line, v_ship, v_sku, 20, 0.036, 10, 'USD', v_godown);
    insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                   qty_cartons_received, qty_pieces_received,
                                   landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
      values (v_batch, v_line, v_sku, v_godown, now() - interval '5 days',
              20, 120, 22.16, 22.16, 132.99);
    insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
      values (v_batch, v_sku, v_godown, 'in', 120, 'shipment');
  end loop;

  -- ── One ordinary diaper, so the cart shows a normal product beside them ───
  v_model   := (function_prefix || '1999')::uuid;
  v_variant := (function_prefix || '2999')::uuid;
  v_sku     := (function_prefix || '3999')::uuid;
  v_line    := (function_prefix || '4999')::uuid;
  v_batch   := (function_prefix || '5999')::uuid;

  insert into product_models (id, category_id, brand_id, name)
    values (v_model, v_cat_dia, v_brand_mp, 'Xtra Kering');
  insert into variants (id, model_id, display_name)
    values (v_variant, v_model, 'L');
  insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm,
                    fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
    values (v_sku, v_variant, 'MAMY-XTRA-L-42x4', 42, 4, 50, 40, 40, 199, 776,
            array['pack','carton']);
  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
    values (v_line, v_ship, v_sku, 10, 0.08, 40, 'USD', v_godown);
  insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
    values (v_batch, v_line, v_sku, v_godown, now() - interval '5 days',
            10, 1680, 3.05, 128.1, 512.4);
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
    values (v_batch, v_sku, v_godown, 'in', 1680, 'shipment');

  -- ── A CARTON-ONLY product, priced only by the carton ─────────────────────
  -- The shape `audit:pricing` guards: a carton price, NO pack price. Reaching
  -- the Pricing Tool with one of these once crashed it outright, and the fix
  -- is only proven while the fixture still contains one. Sosoft used to be it;
  -- 0208 gave Sosoft a bottle tier to match production, so this took over.
  v_model   := (function_prefix || '6000')::uuid;
  v_variant := (function_prefix || '6001')::uuid;
  v_sku     := (function_prefix || '6002')::uuid;
  v_line    := (function_prefix || '6003')::uuid;
  v_batch   := (function_prefix || '6004')::uuid;

  insert into product_models (id, category_id, brand_id, name)
    values (v_model, v_cat_det, v_brand_dt, 'Power Clean');
  insert into variants (id, model_id, display_name)
    values (v_variant, v_model, '1L');
  insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm,
                    fixed_price_per_carton_mvr, sellable_units)
    values (v_sku, v_variant, 'DETG-POWER-1L-1x12', 1, 12, 40, 30, 30, 480,
            array['carton']);
  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
    values (v_line, v_ship, v_sku, 5, 0.036, 20, 'USD', v_godown);
  insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
    values (v_batch, v_line, v_sku, v_godown, now() - interval '5 days',
            5, 60, 26.00, 26.00, 312.00);
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
    values (v_batch, v_sku, v_godown, 'in', 60, 'shipment');

  -- ── A SECOND shipment, arrived and waiting to be received ─────────────────
  -- The first shipment's batches were inserted directly, which is fine for
  -- giving the app stock to sell but means confirm_grn — the biggest money
  -- calculation in the system — is never exercised. This one is left ARRIVED
  -- with freight and duty on it and no batches, so the GRN audit can drive the
  -- real thing through the real screen and check the landed cost that comes out.
  --
  -- Two lines with DIFFERENT carton sizes on purpose: freight is apportioned by
  -- each line's share of total CBM, so a single-line shipment would apportion
  -- 100% to it and prove nothing.
  --   freight  USD 2,000  -> MVR 30,800 at 15.4, apportioned by CBM share
  --   local     MVR  7,700  (MPL + agent + last mile), same CBM apportionment
  --   duty      MVR 15,400  apportioned by rate-weighted FOB value, not CBM
  insert into shipments (id, reference, supplier_id, status,
                         rate_usd_to_mvr, rate_usd_to_idr, rate_idr_to_mvr,
                         my_freight_share_usd, customs_duty_mvr,
                         mpl_charges_mvr, agent_fee_mvr, last_mile_mvr)
  values ('00000000-0000-0000-0000-0000000f0031', 'SH-FIXTURE-GRN', v_supplier, 'arrived',
          15.4, 15400, 0.001, 2000, 15400, 5000, 2000, 700);
  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values ('00000000-0000-0000-0000-0000000f0032', '00000000-0000-0000-0000-0000000f0031',
          (function_prefix || '3001')::uuid, 10, 0.036, 10, 'USD', v_godown),
         ('00000000-0000-0000-0000-0000000f0033', '00000000-0000-0000-0000-0000000f0031',
          (function_prefix || '3999')::uuid, 10, 0.080, 40, 'USD', v_godown);

  -- ── A product sold ONE AT A TIME — the Body Shop shape ────────────────────
  -- ADDED 2026-08-23 for the same reason. money_rules allows a 'piece' tier
  -- only when ONE PIECE IS ONE WHOLE ITEM (pcs_per_pack = 1), which is what
  -- makes the app print the product's own noun — "tub" — instead of the word
  -- "piece". Five real Body Shop tubs are exactly this, and the fixture had
  -- none, so the exception went untested.
  insert into brands (id, name, mixed_carton_pieces)
  values ('00000000-0000-0000-0000-0000000fc106', 'Fixture Bodycare', null);
  insert into product_categories (id, name, unit_uom, cost_basis)
  values ('00000000-0000-0000-0000-0000000fc100', 'Fixture Tubs', 'tub', 'piece');
  insert into product_models (id, category_id, brand_id, name)
  values ('00000000-0000-0000-0000-0000000fc101', '00000000-0000-0000-0000-0000000fc100',
          '00000000-0000-0000-0000-0000000fc106', 'Body Butter');
  insert into variants (id, model_id, display_name)
  values ('00000000-0000-0000-0000-0000000fc102', '00000000-0000-0000-0000-0000000fc101', '200ml Shea');
  insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm,
                    fixed_selling_price_mvr, sellable_units)
  values ('00000000-0000-0000-0000-0000000fc103', '00000000-0000-0000-0000-0000000fc102',
          'FIXTURE-TUB-1x1', 1, 1, 10, 10, 12, 380, array['pack']);

  -- …and give it stock. A priced product with no batch is legitimately WORK —
  -- today.test.sql asserts "a business with nothing wrong is given nothing to
  -- do", and adding the tub without stock handed the briefing a real task and
  -- broke that test. The app was right and the fixture was wrong: a fixture
  -- product should be healthy unless it exists to be unhealthy.
  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  -- FOUR, not twelve. Twelve tubs against a single sale is 990 days of cover,
  -- which the Promo Advisor rightly calls dead stock — and that broke
  -- today.test.sql's "a business with nothing wrong is given nothing to do".
  -- Four in and one sold is 270 days: a real product, moving slowly, not a
  -- problem. A fixture product should be healthy unless it exists to be sick.
  values ('00000000-0000-0000-0000-0000000fc104', v_ship,
          '00000000-0000-0000-0000-0000000fc103', 4, 0.0012, 14, 'USD', v_godown);
  insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
  values ('00000000-0000-0000-0000-0000000fc105', '00000000-0000-0000-0000-0000000fc104',
          '00000000-0000-0000-0000-0000000fc103', v_godown, now() - interval '5 days',
          4, 4, 216.00, 216.00, 216.00);
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values ('00000000-0000-0000-0000-0000000fc105', '00000000-0000-0000-0000-0000000fc103',
          v_godown, 'in', 4, 'shipment');

  -- ── One confirmed, unpaid, undispatched order ─────────────────────────────
  -- Confirmed so it carries a status badge; no driver so the dashboard raises
  -- "waiting for a driver"; unpaid so Owed is non-zero. Between them those three
  -- states light up most of the data-dependent UI in the app.
  --
  -- Posted through post_sale so the stock ledger stays honest — a fixture that
  -- invents an order without moving stock would leave every quantity in the app
  -- disagreeing with itself, and the audits would be measuring a lie.
  insert into sales_orders (id, order_number, status, payment_status, channel,
                            customer_id, source_godown_id)
  values ('00000000-0000-0000-0000-0000000f9001', 'SO-FIXTURE-1', 'draft', 'pending',
          'whatsapp', v_customer, v_godown);
  insert into sales_order_lines (id, order_id, sku_id, uom, qty, qty_pieces,
                                 unit_price_mvr, line_total_mvr)
  values ('00000000-0000-0000-0000-0000000f9002', '00000000-0000-0000-0000-0000000f9001',
          (function_prefix || '3999')::uuid, 'carton', 1, 168, 776, 776),
         -- ── A MIXED CARTON FILL — two loose bottles ─────────────────────────
         -- ADDED 2026-08-23, because money_rules asserts that a piece line on a
         -- carton-only SKU is ALWAYS a mixed-carton fill, and the fixture
         -- contained no mixed carton at all. The rule was therefore satisfied
         -- by absence — the same way the old blanket rules stayed green in CI
         -- while failing on production. Sosoft's brand carries
         -- mixed_carton_pieces = 6, so this is the real shape: single bottles
         -- of DIFFERENT colours bought loose to make up one full carton, at the
         -- carton rate of 220 ÷ 6.
         --
         -- Three of each, not two of one: assert_whole_mixed_cartons() refuses
         -- a part carton — "This order has 2 bottles, which is 4 short of a
         -- full carton" — and it is right to. A mixed carton is still a whole
         -- carton; only its contents are mixed. The first draft of this fixture
         -- was rejected by that guard, which is the guard doing its job.
         ('00000000-0000-0000-0000-0000000f9003', '00000000-0000-0000-0000-0000000f9001',
          (function_prefix || '3001')::uuid, 'piece', 3, 3, 36.67, 110.01),
         ('00000000-0000-0000-0000-0000000f9004', '00000000-0000-0000-0000-0000000f9001',
          (function_prefix || '3002')::uuid, 'piece', 3, 3, 36.67, 110.01),
         -- One tub, sold singly. Without a sale the tub is DEADSTOCK and the
         -- briefing rightly raises it, which broke today.test.sql's "a business
         -- with nothing wrong is given nothing to do". A fixture product should
         -- be healthy unless it exists to be unhealthy.
         ('00000000-0000-0000-0000-0000000f9005', '00000000-0000-0000-0000-0000000f9001',
          '00000000-0000-0000-0000-0000000fc103', 'pack', 1, 1, 380, 380);
  update sales_order_lines set is_mixed_carton_fill = true
   where id in ('00000000-0000-0000-0000-0000000f9003', '00000000-0000-0000-0000-0000000f9004');
  perform post_sale('00000000-0000-0000-0000-0000000f9001');

  -- ── A rival, with a logged price on every product ─────────────────────────
  -- ADDED 2026-08-22, AFTER A CRASH THIS ABSENCE MADE UNCATCHABLE.
  --
  -- The fixture had ZERO competitors and ZERO competitor prices, so every block
  -- in Market that is gated on `prices.length` — the Cheapest card, the
  -- competitive-gap panel, the per-piece comparison table — rendered as nothing
  -- in every audit that has ever run. /competitors passed contrast and material
  -- because the half of the screen that carries the money was never on screen.
  --
  -- Ali then hit `Cannot read properties of null (reading 'toLocaleString')` on
  -- the Pricing Tool for every Sosoft SKU. A gate that cannot see a feature
  -- cannot guard it, and this is what "the audits were blind to every screen
  -- that needs data to exist" looks like when it happens to a whole module.
  --
  -- per_pack basis with their_pcs_per_pack set, which is the shape every real
  -- logged price has.
  insert into competitors (id, name)
  values ('00000000-0000-0000-0000-0000000fc001', 'Fixture Rival')
  on conflict (name) do nothing;

  insert into competitor_prices (competitor_id, variant_id, their_pcs_per_pack,
                                 price_mvr, price_basis)
  select '00000000-0000-0000-0000-0000000fc001', s.variant_id, s.pcs_per_pack,
         180.00, 'per_pack'
    from skus s
   where s.is_active;
end $$;

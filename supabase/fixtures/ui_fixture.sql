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

  insert into product_categories (id, name, unit_uom, cost_basis)
  values (v_cat_liq, 'Fixture Liquid', 'ml', 'per_100ml'),
         (v_cat_dia, 'Fixture Diapers', 'pcs', 'piece');

  insert into brands (id, name, mixed_carton_pieces)
  values (v_brand_so, 'Sosoft', 6),
         (v_brand_mp, 'Mamypoko', null);

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
    insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                      carton_length_cm, carton_width_cm, carton_height_cm,
                      fixed_price_per_carton_mvr, sellable_units)
      values (v_sku, v_variant, 'SOSO-' || upper(colours[i][1]) || '-1x6',
              1, 6, 40, 30, 30, 220, array['carton']);
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
end $$;

-- ── Migration 0020: Fix confirm_grn() — stale s.unit_size / s.unit_uom / s.cost_basis ──
--
-- Migration 0015 overwrote the confirm_grn function but referenced three columns
-- that were dropped from the `skus` table in migration 0003:
--   s.unit_size  → now in  variants.attributes->>'unit_size'
--   s.unit_uom   → now in  product_categories.unit_uom
--   s.cost_basis → now in  product_categories.cost_basis
--
-- This migration merges the 0003 correct join logic with the 0015 actual-qty
-- improvements (FOB & stock use qty_cartons_actual, CBM apportionment uses
-- qty_cartons, grn_variance_pct written on each line).

CREATE OR REPLACE FUNCTION confirm_grn(p_shipment_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ship        shipments%ROWTYPE;
  v_total_cbm   NUMERIC := 0;
  v_freight_mvr NUMERIC := 0;
  v_local_mvr   NUMERIC := 0;
  v_pool_mvr    NUMERIC := 0;
  v_user        UUID    := auth.uid();
BEGIN
  -- ── Guards ────────────────────────────────────────────────────────────────
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment % not found', p_shipment_id;
  END IF;
  IF v_ship.status = 'grn_confirmed' THEN
    RAISE EXCEPTION 'Shipment already confirmed';
  END IF;
  IF v_ship.rate_usd_to_mvr IS NULL OR v_ship.rate_usd_to_mvr <= 0 THEN
    RAISE EXCEPTION 'USD→MVR rate required';
  END IF;
  IF v_ship.rate_idr_to_mvr IS NULL OR v_ship.rate_idr_to_mvr <= 0 THEN
    RAISE EXCEPTION 'IDR→MVR rate required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM shipment_lines
    WHERE shipment_id = p_shipment_id AND cbm_per_carton <= 0
  ) THEN
    RAISE EXCEPTION 'All lines must have CBM > 0';
  END IF;
  IF EXISTS (
    SELECT 1 FROM shipment_lines
    WHERE shipment_id = p_shipment_id
      AND COALESCE(qty_cartons_actual, qty_cartons) = 0
  ) THEN
    RAISE EXCEPTION 'Actual received qty cannot be zero — remove the line instead';
  END IF;

  -- ── CBM total: uses ORDERED qty (freight paid for space, not what arrived) ─
  SELECT COALESCE(SUM(qty_cartons * cbm_per_carton), 0)
    INTO v_total_cbm
    FROM shipment_lines
   WHERE shipment_id = p_shipment_id;

  IF v_total_cbm <= 0 THEN
    RAISE EXCEPTION 'Shipment has no carton volume';
  END IF;

  v_freight_mvr := COALESCE(v_ship.my_freight_share_usd, 0) * v_ship.rate_usd_to_mvr;
  v_local_mvr   := COALESCE(v_ship.customs_duty_mvr,  0)
                 + COALESCE(v_ship.mpl_charges_mvr,   0)
                 + COALESCE(v_ship.agent_fee_mvr,      0)
                 + COALESCE(v_ship.last_mile_mvr,      0)
                 + COALESCE(v_ship.insurance_mvr,      0)
                 + COALESCE(v_ship.other_mvr,          0);
  v_pool_mvr    := v_freight_mvr + v_local_mvr;

  -- ── Step 1: compute & write per-line costs ────────────────────────────────
  --   unit_size  → variants.attributes->>'unit_size'  (moved in 0003)
  --   unit_uom   → product_categories.unit_uom        (moved in 0003)
  --   cost_basis → product_categories.cost_basis      (moved in 0003)
  --   FOB        → uses qty_cartons_actual (RECEIVED)  (from 0015)
  --   CBM share  → uses qty_cartons        (ORDERED)   (from 0015)
  --   stock      → uses qty_cartons_actual             (from 0015)
  WITH calc AS (
    SELECT
      sl.id,
      sl.sku_id,
      sl.qty_cartons,                                               -- ordered (CBM)
      COALESCE(sl.qty_cartons_actual, sl.qty_cartons) AS qty_act,  -- received (FOB + stock)
      sl.cbm_per_carton,
      sl.destination_godown_id,
      sl.fob_per_carton,
      sl.fob_currency,
      sl.estimated_landed_per_piece_mvr,
      s.pcs_per_pack,
      s.packs_per_carton,
      -- UoM + cost basis from category (correct columns after 0003)
      pc.unit_uom,
      pc.cost_basis,
      -- unit_size lives in variant attributes after 0003
      (v.attributes->>'unit_size')::NUMERIC AS unit_size_attr,
      (v.attributes->>'volume_ml')::NUMERIC AS volume_ml_attr,
      (v.attributes->>'weight_g')::NUMERIC  AS weight_g_attr,
      -- FOB on ACTUAL qty (supplier invoices what they shipped)
      (COALESCE(sl.qty_cartons_actual, sl.qty_cartons) * sl.fob_per_carton *
        CASE sl.fob_currency
          WHEN 'IDR' THEN v_ship.rate_idr_to_mvr
          WHEN 'USD' THEN v_ship.rate_usd_to_mvr
          ELSE 1
        END
      ) AS fob_total_mvr,
      -- CBM share uses ORDERED qty (freight apportioned by space used)
      (sl.qty_cartons * sl.cbm_per_carton / v_total_cbm) AS cbm_share
    FROM shipment_lines sl
    JOIN skus              s  ON s.id  = sl.sku_id
    JOIN variants          v  ON v.id  = s.variant_id
    JOIN product_models    m  ON m.id  = v.model_id
    JOIN product_categories pc ON pc.id = m.category_id
    WHERE sl.shipment_id = p_shipment_id
  ),
  ap AS (
    SELECT *,
      cbm_share * v_freight_mvr                AS app_freight,
      cbm_share * v_local_mvr                  AS app_local,
      fob_total_mvr + (cbm_share * v_pool_mvr) AS landed_total
    FROM calc
  ),
  per AS (
    SELECT *,
      -- Per-unit costs use ACTUAL received qty
      ROUND(landed_total / qty_act,                                        4) AS per_carton,
      ROUND(landed_total / (qty_act * packs_per_carton),                   4) AS per_pack,
      ROUND(landed_total / (qty_act * packs_per_carton * pcs_per_pack),    4) AS per_piece,
      CASE cost_basis
        WHEN 'piece' THEN
          ROUND(landed_total / (qty_act * packs_per_carton * pcs_per_pack), 4)
        WHEN 'per_100ml' THEN
          ROUND(
            (landed_total / (qty_act * packs_per_carton * pcs_per_pack))
            / (COALESCE(volume_ml_attr, unit_size_attr, 1) / 100.0), 4)
        WHEN 'per_100g' THEN
          ROUND(
            (landed_total / (qty_act * packs_per_carton * pcs_per_pack))
            / (COALESCE(weight_g_attr, unit_size_attr, 1) / 100.0), 4)
        ELSE
          ROUND(landed_total / (qty_act * packs_per_carton * pcs_per_pack), 4)
      END AS per_unit
    FROM ap
  )
  UPDATE shipment_lines sl SET
    fob_total_mvr           = p.fob_total_mvr,
    apportioned_freight_mvr = p.app_freight,
    apportioned_local_mvr   = p.app_local,
    landed_total_mvr        = p.landed_total,
    landed_per_carton_mvr   = p.per_carton,
    landed_per_pack_mvr     = p.per_pack,
    landed_per_piece_mvr    = p.per_piece,
    landed_per_unit_mvr     = p.per_unit,
    grn_variance_pct        = CASE
      WHEN p.estimated_landed_per_piece_mvr IS NOT NULL
       AND p.estimated_landed_per_piece_mvr > 0
      THEN ROUND(
        (p.per_piece - p.estimated_landed_per_piece_mvr)
        / p.estimated_landed_per_piece_mvr * 100, 2)
      ELSE NULL
    END
  FROM per p
  WHERE sl.id = p.id;

  -- ── Step 2: create inventory batches using ACTUAL qty ─────────────────────
  INSERT INTO inventory_batches
    (shipment_line_id, sku_id, godown_id,
     qty_cartons_received, qty_pieces_received,
     landed_per_piece_mvr, landed_per_pack_mvr,
     landed_per_carton_mvr, landed_per_unit_mvr)
  SELECT
    sl.id,
    sl.sku_id,
    sl.destination_godown_id,
    COALESCE(sl.qty_cartons_actual, sl.qty_cartons),
    COALESCE(sl.qty_cartons_actual, sl.qty_cartons) * s.packs_per_carton * s.pcs_per_pack,
    sl.landed_per_piece_mvr,
    sl.landed_per_pack_mvr,
    sl.landed_per_carton_mvr,
    sl.landed_per_unit_mvr
  FROM shipment_lines sl
  JOIN skus s ON s.id = sl.sku_id
  WHERE sl.shipment_id = p_shipment_id;

  -- ── Step 3: post stock movements 'in' ─────────────────────────────────────
  INSERT INTO stock_movements
    (batch_id, sku_id, godown_id, movement_type, qty_pieces,
     source_type, source_id, created_by)
  SELECT
    b.id, b.sku_id, b.godown_id, 'in',
    b.qty_pieces_received,
    'shipment', p_shipment_id, v_user
  FROM inventory_batches b
  WHERE b.shipment_line_id IN (
    SELECT id FROM shipment_lines WHERE shipment_id = p_shipment_id
  );

  -- ── Step 4: lock the shipment ──────────────────────────────────────────────
  UPDATE shipments SET
    status           = 'grn_confirmed',
    grn_confirmed_at = now(),
    grn_confirmed_by = v_user
  WHERE id = p_shipment_id;

  -- ── Step 5: audit ──────────────────────────────────────────────────────────
  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('shipments', p_shipment_id, 'update',
          'GRN confirmed; landed costs locked; actual qty used for stock', v_user);

  RETURN p_shipment_id;
END $$;

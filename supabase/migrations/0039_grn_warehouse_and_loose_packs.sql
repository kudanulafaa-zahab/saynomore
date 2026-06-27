-- ── Migration 0039: Warehouse-at-receiving + loose-pack receiving ────────────
--
-- Two real-world receiving fixes for the FMCG import flow:
--
--  (1) WAREHOUSE AT RECEIVING, NOT AT PO.
--      The importer doesn't know which godown goods go to until they arrive at
--      port. So shipment_lines.destination_godown_id becomes NULLABLE (was NOT
--      NULL). It is now chosen at GRN time: confirm_grn() takes an optional
--      p_godown_id used for any line whose destination is still null.
--
--  (2) LOOSE PACKS (rare).
--      Occasionally a line receives a few loose packs on top of whole cartons
--      (e.g. 5 cartons + 2 packs of a 4-packs/carton SKU). We capture this as:
--        - qty_cartons_actual : whole cartons received  (kept INTEGER-compatible,
--                               widened to NUMERIC so a pure-decimal entry still
--                               works, but the UI sends whole cartons here)
--        - qty_loose_packs    : extra loose packs received (NEW, default 0)
--      Pieces received = (cartons * packs_per_carton + loose_packs) * pcs_per_pack
--      — always an exact integer, so stock_movements.qty_pieces stays clean.
--
-- Backward-compatible: existing rows keep their godown and get qty_loose_packs=0.
-- Idempotent guards so re-running is safe.

BEGIN;

-- ── (1) destination_godown_id → nullable ─────────────────────────────────────
ALTER TABLE shipment_lines
  ALTER COLUMN destination_godown_id DROP NOT NULL;

-- ── (2a) widen qty_cartons_actual to allow fractional entry, add loose packs ─
ALTER TABLE shipment_lines
  ALTER COLUMN qty_cartons_actual TYPE NUMERIC(12,4);

ALTER TABLE shipment_lines
  ADD COLUMN IF NOT EXISTS qty_loose_packs INTEGER NOT NULL DEFAULT 0
    CHECK (qty_loose_packs >= 0);

COMMENT ON COLUMN shipment_lines.qty_loose_packs IS
  'Extra loose packs received on top of whole cartons (qty_cartons_actual). Rare.';

-- ── (2b) confirm_grn: godown fallback + loose-pack pieces ─────────────────────
-- This is migration 0020 verbatim, with TWO surgical additions marked [0039]:
--   • p_godown_id param + per-line COALESCE(destination, p_godown_id) fallback
--   • qty_pieces_received now adds qty_loose_packs
-- ALL other costing logic (CBM apportionment on ordered qty, FOB/stock on actual
-- qty, forex lock, per-unit cost basis, audit) is unchanged from 0020.

-- Drop the old single-arg version so we don't end up with two overloaded
-- confirm_grn functions that could drift apart. The new one below has an
-- optional p_godown_id, so existing one-arg calls — confirm_grn(id) — still work.
DROP FUNCTION IF EXISTS confirm_grn(UUID);

CREATE OR REPLACE FUNCTION confirm_grn(p_shipment_id UUID, p_godown_id UUID DEFAULT NULL)
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

  -- [0039] Every line must end up with a godown: either its own, or the one
  -- chosen at receiving (p_godown_id). Block confirmation otherwise.
  IF EXISTS (
    SELECT 1 FROM shipment_lines
    WHERE shipment_id = p_shipment_id
      AND destination_godown_id IS NULL
      AND p_godown_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Destination warehouse required — choose where stock was received';
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
  --   FOB        → uses qty_cartons_actual (RECEIVED)
  --   CBM share  → uses qty_cartons        (ORDERED)
  --   stock      → uses qty_cartons_actual + loose packs
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
      pc.unit_uom,
      pc.cost_basis,
      (v.attributes->>'unit_size')::NUMERIC AS unit_size_attr,
      (v.attributes->>'volume_ml')::NUMERIC AS volume_ml_attr,
      (v.attributes->>'weight_g')::NUMERIC  AS weight_g_attr,
      (COALESCE(sl.qty_cartons_actual, sl.qty_cartons) * sl.fob_per_carton *
        CASE sl.fob_currency
          WHEN 'IDR' THEN v_ship.rate_idr_to_mvr
          WHEN 'USD' THEN v_ship.rate_usd_to_mvr
          ELSE 1
        END
      ) AS fob_total_mvr,
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

  -- ── Step 2: create inventory batches using ACTUAL qty + loose packs ───────
  -- [0039] godown falls back to p_godown_id; pieces add the loose packs.
  INSERT INTO inventory_batches
    (shipment_line_id, sku_id, godown_id,
     qty_cartons_received, qty_pieces_received,
     landed_per_piece_mvr, landed_per_pack_mvr,
     landed_per_carton_mvr, landed_per_unit_mvr)
  SELECT
    sl.id,
    sl.sku_id,
    COALESCE(sl.destination_godown_id, p_godown_id),                       -- [0039]
    COALESCE(sl.qty_cartons_actual, sl.qty_cartons),
    -- [0039] pieces = (whole cartons * packs/ctn + loose packs) * pcs/pack
    ( COALESCE(sl.qty_cartons_actual, sl.qty_cartons) * s.packs_per_carton
      + COALESCE(sl.qty_loose_packs, 0) ) * s.pcs_per_pack,
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

COMMIT;

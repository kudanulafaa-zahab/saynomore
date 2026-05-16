-- ── Migration 0015: Fix confirm_grn() to use actual received quantity ────
--
-- Problem: if supplier ships 92 cartons instead of 100 ordered, the old
-- function posts 100 cartons worth of stock anyway (uses qty_cartons).
--
-- Fix:
--   • CBM apportionment uses qty_cartons (ORDERED) — you paid freight for
--     the space the cartons occupied, regardless of what arrived.
--   • FOB cost uses qty_cartons_actual (RECEIVED) — supplier invoices for
--     what they actually shipped.
--   • Stock posted (inventory_batches + stock_movements) uses qty_cartons_actual.
--   • grn_variance_pct is written to shipment_lines when estimate existed.
--   • If qty_cartons_actual IS NULL it means full quantity received (= qty_cartons).

CREATE OR REPLACE FUNCTION confirm_grn(p_shipment_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ship           shipments%ROWTYPE;
  v_total_cbm      NUMERIC := 0;
  v_freight_mvr    NUMERIC := 0;
  v_local_mvr      NUMERIC := 0;
  v_pool_mvr       NUMERIC := 0;
  v_user           UUID := auth.uid();
BEGIN
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

  -- CBM total uses ORDERED qty (freight was paid for this space)
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

  -- ── Step 1: compute & write per-line costs ────────────────────────────
  WITH calc AS (
    SELECT
      sl.id,
      sl.sku_id,
      sl.qty_cartons,                                              -- ordered (for CBM)
      COALESCE(sl.qty_cartons_actual, sl.qty_cartons) AS qty_act, -- received (for FOB + stock)
      sl.cbm_per_carton,
      sl.destination_godown_id,
      sl.fob_per_carton,
      sl.fob_currency,
      sl.estimated_landed_per_piece_mvr,
      s.pcs_per_pack,
      s.packs_per_carton,
      s.unit_size,
      s.unit_uom,
      s.cost_basis,
      m.category AS model_category,
      -- FOB on ACTUAL qty (supplier invoices what they shipped)
      (COALESCE(sl.qty_cartons_actual, sl.qty_cartons) * sl.fob_per_carton *
        CASE sl.fob_currency
          WHEN 'IDR' THEN v_ship.rate_idr_to_mvr
          WHEN 'USD' THEN v_ship.rate_usd_to_mvr
          ELSE 1
        END
      ) AS fob_total_mvr,
      -- CBM share uses ORDERED qty (freight apportionment by space used)
      (sl.qty_cartons * sl.cbm_per_carton / v_total_cbm) AS cbm_share
    FROM shipment_lines sl
    JOIN skus s           ON s.id = sl.sku_id
    JOIN variants v       ON v.id = s.variant_id
    JOIN product_models m ON m.id = v.model_id
    WHERE sl.shipment_id = p_shipment_id
  ),
  ap AS (
    SELECT *,
      cbm_share * v_freight_mvr               AS app_freight,
      cbm_share * v_local_mvr                 AS app_local,
      fob_total_mvr + (cbm_share * v_pool_mvr) AS landed_total
    FROM calc
  ),
  per AS (
    SELECT *,
      -- All per-unit costs use ACTUAL received qty
      ROUND(landed_total / qty_act,                              4) AS per_carton,
      ROUND(landed_total / (qty_act * packs_per_carton),         4) AS per_pack,
      ROUND(landed_total / (qty_act * packs_per_carton * pcs_per_pack), 4) AS per_piece,
      CASE cost_basis
        WHEN 'piece'     THEN
          ROUND(landed_total / (qty_act * packs_per_carton * pcs_per_pack), 4)
        WHEN 'per_100ml' THEN
          ROUND(
            (landed_total / (qty_act * packs_per_carton * pcs_per_pack))
            / (CASE unit_uom WHEN 'l' THEN unit_size * 1000 ELSE unit_size END / 100.0), 4)
        WHEN 'per_100g' THEN
          ROUND(
            (landed_total / (qty_act * packs_per_carton * pcs_per_pack))
            / (CASE unit_uom WHEN 'kg' THEN unit_size * 1000 ELSE unit_size END / 100.0), 4)
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
    -- Record variance vs pre-GRN estimate (if one was saved)
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

  -- ── Step 2: create inventory batches using ACTUAL qty ─────────────────
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

  -- ── Step 3: post stock movements 'in' ────────────────────────────────
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

  -- ── Step 4: lock the shipment ─────────────────────────────────────────
  UPDATE shipments SET
    status           = 'grn_confirmed',
    grn_confirmed_at = now(),
    grn_confirmed_by = v_user
  WHERE id = p_shipment_id;

  -- ── Step 5: audit ─────────────────────────────────────────────────────
  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('shipments', p_shipment_id, 'update',
          'GRN confirmed; landed costs locked; actual qty used for stock', v_user);

  RETURN p_shipment_id;
END $$;

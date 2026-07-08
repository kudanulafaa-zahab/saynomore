-- ============================================================================
-- 0064 — Per-category duty rate, wired into confirm_grn()
-- ============================================================================
-- Ali imports Tobacco (Amber, Zeus, ... at 30g/40g/50g etc.) which carries a
-- 200% customs duty in the Maldives — a completely different rate from every
-- other category. Today duty is one flat shipment-level MVR amount
-- (shipments.customs_duty_mvr), pooled with every other local charge and
-- apportioned to lines by CBM share (see confirm_grn(), 0020). That is wrong
-- for a shipment mixing Tobacco with anything else: a Tobacco carton and a
-- Diaper carton of the same volume would get the same duty apportionment,
-- when Tobacco should carry a hugely disproportionate share.
--
-- Design (confirmed with Ali):
--  - duty_rate_pct lives on product_categories (not product_models — there is
--    a dormant, never-wired product_models.duty_rate_pct from 0002; this is
--    the one that actually gets read). Rate is set ONCE per category (e.g.
--    Tobacco = 200%) and every brand/model/pack size under it inherits it
--    automatically — matches how Maldives customs actually taxes, by
--    category/HS code, not by brand.
--  - shipments.customs_duty_mvr remains the SINGLE SOURCE OF TRUTH for the
--    total duty amount — it's the real number Ali actually pays customs, and
--    we never invent or override that. What changes is HOW that real total is
--    split across lines: instead of CBM share, each line's share is its
--    rate-weighted FOB value (fob_total_mvr × category duty_rate_pct) as a
--    fraction of the shipment's total rate-weighted FOB. If every line in a
--    shipment has the same rate (or all have 0%), this is mathematically
--    identical to splitting proportional to FOB value. If a shipment mixes
--    Tobacco (200%) with a 0%-rated category, Tobacco correctly absorbs
--    (almost) the entire real duty bill instead of only its CBM share of it.
--  - Snapshot the rate actually used on each shipment_line at GRN time
--    (duty_rate_pct_snapshot) — same doctrine as everything else in this
--    engine: every money figure must be reconstructable without re-deriving
--    from a category rate that might change later.
--  - The UI will auto-suggest customs_duty_mvr as sum(fob_total_mvr × rate)
--    across lines, but Ali can always overwrite it with what customs actually
--    charged — same "editable field, sensible default" pattern as freight.
-- ============================================================================

BEGIN;

-- ── Category-level duty rate ────────────────────────────────────────────────
ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS duty_rate_pct NUMERIC(6,2) NOT NULL DEFAULT 0
    CHECK (duty_rate_pct >= 0);

COMMENT ON COLUMN product_categories.duty_rate_pct IS
  'Customs duty rate for this category (e.g. Tobacco = 200). Used by confirm_grn() to apportion shipments.customs_duty_mvr across lines by rate-weighted FOB value instead of CBM share.';

-- ── Per-line snapshot of the rate + duty actually applied at GRN time ───────
ALTER TABLE shipment_lines
  ADD COLUMN IF NOT EXISTS duty_rate_pct_snapshot NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS apportioned_duty_mvr NUMERIC(15,2);

COMMENT ON COLUMN shipment_lines.duty_rate_pct_snapshot IS
  'The category duty_rate_pct in effect when this line''s GRN was confirmed — snapshotted so a later change to the category rate never silently changes a confirmed line''s cost.';
COMMENT ON COLUMN shipment_lines.apportioned_duty_mvr IS
  'This line''s share of shipments.customs_duty_mvr, apportioned by rate-weighted FOB value (fob_total_mvr × duty_rate_pct_snapshot) rather than CBM share — replaces duty''s previous inclusion in apportioned_local_mvr.';

-- ── Rewire confirm_grn(): duty apportioned by rate-weighted FOB, not CBM ────
CREATE OR REPLACE FUNCTION confirm_grn(p_shipment_id UUID, p_godown_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ship          shipments%ROWTYPE;
  v_total_cbm     NUMERIC := 0;
  v_freight_mvr   NUMERIC := 0;
  v_other_local_mvr NUMERIC := 0;
  v_duty_mvr      NUMERIC := 0;
  v_duty_weight_total NUMERIC := 0;
  v_user          UUID    := auth.uid();
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only admin or manager can confirm a GRN';
  END IF;

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

  IF EXISTS (
    SELECT 1 FROM shipment_lines
    WHERE shipment_id = p_shipment_id
      AND destination_godown_id IS NULL
      AND p_godown_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Destination warehouse required — choose where stock was received';
  END IF;

  SELECT COALESCE(SUM(qty_cartons * cbm_per_carton), 0)
    INTO v_total_cbm
    FROM shipment_lines
   WHERE shipment_id = p_shipment_id;

  IF v_total_cbm <= 0 THEN
    RAISE EXCEPTION 'Shipment has no carton volume';
  END IF;

  v_freight_mvr     := COALESCE(v_ship.my_freight_share_usd, 0) * v_ship.rate_usd_to_mvr;
  -- Duty is now apportioned separately, by rate-weighted FOB value — no
  -- longer pooled with the CBM-apportioned local costs below.
  v_other_local_mvr := COALESCE(v_ship.mpl_charges_mvr,   0)
                      + COALESCE(v_ship.agent_fee_mvr,    0)
                      + COALESCE(v_ship.last_mile_mvr,    0)
                      + COALESCE(v_ship.insurance_mvr,    0)
                      + COALESCE(v_ship.other_mvr,        0);
  v_duty_mvr        := COALESCE(v_ship.customs_duty_mvr, 0);

  WITH calc AS (
    SELECT
      sl.id,
      sl.sku_id,
      sl.qty_cartons,
      COALESCE(sl.qty_cartons_actual, sl.qty_cartons) AS qty_act,
      sl.cbm_per_carton,
      sl.destination_godown_id,
      sl.fob_per_carton,
      sl.fob_currency,
      sl.estimated_landed_per_piece_mvr,
      s.pcs_per_pack,
      s.packs_per_carton,
      pc.unit_uom,
      pc.cost_basis,
      pc.duty_rate_pct,
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
  weighted AS (
    SELECT *, fob_total_mvr * duty_rate_pct AS duty_weight
    FROM calc
  ),
  totals AS (
    SELECT COALESCE(SUM(duty_weight), 0) AS total_duty_weight FROM weighted
  ),
  ap AS (
    SELECT w.*,
      w.cbm_share * v_freight_mvr     AS app_freight,
      w.cbm_share * v_other_local_mvr AS app_other_local,
      -- Duty share = this line's rate-weighted FOB as a fraction of the
      -- shipment's total rate-weighted FOB. If every line shares one rate
      -- (or all are 0%), this reduces to a plain FOB-value split. If
      -- total_duty_weight is 0 (e.g. no category has a duty rate set yet),
      -- fall back to CBM share so duty is never silently dropped.
      CASE
        WHEN t.total_duty_weight > 0 THEN (w.duty_weight / t.total_duty_weight) * v_duty_mvr
        ELSE w.cbm_share * v_duty_mvr
      END AS app_duty
    FROM weighted w, totals t
  ),
  landed AS (
    SELECT *,
      fob_total_mvr + app_freight + app_other_local + app_duty AS landed_total
    FROM ap
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
    FROM landed
  )
  UPDATE shipment_lines sl SET
    fob_total_mvr           = p.fob_total_mvr,
    apportioned_freight_mvr = p.app_freight,
    apportioned_local_mvr   = p.app_other_local,
    apportioned_duty_mvr    = p.app_duty,
    duty_rate_pct_snapshot  = p.duty_rate_pct,
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

  INSERT INTO inventory_batches
    (shipment_line_id, sku_id, godown_id,
     qty_cartons_received, qty_pieces_received,
     landed_per_piece_mvr, landed_per_pack_mvr,
     landed_per_carton_mvr, landed_per_unit_mvr)
  SELECT
    sl.id,
    sl.sku_id,
    COALESCE(sl.destination_godown_id, p_godown_id),
    COALESCE(sl.qty_cartons_actual, sl.qty_cartons),
    ( COALESCE(sl.qty_cartons_actual, sl.qty_cartons) * s.packs_per_carton
      + COALESCE(sl.qty_loose_packs, 0) ) * s.pcs_per_pack,
    sl.landed_per_piece_mvr,
    sl.landed_per_pack_mvr,
    sl.landed_per_carton_mvr,
    sl.landed_per_unit_mvr
  FROM shipment_lines sl
  JOIN skus s ON s.id = sl.sku_id
  WHERE sl.shipment_id = p_shipment_id;

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

  UPDATE shipments SET
    status           = 'grn_confirmed',
    grn_confirmed_at = now(),
    grn_confirmed_by = v_user
  WHERE id = p_shipment_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('shipments', p_shipment_id, 'update',
          'GRN confirmed; landed costs locked; actual qty used for stock', v_user);

  RETURN p_shipment_id;
END;
$function$;

COMMIT;

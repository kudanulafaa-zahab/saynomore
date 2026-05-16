-- ── Migration 0014: Purchase Order enhancements ──────────────────────────
--
-- 1. Add supplier_po_number and expected_arrival_date to shipments
-- 2. Add qty_cartons_actual, estimated_landed_per_piece_mvr, grn_variance_pct
--    to shipment_lines
-- 3. Trigger: block exchange rate changes after GRN confirmation
-- 4. Indexes for PO list and ETA queries
--
-- NOTE: confirm_grn() is NOT replaced here — the existing function is
-- correct. The new qty_cartons_actual field will be used by the UI to
-- pass actual received qty; the function itself uses qty_cartons today
-- and will be updated in a follow-up migration once the UI is live.

-- ── 1. Shipments: add PO-specific fields ─────────────────────────────────
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS supplier_po_number    TEXT,
  ADD COLUMN IF NOT EXISTS expected_arrival_date DATE;

-- ── 2. Shipment lines: actual received qty + variance tracking ────────────
ALTER TABLE shipment_lines
  ADD COLUMN IF NOT EXISTS qty_cartons_actual              INTEGER
    CHECK (qty_cartons_actual IS NULL OR qty_cartons_actual >= 0),
  ADD COLUMN IF NOT EXISTS estimated_landed_per_piece_mvr NUMERIC(15,4),
  ADD COLUMN IF NOT EXISTS grn_variance_pct               NUMERIC(8,2);

-- ── 3. Rate lock trigger — block FX changes after GRN ────────────────────
CREATE OR REPLACE FUNCTION block_grn_rate_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'grn_confirmed' THEN
    IF NEW.rate_idr_to_mvr IS DISTINCT FROM OLD.rate_idr_to_mvr
    OR NEW.rate_usd_to_mvr IS DISTINCT FROM OLD.rate_usd_to_mvr
    OR NEW.rate_idr_to_usd IS DISTINCT FROM OLD.rate_idr_to_usd THEN
      RAISE EXCEPTION 'Exchange rates are locked after GRN confirmation — void the GRN to correct them';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lock_grn_rates ON shipments;
CREATE TRIGGER trg_lock_grn_rates
  BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION block_grn_rate_changes();

-- ── 4. Indexes ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shipments_status
  ON shipments(status);

CREATE INDEX IF NOT EXISTS idx_shipments_expected_arrival
  ON shipments(expected_arrival_date)
  WHERE expected_arrival_date IS NOT NULL;

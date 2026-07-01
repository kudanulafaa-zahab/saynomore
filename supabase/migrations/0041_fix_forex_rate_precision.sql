-- Fix: "1 USD = ___ IDR" field drifting on save (e.g. 16500 -> 16499 on reload).
--
-- Root cause: the app only stored the reciprocal (rate_idr_to_usd, e.g. 1/16500),
-- then reconstructed the on-screen number as ROUND(1 / rate_idr_to_usd). The
-- column is NUMERIC(15,8), which isn't enough decimal places to round-trip
-- reciprocals of everyday IDR rates (16500, 12345, 99999 all failed; only some
-- "nicer" numbers happened to survive). This is a display bug only —
-- rate_idr_to_usd was never used in landed-cost math (rate_idr_to_mvr is), so
-- no financial calculation was ever wrong.
--
-- Fix: store the exact IDR number the user typed, so the field can always be
-- redisplayed with zero rounding.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS rate_usd_to_idr NUMERIC(15,2);

COMMENT ON COLUMN shipments.rate_usd_to_idr IS
  'Exact "1 USD = ___ IDR" value as typed by the user. Display-only — landed cost math uses rate_idr_to_mvr, not this column.';

-- Extend the GRN rate-lock trigger (migration 0014) to also cover the new
-- column, so it can't be changed after GRN confirmation either.
CREATE OR REPLACE FUNCTION block_grn_rate_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'grn_confirmed' THEN
    IF NEW.rate_idr_to_mvr IS DISTINCT FROM OLD.rate_idr_to_mvr
    OR NEW.rate_usd_to_mvr IS DISTINCT FROM OLD.rate_usd_to_mvr
    OR NEW.rate_idr_to_usd IS DISTINCT FROM OLD.rate_idr_to_usd
    OR NEW.rate_usd_to_idr IS DISTINCT FROM OLD.rate_usd_to_idr THEN
      RAISE EXCEPTION 'Exchange rates are locked after GRN confirmation — void the GRN to correct them';
    END IF;
  END IF;
  RETURN NEW;
END $$;

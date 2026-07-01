-- Fix: rate_idr_to_mvr (the rate actually used by confirm_grn for landed-cost
-- math on IDR lines) was being computed in TypeScript via JS float division
-- (rate_usd_to_mvr / rate_usd_to_idr) before being saved. This violates the
-- hard rule that all financial math happens in Postgres, and it's the same
-- bug class as the 0041 display-drift fix -- just one step removed: instead
-- of losing precision on redisplay, precision was being lost at the point the
-- GRN-locked rate is computed and written.
--
-- Fix: derive rate_idr_to_mvr in Postgres. The app now only ever writes
-- rate_usd_to_mvr and rate_usd_to_idr (the two numbers the user actually
-- types); a BEFORE INSERT OR UPDATE trigger computes rate_idr_to_mvr from
-- those two inputs using Postgres numeric division, matching what confirm_grn
-- itself would compute.

CREATE OR REPLACE FUNCTION derive_idr_to_mvr()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rate_usd_to_mvr IS NOT NULL AND NEW.rate_usd_to_mvr > 0
     AND NEW.rate_usd_to_idr IS NOT NULL AND NEW.rate_usd_to_idr > 0 THEN
    NEW.rate_idr_to_mvr := NEW.rate_usd_to_mvr / NEW.rate_usd_to_idr;
  ELSE
    NEW.rate_idr_to_mvr := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_derive_idr_to_mvr ON shipments;
CREATE TRIGGER trg_derive_idr_to_mvr
  BEFORE INSERT OR UPDATE OF rate_usd_to_mvr, rate_usd_to_idr ON shipments
  FOR EACH ROW EXECUTE FUNCTION derive_idr_to_mvr();

COMMENT ON COLUMN shipments.rate_idr_to_mvr IS
  'Derived automatically in Postgres from rate_usd_to_mvr / rate_usd_to_idr (see derive_idr_to_mvr trigger). Do not write to this column directly from the app -- it is overwritten on every insert/update of the two source rates. Locked after GRN confirmation by block_grn_rate_changes.';

-- block_grn_rate_changes (0014/0041) already covers rate_idr_to_mvr, so once
-- it's locked the derive trigger's overwrite is moot (rate_usd_to_mvr /
-- rate_usd_to_idr can no longer change post-lock either).

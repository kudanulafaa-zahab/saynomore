-- ── Migration 0054: stop the whole-MVR trigger corrupting per-piece prices ──
--
-- Bug (found in the 2026-07-02 world-class audit, severity critical):
-- skus.fixed_selling_price_mvr stores the INTERNAL per-piece price — the
-- Edit SKU dialog divides the typed pack price by pcs_per_pack before
-- saving (edit-dialogs.tsx). Migration 0044's write-trigger rounded that
-- per-piece value to whole MVR, silently changing what the user typed:
--
--   type MVR 165 for a 34-pc pack → stored 165/34 = 4.85 → trigger
--   rounds to 5.00 → derived pack price becomes ROUND(5×34) = 170.
--
-- Ali's whole-MVR business rule (0043/0044) applies to CUSTOMER-FACING
-- prices — the pack/carton figures customers actually pay — not to the
-- internal per-piece basis. Piece prices shown to customers are already
-- rounded at read time by v_skus (0043), which is the correct layer.
--
-- Fix 1: the trigger now rounds only fixed_price_per_pack_mvr and
--        fixed_price_per_carton_mvr. fixed_selling_price_mvr keeps its
--        2-dp precision. (Also fixes the crash where a piece price under
--        MVR 0.50 rounded to 0 and violated the > 0 CHECK from 0012.)
--
-- Fix 2: repair the 3 SKUs corrupted since 0044 went live (verified by
--        dry-run — every other SKU predates the trigger and is clean):
--          MAMY-SKIN-XL-36x3    4.00 → 4.17  (= 150/36)
--          MAMY-XTRA-XXXL-32x4  5.00 → 4.53  (= 145/32)
--          SOSO-GREE-FLORAL-1x6 37.00 → 36.67 (= 220/6)
--        Displayed piece prices are unchanged (they round to the same
--        whole MVR); only the internal precision is restored. Each
--        repair is written to audit_log.

BEGIN;

-- Fix 1: trigger no longer touches the internal per-piece column.
CREATE OR REPLACE FUNCTION public.round_selling_prices_skus()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Customer-facing tiers: whole MVR, per Ali's business rule.
  IF NEW.fixed_price_per_pack_mvr   IS NOT NULL THEN NEW.fixed_price_per_pack_mvr   := ROUND(NEW.fixed_price_per_pack_mvr, 0); END IF;
  IF NEW.fixed_price_per_carton_mvr IS NOT NULL THEN NEW.fixed_price_per_carton_mvr := ROUND(NEW.fixed_price_per_carton_mvr, 0); END IF;
  -- fixed_selling_price_mvr (internal per-piece basis) intentionally NOT
  -- rounded — whole-MVR display happens at read time in v_skus (0043).
  RETURN NEW;
END $function$;

-- Fix 2: restore precision on the trigger-corrupted rows, with audit trail.
WITH repaired AS (
  UPDATE skus SET fixed_selling_price_mvr =
    CASE
      WHEN fixed_price_per_pack_mvr IS NOT NULL
        THEN ROUND(fixed_price_per_pack_mvr / pcs_per_pack, 2)
      ELSE ROUND(fixed_price_per_carton_mvr / (pcs_per_pack * packs_per_carton), 2)
    END
  WHERE fixed_selling_price_mvr IS NOT NULL
    AND (
      (fixed_price_per_pack_mvr IS NOT NULL
        AND abs(fixed_selling_price_mvr - fixed_price_per_pack_mvr / pcs_per_pack) < 0.5
        AND fixed_selling_price_mvr <> ROUND(fixed_price_per_pack_mvr / pcs_per_pack, 2))
      OR
      (fixed_price_per_pack_mvr IS NULL AND fixed_price_per_carton_mvr IS NOT NULL
        AND abs(fixed_selling_price_mvr - fixed_price_per_carton_mvr / (pcs_per_pack * packs_per_carton)) < 0.5
        AND fixed_selling_price_mvr <> ROUND(fixed_price_per_carton_mvr / (pcs_per_pack * packs_per_carton), 2))
    )
  RETURNING id, internal_code, fixed_selling_price_mvr
)
INSERT INTO audit_log (table_name, record_id, action, field_name, new_value, reason)
SELECT 'skus', id, 'update', 'fixed_selling_price_mvr', fixed_selling_price_mvr::text,
       'Migration 0054: restored per-piece precision corrupted by the 0044 whole-MVR trigger (derived from fixed pack/carton price)'
FROM repaired;

COMMIT;

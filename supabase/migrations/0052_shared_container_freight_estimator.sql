-- ── Migration 0052: Shared-container freight estimator ──
--
-- Ali splits a container with his brother, who pays the full freight bill
-- to the shipping line directly. Ali reimburses a fair share. Neither of
-- them reliably knows the container's actual total loaded CBM, so an exact
-- CBM-based split (my_cbm / actual_total_cbm) isn't available in practice.
--
-- This adds a repeatable ESTIMATE using standard container capacity as a
-- stand-in denominator: my_share = total_freight * (my_cbm / capacity).
-- Capacity constants (20ft ≈ 28 CBM, 40ft HQ ≈ 68 CBM) are physical
-- constants that don't change, so they're hardcoded in the app, not a
-- lookup table — no schema needed for them.
--
-- Reuses existing (previously dead/unwired) columns from migration 0002:
--   shared_container             — now actually used, toggled by the UI
--   total_container_freight_usd  — the brother's flat freight bill (input)
--   freight_share_notes          — free text, e.g. "40HQ, brother's invoice"
-- One new column: which container size the estimate used, so the basis is
-- stored and auditable, not just the resulting number.
--
-- my_freight_share_usd (already NUMERIC(15,2), unchanged) remains the one
-- real number confirm_grn() and everything downstream reads — this feature
-- only pre-fills it. The user can always overtype it. No change to any
-- cost-apportionment logic.

BEGIN;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS container_size_hint TEXT
    CHECK (container_size_hint IN ('20ft', '40hq'));

COMMENT ON COLUMN shipments.container_size_hint IS
  'Which standard container size was used as the denominator for the shared-container freight estimate (20ft ~28 CBM, 40hq ~68 CBM). NULL if the estimator was never used for this shipment. Estimate only -- my_freight_share_usd is the real value used in costing.';

COMMIT;

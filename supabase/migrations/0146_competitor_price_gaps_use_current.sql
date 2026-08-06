-- 0146 — get_competitor_price_gaps: compare against CURRENT rival prices,
-- not the cheapest ever logged.
--
-- Found while building migration 0145: get_competitor_price_gaps (0074) was
-- never migrated onto v_competitor_prices_current after migration 0102
-- introduced it to fix exactly this defect for the Market screen. The
-- function's DISTINCT ON ordering (price_per_piece ASC, observed_date DESC)
-- picks the globally cheapest price a competitor has EVER been logged at for
-- a variant, not their current shelf price — so once a rival's price history
-- spans more than one observation, a price nobody charges any more still
-- counts as today's cheapest rival and pulls Ali's price-gap alert (and the
-- Price Book "vs Rivals" lens) toward a number that no longer exists.
--
-- Verified before fixing: every variant today has exactly one observation
-- (7 rows across 7 variants, both from the raw table and the current view),
-- so this migration changes zero live results — same as 0102 found for
-- Market at the time. It closes the gap before a second price check on any
-- SKU makes it a real, silent bug.
--
-- Only change: read from v_competitor_prices_current instead of the raw
-- competitor_prices log. Everything else — the per-piece normalization
-- (their_pcs_per_pack override, per_pack/per_carton conversion) — is
-- unchanged from 0074.

BEGIN;

CREATE OR REPLACE FUNCTION get_competitor_price_gaps(p_threshold_pct NUMERIC DEFAULT 10)
RETURNS TABLE (
  sku_id            UUID,
  brand_name        TEXT,
  model_name        TEXT,
  variant_display   TEXT,
  internal_code     TEXT,
  our_price_mvr     NUMERIC,
  cheapest_competitor_mvr NUMERIC,
  cheapest_competitor_name TEXT,
  gap_pct           NUMERIC   -- positive = we're more expensive
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH normalized AS (
    SELECT
      cp.variant_id,
      c.name AS competitor_name,
      CASE cp.price_basis
        WHEN 'per_piece'  THEN cp.price_mvr
        WHEN 'per_pack'   THEN cp.price_mvr / NULLIF(COALESCE(cp.their_pcs_per_pack, vs.pcs_per_pack), 0)
        WHEN 'per_carton' THEN cp.price_mvr / NULLIF(COALESCE(cp.their_pcs_per_pack, vs.pcs_per_pack * vs.packs_per_carton), 0)
        ELSE NULL
      END AS price_per_piece,
      cp.observed_date
    FROM v_competitor_prices_current cp
    JOIN competitors c ON c.id = cp.competitor_id
    JOIN v_skus vs ON vs.variant_id = cp.variant_id
  ),
  cheapest AS (
    SELECT DISTINCT ON (variant_id)
      variant_id, competitor_name, price_per_piece
    FROM normalized
    WHERE price_per_piece IS NOT NULL
    ORDER BY variant_id, price_per_piece ASC, observed_date DESC
  )
  SELECT
    vs.id,
    vs.brand_name,
    vs.model_name,
    vs.variant_display,
    vs.internal_code,
    vs.selling_price_per_piece_mvr,
    ch.price_per_piece,
    ch.competitor_name,
    ROUND(
      (vs.selling_price_per_piece_mvr - ch.price_per_piece)
      / NULLIF(ch.price_per_piece, 0) * 100, 1
    ) AS gap_pct
  FROM cheapest ch
  JOIN v_skus vs ON vs.variant_id = ch.variant_id
  WHERE vs.selling_price_per_piece_mvr IS NOT NULL
    AND (vs.selling_price_per_piece_mvr - ch.price_per_piece) / NULLIF(ch.price_per_piece, 0) * 100 > p_threshold_pct
  ORDER BY gap_pct DESC;
$$;

REVOKE EXECUTE ON FUNCTION get_competitor_price_gaps(NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_competitor_price_gaps(NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION get_competitor_price_gaps(NUMERIC) TO authenticated;

COMMIT;

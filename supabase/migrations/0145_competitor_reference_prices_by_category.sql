-- 0145 — Category-scoped competitor reference prices for the new-product
-- simulator.
--
-- Ali asked for competitor prices to help price a prospective product in the
-- Cost Simulator (migration 0144). The first draft of this feature would have
-- let ANY tracked product's rival price be borrowed as a reference — a
-- diaper trial could have been benchmarked against a soft drink. Category has
-- to gate this or the comparison is meaningless: different categories carry
-- entirely different price bands and margin structures. This function only
-- ever returns peers within the caller's own category.
--
-- Normalization mirrors get_competitor_price_gaps (migration 0074): every
-- observation (per_pack / per_carton / per_piece) is converted to a
-- price-per-piece first, because that is the only unit comparable across
-- different pack configurations — the same reasoning that keeps Market's
-- per-piece comparison table correct. The result is then converted back up
-- using the CALLER's own pack configuration (p_pcs_per_pack /
-- p_packs_per_carton), not the reference product's — a trial line is never
-- assumed to share its comparison product's pack size.
--
-- Deliberately reads v_competitor_prices_current (latest observation only),
-- not the raw competitor_prices log — comparing against a stale price would
-- be the same defect migration 0102 fixed for Market. NOTE, found while
-- writing this: get_competitor_price_gaps (0074) itself was never migrated
-- onto v_competitor_prices_current after 0102 shipped, so the live Price
-- Gaps dashboard still compares against the cheapest EVER-logged price, not
-- the current one. Flagged to Ali separately; not fixed here (one thing at a
-- time) and this new function does not share that bug.
--
-- All money math stays in Postgres (hard rule 1) — the pack/carton
-- conversion happens here, not in the browser, so the frontend only ever
-- selects which already-computed column to display.

BEGIN;

CREATE OR REPLACE FUNCTION get_competitor_reference_prices(
  p_category_id UUID,
  p_pcs_per_pack INTEGER,
  p_packs_per_carton INTEGER
)
RETURNS TABLE (
  variant_id            UUID,
  brand_name            TEXT,
  model_name            TEXT,
  variant_display       TEXT,
  competitor_name       TEXT,
  price_per_piece_mvr   NUMERIC,
  price_per_pack_mvr    NUMERIC,
  price_per_carton_mvr  NUMERIC,
  observed_date         DATE
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
    WHERE vs.category_id = p_category_id
  ),
  cheapest AS (
    SELECT DISTINCT ON (variant_id)
      variant_id, competitor_name, price_per_piece, observed_date
    FROM normalized
    WHERE price_per_piece IS NOT NULL
    ORDER BY variant_id, price_per_piece ASC, observed_date DESC
  ),
  peers AS (
    SELECT DISTINCT variant_id, brand_name, model_name, variant_display
    FROM v_skus
    WHERE category_id = p_category_id
  )
  SELECT
    p.variant_id,
    p.brand_name,
    p.model_name,
    p.variant_display,
    ch.competitor_name,
    ROUND(ch.price_per_piece, 4),
    ROUND(ch.price_per_piece * GREATEST(p_pcs_per_pack, 1), 2),
    ROUND(ch.price_per_piece * GREATEST(p_pcs_per_pack, 1) * GREATEST(p_packs_per_carton, 1), 2),
    ch.observed_date
  FROM cheapest ch
  JOIN peers p ON p.variant_id = ch.variant_id
  ORDER BY p.brand_name, p.model_name, p.variant_display;
$$;

-- New functions in this project default to a PUBLIC grant unlike the rest of
-- the codebase (observed live: get_competitor_price_gaps has no PUBLIC row at
-- all, this one did until revoked here) — revoke both explicitly so anon can
-- never reach it via the inherited PUBLIC grant.
REVOKE EXECUTE ON FUNCTION get_competitor_reference_prices(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_competitor_reference_prices(UUID, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION get_competitor_reference_prices(UUID, INTEGER, INTEGER) TO authenticated;

COMMIT;

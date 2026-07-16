-- get_competitor_price_gaps: per_carton rows ignored their_pcs_per_pack
-- entirely and always divided by OUR OWN carton size (vs.pcs_per_pack *
-- vs.packs_per_carton), even though the column exists precisely to hold a
-- competitor's own pack/carton composition when it differs from ours. A
-- per_pack row already used it correctly (COALESCE to their_pcs_per_pack,
-- fall back to ours); per_carton just never had the same override wired in.
-- Matches the same fix just applied client-side in
-- components/competitors/competitors-view.tsx (three normalization sites:
-- the Log Competitor Price preview, the Margin Simulator's cheapest-
-- competitor lookup, and the per-piece comparison table) — the UI now lets
-- Ali enter "their pieces per carton" for a per_carton row, stored in the
-- same their_pcs_per_pack column, so this RPC must read it the same way or
-- the Price Gaps dashboard would silently disagree with the screen Ali is
-- looking at.

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
    FROM competitor_prices cp
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

GRANT EXECUTE ON FUNCTION get_competitor_price_gaps(NUMERIC) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_competitor_price_gaps(NUMERIC) FROM anon;

COMMIT;

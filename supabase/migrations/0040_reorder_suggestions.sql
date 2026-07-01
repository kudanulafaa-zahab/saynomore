-- ── Migration 0040: Reorder suggestions RPC ──────────────────────────────────
--
-- Powers the "What to order next" screen. Builds on get_sku_reorder_alerts
-- (0017) but adds the two things a buyer actually needs:
--   • suggested_cartons — how much to order to reach a target weeks-of-cover
--   • overstock flag     — SKUs sitting on too much cash (slow movers)
-- and a commercially-smart ranking so money-makers surface first.
--
-- Doctrine (inventory + pricing experts):
--   cover target   = lead time + safety buffer   (weeks-of-cover)
--   suggested pcs  = max(0, daily_avg × cover_days − current_stock)
--   suggested ctns = ceil(suggested_pcs / pcs_per_carton)          [whole cartons]
--   overstock      = DIR > 90 days                                 [tying up cash]
--   ranking        = urgency first, then revenue velocity (avg/day × price)
--                    so a fast, high-value SKU outranks a slow cheap one.
--
-- All arithmetic in Postgres (hard rule). Parameters let the app tune cover
-- without a code change; defaults = 6-week lead + 4-week safety = 10 weeks.

CREATE OR REPLACE FUNCTION get_reorder_suggestions(
  p_lead_weeks   NUMERIC DEFAULT 6,
  p_safety_weeks NUMERIC DEFAULT 4
)
RETURNS TABLE (
  sku_id            UUID,
  brand_name        TEXT,
  model_name        TEXT,
  variant_display   TEXT,
  internal_code     TEXT,
  stock_pieces      NUMERIC,
  stock_cartons     NUMERIC,
  daily_avg_pieces  NUMERIC,
  dir               NUMERIC,      -- days inventory remaining (NULL = no sales)
  cover_days        NUMERIC,      -- target days of cover
  suggested_pieces  NUMERIC,
  suggested_cartons INTEGER,      -- whole cartons to order (0 = no need)
  pcs_per_carton    INTEGER,
  revenue_per_day   NUMERIC,      -- daily_avg × selling price/pc (for ranking)
  status            TEXT          -- 'critical' | 'low' | 'ok' | 'overstock'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  cover AS (
    SELECT (COALESCE(p_lead_weeks, 6) + COALESCE(p_safety_weeks, 4)) * 7.0 AS cover_days
  ),
  base AS (
    -- Reuse the vetted alerts RPC for stock + velocity + DIR + alert level.
    SELECT a.*, c.cover_days
    FROM get_sku_reorder_alerts() a
    CROSS JOIN cover c
  )
  SELECT
    b.sku_id,
    vs.brand_name,
    vs.model_name,
    vs.variant_display,
    vs.internal_code,
    b.stock_pieces,
    ROUND(b.stock_pieces / NULLIF(vs.pcs_per_carton, 0), 1)              AS stock_cartons,
    b.daily_avg_pieces,
    b.dir,
    b.cover_days,
    -- how many pieces short of the cover target
    GREATEST(0, ROUND(b.daily_avg_pieces * b.cover_days - b.stock_pieces, 0)) AS suggested_pieces,
    -- rounded UP to whole cartons
    CEIL(
      GREATEST(0, b.daily_avg_pieces * b.cover_days - b.stock_pieces)
      / NULLIF(vs.pcs_per_carton, 0)
    )::INTEGER                                                           AS suggested_cartons,
    vs.pcs_per_carton,
    ROUND(b.daily_avg_pieces * COALESCE(vs.selling_price_per_piece_mvr, 0), 2) AS revenue_per_day,
    CASE
      WHEN b.dir IS NOT NULL AND b.dir > 90 THEN 'overstock'
      ELSE b.alert_level
    END                                                                  AS status
  FROM base b
  JOIN v_skus vs ON vs.id = b.sku_id
  ORDER BY
    -- urgency bucket first: critical, then low, then overstock, then ok
    CASE
      WHEN b.dir IS NOT NULL AND b.dir > 90 THEN 2
      WHEN b.alert_level = 'critical' THEN 0
      WHEN b.alert_level = 'low'      THEN 1
      ELSE 3
    END,
    -- within a bucket, biggest money-maker (revenue/day) first
    (b.daily_avg_pieces * COALESCE(vs.selling_price_per_piece_mvr, 0)) DESC;
$$;

GRANT EXECUTE ON FUNCTION get_reorder_suggestions(NUMERIC, NUMERIC) TO authenticated;

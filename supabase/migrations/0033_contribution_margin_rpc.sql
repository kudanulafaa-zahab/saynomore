-- ── Migration 0033: Per-SKU contribution margin ────────────────────────────────
--
-- Gross margin (already in get_reports_data) = (sell - landed) / sell.
-- CONTRIBUTION margin goes one step further and subtracts the marketing spend
-- that drove those sales:
--
--   contribution_per_piece = avg_sell_price - landed_per_piece - mktg_per_piece
--   contribution_margin_pct = contribution_per_piece / avg_sell_price * 100
--
-- ALLOCATION RULE (duplicate-free — the whole point of doing this in SQL):
--   Each campaign's amount_mvr is divided across ONLY the pieces of its linked
--   SKUs that were actually sold inside the campaign's own [start_date, end_date]
--   window, proportional to each SKU's unit share. So:
--     • a campaign covering many SKUs  → its spend splits across them (sums to 100%)
--     • a SKU in many overlapping campaigns → it receives a share from each,
--       summed — never double-counted, because each campaign is allocated
--       independently and exactly once.
--     • a campaign whose window had ZERO matching sales → its spend allocates to
--       nothing (it is simply not attributed; it is NOT dumped onto an arbitrary
--       SKU). Such spend shows up in the expenses module total but not here.
--     • a campaign with NO linked SKUs → general brand spend, not per-SKU; ignored
--       here by construction (the join to marketing_spend_skus yields no rows).
--
-- end_date NULL means an open-ended campaign → treat as running through p_to.

CREATE OR REPLACE FUNCTION get_contribution_margin(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (
  sku_id                   UUID,
  brand_name               TEXT,
  model_name               TEXT,
  variant_display          TEXT,
  internal_code            TEXT,
  total_qty_pieces         BIGINT,
  total_revenue_mvr        NUMERIC,
  avg_unit_price_mvr       NUMERIC,
  landed_per_piece_mvr     NUMERIC,
  total_landed_cost_mvr    NUMERIC,
  gross_margin_pct         NUMERIC,
  marketing_spend_mvr      NUMERIC,   -- allocated to this SKU in the period
  mktg_per_piece_mvr       NUMERIC,
  contribution_mvr         NUMERIC,   -- revenue - landed - allocated marketing
  contribution_per_piece   NUMERIC,
  contribution_margin_pct  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- Pieces sold per SKU in the reporting period (confirmed+ orders only)
  period_sales AS (
    SELECT
      sol.sku_id,
      SUM(sol.qty_pieces)     AS qty_pieces,
      SUM(sol.line_total_mvr) AS revenue_mvr
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.created_at::DATE BETWEEN p_from AND p_to
    GROUP BY sol.sku_id
  ),

  -- Latest in-stock landed cost per SKU (same source as reports/pricing)
  latest_landed AS (
    SELECT DISTINCT ON (sku_id)
      sku_id, landed_per_piece_mvr
    FROM v_batch_stock
    WHERE qty_pieces_remaining > 0
    ORDER BY sku_id, received_at DESC
  ),

  -- For each campaign, the pieces of each linked SKU sold inside the campaign's
  -- OWN window (clamped to the reporting period so we never attribute sales that
  -- fall outside what we are reporting on).
  campaign_sku_units AS (
    SELECT
      ms.id          AS spend_id,
      ms.amount_mvr,
      mss.sku_id,
      SUM(sol.qty_pieces) AS units
    FROM marketing_spend ms
    JOIN marketing_spend_skus mss ON mss.spend_id = ms.id
    JOIN sales_order_lines sol    ON sol.sku_id = mss.sku_id
    JOIN sales_orders so          ON so.id = sol.order_id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.created_at::DATE BETWEEN GREATEST(ms.start_date, p_from)
                                  AND LEAST(COALESCE(ms.end_date, p_to), p_to)
    GROUP BY ms.id, ms.amount_mvr, mss.sku_id
  ),

  -- Total units per campaign (denominator for proportional split)
  campaign_totals AS (
    SELECT spend_id, amount_mvr, SUM(units) AS total_units
    FROM campaign_sku_units
    GROUP BY spend_id, amount_mvr
  ),

  -- Allocate each campaign's spend across its SKUs by unit share, then SUM per
  -- SKU across all campaigns. Because each campaign is split independently and
  -- its shares sum to its full amount, no spend is counted twice.
  sku_marketing AS (
    SELECT
      csu.sku_id,
      SUM(csu.amount_mvr * (csu.units::NUMERIC / ct.total_units)) AS marketing_mvr
    FROM campaign_sku_units csu
    JOIN campaign_totals ct ON ct.spend_id = csu.spend_id
    WHERE ct.total_units > 0
    GROUP BY csu.sku_id
  )

  SELECT
    s.id                                                        AS sku_id,
    b.name                                                      AS brand_name,
    m.name                                                      AS model_name,
    v.display_name                                              AS variant_display,
    s.internal_code,

    COALESCE(ps.qty_pieces, 0)::BIGINT                         AS total_qty_pieces,
    COALESCE(ps.revenue_mvr, 0)                                AS total_revenue_mvr,

    CASE WHEN COALESCE(ps.qty_pieces,0) > 0
         THEN ROUND(ps.revenue_mvr / ps.qty_pieces, 4) ELSE 0 END AS avg_unit_price_mvr,

    COALESCE(ll.landed_per_piece_mvr, 0)                       AS landed_per_piece_mvr,

    ROUND(COALESCE(ll.landed_per_piece_mvr,0) * COALESCE(ps.qty_pieces,0), 2)
                                                                AS total_landed_cost_mvr,

    CASE
      WHEN COALESCE(ps.qty_pieces,0) > 0
        AND COALESCE(ll.landed_per_piece_mvr,0) > 0
        AND (ps.revenue_mvr / ps.qty_pieces) > 0
      THEN ROUND((1 - ll.landed_per_piece_mvr / (ps.revenue_mvr / ps.qty_pieces)) * 100, 1)
      ELSE NULL
    END                                                         AS gross_margin_pct,

    ROUND(COALESCE(sm.marketing_mvr, 0), 2)                    AS marketing_spend_mvr,

    CASE WHEN COALESCE(ps.qty_pieces,0) > 0
         THEN ROUND(COALESCE(sm.marketing_mvr,0) / ps.qty_pieces, 4) ELSE 0 END
                                                                AS mktg_per_piece_mvr,

    -- Contribution = revenue - landed cost of sold - allocated marketing
    ROUND(
      COALESCE(ps.revenue_mvr,0)
      - COALESCE(ll.landed_per_piece_mvr,0) * COALESCE(ps.qty_pieces,0)
      - COALESCE(sm.marketing_mvr,0)
    , 2)                                                        AS contribution_mvr,

    CASE WHEN COALESCE(ps.qty_pieces,0) > 0
      THEN ROUND(
        ( COALESCE(ps.revenue_mvr,0)
          - COALESCE(ll.landed_per_piece_mvr,0) * COALESCE(ps.qty_pieces,0)
          - COALESCE(sm.marketing_mvr,0)
        ) / ps.qty_pieces
      , 4)
      ELSE 0 END                                                AS contribution_per_piece,

    CASE
      WHEN COALESCE(ps.qty_pieces,0) > 0 AND ps.revenue_mvr > 0
      THEN ROUND(
        ( COALESCE(ps.revenue_mvr,0)
          - COALESCE(ll.landed_per_piece_mvr,0) * COALESCE(ps.qty_pieces,0)
          - COALESCE(sm.marketing_mvr,0)
        ) / ps.revenue_mvr * 100
      , 1)
      ELSE NULL
    END                                                         AS contribution_margin_pct

  FROM skus s
  JOIN variants v       ON v.id = s.variant_id
  JOIN product_models m ON m.id = v.model_id
  JOIN brands b         ON b.id = m.brand_id
  JOIN period_sales ps  ON ps.sku_id = s.id           -- only SKUs with sales in period
  LEFT JOIN latest_landed ll ON ll.sku_id = s.id
  LEFT JOIN sku_marketing sm ON sm.sku_id = s.id
  WHERE s.is_active = TRUE
  ORDER BY contribution_mvr DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_contribution_margin(DATE, DATE) TO authenticated;

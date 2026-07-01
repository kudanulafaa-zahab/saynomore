-- get_reports_data and get_contribution_margin both computed margin using
-- "whatever the SKU's landed cost is TODAY" applied to units sold across the
-- whole reporting period -- so margin on old sales silently changed every
-- time a new shipment landed at a different cost. Migration 0045 made every
-- sale (from now on) permanently remember its own true cost
-- (sales_order_lines.landed_cost_per_piece_mvr, set once by post_sale).
--
-- This migration makes both reporting RPCs read that locked-in per-line
-- cost instead of re-deriving it. Legacy rows sold before 0045 have no
-- snapshot (NULL) -- for those only, fall back to the current "latest
-- landed cost" estimate, same as before, so historical reports don't go
-- blank. Fully-snapshotted periods are now permanently accurate; only
-- reports spanning pre-migration sales mix in an estimate for those rows.

CREATE OR REPLACE FUNCTION get_reports_data(p_from DATE, p_to DATE)
RETURNS TABLE (
  sku_id                UUID,
  brand_name             TEXT,
  model_name              TEXT,
  variant_display         TEXT,
  internal_code           TEXT,
  pcs_per_pack            INTEGER,
  packs_per_carton        INTEGER,
  total_qty_pieces        BIGINT,
  total_revenue_mvr       NUMERIC,
  avg_unit_price_mvr      NUMERIC,
  landed_per_piece_mvr    NUMERIC,
  total_landed_cost_mvr   NUMERIC,
  gross_margin_pct        NUMERIC,
  stock_pieces            BIGINT,
  days_of_stock           NUMERIC,
  has_estimated_cost      BOOLEAN
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH
  -- Latest in-stock landed cost, used ONLY as a fallback for legacy lines
  -- (sold before migration 0045) that have no cost snapshot of their own.
  latest_landed AS (
    SELECT DISTINCT ON (sku_id)
      sku_id, landed_per_piece_mvr
    FROM v_batch_stock
    WHERE qty_pieces_remaining > 0
    ORDER BY sku_id, received_at DESC
  ),

  period_sales AS (
    SELECT
      sol.sku_id,
      SUM(sol.qty_pieces)                                                  AS qty_pieces,
      SUM(sol.line_total_mvr)                                              AS revenue_mvr,
      -- Cost of goods sold: snapshot where we have it, latest-landed estimate
      -- otherwise (legacy rows only).
      SUM(sol.qty_pieces * COALESCE(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0)) AS cogs_mvr,
      BOOL_OR(sol.landed_cost_per_piece_mvr IS NULL)                        AS has_estimated_cost
    FROM sales_order_lines sol
    JOIN sales_orders so   ON so.id = sol.order_id
    LEFT JOIN latest_landed ll ON ll.sku_id = sol.sku_id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.created_at::DATE BETWEEN p_from AND p_to
    GROUP BY sol.sku_id
  ),

  current_stock AS (
    SELECT
      sku_id,
      SUM(stock_signed_delta(movement_type, qty_pieces)) AS stock_pieces
    FROM stock_movements
    GROUP BY sku_id
  )

  SELECT
    s.id                                                        AS sku_id,
    b.name                                                      AS brand_name,
    m.name                                                      AS model_name,
    v.display_name                                              AS variant_display,
    s.internal_code,
    s.pcs_per_pack,
    s.packs_per_carton,

    COALESCE(ps.qty_pieces, 0)::BIGINT                         AS total_qty_pieces,
    COALESCE(ps.revenue_mvr, 0)                                AS total_revenue_mvr,

    CASE
      WHEN COALESCE(ps.qty_pieces, 0) > 0
      THEN ROUND(ps.revenue_mvr / ps.qty_pieces, 4)
      ELSE 0
    END                                                         AS avg_unit_price_mvr,

    CASE
      WHEN COALESCE(ps.qty_pieces, 0) > 0
      THEN ROUND(ps.cogs_mvr / ps.qty_pieces, 4)
      ELSE 0
    END                                                         AS landed_per_piece_mvr,

    ROUND(COALESCE(ps.cogs_mvr, 0), 2)                         AS total_landed_cost_mvr,

    CASE
      WHEN COALESCE(ps.qty_pieces, 0) > 0
        AND COALESCE(ps.cogs_mvr, 0) > 0
        AND ps.revenue_mvr > 0
      THEN ROUND((1 - ps.cogs_mvr / ps.revenue_mvr) * 100, 1)
      ELSE NULL
    END                                                         AS gross_margin_pct,

    GREATEST(COALESCE(cs.stock_pieces, 0), 0)::BIGINT          AS stock_pieces,

    CASE
      WHEN COALESCE(ps.qty_pieces, 0) > 0
        AND GREATEST(COALESCE(cs.stock_pieces, 0), 0) > 0
      THEN ROUND(
        GREATEST(COALESCE(cs.stock_pieces, 0), 0)::NUMERIC
        / (ps.qty_pieces::NUMERIC / GREATEST((p_to - p_from + 1), 1)),
        0
      )
      ELSE NULL
    END                                                         AS days_of_stock,

    COALESCE(ps.has_estimated_cost, FALSE)                     AS has_estimated_cost

  FROM skus s
  JOIN variants v             ON v.id = s.variant_id
  JOIN product_models m       ON m.id = v.model_id
  JOIN brands b               ON b.id = m.brand_id
  LEFT JOIN period_sales ps   ON ps.sku_id = s.id
  LEFT JOIN current_stock cs  ON cs.sku_id = s.id
  WHERE s.is_active = TRUE
  ORDER BY COALESCE(ps.revenue_mvr, 0) DESC;
$function$;

CREATE OR REPLACE FUNCTION get_contribution_margin(p_from DATE, p_to DATE)
RETURNS TABLE (
  sku_id                    UUID,
  brand_name                TEXT,
  model_name                 TEXT,
  variant_display            TEXT,
  internal_code              TEXT,
  total_qty_pieces           BIGINT,
  total_revenue_mvr          NUMERIC,
  avg_unit_price_mvr         NUMERIC,
  landed_per_piece_mvr       NUMERIC,
  total_landed_cost_mvr      NUMERIC,
  gross_margin_pct           NUMERIC,
  marketing_spend_mvr        NUMERIC,
  mktg_per_piece_mvr         NUMERIC,
  contribution_mvr           NUMERIC,
  contribution_per_piece     NUMERIC,
  contribution_margin_pct    NUMERIC,
  has_estimated_cost         BOOLEAN
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH
  latest_landed AS (
    SELECT DISTINCT ON (sku_id)
      sku_id, landed_per_piece_mvr
    FROM v_batch_stock
    WHERE qty_pieces_remaining > 0
    ORDER BY sku_id, received_at DESC
  ),

  period_sales AS (
    SELECT
      sol.sku_id,
      SUM(sol.qty_pieces)                                                  AS qty_pieces,
      SUM(sol.line_total_mvr)                                              AS revenue_mvr,
      SUM(sol.qty_pieces * COALESCE(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0)) AS cogs_mvr,
      BOOL_OR(sol.landed_cost_per_piece_mvr IS NULL)                        AS has_estimated_cost
    FROM sales_order_lines sol
    JOIN sales_orders so   ON so.id = sol.order_id
    LEFT JOIN latest_landed ll ON ll.sku_id = sol.sku_id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.created_at::DATE BETWEEN p_from AND p_to
    GROUP BY sol.sku_id
  ),

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

  campaign_totals AS (
    SELECT spend_id, amount_mvr, SUM(units) AS total_units
    FROM campaign_sku_units
    GROUP BY spend_id, amount_mvr
  ),

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

    CASE WHEN COALESCE(ps.qty_pieces, 0) > 0
         THEN ROUND(ps.cogs_mvr / ps.qty_pieces, 4) ELSE 0 END    AS landed_per_piece_mvr,

    ROUND(COALESCE(ps.cogs_mvr, 0), 2)                         AS total_landed_cost_mvr,

    CASE
      WHEN COALESCE(ps.qty_pieces,0) > 0
        AND COALESCE(ps.cogs_mvr,0) > 0
        AND ps.revenue_mvr > 0
      THEN ROUND((1 - ps.cogs_mvr / ps.revenue_mvr) * 100, 1)
      ELSE NULL
    END                                                         AS gross_margin_pct,

    ROUND(COALESCE(sm.marketing_mvr, 0), 2)                    AS marketing_spend_mvr,

    CASE WHEN COALESCE(ps.qty_pieces,0) > 0
         THEN ROUND(COALESCE(sm.marketing_mvr,0) / ps.qty_pieces, 4) ELSE 0 END
                                                                AS mktg_per_piece_mvr,

    ROUND(
      COALESCE(ps.revenue_mvr,0)
      - COALESCE(ps.cogs_mvr,0)
      - COALESCE(sm.marketing_mvr,0)
    , 2)                                                        AS contribution_mvr,

    CASE WHEN COALESCE(ps.qty_pieces,0) > 0
      THEN ROUND(
        ( COALESCE(ps.revenue_mvr,0)
          - COALESCE(ps.cogs_mvr,0)
          - COALESCE(sm.marketing_mvr,0)
        ) / ps.qty_pieces
      , 4)
      ELSE 0 END                                                AS contribution_per_piece,

    CASE
      WHEN COALESCE(ps.qty_pieces,0) > 0 AND ps.revenue_mvr > 0
      THEN ROUND(
        ( COALESCE(ps.revenue_mvr,0)
          - COALESCE(ps.cogs_mvr,0)
          - COALESCE(sm.marketing_mvr,0)
        ) / ps.revenue_mvr * 100
      , 1)
      ELSE NULL
    END                                                         AS contribution_margin_pct,

    COALESCE(ps.has_estimated_cost, FALSE)                     AS has_estimated_cost

  FROM skus s
  JOIN variants v       ON v.id = s.variant_id
  JOIN product_models m ON m.id = v.model_id
  JOIN brands b         ON b.id = m.brand_id
  JOIN period_sales ps  ON ps.sku_id = s.id
  LEFT JOIN sku_marketing sm ON sm.sku_id = s.id
  WHERE s.is_active = TRUE
  ORDER BY contribution_mvr DESC NULLS LAST;
$function$;

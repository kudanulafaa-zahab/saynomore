-- ── Migration 0019: add total_landed_cost_mvr to get_reports_data ─────────
--
-- The original RPC returned landed_per_piece_mvr and total_qty_pieces as
-- separate columns. The UI was multiplying them in TypeScript — a hard-rule
-- violation (Rule 1: all financial calculations in Postgres, never TypeScript).
--
-- This migration replaces the function, adding:
--   total_landed_cost_mvr = ROUND(landed_per_piece_mvr * total_qty_pieces, 2)
-- computed in Postgres. The UI must read this field directly.

DROP FUNCTION IF EXISTS get_reports_data(date, date);

CREATE FUNCTION get_reports_data(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (
  sku_id                UUID,
  brand_name            TEXT,
  model_name            TEXT,
  variant_display       TEXT,
  internal_code         TEXT,
  pcs_per_pack          INTEGER,
  packs_per_carton      INTEGER,
  total_qty_pieces      BIGINT,
  total_revenue_mvr     NUMERIC,
  avg_unit_price_mvr    NUMERIC,
  landed_per_piece_mvr  NUMERIC,
  total_landed_cost_mvr NUMERIC,   -- NEW: landed_per_piece × total_qty_pieces
  gross_margin_pct      NUMERIC,
  stock_pieces          BIGINT,
  days_of_stock         NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH

  -- Sales in the selected period (confirmed+ only, not draft/cancelled)
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

  -- Current stock per SKU (across all godowns)
  current_stock AS (
    SELECT
      sku_id,
      SUM(
        CASE
          WHEN movement_type IN ('in', 'transfer_in', 'return_in')          THEN  qty_pieces
          WHEN movement_type IN ('out', 'transfer_out', 'damage_out', 'sales_order') THEN -qty_pieces
          ELSE 0
        END
      ) AS stock_pieces
    FROM stock_movements
    GROUP BY sku_id
  ),

  -- Latest landed cost per SKU (most recent in-stock batch)
  latest_landed AS (
    SELECT DISTINCT ON (sku_id)
      sku_id,
      landed_per_piece_mvr
    FROM v_batch_stock
    WHERE qty_pieces_remaining > 0
    ORDER BY sku_id, received_at DESC
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

    -- avg price per piece (avoid div-by-zero)
    CASE
      WHEN COALESCE(ps.qty_pieces, 0) > 0
      THEN ROUND(ps.revenue_mvr / ps.qty_pieces, 4)
      ELSE 0
    END                                                         AS avg_unit_price_mvr,

    COALESCE(ll.landed_per_piece_mvr, 0)                       AS landed_per_piece_mvr,

    -- ── Total landed cost for the sold qty — computed in Postgres ────────
    ROUND(
      COALESCE(ll.landed_per_piece_mvr, 0) * COALESCE(ps.qty_pieces, 0),
      2
    )                                                           AS total_landed_cost_mvr,

    -- Gross margin % based on actual invoiced avg sell price vs landed cost
    CASE
      WHEN COALESCE(ps.qty_pieces, 0) > 0
        AND COALESCE(ll.landed_per_piece_mvr, 0) > 0
        AND (ps.revenue_mvr / ps.qty_pieces) > 0
      THEN ROUND(
        (1 - ll.landed_per_piece_mvr / (ps.revenue_mvr / ps.qty_pieces)) * 100,
        1
      )
      ELSE NULL
    END                                                         AS gross_margin_pct,

    GREATEST(COALESCE(cs.stock_pieces, 0), 0)::BIGINT          AS stock_pieces,

    -- Days of stock: current stock ÷ daily avg sold in period
    CASE
      WHEN COALESCE(ps.qty_pieces, 0) > 0
        AND GREATEST(COALESCE(cs.stock_pieces, 0), 0) > 0
      THEN ROUND(
        GREATEST(COALESCE(cs.stock_pieces, 0), 0)::NUMERIC
        / (ps.qty_pieces::NUMERIC / GREATEST((p_to - p_from + 1), 1)),
        0
      )
      ELSE NULL
    END                                                         AS days_of_stock

  FROM skus s
  JOIN variants v             ON v.id = s.variant_id
  JOIN product_models m       ON m.id = v.model_id
  JOIN brands b               ON b.id = m.brand_id
  LEFT JOIN period_sales ps   ON ps.sku_id = s.id
  LEFT JOIN current_stock cs  ON cs.sku_id = s.id
  LEFT JOIN latest_landed ll  ON ll.sku_id = s.id
  WHERE s.is_active = TRUE
  ORDER BY COALESCE(ps.revenue_mvr, 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION get_reports_data(DATE, DATE) TO authenticated;

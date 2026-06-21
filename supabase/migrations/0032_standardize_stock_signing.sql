-- ── Migration 0032: Standardize on-hand stock signing across all RPCs ──────────
--
-- AUDIT FINDING. Three different conventions for signing stock_movements were in
-- use, so reports, dashboard, and reorder alerts could each compute a DIFFERENT
-- on-hand figure for the same SKU. The bugs (all latent — DB has no movements yet,
-- so no data was corrupted):
--
--  1. get_reports_data (0019): the stock CASE referenced a non-existent
--     movement_type 'sales_order' (that string is a SOURCE_type, not a
--     movement_type) AND omitted 'adjustment' entirely → adjustments invisible.
--  2. get_dashboard_metrics (0024):
--       • low_stock used `ELSE -qty_pieces`, so a POSITIVE 'adjustment' wrongly
--         SUBTRACTED from stock.
--       • stock_val out-bucket omitted 'adjustment', so adjustments never
--         affected stock value.
--
-- CANONICAL RULE (enforced everywhere from now on):
--   qty_pieces is ALWAYS POSITIVE for typed movements; the sign comes from type.
--   'adjustment' is the ONE exception — it stores a SIGNED delta (an adjustment
--   has no inherent direction), so it is added as-is.
--
--   on_hand = SUM(CASE
--     WHEN movement_type IN ('in','transfer_in','return_in')   THEN  qty_pieces
--     WHEN movement_type IN ('out','transfer_out','damage_out') THEN -qty_pieces
--     WHEN movement_type = 'adjustment'                         THEN  qty_pieces
--     ELSE 0 END)
--
-- A helper function centralizes this so a future movement_type can never drift
-- between callers again.

-- ── Reusable signed-delta helper ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION stock_signed_delta(p_type TEXT, p_qty INTEGER)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_type IN ('in', 'transfer_in', 'return_in')   THEN  p_qty
    WHEN p_type IN ('out', 'transfer_out', 'damage_out') THEN -p_qty
    WHEN p_type = 'adjustment'                           THEN  p_qty  -- already signed
    ELSE 0
  END;
$$;

-- ── Fix get_reports_data ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_reports_data(DATE, DATE);

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
  total_landed_cost_mvr NUMERIC,
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

  -- Current stock per SKU — canonical signed delta (now includes adjustments)
  current_stock AS (
    SELECT
      sku_id,
      SUM(stock_signed_delta(movement_type, qty_pieces)) AS stock_pieces
    FROM stock_movements
    GROUP BY sku_id
  ),

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

    CASE
      WHEN COALESCE(ps.qty_pieces, 0) > 0
      THEN ROUND(ps.revenue_mvr / ps.qty_pieces, 4)
      ELSE 0
    END                                                         AS avg_unit_price_mvr,

    COALESCE(ll.landed_per_piece_mvr, 0)                       AS landed_per_piece_mvr,

    ROUND(
      COALESCE(ll.landed_per_piece_mvr, 0) * COALESCE(ps.qty_pieces, 0),
      2
    )                                                           AS total_landed_cost_mvr,

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

-- ── Fix get_dashboard_metrics (low_stock + stock_val signing) ──────────────────
DROP FUNCTION IF EXISTS get_dashboard_metrics();

CREATE FUNCTION get_dashboard_metrics()
RETURNS TABLE (
  revenue_today_mvr           NUMERIC,
  revenue_this_month_mvr      NUMERIC,
  revenue_last_month_mvr      NUMERIC,
  gross_profit_this_month_mvr NUMERIC,
  gross_margin_pct            NUMERIC,
  orders_awaiting_dispatch    BIGINT,
  orders_out_for_delivery     BIGINT,
  orders_dispatched_today     BIGINT,
  orders_delivered_today      BIGINT,
  overdue_orders_count        BIGINT,
  low_stock_sku_count         BIGINT,
  total_stock_value_mvr       NUMERIC,
  shipments_in_transit        BIGINT,
  pending_payments_mvr        NUMERIC,
  pending_payments_count      BIGINT,
  cod_undeposited_mvr         NUMERIC,
  shipments_arriving_soon     BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  this_month_start AS (SELECT DATE_TRUNC('month', CURRENT_DATE) AS d),
  last_month_start AS (SELECT DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' AS d),
  last_month_end   AS (SELECT DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day' AS d),

  sales_revenue AS (
    SELECT sol.line_total_mvr, so.created_at::DATE AS sale_date
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    WHERE so.status NOT IN ('draft','cancelled')
  ),
  gross_cost AS (
    SELECT COALESCE(SUM(sm.qty_pieces * ib.landed_per_piece_mvr),0) AS total_cost
    FROM stock_movements sm
    JOIN inventory_batches ib ON ib.id = sm.batch_id
    JOIN sales_orders so ON so.id = sm.source_id
    WHERE sm.source_type = 'sales_order' AND sm.movement_type = 'out'
      AND so.created_at::DATE >= (SELECT d FROM this_month_start)
      AND so.status NOT IN ('draft','cancelled')
  ),
  revenue_month AS (
    SELECT COALESCE(SUM(line_total_mvr),0) AS total FROM sales_revenue
    WHERE sale_date >= (SELECT d FROM this_month_start)
  ),
  out_for_delivery_now AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'out_for_delivery'),
  delivered_today      AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'delivered' AND delivered_at::DATE = CURRENT_DATE),
  dispatched_today     AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'out_for_delivery' AND updated_at::DATE = CURRENT_DATE),
  awaiting_dispatch    AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'confirmed'),
  overdue              AS (SELECT COUNT(*) AS cnt FROM sales_orders WHERE status = 'confirmed' AND created_at < NOW() - INTERVAL '24 hours'),
  pending_pay AS (
    SELECT COALESCE(SUM(sol.line_total_mvr),0) AS total, COUNT(DISTINCT so.id) AS cnt
    FROM sales_orders so JOIN sales_order_lines sol ON sol.order_id = so.id
    WHERE so.status = 'delivered' AND so.payment_status IN ('pending','partial')
  ),
  cod_undeposited AS (
    SELECT COALESCE(SUM(so.cash_collected_mvr),0) AS total
    FROM sales_orders so
    WHERE so.status = 'delivered'
      AND so.payment_method = 'cod'
      AND so.payment_status = 'paid'
      AND so.cash_deposited_at IS NULL
      AND so.cash_collected_mvr > 0
  ),
  transit AS (SELECT COUNT(*) AS cnt FROM shipments WHERE status = 'in_transit'),
  arriving_soon AS (
    SELECT COUNT(*) AS cnt FROM shipments
    WHERE status = 'in_transit'
      AND expected_arrival_date IS NOT NULL
      AND expected_arrival_date >= CURRENT_DATE
      AND expected_arrival_date <= CURRENT_DATE + INTERVAL '3 days'
  ),
  -- Stock value: on-hand per batch × landed cost. Out-bucket now includes the
  -- negative side of adjustments so corrections are reflected in value.
  stock_val AS (
    SELECT COALESCE(SUM(on_hand.qty * ib.landed_per_piece_mvr),0) AS total
    FROM inventory_batches ib
    JOIN (
      SELECT batch_id, SUM(stock_signed_delta(movement_type, qty_pieces)) AS qty
      FROM stock_movements
      WHERE batch_id IS NOT NULL
      GROUP BY batch_id
    ) on_hand ON on_hand.batch_id = ib.id
    WHERE on_hand.qty > 0
  ),
  -- Low stock: canonical signed on-hand; daily_avg from sales out-movements only
  low_stock AS (
    SELECT COUNT(*) AS cnt FROM (
      SELECT s.id,
        COALESCE(SUM(stock_signed_delta(sm.movement_type, sm.qty_pieces)),0) AS stock_pcs,
        COALESCE(SUM(CASE WHEN sm.movement_type = 'out' AND sm.source_type = 'sales_order'
                          AND sm.created_at >= NOW() - INTERVAL '30 days'
                     THEN sm.qty_pieces ELSE 0 END) / 30.0, 0) AS daily_avg
      FROM skus s LEFT JOIN stock_movements sm ON sm.sku_id = s.id
      WHERE s.is_active = TRUE GROUP BY s.id
    ) x WHERE daily_avg > 0 AND stock_pcs / daily_avg < 10
  )

  SELECT
    COALESCE(SUM(CASE WHEN sr.sale_date = CURRENT_DATE THEN sr.line_total_mvr ELSE 0 END),0),
    (SELECT total FROM revenue_month),
    COALESCE(SUM(CASE WHEN sr.sale_date >= (SELECT d FROM last_month_start) AND sr.sale_date <= (SELECT d FROM last_month_end) THEN sr.line_total_mvr ELSE 0 END),0),
    GREATEST((SELECT total FROM revenue_month) - (SELECT total_cost FROM gross_cost),0),
    CASE WHEN (SELECT total FROM revenue_month) > 0
         THEN ROUND(GREATEST((SELECT total FROM revenue_month) - (SELECT total_cost FROM gross_cost),0) / (SELECT total FROM revenue_month) * 100,1)
         ELSE 0 END,
    (SELECT cnt  FROM awaiting_dispatch),
    (SELECT cnt  FROM out_for_delivery_now),
    (SELECT cnt  FROM dispatched_today),
    (SELECT cnt  FROM delivered_today),
    (SELECT cnt  FROM overdue),
    (SELECT cnt  FROM low_stock),
    (SELECT total FROM stock_val),
    (SELECT cnt  FROM transit),
    (SELECT total FROM pending_pay),
    (SELECT cnt  FROM pending_pay),
    (SELECT total FROM cod_undeposited),
    (SELECT cnt  FROM arriving_soon)
  FROM sales_revenue sr;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_metrics() TO authenticated;

-- ── Fix get_sku_reorder_alerts (use canonical helper; drop dead branches) ──────
CREATE OR REPLACE FUNCTION get_sku_reorder_alerts()
RETURNS TABLE (
  sku_id             UUID,
  stock_pieces       NUMERIC,
  daily_avg_pieces   NUMERIC,
  dir                NUMERIC,
  reorder_point_pcs  NUMERIC,
  alert_level        TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  stock AS (
    SELECT
      sm.sku_id,
      COALESCE(SUM(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0) AS stock_pieces
    FROM stock_movements sm
    GROUP BY sm.sku_id
  ),
  velocity AS (
    SELECT
      sm.sku_id,
      SUM(sm.qty_pieces)::NUMERIC / 30.0 AS daily_avg
    FROM stock_movements sm
    JOIN sales_orders so ON so.id = sm.source_id
    WHERE sm.movement_type = 'out'
      AND sm.source_type   = 'sales_order'
      AND sm.created_at   >= NOW() - INTERVAL '30 days'
      AND so.status NOT IN ('draft', 'cancelled')
    GROUP BY sm.sku_id
  )
  SELECT
    s.id                                                          AS sku_id,
    GREATEST(COALESCE(st.stock_pieces, 0), 0)                   AS stock_pieces,
    COALESCE(v.daily_avg, 0)                                     AS daily_avg_pieces,
    CASE
      WHEN COALESCE(v.daily_avg, 0) > 0
      THEN ROUND(GREATEST(COALESCE(st.stock_pieces, 0), 0) / v.daily_avg, 1)
      ELSE NULL
    END                                                           AS dir,
    ROUND(COALESCE(v.daily_avg, 0) * 21, 0)                     AS reorder_point_pcs,
    CASE
      WHEN COALESCE(v.daily_avg, 0) <= 0 THEN 'ok'
      WHEN GREATEST(COALESCE(st.stock_pieces, 0), 0) / v.daily_avg < 7  THEN 'critical'
      WHEN GREATEST(COALESCE(st.stock_pieces, 0), 0) / v.daily_avg < 14 THEN 'low'
      ELSE 'ok'
    END                                                           AS alert_level
  FROM skus s
  LEFT JOIN stock     st ON st.sku_id = s.id
  LEFT JOIN velocity  v  ON v.sku_id  = s.id
  WHERE s.is_active = TRUE
    AND COALESCE(st.stock_pieces, 0) > 0;
$$;

GRANT EXECUTE ON FUNCTION get_sku_reorder_alerts() TO authenticated;

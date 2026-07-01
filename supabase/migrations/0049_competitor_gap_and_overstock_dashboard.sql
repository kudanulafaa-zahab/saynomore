-- ── Migration 0049: Competitor price-gap list + overstock/reorder on Dashboard
--
-- Two independent additions, both reusing existing math rather than inventing
-- new rules:
--
-- (1) get_competitor_price_gaps(p_threshold_pct default 10)
--     Runs the same per-piece normalization already used one-SKU-at-a-time in
--     the Competitors screen (components/competitors/competitors-view.tsx,
--     perPieceComparison) across EVERY SKU with at least one competitor price
--     logged, so Ali doesn't have to open each product to find the ones
--     priced above competitors. Only per_piece/per_pack/per_carton bases are
--     normalized (matches the UI); per_100ml/per_100g rows are excluded since
--     the existing UI doesn't normalize those either.
--
-- (2) get_dashboard_metrics(): add overstock_sku_count + reorder_needed_count.
--     Reuses get_reorder_suggestions()'s existing status field (already
--     computes 'overstock' when dir > 90 days, migration 0040) — no new
--     thresholds invented here.

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
        WHEN 'per_carton' THEN cp.price_mvr / NULLIF(vs.pcs_per_pack * vs.packs_per_carton, 0)
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

-- ── Extend get_dashboard_metrics with overstock + reorder-needed counts ─────
DROP FUNCTION IF EXISTS get_dashboard_metrics();

CREATE OR REPLACE FUNCTION get_dashboard_metrics()
RETURNS TABLE(
  revenue_today_mvr numeric, revenue_this_month_mvr numeric, revenue_last_month_mvr numeric,
  gross_profit_this_month_mvr numeric, gross_margin_pct numeric,
  orders_awaiting_dispatch bigint, orders_out_for_delivery bigint,
  orders_dispatched_today bigint, orders_delivered_today bigint, overdue_orders_count bigint,
  low_stock_sku_count bigint, total_stock_value_mvr numeric,
  shipments_in_transit bigint,
  pending_payments_mvr numeric, pending_payments_count bigint,
  cod_undeposited_mvr numeric, shipments_arriving_soon bigint,
  overstock_sku_count bigint, reorder_needed_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $function$
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
  ),
  -- [0049] Reuse get_reorder_suggestions()'s existing status classification —
  -- 'overstock' when dir > 90 days (migration 0040), critical/low = reorder needed.
  reorder_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'overstock') AS overstock_cnt,
      COUNT(*) FILTER (WHERE status IN ('critical', 'low')) AS reorder_cnt
    FROM get_reorder_suggestions()
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
    (SELECT cnt  FROM arriving_soon),
    (SELECT overstock_cnt FROM reorder_stats),
    (SELECT reorder_cnt FROM reorder_stats)
  FROM sales_revenue sr;
$function$;

GRANT EXECUTE ON FUNCTION get_dashboard_metrics() TO authenticated;

COMMIT;

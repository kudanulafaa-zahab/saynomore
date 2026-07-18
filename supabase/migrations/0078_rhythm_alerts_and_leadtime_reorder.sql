-- ============================================================================
-- 0078 — Customer rhythm alerts + lead-time-aware reorder dates (2026-07-18)
-- ============================================================================
-- Two intelligence upgrades, both computed entirely in Postgres:
--
-- A) get_morning_briefing() gains `overdue_customers`: repeat customers
--    (≥3 distinct order days) whose days-since-last-order exceeds 1.5× their
--    own median ordering gap — "Fathimath Store usually orders every 12 days,
--    it's been 19." Revenue protection surfaced before it's lost. Top 3 by
--    how overdue they are.
--
-- B) get_reorder_suggestions() learns each SKU's real import lead time from
--    shipment history (created_at → grn_confirmed_at over the last 3
--    confirmed shipments; falls back to p_lead_weeks when a SKU has no
--    history) and returns an `order_by_date`: the calendar day an order must
--    be placed so new stock lands before the current stock runs out. A date
--    and a consequence, not abstract weeks. Return-shape change → DROP first.
--    Grants restated because 0076's default-privileges lockdown means a
--    dropped-and-recreated function starts with NO grants at all.
-- ============================================================================

-- ── A. Morning briefing with customer rhythm alerts ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_morning_briefing()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'yesterday_revenue', COALESCE((
      SELECT SUM(sol.line_total_mvr) FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.order_id
      WHERE so.status NOT IN ('draft','cancelled')
        AND so.created_at::date = CURRENT_DATE - 1), 0),
    'yesterday_orders', (
      SELECT COUNT(*) FROM sales_orders
      WHERE status NOT IN ('draft','cancelled')
        AND created_at::date = CURRENT_DATE - 1),
    'yesterday_delivered', (
      SELECT COUNT(*) FROM sales_orders
      WHERE delivered_at::date = CURRENT_DATE - 1),
    'yesterday_collected', COALESCE((
      SELECT SUM(amount_mvr) FROM order_payments
      WHERE paid_at::date = CURRENT_DATE - 1), 0),
    'overdue_count', (
      SELECT COUNT(*) FROM get_receivables_aging() WHERE bucket <> 'current'),
    'overdue_mvr', COALESCE((
      SELECT SUM(outstanding_mvr) FROM get_receivables_aging() WHERE bucket <> 'current'), 0),
    'slow_movers', (
      SELECT COUNT(*) FROM get_promo_suggestions()),
    'expiring_value_mvr', COALESCE((
      SELECT SUM(value_mvr) FROM v_expiring_stock WHERE days_left <= 60), 0),
    'overdue_customers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'name', x.name, 'phone', x.phone,
               'usual_gap_days', x.gap_days,
               'days_since_last', x.days_since))
      FROM (
        SELECT c.name, c.phone, r.gap_days, r.days_since
        FROM (
          SELECT seq.customer_id,
                 ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY seq.gap))::int AS gap_days,
                 (CURRENT_DATE - MAX(seq.d))::int AS days_since,
                 COUNT(*) AS order_days
          FROM (
            SELECT dd.customer_id, dd.d,
                   dd.d - LAG(dd.d) OVER (PARTITION BY dd.customer_id ORDER BY dd.d) AS gap
            FROM (
              SELECT DISTINCT so.customer_id, so.created_at::date AS d
              FROM sales_orders so
              WHERE so.status NOT IN ('draft','cancelled')
                AND so.customer_id IS NOT NULL
            ) dd
          ) seq
          GROUP BY seq.customer_id
          HAVING COUNT(*) >= 3
        ) r
        JOIN customers c ON c.id = r.customer_id
        WHERE r.gap_days >= 1
          AND r.days_since > CEIL(r.gap_days * 1.5)
        ORDER BY (r.days_since - r.gap_days) DESC
        LIMIT 3
      ) x
    ), '[]'::jsonb)
  );
$$;

-- ── B. Reorder suggestions with learned lead times + order-by dates ─────────
DROP FUNCTION IF EXISTS public.get_reorder_suggestions(numeric, numeric);

CREATE FUNCTION public.get_reorder_suggestions(
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
  dir               NUMERIC,
  cover_days        NUMERIC,
  suggested_pieces  NUMERIC,
  suggested_cartons INTEGER,
  pcs_per_carton    INTEGER,
  revenue_per_day   NUMERIC,
  status            TEXT,
  supplier_name     TEXT,      -- latest confirmed shipment's supplier
  lead_days         NUMERIC,   -- learned from history; NULL = no history yet
  order_by_date     DATE       -- place the order by this day; NULL = no velocity
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH
  cover AS (
    SELECT (COALESCE(p_lead_weeks, 6) + COALESCE(p_safety_weeks, 4)) * 7.0 AS cover_days
  ),
  lead_hist AS (
    SELECT sl.sku_id, s.created_at, s.grn_confirmed_at, sup.name AS supplier_name,
           ROW_NUMBER() OVER (PARTITION BY sl.sku_id ORDER BY s.grn_confirmed_at DESC) AS rn
    FROM (SELECT DISTINCT shipment_id, sku_id FROM shipment_lines) sl
    JOIN shipments s ON s.id = sl.shipment_id AND s.grn_confirmed_at IS NOT NULL
    LEFT JOIN suppliers sup ON sup.id = s.supplier_id
  ),
  sku_lead AS (
    SELECT lh.sku_id,
           ROUND((AVG(EXTRACT(epoch FROM (lh.grn_confirmed_at - lh.created_at)) / 86400.0)
                  FILTER (WHERE lh.rn <= 3))::numeric, 0) AS lead_days,
           MAX(lh.supplier_name) FILTER (WHERE lh.rn = 1)  AS supplier_name
    FROM lead_hist lh
    GROUP BY lh.sku_id
  ),
  base AS (
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
    GREATEST(0, ROUND(b.daily_avg_pieces * b.cover_days - b.stock_pieces, 0)) AS suggested_pieces,
    CEIL(
      GREATEST(0, b.daily_avg_pieces * b.cover_days - b.stock_pieces)
      / NULLIF(vs.pcs_per_carton, 0)
    )::INTEGER                                                           AS suggested_cartons,
    vs.pcs_per_carton,
    ROUND(b.daily_avg_pieces * COALESCE(vs.selling_price_per_piece_mvr, 0), 2) AS revenue_per_day,
    CASE
      WHEN b.dir IS NOT NULL AND b.dir > 90 THEN 'overstock'
      ELSE b.alert_level
    END                                                                  AS status,
    sl.supplier_name,
    sl.lead_days,
    -- The day stock runs out (today + DIR) minus how long a new order takes
    -- to arrive (learned lead, else the p_lead_weeks assumption). Clamped to
    -- today: a date in the past means "you're already late — order today."
    CASE
      WHEN b.dir IS NOT NULL THEN GREATEST(
        CURRENT_DATE,
        CURRENT_DATE + (b.dir - COALESCE(sl.lead_days, COALESCE(p_lead_weeks, 6) * 7))::int
      )
    END                                                                  AS order_by_date
  FROM base b
  JOIN v_skus vs ON vs.id = b.sku_id
  LEFT JOIN sku_lead sl ON sl.sku_id = b.sku_id
  ORDER BY
    CASE
      WHEN b.dir IS NOT NULL AND b.dir > 90 THEN 2
      WHEN b.alert_level = 'critical' THEN 0
      WHEN b.alert_level = 'low'      THEN 1
      ELSE 3
    END,
    (b.daily_avg_pieces * COALESCE(vs.selling_price_per_piece_mvr, 0)) DESC;
$$;

-- Dropped + recreated under the 0076 default-privileges lockdown → grants
-- must be restated explicitly (and anon stays out).
GRANT EXECUTE ON FUNCTION public.get_reorder_suggestions(numeric, numeric) TO authenticated, service_role;

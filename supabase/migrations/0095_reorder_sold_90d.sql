-- ============================================================================
-- 0095 — Surface real 90-day units sold on the reorder screen
-- ============================================================================
-- Ali, deciding what to order: he needs to see, per SKU, how much it actually
-- SELLS from past sales — so he restocks the movers and skips the dead stock.
-- The velocity engine already computes 90-day units sold (units_90) but never
-- exposed it. This adds `sold_90d` (raw units sold in the last 90 days, from
-- confirmed sales) to get_sku_reorder_alerts and passes it through
-- get_reorder_suggestions, so the reorder list can show it and a plain
-- "top seller / slow mover" tag right where the ordering decision is made — no
-- separate report to cross-reference (decision support at the point of decision).
--
-- Both dropped + recreated (return-shape change), grants restated, anon revoked.
-- Callers (dashboard, low-stock digest) select by name and are unaffected.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_reorder_suggestions(numeric, numeric);
DROP FUNCTION IF EXISTS public.get_sku_reorder_alerts();

CREATE FUNCTION public.get_sku_reorder_alerts()
RETURNS TABLE (
  sku_id            uuid,
  stock_pieces      numeric,
  daily_avg_pieces  numeric,
  dir               numeric,
  reorder_point_pcs numeric,
  alert_level       text,
  daily_avg_recent  numeric,
  daily_avg_base    numeric,
  trend             text,
  sold_90d          integer   -- raw units sold in the last 90 days
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH
  stock AS (
    SELECT sm.sku_id,
      COALESCE(SUM(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0) AS stock_pieces
    FROM stock_movements sm
    GROUP BY sm.sku_id
  ),
  velocity AS (
    SELECT sm.sku_id,
      SUM(sm.qty_pieces) FILTER (WHERE sm.created_at >= NOW() - INTERVAL '30 days')::numeric / 30.0 AS v30,
      SUM(sm.qty_pieces)  AS units_90,
      MIN(sm.created_at)  AS first_out
    FROM stock_movements sm
    JOIN sales_orders so ON so.id = sm.source_id
    WHERE sm.movement_type = 'out'
      AND sm.source_type   = 'sales_order'
      AND sm.created_at   >= NOW() - INTERVAL '90 days'
      AND so.status NOT IN ('draft', 'cancelled')
    GROUP BY sm.sku_id
  ),
  blended AS (
    SELECT v.sku_id,
      COALESCE(v.v30, 0) AS v30,
      COALESCE(v.units_90, 0) AS units_90,
      CASE WHEN v.first_out IS NOT NULL
        THEN COALESCE(v.units_90, 0)
             / LEAST(90.0, GREATEST(1.0, (CURRENT_DATE - v.first_out::date) + 1))
        ELSE 0 END AS v_base
    FROM velocity v
  ),
  scored AS (
    SELECT b.sku_id, b.v30, b.v_base, b.units_90,
      ROUND(
        b.v30 * (1 + LEAST(0.4, GREATEST(0.0,
          CASE WHEN b.v_base > 0 THEN b.v30 / b.v_base - 1 ELSE 0 END) * 0.5)),
        4) AS daily_fwd
    FROM blended b
  )
  SELECT
    s.id AS sku_id,
    GREATEST(COALESCE(st.stock_pieces, 0), 0) AS stock_pieces,
    COALESCE(b.daily_fwd, 0) AS daily_avg_pieces,
    CASE WHEN COALESCE(b.daily_fwd, 0) > 0
      THEN ROUND(GREATEST(COALESCE(st.stock_pieces, 0), 0) / b.daily_fwd, 1)
      ELSE NULL END AS dir,
    ROUND(COALESCE(b.daily_fwd, 0) * 21, 0) AS reorder_point_pcs,
    CASE
      WHEN COALESCE(b.daily_fwd, 0) <= 0 THEN 'ok'
      WHEN GREATEST(COALESCE(st.stock_pieces, 0), 0) <= 0 THEN 'out'
      WHEN GREATEST(COALESCE(st.stock_pieces, 0), 0) / b.daily_fwd < 7  THEN 'critical'
      WHEN GREATEST(COALESCE(st.stock_pieces, 0), 0) / b.daily_fwd < 14 THEN 'low'
      ELSE 'ok'
    END AS alert_level,
    ROUND(COALESCE(b.v30, 0), 4)    AS daily_avg_recent,
    ROUND(COALESCE(b.v_base, 0), 4) AS daily_avg_base,
    CASE
      WHEN COALESCE(b.units_90, 0) < 6 OR COALESCE(b.v_base, 0) <= 0 THEN 'steady'
      WHEN b.v30 >= b.v_base * 1.3 THEN 'rising'
      WHEN b.v30 <= b.v_base * 0.7 THEN 'falling'
      ELSE 'steady'
    END AS trend,
    COALESCE(b.units_90, 0)::int AS sold_90d
  FROM skus s
  LEFT JOIN stock   st ON st.sku_id = s.id
  LEFT JOIN scored  b  ON b.sku_id  = s.id
  WHERE s.is_active = TRUE
    AND (COALESCE(st.stock_pieces, 0) > 0 OR COALESCE(b.daily_fwd, 0) > 0);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_sku_reorder_alerts() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_sku_reorder_alerts() TO authenticated, service_role;

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
  supplier_name     TEXT,
  lead_days         NUMERIC,
  order_by_date     DATE,
  trend             TEXT,
  sold_90d          INTEGER
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
    CASE
      WHEN b.dir IS NOT NULL THEN GREATEST(
        CURRENT_DATE,
        CURRENT_DATE + (b.dir - COALESCE(sl.lead_days, COALESCE(p_lead_weeks, 6) * 7))::int
      )
    END                                                                  AS order_by_date,
    b.trend,
    b.sold_90d
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

REVOKE EXECUTE ON FUNCTION public.get_reorder_suggestions(numeric, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_reorder_suggestions(numeric, numeric) TO authenticated, service_role;

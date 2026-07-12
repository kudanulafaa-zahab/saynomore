-- 0072: Market intelligence — Promo Advisor + Morning Briefing.
--
-- get_promo_suggestions(): slow-moving stock (>180 days of cover at current
-- velocity, or no sales at all in 90 days) crossed with margin headroom:
-- suggests a promo price that still clears a 10% floor margin at the latest
-- landed cost. Only suggests when that promo is genuinely below the current
-- price. All money math in Postgres.
CREATE OR REPLACE FUNCTION public.get_promo_suggestions()
RETURNS TABLE (
  sku_id              uuid,
  internal_code       text,
  full_path           text,
  stock_pieces        integer,
  stock_value_mvr     numeric,
  days_of_stock       integer,   -- NULL = no sales in the last 90 days
  current_pack_mvr    numeric,
  promo_pack_mvr      numeric,   -- price at the 10% floor margin
  discount_pct        numeric,
  pcs_per_pack        integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH stock AS (
    SELECT bs.sku_id,
           SUM(bs.qty_pieces_remaining)::integer AS pieces,
           ROUND(SUM(bs.qty_pieces_remaining * COALESCE(bs.landed_per_piece_mvr, 0)), 2) AS value_mvr
    FROM v_batch_stock bs
    WHERE bs.qty_pieces_remaining > 0
    GROUP BY bs.sku_id
  ),
  latest_landed AS (
    SELECT DISTINCT ON (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
    FROM v_batch_stock bs
    WHERE bs.qty_pieces_remaining > 0
    ORDER BY bs.sku_id, bs.received_at DESC
  ),
  velocity AS (
    SELECT sol.sku_id, SUM(sol.qty_pieces)::numeric / 90.0 AS per_day
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.created_at >= CURRENT_DATE - 90
    GROUP BY sol.sku_id
  )
  SELECT
    s.id,
    s.internal_code,
    concat_ws(' › ', b.name, m.name, v.display_name),
    st.pieces,
    st.value_mvr,
    CASE WHEN COALESCE(vel.per_day, 0) > 0
         THEN ROUND(st.pieces / vel.per_day)::integer END,
    vs.selling_price_per_pack_mvr,
    ROUND(ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90, 0),
    ROUND((1 - (ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90)
              / vs.selling_price_per_pack_mvr) * 100, 0),
    s.pcs_per_pack
  FROM skus s
  JOIN stock st            ON st.sku_id = s.id
  JOIN latest_landed ll    ON ll.sku_id = s.id
  JOIN v_skus vs           ON vs.id = s.id
  LEFT JOIN velocity vel   ON vel.sku_id = s.id
  JOIN variants v          ON v.id = s.variant_id
  JOIN product_models m    ON m.id = v.model_id
  JOIN brands b            ON b.id = m.brand_id
  WHERE s.is_active
    AND vs.selling_price_per_pack_mvr IS NOT NULL
    AND (COALESCE(vel.per_day, 0) = 0 OR st.pieces / vel.per_day > 180)
    AND ROUND(ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90, 0)
        < vs.selling_price_per_pack_mvr
  ORDER BY st.value_mvr DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_promo_suggestions() FROM anon;

-- get_morning_briefing(): yesterday's business in one JSON — sales, cash
-- collected, deliveries — plus the watch list (overdue receivables, slow
-- stock, expiring stock).
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
      SELECT SUM(value_mvr) FROM v_expiring_stock WHERE days_left <= 60), 0)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.get_morning_briefing() FROM anon;

-- 0105 — Surface due price checks in the morning briefing.
--
-- The Market screen now lists which rival prices are due (0104), but a list
-- Ali only sees if he happens to open Market is not a reminder. The briefing
-- is where the app already tells him what needs attention, so the nudge
-- belongs there.
--
-- Two counts only, and both stay silent at zero — the briefing brief rule:
-- every line is actionable or absent.
--
--   price_checks_due          — rival prices past their cycle, or never taken
--                               on an A/B item
--   price_checks_cost_changed — the urgent subset: a shipment landed at a new
--                               cost, so the margin moved and the pricing
--                               decision is live right now
--
-- get_morning_briefing returns jsonb, so adding keys is purely additive: no
-- signature change, no DROP, and any client that doesn't read them is
-- unaffected. Everything else below is byte-identical to the existing body.

CREATE OR REPLACE FUNCTION public.get_morning_briefing()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- ── NEW (0105) ──────────────────────────────────────────────────────
    'price_checks_due', (
      SELECT COUNT(*) FROM get_competitor_price_freshness() f WHERE f.due),
    'price_checks_cost_changed', (
      SELECT COUNT(*) FROM get_competitor_price_freshness() f
       WHERE f.due_reason = 'cost_changed'),
    -- ────────────────────────────────────────────────────────────────────
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
$function$;

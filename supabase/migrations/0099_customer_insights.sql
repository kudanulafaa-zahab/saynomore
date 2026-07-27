-- ============================================================================
-- 0099 — Customer insights: who your best customers really are
-- ============================================================================
-- Gap: /customers was a pure contact list (name, phone, island, tier) — no
-- history, no value. Sales → Customers only groups the orders already loaded on
-- screen. So "who are my top customers, and what have they bought?" had no
-- answer anywhere in the app.
--
-- Built on the framework retail/distribution analytics actually uses — RFM
-- (Recency, Frequency, Monetary) — with two additions that matter specifically
-- for this business:
--
--   • PROFIT, not just revenue. Margins here run ~24-43% depending on the SKU
--     (see the Price Book), so two customers spending the same MVR can be worth
--     very different money. Ranking by revenue alone is the classic vanity
--     trap; this ranks by what Ali actually keeps.
--   • NET OF RETURNS. A customer who buys a lot and sends a lot back is not a
--     top customer. Refunds are deducted and any restocked cost added back.
--
-- Also surfaced, because they're decisions rather than trivia:
--   • at_risk — the rhythm signal from 0078 (a repeat buyer who is overdue
--     against their OWN usual gap), which until now was buried in the morning
--     briefing and invisible on the customer screen.
--   • outstanding_mvr — a big buyer who never pays is not a good customer.
--   • revenue_share_pct — concentration risk. If one customer is a third of the
--     business, that's a dependency worth seeing.
--
-- All money math in Postgres. Read-only; anon revoked.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_customer_insights()
RETURNS TABLE (
  customer_id      uuid,
  name             text,
  phone            text,
  island           text,
  price_tier       text,
  orders_count     integer,
  first_order_at   date,
  last_order_at    date,
  days_since_last  integer,
  revenue_mvr      numeric,   -- net of returns
  profit_mvr       numeric,   -- net of returns and COGS
  avg_order_mvr    numeric,
  usual_gap_days   integer,   -- median days between order days
  at_risk          boolean,   -- repeat buyer, overdue vs their own rhythm
  outstanding_mvr  numeric,
  revenue_share_pct numeric   -- share of all customer revenue (concentration)
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH lines AS (
    SELECT so.customer_id, so.id AS order_id, so.created_at::date AS d,
           sol.line_total_mvr AS rev,
           sol.qty_pieces * COALESCE(sol.landed_cost_per_piece_mvr, 0) AS cogs
    FROM sales_orders so
    JOIN sales_order_lines sol ON sol.order_id = so.id
    WHERE so.status NOT IN ('draft','cancelled')
      AND so.customer_id IS NOT NULL
  ),
  per_order AS (
    SELECT customer_id, order_id, d, SUM(rev) AS rev, SUM(cogs) AS cogs
    FROM lines GROUP BY customer_id, order_id, d
  ),
  -- Returns pull both revenue and (when restocked) cost back out.
  rtn AS (
    SELECT so.customer_id,
           SUM(sr.refund_amount_mvr) AS refund,
           SUM(CASE WHEN sr.restocked
                    THEN sr.qty_pieces * COALESCE(sr.landed_cost_per_piece_mvr,0)
                    ELSE 0 END) AS cost_back
    FROM sales_returns sr
    JOIN sales_orders so ON so.id = sr.order_id
    WHERE so.customer_id IS NOT NULL
    GROUP BY so.customer_id
  ),
  totals AS (
    SELECT customer_id,
           COUNT(DISTINCT order_id)::int AS orders_count,
           MIN(d) AS first_d, MAX(d) AS last_d,
           SUM(rev) AS rev, SUM(cogs) AS cogs
    FROM per_order GROUP BY customer_id
  ),
  -- Ordering rhythm: median gap between the days they actually ordered.
  gaps AS (
    SELECT customer_id,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap))::int AS gap_days,
           COUNT(*) AS gap_count
    FROM (
      SELECT customer_id, d - LAG(d) OVER (PARTITION BY customer_id ORDER BY d) AS gap
      FROM (SELECT DISTINCT customer_id, d FROM per_order) dd
    ) g
    WHERE gap IS NOT NULL
    GROUP BY customer_id
  ),
  owed AS (
    SELECT customer_id, SUM(outstanding_mvr) AS outstanding
    FROM get_receivables_aging()
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  net AS (
    SELECT t.customer_id,
           t.orders_count, t.first_d, t.last_d,
           ROUND(t.rev - COALESCE(r.refund, 0), 2) AS revenue,
           ROUND((t.rev - t.cogs) - (COALESCE(r.refund,0) - COALESCE(r.cost_back,0)), 2) AS profit
    FROM totals t LEFT JOIN rtn r ON r.customer_id = t.customer_id
  ),
  grand AS (SELECT NULLIF(SUM(revenue), 0) AS total_rev FROM net)
  SELECT
    c.id, c.name, c.phone, c.island, c.price_tier,
    n.orders_count,
    n.first_d, n.last_d,
    (CURRENT_DATE - n.last_d)::int,
    n.revenue,
    n.profit,
    ROUND(n.revenue / NULLIF(n.orders_count, 0), 2),
    g.gap_days,
    -- Enough of a pattern to judge (≥2 gaps ⇒ ≥3 order days) AND overdue
    -- against their own usual rhythm by half again.
    COALESCE(g.gap_count >= 2 AND g.gap_days >= 1
             AND (CURRENT_DATE - n.last_d) > CEIL(g.gap_days * 1.5), false),
    ROUND(COALESCE(o.outstanding, 0), 2),
    ROUND(n.revenue / (SELECT total_rev FROM grand) * 100, 1)
  FROM net n
  JOIN customers c ON c.id = n.customer_id
  LEFT JOIN gaps  g ON g.customer_id = n.customer_id
  LEFT JOIN owed  o ON o.customer_id = n.customer_id
  ORDER BY n.profit DESC NULLS LAST;
$$;
REVOKE EXECUTE ON FUNCTION public.get_customer_insights() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_insights() TO authenticated, service_role;

-- ── What one customer actually buys, grouped by product ─────────────────────
-- Grouped by brand · model (the standing rule): a detergent never sits between
-- two diaper SKUs. Tells Ali what to keep in stock for this customer and what
-- to offer them.
CREATE OR REPLACE FUNCTION public.get_customer_products(p_customer_id uuid)
RETURNS TABLE (
  sku_id          uuid,
  brand_name      text,
  model_name      text,
  variant_display text,
  pcs_per_pack    integer,
  pcs_per_carton  integer,
  qty_pieces      bigint,
  revenue_mvr     numeric,
  profit_mvr      numeric,
  last_bought     date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT vs.id, vs.brand_name, vs.model_name, vs.variant_display,
         vs.pcs_per_pack, vs.pcs_per_carton,
         SUM(sol.qty_pieces)::bigint,
         ROUND(SUM(sol.line_total_mvr), 2),
         ROUND(SUM(sol.line_total_mvr - sol.qty_pieces * COALESCE(sol.landed_cost_per_piece_mvr, 0)), 2),
         MAX(so.created_at::date)
  FROM sales_order_lines sol
  JOIN sales_orders so ON so.id = sol.order_id
  JOIN v_skus vs       ON vs.id = sol.sku_id
  WHERE so.customer_id = p_customer_id
    AND so.status NOT IN ('draft','cancelled')
  GROUP BY vs.id, vs.brand_name, vs.model_name, vs.variant_display,
           vs.pcs_per_pack, vs.pcs_per_carton
  ORDER BY vs.brand_name, vs.model_name, vs.variant_display;
$$;
REVOKE EXECUTE ON FUNCTION public.get_customer_products(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_products(uuid) TO authenticated, service_role;

-- ── One customer's order history ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_customer_orders(p_customer_id uuid, p_limit int DEFAULT 100)
RETURNS TABLE (
  order_id      uuid,
  order_number  text,
  created_at    timestamptz,
  status        text,
  payment_status text,
  channel       text,
  total_mvr     numeric,
  paid_mvr      numeric,
  items         integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT so.id, so.order_number, so.created_at, so.status, so.payment_status, so.channel,
         ROUND(COALESCE(SUM(sol.line_total_mvr), 0), 2),
         ROUND(COALESCE((SELECT SUM(op.amount_mvr) FROM order_payments op WHERE op.order_id = so.id), 0), 2),
         COUNT(sol.id)::int
  FROM sales_orders so
  LEFT JOIN sales_order_lines sol ON sol.order_id = so.id
  WHERE so.customer_id = p_customer_id
    AND so.status <> 'draft'
  GROUP BY so.id
  ORDER BY so.created_at DESC
  LIMIT GREATEST(1, p_limit);
$$;
REVOKE EXECUTE ON FUNCTION public.get_customer_orders(uuid, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_orders(uuid, int) TO authenticated, service_role;

-- 0088 — Campaign measurement that JUDGES, not just records.
--
-- The old get_campaign_roi compared attached-SKU REVENUE during the campaign
-- vs the single window immediately before. Three problems for a real verdict:
--   1. Revenue, not profit — a discounted boost can lift sales and lose money.
--   2. A one-window baseline is noisy and trend-blind.
--   3. No units / new customers / verdict — you got a number, not a decision.
--
-- This rebuild measures PROFIT (contribution = revenue − snapshot COGS), nets
-- the spend off the lift, smooths the baseline over the 3 equal windows before
-- the campaign, counts units and genuinely-new customers, and returns a plain
-- verdict: worked / marginal / no_effect / insufficient. Same name, richer
-- shape (the UI is updated in the same change).

DROP FUNCTION IF EXISTS public.get_campaign_roi();

CREATE FUNCTION public.get_campaign_roi()
RETURNS TABLE (
  spend_id        uuid,
  window_days     int,
  spend_mvr       numeric,
  revenue_during  numeric,
  profit_during   numeric,
  profit_before   numeric,   -- smoothed: avg contribution of an equal window over the prior 3
  profit_lift     numeric,   -- during − before
  net_after_spend numeric,   -- profit_lift − spend
  units_during    int,
  units_before    numeric,
  orders_during   int,
  new_customers   int,       -- first-ever order within the window, bought an attached SKU
  enough_data     boolean,
  verdict         text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH wl AS (
    SELECT ms.id, ms.amount_mvr, ms.start_date AS sd,
           COALESCE(ms.end_date, LEAST(CURRENT_DATE, ms.start_date + 14)) AS ed,
           (COALESCE(ms.end_date, LEAST(CURRENT_DATE, ms.start_date + 14)) - ms.start_date + 1) AS wdays
    FROM marketing_spend ms
  ),
  wb AS (
    SELECT wl.*, (sd - 3 * wdays) AS base_sd, (sd - 1) AS base_ed FROM wl
  ),
  latest_landed AS (
    SELECT DISTINCT ON (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
    FROM v_batch_stock bs
    WHERE bs.qty_pieces_remaining > 0
    ORDER BY bs.sku_id, bs.received_at DESC
  ),
  lines AS (
    SELECT wb.id AS spend_id, wb.sd, wb.ed, wb.base_sd, wb.base_ed,
           so.created_at::date AS d, so.id AS order_id, so.customer_id,
           sol.line_total_mvr AS rev,
           sol.qty_pieces AS units,
           (sol.line_total_mvr
             - sol.qty_pieces * COALESCE(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0)) AS contrib
    FROM wb
    JOIN marketing_spend_skus mss ON mss.spend_id = wb.id
    JOIN sales_order_lines sol     ON sol.sku_id = mss.sku_id
    JOIN sales_orders so           ON so.id = sol.order_id
    LEFT JOIN latest_landed ll     ON ll.sku_id = mss.sku_id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.created_at::date BETWEEN wb.base_sd AND wb.ed
  ),
  agg AS (
    SELECT spend_id,
      ROUND(SUM(rev)     FILTER (WHERE d BETWEEN sd AND ed), 2)          AS rev_during,
      ROUND(SUM(contrib) FILTER (WHERE d BETWEEN sd AND ed), 2)          AS prof_during,
      ROUND(COALESCE(SUM(contrib) FILTER (WHERE d BETWEEN base_sd AND base_ed), 0) / 3.0, 2) AS prof_before,
      COALESCE(SUM(units) FILTER (WHERE d BETWEEN sd AND ed), 0)::int    AS units_during,
      ROUND(COALESCE(SUM(units) FILTER (WHERE d BETWEEN base_sd AND base_ed), 0) / 3.0, 0) AS units_before,
      COUNT(DISTINCT order_id) FILTER (WHERE d BETWEEN sd AND ed)::int   AS orders_during
    FROM lines GROUP BY spend_id
  ),
  firsts AS (
    SELECT customer_id, MIN(created_at::date) AS first_d
    FROM sales_orders
    WHERE status NOT IN ('draft', 'cancelled') AND customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  newc AS (
    SELECT l.spend_id, COUNT(DISTINCT l.customer_id)::int AS new_customers
    FROM lines l
    JOIN firsts f ON f.customer_id = l.customer_id
    WHERE l.d BETWEEN l.sd AND l.ed
      AND f.first_d BETWEEN l.sd AND l.ed
    GROUP BY l.spend_id
  )
  SELECT
    wb.id,
    wb.wdays::int,
    wb.amount_mvr,
    COALESCE(a.rev_during, 0),
    COALESCE(a.prof_during, 0),
    COALESCE(a.prof_before, 0),
    ROUND(COALESCE(a.prof_during, 0) - COALESCE(a.prof_before, 0), 2),
    ROUND(COALESCE(a.prof_during, 0) - COALESCE(a.prof_before, 0) - wb.amount_mvr, 2),
    COALESCE(a.units_during, 0),
    COALESCE(a.units_before, 0),
    COALESCE(a.orders_during, 0),
    COALESCE(nc.new_customers, 0),
    (COALESCE(a.orders_during, 0) >= 5),
    CASE
      WHEN COALESCE(a.orders_during, 0) < 5 THEN 'insufficient'
      WHEN COALESCE(a.prof_during, 0) - COALESCE(a.prof_before, 0) - wb.amount_mvr > 0 THEN 'worked'
      WHEN COALESCE(a.prof_during, 0) - COALESCE(a.prof_before, 0) > 0 THEN 'marginal'
      ELSE 'no_effect'
    END
  FROM wb
  LEFT JOIN agg a  ON a.spend_id = wb.id
  LEFT JOIN newc nc ON nc.spend_id = wb.id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_campaign_roi() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_campaign_roi() TO authenticated;

-- ============================================================================
-- 0091 — Campaign confounder flags
-- ============================================================================
-- get_campaign_roi (0088) judges a boost by comparing profit DURING the campaign
-- to a smoothed baseline BEFORE it. That before/after logic silently assumes
-- nothing else changed. Two things routinely do, and either one makes the
-- verdict unreliable:
--
--   • A STOCKOUT during the window — an attached SKU hit zero stock, so demand
--     was throttled by supply, not the promo. The lift is understated (or the
--     "no effect" is really "nothing to sell").
--   • A PRICE CHANGE — the average unit price of attached SKUs shifted between
--     the baseline and the campaign, so the profit difference mixes the price
--     move in with the promo effect.
--
-- This adds two boolean flags so the card can CAVEAT the verdict ("verdict may
-- be unreliable — you were out of stock / the price changed") rather than
-- present a confounded number as fact. The verdict itself is unchanged; we
-- flag, we don't silently rewrite it. All in Postgres. DROP+CREATE (new
-- columns) → grants restated, anon stays out.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_campaign_roi();

CREATE FUNCTION public.get_campaign_roi()
RETURNS TABLE (
  spend_id        uuid,
  window_days     int,
  spend_mvr       numeric,
  revenue_during  numeric,
  profit_during   numeric,
  profit_before   numeric,
  profit_lift     numeric,
  net_after_spend numeric,
  units_during    int,
  units_before    numeric,
  orders_during   int,
  new_customers   int,
  enough_data     boolean,
  verdict         text,
  confounded_stockout boolean,   -- an attached SKU hit zero stock in the window
  confounded_price    boolean    -- avg unit price shifted vs the baseline (≥8%)
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
      COUNT(DISTINCT order_id) FILTER (WHERE d BETWEEN sd AND ed)::int   AS orders_during,
      -- Raw (un-averaged) sums for the price comparison — price is total÷units
      -- and is window-count independent.
      SUM(rev)   FILTER (WHERE d BETWEEN sd AND ed)             AS raw_rev_during,
      SUM(units) FILTER (WHERE d BETWEEN sd AND ed)             AS raw_units_during,
      SUM(rev)   FILTER (WHERE d BETWEEN base_sd AND base_ed)   AS raw_rev_before,
      SUM(units) FILTER (WHERE d BETWEEN base_sd AND base_ed)   AS raw_units_before
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
  ),
  -- Running on-hand for each attached SKU up to the window end; a stockout is
  -- any point inside the window where on-hand fell to zero or below.
  mv AS (
    SELECT wb.id AS spend_id, wb.sd, wb.ed, sm.created_at::date AS d,
           SUM(stock_signed_delta(sm.movement_type, sm.qty_pieces))
             OVER (PARTITION BY wb.id, sm.sku_id ORDER BY sm.created_at, sm.id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
    FROM wb
    JOIN marketing_spend_skus mss ON mss.spend_id = wb.id
    JOIN stock_movements sm        ON sm.sku_id = mss.sku_id
    WHERE sm.created_at::date <= wb.ed
  ),
  stockout AS (
    SELECT spend_id, bool_or(running <= 0 AND d BETWEEN sd AND ed) AS had_stockout
    FROM mv GROUP BY spend_id
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
    END,
    COALESCE(so.had_stockout, false),
    (a.raw_units_during > 0 AND a.raw_units_before > 0
      AND ABS( (a.raw_rev_during / a.raw_units_during)
             / NULLIF(a.raw_rev_before / a.raw_units_before, 0) - 1) >= 0.08)
  FROM wb
  LEFT JOIN agg a       ON a.spend_id = wb.id
  LEFT JOIN newc nc     ON nc.spend_id = wb.id
  LEFT JOIN stockout so ON so.spend_id = wb.id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_campaign_roi() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.get_campaign_roi() TO authenticated, service_role;

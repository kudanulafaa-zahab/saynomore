-- get_monthly_revenue: returns revenue and opex totals for the last N months
-- Used by the financials view bar chart.

CREATE OR REPLACE FUNCTION get_monthly_revenue(p_months INTEGER DEFAULT 6)
RETURNS TABLE (
  month_label   TEXT,     -- e.g. 'Jan', 'Feb'
  month_start   DATE,
  revenue_mvr   NUMERIC,
  opex_mvr      NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH months AS (
    SELECT
      generate_series(
        DATE_TRUNC('month', CURRENT_DATE) - ((p_months - 1) || ' months')::INTERVAL,
        DATE_TRUNC('month', CURRENT_DATE),
        '1 month'::INTERVAL
      )::DATE AS month_start
  ),
  revenue AS (
    SELECT
      DATE_TRUNC('month', so.created_at)::DATE AS month_start,
      SUM(sol.line_total_mvr) AS revenue_mvr
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    WHERE so.status NOT IN ('draft', 'cancelled')
    GROUP BY DATE_TRUNC('month', so.created_at)::DATE
  ),
  opex AS (
    SELECT
      DATE_TRUNC('month', start_date)::DATE AS month_start,
      SUM(amount_mvr) AS opex_mvr
    FROM marketing_spend
    GROUP BY DATE_TRUNC('month', start_date)::DATE
  )
  SELECT
    TO_CHAR(m.month_start, 'Mon') AS month_label,
    m.month_start,
    COALESCE(r.revenue_mvr, 0)    AS revenue_mvr,
    COALESCE(o.opex_mvr, 0)       AS opex_mvr
  FROM months m
  LEFT JOIN revenue r ON r.month_start = m.month_start
  LEFT JOIN opex    o ON o.month_start = m.month_start
  ORDER BY m.month_start ASC;
$$;

GRANT EXECUTE ON FUNCTION get_monthly_revenue(INTEGER) TO authenticated;

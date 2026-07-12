-- 0070: Receivables aging — who owes money and for how long.
-- Outstanding = order line totals minus the payments ledger, for every
-- non-draft, non-cancelled order that isn't fully paid. Age is measured
-- from delivery when delivered (the trade-credit clock starts at handover),
-- else from confirmation. Walk-in (customer-less) orders group together.
CREATE OR REPLACE FUNCTION public.get_receivables_aging()
RETURNS TABLE (
  customer_id     uuid,
  customer_name   text,
  phone           text,
  orders_count    integer,
  outstanding_mvr numeric,
  oldest_days     integer,   -- age of the oldest unpaid order
  bucket          text       -- 'current' (<=30) | 'watch' (31-60) | 'overdue' (>60)
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH order_totals AS (
    SELECT so.id, so.customer_id,
           COALESCE(so.delivered_at::date, so.created_at::date) AS due_start,
           COALESCE(SUM(sol.line_total_mvr), 0) AS total
    FROM sales_orders so
    JOIN sales_order_lines sol ON sol.order_id = so.id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.payment_status <> 'paid'
    GROUP BY so.id
  ),
  order_paid AS (
    SELECT op.order_id, COALESCE(SUM(op.amount_mvr), 0) AS paid
    FROM order_payments op
    GROUP BY op.order_id
  ),
  owed AS (
    SELECT ot.customer_id,
           ot.total - COALESCE(p.paid, 0) AS outstanding,
           (CURRENT_DATE - ot.due_start)  AS age_days
    FROM order_totals ot
    LEFT JOIN order_paid p ON p.order_id = ot.id
    WHERE ot.total - COALESCE(p.paid, 0) > 0.005
  )
  SELECT
    o.customer_id,
    COALESCE(c.name, 'Walk-in / no customer') AS customer_name,
    c.phone,
    COUNT(*)::integer,
    ROUND(SUM(o.outstanding), 2),
    MAX(o.age_days)::integer,
    CASE
      WHEN MAX(o.age_days) > 60 THEN 'overdue'
      WHEN MAX(o.age_days) > 30 THEN 'watch'
      ELSE 'current'
    END
  FROM owed o
  LEFT JOIN customers c ON c.id = o.customer_id
  GROUP BY o.customer_id, c.name, c.phone
  ORDER BY MAX(o.age_days) DESC, SUM(o.outstanding) DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_receivables_aging() FROM anon;

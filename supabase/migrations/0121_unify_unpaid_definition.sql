-- 0121 — One definition of "unpaid", everywhere, matching migration 0080's law.
--
-- Ali's screenshots: Dashboard "Unpaid" tile said 4 orders; Sales' "awaiting
-- payment" filter said 3. Root cause, two layers:
--
-- 1. get_receivables_aging() (the canonical "owed" source since 0080) only
--    excludes payment_status = 'paid' from the outstanding calculation.
--    'deposited' (COD cash collected AND banked — strictly MORE settled than
--    'paid') was never added to that exclusion, so a COD order marked
--    deposited is still counted as fully outstanding forever, with no way to
--    clear it. SO-2026-072 (MVR 776, Abu Bilal) is live proof: delivered,
--    payment_status='deposited', zero order_payments rows, so
--    get_receivables_aging reports the full 776 as still owed.
--
-- 2. get_sales_orders/get_sales_orders_count's p_unpaid filter (migration
--    0101) was written independently of get_receivables_aging and uses a
--    completely different, narrower rule (payment_status IN
--    ('pending','partial')) instead of "not settled". It coincidentally
--    excludes 'deposited' too, which is why Sales showed 3 (correct-looking
--    by accident) while the dashboard showed 4 (wrong, but for a different
--    reason) — two different definitions of the same word, exactly what 0080
--    already fixed once for the dashboard vs the Finance Owed panel, but this
--    third place never got the memo.
--
-- Fix: ONE settled-set, defined once, used everywhere — payment_status IN
-- ('paid', 'deposited') means settled; anything else on a non-draft/
-- cancelled order is outstanding. Bodies only change; signatures don't.

CREATE OR REPLACE FUNCTION public.get_receivables_aging()
 RETURNS TABLE(customer_id uuid, customer_name text, phone text, orders_count integer, outstanding_mvr numeric, oldest_days integer, bucket text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH order_totals AS (
    SELECT so.id, so.customer_id,
           COALESCE(so.delivered_at::date, so.created_at::date) AS due_start,
           COALESCE(SUM(sol.line_total_mvr), 0) AS total
    FROM sales_orders so
    JOIN sales_order_lines sol ON sol.order_id = so.id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.payment_status NOT IN ('paid', 'deposited')
    GROUP BY so.id
  ),
  order_paid AS (
    SELECT op.order_id, COALESCE(SUM(op.amount_mvr), 0) AS paid
    FROM order_payments op
    GROUP BY op.order_id
  ),
  order_returned AS (
    SELECT sr.order_id, COALESCE(SUM(sr.refund_amount_mvr), 0) AS returned
    FROM sales_returns sr
    GROUP BY sr.order_id
  ),
  owed AS (
    SELECT ot.customer_id,
           ot.total - COALESCE(p.paid, 0) - COALESCE(r.returned, 0) AS outstanding,
           (CURRENT_DATE - ot.due_start)  AS age_days
    FROM order_totals ot
    LEFT JOIN order_paid     p ON p.order_id = ot.id
    LEFT JOIN order_returned r ON r.order_id = ot.id
    WHERE ot.total - COALESCE(p.paid, 0) - COALESCE(r.returned, 0) > 0.005
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
$function$;

-- Defensive drop for a from-scratch replay: column list changes here.
DROP FUNCTION IF EXISTS public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int);
CREATE OR REPLACE FUNCTION public.get_sales_orders(
  p_status            text        default null,
  p_search            text        default null,
  p_unpaid            boolean     default false,
  p_customer_id       uuid        default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 30
)
RETURNS TABLE (
  id                     uuid,
  order_number           text,
  customer_id            uuid,
  status                 text,
  channel                text,
  payment_status         text,
  payment_method         text,
  payment_proof_url      text,
  source_godown_id       uuid,
  delivery_address_line1 text,
  delivery_address_line2 text,
  delivery_island        text,
  delivery_to_boat       boolean,
  assigned_driver_id     uuid,
  picked_at              timestamptz,
  delivered_at           timestamptz,
  cash_collected_mvr     numeric,
  cash_deposited_at      timestamptz,
  notes                  text,
  created_by             uuid,
  created_at             timestamptz,
  updated_at             timestamptz,
  order_total_mvr        numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    o.id, o.order_number, o.customer_id, o.status, o.channel,
    o.payment_status, o.payment_method, o.payment_proof_url,
    o.source_godown_id, o.delivery_address_line1, o.delivery_address_line2,
    o.delivery_island, o.delivery_to_boat, o.assigned_driver_id,
    o.picked_at, o.delivered_at, o.cash_collected_mvr, o.cash_deposited_at,
    o.notes, o.created_by, o.created_at, o.updated_at,
    coalesce((select sum(l.line_total_mvr)
                from sales_order_lines l
               where l.order_id = o.id), 0)::numeric as order_total_mvr
  FROM sales_orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE
    (p_status is null or p_status = 'all' or o.status = p_status)
    and (p_customer_id is null or o.customer_id = p_customer_id)
    -- Matches get_receivables_aging()'s settled-set exactly (migration 0121) —
    -- "unpaid" can never again mean something different on this screen than
    -- on the dashboard/Finance Owed panel.
    and (not p_unpaid or (
          o.status not in ('draft', 'cancelled')
          and o.payment_status not in ('paid', 'deposited')))
    and (
      p_search is null or btrim(p_search) = ''
      or o.order_number  ilike '%' || btrim(p_search) || '%'
      or c.name          ilike '%' || btrim(p_search) || '%'
      or c.phone         ilike '%' || btrim(p_search) || '%'
    )
    and (
      p_cursor_created_at is null
      or (o.created_at, o.id) < (p_cursor_created_at, p_cursor_id)
    )
  ORDER BY o.created_at desc, o.id desc
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.get_sales_orders_count(
  p_status      text    default null,
  p_search      text    default null,
  p_unpaid      boolean default false,
  p_customer_id uuid    default null
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(*)
  FROM sales_orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE
    (p_status is null or p_status = 'all' or o.status = p_status)
    and (p_customer_id is null or o.customer_id = p_customer_id)
    and (not p_unpaid or (
          o.status not in ('draft', 'cancelled')
          and o.payment_status not in ('paid', 'deposited')))
    and (
      p_search is null or btrim(p_search) = ''
      or o.order_number  ilike '%' || btrim(p_search) || '%'
      or c.name          ilike '%' || btrim(p_search) || '%'
      or c.phone         ilike '%' || btrim(p_search) || '%'
    );
$$;

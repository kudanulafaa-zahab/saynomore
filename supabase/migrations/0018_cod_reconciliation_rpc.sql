-- ── Migration 0018: COD Reconciliation RPC ───────────────────────────────
--
-- get_cod_reconciliation(p_date) returns one row per driver who had any
-- COD order delivered on that date, showing:
--   • driver_id / driver_name
--   • orders_count        — number of COD orders delivered that day
--   • expected_mvr        — sum of order totals (what should have been collected)
--   • collected_mvr       — sum of cash_collected_mvr (what driver entered)
--   • variance_mvr        — collected − expected (negative = shortfall)
--   • deposited_count     — orders already marked as deposited
--   • pending_deposit_mvr — collected but not yet deposited to bank
--   • status              — 'balanced' | 'shortfall' | 'overage' | 'pending_deposit'

CREATE OR REPLACE FUNCTION get_cod_reconciliation(
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  driver_id           UUID,
  driver_name         TEXT,
  orders_count        BIGINT,
  expected_mvr        NUMERIC,
  collected_mvr       NUMERIC,
  variance_mvr        NUMERIC,
  deposited_count     BIGINT,
  pending_deposit_mvr NUMERIC,
  recon_status        TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cod_orders AS (
    SELECT
      so.id,
      so.assigned_driver_id,
      so.delivered_at,
      so.payment_status,
      so.cash_collected_mvr,
      so.cash_deposited_at,
      -- Order total from lines
      (SELECT COALESCE(SUM(sol.line_total_mvr), 0)
       FROM sales_order_lines sol WHERE sol.order_id = so.id) AS order_total_mvr
    FROM sales_orders so
    WHERE so.payment_method = 'cod'
      AND so.status = 'delivered'
      AND so.delivered_at::DATE = p_date
      AND so.assigned_driver_id IS NOT NULL
  ),
  by_driver AS (
    SELECT
      co.assigned_driver_id                            AS driver_id,
      COUNT(*)                                         AS orders_count,
      COALESCE(SUM(co.order_total_mvr), 0)             AS expected_mvr,
      COALESCE(SUM(co.cash_collected_mvr), 0)          AS collected_mvr,
      COALESCE(SUM(co.cash_collected_mvr), 0)
        - COALESCE(SUM(co.order_total_mvr), 0)         AS variance_mvr,
      COUNT(*) FILTER (WHERE co.payment_status = 'deposited') AS deposited_count,
      COALESCE(SUM(co.cash_collected_mvr)
        FILTER (WHERE co.payment_status != 'deposited'), 0)   AS pending_deposit_mvr
    FROM cod_orders co
    GROUP BY co.assigned_driver_id
  )
  SELECT
    bd.driver_id,
    COALESCE(up.full_name, 'Unknown Driver')           AS driver_name,
    bd.orders_count,
    ROUND(bd.expected_mvr,        2)                   AS expected_mvr,
    ROUND(bd.collected_mvr,       2)                   AS collected_mvr,
    ROUND(bd.variance_mvr,        2)                   AS variance_mvr,
    bd.deposited_count,
    ROUND(bd.pending_deposit_mvr, 2)                   AS pending_deposit_mvr,
    CASE
      WHEN bd.pending_deposit_mvr > 0              THEN 'pending_deposit'
      WHEN ABS(bd.variance_mvr) < 0.01             THEN 'balanced'
      WHEN bd.variance_mvr < 0                     THEN 'shortfall'
      ELSE                                               'overage'
    END                                                AS recon_status
  FROM by_driver bd
  LEFT JOIN user_profiles up ON up.id = bd.driver_id
  ORDER BY
    CASE WHEN ABS(bd.variance_mvr) > 0.01 THEN 0 ELSE 1 END,
    bd.expected_mvr DESC;
$$;

GRANT EXECUTE ON FUNCTION get_cod_reconciliation(DATE) TO authenticated;

-- ── Per-driver order breakdown (for drill-down) ───────────────────────────
CREATE OR REPLACE FUNCTION get_cod_orders_for_driver(
  p_driver_id UUID,
  p_date      DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  order_id         UUID,
  order_number     TEXT,
  customer_name    TEXT,
  order_total_mvr  NUMERIC,
  collected_mvr    NUMERIC,
  payment_status   TEXT,
  delivered_at     TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    so.id                                                     AS order_id,
    so.order_number,
    COALESCE(c.name, 'Walk-in')                              AS customer_name,
    ROUND(
      (SELECT COALESCE(SUM(sol.line_total_mvr), 0)
       FROM sales_order_lines sol WHERE sol.order_id = so.id), 2
    )                                                         AS order_total_mvr,
    COALESCE(so.cash_collected_mvr, 0)                       AS collected_mvr,
    so.payment_status,
    so.delivered_at
  FROM sales_orders so
  LEFT JOIN customers c ON c.id = so.customer_id
  WHERE so.payment_method = 'cod'
    AND so.status = 'delivered'
    AND so.delivered_at::DATE = p_date
    AND so.assigned_driver_id = p_driver_id
  ORDER BY so.delivered_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_cod_orders_for_driver(UUID, DATE) TO authenticated;

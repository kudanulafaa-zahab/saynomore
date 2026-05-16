-- ── Migration 0017: Reorder alerts RPC ───────────────────────────────────
--
-- get_sku_reorder_alerts() returns one row per active SKU that has ever
-- had stock, with:
--   • stock_pieces       — current on-hand pieces (from stock_movements)
--   • daily_avg_pieces   — 30-day rolling average daily sales (pieces)
--   • dir                — Days Inventory Remaining = stock ÷ daily_avg
--   • reorder_point_pcs  — safety stock formula: avg × lead_time_days
--   • alert_level        — 'critical' (<7d), 'low' (<14d), 'ok' (≥14d or no sales history)
--
-- Lead time default: 21 days (3 weeks). Can be overridden per SKU later.
-- SKUs with zero sales in 30 days are returned with alert_level = 'ok'
-- and dir = NULL — they have stock but no velocity data.

CREATE OR REPLACE FUNCTION get_sku_reorder_alerts()
RETURNS TABLE (
  sku_id             UUID,
  stock_pieces       NUMERIC,
  daily_avg_pieces   NUMERIC,
  dir                NUMERIC,   -- days inventory remaining (NULL if no sales)
  reorder_point_pcs  NUMERIC,   -- avg_daily × lead_time_days
  alert_level        TEXT       -- 'critical' | 'low' | 'ok'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- Current on-hand stock per SKU (sum of all movements)
  stock AS (
    SELECT
      sm.sku_id,
      COALESCE(SUM(
        CASE
          WHEN sm.movement_type IN ('in', 'transfer_in', 'return_in', 'adjustment')
            AND sm.qty_pieces > 0 THEN sm.qty_pieces
          WHEN sm.movement_type IN ('out', 'transfer_out', 'damage_out', 'adjustment')
            AND sm.qty_pieces < 0 THEN sm.qty_pieces
          WHEN sm.movement_type IN ('out', 'transfer_out', 'damage_out') THEN -sm.qty_pieces
          ELSE 0
        END
      ), 0) AS stock_pieces
    FROM stock_movements sm
    GROUP BY sm.sku_id
  ),

  -- 30-day rolling sales velocity (pieces sold per day)
  velocity AS (
    SELECT
      sm.sku_id,
      SUM(sm.qty_pieces)::NUMERIC / 30.0 AS daily_avg
    FROM stock_movements sm
    JOIN sales_orders so ON so.id = sm.source_id
    WHERE sm.movement_type = 'out'
      AND sm.source_type   = 'sales_order'
      AND sm.created_at   >= NOW() - INTERVAL '30 days'
      AND so.status NOT IN ('draft', 'cancelled')
    GROUP BY sm.sku_id
  )

  SELECT
    s.id                                                          AS sku_id,
    GREATEST(COALESCE(st.stock_pieces, 0), 0)                   AS stock_pieces,
    COALESCE(v.daily_avg, 0)                                     AS daily_avg_pieces,
    CASE
      WHEN COALESCE(v.daily_avg, 0) > 0
      THEN ROUND(GREATEST(COALESCE(st.stock_pieces, 0), 0) / v.daily_avg, 1)
      ELSE NULL
    END                                                           AS dir,
    -- Reorder point = avg_daily × 21-day default lead time
    ROUND(COALESCE(v.daily_avg, 0) * 21, 0)                     AS reorder_point_pcs,
    CASE
      WHEN COALESCE(v.daily_avg, 0) <= 0 THEN 'ok'
      WHEN GREATEST(COALESCE(st.stock_pieces, 0), 0) / v.daily_avg < 7  THEN 'critical'
      WHEN GREATEST(COALESCE(st.stock_pieces, 0), 0) / v.daily_avg < 14 THEN 'low'
      ELSE 'ok'
    END                                                           AS alert_level
  FROM skus s
  LEFT JOIN stock     st ON st.sku_id = s.id
  LEFT JOIN velocity  v  ON v.sku_id  = s.id
  WHERE s.is_active = TRUE
    AND COALESCE(st.stock_pieces, 0) > 0;  -- only SKUs with stock
$$;

GRANT EXECUTE ON FUNCTION get_sku_reorder_alerts() TO authenticated;

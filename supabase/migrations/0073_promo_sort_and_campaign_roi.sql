-- 0073: Smarter Promo Advisor sorting + campaign ROI measurement.
--
-- 1. get_promo_suggestions() ordering upgraded from raw value DESC to true
--    urgency: batches expiring within 180 days first (that money literally
--    dies on a date), then dead stock (no sales in 90d) over merely-slow,
--    then by cash sitting. Also returns expiry days for the UI.
-- 2. get_campaign_roi(): for each campaign, revenue of its attached SKUs
--    during the campaign window vs an equal-length window immediately
--    before — the lift, in rufiyaa and as a multiple of spend. This is what
--    makes logged campaigns *measured* instead of just recorded.
CREATE OR REPLACE FUNCTION public.get_promo_suggestions()
RETURNS TABLE (
  sku_id              uuid,
  internal_code       text,
  full_path           text,
  stock_pieces        integer,
  stock_value_mvr     numeric,
  days_of_stock       integer,
  expiry_days_left    integer,   -- soonest expiring batch, NULL if none known
  current_pack_mvr    numeric,
  promo_pack_mvr      numeric,
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
  ),
  expiring AS (
    SELECT es.sku_id, MIN(es.days_left)::integer AS days_left
    FROM v_expiring_stock es
    GROUP BY es.sku_id
  )
  SELECT
    s.id,
    s.internal_code,
    concat_ws(' › ', b.name, m.name, v.display_name),
    st.pieces,
    st.value_mvr,
    CASE WHEN COALESCE(vel.per_day, 0) > 0
         THEN ROUND(st.pieces / vel.per_day)::integer END,
    ex.days_left,
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
  LEFT JOIN expiring ex    ON ex.sku_id = s.id
  JOIN variants v          ON v.id = s.variant_id
  JOIN product_models m    ON m.id = v.model_id
  JOIN brands b            ON b.id = m.brand_id
  WHERE s.is_active
    AND vs.selling_price_per_pack_mvr IS NOT NULL
    AND (COALESCE(vel.per_day, 0) = 0
         OR st.pieces / vel.per_day > 180
         OR ex.days_left IS NOT NULL AND ex.days_left <= 180)
    AND ROUND(ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90, 0)
        < vs.selling_price_per_pack_mvr
  ORDER BY
    CASE WHEN ex.days_left IS NOT NULL AND ex.days_left <= 180 THEN 0 ELSE 1 END,
    CASE WHEN COALESCE(vel.per_day, 0) = 0 THEN 0 ELSE 1 END,
    st.value_mvr DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_promo_suggestions() FROM anon;

CREATE OR REPLACE FUNCTION public.get_campaign_roi()
RETURNS TABLE (
  spend_id       uuid,
  revenue_during numeric,   -- attached SKUs' revenue in the campaign window
  revenue_before numeric,   -- same SKUs, equal-length window immediately before
  lift_mvr       numeric,   -- during - before
  roi_multiple   numeric    -- lift / spend, NULL when spend is zero
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH windows AS (
    SELECT ms.id, ms.amount_mvr,
           ms.start_date,
           COALESCE(ms.end_date, LEAST(CURRENT_DATE, ms.start_date + 14)) AS end_d
    FROM marketing_spend ms
  ),
  rev AS (
    SELECT w.id,
      SUM(sol.line_total_mvr) FILTER (
        WHERE so.created_at::date BETWEEN w.start_date AND w.end_d
      ) AS during_rev,
      SUM(sol.line_total_mvr) FILTER (
        WHERE so.created_at::date BETWEEN
          w.start_date - (w.end_d - w.start_date + 1) AND w.start_date - 1
      ) AS before_rev
    FROM windows w
    JOIN marketing_spend_skus mss ON mss.spend_id = w.id
    JOIN sales_order_lines sol    ON sol.sku_id = mss.sku_id
    JOIN sales_orders so          ON so.id = sol.order_id
    WHERE so.status NOT IN ('draft', 'cancelled')
    GROUP BY w.id
  )
  SELECT
    w.id,
    ROUND(COALESCE(r.during_rev, 0), 2),
    ROUND(COALESCE(r.before_rev, 0), 2),
    ROUND(COALESCE(r.during_rev, 0) - COALESCE(r.before_rev, 0), 2),
    CASE WHEN w.amount_mvr > 0
         THEN ROUND((COALESCE(r.during_rev, 0) - COALESCE(r.before_rev, 0)) / w.amount_mvr, 1)
    END
  FROM windows w
  LEFT JOIN rev r ON r.id = w.id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_campaign_roi() FROM anon;

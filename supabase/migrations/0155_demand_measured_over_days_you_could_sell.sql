-- 0155 — demand is measured over the days you could actually sell.
--
-- Ali's audit finding: four products sit at zero stock while selling, worth
-- MVR 7,761 a month of demand he cannot fill, while MVR 24,310 of Royal Soft
-- sits dead. The next container should be Xtra Kering-heavy. This is the
-- reason it would not have been.
--
-- THE BUG — censored demand
--
-- get_sku_reorder_alerts measured the selling rate as
--
--     units sold in the last 30 days / 30.0
--
-- Thirty CALENDAR days, whether or not there was anything on the shelf. A
-- product that was out of stock for half the month therefore looks like it
-- sells half as fast as it does. The reorder engine then orders that much,
-- it runs out sooner, the measured rate drops again, and the next order is
-- smaller still. Running out is self-reinforcing, and the products it
-- punishes hardest are the ones that sell fastest.
--
-- Measured on production, last 30 days:
--
--   product              in stock   true rate   measured   understated
--   Xtra Kering L         15/30     1.00 pk/d    0.50        2.0x
--   Xtra Kering NB/S      17/30     0.35 pk/d    0.20        1.8x
--   Xtra Kering XL        20/30     0.80 pk/d    0.53        1.5x
--   Sosoft Green          26/30     0.46 pk/d    0.40        1.2x
--
-- Every one of them is a seller. Royal Soft, which has been in stock the
-- whole time and genuinely does not move, is measured correctly at ~0 — so
-- this correction does NOT prop up dead stock. It only stops punishing the
-- lines that keep selling out. That is exactly the reweighting the next
-- container needs.
--
-- THE FIX
--
-- Divide by the days the product was actually available, not by the calendar.
-- This is the standard lost-sales correction: a rate is units per day of
-- opportunity, and a day with an empty shelf is not an opportunity.
--
-- "Available" = stock on hand at the end of that day was positive, OR
-- something sold that day (if it sold, it was there). Reconstructed from the
-- movement ledger, which is the only record of what was on the shelf when.
--
-- Two guards, both deliberate:
--
--   * A minimum of 7 available days in the 30-day window before the corrected
--     rate is trusted. Two days of availability and one big order would
--     otherwise imply an enormous daily rate. Below the floor, the old
--     calendar rate stands — conservative, not clever.
--   * The 90-day baseline gets the SAME treatment, on a 14-day floor. It is
--     only used to detect a rising trend by comparing against v30, and
--     correcting one side but not the other would manufacture a fake trend
--     on every product that had a stockout, inflating its buffer twice.
--
-- Two new output columns so the screen can EXPLAIN a number that just went
-- up. A suggested order quietly doubling with no reason given is alarming;
-- "out of stock 15 of the last 30 days, so the real rate is double what raw
-- sales show" is a fact Ali can check against his own memory.
--
--   days_unavailable_30  whole days, 0-30
--   demand_censored      true when the gap is material (3+ days). The rate
--                        correction applies more often than the flag fires --
--                        a product that sold its last piece yesterday is
--                        technically "out 1 of 30 days", and saying so would
--                        be noise dressed as insight.
--
-- Nothing else moves: stock, the alert thresholds, the trend rule, the
-- forward buffer and the reorder point all keep their existing definitions
-- and simply read a truer rate.

BEGIN;

-- Return column list changes. get_reorder_suggestions calls this function by
-- name from a string body, so there is no tracked dependency to break, and it
-- picks up the new definition inside this same transaction.
DROP FUNCTION IF EXISTS public.get_sku_reorder_alerts();

CREATE OR REPLACE FUNCTION public.get_sku_reorder_alerts()
RETURNS TABLE (
  sku_id              uuid,
  stock_pieces        numeric,
  daily_avg_pieces    numeric,
  dir                 numeric,
  reorder_point_pcs   numeric,
  alert_level         text,
  daily_avg_recent    numeric,
  daily_avg_base      numeric,
  trend               text,
  sold_90d            integer,
  -- Days in the last 30 with nothing on the shelf. The reason a rate was
  -- corrected, and the sentence the reorder screen shows.
  days_unavailable_30 integer,
  -- True when the 30-day rate was actually measured over available days
  -- rather than the calendar (i.e. it had a stockout AND cleared the floor).
  demand_censored     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with
  today as (select (now() at time zone 'Indian/Maldives')::date as d),
  win as (select (select d from today) - 89 as from_90, (select d from today) - 29 as from_30),

  -- Every movement, collapsed to one row per SKU per Maldives day.
  daily as (
    select sm.sku_id,
           (sm.created_at at time zone 'Indian/Maldives')::date as d,
           sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)) as delta,
           sum(case when sm.movement_type = 'out' and sm.source_type = 'sales_order'
                    then sm.qty_pieces else 0 end) as sold
      from stock_movements sm
     group by 1, 2
  ),
  -- Stock carried into the 90-day window, so the running total below starts
  -- from the truth rather than from zero.
  opening as (
    select d.sku_id, sum(d.delta) as qty
      from daily d
     where d.d < (select from_90 from win)
     group by 1
  ),
  grid as (
    select s.id as sku_id, g.d
      from skus s
      cross join generate_series((select from_90 from win), (select d from today), interval '1 day') g(d)
     where s.is_active
  ),
  -- Stock at the end of each day, and whether anything sold that day.
  runs as (
    select g.sku_id, g.d::date as d,
           coalesce(o.qty, 0)
             + sum(coalesce(dd.delta, 0)) over (partition by g.sku_id order by g.d) as stock_eod,
           coalesce(dd.sold, 0) as sold
      from grid g
      left join daily   dd on dd.sku_id = g.sku_id and dd.d = g.d::date
      left join opening o  on o.sku_id  = g.sku_id
  ),
  -- A day counts as an opportunity if there was stock at the end of it, or
  -- if something sold that day (in which case there plainly was stock).
  avail as (
    select r.sku_id,
           count(*) filter (where r.d >= (select from_30 from win)
                              and (r.stock_eod > 0 or r.sold > 0))::int as days_30,
           count(*) filter (where r.stock_eod > 0 or r.sold > 0)::int    as days_90,
           sum(r.sold) filter (where r.d >= (select from_30 from win))   as units_30,
           sum(r.sold)                                                   as units_90,
           min(r.d) filter (where r.sold > 0)                            as first_sold
      from runs r
     group by 1
  ),
  rates as (
    select a.sku_id,
           a.units_30, a.units_90, a.days_30, a.days_90,
           (30 - a.days_30) as unavailable_30,
           -- 30-day rate over days of opportunity, with a 7-day floor of
           -- evidence before the correction is trusted.
           case when a.days_30 >= 7
                then coalesce(a.units_30, 0)::numeric / a.days_30
                else coalesce(a.units_30, 0)::numeric / 30.0
           end as v30,
           -- Same treatment for the baseline, so the trend comparison below
           -- is like for like. Falls back to the original definition: units
           -- over the days since this SKU first sold, capped at 90.
           case when a.days_90 >= 14
                then coalesce(a.units_90, 0)::numeric / a.days_90
                when a.first_sold is not null
                then coalesce(a.units_90, 0)::numeric
                     / least(90.0, greatest(1.0, ((select d from today) - a.first_sold) + 1))
                else 0
           end as v_base,
           -- Flagged only when the gap is MATERIAL. The rate correction
           -- above applies whenever there is enough signal, but a product
           -- that happened to sell its last piece yesterday is "out 1 of 30
           -- days", and telling Ali his demand is understated because of that
           -- is noise dressed as insight. Three days is the floor for saying
           -- anything.
           (a.days_30 <= 27 and a.days_30 >= 7) as censored
      from avail a
  ),
  scored as (
    select r.*,
           round(r.v30 * (1 + least(0.4, greatest(0.0,
             case when r.v_base > 0 then r.v30 / r.v_base - 1 else 0 end) * 0.5)), 4) as daily_fwd
      from rates r
  ),
  stock as (
    select sm.sku_id,
           coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0) as stock_pieces
      from stock_movements sm
     group by 1
  )
  select
    s.id,
    greatest(coalesce(st.stock_pieces, 0), 0),
    coalesce(b.daily_fwd, 0),
    case when coalesce(b.daily_fwd, 0) > 0
         then round(greatest(coalesce(st.stock_pieces, 0), 0) / b.daily_fwd, 1) end,
    round(coalesce(b.daily_fwd, 0) * 21, 0),
    case
      when coalesce(b.daily_fwd, 0) <= 0 then 'ok'
      when greatest(coalesce(st.stock_pieces, 0), 0) <= 0 then 'out'
      when greatest(coalesce(st.stock_pieces, 0), 0) / b.daily_fwd < 7  then 'critical'
      when greatest(coalesce(st.stock_pieces, 0), 0) / b.daily_fwd < 14 then 'low'
      else 'ok'
    end,
    round(coalesce(b.v30, 0), 4),
    round(coalesce(b.v_base, 0), 4),
    case
      when coalesce(b.units_90, 0) < 6 or coalesce(b.v_base, 0) <= 0 then 'steady'
      when b.v30 >= b.v_base * 1.3 then 'rising'
      when b.v30 <= b.v_base * 0.7 then 'falling'
      else 'steady'
    end,
    coalesce(b.units_90, 0)::int,
    coalesce(b.unavailable_30, 0)::int,
    coalesce(b.censored, false)
  from skus s
  left join stock  st on st.sku_id = s.id
  left join scored b  on b.sku_id  = s.id
  where s.is_active
    and (coalesce(st.stock_pieces, 0) > 0 or coalesce(b.daily_fwd, 0) > 0);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_sku_reorder_alerts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sku_reorder_alerts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sku_reorder_alerts() TO authenticated;

-- get_reorder_suggestions passes the two new columns through so the screen
-- can explain why a suggestion grew. Everything else is unchanged.
DROP FUNCTION IF EXISTS public.get_reorder_suggestions(numeric, numeric);

CREATE OR REPLACE FUNCTION public.get_reorder_suggestions(
  p_lead_weeks numeric DEFAULT 6,
  p_safety_weeks numeric DEFAULT 4
)
RETURNS TABLE (
  sku_id              uuid,
  brand_name          text,
  model_name          text,
  variant_display     text,
  internal_code       text,
  stock_pieces        numeric,
  stock_cartons       numeric,
  daily_avg_pieces    numeric,
  dir                 numeric,
  cover_days          numeric,
  suggested_pieces    numeric,
  suggested_cartons   integer,
  pcs_per_carton      integer,
  revenue_per_day     numeric,
  status              text,
  supplier_name       text,
  lead_days           numeric,
  order_by_date       date,
  trend               text,
  sold_90d            integer,
  days_unavailable_30 integer,
  demand_censored     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH
  cover AS (
    SELECT (COALESCE(p_lead_weeks, 6) + COALESCE(p_safety_weeks, 4)) * 7.0 AS cover_days
  ),
  lead_hist AS (
    SELECT sl.sku_id, s.created_at, s.grn_confirmed_at, sup.name AS supplier_name,
           ROW_NUMBER() OVER (PARTITION BY sl.sku_id ORDER BY s.grn_confirmed_at DESC) AS rn
    FROM (SELECT DISTINCT shipment_id, sku_id FROM shipment_lines) sl
    JOIN shipments s ON s.id = sl.shipment_id AND s.grn_confirmed_at IS NOT NULL
    LEFT JOIN suppliers sup ON sup.id = s.supplier_id
  ),
  sku_lead AS (
    SELECT lh.sku_id,
           ROUND((AVG(EXTRACT(epoch FROM (lh.grn_confirmed_at - lh.created_at)) / 86400.0)
                  FILTER (WHERE lh.rn <= 3))::numeric, 0) AS lead_days,
           MAX(lh.supplier_name) FILTER (WHERE lh.rn = 1)  AS supplier_name
    FROM lead_hist lh
    GROUP BY lh.sku_id
  ),
  base AS (
    SELECT a.*, c.cover_days
    FROM get_sku_reorder_alerts() a
    CROSS JOIN cover c
  )
  SELECT
    b.sku_id,
    vs.brand_name,
    vs.model_name,
    vs.variant_display,
    vs.internal_code,
    b.stock_pieces,
    ROUND(b.stock_pieces / NULLIF(vs.pcs_per_carton, 0), 1),
    b.daily_avg_pieces,
    b.dir,
    b.cover_days,
    GREATEST(0, ROUND(b.daily_avg_pieces * b.cover_days - b.stock_pieces, 0)),
    CEIL(
      GREATEST(0, b.daily_avg_pieces * b.cover_days - b.stock_pieces)
      / NULLIF(vs.pcs_per_carton, 0)
    )::INTEGER,
    vs.pcs_per_carton,
    ROUND(b.daily_avg_pieces * COALESCE(vs.selling_price_per_piece_mvr, 0), 2),
    CASE
      WHEN b.dir IS NOT NULL AND b.dir > 90 THEN 'overstock'
      ELSE b.alert_level
    END,
    sl.supplier_name,
    sl.lead_days,
    CASE
      WHEN b.dir IS NOT NULL THEN GREATEST(
        (now() AT TIME ZONE 'Indian/Maldives')::date,
        (now() AT TIME ZONE 'Indian/Maldives')::date
          + (b.dir - COALESCE(sl.lead_days, COALESCE(p_lead_weeks, 6) * 7))::int
      )
    END,
    b.trend,
    b.sold_90d,
    b.days_unavailable_30,
    b.demand_censored
  FROM base b
  JOIN v_skus vs ON vs.id = b.sku_id
  LEFT JOIN sku_lead sl ON sl.sku_id = b.sku_id
  ORDER BY
    CASE
      WHEN b.dir IS NOT NULL AND b.dir > 90 THEN 2
      WHEN b.alert_level = 'critical' THEN 0
      WHEN b.alert_level = 'low'      THEN 1
      ELSE 3
    END,
    (b.daily_avg_pieces * COALESCE(vs.selling_price_per_piece_mvr, 0)) DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_reorder_suggestions(numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_reorder_suggestions(numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_reorder_suggestions(numeric, numeric) TO authenticated;

COMMIT;

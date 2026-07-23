-- ============================================================================
-- 0089 — Cash-flow forecast: the import-runway blind spot
-- ============================================================================
-- Ali's real question the app couldn't answer: "will I have the cash to pay for
-- the next shipment?" Everything needed lives in the ledger EXCEPT one number
-- only Ali knows — cash on hand — because the system tracks sales, receivables
-- and shipment costs, but never a bank/cash balance.
--
-- This migration adds:
--   1. cash_snapshots      — append-only record of "cash on hand on a date"
--                            (immutable + audit-logged, like every money row).
--   2. set_cash_balance()  — records a new snapshot (money mutation → audit_log).
--   3. get_cash_forecast_meta()  — opening balance + the run-rate ASSUMPTIONS,
--                            each returned as a number so the UI can show them
--                            (a money forecast must be honest about its inputs).
--   4. get_cash_forecast() — a 13-week running-balance timeline: sales run-rate
--                            + outstanding receivables IN; operating run-rate +
--                            open-shipment payables OUT; opening balance carried
--                            forward so the first tight week is visible.
--
-- All math is in Postgres. Every SECURITY DEFINER fn: search_path pinned,
-- auth.uid() wrapped, EXECUTE revoked from anon in this same migration.
-- ============================================================================

-- 1. Where "cash on hand" lives. Append-only: each row states the balance on a
--    date. The forecast anchors on the most recent one; correcting it is a new
--    row, never an edit — same immutability every money figure in this app has.
CREATE TABLE IF NOT EXISTS public.cash_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_mvr numeric(14,2) NOT NULL CHECK (balance_mvr >= 0),
  as_of_date  date NOT NULL DEFAULT CURRENT_DATE,
  note        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_snapshots ENABLE ROW LEVEL SECURITY;

-- Mirror business_expenses exactly: any signed-in user reads, only an
-- admin/manager writes.
DROP POLICY IF EXISTS cs_read  ON public.cash_snapshots;
DROP POLICY IF EXISTS cs_write ON public.cash_snapshots;
CREATE POLICY cs_read  ON public.cash_snapshots FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY cs_write ON public.cash_snapshots FOR ALL    USING (is_admin_or_manager());

CREATE INDEX IF NOT EXISTS cash_snapshots_as_of_idx
  ON public.cash_snapshots (as_of_date DESC, created_at DESC);

-- 2. Record a new cash-on-hand figure. Money mutation, so it is audit-logged
--    old → new like every other.
CREATE OR REPLACE FUNCTION public.set_cash_balance(
  p_amount numeric,
  p_as_of  date DEFAULT CURRENT_DATE,
  p_note   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id   uuid;
  v_prev numeric;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Not authorised to set the cash balance';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Cash on hand must be zero or more';
  END IF;

  SELECT balance_mvr INTO v_prev
  FROM cash_snapshots ORDER BY as_of_date DESC, created_at DESC LIMIT 1;

  INSERT INTO cash_snapshots (balance_mvr, as_of_date, note, created_by)
  VALUES (ROUND(p_amount, 2), COALESCE(p_as_of, CURRENT_DATE),
          NULLIF(btrim(p_note), ''), (SELECT auth.uid()))
  RETURNING id INTO v_id;

  INSERT INTO audit_log (table_name, record_id, action, field_name,
                         old_value, new_value, reason, changed_by)
  VALUES ('cash_snapshots', v_id, 'insert', 'balance_mvr',
          v_prev::text, ROUND(p_amount, 2)::text,
          'Cash on hand set for ' || COALESCE(p_as_of, CURRENT_DATE)::text,
          (SELECT auth.uid()));

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_cash_balance(numeric, date, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.set_cash_balance(numeric, date, text) TO authenticated, service_role;

-- 3. Forecast inputs, all derived in Postgres and returned as numbers so the UI
--    can state the assumptions plainly ("sales ~MVR X/wk, outstanding MVR Y in").
CREATE OR REPLACE FUNCTION public.get_cash_forecast_meta()
RETURNS TABLE (
  opening_balance_mvr      numeric,
  has_opening              boolean,
  snapshot_as_of           date,
  snapshot_age_days        integer,
  weekly_sales_in_mvr      numeric,   -- trailing-90d average weekly collections
  weekly_operating_out_mvr numeric,   -- trailing-90d avg weekly (expenses + marketing)
  receivables_total_mvr    numeric,   -- owed now, assumed collected over first 4 weeks
  undated_shipment_cost_mvr  numeric, -- open shipments with no arrival date yet
  undated_shipment_count   integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH snap AS (
    SELECT balance_mvr, as_of_date
    FROM cash_snapshots ORDER BY as_of_date DESC, created_at DESC LIMIT 1
  ),
  collections AS (
    SELECT COALESCE(SUM(amount_mvr), 0) AS total
    FROM order_payments
    WHERE COALESCE(is_reversal, false) = false
      AND paid_at >= now() - INTERVAL '90 days'
  ),
  opex AS (
    SELECT
      (SELECT COALESCE(SUM(amount_mvr), 0) FROM business_expenses
        WHERE expense_date >= CURRENT_DATE - 90)
      + (SELECT COALESCE(SUM(amount_mvr), 0) FROM marketing_spend
        WHERE start_date >= CURRENT_DATE - 90) AS total
  ),
  receivables AS (
    SELECT COALESCE(SUM(outstanding_mvr), 0) AS total FROM get_receivables_aging()
  ),
  -- Unconfirmed shipments we can't place on the timeline (no arrival date):
  -- surfaced as a lump so a big undated bill can't hide.
  open_ship AS (
    SELECT COALESCE(SUM(sc.cost), 0) AS cost, COUNT(*)::int AS cnt
    FROM (
      SELECT s.id,
             CASE WHEN COALESCE(SUM(sl.landed_total_mvr), 0) > 0
                    THEN SUM(sl.landed_total_mvr)
                  ELSE COALESCE(SUM(sl.fob_total_mvr), 0)
                     + COALESCE(s.customs_duty_mvr,0)+COALESCE(s.mpl_charges_mvr,0)
                     + COALESCE(s.agent_fee_mvr,0)+COALESCE(s.last_mile_mvr,0)
                     + COALESCE(s.insurance_mvr,0)+COALESCE(s.other_mvr,0)
                     + COALESCE(s.my_freight_share_usd,0)*COALESCE(s.rate_usd_to_mvr,0)
             END AS cost
      FROM shipments s
      LEFT JOIN shipment_lines sl ON sl.shipment_id = s.id
      WHERE s.grn_confirmed_at IS NULL
        AND s.expected_arrival_date IS NULL
      GROUP BY s.id
    ) sc
  )
  SELECT
    COALESCE((SELECT balance_mvr FROM snap), 0),
    (SELECT count(*) FROM snap) > 0,
    (SELECT as_of_date FROM snap),
    CASE WHEN (SELECT as_of_date FROM snap) IS NOT NULL
         THEN (CURRENT_DATE - (SELECT as_of_date FROM snap))::int END,
    ROUND((SELECT total FROM collections) / (90.0 / 7.0), 2),
    ROUND((SELECT total FROM opex) / (90.0 / 7.0), 2),
    ROUND((SELECT total FROM receivables), 2),
    ROUND((SELECT cost FROM open_ship), 2),
    (SELECT cnt FROM open_ship);
$$;
REVOKE EXECUTE ON FUNCTION public.get_cash_forecast_meta() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_cash_forecast_meta() TO authenticated, service_role;

-- 4. The weekly running-balance timeline.
CREATE OR REPLACE FUNCTION public.get_cash_forecast(p_weeks int DEFAULT 13)
RETURNS TABLE (
  week_index            int,
  week_start            date,
  cash_in_mvr           numeric,
  cash_out_mvr          numeric,    -- operating out (excludes shipment)
  shipment_out_mvr      numeric,
  net_mvr               numeric,
  projected_balance_mvr numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH m AS (SELECT * FROM get_cash_forecast_meta()),
  wk_start AS (SELECT date_trunc('week', CURRENT_DATE)::date AS d),   -- this Monday
  weeks AS (
    SELECT gs AS week_index,
           ((SELECT d FROM wk_start) + (gs * 7))::date AS week_start
    FROM generate_series(0, GREATEST(p_weeks, 1) - 1) gs
  ),
  -- Dated open-shipment payables, bucketed into the week they're expected.
  ship AS (
    SELECT date_trunc('week', s.expected_arrival_date)::date AS wstart,
           SUM(CASE WHEN COALESCE(t.landed, 0) > 0 THEN t.landed
                    ELSE COALESCE(t.fob, 0)
                       + COALESCE(s.customs_duty_mvr,0)+COALESCE(s.mpl_charges_mvr,0)
                       + COALESCE(s.agent_fee_mvr,0)+COALESCE(s.last_mile_mvr,0)
                       + COALESCE(s.insurance_mvr,0)+COALESCE(s.other_mvr,0)
                       + COALESCE(s.my_freight_share_usd,0)*COALESCE(s.rate_usd_to_mvr,0)
               END) AS cost
    FROM shipments s
    JOIN LATERAL (
      SELECT COALESCE(SUM(sl.landed_total_mvr), 0) AS landed,
             COALESCE(SUM(sl.fob_total_mvr), 0)    AS fob
      FROM shipment_lines sl WHERE sl.shipment_id = s.id
    ) t ON true
    WHERE s.grn_confirmed_at IS NULL
      AND s.expected_arrival_date IS NOT NULL
      AND s.expected_arrival_date >= (SELECT d FROM wk_start)
    GROUP BY 1
  ),
  rows AS (
    SELECT
      w.week_index, w.week_start,
      -- IN: steady sales run-rate every week, plus outstanding receivables
      -- spread evenly across the first 4 weeks.
      (SELECT weekly_sales_in_mvr FROM m)
        + CASE WHEN w.week_index < 4
               THEN (SELECT receivables_total_mvr FROM m) / 4.0 ELSE 0 END AS cash_in,
      (SELECT weekly_operating_out_mvr FROM m) AS cash_out,
      COALESCE((SELECT sh.cost FROM ship sh WHERE sh.wstart = w.week_start), 0) AS shipment_out
    FROM weeks w
  ),
  netted AS (
    SELECT week_index, week_start, cash_in, cash_out, shipment_out,
           (cash_in - cash_out - shipment_out) AS net
    FROM rows
  )
  SELECT
    week_index, week_start,
    ROUND(cash_in, 2), ROUND(cash_out, 2), ROUND(shipment_out, 2), ROUND(net, 2),
    ROUND((SELECT opening_balance_mvr FROM m)
          + SUM(net) OVER (ORDER BY week_index ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2)
  FROM netted
  ORDER BY week_index;
$$;
REVOKE EXECUTE ON FUNCTION public.get_cash_forecast(int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_cash_forecast(int) TO authenticated, service_role;

-- 0246 — a lead time learned from the day a row was TYPED is not a lead time.
--
-- Found by the council pass Ali asked for on 2026-09-03, looking at his own
-- stock rather than at the code.
--
-- ── WHAT THE SCREEN IS TELLING HIM TODAY ──────────────────────────────────
--
-- Merries Good Skin XL — one of the two diaper lines he is keeping — has
-- 7 packs on hand and sells about 25 packs a quarter: 25 days of cover. The
-- Reorder screen says "order by 10 September".
--
-- It says that because it believes a container takes ZERO DAYS to arrive.
--
-- ── WHERE A ZERO-DAY LEAD TIME COMES FROM ─────────────────────────────────
--
-- The learner averaged `grn_confirmed_at - created_at` over a SKU's last three
-- shipments. `created_at` is when the shipment ROW was created in the app, not
-- when the order was placed with the supplier:
--
--     SH-2026-001   row created 2026-07-08, goods received 2026-07-08   ->  0 days
--     SH-2026-002   row created 2026-07-09, goods received 2026-08-27   -> 49 days
--
-- The first is history, typed in on the day it landed. It is not an
-- observation of anything — and it is being averaged with a real one, so a SKU
-- that appeared on both learns 25 days and a SKU only on the first learns 0.
-- Against a real 49-day lead, "order by 10 September" for a line with 25 days
-- of stock is about three weeks too late, on his top brand.
--
-- ── THE COLUMN FOR THIS ALREADY EXISTS AND HAS NEVER BEEN FILLED ──────────
--
-- `shipments.ordered_at` is null on both shipments, because no screen has ever
-- asked for it. So the learner reached for the nearest timestamp instead, and
-- the nearest timestamp is a row's birthday.
--
-- ── UNKNOWN IS BETTER THAN ZERO ───────────────────────────────────────────
--
-- Lead time is now measured from `ordered_at`, and a shipment with no order
-- date contributes NOTHING rather than a zero. `lead_days` then comes back
-- NULL, and the order-by date already falls back to the p_lead_weeks
-- assumption (6 weeks, 42 days) — an honest assumption instead of a confident
-- wrong number. The moment Ali records one real order date, the function
-- learns from it.
--
-- Deliberately NOT backfilled. SH-2026-002's true order date is not in the
-- database and inventing one would be exactly the mistake this migration
-- exists to undo.

create or replace function public.get_reorder_suggestions(
  p_lead_weeks numeric default 6,
  p_safety_weeks numeric default 4
)
returns table (
  sku_id uuid, brand_name text, model_name text, variant_display text,
  internal_code text, stock_pieces numeric, stock_cartons numeric,
  daily_avg_pieces numeric, dir numeric, cover_days numeric,
  suggested_pieces numeric, suggested_cartons integer, pcs_per_carton integer,
  revenue_per_day numeric, status text, supplier_name text, lead_days numeric,
  order_by_date date, trend text, sold_90d integer, days_unavailable_30 integer,
  demand_censored boolean,
  incoming_pieces numeric, incoming_cartons numeric, incoming_eta date
)
language sql
stable
security definer
set search_path to ''
as $function$
  WITH
  cover AS (
    SELECT (COALESCE(p_lead_weeks, 6) + COALESCE(p_safety_weeks, 4)) * 7.0 AS cover_days
  ),
  -- Bought and not yet on the shelf. Grouped per SKU across every open
  -- shipment, because two containers can carry the same product.
  incoming AS (
    SELECT sl.sku_id,
           SUM(sl.qty_cartons)                     AS cartons,
           MIN(s.expected_arrival_date)            AS eta
    FROM public.shipment_lines sl
    JOIN public.shipments s ON s.id = sl.shipment_id
    WHERE s.status IN ('ordered', 'in_transit', 'arrived')
    GROUP BY sl.sku_id
  ),
  lead_hist AS (
    SELECT sl.sku_id, s.ordered_at, s.grn_confirmed_at, sup.name AS supplier_name,
           ROW_NUMBER() OVER (PARTITION BY sl.sku_id ORDER BY s.grn_confirmed_at DESC) AS rn
    FROM (SELECT DISTINCT shipment_id, sku_id FROM public.shipment_lines) sl
    JOIN public.shipments s ON s.id = sl.shipment_id AND s.grn_confirmed_at IS NOT NULL
    LEFT JOIN public.suppliers sup ON sup.id = s.supplier_id
  ),
  sku_lead AS (
    SELECT lh.sku_id,
           -- FROM WHEN THE ORDER WAS PLACED, and only when that is recorded.
           -- `created_at` is the day the shipment ROW was typed into the app,
           -- which for anything entered after the fact is the day the goods
           -- landed: SH-2026-001 was created and received on 2026-07-08 and
           -- taught this function a lead time of ZERO DAYS (0246).
           ROUND((AVG(EXTRACT(epoch FROM (lh.grn_confirmed_at - lh.ordered_at)) / 86400.0)
                  FILTER (WHERE lh.rn <= 3
                            AND lh.ordered_at IS NOT NULL
                            AND lh.grn_confirmed_at > lh.ordered_at))::numeric, 0) AS lead_days,
           MAX(lh.supplier_name) FILTER (WHERE lh.rn = 1)  AS supplier_name
    FROM lead_hist lh
    GROUP BY lh.sku_id
  ),
  base AS (
    SELECT a.*, c.cover_days
    FROM public.get_sku_reorder_alerts() a
    CROSS JOIN cover c
  ),
  -- The inventory position, in pieces. This is the only line that changes what
  -- he is told to buy.
  pos AS (
    SELECT b.sku_id,
           COALESCE(i.cartons, 0) * COALESCE(vs.pcs_per_carton, 0) AS inc_pieces,
           COALESCE(i.cartons, 0)                                  AS inc_cartons,
           i.eta                                                   AS inc_eta,
           b.stock_pieces + COALESCE(i.cartons, 0) * COALESCE(vs.pcs_per_carton, 0) AS position_pieces
    FROM base b
    JOIN public.v_skus vs ON vs.id = b.sku_id
    LEFT JOIN incoming i  ON i.sku_id = b.sku_id
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
    -- Against the POSITION, not the shelf.
    GREATEST(0, ROUND(b.daily_avg_pieces * b.cover_days - p.position_pieces, 0)),
    CEIL(
      GREATEST(0, b.daily_avg_pieces * b.cover_days - p.position_pieces)
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
    b.demand_censored,
    p.inc_pieces,
    p.inc_cartons,
    p.inc_eta
  FROM base b
  JOIN public.v_skus vs ON vs.id = b.sku_id
  JOIN pos p                    ON p.sku_id = b.sku_id
  JOIN public.skus sk           ON sk.id = b.sku_id
  JOIN public.variants v        ON v.id  = sk.variant_id
  JOIN public.product_models pm ON pm.id = v.model_id AND pm.discontinued_at IS NULL
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

comment on function public.get_reorder_suggestions(numeric, numeric) is
  'What to buy, net of what is already afloat. Lead time is learned from '
  'shipments.ordered_at — never from created_at, which is the day the row was '
  'typed and taught this function a zero-day lead time (0246). No order date '
  'recorded means no lead time learned, and the p_lead_weeks assumption is '
  'used instead.';

revoke execute on function public.get_reorder_suggestions(numeric, numeric) from public, anon;
grant  execute on function public.get_reorder_suggestions(numeric, numeric) to authenticated, service_role;

-- ── The guard ─────────────────────────────────────────────────────────────
-- A RULE, true of any database including the CI seed: nothing may learn a lead
-- time from a shipment whose order date is unknown, and no learned lead time
-- may be zero. A container does not arrive the day it is ordered.
do $$
declare v_zero int;
begin
  select count(*) into v_zero
    from public.get_reorder_suggestions()
   where lead_days is not null and lead_days <= 0;

  if v_zero > 0 then
    raise exception '% product(s) still believe stock arrives the day it is ordered', v_zero;
  end if;
end $$;

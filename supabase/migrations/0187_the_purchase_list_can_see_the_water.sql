-- 0187 — the purchase list can see the water.
--
-- WHAT IT IS TELLING HIM TO DO TODAY, on real production data:
--
--   Xtra Kering XL     buy 10 cartons     13 already in a container
--   Xtra Kering L      buy  5 cartons     13 already in a container
--   Xtra Kering NB/S   buy  4 cartons     20 already in a container
--   Sosoft Blue        buy  9 cartons     16 already in a container
--   … 49 cartons in total, against 102 already bought and afloat on SH-2026-002
--
-- Every one of those is a second purchase of goods he has already paid for.
-- Freight is charged by volume, so a duplicate carton costs its own CBM twice
-- over, and the cash is gone months before the stock can be sold.
--
-- THE MISSING CONCEPT HAS A NAME. Inventory practice does not reorder against
-- what is ON THE SHELF; it reorders against the INVENTORY POSITION:
--
--     position = on hand + on order − committed
--
-- `get_reorder_suggestions` used on-hand alone, so a container that left the
-- supplier three weeks ago was invisible to it. Being blind to on-order is the
-- textbook way to double-order, and this is exactly what it looks like.
--
-- WHICH SHIPMENTS COUNT, and the one that must not:
--
--   ordered        committed to the supplier   → counts
--   in_transit     on the water                → counts
--   arrived        landed, not yet received in → counts
--   grn_confirmed  already in the stock ledger → NO, it is on-hand now
--   draft          a plan, not a purchase      → NO, and this one matters most
--
-- A draft shipment is very often the purchase order he is building FROM this
-- very list. If drafts counted, entering a line would immediately suppress the
-- suggestion that prompted it, and the list would argue with itself while he
-- typed.
--
-- IT SHOWS THE NUMBER, IT DOES NOT JUST SHRINK IT. `incoming_cartons` and
-- `incoming_eta` come back alongside the suggestion, so the screen can say
-- "order 0 more — 13 cartons arrive 16 Aug" instead of quietly printing a
-- smaller number he cannot account for. A figure that changes for reasons the
-- reader cannot see is how a tool stops being believed.
--
-- STOCK HEALTH IS DELIBERATELY UNTOUCHED. `get_sku_reorder_alerts` still
-- answers "is the shelf empty?" from on-hand alone, because an empty shelf is
-- empty today whatever is on the water — the customer standing in front of you
-- cannot buy a container. This is the same split migration 0180 drew for
-- discontinued ranges: the PURCHASE list and STOCK HEALTH are two different
-- questions, and the dashboard's stock-out row (0184) keeps reading the latter.

-- Three new OUT columns, so this is a DROP and not a replace. The defaults
-- (6 lead weeks, 4 safety) are restated below and are load-bearing: the Reorder
-- screen calls this with no arguments, and a previous migration already lost
-- them once this way. `reorder_censored_demand.test.sql` asserts they survive.
drop function if exists get_reorder_suggestions(numeric, numeric);

create function get_reorder_suggestions(
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
    SELECT sl.sku_id, s.created_at, s.grn_confirmed_at, sup.name AS supplier_name,
           ROW_NUMBER() OVER (PARTITION BY sl.sku_id ORDER BY s.grn_confirmed_at DESC) AS rn
    FROM (SELECT DISTINCT shipment_id, sku_id FROM public.shipment_lines) sl
    JOIN public.shipments s ON s.id = sl.shipment_id AND s.grn_confirmed_at IS NOT NULL
    LEFT JOIN public.suppliers sup ON sup.id = s.supplier_id
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

comment on function get_reorder_suggestions(numeric, numeric) is
  'What to BUY, judged against the inventory position (on hand + on order), not '
  'the shelf alone. Stock already bought and afloat is returned as '
  'incoming_cartons/incoming_eta so the screen can show why a suggestion is '
  'small. Draft shipments are excluded on purpose — a draft is usually the '
  'purchase order being built from this very list.';

revoke execute on function get_reorder_suggestions(numeric, numeric) from public;
revoke execute on function get_reorder_suggestions(numeric, numeric) from anon;
grant  execute on function get_reorder_suggestions(numeric, numeric) to authenticated;

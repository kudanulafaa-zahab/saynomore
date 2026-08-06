-- 0151 — the app notices a customer who ran out and never came back.
--
-- Found in the whole-app audit of 2026-08-06: at_risk was flagging 0 of 58
-- customers. Not because everyone is healthy — because the rule cannot see
-- most of them. It needs `gap_count >= 2`, meaning THREE orders, before a
-- customer has a "rhythm" to be overdue against. 42 of 58 customers have
-- ordered exactly once. They are structurally invisible to it, forever.
--
-- That is the wrong instrument for this business. These are not shops with a
-- restocking cadence: 63 customers, not one with a company name, every one on
-- the retail tier, median order 4 packs at MVR 399. They are parents buying
-- for their own baby. A parent has no "ordering rhythm" to break — they have
-- a PACK THAT RUNS OUT. When it does they buy again, from whoever is easiest.
-- If they didn't buy from us, they bought from someone else.
--
-- So the second rule is consumption-based, which is the standard way to time
-- a repurchase prompt for a consumable when the customer has no history:
--
--   expected supply = packs on their last order x cohort days-per-pack
--   lapsed          = they are past 1.5x that, and at least 14 days out
--
-- Both numbers are measured, not chosen:
--
-- * days-per-pack is the MEDIAN of (gap / packs) across every observed
--   repeat purchase, computed here so it self-corrects as orders accumulate.
--   Same-day repeats are excluded — a second order on the same day is an
--   addition to the first, not a repurchase cycle, and including them drags
--   the rate from 6.4 down to 3.75 days a pack and over-flags everyone.
--   Clamped to 2-14 days and defaulted to 6 below 5 observations, so a thin
--   or freak sample can never produce a nonsense threshold.
--
-- * the 1.5x tolerance is the same multiplier the rhythm rule already uses.
--   One concept, one tolerance, rather than a second arbitrary number.
--
-- * the 14-day floor exists so a customer is never chased inside their first
--   fortnight. The observed median repurchase gap is 9.5 days, so without a
--   floor a small buyer could be flagged at day 10 — right at the point where
--   half of customers reorder on their own. It costs one case today and
--   removes a whole class of false alarm.
--
-- Measured against production before applying:
--   8 customers flagged, MVR 1,773 of lifetime revenue
--   50 customers correctly SILENT — still inside the supply they bought
--   3 repeat buyers still handled by the rhythm rule, unchanged
--
-- Worth stating plainly because an earlier read of this data overstated it:
-- "42 customers ordered once and never returned" is not a real finding. Most
-- of them bought enough to still be supplied — the business only has 30 days
-- of order history. Only 8 have actually run out and stayed away.
--
-- UNITS: packs throughout. The division by pcs_per_pack happens HERE so no
-- piece count can reach a screen or a sentence (CLAUDE.md — the units rule
-- covers every word Ali reads, not just app screens).

BEGIN;

-- Column list gains risk_reason and expected_supply_days.
DROP FUNCTION IF EXISTS public.get_customer_insights();

CREATE OR REPLACE FUNCTION public.get_customer_insights()
RETURNS TABLE (
  customer_id          uuid,
  name                 text,
  phone                text,
  island               text,
  price_tier           text,
  orders_count         integer,
  first_order_at       date,
  last_order_at        date,
  days_since_last      integer,
  revenue_mvr          numeric,
  profit_mvr           numeric,
  avg_order_mvr        numeric,
  usual_gap_days       integer,
  at_risk              boolean,
  outstanding_mvr      numeric,
  revenue_share_pct    numeric,
  -- How long what they last bought should have lasted them, in days.
  -- NULL when the last order had no pack-based quantity to reason from.
  expected_supply_days integer,
  -- Why they are at risk: 'rhythm' (a repeat buyer past their own cycle) or
  -- 'ran_out' (bought once or twice, past the supply they bought). NULL when
  -- not at risk. The two need different words on screen, so the screen is
  -- told which one it is rather than guessing from orders_count.
  risk_reason          text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with
  today_mv as (
    select (now() at time zone 'Indian/Maldives')::date as d
  ),
  latest_landed as (
    select distinct on (sku_id) sku_id, landed_per_piece_mvr
    from v_batch_stock where qty_pieces_remaining > 0
    order by sku_id, received_at desc
  ),
  lines as (
    select so.customer_id, so.id as order_id,
           (so.created_at at time zone 'Indian/Maldives')::date as d,
           sol.line_total_mvr as rev,
           sol.qty_pieces * coalesce(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0) as cogs,
           -- The trade unit. A SKU with no pcs_per_pack contributes nothing
           -- rather than a bogus pack count.
           sol.qty_pieces::numeric / nullif(vs.pcs_per_pack, 0) as packs
    from sales_orders so
    join sales_order_lines sol on sol.order_id = so.id
    join v_skus vs on vs.id = sol.sku_id
    left join latest_landed ll on ll.sku_id = sol.sku_id
    where so.status not in ('draft','cancelled')
      and so.customer_id is not null
  ),
  per_order as (
    select customer_id, order_id, d,
           sum(rev) as rev, sum(cogs) as cogs, sum(packs) as packs
    from lines group by customer_id, order_id, d
  ),
  -- One row per customer per DAY they ordered, so a split order does not
  -- read as a repurchase.
  per_day as (
    select customer_id, d, sum(rev) as rev, sum(packs) as packs
    from per_order group by customer_id, d
  ),
  seq as (
    select customer_id, d, packs,
           lead(d) over (partition by customer_id order by d) - d as gap_to_next
    from per_day
  ),
  -- How long one pack lasts a customer here, measured from real repeats.
  cohort as (
    select case
             when count(*) >= 5 then
               greatest(2.0, least(14.0,
                 percentile_cont(0.5) within group (order by gap_to_next / packs)))
             else 6.0
           end as days_per_pack
    from seq
    where gap_to_next is not null and gap_to_next > 0 and packs > 0
  ),
  rtn as (
    select so.customer_id,
           sum(sr.refund_amount_mvr) as refund,
           sum(case when sr.restocked
                    then sr.qty_pieces * coalesce(sr.landed_cost_per_piece_mvr,0)
                    else 0 end) as cost_back
    from sales_returns sr
    join sales_orders so on so.id = sr.order_id
    where so.customer_id is not null
    group by so.customer_id
  ),
  totals as (
    select customer_id,
           count(distinct order_id)::int as orders_count,
           min(d) as first_d, max(d) as last_d,
           sum(rev) as rev, sum(cogs) as cogs
    from per_order group by customer_id
  ),
  -- What they bought on their most recent ordering day, in packs.
  last_buy as (
    select distinct on (customer_id) customer_id, d as last_d, packs as last_packs
    from per_day order by customer_id, d desc
  ),
  gaps as (
    select customer_id,
           round(percentile_cont(0.5) within group (order by gap))::int as gap_days,
           count(*) as gap_count
    from (
      select customer_id, d - lag(d) over (partition by customer_id order by d) as gap
      from per_day
    ) g
    where gap is not null
    group by customer_id
  ),
  owed as (
    select customer_id, sum(outstanding_mvr) as outstanding
    from get_receivables_aging()
    where customer_id is not null
    group by customer_id
  ),
  net as (
    select t.customer_id,
           t.orders_count, t.first_d, t.last_d,
           round(t.rev - coalesce(r.refund, 0), 2) as revenue,
           round((t.rev - t.cogs) - (coalesce(r.refund,0) - coalesce(r.cost_back,0)), 2) as profit
    from totals t left join rtn r on r.customer_id = t.customer_id
  ),
  grand as (select nullif(sum(revenue), 0) as total_rev from net),
  scored as (
    select
      c.id as k_customer_id, c.name as k_name, c.phone as k_phone,
      c.island as k_island, c.price_tier as k_price_tier,
      n.orders_count as k_orders_count,
      n.first_d as k_first_order_at, n.last_d as k_last_order_at,
      ((select d from today_mv) - n.last_d)::int as k_days_since_last,
      n.revenue as k_revenue_mvr,
      n.profit as k_profit_mvr,
      round(n.revenue / nullif(n.orders_count, 0), 2) as k_avg_order_mvr,
      g.gap_days as k_usual_gap_days,
      round(n.outstanding, 2) as k_outstanding_mvr,
      round(n.revenue / (select total_rev from grand) * 100, 1) as k_revenue_share_pct,
      round(lb.last_packs * (select days_per_pack from cohort))::int as k_expected_supply_days,
      -- Rule 1, unchanged: a repeat buyer past their OWN cycle.
      coalesce(g.gap_count >= 2 and g.gap_days >= 1
               and ((select d from today_mv) - n.last_d) > ceil(g.gap_days * 1.5), false) as k_rhythm,
      -- Rule 2, new: past the supply they actually bought, and at least a
      -- fortnight out so a fresh customer is never chased.
      coalesce(
        lb.last_packs > 0
        and ((select d from today_mv) - n.last_d)
            > greatest(lb.last_packs * (select days_per_pack from cohort) * 1.5, 14),
        false) as k_ran_out
    from (select nn.*, coalesce(o.outstanding, 0) as outstanding
            from net nn left join owed o on o.customer_id = nn.customer_id) n
    join customers c on c.id = n.customer_id
    left join gaps    g  on g.customer_id  = n.customer_id
    left join last_buy lb on lb.customer_id = n.customer_id
  )
  select
    s.k_customer_id, s.k_name, s.k_phone, s.k_island, s.k_price_tier,
    s.k_orders_count, s.k_first_order_at, s.k_last_order_at, s.k_days_since_last,
    s.k_revenue_mvr, s.k_profit_mvr, s.k_avg_order_mvr, s.k_usual_gap_days,
    (s.k_rhythm or s.k_ran_out),
    s.k_outstanding_mvr, s.k_revenue_share_pct,
    s.k_expected_supply_days,
    -- Rhythm wins when both fire: a customer with a real history is better
    -- described by their own pattern than by a cohort average.
    case when s.k_rhythm then 'rhythm'
         when s.k_ran_out then 'ran_out' end
  from scored s
  order by s.k_profit_mvr desc nulls last;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_customer_insights() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_customer_insights() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_customer_insights() TO authenticated;

-- ── The briefing stops keeping its own private copy of the rule ───────────
-- get_morning_briefing had the rhythm test inlined: a percentile over order
-- gaps with `having count(*) >= 3`. So it could only ever name a customer
-- with three orders, which on this data is nobody, while the Customers screen
-- now knows about 8 who ran out and never returned. Two definitions of "at
-- risk", disagreeing. This deletes the copy and reads the function, the same
-- way the stuck-stock line reads get_promo_suggestions.
--
-- Ordered by revenue, not by how overdue they are: if only three fit in a
-- briefing, they should be the three worth the most.
CREATE OR REPLACE FUNCTION public.get_morning_briefing()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with mvt as (
    select (now() at time zone 'Indian/Maldives')::date as today
  ),
  y as (select (select today from mvt) - 1 as d),
  demand as (
    select sol.sku_id,
           sum(sol.qty_pieces) as pcs_30d
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    where so.status not in ('draft','cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date
          > (select today from mvt) - 30
    group by sol.sku_id
  ),
  on_hand as (
    select sm.sku_id,
           sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)) as pcs
    from stock_movements sm
    group by sm.sku_id
  ),
  cover as (
    select v.id,
           concat_ws(' ', v.model_name, v.variant_display) as product,
           round(d.pcs_30d::numeric / nullif(v.pcs_per_pack, 0), 1) as packs_30d,
           round(coalesce(oh.pcs, 0)::numeric / nullif(v.pcs_per_pack, 0), 1) as packs_left,
           coalesce(oh.pcs, 0) as pcs_left,
           round( (d.pcs_30d::numeric / nullif(v.pcs_per_pack, 0))
                  * coalesce(v.selling_price_per_pack_mvr, 0) ) as mvr_30d,
           case when d.pcs_30d > 0
                then coalesce(oh.pcs, 0)::numeric / (d.pcs_30d::numeric / 30.0)
           end as days_left
    from v_skus v
    join demand d on d.sku_id = v.id
    left join on_hand oh on oh.sku_id = v.id
    where v.is_active
  ),
  stuck as (
    select p.stock_value_mvr,
           p.reason,
           concat_ws(' ', vs.model_name, vs.variant_display) as product
    from get_promo_suggestions() p
    join v_skus vs on vs.id = p.sku_id
  ),
  -- One source of truth for "at risk" (see header).
  at_risk_customers as (
    select name, phone, usual_gap_days, days_since_last,
           expected_supply_days, risk_reason, revenue_mvr
    from get_customer_insights()
    where at_risk
  )
  select jsonb_build_object(
    'yesterday_revenue', coalesce((
      select sum(sol.line_total_mvr) from sales_order_lines sol
      join sales_orders so on so.id = sol.order_id
      where so.status not in ('draft','cancelled')
        and (so.created_at at time zone 'Indian/Maldives')::date = (select d from y)), 0),
    'yesterday_orders', (
      select count(*) from sales_orders
      where status not in ('draft','cancelled')
        and (created_at at time zone 'Indian/Maldives')::date = (select d from y)),
    'yesterday_delivered', (
      select count(*) from sales_orders
      where (delivered_at at time zone 'Indian/Maldives')::date = (select d from y)),
    'yesterday_collected', coalesce((
      select sum(amount_mvr) from order_payments
      where (paid_at at time zone 'Indian/Maldives')::date = (select d from y)), 0),

    'stockout_count', (select count(*) from cover where pcs_left <= 0),
    'stockout_mvr_month', coalesce((select sum(mvr_30d) from cover where pcs_left <= 0), 0),
    'stockouts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product', x.product,
               'packs_per_month', x.packs_30d,
               'mvr_per_month', x.mvr_30d))
      from (select product, packs_30d, mvr_30d from cover
             where pcs_left <= 0
             order by mvr_30d desc, packs_30d desc
             limit 3) x), '[]'::jsonb),

    'running_out_count', (
      select count(*) from cover where pcs_left > 0 and days_left is not null and days_left < 7),
    'running_out', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product', x.product,
               'packs_left', x.packs_left,
               'days_left', round(x.days_left)))
      from (select product, packs_left, days_left from cover
             where pcs_left > 0 and days_left is not null and days_left < 7
             order by days_left asc
             limit 3) x), '[]'::jsonb),

    'overdue_count', (
      select count(*) from get_receivables_aging() where bucket <> 'current'),
    'overdue_mvr', coalesce((
      select sum(outstanding_mvr) from get_receivables_aging() where bucket <> 'current'), 0),

    'stuck_stock_count', (select count(*) from stuck),
    'stuck_stock_mvr', coalesce((select sum(stock_value_mvr) from stuck), 0),
    'stuck_stock_top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product', x.product,
               'mvr', x.stock_value_mvr,
               'reason', x.reason))
      from (select product, stock_value_mvr, reason from stuck
             order by stock_value_mvr desc
             limit 2) x), '[]'::jsonb),

    'expiring_value_mvr', coalesce((
      select sum(value_mvr) from v_expiring_stock where days_left <= 60), 0),
    'batches_without_expiry', (
      select count(*) from inventory_batches ib
      where ib.expiry_date is null
        and (select coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0)
               from stock_movements sm where sm.batch_id = ib.id) > 0),
    'stock_value_without_expiry_mvr', coalesce((
      select sum( (select coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0)
                     from stock_movements sm where sm.batch_id = ib.id)
                  * coalesce(ib.landed_per_piece_mvr, 0) )
      from inventory_batches ib
      where ib.expiry_date is null
        and (select coalesce(sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)), 0)
               from stock_movements sm where sm.batch_id = ib.id) > 0), 0),
    'price_checks_due', (
      select count(*) from get_competitor_price_freshness() f where f.due),
    'price_checks_cost_changed', (
      select count(*) from get_competitor_price_freshness() f
       where f.due_reason = 'cost_changed'),

    'at_risk_count', (select count(*) from at_risk_customers),
    'overdue_customers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', x.name, 'phone', x.phone,
               'usual_gap_days', x.usual_gap_days,
               'days_since_last', x.days_since_last,
               'expected_supply_days', x.expected_supply_days,
               'reason', x.risk_reason))
      from (select * from at_risk_customers
             order by revenue_mvr desc nulls last, days_since_last desc
             limit 3) x), '[]'::jsonb)
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.get_morning_briefing() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_morning_briefing() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_morning_briefing() TO authenticated;

COMMIT;

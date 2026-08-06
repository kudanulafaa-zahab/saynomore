-- 0148 — the morning briefing tells Ali when he is OUT OF STOCK on a seller.
--
-- Found in the whole-app audit of 2026-08-06. Four products were sitting at
-- zero stock — Xtra Kering XL (16 packs sold last month), Xtra Kering L (15),
-- Sosoft Green (12), Xtra Kering NB/S (6) — worth MVR 6,741 a month of demand
-- he cannot fill. get_dashboard_metrics already counted them
-- (out_of_stock_count = 4), but the MORNING BRIEFING — the thing he actually
-- reads — never mentioned it. It reported "20 slow movers" and "9 price
-- checks due" instead.
--
-- A distributor's single most expensive failure is being out of the thing
-- that sells. Nothing else in the briefing outranks it, so this leads the
-- watch list.
--
-- Two lists, deliberately separate:
--   stockouts    — on hand <= 0 AND sold in the last 30 days. Proven demand,
--                  zero stock. Unambiguous, no threshold to argue about.
--   running_out  — under 7 days of cover at the last 30 days' rate. The
--                  warning that still leaves time to act.
-- Both are limited to the worst 3 by money, because a briefing that lists ten
-- things is a briefing nobody reads.
--
-- UNITS: packs, never pieces (CLAUDE.md — Ali has had to say this four
-- times). The division by pcs_per_pack happens HERE, in Postgres, so the
-- browser never sees a piece count it might render.
--
-- A SKU with no selling price contributes 0 to the money total rather than
-- being dropped: it still appears by name, because "you cannot sell it and
-- you also never priced it" is worth seeing, not hiding. Xtra Kering NB/S is
-- exactly that case today.

BEGIN;

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
  -- Last 30 days of real demand, per SKU, in that SKU's own pack unit.
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
           -- Model + size only: the brand is almost always Mamypoko, so
           -- repeating it three times in one sentence is noise on a phone.
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

    -- ── Out of stock on something that sells ─────────────────────────────
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

    -- ── About to run out (still time to act) ─────────────────────────────
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
    'slow_movers', (
      select count(*) from get_promo_suggestions()),
    'expiring_value_mvr', coalesce((
      select sum(value_mvr) from v_expiring_stock where days_left <= 60), 0),
    -- The blind spot, so "0 expiring" can never masquerade as good news.
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
    'overdue_customers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', x.name, 'phone', x.phone,
               'usual_gap_days', x.gap_days,
               'days_since_last', x.days_since))
      from (
        select c.name, c.phone, r.gap_days, r.days_since
        from (
          select seq.customer_id,
                 round(percentile_cont(0.5) within group (order by seq.gap))::int as gap_days,
                 ((select today from mvt) - max(seq.d))::int as days_since,
                 count(*) as order_days
          from (
            select dd.customer_id, dd.d,
                   dd.d - lag(dd.d) over (partition by dd.customer_id order by dd.d) as gap
            from (
              select distinct so.customer_id,
                     (so.created_at at time zone 'Indian/Maldives')::date as d
              from sales_orders so
              where so.status not in ('draft','cancelled')
                and so.customer_id is not null
            ) dd
          ) seq
          group by seq.customer_id
          having count(*) >= 3
        ) r
        join customers c on c.id = r.customer_id
        where r.gap_days >= 1
          and r.days_since > ceil(r.gap_days * 1.5)
        order by (r.days_since - r.gap_days) desc
        limit 3
      ) x
    ), '[]'::jsonb)
  );
$function$;

-- New/recreated functions pick up an implicit PUBLIC grant here; REVOKE from
-- anon alone does not remove it (migration 0145).
REVOKE EXECUTE ON FUNCTION public.get_morning_briefing() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_morning_briefing() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_morning_briefing() TO authenticated;

COMMIT;

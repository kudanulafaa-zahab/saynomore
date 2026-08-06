-- 0150 — the Promo Advisor stops telling Ali to discount his best sellers.
--
-- Found in the whole-app audit of 2026-08-06. get_promo_suggestions() ranked
-- MAMYPOKO XTRA KERING M FIRST — the single best-selling product in the
-- business (1,904 pieces in 90 days) — with a suggested clearance discount.
-- Xtra Kering XXXL, S and XXL sat at positions 3, 4 and 5. The advisor was
-- recommending margin be given away on the four things that sell fastest.
--
-- The cause is one conflated test. The old filter admitted a SKU when
--     no sales in 90 days  OR  more than 180 days of cover  OR  expiring
-- and treated all three as the same problem. They are not. In category
-- management these are opposite diagnoses with opposite cures:
--
--   NOT SELLING  — no off-take at the current price. The demand isn't there,
--                  so the price has to move. Promo, bundle, or delist.
--   OVER-BOUGHT  — off-take is healthy; too much was PURCHASED. The cure is
--                  supply-side: order less next time and let it run down.
--                  Discounting here destroys margin on volume that was going
--                  to sell anyway, at full price, without any help.
--
-- Xtra Kering M is the second kind. 258 days of cover on a product that sells
-- every day is a buying decision to correct in the next container, not a
-- reason to cut the price of the one line carrying the business.
--
-- And the over-bought case is ALREADY handled, in the correct module:
-- get_reorder_suggestions() marks dir > 90 days as status 'overstock' and
-- suggests zero cartons. Reorder owns "you have too much". Promo owns "it
-- isn't moving". This migration puts that boundary back — the same
-- module discipline as "Market decides, Expenses records" (skills.md Seat 6).
--
-- Three reasons now, in precedence order, returned as a `reason` column so
-- the screen can say WHY and never mix the advice up again:
--
--   'expiring' — a batch dies within 180 days. A date beats everything: this
--                stays on the list even if the SKU sells well, because
--                unsold-by-then is a 100% write-off, not a slow month.
--   'dead'     — zero sales in 90 days. No demand at any speed.
--   'stagnant' — it sells, but at this pace the stock lasts MORE THAN A YEAR.
--                Diapers and detergent don't spoil, so the binding constraint
--                is capital, not shelf life — and money locked up for over a
--                year is stuck money whatever the sell-through rate says.
--
-- The 180-365 day band is deliberately NOT on this list. That is the
-- over-bought band, and Reorder already covers it.
--
-- Measured on production, before and after applying:
--   before — 20 SKUs, MVR 72,905, led by Xtra Kering M
--   after  — 15 SKUs, MVR 43,455, and ZERO Xtra Kering rows remaining
--            dead     8 SKUs  MVR 24,310  (Royal Soft Boy XL/XXL, Royal Soft
--                                          Girl L/M/XL, Skin Comfort XXL,
--                                          Mama Lime, Good skin NB/S)
--            stagnant 7 SKUs  MVR 19,145  (Skin Comfort M at 1,710 days of
--                                          cover, Good skin XL at 1,530,
--                                          Good skin M at 1,350, Royal Soft
--                                          Boy L at 990, the three Sosoft
--                                          bottles at 378-704)
--   removed  5 SKUs  MVR 29,450 — Xtra Kering M/S/XXL/XXXL and Good skin XXL,
--            all in the 180-321 day band. Every one keeps selling at full
--            price, and every one already shows as 'overstock' on Reorder,
--            which is where the correction belongs.
--
-- get_dashboard_metrics.slow_stock_value_mvr reads this function, so the
-- dashboard's "tied up in slow stock" tile corrects itself: MVR 72,905 ->
-- MVR 43,455, and it stops counting the top seller as cash to free.
--
-- The morning briefing changes shape below for the same reason. "20 slow
-- movers" was both wrong and unreadable — a count is not a decision, and one
-- that flags 20 of 31 SKUs trains him to ignore the line. It now leads with
-- the money and names the worst two.

BEGIN;

-- The return column list gains `reason`, which CREATE OR REPLACE cannot do.
DROP FUNCTION IF EXISTS public.get_promo_suggestions();

CREATE OR REPLACE FUNCTION public.get_promo_suggestions()
RETURNS TABLE (
  sku_id              uuid,
  internal_code       text,
  full_path           text,
  stock_pieces        integer,
  stock_value_mvr     numeric,
  days_of_stock       integer,
  expiry_days_left    integer,
  current_pack_mvr    numeric,
  promo_pack_mvr      numeric,
  discount_pct        numeric,
  pcs_per_pack        integer,
  reason              text      -- 'expiring' | 'dead' | 'stagnant'
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with stock as (
    select bs.sku_id,
           sum(bs.qty_pieces_remaining)::integer as pieces,
           round(sum(bs.qty_pieces_remaining * coalesce(bs.landed_per_piece_mvr, 0)), 2) as value_mvr
    from v_batch_stock bs
    where bs.qty_pieces_remaining > 0
    group by bs.sku_id
  ),
  latest_landed as (
    select distinct on (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
    from v_batch_stock bs
    where bs.qty_pieces_remaining > 0
    order by bs.sku_id, bs.received_at desc
  ),
  velocity as (
    select sol.sku_id, sum(sol.qty_pieces)::numeric / 90.0 as per_day
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    where so.status not in ('draft', 'cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date
          >= (now() at time zone 'Indian/Maldives')::date - 90
    group by sol.sku_id
  ),
  expiring as (
    select es.sku_id, min(es.days_left)::integer as days_left
    from v_expiring_stock es
    group by es.sku_id
  ),
  -- Every column is aliased with a k_ prefix on purpose: in a LANGUAGE sql
  -- function the RETURNS TABLE names are in scope as variables, so a CTE
  -- column called `sku_id` or `reason` collides with the OUT parameter of
  -- the same name and Postgres rejects the reference as ambiguous.
  scored as (
    select
      s.id                as k_sku_id,
      s.internal_code     as k_internal_code,
      concat_ws(' › ', b.name, m.name, v.display_name) as k_full_path,
      st.pieces           as k_pieces,
      st.value_mvr        as k_value_mvr,
      case when coalesce(vel.per_day, 0) > 0
           then round(st.pieces / vel.per_day)::integer end as k_days_of_stock,
      ex.days_left        as k_expiry_days_left,
      vs.selling_price_per_pack_mvr as k_current_pack_mvr,
      round(ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90, 0) as k_promo_pack_mvr,
      round((1 - (ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90)
                / nullif(vs.selling_price_per_pack_mvr, 0)) * 100, 0) as k_discount_pct,
      s.pcs_per_pack      as k_pcs_per_pack,
      -- Precedence: a shelf-life deadline outranks a sales problem, because
      -- the deadline is absolute and the sales problem is only expensive.
      case
        when ex.days_left is not null and ex.days_left <= 180 then 'expiring'
        when coalesce(vel.per_day, 0) = 0                     then 'dead'
        when st.pieces / vel.per_day > 365                    then 'stagnant'
      end as k_reason
    from skus s
    join stock st            on st.sku_id = s.id
    join latest_landed ll    on ll.sku_id = s.id
    join v_skus vs           on vs.id = s.id
    left join velocity vel   on vel.sku_id = s.id
    left join expiring ex    on ex.sku_id = s.id
    join variants v          on v.id = s.variant_id
    join product_models m    on m.id = v.model_id
    join brands b            on b.id = m.brand_id
    where s.is_active
      and vs.selling_price_per_pack_mvr is not null
      and vs.selling_price_per_pack_mvr > 0
      -- Only suggest a promo that still clears the 10% floor margin. A
      -- "discount" above today's price is not a suggestion, it is a bug.
      and round(ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90, 0)
          < vs.selling_price_per_pack_mvr
  )
  select sc.k_sku_id, sc.k_internal_code, sc.k_full_path, sc.k_pieces,
         sc.k_value_mvr, sc.k_days_of_stock, sc.k_expiry_days_left,
         sc.k_current_pack_mvr, sc.k_promo_pack_mvr, sc.k_discount_pct,
         sc.k_pcs_per_pack, sc.k_reason
  from scored sc
  where sc.k_reason is not null  -- drops the over-bought band; Reorder owns it
  order by
    case sc.k_reason when 'expiring' then 0 when 'dead' then 1 else 2 end,
    sc.k_value_mvr desc;
$function$;

-- New/recreated functions pick up an implicit PUBLIC grant in this project;
-- REVOKE from anon alone does not remove it (migration 0145).
REVOKE EXECUTE ON FUNCTION public.get_promo_suggestions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_promo_suggestions() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_promo_suggestions() TO authenticated;

-- ── The briefing line: money and names, not a count ───────────────────────
-- Replaces 'slow_movers' (a bare count that reached 20 of 31 SKUs — an alert
-- that fires on two thirds of the catalogue is an alert nobody reads) with
-- the cash at stake and the two worst products by name. Same shape as the
-- stockout line added in 0148, so the whole watch list reads consistently.
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
  ),
  -- Stock that genuinely isn't moving — dead, stagnant or expiring. The
  -- over-bought best sellers are no longer in here (see the header).
  stuck as (
    select p.stock_value_mvr,
           p.reason,
           concat_ws(' ', vs.model_name, vs.variant_display) as product
    from get_promo_suggestions() p
    join v_skus vs on vs.id = p.sku_id
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

    -- ── Cash stuck in stock that isn't moving ────────────────────────────
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

REVOKE EXECUTE ON FUNCTION public.get_morning_briefing() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_morning_briefing() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_morning_briefing() TO authenticated;

COMMIT;

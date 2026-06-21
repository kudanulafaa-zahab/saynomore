-- ============================================================================
-- 0037 — ABC analysis (revenue-based SKU classification)
-- ============================================================================
-- FMCG doctrine (fmcg-import-expert): classify SKUs by cumulative revenue share.
--   A = SKUs that together make the top 80% of revenue  → tight stock control
--   B = next 15% (cumulative 80–95%)                    → standard control
--   C = bottom 5% (cumulative > 95%)                    → relaxed, bulk-buy
-- Recalculate monthly. Classification is on REVENUE (per doctrine) — the margin
-- lens is covered separately by get_contribution_margin.
--
-- Revenue is computed exactly like get_reports_data (sales_order_lines, excluding
-- draft/cancelled, date-bounded) so the two reports can never disagree.
--
-- All arithmetic in Postgres (hard rule). Returns one row per active SKU that had
-- revenue in the window, ranked, with its cumulative share and A/B/C class.
-- ----------------------------------------------------------------------------

create or replace function public.get_abc_analysis(p_from date, p_to date)
returns table (
  sku_id              uuid,
  brand_name          text,
  model_name          text,
  variant_display     text,
  internal_code       text,
  total_qty_pieces    bigint,
  total_revenue_mvr   numeric,
  revenue_share_pct   numeric,   -- this SKU's share of total revenue
  cumulative_pct      numeric,   -- running cumulative share (drives the class)
  abc_class           text,      -- 'A' | 'B' | 'C'
  rank                integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with period_sales as (
    select
      sol.sku_id,
      sum(sol.qty_pieces)     as qty_pieces,
      sum(sol.line_total_mvr) as revenue_mvr
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    where so.status not in ('draft', 'cancelled')
      and so.created_at::date between p_from and p_to
    group by sol.sku_id
    having sum(sol.line_total_mvr) > 0
  ),
  total as (
    select sum(revenue_mvr) as grand_total from period_sales
  ),
  ranked as (
    select
      ps.sku_id,
      ps.qty_pieces,
      ps.revenue_mvr,
      row_number() over (order by ps.revenue_mvr desc, ps.sku_id) as rn,
      -- cumulative revenue up to and INCLUDING this SKU (shown to the user)
      round(
        100.0 * sum(ps.revenue_mvr) over (
          order by ps.revenue_mvr desc, ps.sku_id
          rows between unbounded preceding and current row
        ) / nullif((select grand_total from total), 0),
        2
      ) as cum_pct,
      -- cumulative up to the PREVIOUS SKU — used for classing so the SKU that
      -- crosses a threshold still belongs to the lower (better) class. Without
      -- this, a single SKU worth >80% of revenue would misclassify out of A.
      coalesce(
        100.0 * sum(ps.revenue_mvr) over (
          order by ps.revenue_mvr desc, ps.sku_id
          rows between unbounded preceding and 1 preceding
        ) / nullif((select grand_total from total), 0),
        0
      ) as prev_cum_pct,
      round(100.0 * ps.revenue_mvr / nullif((select grand_total from total), 0), 2) as share_pct
    from period_sales ps
  )
  select
    r.sku_id,
    b.name                                  as brand_name,
    m.name                                  as model_name,
    v.display_name                          as variant_display,
    s.internal_code,
    r.qty_pieces::bigint                    as total_qty_pieces,
    r.revenue_mvr                           as total_revenue_mvr,
    r.share_pct                             as revenue_share_pct,
    r.cum_pct                               as cumulative_pct,
    case
      when r.prev_cum_pct < 80 then 'A'
      when r.prev_cum_pct < 95 then 'B'
      else 'C'
    end                                     as abc_class,
    r.rn::integer                           as rank
  from ranked r
  join skus s            on s.id = r.sku_id
  join variants v        on v.id = s.variant_id
  join product_models m  on m.id = v.model_id
  join brands b          on b.id = m.brand_id
  order by r.rn;
$function$;

revoke all on function public.get_abc_analysis(date, date) from public, anon;
grant execute on function public.get_abc_analysis(date, date) to authenticated, service_role;

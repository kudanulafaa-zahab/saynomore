-- ============================================================================
-- 0035 — Low-stock daily digest (RPC + scheduled push)
-- ============================================================================
-- Expert-panel decision (2026-06-21): low-stock alerts are a ONCE-A-DAY digest
-- to admins/managers, NOT an instant push per dip (that's noise). This migration
-- adds the data side; the edge function `daily-low-stock` calls get_low_stock_digest()
-- and pushes the result, and pg_cron triggers that function once a day.
--
-- All formatting stays in Postgres (hard rule: business logic in SQL, not TS/Deno).
-- The edge function does zero logic — it calls the RPC and forwards title/body.
-- ----------------------------------------------------------------------------

-- One row: how many SKUs need reordering + a ready-to-send summary line.
-- alert_count = 0 means "nothing to send" — the edge function skips the push.
create or replace function public.get_low_stock_digest()
returns table (alert_count integer, body text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with alerts as (
    select
      a.sku_id,
      a.stock_pieces,
      a.dir,
      a.alert_level,
      trim(both ' ' from concat_ws(' ',
        vs.brand_name, vs.model_name, vs.variant_display
      )) as sku_name
    from get_sku_reorder_alerts() a
    join v_skus vs on vs.id = a.sku_id
    where a.alert_level in ('low', 'critical')
  ),
  ranked as (
    -- critical first, then by fewest days of stock remaining
    select *,
      row_number() over (
        order by (alert_level = 'critical') desc, dir asc nulls last
      ) as rn
    from alerts
  )
  select
    (select count(*)::integer from alerts) as alert_count,
    -- top 8 by urgency, one per line: "• Brand Model Variant — 5d left (120 pcs)"
    coalesce(
      string_agg(
        format('%s%s — %sd left (%s pcs)',
          case when alert_level = 'critical' then '🔴 ' else '🟡 ' end,
          sku_name,
          coalesce(dir::text, '?'),
          round(stock_pieces)::text
        ),
        E'\n' order by rn
      ) filter (where rn <= 8),
      ''
    ) as body
  from ranked;
$function$;

-- Lock it down: this reads stock + product data, so admin/manager only.
revoke all on function public.get_low_stock_digest() from public, anon, authenticated;
grant execute on function public.get_low_stock_digest() to service_role;

-- ============================================================================
-- NOTE: pg_cron + pg_net enablement and the cron schedule are applied in a
-- SEPARATE step (0036) AFTER the daily-low-stock edge function is deployed,
-- because the cron job references the function's URL. Keeping them separate
-- means this RPC can be reviewed/tested on its own first.
-- ============================================================================

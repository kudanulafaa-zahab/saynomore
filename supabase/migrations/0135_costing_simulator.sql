-- 0135 — "What would this cost me?" — a costing sandbox.
--
-- Ali asked for a way to try FOB prices, a container freight share and fixed
-- freight against his SKUs and see what the landed cost would be, explicitly
-- without touching real costing.
--
-- ONE DESIGN NOTE WORTH READING, because it shapes the whole feature.
-- You cannot honestly cost a single SKU on its own. Freight, duty, MPL, agent
-- and last-mile are *shared container costs*: confirm_grn splits freight and
-- local charges by each line's share of total CBM, and splits duty by each
-- line's share of FOB×duty-rate. Change one line's cartons and every other
-- line's cost moves. So a screen with a "container share" box per SKU would
-- produce numbers that never add up to a real container.
--
-- What this does instead: simulate a whole shipment. You list the SKUs and
-- cartons, give the shipment-level costs once, and every line is apportioned
-- exactly the way confirm_grn will apportion it on the real GRN. The formula
-- below is a line-for-line mirror of confirm_grn — if that function's
-- apportionment ever changes, this must change with it or the sandbox starts
-- lying.
--
-- SAFETY: simulate_landed_costs is a pure SQL function. It is STABLE, it
-- contains no INSERT/UPDATE/DELETE against any table, and it is SECURITY
-- INVOKER so it can never see or do more than the person calling it. It
-- cannot write to shipment_lines, inventory_batches or skus even by accident
-- — there is no write statement in it to go wrong.

create or replace function public.simulate_landed_costs(
  p_shipment jsonb,
  p_lines    jsonb
)
returns table (
  sku_id                    uuid,
  brand_name                text,
  model_name                text,
  variant_display           text,
  category_name             text,
  category_sort_order       integer,
  qty_cartons               numeric,
  pcs_per_pack              integer,
  packs_per_carton          integer,
  fob_total_mvr             numeric,
  cbm_total                 numeric,
  cbm_share_pct             numeric,
  freight_mvr               numeric,
  local_mvr                 numeric,
  duty_mvr                  numeric,
  landed_total_mvr          numeric,
  landed_per_carton_mvr     numeric,
  landed_per_pack_mvr       numeric,
  landed_per_piece_mvr      numeric,
  -- What it costs today, so a simulation can be read as better/worse.
  current_landed_per_piece_mvr numeric,
  delta_per_piece_mvr       numeric,
  -- What he sells it for today, and what that margin becomes at this cost.
  selling_price_per_piece_mvr numeric,
  simulated_margin_pct      numeric,
  current_margin_pct        numeric,
  target_margin_pct         numeric,
  -- The number he actually acts on: what he'd have to charge to hold his
  -- margin at this cost. Only 1 of 31 SKUs has an explicit target_margin_pct
  -- on file, so this falls back to the margin the SKU earns today — "what do
  -- I charge to be no worse off?" is the question he can always answer.
  price_for_target_mvr      numeric,
  -- Which of the two the price above is based on, so the screen can say so
  -- rather than implying a target that was never set.
  price_basis               text
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with ship as (
    select
      coalesce((p_shipment->>'rate_usd_to_mvr')::numeric, 0)   as fx_usd,
      coalesce((p_shipment->>'rate_idr_to_mvr')::numeric, 0)   as fx_idr,
      coalesce((p_shipment->>'freight_share_usd')::numeric, 0) as freight_usd,
      coalesce((p_shipment->>'customs_duty_mvr')::numeric, 0)  as duty_mvr,
      ( coalesce((p_shipment->>'mpl_charges_mvr')::numeric, 0)
      + coalesce((p_shipment->>'agent_fee_mvr')::numeric,    0)
      + coalesce((p_shipment->>'last_mile_mvr')::numeric,    0)
      + coalesce((p_shipment->>'insurance_mvr')::numeric,    0)
      + coalesce((p_shipment->>'other_mvr')::numeric,        0) ) as local_mvr
  ),
  raw as (
    select
      (l->>'sku_id')::uuid                              as sku_id,
      greatest(coalesce((l->>'qty_cartons')::numeric, 0), 0)     as qty,
      greatest(coalesce((l->>'cbm_per_carton')::numeric, 0), 0)  as cbm_per_carton,
      greatest(coalesce((l->>'fob_per_carton')::numeric, 0), 0)  as fob_per_carton,
      upper(coalesce(l->>'fob_currency', 'USD'))                 as fob_currency
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
    where (l->>'sku_id') is not null
  ),
  calc as (
    select
      r.*,
      v.brand_name, v.model_name, v.variant_display,
      v.category_name, v.category_sort_order,
      v.pcs_per_pack, v.packs_per_carton,
      v.landed_per_piece_mvr        as cur_landed,
      v.selling_price_per_piece_mvr as sell_piece,
      v.actual_margin_pct           as cur_margin,
      coalesce(v.duty_rate_pct, 0)  as duty_rate_pct,
      v.target_margin_pct,
      r.qty * r.cbm_per_carton      as cbm_total,
      r.qty * r.fob_per_carton *
        case r.fob_currency
          when 'IDR' then (select fx_idr from ship)
          when 'USD' then (select fx_usd from ship)
          else 1
        end                          as fob_total
    from raw r
    join v_skus v on v.id = r.sku_id
  ),
  tot as (
    select
      nullif(sum(c.cbm_total), 0)                        as total_cbm,
      nullif(sum(c.fob_total * c.duty_rate_pct), 0)      as total_duty_weight
    from calc c
  ),
  ap as (
    select
      c.*,
      -- Freight and local charges follow CBM, exactly as confirm_grn does.
      coalesce(c.cbm_total / t.total_cbm, 0)                       as cbm_share,
      coalesce(c.cbm_total / t.total_cbm, 0) * (s.freight_usd * s.fx_usd) as app_freight,
      coalesce(c.cbm_total / t.total_cbm, 0) * s.local_mvr         as app_local,
      -- Duty follows FOB weighted by each category's duty rate; with no rates
      -- on file it falls back to CBM share — same fallback as confirm_grn.
      case
        when t.total_duty_weight is not null
          then (c.fob_total * c.duty_rate_pct) / t.total_duty_weight * s.duty_mvr
        else coalesce(c.cbm_total / t.total_cbm, 0) * s.duty_mvr
      end                                                          as app_duty
    from calc c, tot t, ship s
  ),
  landed as (
    select a.*, (a.fob_total + a.app_freight + a.app_local + a.app_duty) as landed_total
    from ap a
  ),
  per as (
    select
      l.*,
      nullif(l.qty, 0)                                              as q_ctn,
      nullif(l.qty * l.packs_per_carton, 0)                         as q_pack,
      nullif(l.qty * l.packs_per_carton * l.pcs_per_pack, 0)        as q_piece
    from landed l
  )
  select
    p.sku_id,
    p.brand_name, p.model_name, p.variant_display,
    p.category_name, p.category_sort_order,
    p.qty,
    p.pcs_per_pack, p.packs_per_carton,
    round(p.fob_total, 2),
    round(p.cbm_total, 4),
    round(p.cbm_share * 100, 2),
    round(p.app_freight, 2),
    round(p.app_local, 2),
    round(p.app_duty, 2),
    round(p.landed_total, 2),
    round(p.landed_total / p.q_ctn,   4),
    round(p.landed_total / p.q_pack,  4),
    round(p.landed_total / p.q_piece, 4),
    round(p.cur_landed, 4),
    -- Positive delta = this scenario costs MORE than today.
    round(p.landed_total / p.q_piece - p.cur_landed, 4),
    round(p.sell_piece, 4),
    case when p.sell_piece > 0
         then round((1 - (p.landed_total / p.q_piece) / p.sell_piece) * 100, 2) end,
    round(p.cur_margin, 2),
    round(p.target_margin_pct, 2),
    case when coalesce(p.target_margin_pct, p.cur_margin) > 0
          and coalesce(p.target_margin_pct, p.cur_margin) < 100
         then round((p.landed_total / p.q_piece)
                    / (1 - coalesce(p.target_margin_pct, p.cur_margin) / 100.0), 2) end,
    case when p.target_margin_pct is not null then 'target'
         when p.cur_margin is not null        then 'current'
         else null end
  from per p
  order by p.category_sort_order nulls last, p.brand_name, p.model_name, p.variant_display;
$function$;

comment on function public.simulate_landed_costs(jsonb, jsonb) is
  'Read-only costing sandbox. Mirrors confirm_grn''s apportionment exactly '
  '(freight/local by CBM share, duty by FOB x duty-rate weight) but writes '
  'nothing. If confirm_grn''s apportionment changes, change this with it.';

revoke execute on function public.simulate_landed_costs(jsonb, jsonb) from public, anon;
grant  execute on function public.simulate_landed_costs(jsonb, jsonb) to authenticated, service_role;


-- ── Seed the screen from reality ───────────────────────────────────────────
-- Re-typing 31 SKUs' cartons, CBM and FOB by hand would make the tool useless,
-- so it opens pre-filled with each SKU's most recent real shipment line.

create or replace function public.get_costing_seed()
returns table (
  sku_id              uuid,
  brand_name          text,
  model_name          text,
  variant_display     text,
  category_name       text,
  category_sort_order integer,
  pcs_per_pack        integer,
  packs_per_carton    integer,
  cbm_per_carton      numeric,
  last_fob_per_carton numeric,
  last_fob_currency   text,
  last_qty_cartons    numeric,
  duty_rate_pct       numeric,
  current_landed_per_piece_mvr numeric,
  selling_price_per_piece_mvr  numeric,
  target_margin_pct   numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select
    v.id,
    v.brand_name, v.model_name, v.variant_display,
    v.category_name, v.category_sort_order,
    v.pcs_per_pack, v.packs_per_carton,
    coalesce(last_line.cbm_per_carton, v.cbm_per_carton),
    last_line.fob_per_carton,
    coalesce(last_line.fob_currency, 'USD'),
    coalesce(last_line.qty_cartons_actual, last_line.qty_cartons),
    coalesce(v.duty_rate_pct, 0),
    v.landed_per_piece_mvr,
    v.selling_price_per_piece_mvr,
    v.target_margin_pct
  from v_skus v
  left join lateral (
    select sl.cbm_per_carton, sl.fob_per_carton, sl.fob_currency,
           sl.qty_cartons, sl.qty_cartons_actual
    from shipment_lines sl
    join shipments s on s.id = sl.shipment_id
    where sl.sku_id = v.id
    order by coalesce(s.grn_confirmed_at, s.created_at) desc
    limit 1
  ) last_line on true
  where v.is_active
  order by v.category_sort_order nulls last, v.brand_name, v.model_name, v.variant_display;
$function$;

comment on function public.get_costing_seed() is
  'Opens the costing sandbox pre-filled from each SKU''s most recent shipment '
  'line, so nobody has to re-key 31 rows of cartons/CBM/FOB.';

revoke execute on function public.get_costing_seed() from public, anon;
grant  execute on function public.get_costing_seed() to authenticated, service_role;


-- ── Saved scenarios ────────────────────────────────────────────────────────
-- Its own table, referencing nothing in the real costing chain. Deleting every
-- row here cannot affect a single landed cost.

create table if not exists public.costing_scenarios (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  payload    jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.costing_scenarios is
  'Saved what-if costing scenarios. Sandbox data only — nothing here feeds '
  'landed cost, stock or pricing.';

create index if not exists costing_scenarios_created_by_idx
  on public.costing_scenarios (created_by, updated_at desc);

alter table public.costing_scenarios enable row level security;

drop policy if exists costing_scenarios_rw on public.costing_scenarios;
create policy costing_scenarios_rw on public.costing_scenarios
  for all to authenticated
  using (is_admin_or_manager())
  with check (is_admin_or_manager());

revoke all on public.costing_scenarios from anon;
grant select, insert, update, delete on public.costing_scenarios to authenticated;

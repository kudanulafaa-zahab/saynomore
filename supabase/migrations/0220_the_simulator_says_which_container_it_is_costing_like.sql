-- 0220 — the simulator says which container it is costing like.
--
-- Ali, 2026-08-29:
--   *"In prices, pricing tool where is it getting the landed cost from? How
--    does it apply between grns? 002 is much higher price than 001. So is
--    this tool accurate?"*
--
-- ── THE ARITHMETIC WAS NEVER THE PROBLEM. THE STARTING ASSUMPTION WAS ───────
--
-- get_costing_defaults pre-fills the screen from the MOST RECENT shipment,
-- silently. Today that is SH-2026-002, and the two containers are not
-- comparable:
--
--     SH-2026-001   8.01 CBM   MVR 19,156 freight   =  MVR 2,392 per CBM
--     SH-2026-002   2.69 CBM   MVR 13,829 freight   =  MVR 5,133 per CBM
--
-- So every simulation started today runs at more than double SH-001's freight
-- rate, and nothing on screen says so. That is not a bug in the maths — a 2.69
-- CBM consignment genuinely costs far more per cubic metre, because there is
-- less container to share (CLAUDE.md: freight is volatile, every shipment
-- stands alone, never extrapolate one shipment's rate onto another).
--
-- But it makes the tool quietly WRONG for the next full container: it
-- over-costs every line, and Ali walks away from supplier quotes that are
-- perfectly good. The fix is not to average the two rates — averaging is the
-- same extrapolation with extra steps. It is to say which container the
-- assumption came from, and let him choose another.
--
-- ── WHY PER CBM, AND WHY IT MUST BE ON SCREEN ───────────────────────────────
--
-- Freight is charged by VOLUME, not value. The freight share in USD tells him
-- nothing on its own — 643 USD is cheap for 8 CBM and dear for 2.7. Per CBM is
-- the one figure that says whether a simulation is realistic, he now has two
-- real observations to judge it against, and the tool has never shown it.
-- Computed here, in Postgres, from the shipment's own lines.
--
-- ── WHAT DOES NOT CHANGE ────────────────────────────────────────────────────
--
-- "Cost today", the figure each simulated line is compared against, still
-- comes from v_skus: the newest batch that STILL HAS STOCK, falling back to
-- the newest batch ever received. It is not an average across arrivals and
-- must not become one. Two different questions live here and only one of them
-- is about pricing:
--
--   what did the stock I am selling today cost me?  -> the batch it came from,
--                                                      FIFO, which is the P&L
--   what will it cost to put it back on the shelf?  -> the newest arrival
--
-- A price has to cover the second. Pricing off the older, cheaper batch books
-- a paper profit that cannot buy the next container.

drop function if exists public.get_costing_defaults();

create or replace function public.get_costing_defaults(p_shipment_id uuid default null)
returns table (
  reference                   text,
  received_on                 date,
  rate_usd_to_mvr             numeric,
  rate_usd_to_idr             numeric,
  shared_container            boolean,
  container_size_hint         text,
  total_container_freight_usd numeric,
  freight_share_usd           numeric,
  customs_duty_mvr            numeric,
  mpl_charges_mvr             numeric,
  agent_fee_mvr               numeric,
  last_mile_mvr               numeric,
  insurance_mvr               numeric,
  other_mvr                   numeric,
  -- The two figures that let Ali judge the assumption rather than inherit it.
  cbm_total                   numeric,
  freight_mvr_per_cbm         numeric
)
language sql
stable
set search_path to 'public'
as $function$
  with pick as (
    select s.*
      from shipments s
     where s.rate_usd_to_mvr is not null
       and (p_shipment_id is null or s.id = p_shipment_id)
     order by coalesce(s.grn_confirmed_at, s.created_at) desc
     limit 1
  ),
  vol as (
    -- The volume that freight was actually spread over. Same basis
    -- confirm_grn apportions on, so the rate quoted here is the rate that
    -- produced the landed costs already in the ledger.
    select coalesce(sum(sl.qty_cartons * sl.cbm_per_carton), 0) as cbm
      from shipment_lines sl
      join pick p on p.id = sl.shipment_id
  )
  select p.reference,
         (p.grn_confirmed_at at time zone 'Indian/Maldives')::date,
         p.rate_usd_to_mvr, p.rate_usd_to_idr,
         coalesce(p.shared_container, false),
         p.container_size_hint,
         coalesce(p.total_container_freight_usd, 0),
         coalesce(p.my_freight_share_usd, 0),
         coalesce(p.customs_duty_mvr, 0),
         coalesce(p.mpl_charges_mvr, 0),
         coalesce(p.agent_fee_mvr, 0),
         coalesce(p.last_mile_mvr, 0),
         coalesce(p.insurance_mvr, 0),
         coalesce(p.other_mvr, 0),
         round(v.cbm, 2),
         case when v.cbm > 0
              then round(coalesce(p.my_freight_share_usd, 0) * p.rate_usd_to_mvr / v.cbm, 0)
         end
    from pick p cross join vol v;
$function$;

revoke execute on function public.get_costing_defaults(uuid) from public, anon;
grant  execute on function public.get_costing_defaults(uuid) to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_src text := regexp_replace(
    pg_get_functiondef('public.get_costing_defaults(uuid)'::regprocedure),
    '--[^\n]*', '', 'g');
begin
  if v_src !~ 'freight_mvr_per_cbm' then
    raise exception 'the simulator still cannot say what freight rate it is assuming';
  end if;
  if v_src !~ 'p_shipment_id' then
    raise exception 'the seed shipment cannot be chosen';
  end if;
  if to_regprocedure('public.get_costing_defaults()') is not null then
    raise exception 'the no-argument twin is back -- two versions of one answer';
  end if;
  if has_function_privilege('anon', 'public.get_costing_defaults(uuid)', 'execute') then
    raise exception 'anon can read the costing defaults';
  end if;
end $$;

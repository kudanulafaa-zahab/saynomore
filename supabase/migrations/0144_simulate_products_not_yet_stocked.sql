-- 0144 — Cost a product you do NOT stock yet.
--
-- Ali: "What if I want to test a product I don't currently have? The only
-- thing I'll know is the fob price. But I want to simulate everything
-- accurately before I make a decision to introduce a new product."
--
-- The sandbox could only ever re-price the catalogue: every line was
-- `join v_skus v on v.id = r.sku_id`, so a product with no SKU row simply
-- could not be costed. That makes it a re-pricing tool, not a buying tool —
-- and the decision that actually costs money is the one to bring something in
-- for the first time.
--
-- WHAT A NEW PRODUCT NEEDS, AND WHAT HE ACTUALLY HAS
--
-- Landed cost = FOB + CBM-apportioned freight + CBM-apportioned local charges
-- + duty-weighted duty. For a quoted product Ali has the FOB and the pack
-- configuration (both are on the supplier's quote). What he usually does NOT
-- have is the carton size — and that is the one input freight depends on.
--
-- Two things make that tractable rather than fatal:
--   1. All 31 SKUs sit in just FIVE distinct carton sizes (0.0160 to 0.0589
--      CBM). A new diaper almost certainly ships in a box he already handles,
--      so `get_carton_size_reference` hands the screen those five real boxes
--      with what is in them today. Picking "the same box as Xtra Kering M" is
--      a far better estimate than a guess, and changing the pick re-runs the
--      whole simulation — which IS the sensitivity analysis: if the verdict
--      does not move across all five boxes, he does not need to go and
--      measure. If it does, he should ask the supplier for dimensions before
--      committing. That is the honest use of CBM under the standing rule:
--      freight apportionment, yes; forensics, no.
--   2. Duty is 0% on Diapers, Liquid Detergent, Powder Detergent and
--      Dishwashing — every category he trades. So for his real decisions the
--      only volume-driven cost is freight.
--
-- THE NUMBER A BUYER ACTUALLY NEGOTIATES WITH
--
-- `max_fob_per_carton_usd` is reverse (target) costing, the standard FMCG
-- buying tool: given the price he believes he can sell at and the margin he
-- wants, what is the MOST he can pay the supplier per carton and still get
-- there? "Landed cost is 512" is an observation. "Do not pay more than USD
-- 11.40 a carton" is a decision he can take into a negotiation.
--
-- It is exact whenever duty is 0 (all four of his categories), because
-- freight and local charges do not move with FOB at all. With a non-zero duty
-- rate the duty pot is itself apportioned by FOB, so the figure is a close
-- first pass rather than an identity — the screen says so when it applies.
--
-- Nothing here writes. Still STABLE, still SECURITY INVOKER, still a
-- line-for-line mirror of confirm_grn's apportionment.

-- ── The five real boxes, for the "which box does it ship in?" picker ──────

create or replace function public.get_carton_size_reference()
returns table (
  length_cm    numeric,
  width_cm     numeric,
  height_cm    numeric,
  cbm_per_carton numeric,
  sku_count    integer,
  categories   text,
  example      text,
  min_units_per_carton integer,
  max_units_per_carton integer
)
language sql
stable
set search_path to 'public'
as $function$
  select
    s.carton_length_cm, s.carton_width_cm, s.carton_height_cm,
    round((s.carton_length_cm * s.carton_width_cm * s.carton_height_cm) / 1000000.0, 4),
    count(*)::integer,
    string_agg(distinct pc.name, ', '),
    -- Names the box after a SKU already in it, so the option reads "same box
    -- as Xtra Kering L" instead of "46 x 20 x 35". A detergent's variant
    -- display repeats its model name, so only append it when it adds anything.
    (array_agg(
       case when v.display_name is null or btrim(v.display_name) = btrim(m.name)
            then btrim(m.name)
            else btrim(m.name || ' ' || v.display_name) end
       order by s.internal_code))[1],
    min(s.pcs_per_pack * s.packs_per_carton)::integer,
    max(s.pcs_per_pack * s.packs_per_carton)::integer
  from skus s
  join variants v            on v.id = s.variant_id
  join product_models m      on m.id = v.model_id
  join product_categories pc on pc.id = m.category_id
  where s.is_active
    and s.carton_length_cm is not null
    and s.carton_width_cm  is not null
    and s.carton_height_cm is not null
  group by s.carton_length_cm, s.carton_width_cm, s.carton_height_cm
  order by 4;
$function$;

comment on function public.get_carton_size_reference() is
  'The distinct carton sizes actually in the catalogue, so a product that is '
  'not stocked yet can borrow a real box instead of a guessed CBM.';

revoke execute on function public.get_carton_size_reference() from public, anon;
grant  execute on function public.get_carton_size_reference() to authenticated, service_role;

-- ── The simulator, now able to cost something it has never seen ───────────
-- Return type changes (new columns), so this has to be dropped first.

drop function if exists public.simulate_landed_costs(jsonb, jsonb);

create function public.simulate_landed_costs(
  p_shipment jsonb,
  p_lines    jsonb
)
returns table (
  -- Stable handle for the row. For a catalogue line this is the sku_id as
  -- text; for a prospective one it is the key the screen sent. sku_id stays
  -- a real uuid or null, so nothing downstream can mistake a hypothetical
  -- product for a real SKU.
  line_key                  text,
  sku_id                    uuid,
  is_new                    boolean,
  brand_name                text,
  model_name                text,
  variant_display           text,
  category_name             text,
  category_sort_order       integer,
  qty_cartons               numeric,
  pcs_per_pack              integer,
  packs_per_carton          integer,
  fob_per_carton_used       numeric,
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
  -- What it costs to get ONE carton here, before anything is in it: freight
  -- plus local charges plus duty. Independent of the FOB, which is exactly
  -- why the max-FOB inversion below works.
  landing_cost_per_carton_mvr numeric,
  current_landed_per_piece_mvr numeric,
  delta_per_piece_mvr       numeric,
  selling_price_per_pack_mvr numeric,
  selling_price_per_carton_mvr numeric,
  simulated_margin_pct      numeric,
  current_margin_pct        numeric,
  target_margin_pct         numeric,
  price_for_target_pack_mvr numeric,
  price_basis               text,
  -- Reverse costing: the most he can pay per carton and still hit the margin
  -- at the assumed selling price. Null when there is no price or no margin to
  -- work back from.
  max_fob_per_carton_mvr    numeric,
  max_fob_per_carton_usd    numeric,
  -- How much room is left against the quoted FOB. Negative = the quote is
  -- already too expensive for the margin he wants.
  fob_headroom_pct          numeric,
  container_cbm_total       numeric,
  container_fill_pct        numeric,
  my_freight_share_usd      numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with lines_in as (
    select
      coalesce(nullif(l->>'key', ''), l->>'sku_id')               as line_key,
      (l->>'sku_id')::uuid                                       as sku_id,
      (l->'new_product')                                         as np,
      greatest(coalesce((l->>'qty_cartons')::numeric, 0), 0)     as qty,
      greatest(coalesce((l->>'cbm_per_carton')::numeric, 0), 0)  as cbm_per_carton,
      nullif(greatest(coalesce((l->>'fob_per_carton')::numeric, 0), 0), 0) as fob_ctn_in,
      nullif(greatest(coalesce((l->>'fob_per_pack')::numeric, 0), 0), 0)   as fob_pack_in,
      upper(coalesce(l->>'fob_currency', 'USD'))                 as fob_currency
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
    -- A line is valid if it names a real SKU or describes a prospective one.
    where (l->>'sku_id') is not null or (l->'new_product') is not null
  ),
  my_cbm as (select coalesce(sum(qty * cbm_per_carton), 0) as v from lines_in),
  ship as (
    select
      coalesce((p_shipment->>'rate_usd_to_mvr')::numeric, 0)   as fx_usd_mvr,
      coalesce((p_shipment->>'rate_usd_to_idr')::numeric, 0)   as fx_usd_idr,
      coalesce((p_shipment->>'shared_container')::boolean, false) as shared,
      nullif(coalesce((p_shipment->>'container_capacity_cbm')::numeric, 0), 0) as capacity_cbm,
      coalesce((p_shipment->>'total_container_freight_usd')::numeric, 0) as total_freight_usd,
      coalesce((p_shipment->>'freight_share_usd')::numeric, 0) as flat_freight_usd,
      coalesce((p_shipment->>'customs_duty_mvr')::numeric, 0)  as duty_mvr,
      ( coalesce((p_shipment->>'mpl_charges_mvr')::numeric, 0)
      + coalesce((p_shipment->>'agent_fee_mvr')::numeric,    0)
      + coalesce((p_shipment->>'last_mile_mvr')::numeric,    0)
      + coalesce((p_shipment->>'insurance_mvr')::numeric,    0)
      + coalesce((p_shipment->>'other_mvr')::numeric,        0) ) as local_mvr
  ),
  fx as (
    select s.*,
      case when s.fx_usd_idr > 0 then s.fx_usd_mvr / s.fx_usd_idr else 0 end as fx_idr_mvr,
      case
        when s.shared and s.capacity_cbm is not null and s.total_freight_usd > 0
          then s.total_freight_usd * ((select v from my_cbm) / s.capacity_cbm)
        else s.flat_freight_usd
      end as freight_usd
    from ship s
  ),
  -- Every attribute now resolves EITHER from the catalogue row or from the
  -- prospective-product payload. Nothing below this point knows the
  -- difference, so a hypothetical line is apportioned by the identical code
  -- path — there is no second costing engine to drift.
  calc as (
    select
      r.line_key,
      r.sku_id,
      (r.sku_id is null)                     as is_new,
      r.qty, r.cbm_per_carton, r.fob_currency,
      coalesce(v.brand_name,      r.np->>'brand_name')      as brand_name,
      coalesce(v.model_name,      r.np->>'name')            as model_name,
      coalesce(v.variant_display, r.np->>'variant_display') as variant_display,
      coalesce(v.category_name,   r.np->>'category_name')   as category_name,
      -- Prospective products sort after the catalogue unless told otherwise.
      coalesce(v.category_sort_order, (r.np->>'category_sort_order')::integer, 9999) as category_sort_order,
      greatest(coalesce(v.pcs_per_pack,     (r.np->>'pcs_per_pack')::integer,     1), 1) as pcs_per_pack,
      greatest(coalesce(v.packs_per_carton, (r.np->>'packs_per_carton')::integer, 1), 1) as packs_per_carton,
      -- No history for something never bought, so no "vs today" comparison.
      v.landed_per_piece_mvr         as cur_landed,
      v.actual_margin_pct            as cur_margin,
      coalesce(v.selling_price_per_pack_mvr,
               (r.np->>'target_price_per_pack_mvr')::numeric)   as sell_pack,
      coalesce(v.selling_price_per_carton_mvr,
               (r.np->>'target_price_per_carton_mvr')::numeric) as sell_ctn,
      coalesce(v.sellable_units,
               case when r.np->'sellable_units' is not null
                    then array(select jsonb_array_elements_text(r.np->'sellable_units'))
                    else array['pack','carton'] end)            as sellable_units,
      coalesce(v.duty_rate_pct, (r.np->>'duty_rate_pct')::numeric, 0) as duty_rate_pct,
      coalesce(v.target_margin_pct, (r.np->>'target_margin_pct')::numeric) as target_margin_pct,
      coalesce(r.fob_ctn_in,
               r.fob_pack_in * greatest(coalesce(v.packs_per_carton,
                                                 (r.np->>'packs_per_carton')::integer, 1), 1),
               0) as fob_per_carton,
      r.qty * r.cbm_per_carton as cbm_total,
      r.qty * coalesce(r.fob_ctn_in,
                       r.fob_pack_in * greatest(coalesce(v.packs_per_carton,
                                                         (r.np->>'packs_per_carton')::integer, 1), 1),
                       0) *
        case r.fob_currency
          when 'IDR' then (select fx_idr_mvr from fx)
          when 'USD' then (select fx_usd_mvr from fx)
          else 1
        end as fob_total
    from lines_in r
    left join v_skus v on v.id = r.sku_id
  ),
  tot as (
    select nullif(sum(c.cbm_total), 0)                   as total_cbm,
           nullif(sum(c.fob_total * c.duty_rate_pct), 0) as total_duty_weight
    from calc c
  ),
  ap as (
    select c.*,
      coalesce(c.cbm_total / t.total_cbm, 0)                                as cbm_share,
      coalesce(c.cbm_total / t.total_cbm, 0) * (s.freight_usd * s.fx_usd_mvr) as app_freight,
      coalesce(c.cbm_total / t.total_cbm, 0) * s.local_mvr                  as app_local,
      case
        when t.total_duty_weight is not null
          then (c.fob_total * c.duty_rate_pct) / t.total_duty_weight * s.duty_mvr
        else coalesce(c.cbm_total / t.total_cbm, 0) * s.duty_mvr
      end                                                                   as app_duty
    from calc c, tot t, fx s
  ),
  landed as (
    select a.*, (a.fob_total + a.app_freight + a.app_local + a.app_duty) as landed_total
    from ap a
  ),
  per as (
    select l.*,
      nullif(l.qty, 0)                                        as q_ctn,
      nullif(l.qty * l.packs_per_carton, 0)                   as q_pack,
      nullif(l.qty * l.packs_per_carton * l.pcs_per_pack, 0)  as q_piece,
      -- Margin is taken against the unit actually sold (0139), and the same
      -- unit drives the reverse costing below.
      case when 'pack' = any(l.sellable_units) and l.sell_pack > 0 then 'pack'
           when l.sell_ctn > 0 then 'carton' end               as price_unit,
      coalesce(l.target_margin_pct, l.cur_margin)              as margin_used
    from landed l
  ),
  fin as (
    select p.*,
      (p.app_freight + p.app_local + p.app_duty) / p.q_ctn     as landing_per_ctn,
      -- REVERSE COSTING. Required landed cost per carton to hit the margin at
      -- the assumed price, minus what it costs to land an empty carton,
      -- leaves the most the goods themselves may cost.
      case
        when p.margin_used > 0 and p.margin_used < 100 then
          case p.price_unit
            when 'pack'   then p.sell_pack * p.packs_per_carton * (1 - p.margin_used / 100.0)
            when 'carton' then p.sell_ctn * (1 - p.margin_used / 100.0)
          end
      end                                                      as required_landed_per_ctn
    from per p
  )
  select
    f.line_key,
    f.sku_id,
    f.is_new,
    f.brand_name, f.model_name, f.variant_display,
    f.category_name, f.category_sort_order,
    f.qty, f.pcs_per_pack, f.packs_per_carton,
    round(f.fob_per_carton, 2),
    round(f.fob_total, 2),
    round(f.cbm_total, 4),
    round(f.cbm_share * 100, 2),
    round(f.app_freight, 2),
    round(f.app_local, 2),
    round(f.app_duty, 2),
    round(f.landed_total, 2),
    round(f.landed_total / f.q_ctn,   2),
    round(f.landed_total / f.q_pack,  2),
    round(f.landed_total / f.q_piece, 4),
    round(f.landing_per_ctn, 2),
    round(f.cur_landed, 4),
    case when f.cur_landed is not null
         then round(f.landed_total / f.q_piece - f.cur_landed, 4) end,
    round(f.sell_pack, 2),
    round(f.sell_ctn, 2),
    case
      when f.price_unit = 'pack'
        then round((1 - (f.landed_total / f.q_pack) / f.sell_pack) * 100, 2)
      when f.price_unit = 'carton'
        then round((1 - (f.landed_total / f.q_ctn) / f.sell_ctn) * 100, 2)
    end,
    round(f.cur_margin, 2),
    round(f.target_margin_pct, 2),
    case when f.margin_used > 0 and f.margin_used < 100
         then round((f.landed_total / f.q_pack) / (1 - f.margin_used / 100.0), 2) end,
    case when f.target_margin_pct is not null then 'target'
         when f.cur_margin is not null        then 'current'
         else null end,
    -- Never report a negative ceiling as if it were a price: if landing the
    -- carton already costs more than the margin allows, the answer is 0 and
    -- the headroom below says how far past the line the quote is.
    case when f.required_landed_per_ctn is not null
         then round(greatest(f.required_landed_per_ctn - f.landing_per_ctn, 0), 2) end,
    case when f.required_landed_per_ctn is not null and (select fx_usd_mvr from fx) > 0
         then round(greatest(f.required_landed_per_ctn - f.landing_per_ctn, 0)
                    / (select fx_usd_mvr from fx), 2) end,
    case when f.required_landed_per_ctn is not null and f.fob_per_carton > 0
         then round(((f.required_landed_per_ctn - f.landing_per_ctn)
                     / nullif(f.fob_per_carton *
                         case f.fob_currency
                           when 'IDR' then (select fx_idr_mvr from fx)
                           when 'USD' then (select fx_usd_mvr from fx)
                           else 1 end, 0) - 1) * 100, 1) end,
    round((select v from my_cbm), 4),
    case when (select capacity_cbm from fx) is not null
         then round((select v from my_cbm) / (select capacity_cbm from fx) * 100, 1) end,
    round((select freight_usd from fx), 2)
  from fin f
  order by f.category_sort_order nulls last, f.brand_name nulls first, f.model_name, f.variant_display;
$function$;

comment on function public.simulate_landed_costs(jsonb, jsonb) is
  'Whole-shipment landed-cost sandbox, mirroring confirm_grn''s apportionment. '
  'A line may name an existing SKU or describe a product not stocked yet '
  '(new_product), so a first-time buy can be costed before it is committed. '
  'Returns the reverse-costed maximum FOB per carton for the target margin.';

revoke execute on function public.simulate_landed_costs(jsonb, jsonb) from public, anon;
grant  execute on function public.simulate_landed_costs(jsonb, jsonb) to authenticated, service_role;

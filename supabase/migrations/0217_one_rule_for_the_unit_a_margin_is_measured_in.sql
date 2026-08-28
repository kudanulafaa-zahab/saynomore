-- 0217 — one rule for the unit a margin is measured in, and one for the price.
--
-- Ali, 2026-08-28, on the app as a whole:
--   *"It's getting too complicated... poorly designed. Convene proper experts
--    and focus on giving a professional app. Not adhoc corrections."*
--
-- This is stage 1 of that work, and it is a real defect rather than tidying.
--
-- ── TWO SCREENS, TWO ANSWERS, ONE PRODUCT ──────────────────────────────────
--
-- Asked what margin Sosoft earns after SH-2026-002, the app said **9.6%** in
-- the Price Book and **10.4%** everywhere else. Both were arithmetically
-- right; they were answering different questions, and neither said which:
--
--   Price Book       measured per CARTON, because it read the CATEGORY's
--                    `default_sellable_units` -- and because any brand with
--                    `mixed_carton_pieces` was forced to carton outright.
--   Everything else  measured per BOTTLE, from the PRODUCT's own
--                    `sellable_units`.
--
-- The category default is not what the product sells. CLAUDE.md has said so
-- since 0139: *"`skus.sellable_units` is the only input."* The Price Book was
-- the one door that never got the guard. And the mixed-carton override dates
-- from when Sosoft sold one way; since 0208 it sells three, so "it is a mixed
-- carton brand, therefore price it by the carton" stopped being true.
--
-- ── AND TWO DEFINITIONS OF "THE PRICE" ─────────────────────────────────────
--
-- The same six-row check turned up X-Tra Kering NB/S reading **45.0%** in the
-- Price Book and **blank** in Products. That is the second half of the same
-- disease. `v_skus.actual_margin_pct` re-derived the price from the FIXED
-- columns only, so a product priced from its target margin -- which the app
-- quotes, sells and invoices at MVR 218 a pack -- had no margin at all. The
-- view was computing the price correctly three lines above and then ignoring
-- its own answer.
--
-- ── THE FIX IS A SHARED FUNCTION, NOT TWO CAREFUL EDITS ────────────────────
--
-- Editing both places to agree today leaves two places to disagree tomorrow.
-- `margin_unit()` is now the single definition, and both callers read it:
--
--     the smaller selling unit if the product sells one, otherwise the carton
--
-- which is the rule the sale sheets, the price review and the promo advisor
-- have always used. The guard at the bottom asserts BOTH callers reference the
-- function by name, so a future edit cannot quietly re-inline its own opinion.

-- ── The rule, once ─────────────────────────────────────────────────────────
-- Pure, IMMUTABLE, no SET clause: helpers_can_inline.test.sql enumerates the
-- catalogue and fails on a pure SQL helper that carries one, because the GUC
-- save and restore stops Postgres inlining the body. There is no identifier
-- here to resolve, so there is nothing for a search_path to protect.
create or replace function public.margin_unit(p_sellable_units text[])
returns text
language sql
immutable
as $function$
  select case
           when 'pack'   = any(coalesce(p_sellable_units, array['pack'])) then 'pack'
           when 'carton' = any(coalesce(p_sellable_units, array['pack'])) then 'carton'
           else 'piece'
         end;
$function$;

comment on function public.margin_unit(text[]) is
  'The unit a margin is measured in: the smaller selling unit if the product '
  'sells one, otherwise the carton. The ONLY input is the SKU''s own '
  'sellable_units - never the category default, which is a suggestion for new '
  'products and not a fact about this one.';

revoke execute on function public.margin_unit(text[]) from public, anon;
grant  execute on function public.margin_unit(text[]) to authenticated, service_role;

-- ── v_skus: the price it quotes is the price it measures against ───────────
-- Restructured through a CTE so each price is written ONCE and the margin
-- reads it, instead of the margin re-deriving its own from the fixed columns
-- and disagreeing with the figure printed beside it.
create or replace view public.v_skus as
with latest_landed as (
  select distinct on (x.sku_id) x.sku_id, x.landed_per_piece_mvr
    from (
      select bs.sku_id, bs.landed_per_piece_mvr, bs.received_at, 0 as src
        from public.v_batch_stock bs
       where bs.qty_pieces_remaining > 0
      union all
      select ib.sku_id, ib.landed_per_piece_mvr, ib.received_at, 1 as src
        from public.inventory_batches ib
       where ib.landed_per_piece_mvr is not null
    ) x
   order by x.sku_id, x.src, x.received_at desc
),
priced as (
  select
    s.id, s.variant_id, s.internal_code, s.supplier_barcode,
    s.pcs_per_pack, s.packs_per_carton,
    s.pcs_per_pack * s.packs_per_carton as pcs_per_carton,
    s.carton_length_cm, s.carton_width_cm, s.carton_height_cm, s.carton_weight_kg,
    s.cbm_per_carton, s.is_active, s.notes, s.created_at, s.updated_at,
    s.target_margin_pct, s.fixed_selling_price_mvr,
    s.fixed_price_per_pack_mvr, s.fixed_price_per_carton_mvr,
    ll.landed_per_piece_mvr,
    case
      when s.fixed_selling_price_mvr is not null then round(s.fixed_selling_price_mvr, 0)
      when s.target_margin_pct is not null and ll.landed_per_piece_mvr is not null
        then round(ll.landed_per_piece_mvr / (1::numeric - s.target_margin_pct / 100.0), 0)
      else null::numeric
    end as selling_price_per_piece_mvr,
    case
      when s.fixed_price_per_pack_mvr is not null then round(s.fixed_price_per_pack_mvr, 0)
      when s.fixed_selling_price_mvr is not null then round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric, 0)
      when s.target_margin_pct is not null and ll.landed_per_piece_mvr is not null
        then round(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric / (1::numeric - s.target_margin_pct / 100.0), 0)
      else null::numeric
    end as selling_price_per_pack_mvr,
    case
      when s.fixed_price_per_carton_mvr is not null then round(s.fixed_price_per_carton_mvr, 0)
      when s.fixed_selling_price_mvr is not null then round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric, 0)
      when s.target_margin_pct is not null and ll.landed_per_piece_mvr is not null
        then round(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric / (1::numeric - s.target_margin_pct / 100.0), 0)
      else null::numeric
    end as selling_price_per_carton_mvr,
    v.attributes, v.display_name as variant_display,
    m.id as model_id, m.name as model_name,
    b.id as brand_id, b.name as brand_name,
    pc.id as category_id, pc.name as category_name,
    pc.unit_uom, pc.cost_basis,
    concat_ws(' > '::text, b.name, m.name, v.display_name,
              (s.pcs_per_pack || 'x'::text) || s.packs_per_carton) as full_path,
    s.sellable_units, pc.default_sellable_units, pc.duty_rate_pct,
    b.mixed_carton_pieces, pc.sort_order as category_sort_order
  from public.skus s
    join public.variants v on v.id = s.variant_id
    join public.product_models m on m.id = v.model_id
    join public.brands b on b.id = m.brand_id
    join public.product_categories pc on pc.id = m.category_id
    left join latest_landed ll on ll.sku_id = s.id
)
select
  p.id, p.variant_id, p.internal_code, p.supplier_barcode,
  p.pcs_per_pack, p.packs_per_carton, p.pcs_per_carton,
  p.carton_length_cm, p.carton_width_cm, p.carton_height_cm, p.carton_weight_kg,
  p.cbm_per_carton, p.is_active, p.notes, p.created_at, p.updated_at,
  p.target_margin_pct, p.fixed_selling_price_mvr,
  p.fixed_price_per_pack_mvr, p.fixed_price_per_carton_mvr,
  p.landed_per_piece_mvr,
  p.selling_price_per_piece_mvr, p.selling_price_per_pack_mvr, p.selling_price_per_carton_mvr,
  -- THE PRICE THIS APP ACTUALLY QUOTES, against the unit it actually sells.
  -- Both halves changed: it used to rebuild the price from the fixed columns
  -- (blanking every target-margin product) and to pick the unit from its own
  -- inline CASE (which drifted from the Price Book's).
  -- SCALED UP TO THE UNIT, NOT DOWN TO THE PIECE, so this is byte-identical to
  -- the arithmetic in get_price_book. Dividing the price by the pack size here
  -- and multiplying the cost by it there is the same sum on paper and not
  -- always the same numeric: division truncates to a scale, and the two paths
  -- can land either side of a rounding boundary. Two screens disagreeing by
  -- 0.1 of a point is the bug this migration exists to end, so the expression
  -- is shaped to make it impossible rather than unlikely.
  case
    when p.landed_per_piece_mvr is null or p.landed_per_piece_mvr <= 0 then null::numeric
    else (
      select round((q.unit_price - p.landed_per_piece_mvr * q.pieces) / q.unit_price * 100, 1)
        from (
          select case public.margin_unit(p.sellable_units)
                   when 'pack'   then p.pcs_per_pack::numeric
                   when 'carton' then p.pcs_per_carton::numeric
                   else 1::numeric
                 end as pieces,
                 case public.margin_unit(p.sellable_units)
                   when 'pack'   then p.selling_price_per_pack_mvr
                   when 'carton' then p.selling_price_per_carton_mvr
                   else p.selling_price_per_piece_mvr
                 end as unit_price
        ) q
       where q.unit_price is not null and q.unit_price > 0
    )
  end as actual_margin_pct,
  p.attributes, p.variant_display,
  p.model_id, p.model_name, p.brand_id, p.brand_name,
  p.category_id, p.category_name, p.unit_uom, p.cost_basis, p.full_path,
  p.sellable_units, p.default_sellable_units, p.duty_rate_pct,
  p.mixed_carton_pieces, p.category_sort_order
from priced p;

-- ── get_price_book: the same rule, read from the same place ────────────────
create or replace function public.get_price_book()
returns table (
  sku_id uuid, brand_name text, category_name text, category_sort_order integer,
  model_name text, variant_display text, internal_code text,
  pcs_per_pack integer, packs_per_carton integer, trade_unit text,
  landed_cost_mvr numeric, price_mvr numeric, profit_mvr numeric,
  margin_pct numeric, target_margin_pct numeric, flag text
)
language sql
security definer
set search_path to ''
as $function$
  -- The `last_landed` CTE that used to sit here was dead code AND a second
  -- opinion: v_skus.landed_per_piece_mvr already falls back to the newest batch
  -- of any kind, so the coalesce below it never fired. A fallback that cannot
  -- run is not a safety net; it is a second definition waiting to diverge.
  with base as (
    select
      s.id, s.brand_name, s.category_name, s.category_sort_order,
      s.model_name, s.variant_display, s.internal_code,
      s.pcs_per_pack, s.packs_per_carton, s.pcs_per_carton,
      s.landed_per_piece_mvr,
      s.selling_price_per_piece_mvr, s.selling_price_per_pack_mvr, s.selling_price_per_carton_mvr,
      s.target_margin_pct,
      -- ONE RULE, READ NOT RESTATED. This was `default_sellable_units` (the
      -- CATEGORY's suggestion for new products) with an override forcing any
      -- mixed-carton brand to the carton -- which is how five Sosoft colours
      -- read 9.6% here and 10.4% on every other screen.
      public.margin_unit(s.sellable_units) as trade_unit
    from public.v_skus s
    where s.is_active
  ),
  unitised as (
    select b.*,
      case b.trade_unit
        when 'carton' then b.landed_per_piece_mvr * b.pcs_per_carton
        when 'pack'   then b.landed_per_piece_mvr * b.pcs_per_pack
        else b.landed_per_piece_mvr
      end as cost,
      case b.trade_unit
        when 'carton' then b.selling_price_per_carton_mvr
        when 'pack'   then b.selling_price_per_pack_mvr
        else b.selling_price_per_piece_mvr
      end as price
    from base b
  )
  select
    id, brand_name, category_name, category_sort_order, model_name, variant_display, internal_code,
    pcs_per_pack, packs_per_carton, trade_unit,
    round(cost, 2),
    round(price, 2),
    case when price is not null and cost is not null then round(price - cost, 2) else null end,
    case when price > 0 and cost is not null then round((price - cost) / price * 100, 1) else null end,
    target_margin_pct,
    case
      when cost is null then 'no_cost'
      when price is null or price = 0 then 'no_price'
      when price - cost < 0 then 'loss'
      when (price - cost) / price * 100 < 20 then 'thin'
      else 'ok'
    end
  from unitised
  order by brand_name, category_sort_order, model_name, variant_display;
$function$;

revoke execute on function public.get_price_book() from public, anon;
grant  execute on function public.get_price_book() to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_book text := pg_get_functiondef('public.get_price_book()'::regprocedure);
  v_view text := pg_get_viewdef('public.v_skus'::regclass, true);
  v_bad  text;
begin
  -- BOTH callers must READ the rule, not restate it. Asserting the outcome
  -- alone would pass on two inlined copies that happen to agree today.
  if v_book !~ 'margin_unit' then
    raise exception 'the Price Book still decides the margin unit by itself';
  end if;
  if v_view !~ 'margin_unit' then
    raise exception 'v_skus still decides the margin unit by itself';
  end if;
  if v_book ~ 'default_sellable_units' then
    raise exception 'the Price Book still reads the CATEGORY default instead of what the product sells';
  end if;

  -- AND THE OUTCOME, on real rows: no product may report one margin in the
  -- Price Book and another in v_skus. This is Ali's question stated as a fact
  -- about the answer. Skipped on an empty database.
  if exists (select 1 from public.skus limit 1) then
    select string_agg(pb.internal_code || ' (' || pb.margin_pct || ' vs ' || vs.actual_margin_pct || ')', ', ')
      into v_bad
      from public.get_price_book() pb
      join public.v_skus vs on vs.id = pb.sku_id
     where pb.margin_pct is distinct from vs.actual_margin_pct;
    if v_bad is not null then
      raise exception 'two screens still disagree about one margin: %', v_bad;
    end if;

    -- A margin measured in a unit the product does not sell is a number
    -- nobody can act on -- the same class 0139 and 0160 were about.
    select string_agg(pb.internal_code, ', ') into v_bad
      from public.get_price_book() pb
      join public.v_skus vs on vs.id = pb.sku_id
     where not (pb.trade_unit = any(vs.sellable_units));
    if v_bad is not null then
      raise exception 'the Price Book prices a unit these products do not sell: %', v_bad;
    end if;
  end if;

  if has_function_privilege('anon', 'public.margin_unit(text[])', 'execute')
     or has_function_privilege('anon', 'public.get_price_book()', 'execute') then
    raise exception 'anon can execute one of the pricing functions';
  end if;
end $$;

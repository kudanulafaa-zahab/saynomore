-- 0204 — the readiness report asks the SELL SHEET's question, not its own.
--
-- ── THE DEFECT, FOUND BY READING THE LIVE OUTPUT ────────────────────────────
--
-- 0202 shipped `get_setup_gaps` and the first thing it said on production was
-- wrong:
--
--     Mamypoko › Xtra Kering › NB/S
--     No price for a carton
--     Sells by the pack, but a carton cannot be quoted
--
-- Both halves are false. That SKU carries `target_margin_pct = 44.90`, and the
-- sell sheet quotes it at MVR 170 a pack and MVR 680 a carton — computed from
-- the target margin against its last known landed cost, exactly as v_skus has
-- always done. Nothing about it is unfinished.
--
-- 0202's own header claims it removes a second opinion about what a price is.
-- It removed one and introduced another: it asked "is a FIXED price stored?"
-- when the question that matters to Ali is "can a number be quoted today?" —
-- which is the question the sell sheet already answers.
--
-- The irony is the point. A helper called `price_per_unit`, written to stop two
-- engines disagreeing, was used to build a third engine that disagreed with
-- both. The lesson is not "be more careful": it is that a NEW report must READ
-- the existing answer rather than recompute it, however simple the recomputation
-- looks.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
--
-- get_setup_gaps now takes its prices from `v_skus.selling_price_per_pack_mvr`
-- and `selling_price_per_carton_mvr` — the exact figures the sell sheet shows.
-- If the sell sheet can quote it, the product is priced; if it cannot, it is
-- not. There is no third rule.
--
-- `price_per_unit` is UNCHANGED and stays where it belongs: inside
-- get_pricing_health, which asks the different and equally valid question "have
-- you SET a price for the unit you sell", and where migration 0162's guard about
-- inferred pack prices must keep holding.
--
-- Everything else — no_carton_size, no_cost, the trade-unit wording, the
-- ordering — is untouched.
--
-- ── AND WHAT IT SAYS NOW ────────────────────────────────────────────────────
--
-- On production this takes the report from eight rows to seven, and the row it
-- removes is the one that was wrong. Skin Comfort XXL correctly remains: 32 per
-- pack with only a per-piece figure and no target margin, so the sell sheet
-- cannot quote it either — 7 cartons that genuinely cannot be sold.

create or replace function public.get_setup_gaps()
returns table (
  sku_id       uuid,
  internal_code text,
  full_path    text,
  gap          text,   -- machine-readable: no_price | no_carton_price | no_carton_size | no_cost
  headline     text,   -- one plain sentence, already in trade units
  blocks       text,   -- what it stops him doing
  stock_label  text,   -- "6 tubs", "14 cartons" — NEVER a piece count
  stock_pieces integer,-- for ordering only; never displayed
  severity     integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with stock as (
    select bs.sku_id, sum(bs.qty_pieces_remaining)::integer as pieces
      from v_batch_stock bs
     where bs.qty_pieces_remaining > 0
     group by bs.sku_id
  ),
  cost as (
    select distinct on (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
      from v_batch_stock bs
     where bs.qty_pieces_remaining > 0
     order by bs.sku_id, bs.received_at desc
  ),
  base as (
    select
      s.id, s.internal_code,
      concat_ws(' › ', b.name, m.name, v.display_name) as full_path,
      coalesce(st.pieces, 0) as pieces,
      c.landed_per_piece_mvr as landed,
      s.sellable_units, s.pcs_per_pack, s.packs_per_carton,
      pc.unit_uom,
      coalesce(s.cbm_per_carton, 0) as cbm,
      -- THE SELL SHEET'S OWN NUMBERS. Not price_per_unit, not a fresh CASE
      -- expression — the very columns the Sales screen quotes from, so this
      -- report cannot contradict what a customer would be charged. They already
      -- account for a fixed price, a per-piece figure on a single item, and a
      -- target margin applied to the last known landed cost.
      case when 'pack'   = any(s.sellable_units) then vs.selling_price_per_pack_mvr   end as price_pack,
      case when 'carton' = any(s.sellable_units) then vs.selling_price_per_carton_mvr end as price_carton
    from skus s
    join v_skus vs        on vs.id = s.id
    join variants v       on v.id = s.variant_id
    join product_models m on m.id = v.model_id
    join brands b         on b.id = m.brand_id
    join product_categories pc on pc.id = m.category_id
    left join stock st on st.sku_id = s.id
    left join cost  c  on c.sku_id  = s.id
    where s.is_active
  ),
  labelled as (
    select *,
      qty_in_trade_units(pieces, pcs_per_pack, packs_per_carton, unit_uom, sellable_units) as stock_label,
      unit_noun(unit_uom) as noun
      from base
  )
  -- NOTHING CAN BE QUOTED, in any unit it sells in.
  select id, internal_code, full_path, 'no_price',
         'No selling price yet',
         case when pieces > 0
              then 'Cannot be sold — there is ' || stock_label || ' waiting'
              else 'Cannot be sold' end,
         stock_label, pieces,
         case when pieces > 0 then 0 else 2 end
    from labelled
   where price_pack is null and price_carton is null

  union all

  -- SOLD BY THE CARTON, AND ONLY THE CARTON CANNOT BE QUOTED. Narrower than
  -- "no price", so it is a separate row rather than lumped in — and it now
  -- requires a real pack price, which is what makes the sentence true.
  select id, internal_code, full_path, 'no_carton_price',
         'No price for a carton',
         'Sells by the ' || noun || ', but a carton cannot be quoted',
         stock_label, pieces, 1
    from labelled
   where 'carton' = any(sellable_units)
     and price_carton is null
     and price_pack is not null

  union all

  -- NO CARTON SIZE. Hard rule 4: a zero-CBM shipment line blocks the GRN. The
  -- day a container carrying this arrives, receiving stops.
  select id, internal_code, full_path, 'no_carton_size',
         'No carton measurements',
         'A shipment carrying it cannot be received — freight has nothing to split on',
         stock_label, pieces, 1
    from labelled
   where cbm <= 0

  union all

  -- STOCK WITH NO LANDED COST. Margin is unknowable, so every price is a guess.
  select id, internal_code, full_path, 'no_cost',
         'No landed cost recorded',
         'There is ' || stock_label || ' in the godown with no cost, so margin cannot be checked',
         stock_label, pieces, 1
    from labelled
   where pieces > 0 and landed is null

  order by 9, 8 desc, 3;
$$;

-- CREATE OR REPLACE keeps grants, but they are restated rather than assumed —
-- and both revokes are issued, because REVOKE FROM anon and REVOKE FROM PUBLIC
-- are different revokes (0203).
revoke execute on function public.get_setup_gaps() from public, anon;
grant  execute on function public.get_setup_gaps() to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_def  text;
  v_anon boolean;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_setup_gaps' and p.prokind = 'f';
  if v_def !~ 'selling_price_per_pack_mvr' then
    raise exception 'get_setup_gaps is still deciding for itself what counts as a price';
  end if;
  -- Matches a CALL — the name followed by an open paren — not the bare word.
  -- The first version looked for 'price_per_unit' anywhere and refused this very
  -- migration, because the new body's comment explains what it deliberately does
  -- NOT use. A guard that a comment can trip is a guard that will one day be
  -- silenced by deleting the comment, which is the wrong repair.
  if v_def ~ 'price_per_unit\s*\(' then
    raise exception 'get_setup_gaps still recomputes a price instead of reading the sell sheet';
  end if;
  select has_function_privilege('anon', 'public.get_setup_gaps()', 'execute') into v_anon;
  if v_anon then raise exception 'anon can execute get_setup_gaps'; end if;
end $$;

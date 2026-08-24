-- 0202 — one opinion about whether a product is ready, and a list of the ones
-- that are not.
--
-- Ali, 2026-08-24: *"Solve the problems professionally so it doesn't repeat and
-- I will be able to add any new product without coming back and debugging every
-- time."*
--
-- ── THE REQUIREMENT, WRITTEN BEFORE THE CODE ────────────────────────────────
--
-- R1  A product that is ready to sell is never reported as unready, and one
--     that is NOT ready says so before it costs money.
--
--     AC1  Margin Watch and the sell sheet give the same answer to "does this
--          product have a price". Today they do not.
--     AC2  Every product with a gap that will block a sale, a purchase or a
--          receipt is listed, in the unit it trades in.
--     AC3  The list is empty when nothing is wrong.
--     AC4  Every state a new product can be created in is covered, so none is
--          discovered at the till.
--
-- ── PART 1: TWO ENGINES DISAGREEING ABOUT A PRICE ───────────────────────────
--
-- The five Body Shop tubs read, on the same row, at the same moment:
--
--     the sell sheet (v_skus)        MVR 380 a tub
--     Margin Watch (get_pricing_health)   NO PRICE
--
-- v_skus knows that when ONE PACK IS ONE ITEM (`pcs_per_pack = 1`), the
-- per-piece figure and the per-pack figure are the same money, and derives one
-- from the other. get_pricing_health demanded the number sit on
-- `fixed_price_per_pack_mvr` specifically and called the product unpriced
-- otherwise.
--
-- This is not a Body Shop problem. Since 0201, EVERY single-item product — every
-- tub, jar, bar, tube and bedding set — is born on the `pack` tier with its
-- price on the per-piece column, which is where the New SKU sheet has always
-- put a single item's price. So every one of them would have been reported as
-- unpriced for ever. That is the defect that would have brought Ali back.
--
-- FIXED NARROWLY, AND THE NARROWNESS IS THE POINT. `price_per_unit` below is
-- the one place that answers "what does a customer pay for one X", and it falls
-- back to the per-piece column ONLY when one piece IS one unit. Migration 0162
-- deliberately made a 32-per-pack diaper carrying only a per-piece figure read
-- "no price", because 7.19 x 32 is an inference and not a price anyone set —
-- that guard is untouched, and its test still passes. The two engines still
-- differ for a 32-pack, and should: "what can I charge today" and "have you set
-- a pack price" are different questions.
--
-- WHAT IS DELIBERATELY NOT DONE: the per-piece column is NOT cleaned up. 34 of
-- 36 SKUs carry a per-piece figure beside a real pack price, and CLAUDE.md names
-- two reasons that is correct — mixed-carton fills and competitor comparison,
-- where per-piece is the only comparable unit. A constraint forbidding it was
-- considered and rejected after checking the data, which is the only reason the
-- rejection is trustworthy.
--
-- ── PART 2: THE GAP NOBODY CAN SEE ──────────────────────────────────────────
--
-- get_pricing_health only looks at products that HAVE STOCK, because its job is
-- the money sitting in the godown. So X-Tra Kering NB/S — no price on any unit,
-- none at all — is invisible to it, and stays invisible until the day a carton
-- lands and someone tries to sell it.
--
-- Five Body Shop tubs have no carton dimensions. Hard rule 4: a zero-CBM
-- shipment line BLOCKS the GRN. Nothing says so until the container is on the
-- water and the receipt will not go through.
--
-- `get_setup_gaps()` answers the question the catalogue could not: "which
-- products are not finished, and what will that stop me doing?" It is the
-- master-data completeness check every ERP has, and it is why a new product no
-- longer needs debugging — the app says what is missing, at the moment it is
-- missing, in packs and cartons.

-- ── THE ONE DEFINITION ──────────────────────────────────────────────────────
-- IMMUTABLE and carrying NO `SET` clause, deliberately: 0197 established that
-- Postgres refuses to inline any function with a SET, and this one is called
-- per row from a view. It reads no tables, so there is no search_path to pin
-- and nothing for a search_path attack to reach.
create or replace function public.price_per_unit(
  p_fixed_this_unit numeric,   -- the price set for this unit, if any
  p_fixed_per_piece numeric,   -- the per-piece figure
  p_pieces_in_unit  integer    -- how many pieces make one of this unit
) returns numeric
language sql
immutable
parallel safe
as $$
  -- A price set for the unit itself always wins: it is what Ali typed.
  --
  -- THE FALLBACK IS ONLY LEGITIMATE WHEN ONE PIECE IS ONE UNIT, and getting
  -- this wrong in the obvious direction would have quietly undone a money
  -- guard. The first version of this function scaled the per-piece figure by
  -- the pack size — coalesce(this_unit, per_piece * pieces_in_unit) — because
  -- that is what v_skus does for the sell sheet. Migration 0162 exists
  -- precisely to stop that being treated as a price: a Skin Comfort XXL
  -- carrying only MVR 7.19 per piece has no pack price Ali ever set, and
  -- 7.19 x 32 is an inference, not a decision. 0162's own test asserts that
  -- product still reads "no price", and it is right to.
  --
  -- When p_pieces_in_unit = 1 there is no inference: the per-piece column and
  -- the per-unit column are the SAME NUMBER for the SAME thing. That is the
  -- single-item case — every tub, jar, bar and bedding set — and it is the only
  -- one this fallback covers.
  --
  -- So the sell sheet and Margin Watch still answer differently for a 32-pack
  -- diaper, and that is correct: "what can I charge today" and "have you set a
  -- pack price" are different questions. They must agree only where the two
  -- numbers are the same number, and that is what this enforces.
  select coalesce(
    p_fixed_this_unit,
    case when p_pieces_in_unit = 1 then p_fixed_per_piece end
  );
$$;

-- Locked down like every other pure helper here (unit_noun, qty_in_trade_units,
-- stock_signed_delta all carry exactly this ACL). It reads no table, so anon
-- executing it could leak nothing — but a function whose grants differ from its
-- neighbours' for no stated reason is how the next audit finds a hole that
-- turns out to be deliberate, or a deliberate grant that turns out to be a hole.
--
-- BOTH REVOKES ARE NEEDED, AND THEY ARE NOT THE SAME REVOKE. This is the exact
-- bug-class CLAUDE.md rule 9 was written about — fixing one instance and not
-- sweeping the surface. The first version of this file revoked PUBLIC and anon
-- from get_setup_gaps and only PUBLIC from here, and the mismatch survived
-- local testing because the two grants come from different places:
--
--   PUBLIC   Postgres's own default on every new function.
--   anon     an EXPLICIT grant, from Supabase's `alter default privileges in
--            schema public grant execute on functions to anon, authenticated,
--            service_role`. Revoking PUBLIC does nothing to it.
--
-- The local stack does not carry that default-privileges setting, so locally
-- one revoke looked like enough and the guard passed. On production it did not,
-- and the guard at the foot of this file refused the migration. That is the
-- whole argument for asking has_function_privilege instead of trusting that a
-- REVOKE statement ran.
revoke execute on function public.price_per_unit(numeric, numeric, integer) from public;
revoke execute on function public.price_per_unit(numeric, numeric, integer) from anon;
grant  execute on function public.price_per_unit(numeric, numeric, integer) to authenticated, service_role;

comment on function public.price_per_unit(numeric, numeric, integer) is
  'What a customer pays for ONE unit (pack or carton). The single definition — '
  'v_skus and get_pricing_health must both use it, or they will disagree about '
  'whether a product has a price, as they did until migration 0202.';

-- ── PART 1: get_pricing_health STOPS INVENTING A SECOND ANSWER ──────────────
--
-- Derived from the live definition by exact substitution rather than retyped.
-- The function is ~90 lines of margin arithmetic and retyping it to change two
-- expressions is ninety chances to alter one silently — and a wrong margin does
-- not fail, it just misprices. Same discipline as 0189 and 0199: every
-- substitution must actually match, or the migration raises.
do $$
declare
  v_src text;
  v_new text;
  v_old text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_pricing_health' and p.prokind = 'f';
  if v_src is null then
    raise exception 'get_pricing_health not found — nothing to rewrite';
  end if;
  v_new := v_src;

  v_old := 'CASE WHEN ''pack''   = ANY(s.sellable_units)' || E'\n' ||
           '           THEN s.fixed_price_per_pack_mvr   END AS fix_pack,';
  if position(v_old in v_new) = 0 then
    raise exception 'the fix_pack expression was not found — re-read the function before editing this migration';
  end if;
  v_new := replace(v_new, v_old,
    'CASE WHEN ''pack''   = ANY(s.sellable_units)' || E'\n' ||
    '           THEN public.price_per_unit(s.fixed_price_per_pack_mvr,' || E'\n' ||
    '                                      s.fixed_selling_price_mvr, s.pcs_per_pack) END AS fix_pack,');

  v_old := 'CASE WHEN ''carton'' = ANY(s.sellable_units)' || E'\n' ||
           '           THEN s.fixed_price_per_carton_mvr END AS fix_carton,';
  if position(v_old in v_new) = 0 then
    raise exception 'the fix_carton expression was not found — re-read the function before editing this migration';
  end if;
  v_new := replace(v_new, v_old,
    'CASE WHEN ''carton'' = ANY(s.sellable_units)' || E'\n' ||
    '           THEN public.price_per_unit(s.fixed_price_per_carton_mvr,' || E'\n' ||
    '                                      s.fixed_selling_price_mvr,' || E'\n' ||
    '                                      s.pcs_per_pack * s.packs_per_carton) END AS fix_carton,');

  -- ── AND IT RETURNS THE UNIT WORD, so Margin Watch stops guessing ─────────
  --
  -- `suggestionLabel` in margin-watch.tsx prints "MVR 400/pack" and — on a
  -- branch that is dead only because no SKU sells by the piece today — "/pc".
  -- Margin Watch is the screen that will report on every product Ali adds from
  -- now on, so once single items live on the pack tier it would tell him his
  -- body butter should be priced "MVR 400/pack". A tub is not a pack, and a
  -- piece count must never reach him at all (CLAUDE.md, the units rule).
  --
  -- The UI cannot fix that from what it is given: get_pricing_health returns no
  -- unit_uom, so there is nothing for containerLabel to read. Rather than have
  -- the screen infer a noun — the mistake five other files made — the function
  -- hands over the one fact needed to name it.
  v_old := 'suggested_carton_mvr numeric, status text)';
  if position(v_old in v_new) = 0 then
    raise exception 'the RETURNS TABLE tail was not found';
  end if;
  v_new := replace(v_new, v_old, 'suggested_carton_mvr numeric, status text, unit_uom text)');

  v_old := '      s.sellable_units' || E'\n' || '    FROM skus s';
  if position(v_old in v_new) = 0 then
    raise exception 'the base select tail was not found';
  end if;
  v_new := replace(v_new, v_old,
    '      s.sellable_units,' || E'\n' ||
    '      pc.unit_uom' || E'\n' ||
    '    FROM skus s');

  -- The category join goes AFTER product_models, not straight after `FROM skus
  -- s`: it is keyed on m.category_id, and Postgres resolves join aliases left to
  -- right, so placing it first fails with "missing FROM-clause entry for table
  -- m". The replay caught that; it is recorded because the substitution reads
  -- perfectly well either way and only the database can tell you which is right.
  v_old := '    JOIN brands b          ON b.id = m.brand_id' || E'\n' || '    WHERE s.is_active';
  if position(v_old in v_new) = 0 then
    raise exception 'the FROM clause tail was not found';
  end if;
  v_new := replace(v_new, v_old,
    '    JOIN brands b          ON b.id = m.brand_id' || E'\n' ||
    '    JOIN product_categories pc ON pc.id = m.category_id' || E'\n' ||
    '    WHERE s.is_active');

  v_old := '    status' || E'\n' || '  FROM judged';
  if position(v_old in v_new) = 0 then
    raise exception 'the outer select tail was not found';
  end if;
  v_new := replace(v_new, v_old, '    status,' || E'\n' || '    unit_uom' || E'\n' || '  FROM judged');

  -- Adding a column to RETURNS TABLE cannot be done with CREATE OR REPLACE.
  -- The drop RESETS GRANTS, which is why they are restated immediately below
  -- rather than left to the earlier REVOKE — a dropped function comes back with
  -- Postgres's default PUBLIC grant, and that is the exact hole this migration's
  -- own guard caught once already.
  drop function if exists public.get_pricing_health();
  execute v_new;
end $$;

-- get_pricing_health is SECURITY DEFINER, and CREATE OR REPLACE preserves its
-- grants — but 0068's REVOKE is restated rather than assumed. get_pricing_health
-- shipped anon-readable for half a day once; skills.md Seat 3 says never again,
-- and "the grants were probably kept" is not evidence.
revoke execute on function public.get_pricing_health() from public;
revoke execute on function public.get_pricing_health() from anon;
grant  execute on function public.get_pricing_health() to authenticated, service_role;

-- ── PART 2: WHAT IS NOT FINISHED, AND WHAT IT BLOCKS ────────────────────────
--
-- Every gap is one a product can genuinely be created with. None of them should
-- BLOCK creation — Ali adds a product the day he hears about it, long before he
-- knows the carton size or has decided a price, and a form that refuses him
-- then is worse than one that reminds him later. That is why this is a
-- completeness report and not a constraint: the ERP pattern, chosen on purpose.
--
-- Ordered by what it costs him: stock he cannot sell first, then stock he
-- cannot receive, then products not yet in play.
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
      -- The SAME definition the sell sheet and Margin Watch now use. A third
      -- opinion here is exactly the bug this migration exists to remove.
      case when 'pack' = any(s.sellable_units)
           then price_per_unit(s.fixed_price_per_pack_mvr, s.fixed_selling_price_mvr,
                               s.pcs_per_pack) end as price_pack,
      case when 'carton' = any(s.sellable_units)
           then price_per_unit(s.fixed_price_per_carton_mvr, s.fixed_selling_price_mvr,
                               s.pcs_per_pack * s.packs_per_carton) end as price_carton,
      s.target_margin_pct
    from skus s
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
  -- NO PRICE AT ALL. Nothing to charge, in any unit it sells in. A target
  -- margin counts as a price: the app can compute one from the landed cost.
  select id, internal_code, full_path, 'no_price',
         'No selling price yet',
         case when pieces > 0
              then 'Cannot be sold — there is ' || stock_label || ' waiting'
              else 'Cannot be sold' end,
         stock_label, pieces,
         case when pieces > 0 then 0 else 2 end
    from labelled
   where price_pack is null and price_carton is null
     and (target_margin_pct is null or target_margin_pct <= 0)

  union all

  -- SOLD BY THE CARTON, BUT NO CARTON PRICE. It sells by the pack fine, so this
  -- is narrower than "no price" and is listed separately rather than lumped in.
  select id, internal_code, full_path, 'no_carton_price',
         'No price for a carton',
         'Sells by the ' || noun || ', but a carton cannot be quoted',
         stock_label, pieces, 1
    from labelled
   where 'carton' = any(sellable_units)
     and price_carton is null
     and (price_pack is not null or target_margin_pct > 0)

  union all

  -- NO CARTON SIZE. Hard rule 4: a zero-CBM shipment line blocks the GRN. The
  -- day a container carrying this arrives, receiving stops — and today nothing
  -- says so until that moment.
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

comment on function public.get_setup_gaps() is
  'Master-data completeness: every product with something unfinished that will '
  'block a sale, a purchase or a receipt. Deliberately a report and not a '
  'constraint — a product is added the day it is heard about, long before its '
  'carton is measured or its price decided.';

-- ANON REVOKED IN THE SAME MIGRATION. skills.md Seat 3, after get_pricing_health
-- shipped anon-readable for half a day. This one exposes the whole catalogue
-- with stock figures, so it is not a smaller mistake.
--
-- REVOKE FROM PUBLIC, NOT JUST FROM anon — and the guard at the foot of this
-- file is why that is written correctly here. Postgres grants EXECUTE to PUBLIC
-- on every new function, and `revoke ... from anon` does NOT remove a grant anon
-- holds through PUBLIC. The first version of this migration revoked only from
-- anon, reported success, and left the function open; the guard refused it. The
-- lesson is not "remember to revoke" — every migration here does remember — it
-- is that the revoke must be VERIFIED with has_function_privilege rather than
-- assumed from the statement having run.
revoke execute on function public.get_setup_gaps() from public;
revoke execute on function public.get_setup_gaps() from anon;
grant  execute on function public.get_setup_gaps() to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_def  text;
  v_anon boolean;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_pricing_health' and p.prokind = 'f';
  if v_def !~ 'price_per_unit' then
    raise exception 'get_pricing_health still carries its own opinion about a price';
  end if;
  if v_def !~ 'unit_uom text\)' then
    raise exception 'get_pricing_health does not return unit_uom, so Margin Watch would still guess the unit word';
  end if;

  -- anon must not reach either function. Asked of Postgres, not assumed from
  -- the REVOKE statements above having run.
  select has_function_privilege('anon', 'public.get_setup_gaps()', 'execute') into v_anon;
  if v_anon then raise exception 'anon can execute get_setup_gaps'; end if;
  select has_function_privilege('anon', 'public.get_pricing_health()', 'execute') into v_anon;
  if v_anon then raise exception 'anon can execute get_pricing_health'; end if;
  -- EVERY function this migration touches, not just the ones that felt risky.
  -- price_per_unit was the one left open, precisely because it looked harmless.
  select has_function_privilege('anon', 'public.price_per_unit(numeric, numeric, integer)', 'execute') into v_anon;
  if v_anon then raise exception 'anon can execute price_per_unit'; end if;
end $$;

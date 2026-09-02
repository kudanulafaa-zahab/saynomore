-- 0240 — a mixed carton holds whatever a carton holds. Stop storing it twice.
--
-- Ali sells Sosoft three ways: a single bottle, a MIXED carton of 6 bottles in
-- assorted colours, and a whole carton of one colour. The mixed carton is the
-- one this migration is about.
--
-- ── THE NUMBER WAS WRITTEN DOWN TWICE ─────────────────────────────────────
--
-- `brands.mixed_carton_pieces` = 6 says a mixed carton holds 6 bottles. Every
-- Sosoft SKU independently says pcs_per_pack 1 x packs_per_carton 6 — which is
-- also 6. Checked on all five: the stored number equals the derived one on
-- every row today.
--
-- It is not a coincidence and it is not extra information. A mixed carton is a
-- carton somebody filled with different colours; it holds exactly what that
-- product's carton holds. The brand column is a SECOND COPY of a fact the SKU
-- already states, kept in a different table, with nothing keeping the two in
-- step.
--
-- ── WHAT THAT COSTS, CONCRETELY ───────────────────────────────────────────
--
-- The copies drift the first time Ali's supplier changes the case. Change a
-- Sosoft SKU to 12 bottles a carton and `packs_per_carton` becomes 12 while
-- `mixed_carton_pieces` stays 6. Then:
--
--   * the price shown for a mixed carton is 6 x the bottle rate, on a carton
--     of 12 — half the money, on the screen where he quotes it;
--   * the "a mixed carton must be a whole multiple" rule accepts 6 bottles as
--     a full carton when it is half of one;
--   * every whole-carton line on the same product is billed on 12.
--
-- One product, two arithmetics, and nothing anywhere says they disagree.
--
-- ── THE FIX: DERIVE IT, KEEP THE FLAG ─────────────────────────────────────
--
-- v_skus now computes the number from the product's own carton and uses the
-- brand column only for what it is genuinely for — WHETHER this brand may be
-- sold as an assorted carton at all. That is a real policy and cannot be
-- derived from anything; the size never was.
--
-- Zero behaviour change today: the expression returns 6 for all five Sosoft
-- SKUs, which is what the column already held. No TypeScript changes either —
-- every caller reads `sku.mixed_carton_pieces` from this view and keeps doing
-- so, now getting a number that cannot go stale.

do $mig$
declare
  v_def    text := pg_get_viewdef('public.v_skus'::regclass, true);
  v_anchor text := '            b.mixed_carton_pieces,' || chr(10) ||
                   '            pc.sort_order AS category_sort_order';
  v_hits   int;
begin
  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'the mixed-carton anchor matches % times, expected exactly 1', v_hits;
  end if;

  v_def := replace(v_def, v_anchor,
    '            case when b.mixed_carton_pieces is not null' || chr(10) ||
    '                 then s.pcs_per_pack * s.packs_per_carton' || chr(10) ||
    '            end AS mixed_carton_pieces,' || chr(10) ||
    '            pc.sort_order AS category_sort_order');

  execute 'create or replace view public.v_skus as ' || v_def;
  -- pg_get_viewdef returns the query and NOT the options, so every rebuild
  -- drops security_invoker (0230). Put it back in the same breath.
  execute 'alter view public.v_skus set (security_invoker = on)';
end $mig$;

comment on column public.brands.mixed_carton_pieces is
  'A FLAG, not a size: non-null means this brand may be sold as an assorted '
  'carton (Sosoft, 5 colours in one carton). How many fit is NOT read from '
  'here any more — v_skus derives it from the product''s own '
  'pcs_per_pack x packs_per_carton, because a mixed carton holds exactly what '
  'that product''s carton holds and two copies of one number drift (0240).';

do $$
declare
  v_bad text;
begin
  -- The change must be provably invisible today: the derived number has to
  -- equal what the column held, on every row, or this is not a refactor.
  select string_agg(vs.internal_code, ', ' order by vs.internal_code) into v_bad
    from public.v_skus vs
    join public.variants v on v.id = vs.variant_id
    join public.product_models m on m.id = v.model_id
    join public.brands b on b.id = m.brand_id
   where b.mixed_carton_pieces is not null
     and vs.is_active
     and vs.mixed_carton_pieces is distinct from b.mixed_carton_pieces;
  if v_bad is not null then
    raise exception 'the derived mixed-carton size differs from the stored one on: %', v_bad;
  end if;

  -- ...AND A NEW INVARIANT WORTH HAVING. Products mixed into one carton must
  -- share a carton size, or "a full mixed carton" means two different numbers
  -- inside the same brand and neither the price nor the completeness rule can
  -- be right for both.
  select string_agg(t.name, ', ') into v_bad
  from (
    select b.name
      from public.skus s
      join public.variants v on v.id = s.variant_id
      join public.product_models m on m.id = v.model_id
      join public.brands b on b.id = m.brand_id
     where b.mixed_carton_pieces is not null and s.is_active
     group by b.id, b.name
    having count(distinct s.pcs_per_pack * s.packs_per_carton) > 1
  ) t;
  if v_bad is not null then
    raise exception
      'brand(s) sold as a mixed carton whose products do not agree on how many '
      'fit in one: %', v_bad;
  end if;
end $$;

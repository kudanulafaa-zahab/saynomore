-- 0199 — a deal that cannot work says so, instead of saying "pay at most 0.00".
--
-- Ali, 2026-08-23, with a screenshot of the Price Simulator showing five sizes,
-- every one of them reading:
--
--     Pay at most to hold this margin      USD 0.00 /carton
--                                          quote is 111% too dear
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
--
-- Reverse costing answers a buyer's real question: "at my selling price and my
-- margin, what is the most I can pay per carton?" It is
--
--     max FOB = (what the carton must land at)  −  (freight + duty + local)
--
-- and it was clamped:
--
--     round(greatest(required_landed_per_ctn - landing_per_ctn, 0), 2)
--
-- When the landing cost ALONE already exceeds what the carton can land at and
-- still hold the margin, that subtraction is NEGATIVE. Clamped to zero it reads
-- "pay at most USD 0.00" — which a reader takes as "the supplier would have to
-- give it away free", when the truth is far stronger and far more useful:
--
--     THIS DEAL CANNOT WORK AT ANY SUPPLIER PRICE. Even at zero FOB, the
--     freight and duty on this carton are more than the selling price can
--     carry at that margin.
--
-- That is a decision — reprice, or leave it out of the container — and it was
-- being flattened into a figure that looks like a rounding error.
--
-- ── THE TELL: TWO NUMBERS ON THE SAME ROW DISAGREEING ───────────────────────
--
-- `fob_headroom_pct` is computed from the UNCLAMPED difference, which is why it
-- can print −111% and −146%. A headroom below −100% is arithmetically impossible
-- if the max were really zero. So the row was already contradicting itself on
-- screen, and the honest half was the one nobody was reading.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
--
--   1. `max_fob_per_carton_mvr` and `_usd` return the TRUE value, negative when
--      the deal is impossible. `fob_headroom_pct` is untouched — it was already
--      right, and now the two agree.
--   2. `price_unit` ('pack' | 'carton') is RETURNED. The function already
--      computes it to decide which price to measure margin against; the screen
--      needs it for the units rule, so it is no longer allowed to guess whether
--      a product is sold by the pack or the carton.
--
-- Nothing else moves. No apportionment, no margin, no landed cost.
--
-- ── HOW, AND WHY NOT BY HAND ────────────────────────────────────────────────
--
-- The function is ~200 lines of apportionment arithmetic. Retyping it to change
-- three things is three hundred chances to alter one silently, and a wrong
-- freight share does not fail — it just prices the container wrong. So the new
-- body is DERIVED from the current one by exact substitution, and every
-- substitution must actually match: if any of them changes nothing, the
-- migration raises rather than reporting success. That is the failure mode 0189
-- was hardened against, applied here.

do $$
declare
  v_src   text;
  v_new   text;
  v_old   text;
  v_count int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simulate_landed_costs' and p.prokind = 'f';

  if v_src is null then
    raise exception 'simulate_landed_costs not found — nothing to rewrite';
  end if;
  v_new := v_src;

  -- ── 1. Un-clamp the max FOB, in rufiyaa ──────────────────────────────────
  v_old := 'round(greatest(f.required_landed_per_ctn - f.landing_per_ctn, 0), 2)';
  if position(v_old in v_new) = 0 then
    raise exception 'the MVR max-FOB expression was not found — re-read the function before editing this migration';
  end if;
  v_new := replace(v_new, v_old, 'round(f.required_landed_per_ctn - f.landing_per_ctn, 2)');

  -- ── 2. …and in dollars ───────────────────────────────────────────────────
  v_old := 'round(greatest(f.required_landed_per_ctn - f.landing_per_ctn, 0)';
  if position(v_old in v_new) = 0 then
    raise exception 'the USD max-FOB expression was not found — re-read the function before editing this migration';
  end if;
  v_new := replace(v_new, v_old, 'round((f.required_landed_per_ctn - f.landing_per_ctn)');

  -- ── 3. Return price_unit, so the screen never guesses the selling unit ───
  v_old := 'my_freight_share_usd numeric)';
  if position(v_old in v_new) = 0 then
    raise exception 'the RETURNS TABLE tail was not found';
  end if;
  v_new := replace(v_new, v_old, 'my_freight_share_usd numeric, price_unit text)');

  v_old := 'round((select freight_usd from fx), 2)' || E'\n' || '  from fin f';
  if position(v_old in v_new) = 0 then
    raise exception 'the select tail was not found';
  end if;
  v_new := replace(v_new, v_old,
    'round((select freight_usd from fx), 2),' || E'\n' || '    f.price_unit' || E'\n' || '  from fin f');

  -- No clamp may survive anywhere in the rewritten body.
  select count(*) into v_count
    from regexp_matches(v_new, 'greatest\(f\.required_landed_per_ctn', 'g');
  if v_count > 0 then
    raise exception '% clamp(s) still present after the rewrite', v_count;
  end if;

  -- Changing the RETURNS TABLE shape requires a drop; CREATE OR REPLACE cannot
  -- alter a function's result type.
  drop function if exists public.simulate_landed_costs(jsonb, jsonb);
  execute v_new;
end $$;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simulate_landed_costs' and p.prokind = 'f';

  if v_def is null then
    raise exception 'simulate_landed_costs is gone — the rewrite did not recreate it';
  end if;
  if v_def ~ 'greatest\(f\.required_landed_per_ctn' then
    raise exception 'the max-FOB clamp is still there';
  end if;
  if v_def !~ 'price_unit text\)' then
    raise exception 'price_unit is not in the RETURNS TABLE';
  end if;
end $$;

-- SECURITY. This function is SECURITY INVOKER (it has no SECURITY DEFINER
-- clause), so it runs with the caller's own rights and row security applies
-- normally — there is nothing to revoke from anon that anon does not already
-- lack. Stated rather than assumed, because the drop-and-recreate above resets
-- grants and a definer function would have needed its REVOKE restating here.

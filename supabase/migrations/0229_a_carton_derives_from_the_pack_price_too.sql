-- 0229 — a carton derives from the PACK price too.
--
-- 0228 made the per-piece figure derive from the pack price. The carton price
-- was left as it was, and it has a hole that 0228 was about to walk into:
--
--   explicit carton price        -> use it
--   fixed_selling_price_mvr      -> x pcs_per_pack x packs_per_carton
--   target_margin_pct            -> derive
--   otherwise                    -> NULL
--
-- There is no branch for fixed_price_per_pack_mvr. A product priced ONLY by
-- the pack therefore has no carton price at all.
--
-- That was latent while every product also carried a per-piece price. It stops
-- being latent the moment Edit SKU starts writing the pack price and clearing
-- the per-piece column, which is exactly what 0228's screen change does — a
-- product priced with the pack field alone would have silently lost its carton
-- price. Caught by pack_price_is_the_price.test.sql before the screen shipped:
-- it expected 4 x 160 = 640 and got null.
--
-- The new branch sits AFTER the explicit carton price, so a real carton break
-- still wins — Ali gives MVR 20 off a carton across almost the whole
-- catalogue and that must never be overwritten by arithmetic. It sits BEFORE
-- the per-piece branch, because the pack price is the price (0228) and a stale
-- per-piece value must never outrank it.

do $mig$
declare
  v_old text := $old$                CASE
                    WHEN s.fixed_price_per_carton_mvr IS NOT NULL THEN round(s.fixed_price_per_carton_mvr, 0)
                    WHEN s.fixed_selling_price_mvr IS NOT NULL THEN round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric, 0)$old$;
  v_new text := $new$                CASE
                    WHEN s.fixed_price_per_carton_mvr IS NOT NULL THEN round(s.fixed_price_per_carton_mvr, 0)
                    WHEN s.fixed_price_per_pack_mvr IS NOT NULL THEN round(s.fixed_price_per_pack_mvr * s.packs_per_carton::numeric, 0)
                    WHEN s.fixed_selling_price_mvr IS NOT NULL THEN round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric, 0)$new$;
  v_def text := pg_get_viewdef('public.v_skus'::regclass, true);
begin
  if position(v_old in v_def) = 0 then
    raise exception 'the carton expression is not the one 0229 was written against — refusing to patch a view it does not recognise';
  end if;
  execute 'create or replace view public.v_skus as ' || replace(v_def, v_old, v_new);
  -- pg_get_viewdef RETURNS ONLY THE QUERY, never the view's options, so the
  -- rebuild above drops security_invoker and v_skus silently starts running
  -- with its OWNER's rights — bypassing row level security. Put it back in the
  -- same breath. rls_surface.test.sql caught this the first time; it should
  -- never have to catch it again.
  execute 'alter view public.v_skus set (security_invoker = on)';
end $mig$;

do $$
declare
  v text := pg_get_viewdef('public.v_skus'::regclass, true);
  v_bad int;
begin
  if v !~ 'fixed_price_per_pack_mvr \* s\.packs_per_carton' then
    raise exception 'a carton still cannot be derived from the pack price';
  end if;
  -- Nothing that already had a carton price may have moved: an explicit break
  -- still wins, and this only fills a hole where there was a null.
  select count(*) into v_bad
    from public.v_skus
   where fixed_price_per_carton_mvr is not null
     and selling_price_per_carton_mvr is distinct from round(fixed_price_per_carton_mvr, 0);
  if v_bad > 0 then
    raise exception '% product(s) had their carton break overwritten by arithmetic', v_bad;
  end if;
  -- And every priced product now HAS a carton price.
  select count(*) into v_bad
    from public.v_skus
   where selling_price_per_pack_mvr is not null and selling_price_per_carton_mvr is null;
  if v_bad > 0 then
    raise exception '% product(s) have a pack price but still no carton price', v_bad;
  end if;
end $$;

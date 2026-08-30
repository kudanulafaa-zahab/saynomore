-- 0227 — a price gap is measured in the unit he SELLS.
--
-- Ali, 2026-08-30, with a screenshot of Prices -> Market:
--   *"For NB/S and S a message saying I am pricier. But the pack price I am
--    cheaper than competitor. What's going on here?"*
--
-- He is right, and the banner was wrong. Two figures on one card, disagreeing:
--
--   the banner   "MVR 12.90/pk pricier"   from selling_price_per_piece_mvr
--   the card     MVR 160.00 vs 163.10     from selling_price_per_pack_mvr
--
-- ── WHY THE PER-PIECE FIGURE LIES ─────────────────────────────────────────
--
-- v_skus computes selling_price_per_piece_mvr as round(fixed_selling_price_mvr,
-- 0) — a WHOLE RUFIYAA. On a pack price that is harmless: MVR 160 is already
-- whole, and whole rufiyaa is what Ali actually charges. On a per-piece figure
-- it is not: NB/S is MVR 3.64 a nappy and gets rounded to MVR 4.00, which is
-- 9.9% too high before any competitor is involved. S is 3.55 -> 4.00, 12.7%.
--
-- Across the catalogue 26 SKUs carry a distortion between -8.8% and +12.7%,
-- and NOT ONE OF THEM IS SOLD BY THE PIECE — every sellable_units is {pack,
-- carton} or {pack}. So the comparison was pitting a number nobody is ever
-- charged against a rival's real shelf price.
--
-- ── THE ROUNDING IS NOT THE BUG, AND MUST NOT BE REMOVED ──────────────────
--
-- The obvious fix is to stop rounding. It is wrong. For a Sosoft the piece IS
-- the trade unit — 1 piece per pack — so selling_price_per_piece_mvr is the
-- bottle price, MVR 37, and that whole rufiyaa is exactly what he charges.
-- new-sale-sheet and sale-detail read it for a real piece sale. Un-rounding it
-- would mis-price live sales to fix a reporting figure. price_gap_unit.test.sql
-- pins that down so the tempting fix cannot be applied later.
--
-- The bug is using a per-piece price AT ALL for a product that is not sold by
-- the piece. CLAUDE.md, after migration 0139: *"Money must be measured against
-- the unit actually sold. Dividing landed cost by a per-piece price nobody is
-- charged produced margins wrong on 21 of 29 SKUs."* Same error, same shape,
-- a different screen.
--
-- ── SO IT COMPARES PACK AGAINST PACK ──────────────────────────────────────
--
-- Ours is selling_price_per_pack_mvr — the number he charges. Theirs is their
-- shelf price restated at OUR pack size, which is what the card already shows.
-- Banner and card now run the same arithmetic, so they cannot disagree again.
--
-- For a Sosoft, pcs_per_pack is 1 and the pack price IS the bottle price, so
-- this is not a diaper special case — it is simply the unit sold, always.
--
-- The returned figures become PACK prices. They were per-piece and printed
-- with no unit at all ("Ours 4.00 vs VB 3.71"), which is the units rule broken
-- twice over: a figure he never charges, in a unit nobody named.

create or replace function public.get_competitor_price_gaps(p_threshold_pct numeric default 10)
returns table(
  sku_id uuid, brand_name text, model_name text, variant_display text,
  internal_code text, our_price_mvr numeric, cheapest_competitor_mvr numeric,
  cheapest_competitor_name text, gap_pct numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with cheapest as (
    -- SHELF ONLY (0223). Our pack price is what a shopper pays us for one
    -- pack, so the only fair opposite number is the pack a shopper buys from
    -- them — never their carton rate, which is discounted by definition.
    select distinct on (n.variant_id)
      n.variant_id, n.competitor_name, n.price_per_piece
    from public.v_competitor_price_normalized n
    where n.buys_like = 'shelf' and n.price_per_piece is not null
    order by n.variant_id, n.price_per_piece asc, n.observed_date desc
  ),
  priced as (
    select
      vs.id, vs.brand_name, vs.model_name, vs.variant_display, vs.internal_code,
      ch.competitor_name,
      vs.selling_price_per_pack_mvr                       as our_pack_mvr,
      ch.price_per_piece * vs.pcs_per_pack                as their_pack_mvr
    from cheapest ch
    join public.v_skus vs on vs.variant_id = ch.variant_id
    where vs.selling_price_per_pack_mvr is not null
      and vs.pcs_per_pack > 0
  )
  select
    p.id, p.brand_name, p.model_name, p.variant_display, p.internal_code,
    round(p.our_pack_mvr, 2),
    round(p.their_pack_mvr, 2),
    p.competitor_name,
    round((p.our_pack_mvr - p.their_pack_mvr) / nullif(p.their_pack_mvr, 0) * 100, 1) as gap_pct
  from priced p
  where (p.our_pack_mvr - p.their_pack_mvr) / nullif(p.their_pack_mvr, 0) * 100 > p_threshold_pct
  order by gap_pct desc;
$function$;

revoke execute on function public.get_competitor_price_gaps(numeric) from public, anon;
grant  execute on function public.get_competitor_price_gaps(numeric) to authenticated, service_role;

do $$
declare
  v text := regexp_replace(
    pg_get_functiondef('public.get_competitor_price_gaps(numeric)'::regprocedure), '--[^\n]*', '', 'g');
begin
  if v ~ 'selling_price_per_piece_mvr' then
    raise exception 'the gap is still measured against a per-piece price nobody is charged';
  end if;
  if v !~ 'selling_price_per_pack_mvr' then
    raise exception 'the gap is no longer measured against the pack price he actually charges';
  end if;
  if v !~ 'buys_like = ''shelf''' then
    raise exception 'the gap stopped comparing shelf against shelf (0223)';
  end if;
  if has_function_privilege('anon', 'public.get_competitor_price_gaps(numeric)', 'execute') then
    raise exception 'anon can read competitor pricing';
  end if;
end $$;

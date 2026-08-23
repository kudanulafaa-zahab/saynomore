-- 0200 — a product the app creates must be a product the app will sell.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- Five Body Shop tubs — SIXTEEN IN STOCK at MVR 380 each, roughly MVR 6,000 of
-- goods Ali carried back in his luggage — had never been sold once. Not slow
-- moving: IMPOSSIBLE to sell.
--
-- They carried `sellable_units = {piece}`, so the sell sheet offered exactly one
-- button: Piece. Tapping it writes a line with `uom = 'piece'`, and
-- `assert_whole_mixed_cartons` refuses precisely that:
--
--     uom = 'piece' AND (b.mixed_carton_pieces IS NULL
--                        OR NOT sol.is_mixed_carton_fill)   ->  REFUSED
--
-- Bodyshop has no `mixed_carton_pieces`, so every attempt failed with
--
--     "Bodyshop is not sold in single pieces. Sell it by the pack or the carton."
--
-- naming two units the screen had never offered, because `sellable_units` held
-- only `piece`. The app created a product it then refused to sell.
--
-- ── HOW WIDE ────────────────────────────────────────────────────────────────
--
-- `sellableUnitsFor()` in lib/trade-units.ts returned ["piece"] for every unit
-- that is not pcs / ml / g. So EVERY tub, jar, bar, tube, bottle, sachet, unit
-- and — since 0193 — SET created through the app was born unsellable. That
-- includes the IKEA bedding the whole category work was for. Fixed in the same
-- change as this migration; this migration repairs the rows already written.
--
-- ── THE FIX, AND WHY IT CHANGES NOTHING ALI READS ───────────────────────────
--
-- 'pack' is the right tier for something sold one at a time, and the WORD does
-- not change: sellUnitLabel('pack', cfg) is containerLabel(unit_uom), so a tub
-- still reads "tub" and a bedding set still reads "set". Only the recorded unit
-- changes, from a value the trigger refuses to one it accepts.
--
-- `pcs_per_pack = 1` on all of them, so one pack IS one tub: no quantity,
-- price, cost or margin moves. Verified below rather than asserted.
--
-- 'piece' remains legitimate for a MIXED CARTON FILL — the loose Sosoft bottles
-- that make up a carton — which is the one case the trigger allows. Those SKUs
-- are carton-only and are not touched.

do $$
declare
  v_fixed  int;
  v_bad    text;
begin
  -- Only ever the unsellable shape: a piece-only SKU whose brand has no
  -- mixed-carton setting, so the trigger can never accept a sale of it.
  with unsellable as (
    select s.id
      from skus s
      join variants v        on v.id = s.variant_id
      join product_models m  on m.id = v.model_id
      join brands b          on b.id = m.brand_id
     where s.sellable_units = array['piece']::text[]
       and b.mixed_carton_pieces is null
       and s.pcs_per_pack = 1          -- one pack IS one item; nothing re-costs
  )
  update skus set sellable_units = array['pack']::text[]
   where id in (select id from unsellable);
  get diagnostics v_fixed = row_count;
  raise notice '0200: % product(s) can now be sold', v_fixed;

  -- Nothing may be left that the app can create and the trigger will refuse.
  select string_agg(s.internal_code, ', ') into v_bad
    from skus s
    join variants v       on v.id = s.variant_id
    join product_models m on m.id = v.model_id
    join brands b         on b.id = m.brand_id
   where 'piece' = any(s.sellable_units)
     and b.mixed_carton_pieces is null;
  if v_bad is not null then
    raise exception 'still unsellable — piece-only with no mixed carton: %', v_bad;
  end if;
end $$;

-- ── PROVE NOTHING ELSE MOVED ────────────────────────────────────────────────
-- The claim is that only the recorded UNIT changes. A price or a pack size that
-- shifted would re-cost stock, so it is checked rather than trusted.
do $$
declare v_bad text;
begin
  select string_agg(format('%s (pcs_per_pack=%s)', internal_code, pcs_per_pack), ', ')
    into v_bad
    from skus
   where sellable_units = array['pack']::text[]
     and pcs_per_pack <> 1
     and internal_code like 'BODY-%';
  if v_bad is not null then
    raise exception 'a repaired SKU does not have one item per pack: %', v_bad;
  end if;
end $$;

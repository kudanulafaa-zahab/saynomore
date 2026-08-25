-- 0210 — a Sosoft bottle is ONE tier, not two.
--
-- Ali, 2026-08-25, with a screenshot of the Giveaway sheet:
-- *"there is 2 bottles option when I choose sosoft. Check what it is without
-- breaking anything."*
--
-- ── WHAT IT IS ──────────────────────────────────────────────────────────────
--
-- The toggle read `ctn | btl | btl`. Three buttons, two of them the same word,
-- because the five Sosoft SKUs carry THREE selling tiers on production:
--
--     sellable_units = {carton, pack, piece}
--
-- and for a 1 x 6 product `pack` and `piece` are the same physical thing — one
-- bottle. `sellUnitLabel` says so deliberately: "Never says 'piece' for a
-- product whose pack IS one unit — Sosoft's carton holds 6 packs of 1, so its
-- loose unit is a bottle." So both tiers render "btl" and he was offered the
-- same choice twice.
--
-- `piece` should not be there at all. CLAUDE.md: "Every SKU's `sellable_units`
-- is {pack,carton}, {carton} or {pack} — not one SKU sells `piece`", and
-- lib/trade-units.ts states as fact that "none says piece". That stopped being
-- true for these five, and no check was watching. Migration 0208 could not have
-- fixed it: it only rewrote SKUs whose tiers were exactly {carton}, so a SKU
-- that already carried piece was skipped silently and 0208's own guard passed,
-- because `'pack' = any(sellable_units)` was already true.
--
-- ── WHY REMOVING IT BREAKS NOTHING — CHECKED, NOT ASSUMED ───────────────────
--
-- Ali's words were "without breaking anything", and the mixed carton is the
-- thing he has twice asked to be left alone. Every consumer was read first:
--
--   MIXED CARTON      `assert_whole_mixed_cartons` gates on
--                     `brands.mixed_carton_pieces` and `is_mixed_carton_fill`.
--                     It never reads sellable_units. Untouched.
--   SELLING ONE       The `pack` tier IS the bottle and stays. The Single
--                     bottles tab emits uom='pack', which is what the ledger
--                     already records.
--   GIVING ONE AWAY   `give_away_stock` takes pieces directly; the sheet's
--                     trade tiers still include pack.
--   WRITING ONE OFF   `write_off_stock` takes pieces directly, and the Stock
--                     Ops toggle SYNTHESISES its loose tier locally rather than
--                     reading sellable_units — CLAUDE.md keeps that on purpose,
--                     because a torn pack is real. Unaffected.
--   DIRECT RECEIPT    `receive_direct_stock` DOES validate p_uom against
--                     sellable_units. Its pills come from `sellableTiers`, so
--                     after this they offer carton and pack — both of which the
--                     function accepts. This is the one consumer that would
--                     have broken if the UI had kept offering piece, which is
--                     why the screen change ships with this.
--   HISTORY           The 51 existing uom='piece' lines are all Sosoft bottles
--                     inside mixed cartons. Rows already written are not
--                     revalidated, and nothing here touches them.

-- ── 1. THE DATA ─────────────────────────────────────────────────────────────
do $$
declare
  v_fixed int;
  v_bad   text;
begin
  -- Narrowed to the shape the argument holds for: ONE PIECE IS ONE WHOLE
  -- BOTTLE, so dropping `piece` removes a duplicate rather than a capability.
  -- A product with 48 pieces to a pack is a different question, and this must
  -- never quietly become the thing that strips a real tier.
  update skus s
     set sellable_units = array_remove(s.sellable_units, 'piece')
   where s.pcs_per_pack = 1
     and 'piece' = any(s.sellable_units)
     and 'pack'  = any(s.sellable_units);
  get diagnostics v_fixed = row_count;
  raise notice '0210: % SKU(s) no longer offer the same bottle twice', v_fixed;

  -- Nothing may have been left tier-less or piece-only. 0201 made piece-only
  -- unrepresentable with a CHECK; this asserts the same thing about the rows
  -- this statement touched, because the WHERE clause is the only thing
  -- protecting a multi-piece SKU and a guard beats a promise.
  select string_agg(s.internal_code, ', ') into v_bad
    from skus s
   where s.pcs_per_pack > 1 and not ('piece' = any(s.sellable_units))
     and s.updated_at > now() - interval '5 seconds';
  if v_bad is not null then
    raise exception 'a multi-piece SKU lost a tier in this migration: %', v_bad;
  end if;
end $$;

-- ── 2. AND IT MUST NOT COME BACK ────────────────────────────────────────────
--
-- The rule already existed in prose in two files and in nobody's code, which is
-- exactly how five SKUs drifted without a single test going red. A product
-- whose pack IS one unit cannot also sell that unit as a loose piece: the two
-- tiers would be the same thing under two names, and every unit toggle in the
-- app would print the same word twice.
alter table public.skus
  drop constraint if exists skus_no_duplicate_single_tier_chk;
alter table public.skus
  add constraint skus_no_duplicate_single_tier_chk
  check (
    pcs_per_pack <> 1
    or not ('piece' = any(sellable_units) and 'pack' = any(sellable_units))
  );

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_left int;
  v_ok   boolean := false;
  v_cat uuid; v_brand uuid; v_model uuid; v_variant uuid;
begin
  select count(*) into v_left
    from skus where pcs_per_pack = 1
     and 'piece' = any(sellable_units) and 'pack' = any(sellable_units);
  if v_left > 0 then
    raise exception '% SKU(s) still offer the same unit as both pack and piece', v_left;
  end if;

  -- THE PROBE BUILDS ITS OWN ROW. The first version reached for
  -- `(select id from variants limit 1)`, which is NULL on a replay from empty —
  -- so it died on variant_id's NOT NULL before the CHECK was ever consulted,
  -- and every fresh database failed this migration. Migration 0201 learned the
  -- same thing one line at a time: a probe that borrows a row proves nothing on
  -- an empty database and breaks the replay.
  insert into product_categories (name, unit_uom, cost_basis)
    values ('Probe 0210 Category', 'ml', 'per_100ml') returning id into v_cat;
  insert into brands (name) values ('Probe 0210 Brand') returning id into v_brand;
  insert into product_models (brand_id, category_id, name)
    values (v_brand, v_cat, 'Probe 0210 Model') returning id into v_model;
  insert into variants (model_id, display_name)
    values (v_model, 'Probe 0210 Variant') returning id into v_variant;

  -- The constraint is proven to BITE rather than merely to exist — a check
  -- nobody has seen refuse anything is a check that might be inverted.
  begin
    insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, sellable_units)
    values (v_variant, 'PROBE-DUP-TIER-0210', 1, 6, array['pack','piece','carton']::text[]);
    raise exception 'the duplicate-tier constraint did not refuse a 1-per-pack SKU selling both pack and piece';
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception 'the duplicate-tier probe did not run'; end if;

  -- And it must NOT refuse the legitimate case: a real pack of MANY may carry a
  -- loose tier without ambiguity, because there a pack and a piece are
  -- genuinely different things. A constraint that also refused this would quietly
  -- take the write-off tier away from every diaper.
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, sellable_units)
  values (v_variant, 'PROBE-REAL-PACK-0210', 48, 4, array['pack','piece','carton']::text[]);

  delete from skus where internal_code in ('PROBE-DUP-TIER-0210', 'PROBE-REAL-PACK-0210');
  delete from variants where id = v_variant;
  delete from product_models where id = v_model;
  delete from brands where id = v_brand;
  delete from product_categories where id = v_cat;
end $$;

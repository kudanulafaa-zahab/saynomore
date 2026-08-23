-- 0201 — the KIND of product that mints unsellable products, and the rule that
-- stops the next one.
--
-- ── WHY 0200 WAS ONLY HALF THE FIX ──────────────────────────────────────────
--
-- 0200 repaired five Body Shop tubs that the app had created and then refused
-- to sell: `sellable_units = {piece}`, and `assert_whole_mixed_cartons` refuses
-- a piece line for a brand with no `mixed_carton_pieces`. Sixteen tubs, roughly
-- MVR 6,000, unsellable rather than slow-moving.
--
-- It repaired the ROWS. It left the SOURCE:
--
--     product_categories  Bodybutter   unit_uom = tub   default = {piece}
--
-- The New SKU sheet seeds a product's sellable units from its category
-- (products-explorer.tsx, `setSellUnits(def)`). So the very next body butter
-- Ali added would have been born with {piece} again, and been just as
-- unsellable — the identical defect, hours after the fix, with nothing in the
-- app to say so.
--
-- CLAUDE.md rule 9: a fix for one instance of a bug class is not done until the
-- whole surface it touches has been swept. The surface here is two tables and a
-- rule, not five rows.
--
-- ── THE INVARIANT ───────────────────────────────────────────────────────────
--
-- 'piece' is a legitimate unit in exactly ONE situation: the loose bottles that
-- fill a MIXED CARTON, where `is_mixed_carton_fill` is true and the brand
-- declares `mixed_carton_pieces`. That is always a SECOND tier beside the
-- carton — the carton is what is being filled.
--
-- Therefore: **'piece' may never be the ONLY unit a thing sells in.** A
-- piece-only product is, by the ledger's own rule, a product that cannot be
-- sold. Making that unrepresentable is better than finding it again in the
-- stock report, which is how it was found this time.
--
-- Checked before adding: production carries no SKU with 'piece' in
-- sellable_units at all, and one category with {piece} — repaired below. So the
-- constraint costs nothing today and closes the door for good.
--
-- The word Ali reads does not change. `sellUnitLabel('pack', cfg)` is
-- `containerLabel(unit_uom)`, so a tub still reads "tub" and a bedding set
-- still reads "set". Only the recorded unit moves, from one the ledger refuses
-- to one it accepts.

-- ── 1. REPAIR THE CATEGORIES ────────────────────────────────────────────────
do $$
declare
  v_fixed int;
  v_names text;
begin
  select string_agg(name || ' (' || unit_uom || ')', ', ' order by name) into v_names
    from product_categories where default_sellable_units = array['piece']::text[];

  update product_categories
     set default_sellable_units = array['pack']::text[]
   where default_sellable_units = array['piece']::text[];
  get diagnostics v_fixed = row_count;

  if v_fixed > 0 then
    raise notice '0201: % category/categories will no longer mint unsellable products: %',
      v_fixed, v_names;
  end if;
end $$;

-- ── 2. AND THE SKUS, IF ANY SURVIVED ────────────────────────────────────────
-- 0200 only repaired piece-only SKUs whose brand has no mixed_carton_pieces and
-- whose pcs_per_pack is 1. A piece-only SKU under a MIXED-CARTON brand would
-- have slipped through, and is just as unsellable: the trigger also requires
-- `is_mixed_carton_fill`, which only a carton line sets. Without a carton tier
-- there is no carton to fill.
do $$
declare v_fixed int;
begin
  update skus
     set sellable_units = array['pack']::text[]
   where sellable_units = array['piece']::text[]
     and pcs_per_pack = 1;
  get diagnostics v_fixed = row_count;
  if v_fixed > 0 then
    raise notice '0201: % further SKU(s) can now be sold', v_fixed;
  end if;
end $$;

-- A piece-only SKU with more than one piece per pack is NOT repaired silently,
-- because moving it to 'pack' would change what one unit MEANS — one pack of N
-- rather than one piece — and that re-prices stock. There are none; if one ever
-- appears, the constraint below refuses it at the moment it is written, which
-- is the right place to catch it.

-- ── 3. THE RULE ─────────────────────────────────────────────────────────────
alter table public.product_categories
  drop constraint if exists product_categories_default_sellable_units_chk;
alter table public.product_categories
  add constraint product_categories_default_sellable_units_chk
  check (
    array_length(default_sellable_units, 1) >= 1
    and default_sellable_units <@ array['piece','pack','carton']::text[]
    -- 'piece' alone is a product the ledger will refuse to sell. See the header.
    and default_sellable_units <> array['piece']::text[]
  );

alter table public.skus
  drop constraint if exists skus_sellable_units_chk;
alter table public.skus
  add constraint skus_sellable_units_chk
  check (
    array_length(sellable_units, 1) >= 1
    and sellable_units <@ array['piece','pack','carton']::text[]
    and sellable_units <> array['piece']::text[]
  );

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
-- A migration that reports success while changing nothing is the failure mode
-- 0189, 0197 and 0198 were each hardened against.
do $$
declare
  v_left text;
  v_ok   boolean;
begin
  select string_agg(name, ', ') into v_left
    from product_categories where default_sellable_units = array['piece']::text[];
  if v_left is not null then
    raise exception 'a category still defaults to piece-only: %', v_left;
  end if;

  select string_agg(internal_code, ', ') into v_left
    from skus where sellable_units = array['piece']::text[];
  if v_left is not null then
    raise exception 'a SKU is still piece-only: %', v_left;
  end if;

  -- The constraint must actually REFUSE, not merely exist. Proven by trying to
  -- write the forbidden shape and requiring the write to fail.
  --
  -- THE FIRST VERSION OF THIS PROBE PROBED NOTHING, and the replay caught it:
  -- it did `update ... where id = (select id from skus limit 1)`, which on a
  -- fresh database — no products yet — updates ZERO rows, raises nothing, and
  -- reports that the rule does not work. A guard that depends on the table
  -- already having data is not a guard on an empty schema, which is exactly
  -- what CI replays every migration onto. So the probe INSERTS its own row.
  begin
    v_ok := false;
    insert into product_categories (name, unit_uom, cost_basis, default_sellable_units)
    values ('__0201_probe__', 'tub', 'piece', array['piece']::text[]);
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    delete from product_categories where name = '__0201_probe__';
    raise exception 'the category rule does not refuse a piece-only default';
  end if;

  -- The same probe on `skus` would need a whole brand → model → variant chain
  -- invented just to be rejected, so the rule is confirmed from its definition
  -- here and its BEHAVIOUR is proven in supabase/tests/database/money_rules.
  -- test.sql, which runs against a fixture that has real products.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.skus'::regclass
       and conname  = 'skus_sellable_units_chk'
       and pg_get_constraintdef(oid) like $q$%<> ARRAY['piece'::text]%$q$
  ) then
    raise exception 'the SKU rule does not forbid a piece-only product';
  end if;
end $$;

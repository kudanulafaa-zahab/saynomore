-- 0208 — a Sosoft bottle is a thing you can sell, and give away, on its own.
--
-- Ali, 2026-08-24: *"I'm also giving away sosoft bottles. I must be able to give
-- away sosoft individual bottles too. I also must have an option to sell the
-- sosoft bottle individually if I want. But leave the current setup for mix a
-- case and whole carton as it is."*
--
-- ── THIS IS NOT AN EXCEPTION TO THE UNITS RULE ──────────────────────────────
--
-- It looks like one and it is not, and the difference matters enough to write
-- down. Every Sosoft SKU is `1 x 6`:
--
--     pcs_per_pack     1      ONE PIECE IS ONE WHOLE BOTTLE
--     packs_per_carton 6
--     unit_uom         ml  ->  unit_noun = 'bottle'
--
-- So the PACK tier for Sosoft is exactly one bottle. Selling one is not selling
-- a loose fraction of a pack — it is selling one whole trade unit, the same
-- shape as a tub or a bedding set. `lib/trade-units.ts` has said so all along,
-- in a comment that names this very product:
--
--     "Never says 'piece' for a product whose pack IS one unit — Sosoft's
--      carton holds 6 packs of 1, so its loose unit is a bottle."
--
-- Nothing here adds a `piece` tier. Ali reads "bottle"; the ledger records a
-- pack; migration 0201's rule that piece may never be the only tier is
-- untouched.
--
-- ── WHAT THE APP ALREADY DOES, WHICH IS WHY THIS IS MOSTLY DATA ─────────────
--
-- The New Sale sheet renders `sellableTiers(sku.sellable_units)` — whatever a
-- product declares, it offers, with the word from `sellUnitLabel`. So enabling
-- the tier is enough for selling; no screen had to be changed for that half.
--
-- ── AND THE MIXED CARTON IS NOT AFFECTED, WHICH HE ASKED FOR EXPLICITLY ─────
--
-- Checked rather than assumed. The mixed carton is gated on
-- `brands.mixed_carton_pieces` (migration 0065) everywhere it appears — the
-- sheet, the cart lines, the totals — and never on `sellable_units`. A
-- mixed-carton fill line is `uom = 'piece'` with `is_mixed_carton_fill`, which
-- `assert_whole_mixed_cartons` polices independently. Adding a pack tier
-- changes none of that, and the whole-carton sale keeps its own tier.

-- ── 1. THE DATA ─────────────────────────────────────────────────────────────
do $$
declare
  v_fixed int;
  v_bad   text;
begin
  -- Narrowed to exactly the shape this argument holds for: one piece per pack,
  -- so the pack IS the item. A product with 48 pieces to a pack would be a
  -- different question with a different answer, and this must never quietly
  -- become the door that opens loose diapers.
  update skus s
     set sellable_units = array['pack', 'carton']::text[]
    from variants v, product_models m, brands b
   where v.id = s.variant_id
     and m.id = v.model_id
     and b.id = m.brand_id
     and lower(b.name) = 'sosoft'
     and s.pcs_per_pack = 1
     and s.sellable_units = array['carton']::text[];
  get diagnostics v_fixed = row_count;
  raise notice '0208: % Sosoft SKU(s) can now be sold and given away one bottle at a time', v_fixed;

  -- Nothing with more than one piece per pack may have been touched. Asserted
  -- rather than trusted to the WHERE clause above, because this is the one way
  -- this migration could do real harm.
  select string_agg(s.internal_code, ', ') into v_bad
    from skus s
    join variants v on v.id = s.variant_id
    join product_models m on m.id = v.model_id
    join brands b on b.id = m.brand_id
   where lower(b.name) = 'sosoft'
     and s.pcs_per_pack > 1
     and 'pack' = any(s.sellable_units);
  if v_bad is not null then
    raise exception 'a multi-piece SKU was given a pack tier by this migration: %', v_bad;
  end if;
end $$;

-- ── 2. A MISSING SINGLE-UNIT PRICE MUST BE VISIBLE ──────────────────────────
--
-- Found by doing this work, not by guessing. `get_setup_gaps` has a branch for
-- "sells by the carton but no carton price" and NO MIRROR for the pack tier. So
-- the moment Sosoft gains a bottle tier, a SKU with a carton price and no
-- bottle price is reported as perfectly fine — and one of the five is exactly
-- that: SOSO-BLUE-ROSEWA-1x6 carries no per-unit figure at all.
--
-- Four of the five will quote MVR 36.67 a bottle, which is the carton price
-- divided by six. That is a DERIVED figure, not a price Ali chose, and singles
-- normally carry a premium over the case rate — but a price he can charge is a
-- price, so the report stays quiet about those four and speaks about the one
-- that cannot be quoted at all. Choosing the real single-bottle price is his.
create or replace function public.get_setup_gaps()
returns table (
  sku_id       uuid,
  internal_code text,
  full_path    text,
  gap          text,
  headline     text,
  blocks       text,
  stock_label  text,
  stock_pieces integer,
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
      -- THE SELL SHEET'S OWN NUMBERS (0204). Not a fresh CASE expression — the
      -- very columns the Sales screen quotes from, so this report cannot
      -- contradict what a customer would be charged.
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

  -- SOLD BY THE CARTON, AND ONLY THE CARTON CANNOT BE QUOTED.
  select id, internal_code, full_path, 'no_carton_price',
         'No price for a carton',
         'Sells by the ' || noun || ', but a carton cannot be quoted',
         stock_label, pieces, 1
    from labelled
   where 'carton' = any(sellable_units)
     and price_carton is null
     and price_pack is not null

  union all

  -- ...AND ITS MIRROR, WHICH DID NOT EXIST UNTIL 0208. A product that sells
  -- singly and by the carton, priced by the carton only, was reported as
  -- finished — so enabling Sosoft's bottle tier would have hidden the one SKU
  -- that cannot be quoted a bottle at all.
  select id, internal_code, full_path, 'no_unit_price',
         'No price for one ' || noun,
         'Sells by the carton, but a single ' || noun || ' cannot be quoted',
         stock_label, pieces, 1
    from labelled
   where 'pack' = any(sellable_units)
     and price_pack is null
     and price_carton is not null

  union all

  -- NO CARTON SIZE. Hard rule 4: a zero-CBM shipment line blocks the GRN.
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

revoke execute on function public.get_setup_gaps() from public, anon;
grant  execute on function public.get_setup_gaps() to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_n    int;
  v_anon boolean;
begin
  select count(*) into v_n
    from skus s
    join variants v on v.id = s.variant_id
    join product_models m on m.id = v.model_id
    join brands b on b.id = m.brand_id
   where lower(b.name) = 'sosoft' and 'pack' = any(s.sellable_units);
  -- Only asserted where Sosoft actually exists: a replay from empty has no
  -- catalogue, and a guard that demands one turns every fresh database into a
  -- failed migration.
  if exists (select 1 from brands where lower(name) = 'sosoft') and v_n = 0 then
    raise exception 'no Sosoft SKU gained a bottle tier';
  end if;

  if pg_get_functiondef('public.get_setup_gaps()'::regprocedure) !~ 'no_unit_price' then
    raise exception 'get_setup_gaps still cannot report a missing single-unit price';
  end if;

  select has_function_privilege('anon', 'public.get_setup_gaps()', 'execute') into v_anon;
  if v_anon then raise exception 'anon can execute get_setup_gaps'; end if;
end $$;

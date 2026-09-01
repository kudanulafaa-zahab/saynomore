-- 0235 — pack-only is a CHOICE, not a defect. Reverses 0234's constraint.
--
-- 0234 fixed Ali's real problem (MAMY-XTRA-XXXL-32x3 could not be sold by the
-- carton) and then added a CHECK that went far beyond it:
--
--     packs_per_carton <= 1 or 'carton' = any(sellable_units)
--
-- Its own header argued that a constraint which is one day too strict is the
-- cheaper mistake, because it prints an error naming itself. That day was the
-- same day: four existing test suites stopped mid-file, and reading them shows
-- the constraint contradicts documented, deliberate behaviour.
--
-- ── WHAT THE SUITES SAY, WHICH 0234 DID NOT READ FIRST ────────────────────
--
-- pricing_health.test.sql, on a 34x3 product that is pack-only:
--   "The carton price is catastrophic — MVR 100 for MVR 510 of goods — but the
--    product is never sold by the carton, so it is not a real loss and must not
--    be flagged."
--
-- price_review.test.sql:
--   "Pack-only product, offered a carton price. The screens guard this; so must
--    the writer" — set_selling_prices REFUSES a carton price on a pack-only SKU.
--
-- So a product that arrives 3 packs to a carton and is sold only by the pack is
-- a supported state with tests defending it, and `sellable_units` is the single
-- authority on what may be sold. 0234 made that state illegal, which is not a
-- guard — it is a different opinion about the business, enforced in DDL.
--
-- ── SO WHAT WAS ALI'S BUG, REALLY? ────────────────────────────────────────
--
-- Not an illegal row. A row that was legally pack-only, that he believed sold
-- by the carton, and that NOTHING EVER TOLD HIM ABOUT. It shipped 3 packs to a
-- carton, it carried a carton price of MVR 790 from before set_selling_prices
-- guarded that, and every screen quietly obeyed `{pack}`. He found out with a
-- customer waiting.
--
-- The fix for "nobody told him" is not a constraint. It is the panel that
-- already exists to tell him: Setup Gaps, on Products, which today says "no
-- price for a carton" and "no price for one pack". It gains the case that
-- caught him — ships in cartons, cannot sell one — as something visible and
-- actionable that he decides, rather than something the database forbids.
--
-- The data fix from 0234 STANDS: that SKU sells by the carton now, because Ali
-- says it does. Only the constraint is withdrawn.

alter table public.skus drop constraint if exists skus_carton_is_sellable_chk;

-- ══════════════════════════════════════════════════════════════════════════
-- THE GAP THAT WOULD HAVE TOLD HIM
-- ══════════════════════════════════════════════════════════════════════════
-- Same shape as every other gap: a headline he can read, a line saying what it
-- costs him, and the stock sitting behind it in packs and cartons.
--
-- Severity 1, not 0: the product IS sellable, just not in the unit he expects,
-- so it never outranks "cannot be sold at all". It is a decision, not an
-- emergency — which is the whole point of it living here and not in a CHECK.
create or replace function public.get_setup_gaps()
returns table(sku_id uuid, internal_code text, full_path text, gap text,
              headline text, blocks text, stock_label text, stock_pieces integer,
              severity integer)
language sql
stable security definer
set search_path to 'public'
as $function$
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
      -- THE SELL SHEET'S OWN NUMBERS (0204).
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

  select id, internal_code, full_path, 'no_carton_price',
         'No price for a carton',
         'Sells by the ' || noun || ', but a carton cannot be quoted',
         stock_label, pieces, 1
    from labelled
   where 'carton' = any(sellable_units)
     and price_carton is null
     and price_pack is not null

  union all

  -- ...AND ITS MIRROR, WHICH DID NOT EXIST UNTIL 0208.
  select id, internal_code, full_path, 'no_unit_price',
         'No price for one ' || noun,
         'Sells by the carton, but a single ' || noun || ' cannot be quoted',
         stock_label, pieces, 1
    from labelled
   where 'pack' = any(sellable_units)
     and price_pack is null
     and price_carton is not null

  union all

  -- ── THE ONE THAT CAUGHT ALI (0235) ────────────────────────────────────
  -- It arrives in cartons and cannot be sold in one. Legal, and almost never
  -- what he means: he buys, receives and sells in packs and cartons, so a
  -- product that refuses the carton is worth one line on a panel he reads.
  select id, internal_code, full_path, 'carton_not_sellable',
         'Cannot be sold by the carton',
         'Arrives ' || packs_per_carton || ' ' || noun || 's to a carton, but only '
           || 'single ' || noun || 's can be sold',
         stock_label, pieces, 1
    from labelled
   where packs_per_carton > 1
     and not ('carton' = any(sellable_units))

  union all

  select id, internal_code, full_path, 'no_carton_size',
         'No carton measurements',
         'A shipment carrying it cannot be received — freight has nothing to split on',
         stock_label, pieces, 1
    from labelled
   where cbm <= 0

  union all

  select id, internal_code, full_path, 'no_cost',
         'No landed cost recorded',
         'There is ' || stock_label || ' in the godown with no cost, so margin cannot be checked',
         stock_label, pieces, 1
    from labelled
   where pieces > 0 and landed is null

  order by 9, 8 desc, 3;
$function$;

revoke execute on function public.get_setup_gaps() from anon;
grant  execute on function public.get_setup_gaps() to authenticated, service_role;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.skus'::regclass and conname = 'skus_carton_is_sellable_chk'
  ) then
    raise exception '0234''s constraint is still in place';
  end if;

  -- The state 0234 outlawed must be insertable again, because the pricing
  -- suites depend on it existing.
  if (select count(*) from public.get_setup_gaps() where gap = 'carton_not_sellable') is null then
    raise exception 'the new gap does not evaluate';
  end if;
end $$;

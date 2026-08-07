-- 0160 — the pricing engine only quotes units the product is actually sold in.
--
-- Ali, 2026-08-07, when asked directly:
--
--   "Sosoft I sell in cartons. Not bottles. But customer can make mixed
--    carton of six bottles not less. Customer can also purchase single
--    color carton."
--
-- So a Sosoft carton is six bottles — mixed colours or all one colour — and
-- there is no smaller sale. The carton is the only selling unit, which is
-- exactly what `sellable_units = {carton}` already says for all five bottles.
--
-- THE BUG
--
-- get_tier_prices_for_skus computed all three prices for every SKU regardless
-- of what it is sold in, so a MVR 220 carton came back as:
--
--   product                        sellable_units   carton   also returned
--   Blue Rose & Water Lily 700ml   {carton}         220      pack 37, piece 37
--   Green Floral Lily 700ml        {carton}         220      pack 37, piece 37
--   Pink Sweet Peony 700ml         {carton}         220      pack 37, piece 37
--   Purple Fresia & Pear 700ml     {carton}         220      pack 37, piece 37
--   Red Sakura Blossom 700ml       {carton}         220      pack 37, piece 37
--
-- "MVR 37 a pack" for something never sold by the pack. That is the standing
-- rule — sellable_units is the only input, and no screen may offer a unit the
-- product isn't sold in. Screens once synthesised a loose-piece tier for every
-- pack-selling diaper for the same reason: a number existed, so it got shown.
--
-- WHAT THIS DOES NOT BREAK, checked rather than assumed:
--
--   * The mixed-carton builder derives its per-bottle figure from the CARTON
--     price itself (`tp.price_per_carton_mvr / pcsPerCarton`), not from the
--     pack or piece columns. Six bottles at MVR 220 a carton is unaffected,
--     mixed or single colour.
--   * sellableTiers() already gates which unit buttons appear in order entry
--     and on the sale detail, so a carton-only SKU never offered pack or piece
--     to begin with. This stops the engine PRODUCING the number, rather than
--     relying on every screen to remember not to show it.
--   * defaultUom() picks carton for ml/g products, so the product card reads
--     the carton price and never touched the pack column.
--
-- PER-PIECE IS DELIBERATELY KEPT. Not one SKU sells by the piece, so it is
-- never a selling unit anywhere and cannot be mistaken for one. It stays as
-- the internal comparison figure the Market screen needs — rivals sell 30s,
-- 34s and 48s, so per-piece is the only way to compare — which is the
-- sanctioned carve-out in CLAUDE.md. Pack and carton are different: they ARE
-- selling units for some products, so quoting one for a product that does not
-- sell it is offering a sale that cannot happen.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_tier_prices_for_skus(
  p_sku_ids uuid[],
  p_tier text DEFAULT 'retail'::text
)
RETURNS TABLE (
  sku_id uuid,
  price_per_piece_mvr numeric,
  price_per_pack_mvr numeric,
  price_per_carton_mvr numeric,
  source text,
  price_list_name text,
  price_list_date date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with active_list as (
    select id, name, effective_from
    from price_lists
    where tier = p_tier
      and effective_from <= (now() at time zone 'Indian/Maldives')::date
    order by effective_from desc
    limit 1
  ),
  list_prices as (
    select
      pli.sku_id,
      round(pli.price_per_piece_mvr, 0)  as price_per_piece_mvr,
      round(pli.price_per_pack_mvr, 0)   as price_per_pack_mvr,
      round(pli.price_per_carton_mvr, 0) as price_per_carton_mvr,
      'price_list'::text  as source,
      al.name             as price_list_name,
      al.effective_from   as price_list_date
    from price_list_items pli
    join active_list al on al.id = pli.price_list_id
    where pli.sku_id = any(p_sku_ids)
  ),
  sku_defaults as (
    select
      s.id as sku_id,
      round(coalesce(
        s.fixed_selling_price_mvr,
        s.fixed_price_per_pack_mvr   / nullif(s.pcs_per_pack, 0),
        s.fixed_price_per_carton_mvr / nullif(s.pcs_per_pack * s.packs_per_carton, 0)
      ), 0) as price_per_piece_mvr,
      round(coalesce(
        s.fixed_price_per_pack_mvr,
        s.fixed_selling_price_mvr * s.pcs_per_pack,
        s.fixed_price_per_carton_mvr / nullif(s.packs_per_carton, 0)
      ), 0) as price_per_pack_mvr,
      round(coalesce(
        s.fixed_price_per_carton_mvr,
        s.fixed_price_per_pack_mvr * s.packs_per_carton,
        s.fixed_selling_price_mvr * s.pcs_per_pack * s.packs_per_carton
      ), 0) as price_per_carton_mvr,
      'sku_default'::text as source,
      null::text          as price_list_name,
      null::date          as price_list_date
    from skus s
    where s.id = any(p_sku_ids)
      and (s.fixed_selling_price_mvr is not null
           or s.fixed_price_per_pack_mvr is not null
           or s.fixed_price_per_carton_mvr is not null)
  ),
  margin_prices as (
    select
      s.id as sku_id,
      round(ll.landed_per_piece_mvr / (1 - s.target_margin_pct / 100.0), 0) as price_per_piece_mvr,
      round((ll.landed_per_piece_mvr * s.pcs_per_pack)
            / (1 - s.target_margin_pct / 100.0), 0) as price_per_pack_mvr,
      round((ll.landed_per_piece_mvr * s.pcs_per_pack * s.packs_per_carton)
            / (1 - s.target_margin_pct / 100.0), 0) as price_per_carton_mvr,
      'margin'::text as source,
      null::text     as price_list_name,
      null::date     as price_list_date
    from skus s
    join lateral (
      -- Stock on the shelf first, then the last batch received. Selling out
      -- is not forgetting what it cost (0092 / 0149 / 0158 / 0159).
      select x.landed_per_piece_mvr
      from (
        select bs.landed_per_piece_mvr, bs.received_at, 0 as src
          from v_batch_stock bs
         where bs.sku_id = s.id
           and bs.qty_pieces_remaining > 0
        union all
        select ib.landed_per_piece_mvr, ib.received_at, 1 as src
          from inventory_batches ib
         where ib.sku_id = s.id
           and ib.landed_per_piece_mvr is not null
      ) x
      order by x.src, x.received_at desc
      limit 1
    ) ll on true
    where s.id = any(p_sku_ids)
      and s.fixed_selling_price_mvr is null
      and s.fixed_price_per_pack_mvr is null
      and s.fixed_price_per_carton_mvr is null
      and s.target_margin_pct is not null
      and s.target_margin_pct > 0
      and s.target_margin_pct < 100
      and ll.landed_per_piece_mvr is not null
  ),
  resolved as (
    select distinct on (all_prices.sku_id)
      all_prices.sku_id,
      all_prices.price_per_piece_mvr,
      all_prices.price_per_pack_mvr,
      all_prices.price_per_carton_mvr,
      all_prices.source,
      all_prices.price_list_name,
      all_prices.price_list_date
    from (
      select * from list_prices
      union all
      select * from sku_defaults
      union all
      select * from margin_prices
    ) all_prices
    order by all_prices.sku_id,
      case all_prices.source
        when 'price_list'  then 1
        when 'sku_default' then 2
        when 'margin'      then 3
        else 4
      end
  )
  -- Quote only what the product is actually sold in. sellable_units is the
  -- single source of truth; a price for any other unit is an offer that
  -- cannot be fulfilled.
  select
    r.sku_id,
    r.price_per_piece_mvr,
    case when 'pack'   = any(s.sellable_units) then r.price_per_pack_mvr   end,
    case when 'carton' = any(s.sellable_units) then r.price_per_carton_mvr end,
    r.source,
    r.price_list_name,
    r.price_list_date
  from resolved r
  join skus s on s.id = r.sku_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_tier_prices_for_skus(uuid[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_tier_prices_for_skus(uuid[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tier_prices_for_skus(uuid[], text) TO authenticated;

COMMIT;

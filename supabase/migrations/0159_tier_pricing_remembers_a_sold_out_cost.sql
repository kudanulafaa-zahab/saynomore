-- 0159 — tier pricing remembers what a sold-out product cost.
--
-- FOURTH instance of the same class, and the last one I can find. The tier
-- engine's margin path read landed cost from IN-STOCK batches only:
--
--     join lateral (
--       select bs.landed_per_piece_mvr from v_batch_stock bs
--        where bs.sku_id = s.id and bs.qty_pieces_remaining > 0
--        order by bs.received_at desc limit 1
--     ) ll on true
--
-- An inner lateral join, so a SKU priced by target margin with nothing on the
-- shelf produces NO ROW AT ALL — the function returns nothing for it, rather
-- than a price.
--
-- Measured on production. Exactly one active SKU comes back unpriced, and it
-- is Xtra Kering NB/S again — target margin, no fixed price, sold out:
--
--   get_tier_price_for_sku(NB/S)   0 rows
--   v_skus                         MVR 170 a pack
--
-- Two pricing paths, one product, and they disagree.
--
-- The class, now fixed in four places:
--   0092  get_price_book       after Ali's screenshot of NB/S reading
--                              "No landed cost yet"
--   0149  v_skus               same product losing its derived price and its
--                              margin the moment it sold out
--   0158  apply_target_prices  the reprice button refusing on an empty shelf
--   0159  get_tier_prices_for_skus  this one — order entry
--
-- WHY IT LOOKS FINE TODAY, AND WHY IT IS STILL WRONG
--
-- Nothing is visibly broken on the phone, because sales-list.tsx already
-- falls back on its own:
--
--     const cardPrice = tp ? tp.price_per_pack_mvr : s.selling_price_per_pack_mvr;
--
-- The browser quietly substitutes a price from a different source when the
-- server returns none. That is exactly the arrangement CLAUDE.md rule 6
-- forbids — money resolved in TypeScript rather than Postgres — and it means
-- the authoritative pricing engine and the screen can disagree without
-- anything saying so. After this, both answer MVR 170 and the client fallback
-- becomes belt-and-braces instead of load-bearing.
--
-- Same proven fallback as 0149: prefer an IN-STOCK batch (live pricing
-- untouched), fall back to the most recent batch of any kind. A SKU never
-- received still has no batch, so it still correctly returns no margin price
-- and drops through to whatever else the SKU has.
--
-- Checked and ruled out while here, rather than assumed: a price list whose
-- item has only some prices filled cannot blank the others, because all three
-- price columns on price_list_items are NOT NULL. The precedence order
-- (price_list > sku_default > margin) is therefore safe as written.

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
      -- is not forgetting what it cost (0092 / 0149 / 0158).
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
  )
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
    end;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_tier_prices_for_skus(uuid[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_tier_prices_for_skus(uuid[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tier_prices_for_skus(uuid[], text) TO authenticated;

COMMIT;

-- 0163 — a carton cannot be sold as a fraction of a carton.
--
-- Ali, 2026-08-09, with a screenshot of a New Sale cart reading
-- "1.6666666666666667 cartons in cart":
--
--   "In sales new sales in sosoft for one customer I cannot add more than one
--    carton. There is only option for mix your own carton. I must be able to
--    choose single color 1 carton too and add as many cartons and other
--    products in same order too."
--
-- The UI half of that is fixed in the same change. This is the half that has
-- to live in the database, because the UI is not the only door.
--
-- WHAT WENT WRONG
--
-- The mixed-carton sheet REPLACED any existing line for a colour instead of
-- adding to it. Build a carton of 2 Purple + 4 Red, then build another of
-- 6 Purple, and Purple's 2 was overwritten by 6 rather than becoming 8 — the
-- order kept 6 Purple + 4 Red = 10 bottles. Ten bottles is one and two-thirds
-- of a carton. Four bottles the salesperson had entered were gone, and an
-- order existed for a quantity that cannot be sold.
--
-- Nothing anywhere refused it. create_and_post_sale validates uom, quantity
-- and price per line, and derives qty_pieces from the SKU's pack config — but
-- it has no view of whether the LINES TOGETHER add up to whole cartons, and
-- neither does anything else. The guard added in 0156 (edit_sales_order_line
-- refusing a non-whole selling unit) does not help either: for a piece line,
-- every integer is a whole piece.
--
-- WHY A DEFERRED CONSTRAINT TRIGGER
--
-- The invariant is about a WHOLE ORDER, not a row: a mixed carton is spread
-- across several lines, one per colour, and no single line can be judged on
-- its own. 3 Red bottles is fine if 3 Blue sit beside it and wrong if they do
-- not. So this cannot be a CHECK constraint or a per-row BEFORE trigger.
--
-- DEFERRABLE INITIALLY DEFERRED runs it once at COMMIT, when the order is
-- whatever it finally is. That also means it covers every write path at once —
-- create_and_post_sale, edit_sales_order_line, delete_sales_order_line, a
-- future screen, or a hand-written SQL correction — rather than the one path
-- that happened to be in front of me. One guard, every door.
--
-- TWO RULES, BOTH FROM THE SAME PLACE
--
--   1. Mixed-carton fills for a brand must total a whole number of cartons.
--   2. uom = 'piece' is ONLY ever legitimate as part of a mixed carton.
--      Every SKU sells in packs or cartons; a loose piece is not a unit of
--      trade in this business ("Nobody will sell diapers in pieces"). The
--      mixed carton is the single sanctioned exception in CLAUDE.md, because
--      a bottle inside one is a real ledger unit.
--
-- CHECKED AGAINST HISTORY BEFORE ADDING, not assumed: all 73 piece lines ever
-- written are mixed-carton-brand lines AND carry is_mixed_carton_fill, and no
-- existing order holds a partial mixed carton. Nothing in the past violates
-- either rule, so this is a forward guard with no backfill and no exceptions
-- to grandfather.
--
-- The message names the brand, says how many bottles short a full carton is,
-- and gives both ways out — Ali is the one who will read it on a phone.

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_whole_mixed_cartons()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_noun     text;
  r          record;
begin
  -- 1. A loose piece is only ever part of a mixed carton.
  for r in
    select b.name as brand, s.internal_code
      from sales_order_lines sol
      join skus s           on s.id = sol.sku_id
      join variants v       on v.id = s.variant_id
      join product_models m on m.id = v.model_id
      join brands b         on b.id = m.brand_id
     where sol.order_id = v_order_id
       and sol.uom = 'piece'
       and (b.mixed_carton_pieces is null or not sol.is_mixed_carton_fill)
     limit 1
  loop
    raise exception
      '% is not sold in single pieces. Sell it by the pack or the carton.',
      r.brand
      using errcode = 'check_violation';
  end loop;

  -- 2. Mixed-carton fills must add up to whole cartons, per brand.
  for r in
    select b.name                      as brand,
           b.mixed_carton_pieces       as per,
           sum(sol.qty_pieces)::int    as pieces,
           max(c.unit_uom)             as unit_uom
      from sales_order_lines sol
      join skus s           on s.id = sol.sku_id
      join variants v       on v.id = s.variant_id
      join product_models m on m.id = v.model_id
      join brands b         on b.id = m.brand_id
      join product_categories c on c.id = m.category_id
     where sol.order_id = v_order_id
       and sol.is_mixed_carton_fill
       and b.mixed_carton_pieces is not null
       and b.mixed_carton_pieces > 0
     group by b.name, b.mixed_carton_pieces
    having sum(sol.qty_pieces) % b.mixed_carton_pieces <> 0
  loop
    -- The noun comes from the category's unit_uom, never a hardcoded word --
    -- the same rule the screens follow (containerLabel in lib/trade-units).
    v_noun := case r.unit_uom when 'ml' then 'bottle' when 'g' then 'pouch' else 'piece' end;
    if r.pieces <> 1 then v_noun := v_noun || 's'; end if;
    raise exception
      '% is sold by the carton. This order has % %, which is % short of a full carton — add % more, or take % off.',
      r.brand,
      r.pieces,
      v_noun,
      r.per - (r.pieces % r.per),
      r.per - (r.pieces % r.per),
      r.pieces % r.per
      using errcode = 'check_violation';
  end loop;

  return null;
end $function$;

REVOKE EXECUTE ON FUNCTION public.assert_whole_mixed_cartons() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_whole_mixed_cartons() FROM anon;

DROP TRIGGER IF EXISTS trg_assert_whole_mixed_cartons ON public.sales_order_lines;

CREATE CONSTRAINT TRIGGER trg_assert_whole_mixed_cartons
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_order_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_whole_mixed_cartons();

COMMIT;

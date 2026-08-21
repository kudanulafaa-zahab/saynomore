-- 0190 — a pack size is fixed once there is stock against it.
--
-- FOUND BY AUDIT, NOT BY A COMPLAINT. One batch in the whole business disagrees
-- with its own product:
--
--   MAMY-XTRA-XXXL-34x3   the code says 34 in a pack, 3 packs to a carton = 102
--   the batch of 8 July   1 carton, recorded as 128 pieces
--   its stored costs      per pack = per piece x 32, per carton = per pack x 4
--
-- So that carton was received, costed and sold as 32x4. The SKU was later
-- re-specced to 34x3, and every number already written against it stayed behind.
--
-- WHAT IT COSTS TODAY. The Product Card for X-Tra Kering XXXL reports the profit
-- on a carton as MVR 245.88 when, against its own stated pack size, it is
-- MVR 356.41 — MVR 110.53 a carton understated, a margin of 31.1% shown for one
-- that is really 45.1%. The per-pack figure errs the other way: MVR 133.97 shown
-- against MVR 125.47 real, so the pack looks BETTER than it is. One batch,
-- two figures, wrong in opposite directions — which is what makes this class of
-- fault so hard to notice by eye.
--
-- The money engines escaped. get_pricing_health, get_promo_suggestions,
-- apply_target_prices, get_pnl and post_sale all work from
-- landed_per_piece_mvr and the SKU's CURRENT pack config, so margin, promo
-- floors and repricing were never driven by the stale columns. Only
-- get_product_card reads them, which is why this surfaced as a display that
-- disagreed with itself rather than as a bad price.
--
-- ── WHY THE GUARD GOES HERE AND NOT ON THE CARD ───────────────────────────────
--
-- Patching get_product_card would hide it. The fault is not that one screen read
-- the wrong column; it is that a SKU's pack size can be rewritten underneath
-- history that was recorded against the old one. Every batch cost, every piece
-- count and every sold line for that product silently re-specs itself, and
-- nothing anywhere says so.
--
-- The app's own rules already settle what should happen instead. CLAUDE.md:
-- *"Two SKUs can share a size and still be different products: XXXL-22x4 and
-- XXXL-34x3 are separate retail pack formats."* A 34-pack and a 32-pack ARE
-- different things to buy, price and sell. The correct move when the pack format
-- changes is a NEW SKU, not an edit to the old one — that is also the only way
-- the two can be counted, costed and compared separately, which is the whole
-- point of the seven-level hierarchy.
--
-- So: before there is any history, the pack size is freely editable — that is
-- how a typo gets fixed. From the first batch or the first sale onward it is
-- fixed, and the error message says what to do instead.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not touch the batch of 8 July.
-- That row records how many nappies are actually in a godown, and no migration
-- can know whether the carton holds 102 or 128 — only a physical count can.
-- Correcting stock is a ledger event with Ali's eyes on it, not a silent UPDATE
-- inside a schema change. This stops it happening again; the existing row is
-- reported to him separately.

create or replace function public.block_pack_config_change_with_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batches int;
  v_lines   int;
  v_history text;
  v_config  text;
begin
  if new.pcs_per_pack is not distinct from old.pcs_per_pack
     and new.packs_per_carton is not distinct from old.packs_per_carton then
    return new;
  end if;

  -- Counted with definer rights on purpose. A guard that reads through the
  -- caller's row level security can be shown an empty history and wave the
  -- change through, which is the opposite of a guard.
  select count(*) into v_batches from inventory_batches where sku_id = old.id;
  select count(*) into v_lines   from sales_order_lines  where sku_id = old.id;

  if v_batches = 0 and v_lines = 0 then
    return new;                      -- nothing recorded yet: fix it freely
  end if;

  -- The message is a toast Ali reads, so it names only what actually exists and
  -- agrees with its own numbers. "0 order lines sold" and "1 pieces per pack"
  -- both read as though nobody checked, which is exactly the impression a guard
  -- must not give at the moment it refuses someone.
  v_history := concat_ws(' and ',
    case when v_batches > 0
         then v_batches || ' stock receipt' || case when v_batches = 1 then '' else 's' end end,
    case when v_lines > 0
         then v_lines || ' sale' || case when v_lines = 1 then '' else 's' end end);

  v_config := old.pcs_per_pack || ' per pack, '
           || old.packs_per_carton || ' pack' || case when old.packs_per_carton = 1 then '' else 's' end
           || ' per carton';

  raise exception
    'This product already has % recorded against % — changing the pack size now would re-cost every batch and every past sale of it. A different pack format is a different product.',
    v_history, v_config
    using errcode = 'check_violation',
          hint    = 'Add the new pack format as its own SKU, then stop reordering this one.';
end $$;

comment on function public.block_pack_config_change_with_history() is
  'A SKU pack size is editable until the first batch or sold line, and fixed '
  'afterwards. Re-speccing a product that has history silently re-costs every '
  'batch and sale against it: MAMY-XTRA-XXXL-34x3 was received as 32x4, later '
  'changed to 34x3, and its Product Card reported MVR 110.53 a carton of profit '
  'that was not there. A new pack format is a new SKU.';

revoke execute on function public.block_pack_config_change_with_history() from anon, public;

drop trigger if exists trg_block_pack_config_change on public.skus;
create trigger trg_block_pack_config_change
  before update on public.skus
  for each row
  execute function public.block_pack_config_change_with_history();

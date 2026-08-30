-- 0231 — Skin Comfort M: the code says 34, everything else says 32.
--
-- Found while surveying every diaper for Ali's "all the math must be correct"
-- (0228). One SKU in the catalogue has an internal_code that disagrees with its
-- own pack configuration:
--
--   MAMY-SKIN-M-34x4     code says 34 per pack
--   pcs_per_pack = 32    configuration says 32
--
-- ── WHICH ONE IS RIGHT, AND WHY THIS IS NOT THE XXXL CASE ─────────────────
--
-- CLAUDE.md says the code wins: *"If a GRN, a batch or a piece count disagrees
-- with the code, the code is right and the other number is the bug."* That rule
-- was written before the XXXL incident, where the CODE itself turned out to be
-- the typo — so it is not applied blindly here. The ledger was asked instead,
-- and it is unanimous:
--
--   batch, 8 Jul     5 cartons = 640 pieces      -> 128 a carton = 32 x 4
--   sale, 19 Jul     1 pack    =  32 pieces      -> 32
--   sale, 25 Aug     2 cartons = 256 pieces      -> 128 a carton
--   sale, 28 Aug     2 packs   =  64 pieces      -> 32
--   on hand          288 pieces                  -> exactly 9 packs at 32
--
-- At 34 a carton would hold 136 and the batch would have been 680, not 640;
-- and the 288 pieces on the shelf would be 8.47 packs. A product sold only in
-- packs cannot hold a fraction of one. Every recorded fact says 32.
--
-- So here the CONFIGURATION is right and the CODE is the typo — the mirror
-- image of XXXL. That is exactly why the rule was not applied on autopilot.
--
-- ── THIS IS A LABEL, NOT A RESTATEMENT ────────────────────────────────────
--
-- Nothing is derived from internal_code: it is displayed, searched and used to
-- name a product. pcs_per_pack and packs_per_carton are untouched, so no batch
-- is re-costed, no sale is re-priced and no stock moves. correct_pack_config
-- (0224) is not needed and would be the wrong tool — there is no restatement
-- here, only a name that has been wrong since the product was created.
--
-- Skin Comfort is a discontinued line (Ali, 2026-08-14): never reordered, but
-- still sold, still counted and still priced until the stock is gone. A wrong
-- name on it is still a wrong name.

do $$
declare
  v_id   uuid;
  v_old  text := 'MAMY-SKIN-M-34x4';
  v_new  text := 'MAMY-SKIN-M-32x4';
  v_pcs  int;
  v_ppc  int;
  v_pcs_per_ctn numeric;
begin
  select id, pcs_per_pack, packs_per_carton into v_id, v_pcs, v_ppc
    from skus where internal_code = v_old;
  if v_id is null then
    raise notice 'MAMY-SKIN-M-34x4 not present — nothing to rename';
    return;
  end if;

  -- Refuse unless the configuration really is 32 x 4. If someone corrected the
  -- pack size instead, renaming to 32x4 would make a NEW mismatch.
  if v_pcs <> 32 or v_ppc <> 4 then
    raise exception 'expected 32 x 4 on this product, found % x % — not renaming a code that would then be wrong', v_pcs, v_ppc;
  end if;

  -- And refuse unless the ledger still agrees, so this cannot rename a product
  -- whose history has moved on since the evidence above was gathered.
  select ib.qty_pieces_received::numeric / nullif(ib.qty_cartons_received, 0)
    into v_pcs_per_ctn
    from inventory_batches ib where ib.sku_id = v_id
    order by ib.received_at limit 1;
  if v_pcs_per_ctn is not null and v_pcs_per_ctn <> 128 then
    raise exception 'the receipt says % pieces a carton, not 128 — the evidence for 32 no longer holds', v_pcs_per_ctn;
  end if;

  update skus set internal_code = v_new, updated_at = now() where id = v_id;

  insert into audit_log (table_name, record_id, action, field_name,
                         old_value, new_value, reason, changed_by)
  values ('skus', v_id, 'update', 'internal_code', v_old, v_new,
          'Code said 34 per pack; the configuration, the receipt (5 cartons = 640 pieces = 128 a carton) '
          'and every sale all say 32. Label corrected to match. No pack size, cost, price or stock changed.',
          null);
end $$;

do $$
declare v_bad text;
begin
  -- No product's code may disagree with its own pack configuration.
  select string_agg(internal_code, ', ') into v_bad
    from skus
   where internal_code ~ '[0-9]+x[0-9]+$'
     and (pcs_per_pack     <> substring(internal_code from '([0-9]+)x[0-9]+$')::int
       or packs_per_carton <> substring(internal_code from '[0-9]+x([0-9]+)$')::int);
  if v_bad is not null then
    raise exception 'product code(s) still disagree with their pack configuration: %', v_bad;
  end if;
end $$;

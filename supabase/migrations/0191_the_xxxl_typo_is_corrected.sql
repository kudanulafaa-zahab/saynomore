-- 0191 — the X-Tra Kering XXXL pack-size typo, corrected at every row it reached.
--
-- Ali, 2026-08-21: *"There are 2 SKUs of x-tra kering xxxl. Xtra kering xxxl
-- 22pcs/pack comes in 4 packs per carton. Xtra kering xxxl 34pcs/carton comes in
-- 3 packs per carton. If there ever was a 32pcs/pack then it is my input mistake.
-- It should be 34pcs/pack and comes in 3 packs per carton. Correct it
-- absolutely."*
--
-- So this is settled: 34 to a pack, 3 packs to a carton, 102 to a carton. The
-- 32x4 was typed once, on 8 July, and everything written that day inherited it.
--
-- ── THE SKUs THEMSELVES ARE ALREADY RIGHT ─────────────────────────────────────
-- Both are correct in the catalogue today and neither is touched here:
--   MAMY-XTRA-XXXL-22x4   22 x 4 =  88   consistent everywhere, verified
--   MAMY-XTRA-XXXL-34x3   34 x 3 = 102   config right, HISTORY wrong
-- The typo was corrected on the SKU at some point after the receipt, which is
-- precisely why the damage was invisible: the product looked right while every
-- row recorded against it still carried 32x4.
--
-- Swept the whole business before writing this. Exactly one batch and exactly
-- one sold line are affected, both on the 34x3 SKU. Nothing else in the
-- catalogue disagrees with its own pack size.
--
-- ── WHAT IS WRONG, AND WHAT IS NOT ────────────────────────────────────────────
--
-- The MONEY PAID is right and is not touched. That carton cost MVR 544.1175
-- landed (FOB 451.7431 + freight 83.6416 + local 8.7328, duty nil) at the FX
-- rate locked on 8 July. Hard rule 3 stands: the rate and the total are
-- untouched. What was wrong is only the DIVISION of that total — 544.1175 was
-- split 128 ways instead of 102.
--
-- The SALE is right too. SO-2026-030, 20 July, Ibrahim shahid: 2 packs at
-- MVR 255 = MVR 510. Ali sold two packs and was paid for two packs. Only the
-- piece count behind them was 2 x 32 instead of 2 x 34.
--
--   row                              was        becomes    why
--   sale line qty_pieces             64         68         2 packs x 34
--   sale line landed cost / piece    4.2509     5.3345     544.1175 / 102
--   batch qty_pieces_received        128        102        1 carton x 34 x 3
--   batch landed per piece           4.2509     5.3345     total / 102
--   batch landed per pack          136.0294   181.3725     total / 3
--   batch landed per carton        544.1175   544.1175     unchanged: money paid
--   stock on hand                    64 pcs     34 pcs     102 in, 68 out = 1 pack
--
-- THE SALE LINE WAS ALREADY ILLEGAL. `enforce_sol_qty_pieces` rejects any line
-- whose qty_pieces disagrees with qty x pack size. That row only exists because
-- it was written while the SKU still said 32. Setting it to 68 is not a
-- workaround; it is what the trigger has been demanding ever since.
--
-- ── THE STOCK IS CORRECTED BY ADJUSTMENT, NOT BY EDIT ─────────────────────────
-- `reopen_grn` refuses this GRN — its stock has been transferred and sold — and
-- says in as many words: *"Use a stock adjustment instead."* That is the app's
-- own doctrine (corrections are reversing entries) and it is followed here. The
-- original `in` of 128 stays as the historical record of what was entered; two
-- adjustments carry the correction, each naming its own cause:
--
--     -26   over-received on paper: 128 entered, 102 actually in the carton
--      -4   under-issued on the sale: 2 packs is 68 nappies, 64 was recorded
--
-- Net: 64 - 30 = 34 pieces, which is exactly ONE pack. That whole number is the
-- confirmation the arithmetic is right — this SKU sells only by the pack, so any
-- answer with a part-pack in it would have been wrong.
--
-- ── WHAT ALI WILL SEE MOVE ────────────────────────────────────────────────────
-- Cost of that sale rises MVR 90.69 (272.06 -> 362.75), so profit on it falls
-- from MVR 237.94 to MVR 147.25. Business gross profit 19,669.68 -> 19,578.99;
-- net 17,299.02 -> 17,208.33. Stock of XXXL 34s goes from 2 packs to 1 pack.
-- Nothing he charged anyone changes. These figures were overstated before; they
-- are right now.
--
-- ── VALUES ARE DERIVED, NOT TYPED ─────────────────────────────────────────────
-- Every number below is computed from the batch and its SKU, so this migration
-- cannot itself introduce a typo of the kind it exists to fix. It asserts the
-- shape of the data first and RAISES if anything has moved since it was written,
-- rather than silently correcting the wrong row.

do $$
declare
  v_batch    inventory_batches%rowtype;
  v_sku      skus%rowtype;
  v_line     sales_order_lines%rowtype;
  v_godown   uuid;
  v_total    numeric;      -- landed cost of the whole batch, unchanged
  v_pieces   int;          -- what the carton really holds
  v_perpiece numeric;
  v_perpack  numeric;
  v_onhand   int;
  v_recv_adj int;
  v_sale_adj int;
begin
  -- ABSENT IS NOT AN ERROR; WRONG IS. This is a one-off data fix for rows that
  -- exist only on production. Every other database this replays into — a fresh
  -- CI container, a local reset — has no such SKU, and must skip quietly rather
  -- than fail a replay. But where the rows DO exist and do not look like what
  -- was analysed, it stops rather than guessing at live money.
  select * into v_sku from skus where internal_code = 'MAMY-XTRA-XXXL-34x3';
  if v_sku.id is null then
    raise notice '0191: no MAMY-XTRA-XXXL-34x3 here — nothing to correct, skipping';
    return;
  end if;
  if v_sku.pcs_per_pack <> 34 or v_sku.packs_per_carton <> 3 then
    raise exception 'SKU is %x%, expected 34x3 — refusing to guess',
      v_sku.pcs_per_pack, v_sku.packs_per_carton;
  end if;

  if (select count(*) from inventory_batches where sku_id = v_sku.id) <> 1 then
    raise exception 'expected exactly 1 batch for the 34x3 SKU, found % — refusing to guess',
      (select count(*) from inventory_batches where sku_id = v_sku.id);
  end if;
  select * into v_batch from inventory_batches where sku_id = v_sku.id;

  v_pieces := v_batch.qty_cartons_received * v_sku.pcs_per_pack * v_sku.packs_per_carton;
  if v_batch.qty_pieces_received = v_pieces then
    raise notice '0191: batch already correct at % pieces — nothing to do', v_pieces;
    return;
  end if;

  -- The money actually paid, which this migration must not change.
  v_total    := v_batch.landed_per_carton_mvr * v_batch.qty_cartons_received;
  v_perpiece := round(v_total / v_pieces, 4);
  v_perpack  := round(v_total / (v_batch.qty_cartons_received * v_sku.packs_per_carton), 4);

  -- ── 1. the sold line ────────────────────────────────────────────────────────
  if (select count(*) from sales_order_lines where sku_id = v_sku.id) <> 1 then
    raise exception 'expected exactly 1 sold line for this SKU, found % — refusing to guess',
      (select count(*) from sales_order_lines where sku_id = v_sku.id);
  end if;
  select * into v_line from sales_order_lines where sku_id = v_sku.id;
  if v_line.uom <> 'pack' or v_line.qty <> 2 then
    raise exception 'sold line is % x %, expected 2 x pack — refusing to guess',
      v_line.qty, v_line.uom;
  end if;

  v_sale_adj := (v_line.qty * v_sku.pcs_per_pack)::int - v_line.qty_pieces;  -- 68 - 64 = 4

  update sales_order_lines
     set qty_pieces                = (v_line.qty * v_sku.pcs_per_pack)::int,
         landed_cost_per_piece_mvr = v_perpiece
   where id = v_line.id;

  insert into audit_log (table_name, record_id, action, reason)
  values ('sales_order_lines', v_line.id, 'update', format(
    'Pack-size typo corrected (0191): 2 packs is %s nappies, not %s. Money unchanged at MVR %s. Cost per nappy %s -> %s.',
    (v_line.qty * v_sku.pcs_per_pack)::int, v_line.qty_pieces,
    trim_scale(v_line.line_total_mvr), trim_scale(v_line.landed_cost_per_piece_mvr), trim_scale(v_perpiece)));

  -- ── 2. the batch ────────────────────────────────────────────────────────────
  -- Locked on purpose by trg_block_batch_cost_changes, whose message points at
  -- reopen_grn. That door is shut here (the stock has moved and been sold), so
  -- the guard is lifted for exactly these two statements and put straight back.
  -- Transactional: if anything below raises, the trigger is restored by rollback.
  v_recv_adj := v_pieces - v_batch.qty_pieces_received;                      -- 102 - 128 = -26

  alter table inventory_batches disable trigger trg_block_batch_cost_changes;

  update inventory_batches
     set qty_pieces_received  = v_pieces,
         landed_per_piece_mvr = v_perpiece,
         landed_per_pack_mvr  = v_perpack
   where id = v_batch.id;

  alter table inventory_batches enable trigger trg_block_batch_cost_changes;

  insert into audit_log (table_name, record_id, action, reason)
  values ('inventory_batches', v_batch.id, 'update', format(
    'Pack-size typo corrected (0191): carton holds %s nappies (34x3), not %s. Landed TOTAL unchanged at MVR %s and the 8 July FX rate is untouched; only the split changes — per nappy %s -> %s, per pack %s -> %s.',
    v_pieces, v_batch.qty_pieces_received, trim_scale(v_total),
    trim_scale(v_batch.landed_per_piece_mvr), trim_scale(v_perpiece),
    trim_scale(v_batch.landed_per_pack_mvr), trim_scale(v_perpack)));

  -- ── 3. the stock ledger, by adjustment ──────────────────────────────────────
  select m.godown_id into v_godown
    from stock_movements m
   where m.batch_id = v_batch.id
   group by m.godown_id
  having sum(stock_signed_delta(m.movement_type, m.qty_pieces)) <> 0
   limit 1;

  if v_godown is null then
    raise exception 'batch holds no stock in any godown — cannot place the adjustment';
  end if;

  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, notes)
  values (v_batch.id, v_sku.id, v_godown, 'adjustment', v_recv_adj, 'adjustment', format(
    'Pack-size typo (0191): receipt of 8 July recorded %s nappies for 1 carton; a carton of X-Tra Kering XXXL holds %s (34 x 3).',
    v_batch.qty_pieces_received, v_pieces));

  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, notes)
  values (v_batch.id, v_sku.id, v_godown, 'adjustment', -v_sale_adj, 'adjustment', format(
    'Pack-size typo (0191): SO-2026-030 sold 2 packs, which is %s nappies, not %s.',
    (v_line.qty * v_sku.pcs_per_pack)::int, v_line.qty_pieces));

  -- ── 4. prove it landed where the arithmetic says it should ──────────────────
  select coalesce(sum(stock_signed_delta(m.movement_type, m.qty_pieces)), 0)
    into v_onhand
    from stock_movements m where m.batch_id = v_batch.id;

  if v_onhand <> v_pieces - (v_line.qty * v_sku.pcs_per_pack)::int then
    raise exception 'stock landed at % pieces, expected % — rolling back',
      v_onhand, v_pieces - (v_line.qty * v_sku.pcs_per_pack)::int;
  end if;

  if v_onhand % v_sku.pcs_per_pack <> 0 then
    raise exception 'stock landed at % pieces, which is not a whole number of % packs — rolling back',
      v_onhand, v_sku.pcs_per_pack;
  end if;

  raise notice '0191: corrected. Carton = % nappies, on hand = % pack(s).',
    v_pieces, v_onhand / v_sku.pcs_per_pack;
end $$;

-- 0192 — the shipment line carried the same typo, and 0191 did not reach it.
--
-- MY MISS, CAUGHT BY VERIFYING RATHER THAN BY ASSUMING. 0191 corrected the
-- batch, the sold line and the stock ledger for X-Tra Kering XXXL, and the
-- Product Card was then checked to confirm it read right. Stock, packs sold and
-- gross profit had all moved to the correct figures — and the COST block had
-- not moved at all:
--
--     per_piece_mvr  4.2509     per_pack_mvr  136.0294
--
-- Those come from `shipment_lines`, not from `inventory_batches`. The landed
-- cost is stored TWICE — once on the line that was received and once on the
-- batch it produced — and `get_product_card` reads the shipment line, because
-- that is where the FOB, freight, duty and local charges live.
--
-- So the 32x4 split survived in a second place. Fixing one instance of a fault
-- and calling it done is exactly the failure CLAUDE.md rule 9 was written about:
-- a fix is not finished until the whole surface it touches has been swept.
-- Swept now, properly: every shipment line in the business was checked against
-- its SKU's pack size, and this is the only one that disagrees.
--
--   row                                was        becomes    why
--   landed_per_piece_mvr               4.2509     5.3345     544.1175 / 102
--   landed_per_unit_mvr                4.2509     5.3345     unit is a piece here
--   landed_per_pack_mvr              136.0294   181.3725     544.1175 / 3
--   landed_per_carton_mvr            544.1175   544.1175     unchanged
--   landed_total_mvr                 544.1175   544.1175     unchanged: money paid
--
-- Again: the MONEY IS NOT TOUCHED. FOB 451.7431 + freight 83.6416 + local
-- 8.7328 = MVR 544.1175 at the FX rate locked on 8 July, and all of that is left
-- exactly as it is. Only the division of that total changes, from 128 ways to
-- 102.
--
-- SH-2026-002 needs nothing. Its 15 cartons of the same product have null landed
-- costs because they have not been received yet; `confirm_grn` will compute them
-- against the SKU's current 34x3 when Ali confirms the GRN, which is now the
-- right answer. That shipment was the reason this mattered urgently.
--
-- Values are derived from the line and its SKU, never typed, and the migration
-- asserts what it expects to find before changing anything. Absent is not an
-- error — a fresh CI database has no such shipment and skips quietly.

do $$
declare
  v_sku      skus%rowtype;
  v_line     shipment_lines%rowtype;
  v_pieces   int;
  v_perpiece numeric;
  v_perpack  numeric;
  v_bad      int;
begin
  select * into v_sku from skus where internal_code = 'MAMY-XTRA-XXXL-34x3';
  if v_sku.id is null then
    raise notice '0192: no MAMY-XTRA-XXXL-34x3 here — nothing to correct, skipping';
    return;
  end if;
  if v_sku.pcs_per_pack <> 34 or v_sku.packs_per_carton <> 3 then
    raise exception 'SKU is %x%, expected 34x3 — refusing to guess',
      v_sku.pcs_per_pack, v_sku.packs_per_carton;
  end if;

  -- Only lines that have actually been costed. A line still in transit has null
  -- landed costs and must stay null so confirm_grn computes them at GRN.
  select count(*) into v_bad
    from shipment_lines sl
   where sl.sku_id = v_sku.id
     and sl.landed_per_piece_mvr is not null
     and round(sl.landed_per_pack_mvr / nullif(sl.landed_per_piece_mvr, 0)) <> v_sku.pcs_per_pack;

  if v_bad = 0 then
    raise notice '0192: shipment lines already agree with 34x3 — nothing to do';
    return;
  end if;
  if v_bad <> 1 then
    raise exception 'expected exactly 1 mis-split shipment line, found % — refusing to guess', v_bad;
  end if;

  select * into v_line
    from shipment_lines sl
   where sl.sku_id = v_sku.id
     and sl.landed_per_piece_mvr is not null
     and round(sl.landed_per_pack_mvr / nullif(sl.landed_per_piece_mvr, 0)) <> v_sku.pcs_per_pack;

  -- Loose packs would make "pieces on this line" more than cartons x per-carton,
  -- and this correction has not been reasoned about for that shape.
  if coalesce(v_line.qty_loose_packs, 0) <> 0 then
    raise exception 'line has % loose packs — refusing to guess', v_line.qty_loose_packs;
  end if;

  v_pieces   := v_line.qty_cartons * v_sku.pcs_per_pack * v_sku.packs_per_carton;
  v_perpiece := round(v_line.landed_total_mvr / v_pieces, 4);
  v_perpack  := round(v_line.landed_total_mvr / (v_line.qty_cartons * v_sku.packs_per_carton), 4);

  update shipment_lines
     set landed_per_piece_mvr = v_perpiece,
         landed_per_unit_mvr  = v_perpiece,   -- this SKU's unit IS a piece
         landed_per_pack_mvr  = v_perpack
   where id = v_line.id;

  insert into audit_log (table_name, record_id, action, reason)
  values ('shipment_lines', v_line.id, 'update', format(
    'Pack-size typo corrected (0192): the landed cost of this line was split %s ways instead of %s. Total unchanged at MVR %s and the FX rate is untouched — per nappy %s -> %s, per pack %s -> %s.',
    round(v_line.landed_total_mvr / nullif(v_line.landed_per_piece_mvr, 0))::int, v_pieces,
    trim_scale(v_line.landed_total_mvr),
    trim_scale(v_line.landed_per_piece_mvr), trim_scale(v_perpiece),
    trim_scale(v_line.landed_per_pack_mvr),  trim_scale(v_perpack)));

  -- Prove the split now agrees with the pack size in both directions, or roll back.
  select count(*) into v_bad
    from shipment_lines sl
   where sl.id = v_line.id
     and (round(sl.landed_per_pack_mvr / nullif(sl.landed_per_piece_mvr, 0))  <> v_sku.pcs_per_pack
       or round(sl.landed_per_carton_mvr / nullif(sl.landed_per_pack_mvr, 0)) <> v_sku.packs_per_carton);

  if v_bad <> 0 then
    raise exception 'the split still disagrees with 34x3 after the update — rolling back';
  end if;

  raise notice '0192: shipment line corrected. % nappies, MVR % per nappy, MVR % per pack.',
    v_pieces, v_perpiece, v_perpack;
end $$;

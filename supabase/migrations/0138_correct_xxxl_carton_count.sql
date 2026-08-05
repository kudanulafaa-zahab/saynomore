-- 0138 — Correct the one carton of MAMY-XTRA-XXXL-34x3 booked as 128 pieces.
--
-- This was carried as an open question for several sessions ("is the carton
-- 102 or 128?"). It did not need asking — the answer is in Ali's own data,
-- twice over.
--
-- PROOF 1 — his own pricing. He set MVR 270 for the XXXL 34-pack and MVR 175
-- for the XXXL 22-pack. That is 7.94 and 7.95 per piece: one laari apart. A
-- person only prices two packs at the same per-piece rate if the packs really
-- hold 34 and 22. pcs_per_pack = 34 is therefore correct, and 128 (= 32 x 4)
-- would contradict a price he set himself.
--
-- PROOF 2 — physical volume, which no negotiation or pack format can change.
-- Per piece, from the shipment's own CBM:
--     XXL      34x4 = 136 pcs  ->  237 mm3
--     XXXL     22x4 =  88 pcs  ->  366 mm3
--     XXXL     34x3 = 102 pcs  ->  343 mm3   <- 6% from its XXXL sibling
--     XXXL if carton were 128  ->  273 mm3   <- 25% off, and barely above XXL
-- The same diaper occupies the same space. 102 puts the two XXXL SKUs within
-- 6% of each other; 128 would make an XXXL nearly the size of an XXL.
--
-- So the SKU record (34 x 3 = 102) is RIGHT and the GRN booking of 128 is the
-- error — the reverse of what was previously assumed. Future receipts already
-- book correctly at 102; only this historical batch is wrong.
--
-- Consequences being corrected here:
--   * 26 phantom pieces on the shelf (app said 64 on hand, truly 38).
--   * Landed cost divided by 128 instead of 102, so the batch was valued at
--     MVR 4.2509/piece instead of 5.3345 — 21% too cheap.
--
-- NOT corrected, deliberately: the 64 pieces already sold carry the 4.2509
-- cost snapshot on their order lines. Those are locked, and locked is correct
-- — this app does not rewrite posted history. The effect is that reported
-- gross profit on those past sales is overstated by about MVR 69, which is
-- disclosed rather than silently patched.

do $$
declare
  v_batch   uuid;
  v_sku     uuid;
  v_godown  uuid;
  v_booked  integer;
  v_true    integer := 102;
  v_total   numeric;
begin
  select ib.id, ib.sku_id, ib.godown_id, ib.qty_pieces_received, sl.landed_total_mvr
    into v_batch, v_sku, v_godown, v_booked, v_total
  from inventory_batches ib
  join shipment_lines sl on sl.id = ib.shipment_line_id
  join skus s on s.id = ib.sku_id
  where s.internal_code = 'MAMY-XTRA-XXXL-34x3';

  if v_batch is null then
    raise notice 'Batch not found — nothing to correct.';
    return;
  end if;
  if v_booked = v_true then
    raise notice 'Already corrected — skipping.';
    return;
  end if;

  -- Stock: a correcting ENTRY, never an edit to the original 'in' movement.
  -- stock_signed_delta treats 'adjustment' as already-signed, so this is -26.
  insert into stock_movements
    (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, notes)
  values
    (v_batch, v_sku, v_godown, 'adjustment', v_true - v_booked, 'adjustment',
     format('Receipt correction: carton booked as %s pieces, actual is %s '
            '(34 x 3). Confirmed from pack pricing (MVR 270/34 = 7.94/pc, '
            'matching the 22-pack at 7.95/pc) and from carton volume '
            '(343 mm3/pc, within 6%% of the other XXXL; 128 would give 273 '
            'mm3/pc, below a plausible XXXL). Migration 0138.',
            v_booked, v_true));

  -- Valuation: the carton's total landed cost is right; only the division by
  -- piece count was wrong. Fixing it values the remaining stock correctly.
  update inventory_batches
     set qty_pieces_received = v_true,
         landed_per_piece_mvr = round(v_total / v_true, 4),
         landed_per_pack_mvr  = round(v_total / v_true, 4) * 34,
         landed_per_carton_mvr = round(v_total, 4)
   where id = v_batch;

  insert into audit_log (table_name, record_id, action, reason)
  values ('inventory_batches', v_batch, 'update',
          format('Carton count corrected %s -> %s pieces; landed cost '
                 'MVR %s -> %s per piece. Evidence: own pack pricing and '
                 'carton volume both indicate 34 x 3. Migration 0138.',
                 v_booked, v_true,
                 to_char(round(v_total / v_booked, 4), 'FM990.0000'),
                 to_char(round(v_total / v_true,   4), 'FM990.0000')));
end $$;

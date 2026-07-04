-- ── Migration 0057: landed-cost engine integrity guarantees ──
--
-- The engine's MATH is verified correct on live data (FOB+freight+local
-- reconciles to the cent; one batch + one 'in' movement per line; no
-- orphans). This migration adds the DATABASE-LEVEL guarantees that make
-- the money trail impossible to corrupt regardless of which screen,
-- retry, race, or future bug writes to it — the "no duplicates, money
-- trail intact" guarantee.
--
-- Per the landed-cost doctrine (never re-derive a confirmed cost; every
-- money field reconstructable; per-piece is the atomic unit):
--
--  (1) DUPLICATE-RECEIPT GUARD. inventory_batches had no uniqueness on
--      shipment_line_id — only confirm_grn's status check stopped a
--      double receipt. A concurrent/retried GRN could create two batches
--      for one line = duplicated stock + doubled cost. Add UNIQUE. This
--      is correct while a shipment_line is received in exactly one GRN
--      event (today's model). NOTE FOR FUTURE: if partial/split receipts
--      are ever added, drop this and key idempotency on a grn_event_id
--      instead — a shipment_line legitimately gets multiple batches then.
--
--  (2) SALE-LINE MONEY INTEGRITY. line_total_mvr and qty_pieces are
--      computed in 3 frontend paths with nothing forcing agreement.
--      - line_total: tolerance CHECK (mixed-carton per-piece pricing
--        makes exact equality fragile; 0.02 covers piece-rounding).
--      - qty_pieces: needs the SKU's pack config, so a trigger (a CHECK
--        can't join). Recomputes and hard-fails on mismatch.
--
--  (3) CONFIRMED-COST IMMUTABILITY. The rate-lock trigger froze forex
--      after GRN but NOT the freight/customs/local inputs — a direct
--      write could change a confirmed shipment's landed cost without
--      re-running the engine, silently desyncing batches from their
--      source. Extend the lock to every cost input. (void/reopen is the
--      sanctioned path to change them, which rebuilds batches cleanly.)
--
--  (4) BATCH-COST IMMUTABILITY. A batch's locked landed cost must never
--      change after it's written (sales snapshot from it). Block UPDATEs
--      to the landed_* columns.
--
-- All guards dry-run-verified against live data first (zero violations).

BEGIN;

-- ── (1) One batch per shipment line ────────────────────────────────────────
ALTER TABLE inventory_batches
  ADD CONSTRAINT inventory_batches_one_per_line UNIQUE (shipment_line_id);

-- ── (2a) line_total ≈ qty × unit_price (tolerance for piece-rounding) ──────
ALTER TABLE sales_order_lines
  ADD CONSTRAINT sol_line_total_matches
    CHECK (abs(line_total_mvr - (qty * unit_price_mvr)) <= 0.02);

-- ── (2b) qty_pieces = qty × uom conversion (needs SKU join → trigger) ──────
CREATE OR REPLACE FUNCTION enforce_sol_qty_pieces()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_expected INTEGER;
  v_pcs INTEGER; v_ppc INTEGER;
BEGIN
  SELECT pcs_per_pack, packs_per_carton INTO v_pcs, v_ppc
  FROM skus WHERE id = NEW.sku_id;
  v_expected := NEW.qty * CASE NEW.uom
    WHEN 'carton' THEN v_pcs * v_ppc
    WHEN 'pack'   THEN v_pcs
    ELSE 1
  END;
  IF NEW.qty_pieces <> v_expected THEN
    RAISE EXCEPTION 'qty_pieces (%) does not match % % × conversion (expected %) — sale line rejected to protect the cost/stock ledger',
      NEW.qty_pieces, NEW.qty, NEW.uom, v_expected;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_sol_qty_pieces
BEFORE INSERT OR UPDATE ON sales_order_lines
FOR EACH ROW EXECUTE FUNCTION enforce_sol_qty_pieces();

-- ── (3) Freeze ALL cost inputs after GRN (extends the existing rate lock) ──
CREATE OR REPLACE FUNCTION block_grn_rate_changes()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'grn_confirmed' AND NEW.status = 'grn_confirmed' THEN
    IF NEW.rate_idr_to_mvr IS DISTINCT FROM OLD.rate_idr_to_mvr
    OR NEW.rate_usd_to_mvr IS DISTINCT FROM OLD.rate_usd_to_mvr
    OR NEW.rate_idr_to_usd IS DISTINCT FROM OLD.rate_idr_to_usd
    OR NEW.rate_usd_to_idr IS DISTINCT FROM OLD.rate_usd_to_idr
    OR NEW.my_freight_share_usd IS DISTINCT FROM OLD.my_freight_share_usd
    OR NEW.customs_duty_mvr IS DISTINCT FROM OLD.customs_duty_mvr
    OR NEW.mpl_charges_mvr   IS DISTINCT FROM OLD.mpl_charges_mvr
    OR NEW.agent_fee_mvr     IS DISTINCT FROM OLD.agent_fee_mvr
    OR NEW.last_mile_mvr     IS DISTINCT FROM OLD.last_mile_mvr
    OR NEW.insurance_mvr     IS DISTINCT FROM OLD.insurance_mvr
    OR NEW.other_mvr         IS DISTINCT FROM OLD.other_mvr THEN
      RAISE EXCEPTION 'Costs are locked after GRN confirmation — reopen or void the GRN to correct them (that rebuilds the landed cost cleanly)';
    END IF;
  END IF;
  -- The reopen_grn/void path sets status away from grn_confirmed FIRST,
  -- so this only fires while the shipment stays confirmed. Editing during
  -- reopen (status='ordered') passes freely.
  RETURN NEW;
END $$;

-- ── (4) A batch's landed cost is written once, never edited ────────────────
CREATE OR REPLACE FUNCTION block_batch_cost_changes()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.landed_per_piece_mvr  IS DISTINCT FROM OLD.landed_per_piece_mvr
  OR NEW.landed_per_pack_mvr   IS DISTINCT FROM OLD.landed_per_pack_mvr
  OR NEW.landed_per_carton_mvr IS DISTINCT FROM OLD.landed_per_carton_mvr
  OR NEW.qty_pieces_received   IS DISTINCT FROM OLD.qty_pieces_received THEN
    RAISE EXCEPTION 'A batch''s locked landed cost / received qty cannot be edited — void or reopen the GRN to rebuild it';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_block_batch_cost_changes
BEFORE UPDATE ON inventory_batches
FOR EACH ROW EXECUTE FUNCTION block_batch_cost_changes();

COMMIT;

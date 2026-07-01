-- ── Migration 0048: Reopen / delete a confirmed GRN (admin & manager only) ──
--
-- Business need: staff sometimes need to correct a shipment after GRN
-- confirmation (wrong FOB price, missed a line, wrong forex rate). Until now
-- confirm_grn() permanently locks the shipment — there was no way back.
--
-- Rules (confirmed by Ali 2026-07-01):
--   - Only 'admin' or 'manager' roles may reopen or delete a confirmed GRN.
--   - Every reopen/delete is logged to the existing audit_log table with a
--     full before-snapshot (shipment + lines as JSON) so nothing is lost.
--   - Safety guard: if ANY stock this GRN brought in has already been sold
--     (i.e. a stock_movements 'out' row exists against one of its batches),
--     reopening is blocked outright. Correcting a GRN after its stock has
--     already been sold would silently corrupt the cost basis of past sales
--     (sales_order_lines.landed_cost_per_piece_mvr is snapshotted forever,
--     per migration 0045 — we must never retroactively invalidate that).
--     There is no override for this — it requires a separate stock
--     adjustment / correction flow, not a GRN reopen.
--
-- reopen_grn(shipment_id):
--   - Deletes the inventory_batches + stock_movements this GRN created
--     (safe only because the guard above proved nothing was consumed).
--   - Resets shipment_lines' computed cost columns to NULL and shipment
--     status back to 'ordered' so the existing edit UI (pre-confirm) works
--     unchanged — Ali edits it exactly like an unconfirmed shipment, then
--     re-runs Confirm Receipt, which re-runs confirm_grn() as normal.
--
-- delete_grn(shipment_id):
--   - Same guard, then hard-deletes the shipment (lines cascade).

BEGIN;

CREATE OR REPLACE FUNCTION reopen_grn(p_shipment_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ship        shipments%ROWTYPE;
  v_user        UUID := auth.uid();
  v_before_ship JSONB;
  v_before_lines JSONB;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only admin or manager can reopen a confirmed GRN';
  END IF;

  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment % not found', p_shipment_id;
  END IF;
  IF v_ship.status <> 'grn_confirmed' THEN
    RAISE EXCEPTION 'Shipment is not confirmed — nothing to reopen';
  END IF;

  -- Guard: block if any stock from this GRN has already been sold/moved out.
  IF EXISTS (
    SELECT 1
    FROM inventory_batches b
    JOIN shipment_lines sl ON sl.id = b.shipment_line_id
    JOIN stock_movements sm ON sm.batch_id = b.id
    WHERE sl.shipment_id = p_shipment_id
      AND sm.movement_type <> 'in'
  ) THEN
    RAISE EXCEPTION 'Cannot reopen — stock from this GRN has already been sold or moved. Use a stock adjustment instead.';
  END IF;

  -- Snapshot full before-state for the audit trail.
  SELECT to_jsonb(v_ship) INTO v_before_ship;
  SELECT COALESCE(jsonb_agg(to_jsonb(sl)), '[]'::jsonb) INTO v_before_lines
    FROM shipment_lines sl WHERE sl.shipment_id = p_shipment_id;

  -- Remove the stock this GRN created (safe: guard above proved qty untouched).
  DELETE FROM stock_movements
  WHERE batch_id IN (
    SELECT b.id FROM inventory_batches b
    JOIN shipment_lines sl ON sl.id = b.shipment_line_id
    WHERE sl.shipment_id = p_shipment_id
  );
  DELETE FROM inventory_batches
  WHERE shipment_line_id IN (
    SELECT id FROM shipment_lines WHERE shipment_id = p_shipment_id
  );

  -- Reset computed cost columns so re-confirming recalculates cleanly.
  UPDATE shipment_lines SET
    fob_total_mvr           = NULL,
    apportioned_freight_mvr = NULL,
    apportioned_local_mvr   = NULL,
    landed_total_mvr        = NULL,
    landed_per_carton_mvr   = NULL,
    landed_per_pack_mvr     = NULL,
    landed_per_piece_mvr    = NULL,
    landed_per_unit_mvr     = NULL,
    grn_variance_pct        = NULL
  WHERE shipment_id = p_shipment_id;

  UPDATE shipments SET
    status           = 'ordered',
    grn_confirmed_at = NULL,
    grn_confirmed_by = NULL
  WHERE id = p_shipment_id;

  INSERT INTO audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  VALUES (
    'shipments', p_shipment_id, 'reopen_grn',
    'status', 'grn_confirmed', 'ordered',
    jsonb_build_object('shipment', v_before_ship, 'lines', v_before_lines)::text,
    v_user
  );

  RETURN p_shipment_id;
END $$;

CREATE OR REPLACE FUNCTION delete_grn(p_shipment_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ship         shipments%ROWTYPE;
  v_user         UUID := auth.uid();
  v_before_ship  JSONB;
  v_before_lines JSONB;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only admin or manager can delete a shipment';
  END IF;

  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment % not found', p_shipment_id;
  END IF;

  IF v_ship.status = 'grn_confirmed' THEN
    IF EXISTS (
      SELECT 1
      FROM inventory_batches b
      JOIN shipment_lines sl ON sl.id = b.shipment_line_id
      JOIN stock_movements sm ON sm.batch_id = b.id
      WHERE sl.shipment_id = p_shipment_id
        AND sm.movement_type <> 'in'
    ) THEN
      RAISE EXCEPTION 'Cannot delete — stock from this GRN has already been sold or moved.';
    END IF;
  END IF;

  SELECT to_jsonb(v_ship) INTO v_before_ship;
  SELECT COALESCE(jsonb_agg(to_jsonb(sl)), '[]'::jsonb) INTO v_before_lines
    FROM shipment_lines sl WHERE sl.shipment_id = p_shipment_id;

  DELETE FROM stock_movements
  WHERE batch_id IN (
    SELECT b.id FROM inventory_batches b
    JOIN shipment_lines sl ON sl.id = b.shipment_line_id
    WHERE sl.shipment_id = p_shipment_id
  );
  DELETE FROM inventory_batches
  WHERE shipment_line_id IN (
    SELECT id FROM shipment_lines WHERE shipment_id = p_shipment_id
  );

  INSERT INTO audit_log (table_name, record_id, action, reason, old_value, changed_by)
  VALUES (
    'shipments', p_shipment_id, 'delete',
    'Shipment deleted', jsonb_build_object('shipment', v_before_ship, 'lines', v_before_lines)::text,
    v_user
  );

  DELETE FROM shipments WHERE id = p_shipment_id;
END $$;

COMMIT;

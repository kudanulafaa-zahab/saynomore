-- ── Migration 0051: Fix reopen_grn() audit_log insert ──
--
-- Bug found via live testing: reopen_grn() (migration 0048) inserted
-- action = 'reopen_grn' into audit_log, but audit_log.action has a CHECK
-- constraint only allowing 'insert' | 'update' | 'delete'. Every reopen
-- attempt failed with a 23514 constraint violation before this fix.
-- Using 'update' (status changes from grn_confirmed -> ordered), matching
-- the pattern the rest of the codebase already uses.

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
    'shipments', p_shipment_id, 'update',
    'status', 'grn_confirmed', 'ordered',
    jsonb_build_object('shipment', v_before_ship, 'lines', v_before_lines)::text,
    v_user
  );

  RETURN p_shipment_id;
END $$;

COMMIT;

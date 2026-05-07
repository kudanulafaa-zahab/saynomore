-- ============================================================================
-- 0005 — Admin void GRN (delete locked shipment + reverse stock)
-- ============================================================================
-- Allows an admin to completely remove a grn_confirmed shipment and its
-- inventory impact, BUT only if none of the stock from that shipment has
-- been sold (i.e. no "out" movements exist against those batches).
--
-- Deletion order (respects FK constraints):
--   stock_movements (in) → inventory_batches → shipment_lines → shipment
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION admin_void_grn(p_shipment_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user       UUID := auth.uid();
  v_status     TEXT;
  v_batch_ids  UUID[];
  v_sold       BIGINT;
BEGIN
  -- Admin only
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can void a confirmed GRN';
  END IF;

  -- Must be grn_confirmed
  SELECT status INTO v_status FROM shipments WHERE id = p_shipment_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Shipment not found';
  END IF;
  IF v_status <> 'grn_confirmed' THEN
    RAISE EXCEPTION 'Only locked (GRN-confirmed) shipments can be voided this way. Use normal delete for draft/ordered/in_transit/arrived shipments.';
  END IF;

  -- Collect all batch IDs from this shipment
  SELECT ARRAY_AGG(id) INTO v_batch_ids
  FROM inventory_batches
  WHERE shipment_id = p_shipment_id;

  -- Block if any stock from these batches has been sold (out movements exist)
  IF v_batch_ids IS NOT NULL THEN
    SELECT COUNT(*) INTO v_sold
    FROM stock_movements
    WHERE batch_id = ANY(v_batch_ids)
      AND movement_type = 'out';

    IF v_sold > 0 THEN
      RAISE EXCEPTION 'Cannot void: % sale transaction(s) already used stock from this shipment. Reverse those sales first.', v_sold;
    END IF;

    -- Delete the "in" stock movements created by this GRN
    DELETE FROM stock_movements
    WHERE batch_id = ANY(v_batch_ids)
      AND movement_type = 'in';

    -- Delete the inventory batches
    DELETE FROM inventory_batches WHERE id = ANY(v_batch_ids);
  END IF;

  -- Delete shipment lines and the shipment itself
  DELETE FROM shipment_lines WHERE shipment_id = p_shipment_id;
  DELETE FROM shipments      WHERE id = p_shipment_id;

  -- Audit
  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('shipments', p_shipment_id, 'delete', 'admin void GRN — stock reversed', v_user);
END $$;

GRANT EXECUTE ON FUNCTION admin_void_grn(UUID) TO authenticated;

COMMIT;

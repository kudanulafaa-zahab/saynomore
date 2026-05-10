-- ── Migration 0009: admin_force_void_grn ─────────────────────────────────
--
-- Admin-only nuclear delete: removes a shipment and ALL dependent data,
-- including any sales orders that drew from its stock.
-- Intended for clearing dummy/test data only — irreversible.
--
-- Deletion order (respects FK constraints):
--   sales_order_lines (that used these SKUs from these orders)
--   sales_orders (that used stock from this shipment)
--   stock_movements (all types for these batches)
--   inventory_batches
--   shipment_lines
--   shipment

CREATE OR REPLACE FUNCTION admin_force_void_grn(p_shipment_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user       UUID    := auth.uid();
  v_status     TEXT;
  v_batch_ids  UUID[];
  v_order_ids  UUID[];
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can force-void a GRN';
  END IF;

  SELECT status INTO v_status FROM shipments WHERE id = p_shipment_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Shipment not found';
  END IF;

  -- Collect batch IDs for this shipment
  SELECT ARRAY_AGG(id) INTO v_batch_ids
  FROM inventory_batches
  WHERE shipment_id = p_shipment_id;

  IF v_batch_ids IS NOT NULL THEN
    -- Find sales orders that deducted stock from these batches
    SELECT ARRAY_AGG(DISTINCT source_id) INTO v_order_ids
    FROM stock_movements
    WHERE batch_id = ANY(v_batch_ids)
      AND movement_type = 'out'
      AND source_type = 'sales_order'
      AND source_id IS NOT NULL;

    -- Delete those sales order lines and orders
    IF v_order_ids IS NOT NULL THEN
      DELETE FROM sales_order_lines WHERE order_id = ANY(v_order_ids);
      DELETE FROM sales_orders       WHERE id       = ANY(v_order_ids);
    END IF;

    -- Delete all stock movements for these batches
    DELETE FROM stock_movements WHERE batch_id = ANY(v_batch_ids);

    -- Delete the batches
    DELETE FROM inventory_batches WHERE id = ANY(v_batch_ids);
  END IF;

  -- Delete shipment lines and the shipment itself
  DELETE FROM shipment_lines WHERE shipment_id = p_shipment_id;
  DELETE FROM shipments      WHERE id = p_shipment_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('shipments', p_shipment_id, 'delete', 'admin force void GRN — all linked sales deleted', v_user);
END $$;

GRANT EXECUTE ON FUNCTION admin_force_void_grn(UUID) TO authenticated;

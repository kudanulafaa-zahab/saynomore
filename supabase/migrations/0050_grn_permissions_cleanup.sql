-- ── Migration 0050: Align GRN void/reopen permissions to admin+manager ──
--
-- Discovered after writing migration 0048 that admin_void_grn() and
-- admin_force_void_grn() already existed (pre-dating this session) and
-- already fully cover "delete a confirmed GRN" — making the delete_grn()
-- function added in 0048 redundant. Dropping it here rather than leaving
-- two functions that do the same thing and could drift apart.
--
-- Both existing void functions were admin-only (is_admin()). Ali's rule
-- (confirmed 2026-07-01): admin AND manager should both be able to
-- edit/delete a confirmed GRN. Widening both to is_admin_or_manager(),
-- matching reopen_grn() from migration 0048.

BEGIN;

DROP FUNCTION IF EXISTS delete_grn(UUID);

CREATE OR REPLACE FUNCTION admin_void_grn(p_shipment_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user       UUID := auth.uid();
  v_status     TEXT;
  v_batch_ids  UUID[];
  v_sold       BIGINT;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only admin or manager can void a confirmed GRN';
  END IF;

  SELECT status INTO v_status FROM shipments WHERE id = p_shipment_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Shipment not found';
  END IF;
  IF v_status <> 'grn_confirmed' THEN
    RAISE EXCEPTION 'Only locked (GRN-confirmed) shipments can be voided this way.';
  END IF;

  SELECT ARRAY_AGG(ib.id) INTO v_batch_ids
  FROM inventory_batches ib
  JOIN shipment_lines sl ON sl.id = ib.shipment_line_id
  WHERE sl.shipment_id = p_shipment_id;

  IF v_batch_ids IS NOT NULL THEN
    SELECT COUNT(*) INTO v_sold
    FROM stock_movements
    WHERE batch_id = ANY(v_batch_ids)
      AND movement_type = 'out';

    IF v_sold > 0 THEN
      RAISE EXCEPTION 'Cannot void: % sale transaction(s) already used stock from this shipment. Reverse those sales first.', v_sold;
    END IF;

    DELETE FROM stock_movements
    WHERE batch_id = ANY(v_batch_ids)
      AND movement_type = 'in';

    DELETE FROM inventory_batches WHERE id = ANY(v_batch_ids);
  END IF;

  DELETE FROM shipment_lines WHERE shipment_id = p_shipment_id;
  DELETE FROM shipments      WHERE id = p_shipment_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('shipments', p_shipment_id, 'delete', 'GRN voided (admin/manager) — stock reversed', v_user);
END $$;

CREATE OR REPLACE FUNCTION admin_force_void_grn(p_shipment_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user        UUID    := auth.uid();
  v_status      TEXT;
  v_line_ids    UUID[];
  v_batch_ids   UUID[];
  v_order_ids   UUID[];
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only admin or manager can force-void a GRN';
  END IF;

  SELECT status INTO v_status FROM shipments WHERE id = p_shipment_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Shipment not found';
  END IF;

  SELECT ARRAY_AGG(id) INTO v_line_ids
  FROM shipment_lines
  WHERE shipment_id = p_shipment_id;

  IF v_line_ids IS NOT NULL THEN
    SELECT ARRAY_AGG(id) INTO v_batch_ids
    FROM inventory_batches
    WHERE shipment_line_id = ANY(v_line_ids);

    IF v_batch_ids IS NOT NULL THEN
      SELECT ARRAY_AGG(DISTINCT source_id) INTO v_order_ids
      FROM stock_movements
      WHERE batch_id   = ANY(v_batch_ids)
        AND movement_type = 'out'
        AND source_type   = 'sales_order'
        AND source_id IS NOT NULL;

      IF v_order_ids IS NOT NULL THEN
        DELETE FROM sales_order_lines WHERE order_id = ANY(v_order_ids);
        DELETE FROM sales_orders       WHERE id       = ANY(v_order_ids);
      END IF;

      DELETE FROM stock_movements WHERE batch_id = ANY(v_batch_ids);
      DELETE FROM inventory_batches WHERE id = ANY(v_batch_ids);
    END IF;
  END IF;

  DELETE FROM shipment_lines WHERE shipment_id = p_shipment_id;
  DELETE FROM shipments      WHERE id          = p_shipment_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('shipments', p_shipment_id, 'delete', 'GRN force-voided (admin/manager) — all linked data deleted', v_user);
END $$;

COMMIT;

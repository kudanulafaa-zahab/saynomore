-- ============================================================================
-- 0004 — Admin-only cascade delete for master data
-- ============================================================================
-- The schema deliberately uses ON DELETE RESTRICT to protect against
-- accidental data loss. But the admin sometimes legitimately wants to nuke
-- a whole brand/model/variant subtree (e.g. cleaning up test data, or
-- removing a discontinued line they will never sell again).
--
-- These RPCs are the controlled way to do it. They:
--   • Refuse if the caller is not 'admin'
--   • Walk the tree downwards, deleting children first
--   • Block if any descendant SKU has been used in a real shipment_line
--     or sales_order_line — that's data you can never legitimately delete
--   • Log the action to audit_log
-- ============================================================================

BEGIN;

-- Helper: are any of these SKUs referenced by transactional data?
CREATE OR REPLACE FUNCTION skus_in_use(p_sku_ids UUID[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM shipment_lines     WHERE sku_id = ANY(p_sku_ids)
    UNION ALL
    SELECT 1 FROM sales_order_lines  WHERE sku_id = ANY(p_sku_ids)
    UNION ALL
    SELECT 1 FROM stock_movements    WHERE sku_id = ANY(p_sku_ids)
    UNION ALL
    SELECT 1 FROM inventory_batches  WHERE sku_id = ANY(p_sku_ids)
  );
$$;

-- ── Brand cascade ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_delete_brand_cascade(p_brand_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_sku_ids UUID[];
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can cascade-delete brands';
  END IF;

  SELECT ARRAY_AGG(s.id) INTO v_sku_ids
  FROM skus s
  JOIN variants v ON v.id = s.variant_id
  JOIN product_models m ON m.id = v.model_id
  WHERE m.brand_id = p_brand_id;

  IF v_sku_ids IS NOT NULL AND skus_in_use(v_sku_ids) THEN
    RAISE EXCEPTION 'Cannot delete: some SKUs under this brand are used in shipments, stock, or sales';
  END IF;

  -- Delete bottom-up
  DELETE FROM skus     WHERE variant_id IN (SELECT v.id FROM variants v JOIN product_models m ON m.id = v.model_id WHERE m.brand_id = p_brand_id);
  DELETE FROM variants WHERE model_id   IN (SELECT id FROM product_models WHERE brand_id = p_brand_id);
  DELETE FROM product_models WHERE brand_id = p_brand_id;
  DELETE FROM brands   WHERE id = p_brand_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('brands', p_brand_id, 'delete', 'admin cascade delete', v_user);
END $$;

-- ── Model cascade ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_delete_model_cascade(p_model_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_sku_ids UUID[];
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can cascade-delete models';
  END IF;

  SELECT ARRAY_AGG(s.id) INTO v_sku_ids
  FROM skus s JOIN variants v ON v.id = s.variant_id
  WHERE v.model_id = p_model_id;

  IF v_sku_ids IS NOT NULL AND skus_in_use(v_sku_ids) THEN
    RAISE EXCEPTION 'Cannot delete: some SKUs under this model are used in shipments, stock, or sales';
  END IF;

  DELETE FROM skus     WHERE variant_id IN (SELECT id FROM variants WHERE model_id = p_model_id);
  DELETE FROM variants WHERE model_id = p_model_id;
  DELETE FROM product_models WHERE id = p_model_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('product_models', p_model_id, 'delete', 'admin cascade delete', v_user);
END $$;

-- ── Variant cascade ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_delete_variant_cascade(p_variant_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_sku_ids UUID[];
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can cascade-delete variants';
  END IF;

  SELECT ARRAY_AGG(id) INTO v_sku_ids FROM skus WHERE variant_id = p_variant_id;

  IF v_sku_ids IS NOT NULL AND skus_in_use(v_sku_ids) THEN
    RAISE EXCEPTION 'Cannot delete: SKUs under this variant are used in transactions';
  END IF;

  DELETE FROM skus WHERE variant_id = p_variant_id;
  DELETE FROM variants WHERE id = p_variant_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('variants', p_variant_id, 'delete', 'admin cascade delete', v_user);
END $$;

-- ── SKU delete (admin only, transactional check) ───────────────────────
CREATE OR REPLACE FUNCTION admin_delete_sku(p_sku_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can delete SKUs';
  END IF;
  IF skus_in_use(ARRAY[p_sku_id]) THEN
    RAISE EXCEPTION 'Cannot delete: this SKU is used in shipments, stock, or sales';
  END IF;

  DELETE FROM skus WHERE id = p_sku_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('skus', p_sku_id, 'delete', 'admin delete', v_user);
END $$;

GRANT EXECUTE ON FUNCTION admin_delete_brand_cascade(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_model_cascade(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_variant_cascade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_sku(UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION skus_in_use(UUID[])                TO authenticated;

COMMIT;

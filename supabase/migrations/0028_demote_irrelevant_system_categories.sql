-- ============================================================================
-- 0028 — Demote Soap Bar and Other Pieces from system-protected
-- ============================================================================
-- These categories are not relevant to this business. Removing system
-- protection makes them deletable by admin/manager if not in use.
-- They can be re-created at any time as regular user categories.
-- No data is deleted — existing products linked to these categories are safe.
-- ============================================================================

UPDATE product_categories
SET is_system = false
WHERE name IN ('Soap Bar', 'Other Pieces')
  AND is_system = true;

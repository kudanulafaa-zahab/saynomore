-- ============================================================================
-- 0029 — Split delivery_address into two lines
-- ============================================================================
-- The label needs a full 4-line delivery block:
--   Name (from customers.name)
--   Address line 1 (house / building name)
--   Address line 2 (street / road)
--   Island (delivery_island, already exists)
--
-- We rename the existing delivery_address to delivery_address_line1
-- and add delivery_address_line2 TEXT NULL.
-- Existing single-field data is preserved in line1.
-- ============================================================================

ALTER TABLE sales_orders
  RENAME COLUMN delivery_address TO delivery_address_line1;

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS delivery_address_line2 TEXT;

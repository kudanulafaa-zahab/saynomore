-- ============================================================================
-- 0065 — Mixed-carton brand flag
-- ============================================================================
-- Some brands (e.g. Sosoft: 5 fragrances, each its own product_model, each
-- purchased from the supplier as a single-scent carton of 6 bottles) are sold
-- to customers as a carton assembled from a MIX of scents. This column marks
-- a brand as mixed-carton-eligible and records how many pieces make one
-- carton, so the app can offer a single "build a carton" picker across all
-- of that brand's models/SKUs instead of listing each scent separately.
--
-- NULL (default) = normal brand, no mixed-carton picker.
-- Non-null = this many pieces (bottles) must be picked, in any combination
-- of the brand's SKUs, to fill one carton.
--
-- No change to stock_movements / post_sale — a mixed carton still posts as
-- one sales_order_lines row per SKU actually used (uom='piece',
-- is_mixed_carton_fill=true, see migration 0027), so FIFO depletion and cost
-- snapshotting stay exactly as they are, per-SKU.
-- ============================================================================

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS mixed_carton_pieces INTEGER
    CHECK (mixed_carton_pieces IS NULL OR mixed_carton_pieces > 0);

COMMENT ON COLUMN brands.mixed_carton_pieces IS
  'Non-null enables the mixed-carton picker for this brand in New Sale: '
  'customers can fill one carton by choosing any mix of the brand''s SKUs, '
  'this many pieces total. NULL = brand sells normally, no picker.';

UPDATE brands SET mixed_carton_pieces = 6 WHERE name = 'Sosoft';

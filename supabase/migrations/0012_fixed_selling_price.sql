-- ── Migration 0012: Fixed selling price override per SKU ──────────────────
--
-- Adds fixed_selling_price_mvr (nullable) to skus.
-- When set, it takes priority over the margin-formula price in v_skus.
-- When NULL, the margin formula still applies as before.
--
-- Pricing hierarchy in v_skus:
--   1. fixed_selling_price_mvr (if set)           ← Ali sets a hard price
--   2. landed / (1 - margin%)  (if margin set)    ← margin formula
--   3. NULL                                        ← no price configured

-- 1. Add column
ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS fixed_selling_price_mvr NUMERIC(10,2)
  CHECK (fixed_selling_price_mvr IS NULL OR fixed_selling_price_mvr > 0);

-- 2. Drop existing v_skus (cascade clears any dependents)
DROP VIEW IF EXISTS v_skus CASCADE;

-- 3. Rebuild v_skus with fixed price priority
CREATE VIEW v_skus AS
WITH latest_landed AS (
  SELECT DISTINCT ON (sku_id)
    sku_id,
    landed_per_piece_mvr
  FROM v_batch_stock
  WHERE qty_pieces_remaining > 0
  ORDER BY sku_id, received_at DESC
)
SELECT
  s.id,
  s.variant_id,
  s.internal_code,
  s.supplier_barcode,
  s.pcs_per_pack,
  s.packs_per_carton,
  (s.pcs_per_pack * s.packs_per_carton)::INTEGER AS pcs_per_carton,
  s.carton_length_cm,
  s.carton_width_cm,
  s.carton_height_cm,
  s.carton_weight_kg,
  s.cbm_per_carton,
  s.is_active,
  s.notes,
  s.created_at,
  s.updated_at,
  s.target_margin_pct,
  s.fixed_selling_price_mvr,

  -- Current landed cost (MVR) from most recent in-stock batch
  ll.landed_per_piece_mvr,

  -- Selling price per piece — fixed overrides margin formula
  CASE
    WHEN s.fixed_selling_price_mvr IS NOT NULL
    THEN s.fixed_selling_price_mvr
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
    THEN ROUND(ll.landed_per_piece_mvr / (1 - s.target_margin_pct / 100.0), 2)
    ELSE NULL
  END AS selling_price_per_piece_mvr,

  -- Selling price per pack
  CASE
    WHEN s.fixed_selling_price_mvr IS NOT NULL
    THEN ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack, 2)
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
    THEN ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack) / (1 - s.target_margin_pct / 100.0), 2)
    ELSE NULL
  END AS selling_price_per_pack_mvr,

  -- Selling price per carton
  CASE
    WHEN s.fixed_selling_price_mvr IS NOT NULL
    THEN ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack * s.packs_per_carton, 2)
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
    THEN ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack * s.packs_per_carton) / (1 - s.target_margin_pct / 100.0), 2)
    ELSE NULL
  END AS selling_price_per_carton_mvr,

  -- Actual margin % when a fixed price is set (so Ali can see real margin vs cost)
  CASE
    WHEN s.fixed_selling_price_mvr IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL AND ll.landed_per_piece_mvr > 0
    THEN ROUND((1 - ll.landed_per_piece_mvr / s.fixed_selling_price_mvr) * 100, 1)
    ELSE NULL
  END AS actual_margin_pct,

  v.attributes,
  v.display_name AS variant_display,
  m.id    AS model_id,
  m.name  AS model_name,
  b.id    AS brand_id,
  b.name  AS brand_name,
  pc.id   AS category_id,
  pc.name AS category_name,
  pc.unit_uom,
  pc.cost_basis,
  CONCAT_WS(' › ',
    b.name, m.name, v.display_name,
    s.pcs_per_pack || '×' || s.packs_per_carton
  ) AS full_path
FROM skus s
JOIN variants v             ON v.id = s.variant_id
JOIN product_models m       ON m.id = v.model_id
JOIN brands b               ON b.id = m.brand_id
JOIN product_categories pc  ON pc.id = m.category_id
LEFT JOIN latest_landed ll  ON ll.sku_id = s.id;

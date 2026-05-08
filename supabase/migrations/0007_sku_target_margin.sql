-- ── Migration 0007: Target margin % and selling price per SKU ─────────────
--
-- Business logic:
--   selling_price_per_pack (MVR) = landed_per_piece_mvr × pcs_per_pack
--                                  ÷ (1 - target_margin_pct / 100)
--
-- The selling price is computed on the fly in the v_skus view using the
-- LATEST landed cost from v_batch_stock (most recent batch received).
-- It is NOT stored — it is always derived so it reflects the current cost.
--
-- target_margin_pct is stored on the skus table (nullable).
-- If NULL the selling price columns come back as NULL (no margin set).

-- 1. Add target_margin_pct column to skus
ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS target_margin_pct NUMERIC(5,2)
  CHECK (target_margin_pct IS NULL OR (target_margin_pct > 0 AND target_margin_pct < 100));

-- 2. Drop existing v_skus view (cascade drops anything depending on it)
DROP VIEW IF EXISTS v_skus CASCADE;

-- 3. Rebuild v_skus with margin + computed selling prices
--    latest_landed_per_piece = most recent batch for this SKU across all godowns
CREATE VIEW v_skus AS
WITH latest_landed AS (
  -- Pick the single most recent batch per SKU that still has stock remaining.
  -- Uses v_batch_stock which computes qty_pieces_remaining from stock_movements.
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

  -- Current landed cost (MVR) from most recent in-stock batch
  ll.landed_per_piece_mvr,

  -- Derived selling prices (NULL if no margin set or no stock batches yet)
  CASE
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
    THEN ROUND(ll.landed_per_piece_mvr / (1 - s.target_margin_pct / 100.0), 2)
    ELSE NULL
  END AS selling_price_per_piece_mvr,

  CASE
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
    THEN ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack) / (1 - s.target_margin_pct / 100.0), 2)
    ELSE NULL
  END AS selling_price_per_pack_mvr,

  CASE
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
    THEN ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack * s.packs_per_carton) / (1 - s.target_margin_pct / 100.0), 2)
    ELSE NULL
  END AS selling_price_per_carton_mvr,

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

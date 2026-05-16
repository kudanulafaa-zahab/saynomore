-- ── Migration 0013: Volume-break pricing (per-UoM price overrides) ──────────
--
-- Adds two optional fixed price overrides per SKU:
--   fixed_price_per_pack_mvr    → carton-buyer price for packs
--   fixed_price_per_carton_mvr  → bulk-buyer discounted carton price
--
-- Pricing priority in v_skus (per UoM):
--
--   Per piece:
--     1. fixed_selling_price_mvr           (piece-level fixed price)
--     2. landed / (1 - margin%)            (margin formula)
--     3. NULL
--
--   Per pack:
--     1. fixed_price_per_pack_mvr          (pack-level override)
--     2. piece_price × pcs_per_pack        (derived from piece price)
--     3. NULL
--
--   Per carton:
--     1. fixed_price_per_carton_mvr        (carton-level override)
--     2. piece_price × pcs_per_carton      (derived from piece price)
--     3. NULL

-- 1. Add columns
ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS fixed_price_per_pack_mvr NUMERIC(10,2)
    CHECK (fixed_price_per_pack_mvr IS NULL OR fixed_price_per_pack_mvr > 0),
  ADD COLUMN IF NOT EXISTS fixed_price_per_carton_mvr NUMERIC(10,2)
    CHECK (fixed_price_per_carton_mvr IS NULL OR fixed_price_per_carton_mvr > 0);

-- 2. Drop existing v_skus
DROP VIEW IF EXISTS v_skus CASCADE;

-- 3. Rebuild v_skus with volume-break pricing priority
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
  s.fixed_price_per_pack_mvr,
  s.fixed_price_per_carton_mvr,

  -- Landed cost from most recent in-stock batch
  ll.landed_per_piece_mvr,

  -- ── Selling price per piece ──────────────────────────────────────────
  CASE
    WHEN s.fixed_selling_price_mvr IS NOT NULL
      THEN s.fixed_selling_price_mvr
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
      THEN ROUND(ll.landed_per_piece_mvr / (1 - s.target_margin_pct / 100.0), 2)
    ELSE NULL
  END AS selling_price_per_piece_mvr,

  -- ── Selling price per pack ───────────────────────────────────────────
  -- Priority: pack override → piece_price × pcs_per_pack → NULL
  CASE
    WHEN s.fixed_price_per_pack_mvr IS NOT NULL
      THEN s.fixed_price_per_pack_mvr
    WHEN s.fixed_selling_price_mvr IS NOT NULL
      THEN ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack, 2)
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
      THEN ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack) / (1 - s.target_margin_pct / 100.0), 2)
    ELSE NULL
  END AS selling_price_per_pack_mvr,

  -- ── Selling price per carton ─────────────────────────────────────────
  -- Priority: carton override → piece_price × pcs_per_carton → NULL
  CASE
    WHEN s.fixed_price_per_carton_mvr IS NOT NULL
      THEN s.fixed_price_per_carton_mvr
    WHEN s.fixed_selling_price_mvr IS NOT NULL
      THEN ROUND(s.fixed_selling_price_mvr * s.pcs_per_pack * s.packs_per_carton, 2)
    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL
      THEN ROUND((ll.landed_per_piece_mvr * s.pcs_per_pack * s.packs_per_carton) / (1 - s.target_margin_pct / 100.0), 2)
    ELSE NULL
  END AS selling_price_per_carton_mvr,

  -- ── Actual margin % (when fixed piece price is active) ───────────────
  CASE
    WHEN s.fixed_selling_price_mvr IS NOT NULL
      AND ll.landed_per_piece_mvr IS NOT NULL
      AND ll.landed_per_piece_mvr > 0
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

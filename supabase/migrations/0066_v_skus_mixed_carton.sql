-- ============================================================================
-- 0066 — Add brands.mixed_carton_pieces to v_skus
-- ============================================================================
-- CREATE OR REPLACE VIEW (not DROP+CREATE) — safe, does not cascade-break
-- dependent views. Appends one column to the end of the SELECT list only;
-- every existing column/order is untouched.
-- ============================================================================

CREATE OR REPLACE VIEW v_skus
WITH (security_invoker = true) AS
WITH latest_landed AS (
  SELECT DISTINCT ON (v_batch_stock.sku_id) v_batch_stock.sku_id,
      v_batch_stock.landed_per_piece_mvr
    FROM v_batch_stock
    WHERE v_batch_stock.qty_pieces_remaining > 0
    ORDER BY v_batch_stock.sku_id, v_batch_stock.received_at DESC
)
SELECT s.id,
  s.variant_id,
  s.internal_code,
  s.supplier_barcode,
  s.pcs_per_pack,
  s.packs_per_carton,
  s.pcs_per_pack * s.packs_per_carton AS pcs_per_carton,
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
  ll.landed_per_piece_mvr,
      CASE
          WHEN s.fixed_selling_price_mvr IS NOT NULL THEN round(s.fixed_selling_price_mvr, 0)
          WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL THEN round(ll.landed_per_piece_mvr / (1::numeric - s.target_margin_pct / 100.0), 0)
          ELSE NULL::numeric
      END AS selling_price_per_piece_mvr,
      CASE
          WHEN s.fixed_price_per_pack_mvr IS NOT NULL THEN round(s.fixed_price_per_pack_mvr, 0)
          WHEN s.fixed_selling_price_mvr IS NOT NULL THEN round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric, 0)
          WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL THEN round(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric / (1::numeric - s.target_margin_pct / 100.0), 0)
          ELSE NULL::numeric
      END AS selling_price_per_pack_mvr,
      CASE
          WHEN s.fixed_price_per_carton_mvr IS NOT NULL THEN round(s.fixed_price_per_carton_mvr, 0)
          WHEN s.fixed_selling_price_mvr IS NOT NULL THEN round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric, 0)
          WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL THEN round(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric * s.packs_per_carton::numeric / (1::numeric - s.target_margin_pct / 100.0), 0)
          ELSE NULL::numeric
      END AS selling_price_per_carton_mvr,
      CASE
          WHEN s.fixed_selling_price_mvr IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL AND ll.landed_per_piece_mvr > 0::numeric THEN round((1::numeric - ll.landed_per_piece_mvr / round(s.fixed_selling_price_mvr, 0)) * 100::numeric, 1)
          ELSE NULL::numeric
      END AS actual_margin_pct,
  v.attributes,
  v.display_name AS variant_display,
  m.id AS model_id,
  m.name AS model_name,
  b.id AS brand_id,
  b.name AS brand_name,
  pc.id AS category_id,
  pc.name AS category_name,
  pc.unit_uom,
  pc.cost_basis,
  concat_ws(' › '::text, b.name, m.name, v.display_name, (s.pcs_per_pack || '×'::text) || s.packs_per_carton) AS full_path,
  s.sellable_units,
  pc.default_sellable_units,
  pc.duty_rate_pct,
  b.mixed_carton_pieces
 FROM skus s
   JOIN variants v ON v.id = s.variant_id
   JOIN product_models m ON m.id = v.model_id
   JOIN brands b ON b.id = m.brand_id
   JOIN product_categories pc ON pc.id = m.category_id
   LEFT JOIN latest_landed ll ON ll.sku_id = s.id;

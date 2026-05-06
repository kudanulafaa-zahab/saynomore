-- ============================================================================
-- SayNoMore — Categories with attribute schemas + cleaner Variant/SKU split
-- ============================================================================
-- Changes from 0002:
-- • New `product_categories` table (user-managed) replaces the hardcoded
--   model.category enum. Each category defines which variant attributes apply
--   and which UoM/cost-basis to use.
-- • Models reference categories via FK (not a string enum).
-- • The old "format" column on `skus` moves UP to be a variant attribute,
--   because Bottle vs Pouch is a different sellable variant — not a SKU detail.
-- • SKU keeps only PACK CONFIG fields (pcs/pack, packs/carton, dimensions,
--   barcode). UoM/cost-basis live on the model's category.
-- • Pre-seeded categories: Diapers, Liquid Detergent, Powder Detergent.
-- ============================================================================

BEGIN;

-- ── 1. New product_categories table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  description   TEXT,
  -- Drives unit & cost reporting
  unit_uom      TEXT NOT NULL CHECK (unit_uom IN ('pcs','ml','g')),
  cost_basis    TEXT NOT NULL CHECK (cost_basis IN ('piece','per_100ml','per_100g')),
  -- Which variant attributes apply: ["size"] for diapers, ["scent","format","volume_ml"] for liquid detergent
  variant_attributes JSONB NOT NULL DEFAULT '[]',
  -- Sort order in pickers
  sort_order    INTEGER NOT NULL DEFAULT 100,
  is_system     BOOLEAN NOT NULL DEFAULT false, -- pre-seeded; user can edit but not delete
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_categories_upd BEFORE UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY pc_read  ON product_categories FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY pc_write ON product_categories FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

-- ── 2. Pre-seed common categories ───────────────────────────────────────
INSERT INTO product_categories (name, description, unit_uom, cost_basis, variant_attributes, sort_order, is_system)
VALUES
  ('Diapers',           'Baby diapers, pants, hygiene pieces',
                        'pcs',  'piece',     '["size"]'::jsonb, 10, true),
  ('Liquid Detergent',  'Detergents, cleaners, shampoos, conditioners (liquid)',
                        'ml',   'per_100ml', '["scent","format","volume_ml"]'::jsonb, 20, true),
  ('Powder Detergent',  'Detergent powders, cleaning powders',
                        'g',    'per_100g',  '["scent","weight_g"]'::jsonb, 30, true),
  ('Soap Bar',          'Bar soaps and similar',
                        'pcs',  'piece',     '["scent","weight_g"]'::jsonb, 40, true),
  ('Other Pieces',      'Anything else sold by the piece',
                        'pcs',  'piece',     '["size"]'::jsonb, 100, true)
ON CONFLICT (name) DO NOTHING;

-- ── 3. Migrate models.category (TEXT enum) → category_id (FK) ───────────
-- Drop the v_skus view first because it references the old `category` column.
-- We rebuild it later in step 5 with the new joins.
DROP VIEW IF EXISTS v_skus CASCADE;

ALTER TABLE product_models ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES product_categories(id);

-- Map any existing rows from the old enum to the new categories
UPDATE product_models SET category_id = (
  SELECT id FROM product_categories WHERE name = CASE category
    WHEN 'diaper' THEN 'Diapers'
    WHEN 'liquid' THEN 'Liquid Detergent'
    WHEN 'powder' THEN 'Powder Detergent'
    ELSE 'Other Pieces'
  END
) WHERE category_id IS NULL;

-- After mapping, the column is required
ALTER TABLE product_models ALTER COLUMN category_id SET NOT NULL;

-- Drop the old enum-style column (no longer source of truth)
ALTER TABLE product_models DROP COLUMN IF EXISTS category;

-- ── 4. Move SKU's `format`/`unit_uom`/`unit_size`/`cost_basis` upstream ─
-- These now live conceptually at the variant level (via attributes JSON)
-- and the category level (UoM + cost basis). The SKU only carries PACK info.
--
-- Strategy: copy old per-SKU data into the variant's attributes JSON so
-- nothing is lost, then drop the columns.

UPDATE variants v SET attributes = COALESCE(v.attributes, '{}'::jsonb) ||
  jsonb_strip_nulls(jsonb_build_object(
    'format',      (SELECT MIN(s.format)      FROM skus s WHERE s.variant_id = v.id),
    'unit_uom',    (SELECT MIN(s.unit_uom)    FROM skus s WHERE s.variant_id = v.id),
    'unit_size',   (SELECT MIN(s.unit_size)   FROM skus s WHERE s.variant_id = v.id)
  ))
WHERE EXISTS (SELECT 1 FROM skus s WHERE s.variant_id = v.id);

-- Drop columns from skus that have moved
ALTER TABLE skus DROP COLUMN IF EXISTS format;
ALTER TABLE skus DROP COLUMN IF EXISTS unit_uom;
ALTER TABLE skus DROP COLUMN IF EXISTS unit_size;
ALTER TABLE skus DROP COLUMN IF EXISTS cost_basis;

-- ── 5. Rebuild v_skus with new joins ────────────────────────────────────
DROP VIEW IF EXISTS v_skus CASCADE;

CREATE VIEW v_skus AS
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
  -- Friendly full-path label for lists
  CONCAT_WS(' › ',
    b.name, m.name, v.display_name,
    s.pcs_per_pack || '×' || s.packs_per_carton
  ) AS full_path
FROM skus s
JOIN variants v          ON v.id = s.variant_id
JOIN product_models m    ON m.id = v.model_id
JOIN brands b            ON b.id = m.brand_id
JOIN product_categories pc ON pc.id = m.category_id;

-- ── 6. Update confirm_grn to read UoM from category instead of skus ─────
CREATE OR REPLACE FUNCTION confirm_grn(p_shipment_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ship           shipments%ROWTYPE;
  v_total_cbm      NUMERIC := 0;
  v_freight_mvr    NUMERIC := 0;
  v_local_mvr      NUMERIC := 0;
  v_pool_mvr       NUMERIC := 0;
  v_user           UUID := auth.uid();
BEGIN
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shipment % not found', p_shipment_id; END IF;
  IF v_ship.status = 'grn_confirmed' THEN
    RAISE EXCEPTION 'Shipment already confirmed';
  END IF;
  IF v_ship.rate_usd_to_mvr IS NULL OR v_ship.rate_usd_to_mvr <= 0 THEN
    RAISE EXCEPTION 'USD→MVR rate required';
  END IF;
  IF v_ship.rate_idr_to_mvr IS NULL OR v_ship.rate_idr_to_mvr <= 0 THEN
    RAISE EXCEPTION 'IDR→MVR rate required';
  END IF;
  IF EXISTS (SELECT 1 FROM shipment_lines WHERE shipment_id = p_shipment_id AND cbm_per_carton <= 0) THEN
    RAISE EXCEPTION 'All lines must have CBM > 0';
  END IF;

  SELECT COALESCE(SUM(qty_cartons * cbm_per_carton),0) INTO v_total_cbm
    FROM shipment_lines WHERE shipment_id = p_shipment_id;

  IF v_total_cbm <= 0 THEN RAISE EXCEPTION 'Shipment has no carton volume'; END IF;

  v_freight_mvr := COALESCE(v_ship.my_freight_share_usd,0) * v_ship.rate_usd_to_mvr;
  v_local_mvr   := COALESCE(v_ship.customs_duty_mvr,0)
                 + COALESCE(v_ship.mpl_charges_mvr,0)
                 + COALESCE(v_ship.agent_fee_mvr,0)
                 + COALESCE(v_ship.last_mile_mvr,0)
                 + COALESCE(v_ship.insurance_mvr,0)
                 + COALESCE(v_ship.other_mvr,0);
  v_pool_mvr    := v_freight_mvr + v_local_mvr;

  -- Compute & write line-level costs (UoM + cost_basis come from category)
  WITH calc AS (
    SELECT
      sl.id, sl.sku_id, sl.qty_cartons, sl.cbm_per_carton, sl.destination_godown_id,
      sl.fob_per_carton, sl.fob_currency,
      s.pcs_per_pack, s.packs_per_carton,
      pc.unit_uom, pc.cost_basis,
      (v.attributes->>'unit_size')::NUMERIC AS unit_size_attr,
      (v.attributes->>'volume_ml')::NUMERIC AS volume_ml_attr,
      (v.attributes->>'weight_g')::NUMERIC  AS weight_g_attr,
      (sl.qty_cartons * sl.fob_per_carton *
        CASE sl.fob_currency
          WHEN 'IDR' THEN v_ship.rate_idr_to_mvr
          WHEN 'USD' THEN v_ship.rate_usd_to_mvr
          ELSE 1 END) AS fob_total_mvr,
      (sl.qty_cartons * sl.cbm_per_carton / v_total_cbm) AS cbm_share
    FROM shipment_lines sl
    JOIN skus s              ON s.id = sl.sku_id
    JOIN variants v          ON v.id = s.variant_id
    JOIN product_models m    ON m.id = v.model_id
    JOIN product_categories pc ON pc.id = m.category_id
    WHERE sl.shipment_id = p_shipment_id
  ),
  ap AS (
    SELECT *,
      cbm_share * v_freight_mvr AS app_freight,
      cbm_share * v_local_mvr   AS app_local,
      fob_total_mvr + (cbm_share * v_pool_mvr) AS landed_total
    FROM calc
  ),
  per AS (
    SELECT *,
      ROUND(landed_total / qty_cartons, 4)                                   AS per_carton,
      ROUND(landed_total / (qty_cartons * packs_per_carton), 4)              AS per_pack,
      ROUND(landed_total / (qty_cartons * packs_per_carton * pcs_per_pack), 4) AS per_piece,
      CASE cost_basis
        WHEN 'piece' THEN
          ROUND(landed_total / (qty_cartons * packs_per_carton * pcs_per_pack), 4)
        WHEN 'per_100ml' THEN
          ROUND(
            (landed_total / (qty_cartons * packs_per_carton * pcs_per_pack))
            / (COALESCE(volume_ml_attr, unit_size_attr, 1) / 100.0),
            4
          )
        WHEN 'per_100g' THEN
          ROUND(
            (landed_total / (qty_cartons * packs_per_carton * pcs_per_pack))
            / (COALESCE(weight_g_attr, unit_size_attr, 1) / 100.0),
            4
          )
      END AS per_unit
    FROM ap
  )
  UPDATE shipment_lines sl SET
    fob_total_mvr           = p.fob_total_mvr,
    apportioned_freight_mvr = p.app_freight,
    apportioned_local_mvr   = p.app_local,
    landed_total_mvr        = p.landed_total,
    landed_per_carton_mvr   = p.per_carton,
    landed_per_pack_mvr     = p.per_pack,
    landed_per_piece_mvr    = p.per_piece,
    landed_per_unit_mvr     = p.per_unit
  FROM per p
  WHERE sl.id = p.id;

  INSERT INTO inventory_batches
    (shipment_line_id, sku_id, godown_id, qty_cartons_received, qty_pieces_received,
     landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, landed_per_unit_mvr)
  SELECT sl.id, sl.sku_id, sl.destination_godown_id,
         sl.qty_cartons,
         sl.qty_cartons * s.packs_per_carton * s.pcs_per_pack,
         sl.landed_per_piece_mvr, sl.landed_per_pack_mvr, sl.landed_per_carton_mvr, sl.landed_per_unit_mvr
  FROM shipment_lines sl
  JOIN skus s ON s.id = sl.sku_id
  WHERE sl.shipment_id = p_shipment_id;

  INSERT INTO stock_movements
    (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, created_by)
  SELECT b.id, b.sku_id, b.godown_id, 'in', b.qty_pieces_received, 'shipment', p_shipment_id, v_user
  FROM inventory_batches b
  WHERE b.shipment_line_id IN (SELECT id FROM shipment_lines WHERE shipment_id = p_shipment_id);

  UPDATE shipments SET
    status = 'grn_confirmed',
    grn_confirmed_at = now(),
    grn_confirmed_by = v_user
  WHERE id = p_shipment_id;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('shipments', p_shipment_id, 'update', 'GRN confirmed; landed costs locked', v_user);

  RETURN p_shipment_id;
END $$;

COMMIT;

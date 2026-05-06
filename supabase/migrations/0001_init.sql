-- ============================================================================
-- SayNoMore — Initial Schema
-- Tables: Brands, Categories, Variants, SKUs, Suppliers, Customers,
--         Godowns, Shipments, Shipment Lines, Stock Movements,
--         Sales Orders, Sales Order Lines
-- Roles:  admin, manager, staff
-- Functions: calculate_landed_cost (per piece OR per 100ml/100g)
-- ============================================================================

-- Extensions ------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ROLES & PERMISSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT current_user_role() = 'admin'; $$;

CREATE OR REPLACE FUNCTION is_admin_or_manager() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT current_user_role() IN ('admin','manager'); $$;

-- ============================================================================
-- 2. SKU HIERARCHY  (Brand > Category > Variant > SKU)
-- ============================================================================

CREATE TABLE IF NOT EXISTS brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, name)
);

CREATE TABLE IF NOT EXISTS variants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, name)
);

-- "Products" view = Brand + Category + Variant context for the UI
CREATE OR REPLACE VIEW products AS
SELECT
  v.id              AS variant_id,
  b.id              AS brand_id,
  b.name            AS brand_name,
  c.id              AS category_id,
  c.name            AS category_name,
  v.name            AS variant_name
FROM variants v
JOIN categories c ON c.id = v.category_id
JOIN brands     b ON b.id = c.brand_id;

-- SKU = the leaf node (sellable unit). Must capture all 7 levels.
CREATE TABLE IF NOT EXISTS skus (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id        UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,

  packaging         TEXT NOT NULL,    -- "Pouch", "Bottle", "Can", "Sachet", "Pack"
  unit_size_value   NUMERIC(12,3) NOT NULL CHECK (unit_size_value > 0),
  unit_size_uom     TEXT NOT NULL CHECK (unit_size_uom IN ('ml','l','g','kg','pcs')),
  units_per_pack    INTEGER NOT NULL CHECK (units_per_pack > 0),
  packs_per_carton  INTEGER NOT NULL CHECK (packs_per_carton > 0),

  cbm_per_carton    NUMERIC(10,5) NOT NULL CHECK (cbm_per_carton > 0),
  weight_per_carton_kg NUMERIC(10,3),

  -- Whether to compute landed cost per piece (diapers, soap)
  -- or per standard volume unit (100ml liquid, 100g powder)
  cost_basis        TEXT NOT NULL DEFAULT 'piece'
                    CHECK (cost_basis IN ('piece','per_100ml','per_100g')),

  barcode           TEXT,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skus_variant ON skus(variant_id);

-- Friendly full-path display name
CREATE OR REPLACE VIEW skus_full AS
SELECT
  s.id, s.variant_id, s.packaging, s.unit_size_value, s.unit_size_uom,
  s.units_per_pack, s.packs_per_carton, s.cbm_per_carton, s.cost_basis,
  s.active, s.created_at,
  p.brand_name, p.category_name, p.variant_name,
  CONCAT(
    p.brand_name, ' > ', p.category_name, ' > ', p.variant_name,
    ' > ', s.packaging, ' > ', s.unit_size_value, s.unit_size_uom,
    ' x ', s.units_per_pack, ' x ', s.packs_per_carton
  ) AS display_name
FROM skus s
JOIN products p ON p.variant_id = s.variant_id;

-- ============================================================================
-- 3. SUPPLIERS, CUSTOMERS, GODOWNS
-- ============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  country     TEXT NOT NULL DEFAULT 'Indonesia',
  currency    TEXT NOT NULL DEFAULT 'IDR' CHECK (currency IN ('IDR','USD','MVR')),
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  company     TEXT,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS godowns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  location    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. SHIPMENTS  +  LANDED COST INPUTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       TEXT NOT NULL UNIQUE,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'in_transit'
                  CHECK (status IN ('in_transit','arrived','grn_confirmed')),

  -- Forex rates locked at GRN
  rate_idr_to_mvr NUMERIC(14,8),
  rate_usd_to_mvr NUMERIC(14,8),

  -- Shipment-level costs
  freight_usd     NUMERIC(14,2) DEFAULT 0,
  duty_mvr        NUMERIC(14,2) DEFAULT 0,
  agent_mvr       NUMERIC(14,2) DEFAULT 0,
  other_mvr       NUMERIC(14,2) DEFAULT 0,

  notes           TEXT,
  grn_confirmed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipment_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  sku_id          UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,

  qty_cartons     INTEGER NOT NULL CHECK (qty_cartons > 0),
  cbm_per_carton  NUMERIC(10,5) NOT NULL CHECK (cbm_per_carton > 0),

  fob_price_per_carton NUMERIC(14,2) NOT NULL CHECK (fob_price_per_carton >= 0),
  fob_currency    TEXT NOT NULL CHECK (fob_currency IN ('IDR','USD','MVR')),

  -- Computed by calculate_landed_cost() — never written by app
  landed_cost_per_carton NUMERIC(14,4),
  landed_cost_per_pack   NUMERIC(14,4),
  landed_cost_per_piece  NUMERIC(14,4),
  landed_cost_per_unit   NUMERIC(14,4), -- per 100ml / 100g, depends on cost_basis

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shipment_lines_shipment ON shipment_lines(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_lines_sku      ON shipment_lines(sku_id);

-- ============================================================================
-- 5. INVENTORY  (stock derived from movements — never stored)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id          UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  godown_id       UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,
  type            TEXT NOT NULL CHECK (type IN ('in','out','adjust')),
  qty_pieces      INTEGER NOT NULL,
  reference_type  TEXT,    -- 'shipment' | 'sales_order' | 'manual'
  reference_id    UUID,
  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_sku    ON stock_movements(sku_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_godown ON stock_movements(godown_id);

-- Live stock view
CREATE OR REPLACE VIEW v_stock_levels AS
SELECT
  sm.sku_id,
  sm.godown_id,
  COALESCE(SUM(
    CASE sm.type
      WHEN 'in'     THEN sm.qty_pieces
      WHEN 'out'    THEN -sm.qty_pieces
      WHEN 'adjust' THEN sm.qty_pieces
    END
  ), 0) AS qty_on_hand
FROM stock_movements sm
GROUP BY sm.sku_id, sm.godown_id;

-- ============================================================================
-- 6. SALES
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number    TEXT NOT NULL UNIQUE,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','confirmed','delivered','cancelled')),
  channel         TEXT NOT NULL DEFAULT 'whatsapp'
                  CHECK (channel IN ('whatsapp','instagram','viber','tiktok','walkin','other')),
  payment_status  TEXT NOT NULL DEFAULT 'pending'
                  CHECK (payment_status IN ('pending','partial','paid')),
  delivery_godown_id UUID REFERENCES godowns(id),
  delivered_by    UUID REFERENCES auth.users(id),  -- the staff/driver
  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  sku_id          UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  qty_pieces      INTEGER NOT NULL CHECK (qty_pieces > 0),
  unit_price_mvr  NUMERIC(12,2) NOT NULL CHECK (unit_price_mvr >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sol_order ON sales_order_lines(order_id);

-- ============================================================================
-- 7. LANDED COST FUNCTION
-- ============================================================================
--
-- Inputs:  shipment_id (UUID)
-- Behaviour:
--   1. Validates forex rates and CBM are present.
--   2. Converts every IDR/USD cost to MVR using the locked rates.
--   3. Apportions total shipment cost across lines by CBM share.
--   4. Computes per-carton, per-pack, per-piece cost.
--   5. Computes per-unit cost based on each SKU's cost_basis:
--        - 'piece'      → same as per piece (e.g. diapers)
--        - 'per_100ml'  → cost per 100ml (liquids)
--        - 'per_100g'   → cost per 100g  (powders)
--   6. Writes results back to shipment_lines and locks the shipment.
--
CREATE OR REPLACE FUNCTION calculate_landed_cost(p_shipment_id UUID)
RETURNS TABLE (
  shipment_line_id UUID,
  sku_display      TEXT,
  per_carton_mvr   NUMERIC,
  per_pack_mvr     NUMERIC,
  per_piece_mvr    NUMERIC,
  per_unit_mvr     NUMERIC,
  unit_label       TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_ship          shipments%ROWTYPE;
  v_total_cbm     NUMERIC := 0;
  v_total_cost_mvr NUMERIC := 0;
  v_freight_mvr    NUMERIC := 0;
  v_fob_total_mvr  NUMERIC := 0;
BEGIN
  -- 1. Load shipment & validate
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment % not found', p_shipment_id;
  END IF;

  IF v_ship.rate_usd_to_mvr IS NULL OR v_ship.rate_usd_to_mvr <= 0 THEN
    RAISE EXCEPTION 'USD→MVR forex rate must be set on the shipment before costing';
  END IF;
  IF v_ship.rate_idr_to_mvr IS NULL OR v_ship.rate_idr_to_mvr <= 0 THEN
    RAISE EXCEPTION 'IDR→MVR forex rate must be set on the shipment before costing';
  END IF;

  -- 2. Total CBM (block if any line has zero CBM)
  IF EXISTS (SELECT 1 FROM shipment_lines WHERE shipment_id = p_shipment_id AND cbm_per_carton <= 0) THEN
    RAISE EXCEPTION 'All shipment lines must have CBM > 0 before costing';
  END IF;

  SELECT COALESCE(SUM(qty_cartons * cbm_per_carton), 0)
    INTO v_total_cbm
    FROM shipment_lines
   WHERE shipment_id = p_shipment_id;

  IF v_total_cbm <= 0 THEN
    RAISE EXCEPTION 'Shipment has no carton volume — cannot apportion cost';
  END IF;

  -- 3. Convert shipment-level costs to MVR
  v_freight_mvr := COALESCE(v_ship.freight_usd, 0) * v_ship.rate_usd_to_mvr;

  -- 4. Sum FOB total in MVR (lines, converted by their own currency)
  SELECT COALESCE(SUM(
    sl.qty_cartons * sl.fob_price_per_carton *
    CASE sl.fob_currency
      WHEN 'IDR' THEN v_ship.rate_idr_to_mvr
      WHEN 'USD' THEN v_ship.rate_usd_to_mvr
      WHEN 'MVR' THEN 1
    END
  ), 0)
  INTO v_fob_total_mvr
  FROM shipment_lines sl
  WHERE sl.shipment_id = p_shipment_id;

  -- 5. Total landed cost (everything to MVR)
  v_total_cost_mvr := v_fob_total_mvr
                    + v_freight_mvr
                    + COALESCE(v_ship.duty_mvr, 0)
                    + COALESCE(v_ship.agent_mvr, 0)
                    + COALESCE(v_ship.other_mvr, 0);

  -- 6. Apportion by CBM, write back results, return rows
  RETURN QUERY
  WITH calc AS (
    SELECT
      sl.id,
      sl.sku_id,
      sl.qty_cartons,
      sl.cbm_per_carton,
      s.units_per_pack,
      s.packs_per_carton,
      s.unit_size_value,
      s.unit_size_uom,
      s.cost_basis,
      sf.display_name,
      -- This line's share of total cost (by CBM)
      (sl.qty_cartons * sl.cbm_per_carton / v_total_cbm) * v_total_cost_mvr AS line_total_mvr
    FROM shipment_lines sl
    JOIN skus       s  ON s.id = sl.sku_id
    JOIN skus_full  sf ON sf.id = sl.sku_id
    WHERE sl.shipment_id = p_shipment_id
  ),
  computed AS (
    SELECT
      c.id,
      c.display_name,
      ROUND(c.line_total_mvr / c.qty_cartons, 4) AS per_carton,
      ROUND(c.line_total_mvr / (c.qty_cartons * c.packs_per_carton), 4) AS per_pack,
      ROUND(c.line_total_mvr / (c.qty_cartons * c.packs_per_carton * c.units_per_pack), 4) AS per_piece,
      CASE c.cost_basis
        WHEN 'piece'     THEN ROUND(c.line_total_mvr / (c.qty_cartons * c.packs_per_carton * c.units_per_pack), 4)
        WHEN 'per_100ml' THEN ROUND(
              (c.line_total_mvr / (c.qty_cartons * c.packs_per_carton * c.units_per_pack))
              / (CASE c.unit_size_uom WHEN 'l' THEN c.unit_size_value*1000 ELSE c.unit_size_value END / 100.0), 4)
        WHEN 'per_100g'  THEN ROUND(
              (c.line_total_mvr / (c.qty_cartons * c.packs_per_carton * c.units_per_pack))
              / (CASE c.unit_size_uom WHEN 'kg' THEN c.unit_size_value*1000 ELSE c.unit_size_value END / 100.0), 4)
      END AS per_unit,
      CASE c.cost_basis
        WHEN 'piece'     THEN 'per piece'
        WHEN 'per_100ml' THEN 'per 100ml'
        WHEN 'per_100g'  THEN 'per 100g'
      END AS unit_lbl
    FROM calc c
  ),
  upd AS (
    UPDATE shipment_lines sl
       SET landed_cost_per_carton = co.per_carton,
           landed_cost_per_pack   = co.per_pack,
           landed_cost_per_piece  = co.per_piece,
           landed_cost_per_unit   = co.per_unit
      FROM computed co
     WHERE sl.id = co.id
     RETURNING sl.id
  )
  SELECT co.id, co.display_name, co.per_carton, co.per_pack, co.per_piece, co.per_unit, co.unit_lbl
    FROM computed co;

  -- 7. Lock the shipment (mark GRN confirmed if not already)
  UPDATE shipments
     SET status = 'grn_confirmed',
         grn_confirmed_at = COALESCE(grn_confirmed_at, now())
   WHERE id = p_shipment_id;
END;
$$;

-- ============================================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands             ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus               ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE godowns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_lines  ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read their own profile; admin sees all
CREATE POLICY up_select_self ON user_profiles
  FOR SELECT USING (id = auth.uid() OR is_admin());
CREATE POLICY up_admin_write ON user_profiles
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Catalog (brands/categories/variants/skus): all roles READ; admin+manager WRITE
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['brands','categories','variants','skus','suppliers','customers','godowns']) LOOP
    EXECUTE format('CREATE POLICY %I_read ON %I FOR SELECT USING (auth.uid() IS NOT NULL);', t, t);
    EXECUTE format('CREATE POLICY %I_write ON %I FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());', t, t);
  END LOOP;
END $$;

-- Shipments & lines: read all authed; write admin+manager only
CREATE POLICY ship_read  ON shipments      FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ship_write ON shipments      FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY shl_read   ON shipment_lines FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY shl_write  ON shipment_lines FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

-- Stock movements: all authed READ; staff can INSERT 'out' (delivery); admin+manager full
CREATE POLICY sm_read ON stock_movements FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sm_staff_out ON stock_movements
  FOR INSERT WITH CHECK (
    current_user_role() = 'staff' AND type = 'out'
  );
CREATE POLICY sm_mgr_all ON stock_movements
  FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

-- Sales orders: admin+manager full; staff can READ orders assigned to them
-- and UPDATE delivery status.
CREATE POLICY so_mgr_all ON sales_orders
  FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY so_staff_read ON sales_orders
  FOR SELECT USING (current_user_role() = 'staff' AND delivered_by = auth.uid());
CREATE POLICY so_staff_update ON sales_orders
  FOR UPDATE USING (current_user_role() = 'staff' AND delivered_by = auth.uid())
  WITH CHECK  (current_user_role() = 'staff' AND delivered_by = auth.uid());

CREATE POLICY sol_mgr_all ON sales_order_lines
  FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY sol_staff_read ON sales_order_lines
  FOR SELECT USING (
    current_user_role() = 'staff'
    AND EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = order_id AND so.delivered_by = auth.uid())
  );

-- ============================================================================
-- 9. AUTO-PROFILE TRIGGER  (when a new auth.user signs up)
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- New users default to 'staff'. Admin promotes them later.
  INSERT INTO user_profiles (id, full_name, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), 'staff')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION handle_new_user();

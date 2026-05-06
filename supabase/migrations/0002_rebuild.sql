-- ============================================================================
-- SayNoMore — Schema Rebuild (corrected after FMCG/DB/Costing/UX expert audit)
-- ============================================================================
-- Drops the original 0001 tables and rebuilds with:
-- • 4-level hierarchy: Brand > Model > Variant(jsonb attrs) > SKU
-- • Bottle/Pouch as a format flag on SKU
-- • Multiple SKUs allowed per Brand+Model+Variant (e.g. M-size 22pcs/pack 4pk
--   carton AND M-size 18pcs/pack 3pk carton)
-- • Auto-computed CBM from carton dimensions
-- • Shared-container freight: my_freight_share_usd manual + per-line CBM split
-- • Last-mile + clearing/MPL costs split out
-- • Batches with stored landed_cost_per_piece (FIFO)
-- • Movement-derived stock (no stored qty)
-- • Audit log (append-only, RLS-blocked from update/delete)
-- • Roles admin/manager/staff with proper RBAC
-- • Customers + sales by carton/pack/piece, all converted to pieces internally
-- • Competitor prices for per-piece comparison
-- ============================================================================

BEGIN;

-- ── 0. Drop everything from 0001 ────────────────────────────────────────
DROP VIEW  IF EXISTS v_stock_levels      CASCADE;
DROP VIEW  IF EXISTS skus_full           CASCADE;
DROP VIEW  IF EXISTS products            CASCADE;
DROP TABLE IF EXISTS sales_order_lines   CASCADE;
DROP TABLE IF EXISTS sales_orders        CASCADE;
DROP TABLE IF EXISTS stock_movements     CASCADE;
DROP TABLE IF EXISTS shipment_lines      CASCADE;
DROP TABLE IF EXISTS shipments           CASCADE;
DROP TABLE IF EXISTS godowns             CASCADE;
DROP TABLE IF EXISTS customers           CASCADE;
DROP TABLE IF EXISTS suppliers           CASCADE;
DROP TABLE IF EXISTS skus                CASCADE;
DROP TABLE IF EXISTS variants            CASCADE;
DROP TABLE IF EXISTS categories          CASCADE;
DROP TABLE IF EXISTS brands              CASCADE;
DROP FUNCTION IF EXISTS calculate_landed_cost(UUID) CASCADE;

-- ── 1. Helpers ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- user_profiles already exists from 0001 — keep it
-- Re-create role helpers in case 0001's were dropped
CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT current_user_role() = 'admin'; $$;

CREATE OR REPLACE FUNCTION is_admin_or_manager() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT current_user_role() IN ('admin','manager'); $$;

-- ── 2. Master data: Brand > Model > Variant > SKU ───────────────────────

CREATE TABLE brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_brands_upd BEFORE UPDATE ON brands FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_models (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  -- 'diaper' | 'liquid' | 'powder' | 'pieces' — drives cost basis & UoM
  category    TEXT NOT NULL DEFAULT 'pieces' CHECK (category IN ('diaper','liquid','powder','pieces')),
  hs_code     TEXT,
  duty_rate_pct NUMERIC(6,2),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, name)
);
CREATE TRIGGER trg_models_upd BEFORE UPDATE ON product_models FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE variants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    UUID NOT NULL REFERENCES product_models(id) ON DELETE RESTRICT,
  -- Flexible attributes: {"size":"M"} or {"scent":"Mint","format":"Pouch","volume_ml":1500}
  attributes  JSONB NOT NULL DEFAULT '{}',
  display_name TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, attributes)
);
CREATE TRIGGER trg_variants_upd BEFORE UPDATE ON variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_variants_attrs ON variants USING GIN (attributes);

-- SKU = sellable unit (Variant + specific pack/carton config)
CREATE TABLE skus (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id        UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,

  -- Internal code, auto-or-manual; barcode optional for scan
  internal_code     TEXT NOT NULL UNIQUE,
  supplier_barcode  TEXT,

  -- Format distinction (Bottle | Pouch | Pack | Box | Can | Sachet | Tube | Jar | none)
  format            TEXT,

  -- Unit-level UoM for the smallest piece
  -- 'pcs' for diapers/items, 'ml' for liquids, 'g' for powders
  unit_uom          TEXT NOT NULL CHECK (unit_uom IN ('pcs','ml','g')),
  unit_size         NUMERIC(12,3) NOT NULL CHECK (unit_size > 0),
    -- For diapers, unit_size = 1 (one diaper); pcs_per_pack expresses pack count.
    -- For liquids, unit_size = volume in ml of one bottle/pouch; pcs_per_pack typically 1.

  pcs_per_pack      INTEGER NOT NULL CHECK (pcs_per_pack > 0),
  packs_per_carton  INTEGER NOT NULL CHECK (packs_per_carton > 0),

  -- Carton dims & CBM auto-computed
  carton_length_cm  NUMERIC(8,2) NOT NULL CHECK (carton_length_cm > 0),
  carton_width_cm   NUMERIC(8,2) NOT NULL CHECK (carton_width_cm  > 0),
  carton_height_cm  NUMERIC(8,2) NOT NULL CHECK (carton_height_cm > 0),
  carton_weight_kg  NUMERIC(8,3),
  cbm_per_carton    NUMERIC(10,6) GENERATED ALWAYS AS
    (carton_length_cm * carton_width_cm * carton_height_cm / 1000000) STORED,

  -- Cost-comparison basis: 'piece' / 'per_100ml' / 'per_100g'
  cost_basis        TEXT NOT NULL DEFAULT 'piece'
                    CHECK (cost_basis IN ('piece','per_100ml','per_100g')),

  is_active         BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_skus_upd BEFORE UPDATE ON skus FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_skus_variant ON skus(variant_id);

-- Friendly view with full path + computed pieces/carton
CREATE VIEW v_skus AS
SELECT
  s.*,
  (s.pcs_per_pack * s.packs_per_carton)::INTEGER AS pcs_per_carton,
  m.name      AS model_name,
  m.category  AS model_category,
  b.name      AS brand_name,
  b.id        AS brand_id,
  v.attributes,
  v.display_name AS variant_display,
  CONCAT_WS(' › ',
    b.name, m.name, v.display_name,
    COALESCE(s.format, ''),
    s.unit_size || s.unit_uom,
    s.pcs_per_pack || '/pk',
    s.packs_per_carton || '/ctn'
  ) AS full_path
FROM skus s
JOIN variants v       ON v.id = s.variant_id
JOIN product_models m ON m.id = v.model_id
JOIN brands b         ON b.id = m.brand_id;

-- ── 3. Suppliers, Customers, Godowns ────────────────────────────────────

CREATE TABLE suppliers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT 'Indonesia',
  invoice_currency TEXT NOT NULL DEFAULT 'IDR' CHECK (invoice_currency IN ('IDR','USD','MVR','MYR','THB','CNY','EUR')),
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_suppliers_upd BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  company       TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  island        TEXT,
  channel       TEXT, -- preferred channel: whatsapp/viber/messenger/walkin
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_customers_upd BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE godowns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  location    TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_godowns_upd BEFORE UPDATE ON godowns FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. Shipments + Lines (estimates) ─────────────────────────────────────

CREATE TABLE shipments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     TEXT NOT NULL UNIQUE,
  supplier_id   UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','ordered','in_transit','arrived','grn_confirmed')),

  -- Forex rates locked at GRN
  rate_idr_to_mvr NUMERIC(15,8),
  rate_usd_to_mvr NUMERIC(15,8),
  rate_idr_to_usd NUMERIC(15,8), -- for display/audit; not used directly

  -- Shared container fields
  shared_container          BOOLEAN NOT NULL DEFAULT false,
  total_container_freight_usd  NUMERIC(15,2),  -- total freight for full container
  my_freight_share_usd      NUMERIC(15,2) NOT NULL DEFAULT 0,
                                    -- the actual amount I pay (negotiated with friend)
  freight_share_notes       TEXT,

  -- Local cost components (MVR, my share)
  customs_duty_mvr      NUMERIC(15,2) NOT NULL DEFAULT 0,
  mpl_charges_mvr       NUMERIC(15,2) NOT NULL DEFAULT 0,
  agent_fee_mvr         NUMERIC(15,2) NOT NULL DEFAULT 0,
  last_mile_mvr         NUMERIC(15,2) NOT NULL DEFAULT 0,
  insurance_mvr         NUMERIC(15,2) NOT NULL DEFAULT 0,
  other_mvr             NUMERIC(15,2) NOT NULL DEFAULT 0,

  notes                 TEXT,
  ordered_at            TIMESTAMPTZ,
  arrived_at            TIMESTAMPTZ,
  grn_confirmed_at      TIMESTAMPTZ,
  grn_confirmed_by      UUID REFERENCES auth.users(id),
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_shipments_upd BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE shipment_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  sku_id          UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,

  qty_cartons     INTEGER NOT NULL CHECK (qty_cartons > 0),

  -- Snapshot SKU's CBM at line creation in case master changes later
  cbm_per_carton  NUMERIC(10,6) NOT NULL CHECK (cbm_per_carton > 0),

  fob_per_carton  NUMERIC(15,4) NOT NULL CHECK (fob_per_carton >= 0),
  fob_currency    TEXT NOT NULL CHECK (fob_currency IN ('IDR','USD','MVR')),

  destination_godown_id UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,

  -- Computed at GRN, locked into batch
  fob_total_mvr           NUMERIC(15,4),
  apportioned_freight_mvr NUMERIC(15,4),
  apportioned_local_mvr   NUMERIC(15,4),
  landed_total_mvr        NUMERIC(15,4),
  landed_per_carton_mvr   NUMERIC(15,4),
  landed_per_pack_mvr     NUMERIC(15,4),
  landed_per_piece_mvr    NUMERIC(15,4),
  landed_per_unit_mvr     NUMERIC(15,4),  -- per 100ml/100g if applicable

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_shipment_lines_upd BEFORE UPDATE ON shipment_lines FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_shipment_lines_shipment ON shipment_lines(shipment_id);
CREATE INDEX idx_shipment_lines_sku      ON shipment_lines(sku_id);

-- ── 5. Batches (created at GRN) ─────────────────────────────────────────

CREATE TABLE inventory_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_line_id    UUID NOT NULL REFERENCES shipment_lines(id) ON DELETE RESTRICT,
  sku_id              UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  godown_id           UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  qty_cartons_received INTEGER NOT NULL CHECK (qty_cartons_received > 0),
  qty_pieces_received  INTEGER NOT NULL CHECK (qty_pieces_received > 0),
  expiry_date         DATE,

  -- Locked at receipt
  landed_per_piece_mvr  NUMERIC(15,4) NOT NULL,
  landed_per_pack_mvr   NUMERIC(15,4) NOT NULL,
  landed_per_carton_mvr NUMERIC(15,4) NOT NULL,
  landed_per_unit_mvr   NUMERIC(15,4),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_batches_sku_godown ON inventory_batches(sku_id, godown_id);
CREATE INDEX idx_batches_received   ON inventory_batches(received_at);

-- ── 6. Stock Movements (immutable ledger) ───────────────────────────────

CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  sku_id          UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  godown_id       UUID NOT NULL REFERENCES godowns(id) ON DELETE RESTRICT,
  movement_type   TEXT NOT NULL CHECK (movement_type IN
    ('in','out','adjustment','transfer_in','transfer_out','return_in','damage_out')),
  qty_pieces      INTEGER NOT NULL,  -- always pieces; signed: out is negative-effect via type
  source_type     TEXT NOT NULL CHECK (source_type IN
    ('shipment','sales_order','transfer','adjustment','return','damage')),
  source_id       UUID,
  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sm_sku_godown ON stock_movements(sku_id, godown_id);
CREATE INDEX idx_sm_batch      ON stock_movements(batch_id);
CREATE INDEX idx_sm_source     ON stock_movements(source_type, source_id);

-- Live stock per SKU+godown (in pieces)
CREATE VIEW v_stock_levels AS
SELECT
  sm.sku_id,
  sm.godown_id,
  COALESCE(SUM(
    CASE sm.movement_type
      WHEN 'in'             THEN  sm.qty_pieces
      WHEN 'transfer_in'    THEN  sm.qty_pieces
      WHEN 'return_in'      THEN  sm.qty_pieces
      WHEN 'adjustment'     THEN  sm.qty_pieces  -- signed by app
      WHEN 'out'            THEN -sm.qty_pieces
      WHEN 'transfer_out'   THEN -sm.qty_pieces
      WHEN 'damage_out'     THEN -sm.qty_pieces
    END
  ), 0)::INTEGER AS qty_pieces
FROM stock_movements sm
GROUP BY sm.sku_id, sm.godown_id;

-- Per-batch stock left (for FIFO depletion)
CREATE VIEW v_batch_stock AS
SELECT
  b.id AS batch_id,
  b.sku_id,
  b.godown_id,
  b.received_at,
  b.landed_per_piece_mvr,
  COALESCE(SUM(
    CASE sm.movement_type
      WHEN 'in'             THEN  sm.qty_pieces
      WHEN 'transfer_in'    THEN  sm.qty_pieces
      WHEN 'return_in'      THEN  sm.qty_pieces
      WHEN 'adjustment'     THEN  sm.qty_pieces
      WHEN 'out'            THEN -sm.qty_pieces
      WHEN 'transfer_out'   THEN -sm.qty_pieces
      WHEN 'damage_out'     THEN -sm.qty_pieces
    END
  ), 0)::INTEGER AS qty_pieces_remaining
FROM inventory_batches b
LEFT JOIN stock_movements sm ON sm.batch_id = b.id
GROUP BY b.id;

-- ── 7. Sales Orders ─────────────────────────────────────────────────────

CREATE TABLE sales_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number    TEXT NOT NULL UNIQUE,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','confirmed','picked','out_for_delivery','delivered','cancelled')),
  channel         TEXT NOT NULL DEFAULT 'whatsapp'
                  CHECK (channel IN ('whatsapp','viber','messenger','instagram','tiktok','facebook','walkin','phone','other')),
  payment_status  TEXT NOT NULL DEFAULT 'pending'
                  CHECK (payment_status IN ('pending','partial','paid','cod','deposited')),
  payment_method  TEXT, -- 'transfer','cod','cash','other'
  payment_proof_url TEXT,

  source_godown_id UUID REFERENCES godowns(id),
  delivery_address TEXT,
  delivery_island  TEXT,
  delivery_to_boat BOOLEAN NOT NULL DEFAULT false,
  assigned_driver_id UUID REFERENCES auth.users(id), -- staff user
  picked_at       TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  cash_collected_mvr NUMERIC(15,2),
  cash_deposited_at  TIMESTAMPTZ,

  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_sales_orders_upd BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_so_status ON sales_orders(status);
CREATE INDEX idx_so_driver ON sales_orders(assigned_driver_id);

CREATE TABLE sales_order_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  sku_id          UUID NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  -- Sale UoM: how the user chose to enter the line
  uom             TEXT NOT NULL CHECK (uom IN ('carton','pack','piece')),
  qty             NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  -- Always derived: qty_pieces is what's removed from stock
  qty_pieces      INTEGER NOT NULL CHECK (qty_pieces > 0),
  unit_price_mvr  NUMERIC(15,4) NOT NULL CHECK (unit_price_mvr >= 0),
                                                       -- price is per uom unit
  line_total_mvr  NUMERIC(15,4) NOT NULL CHECK (line_total_mvr >= 0),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sol_order ON sales_order_lines(order_id);

-- ── 8. Competitor Prices ────────────────────────────────────────────────

CREATE TABLE competitors (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE competitor_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id   UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  -- Tie to your model+variant when possible (their SKU may differ in pcs/pack)
  variant_id      UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  -- Their product specs (might differ from yours)
  their_pcs_per_pack      INTEGER,
  their_unit_size         NUMERIC(12,3),  -- ml/g if applicable
  their_unit_uom          TEXT CHECK (their_unit_uom IN ('pcs','ml','g')),
  price_mvr               NUMERIC(12,2) NOT NULL CHECK (price_mvr > 0),
  -- price_basis: per their pack OR per piece OR per 100ml/100g
  price_basis             TEXT NOT NULL CHECK (price_basis IN ('per_pack','per_piece','per_100ml','per_100g','per_carton')),
  observed_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cp_variant ON competitor_prices(variant_id);

-- ── 9. Marketing Spend ──────────────────────────────────────────────────

CREATE TABLE marketing_spend (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       TEXT NOT NULL CHECK (channel IN ('meta_boost','google','tiktok_ad','other')),
  amount_mvr    NUMERIC(15,2) NOT NULL CHECK (amount_mvr > 0),
  campaign_name TEXT,
  start_date    DATE NOT NULL,
  end_date      DATE,
  -- Optional ties: which SKUs the boost is for
  notes         TEXT,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE marketing_spend_skus (
  spend_id  UUID NOT NULL REFERENCES marketing_spend(id) ON DELETE CASCADE,
  sku_id    UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  PRIMARY KEY (spend_id, sku_id)
);

-- ── 10. Audit Log (append-only, RLS-blocked from update/delete) ─────────

CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  TEXT NOT NULL,
  record_id   UUID NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  field_name  TEXT,
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  changed_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_record ON audit_log(table_name, record_id);

-- ── 11. Landed-cost calculation function ────────────────────────────────
--
-- Inputs: shipment_id
-- Behaviour:
--   1. Validates rates and CBM.
--   2. Converts FOB lines (IDR/USD) to MVR.
--   3. Builds the apportionment pools:
--        Freight pool   = my_freight_share_usd × usd_to_mvr
--        Local pool     = customs + mpl + agent + last_mile + insurance + other
--        FOB is direct-to-line (not apportioned).
--   4. Apportions freight + local pools to lines by line_cbm/total_cbm.
--   5. Per-line totals: fob + apportioned_freight + apportioned_local.
--   6. Per-piece, per-pack, per-carton + per-100ml/100g for liquids/powders.
--   7. Writes results to shipment_lines and locks the shipment.
--   8. Creates inventory_batches and stock_movements (in) so stock goes live.
--
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

  IF v_total_cbm <= 0 THEN
    RAISE EXCEPTION 'Shipment has no carton volume';
  END IF;

  v_freight_mvr := COALESCE(v_ship.my_freight_share_usd,0) * v_ship.rate_usd_to_mvr;
  v_local_mvr   := COALESCE(v_ship.customs_duty_mvr,0)
                 + COALESCE(v_ship.mpl_charges_mvr,0)
                 + COALESCE(v_ship.agent_fee_mvr,0)
                 + COALESCE(v_ship.last_mile_mvr,0)
                 + COALESCE(v_ship.insurance_mvr,0)
                 + COALESCE(v_ship.other_mvr,0);
  v_pool_mvr    := v_freight_mvr + v_local_mvr;

  -- Compute & write line-level costs
  WITH calc AS (
    SELECT
      sl.id, sl.sku_id, sl.qty_cartons, sl.cbm_per_carton, sl.destination_godown_id,
      sl.fob_per_carton, sl.fob_currency,
      s.pcs_per_pack, s.packs_per_carton, s.unit_size, s.unit_uom, s.cost_basis,
      m.category AS model_category,
      (sl.qty_cartons * sl.fob_per_carton *
        CASE sl.fob_currency
          WHEN 'IDR' THEN v_ship.rate_idr_to_mvr
          WHEN 'USD' THEN v_ship.rate_usd_to_mvr
          ELSE 1 END) AS fob_total_mvr,
      (sl.qty_cartons * sl.cbm_per_carton / v_total_cbm) AS cbm_share
    FROM shipment_lines sl
    JOIN skus s           ON s.id = sl.sku_id
    JOIN variants v       ON v.id = s.variant_id
    JOIN product_models m ON m.id = v.model_id
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
      ROUND(landed_total / qty_cartons, 4)                              AS per_carton,
      ROUND(landed_total / (qty_cartons * packs_per_carton), 4)         AS per_pack,
      ROUND(landed_total / (qty_cartons * packs_per_carton * pcs_per_pack), 4) AS per_piece,
      CASE cost_basis
        WHEN 'piece'     THEN ROUND(landed_total / (qty_cartons * packs_per_carton * pcs_per_pack), 4)
        WHEN 'per_100ml' THEN ROUND(
          (landed_total / (qty_cartons * packs_per_carton * pcs_per_pack))
          / (CASE unit_uom WHEN 'l' THEN unit_size*1000 ELSE unit_size END / 100.0), 4)
        WHEN 'per_100g'  THEN ROUND(
          (landed_total / (qty_cartons * packs_per_carton * pcs_per_pack))
          / (CASE unit_uom WHEN 'kg' THEN unit_size*1000 ELSE unit_size END / 100.0), 4)
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

  -- Create batches + stock_movements 'in'
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

  -- Audit
  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('shipments', p_shipment_id, 'update', 'GRN confirmed; landed costs locked', v_user);

  RETURN p_shipment_id;
END $$;

-- ── 12. Sales: deduct stock with FIFO ───────────────────────────────────

CREATE OR REPLACE FUNCTION post_sale(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order       sales_orders%ROWTYPE;
  v_line        RECORD;
  v_batch       RECORD;
  v_remaining   INTEGER;
  v_take        INTEGER;
  v_user        UUID := auth.uid();
BEGIN
  SELECT * INTO v_order FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.source_godown_id IS NULL THEN RAISE EXCEPTION 'Source godown required'; END IF;
  IF v_order.status NOT IN ('draft','confirmed') THEN
    RAISE EXCEPTION 'Order already posted';
  END IF;

  FOR v_line IN
    SELECT id, sku_id, qty_pieces FROM sales_order_lines WHERE order_id = p_order_id
  LOOP
    v_remaining := v_line.qty_pieces;
    FOR v_batch IN
      SELECT bs.batch_id, bs.qty_pieces_remaining, bs.received_at
      FROM v_batch_stock bs
      WHERE bs.sku_id = v_line.sku_id
        AND bs.godown_id = v_order.source_godown_id
        AND bs.qty_pieces_remaining > 0
      ORDER BY bs.received_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_remaining, v_batch.qty_pieces_remaining);
      INSERT INTO stock_movements
        (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, created_by)
      VALUES
        (v_batch.batch_id, v_line.sku_id, v_order.source_godown_id, 'out',
         v_take, 'sales_order', p_order_id, v_user);
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Insufficient stock for SKU % in selected godown', v_line.sku_id;
    END IF;
  END LOOP;

  UPDATE sales_orders SET status='confirmed' WHERE id = p_order_id AND status='draft';
  RETURN p_order_id;
END $$;

-- ── 13. RLS ──────────────────────────────────────────────────────────────

ALTER TABLE brands              ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_models      ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus                ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE godowns             ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_batches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_prices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_spend     ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_spend_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;

-- Master catalogue: all auth users READ, admin+manager WRITE
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'brands','product_models','variants','skus','suppliers','customers',
    'godowns','competitors','competitor_prices','marketing_spend','marketing_spend_skus'
  ]) LOOP
    EXECUTE format('CREATE POLICY %I_read  ON %I FOR SELECT USING (auth.uid() IS NOT NULL);', t, t);
    EXECUTE format('CREATE POLICY %I_write ON %I FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());', t, t);
  END LOOP;
END $$;

-- Shipments: read all authed; write admin+manager
CREATE POLICY ship_read  ON shipments      FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ship_write ON shipments      FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY shl_read   ON shipment_lines FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY shl_write  ON shipment_lines FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY ib_read    ON inventory_batches FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ib_write   ON inventory_batches FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

-- Movements: read all; staff INSERT 'out' only; admin+manager full
CREATE POLICY sm_read       ON stock_movements FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sm_staff_out  ON stock_movements FOR INSERT
  WITH CHECK (current_user_role()='staff' AND movement_type IN ('out','transfer_out','damage_out'));
CREATE POLICY sm_mgr_all    ON stock_movements FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

-- Sales: admin+manager full; staff sees + updates orders assigned to them
CREATE POLICY so_mgr_all       ON sales_orders FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY so_staff_read    ON sales_orders FOR SELECT
  USING (current_user_role()='staff' AND assigned_driver_id = auth.uid());
CREATE POLICY so_staff_update  ON sales_orders FOR UPDATE
  USING (current_user_role()='staff' AND assigned_driver_id = auth.uid())
  WITH CHECK (current_user_role()='staff' AND assigned_driver_id = auth.uid());

CREATE POLICY sol_mgr_all      ON sales_order_lines FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY sol_staff_read   ON sales_order_lines FOR SELECT
  USING (current_user_role()='staff' AND EXISTS (
    SELECT 1 FROM sales_orders so WHERE so.id=order_id AND so.assigned_driver_id=auth.uid()
  ));

-- Audit log: insert allowed; never update/delete
CREATE POLICY al_read   ON audit_log FOR SELECT USING (is_admin_or_manager());
CREATE POLICY al_insert ON audit_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
-- (no UPDATE/DELETE policies → those operations are blocked)

COMMIT;

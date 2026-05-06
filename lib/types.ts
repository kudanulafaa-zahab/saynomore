// ── SKU Hierarchy ──────────────────────────────────────────────────────────
// Brand > Category > Variant > Packaging > Unit Size > Units/Pack > Packs/Carton

export interface Brand {
  id: string;
  name: string;
  created_at: string;
}

export interface Category {
  id: string;
  brand_id: string;
  name: string;
  created_at: string;
}

export interface Variant {
  id: string;
  category_id: string;
  name: string;
  created_at: string;
}

export interface SKU {
  id: string;
  variant_id: string;
  packaging: string;         // e.g. "Bottle", "Pouch", "Can"
  unit_size: string;         // e.g. "500ml", "1L", "250pcs"
  units_per_pack: number;    // pieces in one retail pack
  packs_per_carton: number;  // packs in one shipping carton
  cbm_per_carton: number;    // cubic metres per carton
  created_at: string;
}

// ── Suppliers & Customers ──────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  country: string;
  currency: "IDR" | "USD";
  contact_name?: string;
  contact_email?: string;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  created_at: string;
}

// ── Purchase Orders ────────────────────────────────────────────────────────

export interface PurchaseOrder {
  id: string;
  supplier_id: string;
  po_number: string;
  status: "draft" | "confirmed" | "shipped" | "received";
  currency: "IDR" | "USD";
  notes?: string;
  created_at: string;
}

export interface POLine {
  id: string;
  po_id: string;
  sku_id: string;
  qty_cartons: number;
  fob_price_per_carton: number;  // in PO currency
  created_at: string;
}

// ── Shipments & Landed Cost ────────────────────────────────────────────────

export interface Shipment {
  id: string;
  po_id?: string;
  reference: string;
  status: "in_transit" | "arrived" | "grn_confirmed";
  // Forex rate locked at GRN — never change after grn_confirmed
  rate_idr_to_mvr?: number;
  rate_usd_to_mvr?: number;
  // Shipment-level costs
  freight_usd?: number;
  duty_mvr?: number;
  agent_mvr?: number;
  other_mvr?: number;
  grn_confirmed_at?: string;
  created_at: string;
}

export interface ShipmentLine {
  id: string;
  shipment_id: string;
  sku_id: string;
  qty_cartons: number;
  cbm_per_carton: number;
  fob_price_per_carton: number;
  fob_currency: "IDR" | "USD";
  // Computed in Postgres, read-only in UI
  landed_cost_per_carton?: number;
  landed_cost_per_pack?: number;
  landed_cost_per_piece?: number;
  created_at: string;
}

// ── Inventory ─────────────────────────────────────────────────────────────

export interface StockMovement {
  id: string;
  sku_id: string;
  godown_id: string;
  type: "in" | "out" | "adjust";
  qty_pieces: number;
  reference_id?: string;
  reference_type?: "shipment" | "sales_order" | "manual";
  created_at: string;
}

export interface Godown {
  id: string;
  name: string;
  location?: string;
  created_at: string;
}

// ── Sales ──────────────────────────────────────────────────────────────────

export interface SalesOrder {
  id: string;
  customer_id: string;
  order_number: string;
  status: "draft" | "confirmed" | "delivered" | "cancelled";
  channel: "whatsapp" | "instagram" | "viber" | "tiktok" | "walkin" | "other";
  payment_status: "pending" | "partial" | "paid";
  notes?: string;
  created_at: string;
}

export interface SalesOrderLine {
  id: string;
  order_id: string;
  sku_id: string;
  qty_pieces: number;
  unit_price_mvr: number;
  created_at: string;
}

// ── Expenses ───────────────────────────────────────────────────────────────

export interface Expense {
  id: string;
  category: string;
  amount_mvr: number;
  description?: string;
  date: string;
  created_at: string;
}

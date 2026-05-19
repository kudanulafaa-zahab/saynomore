"use client";

import { supabase } from "@/lib/supabase";

// ── Types ────────────────────────────────────────────────────────────────

export type OrderStatus = "draft" | "confirmed" | "picked" | "out_for_delivery" | "delivered" | "cancelled";
export type OrderChannel = "whatsapp" | "viber" | "messenger" | "instagram" | "tiktok" | "facebook" | "walkin" | "phone" | "other";
export type PaymentStatus = "pending" | "partial" | "paid" | "cod" | "deposited";
export type SaleUom = "carton" | "pack" | "piece";

export interface SalesOrderRow {
  id: string;
  order_number: string;
  customer_id: string | null;
  status: OrderStatus;
  channel: OrderChannel;
  payment_status: PaymentStatus;
  payment_method: string | null;
  payment_proof_url: string | null;
  source_godown_id: string | null;
  delivery_address: string | null;
  delivery_island: string | null;
  delivery_to_boat: boolean;
  assigned_driver_id: string | null;
  picked_at: string | null;
  delivered_at: string | null;
  cash_collected_mvr: number | null;
  cash_deposited_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesOrderLineRow {
  id: string;
  order_id: string;
  sku_id: string;
  uom: SaleUom;
  qty: number;
  qty_pieces: number;
  unit_price_mvr: number;
  line_total_mvr: number;
  notes: string | null;
}

export interface SalesOrderInput {
  order_number?: string;
  customer_id?: string | null;
  status?: OrderStatus;
  channel?: OrderChannel;
  payment_status?: PaymentStatus;
  payment_method?: string | null;
  source_godown_id?: string | null;
  delivery_address?: string | null;
  delivery_island?: string | null;
  delivery_to_boat?: boolean;
  assigned_driver_id?: string | null;
  payment_proof_url?: string | null;
  picked_at?: string | null;
  delivered_at?: string | null;
  cash_collected_mvr?: number | null;
  notes?: string | null;
}

export interface SalesOrderLineInput {
  order_id: string;
  sku_id: string;
  uom: SaleUom;
  qty: number;
  qty_pieces: number;
  unit_price_mvr: number;
  line_total_mvr: number;
  notes?: string | null;
}

// ── Reads ────────────────────────────────────────────────────────────────

export async function listOrders(): Promise<SalesOrderRow[]> {
  const { data, error } = await supabase
    .from("sales_orders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getOrder(id: string): Promise<SalesOrderRow | null> {
  const { data, error } = await supabase.from("sales_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listOrderLines(orderId: string): Promise<SalesOrderLineRow[]> {
  const { data, error } = await supabase.from("sales_order_lines").select("*").eq("order_id", orderId);
  if (error) throw error;
  return data ?? [];
}

// Driver-assigned orders (for staff view — only their own runs)
export async function listMyDeliveries(driverId: string): Promise<SalesOrderRow[]> {
  const { data, error } = await supabase
    .from("sales_orders")
    .select("*")
    .eq("assigned_driver_id", driverId)
    .in("status", ["confirmed", "picked", "out_for_delivery"])
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Admin/manager view — all confirmed/dispatching orders across all drivers
export async function listAllDispatchOrders(): Promise<SalesOrderRow[]> {
  const { data, error } = await supabase
    .from("sales_orders")
    .select("*")
    .in("status", ["confirmed", "picked", "out_for_delivery", "delivered"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── Writes ───────────────────────────────────────────────────────────────

export async function createOrder(input: SalesOrderInput) {
  const { data, error } = await supabase.from("sales_orders").insert(input).select().single();
  if (error) throw error;
  return data as SalesOrderRow;
}

export async function updateOrder(id: string, patch: Partial<SalesOrderInput>) {
  const { error } = await supabase.from("sales_orders").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteOrder(id: string) {
  const { error } = await supabase.from("sales_orders").delete().eq("id", id);
  if (error) throw error;
}

export async function createOrderLine(input: SalesOrderLineInput) {
  const { data, error } = await supabase.from("sales_order_lines").insert(input).select().single();
  if (error) throw error;
  return data as SalesOrderLineRow;
}

export async function updateOrderLine(id: string, patch: Partial<SalesOrderLineInput>) {
  const { error } = await supabase.from("sales_order_lines").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteOrderLine(id: string) {
  const { error } = await supabase.from("sales_order_lines").delete().eq("id", id);
  if (error) throw error;
}

// ── post_sale RPC (FIFO depletion) ───────────────────────────────────────

export async function postSale(orderId: string) {
  const { data, error } = await supabase.rpc("post_sale", { p_order_id: orderId });
  if (error) throw error;
  return data;
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function nextOrderNumber(existing: SalesOrderRow[]): string {
  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;
  const max = existing
    .map((o) => o.order_number)
    .filter((r) => r.startsWith(prefix))
    .map((r) => parseInt(r.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

// ── COD Reconciliation ───────────────────────────────────────────────────

export interface CodReconRow {
  driver_id:           string;
  driver_name:         string;
  orders_count:        number;
  expected_mvr:        number;
  collected_mvr:       number;
  variance_mvr:        number;
  deposited_count:     number;
  pending_deposit_mvr: number;
  recon_status:        "balanced" | "shortfall" | "overage" | "pending_deposit";
}

export interface CodOrderRow {
  order_id:        string;
  order_number:    string;
  customer_name:   string;
  order_total_mvr: number;
  collected_mvr:   number;
  payment_status:  string;
  delivered_at:    string;
}

export async function getCodReconciliation(date: string): Promise<CodReconRow[]> {
  const { data, error } = await supabase.rpc("get_cod_reconciliation", { p_date: date });
  if (error) throw error;
  return (data ?? []) as CodReconRow[];
}

export async function getCodOrdersForDriver(driverId: string, date: string): Promise<CodOrderRow[]> {
  const { data, error } = await supabase.rpc("get_cod_orders_for_driver", {
    p_driver_id: driverId,
    p_date: date,
  });
  if (error) throw error;
  return (data ?? []) as CodOrderRow[];
}

// ── Tier pricing (price_lists / price_list_items) ─────────────────────────

export interface TierPrice {
  sku_id:               string;
  price_per_piece_mvr:  number;
  price_per_pack_mvr:   number;
  price_per_carton_mvr: number;
  source:               "price_list" | "sku_default";
  price_list_name:      string | null;
  price_list_date:      string | null; // ISO date YYYY-MM-DD
}

/** Fetch tier-aware prices for a batch of SKU IDs. Returns a map sku_id → TierPrice. */
export async function getTierPricesForSkus(
  skuIds: string[],
  tier: string = "retail",
): Promise<Map<string, TierPrice>> {
  if (skuIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc("get_tier_prices_for_skus", {
    p_sku_ids: skuIds,
    p_tier: tier,
  });
  if (error) throw error;
  const map = new Map<string, TierPrice>();
  for (const row of (data ?? []) as TierPrice[]) {
    map.set(row.sku_id, row);
  }
  return map;
}

// Convert qty in any UoM to pieces, given the SKU
export function toPieces(uom: SaleUom, qty: number, pcsPerPack: number, packsPerCarton: number): number {
  if (uom === "piece") return Math.round(qty);
  if (uom === "pack") return Math.round(qty * pcsPerPack);
  // carton
  return Math.round(qty * pcsPerPack * packsPerCarton);
}

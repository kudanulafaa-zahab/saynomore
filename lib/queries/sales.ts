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
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
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
  order_total_mvr?: number;
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
  is_mixed_carton_fill: boolean;
  notes: string | null;
  /** Quantity-weighted average landed cost at the moment this line was sold. Set by post_sale; null until confirmed, and null on legacy rows sold before this column existed. */
  landed_cost_per_piece_mvr: number | null;
  /** Margin locked in at time of sale, computed from landed_cost_per_piece_mvr vs the per-piece price actually charged. Never recalculated afterward. */
  actual_margin_pct: number | null;
}

export interface SalesOrderInput {
  order_number?: string;
  customer_id?: string | null;
  status?: OrderStatus;
  channel?: OrderChannel;
  payment_status?: PaymentStatus;
  payment_method?: string | null;
  source_godown_id?: string | null;
  delivery_address_line1?: string | null;
  delivery_address_line2?: string | null;
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
  is_mixed_carton_fill?: boolean;
  notes?: string | null;
}

// ── Reads ────────────────────────────────────────────────────────────────

export async function listOrders(): Promise<SalesOrderRow[]> {
  const { data, error } = await supabase
    .from("sales_orders")
    .select("*, sales_order_lines(line_total_mvr)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as (SalesOrderRow & { sales_order_lines: { line_total_mvr: number }[] })[]).map((row) => ({
    ...row,
    order_total_mvr: row.sales_order_lines.reduce((s, l) => s + Number(l.line_total_mvr), 0),
  }));
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

/** RLS only allows this on true draft orders (no stock posted yet). For anything
 * confirmed/picked/dispatched/delivered, use voidOrder() — it reverses the
 * FIFO stock movements before cancelling instead of silently losing them. */
export async function deleteOrder(id: string) {
  const { error } = await supabase.from("sales_orders").delete().eq("id", id);
  if (error) throw error;
}

export async function createOrderLine(input: SalesOrderLineInput) {
  const { data, error } = await supabase.from("sales_order_lines").insert(input).select().single();
  if (error) throw error;
  return data as SalesOrderLineRow;
}

/** RLS only allows this on true draft orders (no stock posted yet). For a
 * confirmed/picked order, use editOrderLine() — it reverses and re-applies
 * FIFO stock so the line and stock_movements never drift apart. */
export async function updateOrderLine(id: string, patch: Partial<SalesOrderLineInput>) {
  const { error } = await supabase.from("sales_order_lines").update(patch).eq("id", id);
  if (error) throw error;
}

/** RLS only allows this on true draft orders (no stock posted yet). A line on a
 * confirmed/picked order can only be adjusted via editOrderLine(), never removed
 * outright — to remove a wrongly-added product entirely, void the whole order. */
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

// ── void_sales_order / edit_sales_order_line RPCs ────────────────────────
// Safe corrections for confirmed/picked orders: both reverse the exact FIFO
// stock_movements they created and (for edits) re-deplete for the new
// quantity, all inside one Postgres transaction. Never edit qty/price or
// delete a line/order directly once stock has been posted — use these.

/** Cancels a confirmed/picked order and reverses all of its stock movements
 * back to the exact batches they were drawn from. Blocked once payment is
 * settled (paid/deposited) or cash was collected on delivery — those need a
 * credit note, not a silent void. Requires a reason (shown in the audit log). */
export async function voidOrder(orderId: string, reason: string) {
  const { error } = await supabase.rpc("void_sales_order", { p_order_id: orderId, p_reason: reason });
  if (error) throw error;
}

/** Hard-deletes an order and returns any posted stock to inventory, in one
 * transaction (delete_sales_order RPC, admin/manager only). Reverses the exact
 * FIFO 'out' movements the sale created, then removes the order (lines +
 * payments cascade). Works for draft, active, and already-cancelled orders.
 * Blocked when payment is settled or cash was collected — those need a void +
 * credit note, not a silent erase. Use this (not deleteOrder) whenever stock
 * may have been posted or the order isn't a plain draft. */
export async function deleteSalesOrder(orderId: string, reason?: string) {
  const { error } = await supabase.rpc("delete_sales_order", { p_order_id: orderId, p_reason: reason ?? null });
  if (error) throw error;
}

/** Edits qty/price on a line of a confirmed/picked order. Reverses the line's
 * existing FIFO stock movements and re-depletes for the new quantity, then
 * recomputes line_total_mvr / landed_cost_per_piece_mvr / actual_margin_pct in
 * Postgres. Only works while the order is confirmed or picked. */
export async function editOrderLine(
  lineId: string,
  newQtyPieces: number,
  newUnitPriceMvr: number,
): Promise<SalesOrderLineRow> {
  const { data, error } = await supabase.rpc("edit_sales_order_line", {
    p_line_id: lineId,
    p_new_qty_pieces: newQtyPieces,
    p_new_unit_price_mvr: newUnitPriceMvr,
  });
  if (error) throw error;
  return data as SalesOrderLineRow;
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
  source:               "price_list" | "sku_default" | "margin";
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

// ── Payment ledger (partial payments) ────────────────────────────────────

export type PaymentMethod = "cash" | "transfer" | "cod" | "card" | "other";

export interface OrderPaymentRow {
  id: string;
  order_id: string;
  amount_mvr: number;
  method: PaymentMethod;
  paid_at: string;
  reference: string | null;
  note: string | null;
  is_reversal: boolean;
  created_by: string | null;
  created_at: string;
}

export interface OrderBalanceRow {
  order_id: string;
  order_number: string;
  customer_id: string | null;
  payment_status: PaymentStatus;
  payment_method: string | null;
  order_total_mvr: number;
  paid_mvr: number;
  balance_mvr: number;
  last_paid_at: string | null;
  payment_count: number | null;
}

/** All payment rows for an order, newest first. */
export async function listOrderPayments(orderId: string): Promise<OrderPaymentRow[]> {
  const { data, error } = await supabase
    .from("order_payments")
    .select("*")
    .eq("order_id", orderId)
    .order("paid_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OrderPaymentRow[];
}

/** Derived balance for one order (total / paid / outstanding / status). */
export async function getOrderBalance(orderId: string): Promise<OrderBalanceRow | null> {
  const { data, error } = await supabase
    .from("v_order_balances")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data as OrderBalanceRow | null;
}

/**
 * Record a payment (or a negative amount for a refund) against an order.
 * All money math + status derivation happens in Postgres.
 */
export async function recordOrderPayment(input: {
  orderId: string;
  amountMvr: number;
  method?: PaymentMethod;
  paidAt?: string;
  reference?: string | null;
  note?: string | null;
}): Promise<OrderPaymentRow> {
  const { data, error } = await supabase.rpc("record_order_payment", {
    p_order_id: input.orderId,
    p_amount_mvr: input.amountMvr,
    p_method: input.method ?? "transfer",
    p_paid_at: input.paidAt ?? new Date().toISOString(),
    p_reference: input.reference ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw error;
  return data as OrderPaymentRow;
}

/** Delete a payment row (admin/manager). Status re-syncs via trigger. */
export async function deleteOrderPayment(id: string) {
  const { error } = await supabase.from("order_payments").delete().eq("id", id);
  if (error) throw error;
}

// Convert qty in any UoM to pieces, given the SKU
export function toPieces(uom: SaleUom, qty: number, pcsPerPack: number, packsPerCarton: number): number {
  if (uom === "piece") return Math.round(qty);
  if (uom === "pack") return Math.round(qty * pcsPerPack);
  // carton
  return Math.round(qty * pcsPerPack * packsPerCarton);
}

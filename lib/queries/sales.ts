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

// Batched variant of listOrderLines for screens that render many orders at once
// (avoids one round-trip per order).
export async function listOrderLinesForOrders(orderIds: string[]): Promise<Map<string, SalesOrderLineRow[]>> {
  const byOrder = new Map<string, SalesOrderLineRow[]>();
  if (orderIds.length === 0) return byOrder;
  const { data, error } = await supabase.from("sales_order_lines").select("*").in("order_id", orderIds);
  if (error) throw error;
  for (const line of data ?? []) {
    const existing = byOrder.get(line.order_id);
    if (existing) existing.push(line);
    else byOrder.set(line.order_id, [line]);
  }
  return byOrder;
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

// Admin/manager view — every active order, plus deliveries completed *today*.
// The board's "Completed Today" section must mean today: pulling all delivered
// orders ever (as this once did) piled months of history under today's heading.
// Bound delivered to since-midnight in Maldives time (UTC+5, no DST).
export async function listAllDispatchOrders(): Promise<SalesOrderRow[]> {
  const startOfTodayMvt = mvtStartOfTodayISO();
  const { data, error } = await supabase
    .from("sales_orders")
    .select("*")
    .or(
      `status.in.(confirmed,picked,out_for_delivery),` +
      `and(status.eq.delivered,delivered_at.gte.${startOfTodayMvt})`,
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Midnight today in Maldives time (UTC+5), as a UTC ISO string. */
function mvtStartOfTodayISO(): string {
  const MVT_OFFSET_MS = 5 * 60 * 60 * 1000;
  const nowMvt = new Date(Date.now() + MVT_OFFSET_MS);
  const midnightMvtAsUtc = Date.UTC(
    nowMvt.getUTCFullYear(), nowMvt.getUTCMonth(), nowMvt.getUTCDate(),
  );
  return new Date(midnightMvtAsUtc - MVT_OFFSET_MS).toISOString();
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

/**
 * Price provenance — plain-English answer to "where did this price come from?"
 * for the salesperson at point of sale. The price itself is always computed in
 * Postgres (get_tier_prices_for_skus / v_skus); this only CLASSIFIES an already-
 * derived number, it never recomputes the selling price. It does derive a display
 * margin % and a floor warning (below cost / below target margin) from the same
 * PG-computed cost — a read-only sanity check, not a pricing calculation.
 *
 * The three sources mirror the RPC's enum exactly (no invented categories):
 *   price_list  → a set price from your price list (also where volume breaks live)
 *   sku_default → the product's fixed selling price
 *   margin      → auto-calculated from landed cost to hit a target margin
 */
export type PriceSource = "price_list" | "sku_default" | "margin";

export interface PriceProvenance {
  source:      PriceSource | null;
  label:       string;              // short tag, e.g. "List", "Fixed", "Margin 32%"
  detail:      string | null;       // secondary line for the editor, e.g. "Retail · Jul 2026"
  marginPct:   number | null;       // live margin of the shown price vs landed cost
  belowCost:   boolean;             // price ≤ landed cost (selling at a loss)
  belowTarget: boolean;             // margin below the SKU's target_margin_pct
}

function fmtListDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-MV", { month: "short", year: "numeric" });
}

/**
 * Classify a per-piece selling price against its source + the SKU's cost/target.
 * `pricePerPiece` is the shown price normalised to one piece (so margin math is
 * unit-agnostic). Pass the tier-price source when one applied, else null → falls
 * back to the SKU's own fixed/margin basis.
 */
export function describePriceSource(opts: {
  source:            PriceSource | null;
  priceListName?:    string | null;
  priceListDate?:    string | null;
  pricePerPiece:     number | null;
  landedPerPiece:    number | null;
  targetMarginPct:   number | null;
}): PriceProvenance {
  const { source, priceListName, priceListDate, pricePerPiece, landedPerPiece, targetMarginPct } = opts;

  // Live margin of the shown price (display only — price already set in PG).
  const marginPct =
    pricePerPiece != null && pricePerPiece > 0 && landedPerPiece != null
      ? ((pricePerPiece - landedPerPiece) / pricePerPiece) * 100
      : null;

  const belowCost = pricePerPiece != null && landedPerPiece != null && pricePerPiece <= landedPerPiece;
  const belowTarget =
    marginPct != null && targetMarginPct != null && targetMarginPct > 0
      ? marginPct < targetMarginPct - 0.5 // small tolerance for rounding
      : false;

  if (source === "price_list") {
    const dt = fmtListDate(priceListDate ?? null);
    return {
      source, label: "List",
      detail: [priceListName, dt].filter(Boolean).join(" · ") || "Price list",
      marginPct, belowCost, belowTarget,
    };
  }
  if (source === "sku_default") {
    return { source, label: "Fixed", detail: "Fixed selling price", marginPct, belowCost, belowTarget };
  }
  if (source === "margin") {
    const m = marginPct != null ? ` ${Math.round(marginPct)}%` : "";
    return {
      source, label: `Margin${m}`,
      detail: landedPerPiece != null ? `From cost + ${targetMarginPct ?? Math.round(marginPct ?? 0)}% margin` : "From cost + margin",
      marginPct, belowCost, belowTarget,
    };
  }
  return { source: null, label: "", detail: null, marginPct, belowCost, belowTarget };
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

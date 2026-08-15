"use client";

import { supabase } from "@/lib/supabase";
import { invalidate } from "@/lib/swr-lite";
import { mvtPlainDay } from "@/lib/mvt-date";

// ── Types ────────────────────────────────────────────────────────────────

export type OrderStatus = "draft" | "confirmed" | "picked" | "out_for_delivery" | "delivered" | "cancelled";
export type OrderChannel = "whatsapp" | "viber" | "messenger" | "instagram" | "tiktok" | "facebook" | "walkin" | "phone" | "other";
/** `credit` = the customer has paid MORE than the order is now worth, so money
 *  is owed BACK to them (migration 0161). It happens when a paid order shrinks
 *  — a line edited down, or a return. Before 0161 there was no value for it and
 *  "paid + returned >= total" collapsed an overpayment to `paid`, so an order
 *  the customer was owed MVR 2,800 on read as settled. */
export type PaymentStatus =
  | "pending"
  | "partial"
  | "paid"
  | "cod"
  | "deposited"
  | "credit";
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
  /** Plain-English contents for the list card, built in Postgres (0132) —
   *  e.g. "Xtra Kering M — 1 carton (4×48 = 192 pcs)" or
   *  "Sosoft mixed carton — 6 bottles (Blue 2 · Red 2 · Pink 1 · Purple 1)". */
  items_summary?: string | null;
  /** The customer's name, from the same row as the order (0181).
   *
   *  NULL exactly when `customer_id` is null — so this, and only this, is what
   *  "Walk-in" may be rendered from. The list used to look the name up in a
   *  separately cached customer list, which meant a customer it had not loaded
   *  yet was indistinguishable from an order with no customer at all. */
  customer_name?: string | null;
  /** Their phone, for the row's WhatsApp action — same reason as the name:
   *  a stale lookup made the button silently disappear. */
  customer_phone?: string | null;
  /** Still owed: total − payments − returns. Never recompute this client-side. */
  balance_mvr?: number;
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
  /** Godown this line is picked from. NULL = the order's own godown, which is
   *  the normal case (0164/0165). Set when the product was only stocked
   *  elsewhere — the picker has to be told, or stock leaves the wrong shelf. */
  source_godown_id: string | null;
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

// ── Paged order list (migration 0101) ────────────────────────────────────
// The Sales screen used to download EVERY order ever, with every line joined,
// and then render 20. Now it asks for one page at a time.
//
// Keyset (cursor) pagination, not page numbers: the cursor is the last row's
// (created_at, id). Postgres seeks straight to that point in the index, so
// page 500 costs the same as page 1 — where OFFSET 500 would have to walk and
// throw away 500 rows first. The id is in the cursor because two orders can
// share a timestamp; without it rows near a boundary get shown twice or
// skipped. Filtering and search run in Postgres for the same reason: with only
// one page in memory, filtering the client's array would only ever search the
// rows already downloaded.

/** Cursor for the next page. Opaque to callers — just hand it back. */
export interface OrderCursor {
  created_at: string;
  id: string;
}

export interface OrderPageFilters {
  /** Status chip. "all" or omitted = any status. */
  status?: OrderStatus | "all";
  /** Free text — matched against order number, customer name and phone. */
  search?: string;
  /** Live orders still owing money (matches the dashboard's Owed tile). */
  unpaid?: boolean;
  /** Restrict to one customer (used when expanding a customer group). */
  customerId?: string;
}

export interface OrderPage {
  rows: SalesOrderRow[];
  /** Cursor to pass as `after` for the next page; null when the list is done. */
  nextCursor: OrderCursor | null;
  /** False once a short page comes back — nothing more to load. */
  hasMore: boolean;
}

export const ORDER_PAGE_SIZE = 30;

export async function listOrdersPage(
  filters: OrderPageFilters = {},
  after: OrderCursor | null = null,
  limit: number = ORDER_PAGE_SIZE,
): Promise<OrderPage> {
  const { data, error } = await supabase.rpc("get_sales_orders", {
    p_status:            filters.status && filters.status !== "all" ? filters.status : null,
    p_search:            filters.search?.trim() || null,
    p_unpaid:            filters.unpaid ?? false,
    p_customer_id:       filters.customerId ?? null,
    p_cursor_created_at: after?.created_at ?? null,
    p_cursor_id:         after?.id ?? null,
    p_limit:             limit,
  });
  if (error) throw error;

  const rows = (data ?? []) as SalesOrderRow[];
  const last = rows[rows.length - 1];
  // A short page means we've reached the end — no extra count query needed.
  const hasMore = rows.length === limit;
  return {
    rows,
    hasMore,
    nextCursor: hasMore && last ? { created_at: last.created_at, id: last.id } : null,
  };
}

/** How many orders match the current filters. For the banner only — paging
 *  never needs it, which is the point of keyset. */
export async function countOrders(filters: OrderPageFilters = {}): Promise<number> {
  const { data, error } = await supabase.rpc("get_sales_orders_count", {
    p_status:      filters.status && filters.status !== "all" ? filters.status : null,
    p_search:      filters.search?.trim() || null,
    p_unpaid:      filters.unpaid ?? false,
    p_customer_id: filters.customerId ?? null,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

// ── Customers view of the same list ──────────────────────────────────────
// Grouping orders by customer client-side needs every order in memory — the
// exact thing we stopped downloading — so the roll-up happens in Postgres.

export interface OrderCustomerGroup {
  customer_id: string | null;
  name: string | null;
  phone: string | null;
  island: string | null;
  orders_count: number;
  active_count: number;
  delivered_count: number;
  last_order_at: string;
}

export interface CustomerCursor {
  last_order_at: string;
  customer_id: string | null;
}

export interface OrderCustomerPage {
  rows: OrderCustomerGroup[];
  nextCursor: CustomerCursor | null;
  hasMore: boolean;
}

export const CUSTOMER_PAGE_SIZE = 20;

export async function listOrderCustomersPage(
  filters: OrderPageFilters = {},
  after: CustomerCursor | null = null,
  limit: number = CUSTOMER_PAGE_SIZE,
): Promise<OrderCustomerPage> {
  const { data, error } = await supabase.rpc("get_sales_order_customers", {
    p_search:               filters.search?.trim() || null,
    p_status:               filters.status && filters.status !== "all" ? filters.status : null,
    p_unpaid:               filters.unpaid ?? false,
    p_cursor_last_order_at: after?.last_order_at ?? null,
    p_cursor_customer_id:   after?.customer_id ?? null,
    p_limit:                limit,
  });
  if (error) throw error;

  const raw = (data ?? []) as OrderCustomerGroup[];
  const rows = raw.map((r) => ({
    ...r,
    orders_count:    Number(r.orders_count),
    active_count:    Number(r.active_count),
    delivered_count: Number(r.delivered_count),
  }));
  const last = rows[rows.length - 1];
  const hasMore = rows.length === limit;
  return {
    rows,
    hasMore,
    nextCursor: hasMore && last
      ? { last_order_at: last.last_order_at, customer_id: last.customer_id }
      : null,
  };
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

// The customer's most recent real (non-draft, non-cancelled) order — feeds the
// New Sale wizard's "Repeat last order" one-tap basket. Returns only the line
// SHAPE (sku/qty/uom); prices are deliberately NOT returned — a repeated order
// is always re-priced at today's tier prices, never yesterday's.
export interface LastOrderSummary {
  orderId: string;
  createdAt: string;
  lines: { sku_id: string; qty_pieces: number; uom: SaleUom }[];
}
export async function getLastOrderForCustomer(customerId: string): Promise<LastOrderSummary | null> {
  const { data, error } = await supabase
    .from("sales_orders")
    .select("id, created_at, status, sales_order_lines(sku_id, qty_pieces, uom)")
    .eq("customer_id", customerId)
    .not("status", "in", "(draft,cancelled)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const lines = ((data as unknown as { sales_order_lines: { sku_id: string; qty_pieces: number; uom: SaleUom }[] }).sales_order_lines ?? []);
  if (lines.length === 0) return null;
  return { orderId: data.id, createdAt: data.created_at, lines };
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
/** Draft-only line delete. Safe as a plain table delete because a draft has
 *  never been posted, so no stock movements exist to reverse. For a confirmed
 *  or picked order use removeOrderLine() — see the note there. */
export async function deleteOrderLine(id: string) {
  const { error } = await supabase.from("sales_order_lines").delete().eq("id", id);
  if (error) throw error;
}

/** Removes a line from a CONFIRMED or PICKED order and gives its stock back
 *  (migration 0134).
 *
 *  This must never go back to being a table delete. On a confirmed order the
 *  stock is already deducted, so deleting only the line strands the goods:
 *  off the order and out of inventory at the same time. The RPC reverses the
 *  line's FIFO movements first, and writes an audit row. */
export async function removeOrderLine(id: string) {
  const { error } = await supabase.rpc("delete_sales_order_line", { p_line_id: id });
  if (error) throw error;
  invalidate("stock:");
}

// ── post_sale RPC (FIFO depletion) ───────────────────────────────────────

export async function postSale(orderId: string) {
  const { data, error } = await supabase.rpc("post_sale", { p_order_id: orderId });
  if (error) throw error;
  invalidate("stock:");
  return data;
}

/**
 * Creates the order, its lines and the FIFO stock deduction in ONE Postgres
 * transaction (migration 0128). Replaces the old three-step client sequence
 * (createOrder → createOrderLine × n → postSale), where an interruption
 * after the lines were saved but before post_sale ran left a real order with
 * revenue but no stock deducted — that is what happened to SO-2026-076.
 *
 * `offlineKey` is an idempotency key: replaying the same key returns the
 * order that was already created instead of creating a second one, so a
 * queued write can be retried safely.
 *
 * qty_pieces and line_total_mvr are deliberately NOT sent — Postgres derives
 * them from the SKU's own pack/carton configuration (hard rule 1). The unit
 * price IS sent, because it is a real human decision, not a derived figure.
 */
export interface NewSaleLineInput {
  sku_id: string;
  uom: SaleUom;
  qty: number;
  unit_price_mvr: number;
  is_mixed_carton_fill?: boolean;
  /** Pick this line from a specific godown instead of the order's (0164/0165).
   *  null/omitted is the normal case and means "wherever the order ships from",
   *  so a single-warehouse order is unchanged. */
  source_godown_id?: string | null;
}

export async function createAndPostSale(
  order: Record<string, unknown>,
  lines: NewSaleLineInput[],
  offlineKey?: string | null,
): Promise<{ order_id: string; order_number: string }> {
  const { data, error } = await supabase.rpc("create_and_post_sale", {
    p_order: order,
    p_lines: lines,
    p_offline_key: offlineKey ?? null,
  });
  if (error) throw error;
  invalidate("stock:");
  const row = Array.isArray(data) ? data[0] : data;
  return row as { order_id: string; order_number: string };
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
// ── Document history (migration 0103) ────────────────────────────────────
// Voiding never deletes — the order stays on record, stamped cancelled, with
// who did it, when and why. This reads that trail back so the order screen can
// actually show it.

export interface OrderAuditRow {
  id: string;
  action: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  changed_by: string | null;
  changed_by_name: string;
  created_at: string;
}

export async function getOrderAudit(orderId: string): Promise<OrderAuditRow[]> {
  const { data, error } = await supabase.rpc("get_order_audit", { p_order_id: orderId });
  if (error) throw error;
  return (data ?? []) as OrderAuditRow[];
}

/** The void entry's free-text reason, without the machine prefix.
 *  Stored as "voided — N stock movement(s) reversed. Reason: <what Ali typed>". */
export function parseVoidReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const m = reason.match(/Reason:\s*(.+)$/i);
  return (m?.[1] ?? "").trim() || null;
}

/** How many stock movements the void reversed, if the entry says so. */
export function parseVoidReversedCount(reason: string | null | undefined): number | null {
  const m = reason?.match(/(\d+)\s+stock movement/i);
  return m ? Number(m[1]) : null;
}

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
/** Records cash collected on delivery (migration 0136).
 *
 *  This is the ONLY supported way to record COD cash. It writes an
 *  `order_payments` row and the denormalised `sales_orders.cash_collected_mvr`
 *  in one transaction, so the ledger can never disagree with the order.
 *
 *  Setting `cash_collected_mvr` with a bare table update is what produced the
 *  "OWES 776" pill on an order whose detail screen said the cash was already
 *  banked: the money existed on the order but not in the ledger the balance
 *  reads. Do not reintroduce that path. */
export interface CodCollectionArgs {
  p_order_id: string;
  p_amount_mvr: number;
  p_mark_deposited: boolean;
  p_mark_delivered: boolean;
  p_note: string | null;
}

/** Builds the RPC payload, so the live call and the offline-queue entry can
 *  never drift apart in shape. */
export function codCollectionArgs(
  orderId: string,
  amountMvr: number,
  opts: { markDeposited?: boolean; markDelivered?: boolean; note?: string } = {},
): CodCollectionArgs {
  return {
    p_order_id: orderId,
    p_amount_mvr: amountMvr,
    p_mark_deposited: opts.markDeposited ?? false,
    p_mark_delivered: opts.markDelivered ?? false,
    p_note: opts.note ?? null,
  };
}

export async function recordCodCollection(args: CodCollectionArgs) {
  const { error } = await supabase.rpc("record_cod_collection", args);
  if (error) throw error;
}

export async function deleteSalesOrder(orderId: string, reason?: string) {
  const { error } = await supabase.rpc("delete_sales_order", { p_order_id: orderId, p_reason: reason ?? null });
  if (error) throw error;
}

/** What deleting this order would destroy — stock, money and line count —
 *  plus the reason the delete would be refused, if it would be (migration
 *  0133). Read before showing the confirmation so the sheet states the real
 *  cost and can block up front rather than after the fact. `blocked_reason`
 *  mirrors the guards in delete_sales_order; both change together. */
export interface SalesOrderDeleteImpact {
  order_number: string;
  customer_name: string | null;
  status: string;
  total_mvr: number;
  paid_mvr: number;
  balance_mvr: number;
  line_count: number;
  pieces_restored: number;
  /** The same stock spoken in cartons and packs, per product — what the
   *  confirmation actually prints. `pieces_restored` stays only as the
   *  "is there any stock at all" test. */
  stock_restored_summary: string | null;
  blocked_reason: string | null;
}

export async function getSalesOrderDeleteImpact(orderId: string): Promise<SalesOrderDeleteImpact> {
  const { data, error } = await supabase
    .rpc("get_sales_order_delete_impact", { p_order_id: orderId })
    .single();
  if (error) throw error;
  return data as SalesOrderDeleteImpact;
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

/**
 * Preview of the number the next order will get.
 *
 * The real number is assigned by the assign_sales_order_number trigger from an
 * atomic counter, so this is only ever a preview — but it now reads that same
 * counter instead of guessing from whichever orders the client had downloaded.
 * (The old version scanned the in-memory list; once the list is paged that
 * would have guessed from one page and shown a number already in use.)
 *
 * Falls back to a blank so the dialog degrades to "assigned on save" rather
 * than showing a confident wrong number if the read fails offline.
 */
export async function peekNextOrderNumber(): Promise<string> {
  const { data, error } = await supabase.rpc("peek_next_order_number");
  if (error) return "";
  return (data as string | null) ?? "";
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
  return mvtPlainDay(iso, { month: "short", year: "numeric" }) || null;
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

/**
 * Outstanding balance for many orders at once, keyed by order id.
 *
 * Use this — never a client-side sum of line totals — anywhere the app asks
 * "how much is still owed on this order?". A gross line-total sum ignores
 * payments already recorded and any returned goods, which is how the driver
 * screen used to tell someone to collect the full amount on an order that
 * had already been part-paid.
 */
export async function getOrderBalances(orderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (orderIds.length === 0) return out;
  const { data, error } = await supabase
    .from("v_order_balances")
    .select("order_id, balance_mvr")
    .in("order_id", orderIds);
  if (error) throw error;
  for (const r of (data ?? []) as { order_id: string; balance_mvr: number }[]) {
    out.set(r.order_id, Number(r.balance_mvr));
  }
  return out;
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

// ── Cross-sell (migration 0183) ──────────────────────────────────────────
// 55 customers buy nappies, 19 buy detergent, and not one buys both — across
// 101 orders no basket has ever held two categories. A bottle added to an order
// already being packed is the cheapest revenue in the business: no advert, no
// new customer, no second delivery.
//
// The whole decision is made in Postgres — which category they have never
// bought, what is on that warehouse's shelf, what is not being discontinued,
// what sells above cost. The screen renders one suggestion or nothing.

export interface CrossSellSuggestion {
  sku_id: string;
  label: string;
  category: string;
  /** The unit it is actually sold in — never a piece. */
  sell_unit: "pack" | "carton";
  price_mvr: number;
  packs_on_hand: number;
  /** How many OTHER customers buy it. Shown as plain social proof. */
  buyers: number;
}

/** One thing worth offering alongside this order, or null when there is
 *  nothing honest to suggest. `excludeSkus` is whatever is already in the
 *  basket. */
export async function getCrossSellSuggestion(
  customerId: string,
  godownId: string,
  excludeSkus: string[] = [],
): Promise<CrossSellSuggestion | null> {
  const { data, error } = await supabase.rpc("get_cross_sell_suggestion", {
    p_customer_id: customerId,
    p_godown_id: godownId,
    p_exclude_skus: excludeSkus,
  });
  if (error) throw error;
  return (data ?? null) as CrossSellSuggestion | null;
}

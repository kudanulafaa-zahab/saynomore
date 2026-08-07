"use client";

import { supabase } from "@/lib/supabase";
import { swrFetch, invalidate } from "@/lib/swr-lite";

// Stock numbers may be up to 30s stale on a purely passive revisit; any
// mutation in this app invalidates immediately, so the user's own actions
// always read back fresh.
const STOCK_TTL = 30_000;

// ── Stock levels (per SKU per godown) ────────────────────────────────────

export interface StockLevel {
  sku_id: string;
  godown_id: string;
  qty_pieces: number;
}

export async function listStockLevels(): Promise<StockLevel[]> {
  return swrFetch("stock:levels", STOCK_TTL, async () => {
    const { data, error } = await supabase.from("v_stock_levels").select("*");
    if (error) throw error;
    return (data ?? []) as StockLevel[];
  });
}

// ── Batch-level stock (for FIFO drill-down) ──────────────────────────────

export interface BatchStock {
  batch_id: string;
  sku_id: string;
  godown_id: string;
  received_at: string;
  landed_per_piece_mvr: number;
  qty_pieces_remaining: number;
}

/**
 * Batches that still hold stock.
 *
 * v_batch_stock keeps a row for every batch ever received, including ones sold
 * down to zero — so the payload grew with every GRN and never shrank (~790 kB
 * at five years of receiving, downloaded on Inventory and Godowns).
 *
 * Filtering here is behaviour-identical, not a behaviour change: BOTH consumers
 * already dropped these rows on arrival (`if (b.qty_pieces_remaining <= 0)
 * continue` in inventory-view and godowns-view) before counting stock, valuing
 * inventory or picking the FIFO landed cost. They were downloaded and thrown
 * away. The filter is applied HERE rather than in the view so nothing else that
 * reads v_batch_stock — including the FIFO depletion path — is affected.
 */
export async function listBatchStock(): Promise<BatchStock[]> {
  return swrFetch("stock:batches", STOCK_TTL, async () => {
    const { data, error } = await supabase
      .from("v_batch_stock")
      .select("*")
      .gt("qty_pieces_remaining", 0);
    if (error) throw error;
    return (data ?? []) as BatchStock[];
  });
}

// ── Reorder alerts (DIR-based) ───────────────────────────────────────────

export interface SkuReorderAlert {
  sku_id:            string;
  stock_pieces:      number;
  daily_avg_pieces:  number;
  dir:               number | null;   // null = no sales history
  reorder_point_pcs: number;
  alert_level:       "critical" | "low" | "ok";
}

export async function listReorderAlerts(): Promise<SkuReorderAlert[]> {
  const { data, error } = await supabase.rpc("get_sku_reorder_alerts");
  if (error) throw error;
  return (data ?? []) as SkuReorderAlert[];
}

// ── Reorder suggestions ("What to order next") ───────────────────────────
// Suggested order quantities + smart ranking, from get_reorder_suggestions RPC.

// "out" = zero on hand across all godowns while it still sells — the top
// severity, above "critical" (migration 0084).
export type ReorderStatus = "out" | "critical" | "low" | "ok" | "overstock";

export interface ReorderSuggestion {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string | null;
  internal_code: string;
  stock_pieces: number;
  stock_cartons: number;
  daily_avg_pieces: number;
  dir: number | null;            // days inventory remaining
  cover_days: number;            // target days of cover
  suggested_pieces: number;
  suggested_cartons: number;     // whole cartons to order (0 = no need)
  pcs_per_carton: number;
  revenue_per_day: number;       // ranking signal (velocity × price)
  status: ReorderStatus;
  /** Latest confirmed shipment's supplier for this SKU (0078). */
  supplier_name: string | null;
  /** Lead time learned from the last 3 confirmed shipments; null = no history. */
  lead_days: number | null;
  /** Place the order by this day so stock lands before running out; clamped
   *  to today ("already late" shows as today). Null = no sales velocity. */
  order_by_date: string | null;
  /** Demand direction: recent 30-day pace vs this SKU's own baseline (0090).
   *  Informational metadata (neutral, not a money signal) — the forward
   *  velocity already carries a capped buffer when 'rising'. */
  trend: "rising" | "steady" | "falling";
  /** Real units sold in the last 90 days (0095) — the "what actually sells"
   *  signal for ordering decisions. */
  sold_90d: number;
  /** Days in the last 30 with nothing on the shelf (0155). */
  days_unavailable_30: number;
  /** True when the selling rate was measured over the days stock was actually
   *  available rather than the calendar — i.e. this product ran out, so raw
   *  sales understate demand. The rate used to divide by 30 days regardless,
   *  which made a product that was out half the month look like it sold half
   *  as fast, so it was re-ordered short and ran out again. Xtra Kering L was
   *  understated 2x. Surface this wherever the suggestion is shown: a number
   *  that silently doubles needs its reason attached. */
  demand_censored: boolean;
}

export async function listReorderSuggestions(
  leadWeeks = 6,
  safetyWeeks = 4,
): Promise<ReorderSuggestion[]> {
  const { data, error } = await supabase.rpc("get_reorder_suggestions", {
    p_lead_weeks: leadWeeks,
    p_safety_weeks: safetyWeeks,
  });
  if (error) throw error;
  return (data ?? []) as ReorderSuggestion[];
}

// ── Manual adjustment (admin/manager) ────────────────────────────────────

export interface AdjustInput {
  sku_id: string;
  godown_id: string;
  qty_pieces: number; // positive (add) or negative (remove)
  notes?: string | null;
}

// We need an existing batch to adjust against. The simplest approach:
// adjustments live on the most recent batch in that godown for that SKU.
export async function recordAdjustment(input: AdjustInput) {
  // Find a batch
  const { data: batch, error: berr } = await supabase
    .from("inventory_batches")
    .select("id")
    .eq("sku_id", input.sku_id)
    .eq("godown_id", input.godown_id)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (berr) throw berr;
  if (!batch) {
    throw new Error("No batch exists for this SKU+godown — cannot adjust before first GRN.");
  }

  const { error } = await supabase.from("stock_movements").insert({
    batch_id: batch.id,
    sku_id: input.sku_id,
    godown_id: input.godown_id,
    movement_type: "adjustment",
    qty_pieces: input.qty_pieces,
    source_type: "adjustment",
    notes: input.notes ?? null,
  });
  if (error) throw error;
  invalidate("stock:");
}

// ── Stock write-off (damaged / expired / lost) — 0093 ─────────────────────
// The proper handling for unsellable stock: removes it FIFO and books its
// landed cost as a loss in the P&L (audit-logged). Returns the MVR loss.

export type WriteOffReason = "damaged" | "expired" | "lost" | "other";

export interface WriteOffInput {
  sku_id: string;
  godown_id: string;
  qty_pieces: number;   // positive
  reason: WriteOffReason;
  notes?: string | null;
}

export async function writeOffStock(input: WriteOffInput): Promise<number> {
  const { data, error } = await supabase.rpc("write_off_stock", {
    p_sku_id: input.sku_id,
    p_godown_id: input.godown_id,
    p_qty_pieces: input.qty_pieces,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  invalidate("stock:");
  return Number(data); // total landed cost written off
}

// Recent write-offs — makes the P&L "Damaged & write-offs" loss explainable
// (what, how much, why, when). All from Postgres (0096).
export interface WriteoffRow {
  id: string;
  created_at: string;
  brand_name: string;
  model_name: string;
  variant_display: string | null;
  qty_pieces: number;
  pcs_per_pack: number;
  pcs_per_carton: number;
  reason: string | null;   // "<reason>[: <free text>]"
  cost_mvr: number;
  godown_name: string | null;
}

/** Write-offs, optionally limited to a period (from/to as ISO dates). The P&L
 *  passes its own period so the breakdown always adds up to the shown total. */
export async function listRecentWriteoffs(
  limit = 50,
  from?: string | null,
  to?: string | null,
): Promise<WriteoffRow[]> {
  const { data, error } = await supabase.rpc("get_recent_writeoffs", {
    p_from: from ?? null,
    p_to: to ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as WriteoffRow[];
}

// ── Customer returns (0098) ───────────────────────────────────────────────
// Reverses the sale properly: goods back to the ORIGINAL batch at the original
// landed cost, revenue reversed in the P&L, and either money back (refund) or
// less owed (credit) — chosen per return.

export type ReturnReason     = "unwanted" | "wrong_item" | "defective" | "other";
export type ReturnSettlement = "refund" | "credit";

export interface ReturnResult {
  id: string;
  refund_mvr: number;
  cost_recovered_mvr: number;
  restocked: boolean;
  settlement: ReturnSettlement;
}

export async function recordCustomerReturn(input: {
  order_id: string; sku_id: string; qty_pieces: number;
  reason: ReturnReason; settlement: ReturnSettlement;
  restock: boolean; notes?: string | null;
}): Promise<ReturnResult> {
  const { data, error } = await supabase.rpc("record_customer_return", {
    p_order_id: input.order_id,
    p_sku_id: input.sku_id,
    p_qty_pieces: input.qty_pieces,
    p_reason: input.reason,
    p_settlement: input.settlement,
    p_restock: input.restock,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  invalidate("stock:");
  return data as ReturnResult;
}

export interface ReturnRow {
  id: string;
  created_at: string;
  order_number: string;
  customer_name: string;
  brand_name: string;
  model_name: string;
  variant_display: string | null;
  qty_pieces: number;
  pcs_per_pack: number;
  pcs_per_carton: number;
  refund_amount_mvr: number;
  cost_recovered_mvr: number;
  net_loss_mvr: number;
  restocked: boolean;
  reason: ReturnReason;
  settlement: ReturnSettlement;
  notes: string | null;
}

export async function listReturns(limit = 50, from?: string | null, to?: string | null): Promise<ReturnRow[]> {
  const { data, error } = await supabase.rpc("get_returns", {
    p_from: from ?? null, p_to: to ?? null, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ReturnRow[];
}

/** "Xtra Kering NB/S · 1 pk (unwanted)" — same shape as the write-off label. */
export function returnLabel(r: ReturnRow): string {
  const ppc = r.pcs_per_carton || 0;
  const qty = ppc > 0 && r.qty_pieces >= ppc
    ? `${Math.round(r.qty_pieces / ppc)} ctn`
    : r.pcs_per_pack > 0 ? `${Math.max(1, Math.round(r.qty_pieces / r.pcs_per_pack))} pk`
    : `${r.qty_pieces} pcs`;
  const why = r.reason.replace("_", " ");
  return `${[r.model_name, r.variant_display].filter(Boolean).join(" · ")} · ${qty} (${why})`;
}

/** One readable line per write-off: "Xtra Kering NB/S · 1 pk (damaged)". */
export function writeoffLabel(w: WriteoffRow): string {
  const ppc = w.pcs_per_carton || 0;
  const qty = ppc > 0 && w.qty_pieces >= ppc
    ? `${Math.round(w.qty_pieces / ppc)} ctn`
    : w.pcs_per_pack > 0 ? `${Math.max(1, Math.round(w.qty_pieces / w.pcs_per_pack))} pk`
    : `${w.qty_pieces} pcs`;
  const raw = (w.reason ?? "").trim();
  const why = (raw.split(":")[0] || "").trim();
  const name = [w.model_name, w.variant_display].filter(Boolean).join(" · ");
  return `${name} · ${qty}${why ? ` (${why})` : ""}`;
}

// ── Stock transfer (godown → godown, FIFO cost-preserving) ────────────────
// Backed by record_stock_transfer (migration 0059). Admin/manager only; all the
// FIFO batch depletion + cost preservation happens in Postgres. Returns the
// transfer id (correlates the transfer_out/transfer_in movement pair).

export interface TransferInput {
  sku_id: string;
  from_godown_id: string;
  to_godown_id: string;
  qty_pieces: number; // positive
  notes?: string | null;
}

export async function recordStockTransfer(input: TransferInput): Promise<string> {
  const { data, error } = await supabase.rpc("record_stock_transfer", {
    p_sku_id: input.sku_id,
    p_from_godown: input.from_godown_id,
    p_to_godown: input.to_godown_id,
    p_qty_pieces: input.qty_pieces,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  invalidate("stock:");
  return data as string;
}

// ── Physical verification (pre-filled count sheet) ────────────────────────
// Backed by record_verification (migration 0059). The caller submits ONLY the
// SKU lines actually counted (typically just the ones that differ from system).
// Postgres compares each to live on-hand, records the session + per-line delta,
// and posts adjustment movements (FIFO shrinkage) so on-hand snaps to reality.

export interface VerificationCount {
  sku_id: string;
  counted_pieces: number;
  reason?: string | null;
}

/**
 * Record a stock verification.
 *
 * `scopeLines` is how many items were ACTUALLY checked, including the ones
 * that turned out correct — the denominator for record accuracy. Pass it only
 * when the counter confirms they went through the whole sheet; leave it
 * undefined for a targeted correction of one or two items.
 *
 * Why it has to be asked for rather than assumed: only changed rows are
 * submitted, so without this the app can only ever see corrections, and any
 * accuracy figure computed from them is forced to 0% (see migration 0108).
 * Assuming every untouched row was "counted and correct" would be worse — it
 * would invent verification that never happened.
 */
export async function recordVerification(
  godownId: string,
  counts: VerificationCount[],
  notes?: string | null,
  scopeLines?: number,
): Promise<string> {
  const { data, error } = await supabase.rpc("record_verification", {
    p_godown_id: godownId,
    p_counts: counts,
    p_notes: notes ?? null,
    p_scope_lines: scopeLines ?? null,
  });
  if (error) throw error;
  invalidate("stock:");
  return data as string;
}

// Verification history used to be read here via v_verification_history. It is
// gone on purpose: that view does NOT exclude sessions whose stock adjustments
// were later deleted (see migration 0109 — a force-voided GRN wipes the
// movements but leaves the session behind), so anything wired to it would
// silently reintroduce the bug where deleted corrections are reported as real.
// Use listStockCountSessions() below, which reads v_stock_count_lines_live.

// ── Stock count results (migration 0107) ─────────────────────────────────
// Counting only pays for itself if the results are read back. Three things
// the old history list didn't say:
//   · the variance in MONEY (net -152 pieces is not actionable)
//   · ABSOLUTE variance as well as net — netting is how count error hides
//     (one session had -152 and +126 on two SKUs; both records were wrong,
//      but the net looked like a tidy -26)
//   · Inventory Record Accuracy — lines right / lines counted — the standard
//     cycle-count KPI, and the one number that says whether stock records can
//     be trusted at all.

export interface StockCountSummary {
  sessions: number;
  /** Sessions where the counter confirmed how many items they checked. */
  full_counts: number;
  /** Sessions that only corrected specific items — accuracy not computable. */
  corrections: number;
  /** Items actually verified across full counts (the accuracy denominator). */
  items_checked: number;
  lines_adjusted: number;
  /** Record accuracy %. NULL until at least one full count has been recorded —
   *  deliberately not faked from correction-only sessions. */
  accuracy_pct: number | null;
  /** The P&L effect — gains and losses netted off. */
  net_value_mvr: number;
  /** How wrong the books were, ignoring offsetting errors. */
  abs_value_mvr: number;
  last_counted_at: string | null;
}

export interface StockCountSession {
  session_id: string;
  verified_at: string;
  godown_id: string;
  godown_name: string;
  counted_by: string;
  lines_total: number;
  lines_discrepant: number;
  scope_lines: number | null;
  is_full_count: boolean;
  accuracy_pct: number | null;
  net_delta_pieces: number;
  abs_delta_pieces: number;
  net_value_mvr: number;
  abs_value_mvr: number;
  notes: string | null;
}

export interface StockCountVariance {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string | null;
  pcs_per_pack: number;
  packs_per_carton: number;
  times_counted: number;
  times_wrong: number;
  net_delta_pieces: number;
  abs_delta_pieces: number;
  net_value_mvr: number;
  abs_value_mvr: number;
  last_counted_at: string;
}

export async function getStockCountSummary(from?: string, to?: string): Promise<StockCountSummary> {
  const { data, error } = await supabase.rpc("get_stock_count_summary", {
    p_from: from ?? null, p_to: to ?? null,
  });
  if (error) throw error;
  return data as StockCountSummary;
}

export async function listStockCountSessions(from?: string, to?: string): Promise<StockCountSession[]> {
  const { data, error } = await supabase.rpc("get_stock_count_sessions", {
    p_from: from ?? null, p_to: to ?? null,
  });
  if (error) throw error;
  return (data ?? []) as StockCountSession[];
}

/** Products that keep drifting — ranked by absolute money impact, so a SKU
 *  whose errors cancel out still rises to the top. A product wrong in count
 *  after count is a process problem, not a counting problem. */
export async function listStockCountVariance(from?: string, to?: string): Promise<StockCountVariance[]> {
  const { data, error } = await supabase.rpc("get_stock_count_variance", {
    p_from: from ?? null, p_to: to ?? null,
  });
  if (error) throw error;
  return (data ?? []) as StockCountVariance[];
}

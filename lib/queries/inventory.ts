"use client";

import { supabase } from "@/lib/supabase";

// ── Stock levels (per SKU per godown) ────────────────────────────────────

export interface StockLevel {
  sku_id: string;
  godown_id: string;
  qty_pieces: number;
}

export async function listStockLevels(): Promise<StockLevel[]> {
  const { data, error } = await supabase.from("v_stock_levels").select("*");
  if (error) throw error;
  return (data ?? []) as StockLevel[];
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

export async function listBatchStock(): Promise<BatchStock[]> {
  const { data, error } = await supabase.from("v_batch_stock").select("*");
  if (error) throw error;
  return (data ?? []) as BatchStock[];
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

export type ReorderStatus = "critical" | "low" | "ok" | "overstock";

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
}

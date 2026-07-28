"use client";

import { supabase } from "@/lib/supabase";

export interface CompetitorRow {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
}

export type PriceBasis = "per_pack" | "per_piece" | "per_100ml" | "per_100g" | "per_carton";

export interface CompetitorPriceRow {
  id: string;
  competitor_id: string;
  variant_id: string;
  their_pcs_per_pack: number | null;
  their_unit_size: number | null;
  their_unit_uom: "pcs" | "ml" | "g" | null;
  price_mvr: number;
  price_basis: PriceBasis;
  observed_date: string;
  notes: string | null;
  created_at: string;
}

export interface CompetitorPriceInput {
  competitor_id: string;
  variant_id: string;
  their_pcs_per_pack?: number | null;
  their_unit_size?: number | null;
  their_unit_uom?: "pcs" | "ml" | "g" | null;
  price_mvr: number;
  price_basis: PriceBasis;
  observed_date: string;
  notes?: string | null;
}

export async function listCompetitors(): Promise<CompetitorRow[]> {
  const { data, error } = await supabase.from("competitors").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createCompetitor(name: string, notes?: string | null) {
  const { data, error } = await supabase.from("competitors").insert({ name, notes }).select().single();
  if (error) throw error;
  return data as CompetitorRow;
}

export async function updateCompetitor(id: string, patch: { name?: string; notes?: string | null }) {
  const { error } = await supabase.from("competitors").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCompetitor(id: string) {
  const { error } = await supabase.from("competitors").delete().eq("id", id);
  if (error) throw error;
}

/**
 * What rivals charge TODAY — the latest observation per competitor, per
 * variant, per pack size (migration 0102).
 *
 * Was: the entire price log, every time Market opened. Two problems, one
 * cause. It only ever grew (~470 kB at five years of price checking), and
 * "cheapest logged competitor" — which drives the gap %, the priced-above
 * alert and the Price Book "vs Rivals" lens — was a minimum across ALL
 * history. Given a few years of logging, a price nobody charges any more
 * would still be scored as today's cheapest rival and pull Ali's prices down
 * to match it.
 *
 * Comparing against current shelf prices is the point of competitor
 * monitoring; older readings are history. The full log is retained and
 * untouched in competitor_prices — use listCompetitorPriceHistory() for it.
 */
export async function listCompetitorPrices(): Promise<CompetitorPriceRow[]> {
  const { data, error } = await supabase
    .from("v_competitor_prices_current")
    .select("*")
    .order("observed_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Every observation ever recorded for one variant — the price trail behind
 *  the current figure. Scoped to a variant so it can never grow unbounded. */
export async function listCompetitorPriceHistory(variantId: string): Promise<CompetitorPriceRow[]> {
  const { data, error } = await supabase
    .from("competitor_prices")
    .select("*")
    .eq("variant_id", variantId)
    .order("observed_date", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function createCompetitorPrice(input: CompetitorPriceInput) {
  const { data, error } = await supabase.from("competitor_prices").insert(input).select().single();
  if (error) throw error;
  return data as CompetitorPriceRow;
}

export async function updateCompetitorPrice(id: string, patch: Partial<CompetitorPriceInput>) {
  const { error } = await supabase.from("competitor_prices").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCompetitorPrice(id: string) {
  const { error } = await supabase.from("competitor_prices").delete().eq("id", id);
  if (error) throw error;
}

// ── Competitor price gaps — every SKU currently priced above the cheapest
// logged competitor by more than the threshold. Lets Ali see problem
// products at a glance instead of checking one SKU at a time. ──

export interface CompetitorPriceGap {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string | null;
  internal_code: string;
  our_price_mvr: number;
  cheapest_competitor_mvr: number;
  cheapest_competitor_name: string;
  gap_pct: number;
}

export async function listCompetitorPriceGaps(thresholdPct = 10): Promise<CompetitorPriceGap[]> {
  const { data, error } = await supabase.rpc("get_competitor_price_gaps", { p_threshold_pct: thresholdPct });
  if (error) throw error;
  return (data ?? []) as CompetitorPriceGap[];
}

// ── Price-check cadence (migration 0104) ─────────────────────────────────
// When is a rival's price due for a fresh look?
//
// Price-intelligence vendors say check daily. That assumes a scraper. Ali
// walks into shops in Malé, so the practice that actually transfers from
// manual retail price audits is a rotating cycle weighted by importance —
// A items every 30 days, B every 60, C every 90, with ABC coming from real
// 90-day sales — plus event triggers, because a calendar alone misses the
// moment that matters: a shipment landing at a new cost, when the margin has
// just moved and the repricing decision is live.

export type PriceCheckReason = "never" | "overdue" | "cost_changed" | "ok";

export interface CompetitorPriceFreshness {
  sku_id: string;
  variant_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string | null;
  abc_class: "A" | "B" | "C";
  cadence_days: number;
  last_checked: string | null;
  days_since_check: number | null;
  cost_changed_at: string | null;
  cost_moved_since_check: boolean;
  due: boolean;
  days_overdue: number;
  due_reason: PriceCheckReason;
}

export async function listPriceCheckFreshness(): Promise<CompetitorPriceFreshness[]> {
  const { data, error } = await supabase.rpc("get_competitor_price_freshness");
  if (error) throw error;
  return (data ?? []) as CompetitorPriceFreshness[];
}

/** Plain-English why-now for a due row. */
export function priceCheckReasonLabel(r: CompetitorPriceFreshness): string {
  switch (r.due_reason) {
    case "cost_changed":
      return "New shipment landed at a different cost — margin has moved";
    case "never":
      return `Never checked · ${r.abc_class}-item`;
    case "overdue":
      return r.days_overdue > 0
        ? `${r.days_since_check} days old · ${r.days_overdue} past the ${r.cadence_days}-day cycle`
        : `${r.days_since_check} days old`;
    default:
      return r.days_since_check != null ? `Checked ${r.days_since_check} days ago` : "Checked";
  }
}

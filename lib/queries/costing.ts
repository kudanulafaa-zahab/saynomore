"use client";

// Costing sandbox — read-only "what would this shipment cost me?" modelling.
//
// Nothing in this file writes to a real cost. `simulate_landed_costs` is a
// pure SQL function (migration 0135) and `costing_scenarios` is a standalone
// table that feeds nothing. The one hard rule: the apportionment lives in
// Postgres and mirrors confirm_grn, so a simulation and the eventual real GRN
// cannot disagree. Do not reimplement any of this arithmetic here.

import { supabase } from "@/lib/supabase";

export type FobCurrency = "USD" | "IDR" | "MVR";

/** Shipment-level costs. These are shared across every line in a container,
 *  which is why they are entered once and apportioned, never per SKU.
 *
 *  The two FX rates are the SAME PAIR the real shipment form takes:
 *  USD→MVR and USD→IDR. IDR→MVR is derived from them in Postgres, exactly as
 *  `shipments.rate_idr_to_mvr` is derived (SH-2026-001: 20.50 / 16 000 =
 *  0.00128125). Asking for IDR→MVR directly — as the first version did — asks
 *  for a number Ali never has in front of him. */
export interface CostingShipmentInput {
  rate_usd_to_mvr: number;
  rate_usd_to_idr: number;
  freight_share_usd: number;
  customs_duty_mvr: number;
  mpl_charges_mvr: number;
  agent_fee_mvr: number;
  last_mile_mvr: number;
  insurance_mvr: number;
  other_mvr: number;
}

/** How the supplier quoted this line. Diapers are quoted per pack as often as
 *  per carton; a pack quote is multiplied up by packs_per_carton in Postgres.
 *  The carton figure stays the basis for the maths because that is what
 *  `shipment_lines` stores and what `confirm_grn` uses — the choice is an
 *  input convenience, never a second costing path. */
export type FobBasis = "carton" | "pack";

export interface CostingLineInput {
  sku_id: string;
  qty_cartons: number;
  cbm_per_carton: number;
  /** Send exactly one of these, matching `fob_basis`. */
  fob_per_carton?: number;
  fob_per_pack?: number;
  fob_currency: FobCurrency;
}

export interface CostingResultRow {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string;
  category_name: string | null;
  category_sort_order: number | null;
  qty_cartons: number;
  pcs_per_pack: number;
  packs_per_carton: number;
  /** Whatever the pack/carton entry resolved to — shown back so the basis is
   *  never ambiguous. */
  fob_per_carton_used: number;
  fob_total_mvr: number;
  cbm_total: number;
  cbm_share_pct: number;
  freight_mvr: number;
  local_mvr: number;
  duty_mvr: number;
  landed_total_mvr: number;
  landed_per_carton_mvr: number | null;
  landed_per_pack_mvr: number | null;
  /** Kept for the cost-per-piece comparison against the previous shipment.
   *  Never rendered on its own — see the units rule in CLAUDE.md. */
  landed_per_piece_mvr: number | null;
  current_landed_per_piece_mvr: number | null;
  delta_per_piece_mvr: number | null;
  selling_price_per_pack_mvr: number | null;
  selling_price_per_carton_mvr: number | null;
  /** Measured against the unit actually sold — pack when packs are sold. */
  simulated_margin_pct: number | null;
  current_margin_pct: number | null;
  target_margin_pct: number | null;
  /** What a PACK would have to sell for to hold the margin at this cost. */
  price_for_target_pack_mvr: number | null;
  /** 'target' when the SKU has an explicit target margin, 'current' when it
   *  falls back to the margin the SKU earns today. Only 1 of 31 SKUs has a
   *  target on file, so the screen must not claim a target that isn't set. */
  price_basis: "target" | "current" | null;
}

/** FX rates and shipment charges from the most recent real shipment. */
export interface CostingDefaults {
  reference: string;
  rate_usd_to_mvr: number;
  rate_usd_to_idr: number;
  freight_share_usd: number;
  customs_duty_mvr: number;
  mpl_charges_mvr: number;
  agent_fee_mvr: number;
  last_mile_mvr: number;
  insurance_mvr: number;
  other_mvr: number;
}

export async function getCostingDefaults(): Promise<CostingDefaults | null> {
  const { data, error } = await supabase.rpc("get_costing_defaults").maybeSingle();
  if (error) throw error;
  return (data as CostingDefaults) ?? null;
}

export interface CostingSeedRow {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string;
  category_name: string | null;
  category_sort_order: number | null;
  pcs_per_pack: number;
  packs_per_carton: number;
  cbm_per_carton: number | null;
  last_fob_per_carton: number | null;
  last_fob_currency: FobCurrency;
  last_qty_cartons: number | null;
  duty_rate_pct: number;
  current_landed_per_piece_mvr: number | null;
  selling_price_per_piece_mvr: number | null;
  target_margin_pct: number | null;
}

/** Every SKU, pre-filled from its most recent real shipment line. */
export async function getCostingSeed(): Promise<CostingSeedRow[]> {
  const { data, error } = await supabase.rpc("get_costing_seed");
  if (error) throw error;
  return (data ?? []) as CostingSeedRow[];
}

/** Runs the scenario. Read-only — see the migration header. */
export async function simulateLandedCosts(
  shipment: CostingShipmentInput,
  lines: CostingLineInput[],
): Promise<CostingResultRow[]> {
  const { data, error } = await supabase.rpc("simulate_landed_costs", {
    p_shipment: shipment,
    p_lines: lines,
  });
  if (error) throw error;
  return (data ?? []) as CostingResultRow[];
}

// ── Saved scenarios ────────────────────────────────────────────────────────

export interface ScenarioPayload {
  shipment: CostingShipmentInput;
  lines: CostingLineInput[];
}

export interface CostingScenario {
  id: string;
  name: string;
  payload: ScenarioPayload;
  updated_at: string;
}

export async function listScenarios(): Promise<CostingScenario[]> {
  const { data, error } = await supabase
    .from("costing_scenarios")
    .select("id, name, payload, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CostingScenario[];
}

export async function saveScenario(name: string, payload: ScenarioPayload, id?: string) {
  if (id) {
    const { error } = await supabase
      .from("costing_scenarios")
      .update({ name, payload, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase
    .from("costing_scenarios")
    .insert({ name, payload })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deleteScenario(id: string) {
  const { error } = await supabase.from("costing_scenarios").delete().eq("id", id);
  if (error) throw error;
}

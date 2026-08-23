"use client";

// Costing sandbox — read-only "what would this shipment cost me?" modelling.
//
// Nothing in this file writes to a real cost. `simulate_landed_costs` is a
// pure SQL function (migration 0135) and `costing_scenarios` is a standalone
// table that feeds nothing. The one hard rule: the apportionment lives in
// Postgres and mirrors confirm_grn, so a simulation and the eventual real GRN
// cannot disagree. Do not reimplement any of this arithmetic here.

import { supabase } from "@/lib/supabase";

// Re-exported from shipments, which owns shipment_lines and therefore this
// column. The two copies listed the same three currencies in a different order
// — identical in meaning and one edit away from not being.
import type { FobCurrency } from "@/lib/queries/shipments";
export type { FobCurrency };

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
  /** Shared container modelling, mirroring the Shipments cost panel exactly:
   *  my freight share = total container freight × (my CBM ÷ capacity).
   *  This is the whole reason freight is modelled rather than typed — in a
   *  shared container, adding cartons RAISES your freight bill, and a flat
   *  number cannot show that. */
  shared_container: boolean;
  /** From CONTAINER_CAPACITY_CBM in lib/queries/shipments.ts — the physical
   *  constant has one definition and is passed in, never duplicated in SQL. */
  container_capacity_cbm: number;
  total_container_freight_usd: number;
  /** Used only when the container is NOT shared. */
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

/** A product Ali does not stock, being costed before he commits to buying it.
 *  Everything here comes off a supplier quote; nothing is looked up, because
 *  there is no SKU row to look anything up in. Postgres apportions a line like
 *  this through the identical code path as a catalogue line — there is no
 *  second costing engine. */
export interface NewProductInput {
  name: string;
  variant_display?: string;
  brand_name?: string;
  category_name?: string;
  pcs_per_pack: number;
  packs_per_carton: number;
  duty_rate_pct?: number;
  sellable_units?: ("pack" | "carton" | "piece")[];
  /** What he believes he can sell it for — the anchor for margin AND for the
   *  reverse-costed maximum FOB. */
  target_price_per_pack_mvr?: number;
  target_price_per_carton_mvr?: number;
  /** The margin he wants. Without it there is nothing to work the max FOB
   *  back from, because a new product has no "current margin" to fall back on. */
  target_margin_pct?: number;
}

export interface CostingLineInput {
  /** Stable handle so results can be matched back to the row that produced
   *  them. For a catalogue line this is the sku_id. */
  key: string;
  /** Exactly one of `sku_id` or `new_product`. */
  sku_id?: string;
  new_product?: NewProductInput;
  qty_cartons: number;
  cbm_per_carton: number;
  /** Send exactly one of these, matching `fob_basis`. */
  fob_per_carton?: number;
  fob_per_pack?: number;
  fob_currency: FobCurrency;
}

/** The distinct carton sizes already in the catalogue. A prospective product's
 *  CBM is the one input a supplier quote almost never carries, and freight —
 *  the only volume-driven cost — depends entirely on it. All 31 SKUs sit in
 *  five boxes, so borrowing a real one beats guessing, and re-picking the box
 *  re-runs the simulation, which IS the sensitivity check: if the verdict
 *  survives every box, the measurement doesn't matter; if it doesn't, ask the
 *  supplier for dimensions before committing. */
export interface CartonSizeReference {
  length_cm: number;
  width_cm: number;
  height_cm: number;
  cbm_per_carton: number;
  sku_count: number;
  categories: string | null;
  example: string | null;
  min_units_per_carton: number | null;
  max_units_per_carton: number | null;
}

export async function getCartonSizeReference(): Promise<CartonSizeReference[]> {
  const { data, error } = await supabase.rpc("get_carton_size_reference");
  if (error) throw error;
  return (data ?? []) as CartonSizeReference[];
}

export interface CostingResultRow {
  line_key: string;
  sku_id: string | null;
  /** True for a product not in the catalogue — badge it, and expect the
   *  "vs today" comparisons to be null because there is no history. */
  is_new: boolean;
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
  /** What it costs to land ONE carton before anything is in it — freight +
   *  local charges + duty. Independent of the FOB, which is what makes the
   *  max-FOB inversion below exact. */
  landing_cost_per_carton_mvr: number | null;
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
  /** Reverse (target) costing — the standard buyer's number. The most he can
   *  pay per carton and still hit the margin at the assumed selling price.
   *  Exact whenever duty is 0 (all four of his categories); a close first pass
   *  otherwise, because the duty pot is itself apportioned by FOB. */
  max_fob_per_carton_mvr: number | null;
  max_fob_per_carton_usd: number | null;
  /** Room left against the quote. Negative = the quote is already too dear. */
  fob_headroom_pct: number | null;
  /** Container-level, identical on every row — returned here so the screen
   *  needs no second call. */
  container_cbm_total: number;
  container_fill_pct: number | null;
  my_freight_share_usd: number;
  /** Which unit this SKU's margin is measured against — 'pack' when it sells by
   *  the pack, 'carton' for a carton-only product like Sosoft. RETURNED by the
   *  RPC since 0199 rather than inferred: the function already decides this to
   *  pick the price it measures margin against, and a screen that guessed would
   *  be able to offer a per-pack figure for a product sold only by the carton —
   *  the standing units rule, and the exact defect that crashed the Pricing
   *  Tool. */
  price_unit: "pack" | "carton" | null;
}

/** FX rates and shipment charges from the most recent real shipment. */
export interface CostingDefaults {
  reference: string;
  rate_usd_to_mvr: number;
  rate_usd_to_idr: number;
  shared_container: boolean;
  container_size_hint: "20ft" | "40hq" | null;
  total_container_freight_usd: number;
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
  /** pcs / ml / g — mapped to a noun ("pack" / "bottle") by lib/trade-units. */
  unit_uom: "pcs" | "ml" | "g" | null;
  pcs_per_pack: number;
  packs_per_carton: number;
  cbm_per_carton: number | null;
  last_fob_per_carton: number | null;
  last_fob_currency: FobCurrency;
  last_qty_cartons: number | null;
  duty_rate_pct: number;
  current_landed_per_piece_mvr: number | null;
  selling_price_per_pack_mvr: number | null;
  selling_price_per_carton_mvr: number | null;
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

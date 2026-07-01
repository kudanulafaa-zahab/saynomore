"use client";

import { supabase } from "@/lib/supabase";

// ── Types ────────────────────────────────────────────────────────────────

export type ShipmentStatus = "draft" | "ordered" | "in_transit" | "arrived" | "grn_confirmed";
export type FobCurrency = "IDR" | "USD" | "MVR";

export interface ShipmentRow {
  id: string;
  reference: string;
  supplier_id: string | null;
  status: ShipmentStatus;
  supplier_po_number: string | null;
  expected_arrival_date: string | null;
  rate_idr_to_mvr: number | null;
  rate_usd_to_mvr: number | null;
  rate_idr_to_usd: number | null;
  shared_container: boolean;
  total_container_freight_usd: number | null;
  my_freight_share_usd: number;
  freight_share_notes: string | null;
  customs_duty_mvr: number;
  mpl_charges_mvr: number;
  agent_fee_mvr: number;
  last_mile_mvr: number;
  insurance_mvr: number;
  other_mvr: number;
  notes: string | null;
  ordered_at: string | null;
  arrived_at: string | null;
  grn_confirmed_at: string | null;
  grn_confirmed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShipmentLineRow {
  id: string;
  shipment_id: string;
  sku_id: string;
  qty_cartons: number;
  qty_cartons_actual: number | null;
  qty_loose_packs: number;
  cbm_per_carton: number;
  fob_per_carton: number;
  fob_currency: FobCurrency;
  destination_godown_id: string | null;
  fob_total_mvr: number | null;
  apportioned_freight_mvr: number | null;
  apportioned_local_mvr: number | null;
  landed_total_mvr: number | null;
  landed_per_carton_mvr: number | null;
  landed_per_pack_mvr: number | null;
  landed_per_piece_mvr: number | null;
  landed_per_unit_mvr: number | null;
  estimated_landed_per_piece_mvr: number | null;
  grn_variance_pct: number | null;
}

export interface ShipmentInput {
  reference: string;
  supplier_id?: string | null;
  status?: ShipmentStatus;
  supplier_po_number?: string | null;
  expected_arrival_date?: string | null;
  rate_idr_to_mvr?: number | null;
  rate_usd_to_mvr?: number | null;
  rate_idr_to_usd?: number | null;
  shared_container?: boolean;
  total_container_freight_usd?: number | null;
  my_freight_share_usd?: number;
  freight_share_notes?: string | null;
  customs_duty_mvr?: number;
  mpl_charges_mvr?: number;
  agent_fee_mvr?: number;
  last_mile_mvr?: number;
  insurance_mvr?: number;
  other_mvr?: number;
  notes?: string | null;
  ordered_at?: string | null;
  arrived_at?: string | null;
}

export interface ShipmentLineInput {
  shipment_id: string;
  sku_id: string;
  qty_cartons: number;
  qty_cartons_actual?: number | null;
  qty_loose_packs?: number | null;       // extra loose packs received (rare)
  cbm_per_carton: number;
  fob_per_carton: number;
  fob_currency: FobCurrency;
  destination_godown_id?: string | null;  // assigned at GRN, not at PO
  estimated_landed_per_piece_mvr?: number | null;
}

// ── Reads ────────────────────────────────────────────────────────────────

export async function listShipments(): Promise<ShipmentRow[]> {
  const { data, error } = await supabase
    .from("shipments")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getShipment(id: string): Promise<ShipmentRow | null> {
  const { data, error } = await supabase
    .from("shipments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listShipmentLines(shipmentId: string): Promise<ShipmentLineRow[]> {
  const { data, error } = await supabase
    .from("shipment_lines")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

// ── Writes ───────────────────────────────────────────────────────────────

export async function createShipment(input: ShipmentInput) {
  const { data, error } = await supabase
    .from("shipments")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as ShipmentRow;
}

export async function updateShipment(id: string, patch: Partial<ShipmentInput>) {
  const { error } = await supabase.from("shipments").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteShipment(id: string) {
  const { error } = await supabase.from("shipments").delete().eq("id", id);
  if (error) throw error;
}

export async function createShipmentLine(input: ShipmentLineInput) {
  const { data, error } = await supabase
    .from("shipment_lines")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as ShipmentLineRow;
}

export async function updateShipmentLine(id: string, patch: Partial<ShipmentLineInput>) {
  const { error } = await supabase.from("shipment_lines").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteShipmentLine(id: string) {
  const { error } = await supabase.from("shipment_lines").delete().eq("id", id);
  if (error) throw error;
}

// ── Draft PO from reorder suggestions ────────────────────────────────────
// Creates a DRAFT shipment pre-filled with the chosen SKUs + suggested cartons,
// so the "What to order next" screen turns advice into a PO in one tap. FOB and
// warehouse are left for the user to fill in the PO (warehouse is set at GRN).

export interface DraftPoLine {
  sku_id: string;
  qty_cartons: number;
  cbm_per_carton: number;
}

export async function createDraftPoFromSuggestions(lines: DraftPoLine[]): Promise<ShipmentRow> {
  // Reference is generated from existing shipments (same scheme as manual POs).
  const existing = await listShipments();
  const reference = nextShipmentRef(existing);

  const shipment = await createShipment({ reference, status: "draft" });

  // Insert all lines. fob_per_carton starts at 0 — the user enters real prices
  // in the PO before ordering; cbm comes from the SKU so CBM/costing is valid.
  const rows: ShipmentLineInput[] = lines
    .filter((l) => l.qty_cartons > 0)
    .map((l) => ({
      shipment_id: shipment.id,
      sku_id: l.sku_id,
      qty_cartons: l.qty_cartons,
      cbm_per_carton: l.cbm_per_carton,
      fob_per_carton: 0,
      fob_currency: "IDR" as FobCurrency,
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from("shipment_lines").insert(rows);
    if (error) throw error;
  }
  return shipment;
}

// ── Confirm GRN (RPC) ────────────────────────────────────────────────────

// godownId is the warehouse chosen at receiving time — used by the RPC as the
// destination for any line that doesn't already have one (warehouse is now
// assigned at GRN, not at PO). Passing it is optional for backward-compat.
export async function confirmGrn(shipmentId: string, godownId?: string | null) {
  const { data, error } = await supabase.rpc("confirm_grn", {
    p_shipment_id: shipmentId,
    p_godown_id: godownId ?? undefined,
  });
  if (error) throw error;
  return data;
}

// ── Void GRN — admin only, blocked if stock already sold (RPC) ───────────

export async function voidGrn(shipmentId: string) {
  const { error } = await supabase.rpc("admin_void_grn", { p_shipment_id: shipmentId });
  if (error) throw error;
}

// ── Force void GRN — admin only, also deletes linked sales orders (RPC) ──

export async function forceVoidGrn(shipmentId: string) {
  const { error } = await supabase.rpc("admin_force_void_grn", { p_shipment_id: shipmentId });
  if (error) throw error;
}

// ── Helpers (auto-generate reference) ────────────────────────────────────

export function nextShipmentRef(existing: ShipmentRow[]): string {
  const year = new Date().getFullYear();
  const prefix = `SH-${year}-`;
  const max = existing
    .map((s) => s.reference)
    .filter((r) => r.startsWith(prefix))
    .map((r) => parseInt(r.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

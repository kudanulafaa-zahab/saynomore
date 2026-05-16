"use client";

import { supabase } from "@/lib/supabase";
import type { PriceTier } from "@/lib/queries/masters";

// ── Types ────────────────────────────────────────────────────────────────

export interface PriceListRow {
  id:             string;
  name:           string;
  tier:           PriceTier;
  effective_from: string;  // DATE string YYYY-MM-DD
  notes:          string | null;
  created_at:     string;
}

export interface PriceListItemRow {
  id:                   string;
  price_list_id:        string;
  sku_id:               string;
  price_per_piece_mvr:  number;
  price_per_pack_mvr:   number;
  price_per_carton_mvr: number;
  margin_pct:           number | null;
  created_at:           string;
}

export interface PriceListInput {
  name:           string;
  tier:           PriceTier;
  effective_from: string;
  notes?:         string | null;
}

export interface PriceListItemInput {
  price_list_id:        string;
  sku_id:               string;
  price_per_piece_mvr:  number;
  price_per_pack_mvr:   number;
  price_per_carton_mvr: number;
  margin_pct?:          number | null;
}

// ── Price Lists ──────────────────────────────────────────────────────────

export async function listPriceLists(): Promise<PriceListRow[]> {
  const { data, error } = await supabase
    .from("price_lists")
    .select("*")
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PriceListRow[];
}

export async function createPriceList(input: PriceListInput): Promise<PriceListRow> {
  const { data, error } = await supabase
    .from("price_lists")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as PriceListRow;
}

export async function updatePriceList(id: string, patch: Partial<PriceListInput>) {
  const { error } = await supabase.from("price_lists").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deletePriceList(id: string) {
  const { error } = await supabase.from("price_lists").delete().eq("id", id);
  if (error) throw error;
}

// ── Price List Items ─────────────────────────────────────────────────────

export async function listPriceListItems(priceListId: string): Promise<PriceListItemRow[]> {
  const { data, error } = await supabase
    .from("price_list_items")
    .select("*")
    .eq("price_list_id", priceListId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as PriceListItemRow[];
}

export async function upsertPriceListItem(input: PriceListItemInput) {
  const { error } = await supabase
    .from("price_list_items")
    .upsert(input, { onConflict: "price_list_id,sku_id" });
  if (error) throw error;
}

export async function deletePriceListItem(id: string) {
  const { error } = await supabase.from("price_list_items").delete().eq("id", id);
  if (error) throw error;
}

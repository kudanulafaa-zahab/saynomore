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

export async function listCompetitorPrices(): Promise<CompetitorPriceRow[]> {
  const { data, error } = await supabase
    .from("competitor_prices")
    .select("*")
    .order("observed_date", { ascending: false });
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

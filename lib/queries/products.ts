"use client";

import { supabase } from "@/lib/supabase";

// ── Types matching the new schema ────────────────────────────────────────

export type ModelCategory = "diaper" | "liquid" | "powder" | "pieces";
export type UnitUom = "pcs" | "ml" | "g";
export type CostBasis = "piece" | "per_100ml" | "per_100g";

export interface BrandRow {
  id: string;
  name: string;
  notes: string | null;
}

export interface ModelRow {
  id: string;
  brand_id: string;
  name: string;
  category: ModelCategory;
  hs_code: string | null;
  duty_rate_pct: number | null;
  notes: string | null;
}

export interface VariantRow {
  id: string;
  model_id: string;
  attributes: Record<string, string | number>;
  display_name: string;
}

export interface SkuRow {
  id: string;
  variant_id: string;
  internal_code: string;
  supplier_barcode: string | null;
  format: string | null;
  unit_uom: UnitUom;
  unit_size: number;
  pcs_per_pack: number;
  packs_per_carton: number;
  carton_length_cm: number;
  carton_width_cm: number;
  carton_height_cm: number;
  carton_weight_kg: number | null;
  cbm_per_carton: number;
  cost_basis: CostBasis;
  is_active: boolean;
  notes: string | null;
}

// ── Reads ────────────────────────────────────────────────────────────────

export async function listBrands(): Promise<BrandRow[]> {
  const { data, error } = await supabase
    .from("brands")
    .select("id, name, notes")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listModels(): Promise<ModelRow[]> {
  const { data, error } = await supabase
    .from("product_models")
    .select("*")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listVariants(): Promise<VariantRow[]> {
  const { data, error } = await supabase
    .from("variants")
    .select("*")
    .order("display_name");
  if (error) throw error;
  return data ?? [];
}

export async function listSkus(): Promise<SkuRow[]> {
  const { data, error } = await supabase
    .from("skus")
    .select("*")
    .order("internal_code");
  if (error) throw error;
  return data ?? [];
}

// ── Writes ───────────────────────────────────────────────────────────────

export async function createBrand(name: string, notes?: string) {
  const { data, error } = await supabase
    .from("brands")
    .insert({ name, notes: notes || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export interface CreateModelInput {
  brand_id: string;
  name: string;
  category: ModelCategory;
  hs_code?: string | null;
  duty_rate_pct?: number | null;
}
export async function createModel(input: CreateModelInput) {
  const { data, error } = await supabase
    .from("product_models")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export interface CreateVariantInput {
  model_id: string;
  attributes: Record<string, string | number>;
  display_name: string;
}
export async function createVariant(input: CreateVariantInput) {
  const { data, error } = await supabase
    .from("variants")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export interface CreateSkuInput {
  variant_id: string;
  internal_code: string;
  supplier_barcode?: string | null;
  format?: string | null;
  unit_uom: UnitUom;
  unit_size: number;
  pcs_per_pack: number;
  packs_per_carton: number;
  carton_length_cm: number;
  carton_width_cm: number;
  carton_height_cm: number;
  carton_weight_kg?: number | null;
  cost_basis: CostBasis;
}
export async function createSku(input: CreateSkuInput) {
  const { data, error } = await supabase
    .from("skus")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBrand(id: string) {
  const { error } = await supabase.from("brands").delete().eq("id", id);
  if (error) throw error;
}
export async function deleteModel(id: string) {
  const { error } = await supabase.from("product_models").delete().eq("id", id);
  if (error) throw error;
}
export async function deleteVariant(id: string) {
  const { error } = await supabase.from("variants").delete().eq("id", id);
  if (error) throw error;
}
export async function toggleSkuActive(id: string, is_active: boolean) {
  const { error } = await supabase.from("skus").update({ is_active }).eq("id", id);
  if (error) throw error;
}

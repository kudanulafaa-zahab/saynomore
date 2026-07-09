"use client";

import { supabase } from "@/lib/supabase";

// ── Types ────────────────────────────────────────────────────────────────

export type UnitUom = "pcs" | "ml" | "g";
export type CostBasis = "piece" | "per_100ml" | "per_100g";

// Which tiers a product may be SOLD in (costing is always in pieces — separate).
export type SellUnit = "piece" | "pack" | "carton";

// Variant attribute keys our UI knows how to render
export type AttrKey =
  | "size"
  | "scent"
  | "format"
  | "volume_ml"
  | "weight_g"
  | "colour"
  | "other";

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  unit_uom: UnitUom;
  cost_basis: CostBasis;
  variant_attributes: AttrKey[];
  default_sellable_units: SellUnit[];
  sort_order: number;
  is_system: boolean;
  /** Customs duty rate for this category, e.g. Tobacco = 200. Apportions
   *  shipments.customs_duty_mvr across lines by rate-weighted FOB value —
   *  see confirm_grn(). 0 means "no duty" (the default for every category). */
  duty_rate_pct: number;
}

export interface BrandRow {
  id: string;
  name: string;
  notes: string | null;
}

export interface ModelRow {
  id: string;
  brand_id: string;
  category_id: string;
  name: string;
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
  pcs_per_pack: number;
  packs_per_carton: number;
  carton_length_cm: number;
  carton_width_cm: number;
  carton_height_cm: number;
  carton_weight_kg: number | null;
  cbm_per_carton: number;
  is_active: boolean;
  notes: string | null;
  // Which tiers this SKU may be sold in (pack / carton / piece)
  sellable_units: SellUnit[];
  // Pricing
  target_margin_pct: number | null;
  fixed_selling_price_mvr: number | null;
  fixed_price_per_pack_mvr: number | null;
  fixed_price_per_carton_mvr: number | null;
}

// Flat read from v_skus view — handy for the Master Data list
export interface SkuFullRow extends SkuRow {
  pcs_per_carton: number;
  attributes: Record<string, string | number>;
  variant_display: string;
  model_id: string;
  model_name: string;
  brand_id: string;
  brand_name: string;
  category_id: string;
  category_name: string;
  unit_uom: UnitUom;
  cost_basis: CostBasis;
  duty_rate_pct: number;
  default_sellable_units: SellUnit[];
  full_path: string;
  // Non-null = this brand's SKUs can be mixed to fill one carton (see
  // MixedCartonSheet in sales-list.tsx); value = pieces per carton.
  mixed_carton_pieces: number | null;
  // Pricing — all computed by v_skus
  landed_per_piece_mvr: number | null;
  selling_price_per_piece_mvr: number | null;
  selling_price_per_pack_mvr: number | null;
  selling_price_per_carton_mvr: number | null;
  actual_margin_pct: number | null; // only set when fixed_selling_price_mvr is used
  // Volume-break overrides (from v_skus, mirrors skus columns)
  fixed_price_per_pack_mvr: number | null;
  fixed_price_per_carton_mvr: number | null;
}

// ── Reads ────────────────────────────────────────────────────────────────

export async function listCategories(): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("product_categories")
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

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

/* Natural size order a distributor scans by — not alphabetical.
   Non-size variants (scent/colour/format) rank after sizes and fall
   back to alphabetical in the comparator below. */
const SKU_SIZE_RANK: Record<string, number> = {
  nb: 0, "nb/s": 1, s: 2, m: 3, l: 4, xl: 5, xxl: 6, xxxl: 7, xxxxl: 8,
};
function skuVariantRank(display: string | null | undefined): number {
  const key = (display ?? "").trim().toLowerCase();
  return key in SKU_SIZE_RANK ? SKU_SIZE_RANK[key] : 900;
}

/** Catalogue display order: brand → model line → natural variant (size) order,
    so SKUs read top-to-bottom by line instead of interleaving models.
    Exported so every list (products, shipments picker, …) sorts identically. */
export function compareSkusForDisplay(a: SkuFullRow, b: SkuFullRow): number {
  const brand = a.brand_name.localeCompare(b.brand_name);
  if (brand !== 0) return brand;
  const model = a.model_name.localeCompare(b.model_name);
  if (model !== 0) return model;
  const rank = skuVariantRank(a.variant_display) - skuVariantRank(b.variant_display);
  if (rank !== 0) return rank;
  return (a.variant_display ?? "").localeCompare(b.variant_display ?? "");
}

export async function listSkusFlat(): Promise<SkuFullRow[]> {
  const { data, error } = await supabase
    .from("v_skus")
    .select("*")
    .order("brand_name");
  if (error) throw error;
  return ((data ?? []) as SkuFullRow[]).sort(compareSkusForDisplay);
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
  category_id: string;
  name: string;
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
  pcs_per_pack: number;
  packs_per_carton: number;
  carton_length_cm: number;
  carton_width_cm: number;
  carton_height_cm: number;
  carton_weight_kg?: number | null;
  sellable_units?: SellUnit[];
  target_margin_pct?: number | null;
  fixed_selling_price_mvr?: number | null;
  fixed_price_per_pack_mvr?: number | null;
  fixed_price_per_carton_mvr?: number | null;
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

// ── Plain deletes (only succeed if the record has no children) ──────────
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
export async function deleteSku(id: string) {
  const { error } = await supabase.from("skus").delete().eq("id", id);
  if (error) throw error;
}
export async function toggleSkuActive(id: string, is_active: boolean) {
  const { error } = await supabase.from("skus").update({ is_active }).eq("id", id);
  if (error) throw error;
}

// ── Admin-only cascade deletes (refused unless caller is admin) ─────────
export async function adminDeleteBrandCascade(id: string) {
  const { error } = await supabase.rpc("admin_delete_brand_cascade", { p_brand_id: id });
  if (error) throw error;
}
export async function adminDeleteModelCascade(id: string) {
  const { error } = await supabase.rpc("admin_delete_model_cascade", { p_model_id: id });
  if (error) throw error;
}
export async function adminDeleteVariantCascade(id: string) {
  const { error } = await supabase.rpc("admin_delete_variant_cascade", { p_variant_id: id });
  if (error) throw error;
}
export async function adminDeleteSku(id: string) {
  const { error } = await supabase.rpc("admin_delete_sku", { p_sku_id: id });
  if (error) throw error;
}

// ── Updates ─────────────────────────────────────────────────────────────
export async function updateBrand(id: string, patch: { name?: string; notes?: string | null }) {
  const { error } = await supabase.from("brands").update(patch).eq("id", id);
  if (error) throw error;
}
export async function updateModel(
  id: string,
  patch: { name?: string; category_id?: string; hs_code?: string | null; duty_rate_pct?: number | null },
) {
  const { error } = await supabase.from("product_models").update(patch).eq("id", id);
  if (error) throw error;
}
export async function updateVariant(
  id: string,
  patch: { display_name?: string; attributes?: Record<string, string | number> },
) {
  const { error } = await supabase.from("variants").update(patch).eq("id", id);
  if (error) throw error;
}
export async function updateSku(
  id: string,
  patch: Partial<{
    internal_code: string;
    supplier_barcode: string | null;
    pcs_per_pack: number;
    packs_per_carton: number;
    carton_length_cm: number;
    carton_width_cm: number;
    carton_height_cm: number;
    carton_weight_kg: number | null;
    sellable_units: SellUnit[];
    target_margin_pct: number | null;
    fixed_selling_price_mvr: number | null;
    fixed_price_per_pack_mvr: number | null;
    fixed_price_per_carton_mvr: number | null;
  }>,
) {
  const { error } = await supabase.from("skus").update(patch).eq("id", id);
  if (error) throw error;
}

// ── Current user role (for hiding admin-only UI) ────────────────────────
type UserRoleValue = "admin" | "manager" | "staff" | "viewer" | null;

/* Role rarely changes within a session, yet 16 components each ask for it on
   every mount and navigation. Cache it per user id so the first call hits the
   network and the rest resolve instantly — this is one of the biggest "feels
   slow" wins (kills dozens of redundant round-trips per session).
   The cache is keyed by user id and cleared on any auth state change, so a
   logout / different login can never read a stale role. */
let _roleCache: { userId: string; role: UserRoleValue } | null = null;
let _rolePromise: Promise<UserRoleValue> | null = null;
let _authListenerBound = false;

function bindRoleCacheInvalidation() {
  if (_authListenerBound) return;
  _authListenerBound = true;
  // On sign-out / user switch, drop the cache so the next read re-fetches.
  supabase.auth.onAuthStateChange(() => { _roleCache = null; _rolePromise = null; });
}

export async function getCurrentUserRole(): Promise<UserRoleValue> {
  bindRoleCacheInvalidation();

  // Read the user id locally (no network) — the session was already validated
  // by middleware + the app layout, and RLS protects user_profiles regardless.
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) { _roleCache = null; _rolePromise = null; return null; }

  // Serve from cache when it's for the same user.
  if (_roleCache && _roleCache.userId === userId) return _roleCache.role;
  // Coalesce concurrent callers (multiple components mounting at once) onto one
  // in-flight request instead of each firing its own query.
  if (_rolePromise) return _rolePromise;

  _rolePromise = (async () => {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    if (error) { _rolePromise = null; throw error; }
    const role = (data?.role ?? null) as UserRoleValue;
    _roleCache = { userId, role };
    _rolePromise = null;
    return role;
  })();
  return _rolePromise;
}

// ── Category management ─────────────────────────────────────────────────

export interface CreateCategoryInput {
  name: string;
  description?: string | null;
  unit_uom: UnitUom;
  cost_basis: CostBasis;
  variant_attributes: AttrKey[];
  sort_order?: number;
  duty_rate_pct?: number;
}
export async function createCategory(input: CreateCategoryInput) {
  const { data, error } = await supabase
    .from("product_categories")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id: string, patch: Partial<CreateCategoryInput>) {
  const { error } = await supabase
    .from("product_categories")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCategory(id: string) {
  const { error } = await supabase.from("product_categories").delete().eq("id", id);
  if (error) throw error;
}

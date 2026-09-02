"use client";

import { supabase } from "@/lib/supabase";
import { swrFetch, invalidate } from "@/lib/swr-lite";

// ── Types ────────────────────────────────────────────────────────────────

// ONE definition of what a unit is, re-exported rather than re-declared.
//
// This file used to carry its own `"pcs" | "ml" | "g"` while lib/trade-units.ts
// carried the real eleven, and the two silently disagreed. The narrow copy is
// why the New Category form could only ever offer three units: the type would
// not permit a fourth, so a body butter could not be called a tub and a bedding
// item could not be called a set — through the app, at least. Bodybutter's
// "tub" had to be set by a migration, because the form could not say it.
//
// The database has always allowed all eleven (0193 added 'set'). Postgres
// `unit_noun` and `containerLabel` are already twins; this makes the TYPE a
// third view of the same one truth rather than a competing one.
import type { UnitUom } from "@/lib/trade-units";
export type { UnitUom };
export type CostBasis = "piece" | "per_100ml" | "per_100g";

// Which tiers a product may be SOLD in (costing is always in pieces — separate).
//
// Re-exported, not re-declared — same reason as UnitUom above. Two identical
// copies of a type are harmless right up until one of them is extended, which
// is exactly how the unit list ended up stuck at three values while the rest of
// the app knew eleven.
import type { SellUnit } from "@/lib/trade-units";
export type { SellUnit };

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
  // Product photo — one per variant (a size/scent, not per pack config),
  // uploaded by staff from the Products screen. Nullable: most have none.
  image_url: string | null;
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
  /** Business-curated browse order from product_categories.sort_order
   *  (e.g. Diapers=10, Liquid Detergent=20, Powder Detergent=30, Tobacco=100)
   *  — NOT alphabetical. Added by migration 0075_v_skus_category_sort_order. */
  category_sort_order: number;
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
  /** Net content of ONE piece — 700 for a 700ml bottle. Null when the product
   *  is counted rather than measured: a nappy has no net content (0232). */
  unit_size: number | null;
  unit_size_uom: "ml" | "g" | null;
  selling_price_per_piece_mvr: number | null;
  selling_price_per_pack_mvr: number | null;
  selling_price_per_carton_mvr: number | null;
  actual_margin_pct: number | null;
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

/** Catalogue display order: brand → category (business-curated sort_order,
    e.g. Diapers before Tobacco — NOT alphabetical) → model line → natural
    variant (size) order → packaging (smallest pack config first, for the
    rare case of two SKUs sharing brand/model/variant but different pack
    sizes), so SKUs read top-to-bottom by line instead of interleaving
    models. Exported so every list (Inventory, Godowns, Stock Ops, shipments
    picker, …) sorts identically. */
export function compareSkusForDisplay(a: SkuFullRow, b: SkuFullRow): number {
  const brand = a.brand_name.localeCompare(b.brand_name);
  if (brand !== 0) return brand;
  const category = a.category_sort_order - b.category_sort_order;
  if (category !== 0) return category;
  const model = a.model_name.localeCompare(b.model_name);
  if (model !== 0) return model;
  const rank = skuVariantRank(a.variant_display) - skuVariantRank(b.variant_display);
  if (rank !== 0) return rank;
  const variant = (a.variant_display ?? "").localeCompare(b.variant_display ?? "");
  if (variant !== 0) return variant;
  if (a.pcs_per_pack !== b.pcs_per_pack) return a.pcs_per_pack - b.pcs_per_pack;
  return a.packs_per_carton - b.packs_per_carton;
}

export async function listSkusFlat(): Promise<SkuFullRow[]> {
  // Catalogue changes rarely mid-session; price/SKU mutations below
  // invalidate immediately, so 5 min of passive reuse is safe — and makes
  // every screen that needs the catalogue paint instantly on revisit.
  return swrFetch("skus:flat", 300_000, async () => {
    const { data, error } = await supabase
      .from("v_skus")
      .select("*")
      .order("brand_name");
    if (error) throw error;
    return ((data ?? []) as SkuFullRow[]).sort(compareSkusForDisplay);
  });
}

// ── Writes ───────────────────────────────────────────────────────────────

export async function createBrand(name: string, notes?: string) {
  const { data, error } = await supabase
    .from("brands")
    .insert({ name, notes: notes || null })
    .select()
    .single();
  if (error) throw error;
  invalidate("skus:");
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
  invalidate("skus:");
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
  invalidate("skus:");
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
  invalidate("skus:");
  return data;
}

// ── Plain deletes (only succeed if the record has no children) ──────────
export async function deleteBrand(id: string) {
  const { error } = await supabase.from("brands").delete().eq("id", id);
  if (error) throw error;
  invalidate("skus:");
}
export async function deleteModel(id: string) {
  const { error } = await supabase.from("product_models").delete().eq("id", id);
  if (error) throw error;
  invalidate("skus:");
}
export async function deleteVariant(id: string) {
  const { error } = await supabase.from("variants").delete().eq("id", id);
  if (error) throw error;
  invalidate("skus:");
}
export async function deleteSku(id: string) {
  const { error } = await supabase.from("skus").delete().eq("id", id);
  if (error) throw error;
  invalidate("skus:");
}
export async function toggleSkuActive(id: string, is_active: boolean) {
  const { error } = await supabase.from("skus").update({ is_active }).eq("id", id);
  if (error) throw error;
  invalidate("skus:");
}

// ── Admin-only cascade deletes (refused unless caller is admin) ─────────
export async function adminDeleteBrandCascade(id: string) {
  const { error } = await supabase.rpc("admin_delete_brand_cascade", { p_brand_id: id });
  if (error) throw error;
  invalidate("skus:");
}
export async function adminDeleteModelCascade(id: string) {
  const { error } = await supabase.rpc("admin_delete_model_cascade", { p_model_id: id });
  if (error) throw error;
  invalidate("skus:");
}
export async function adminDeleteVariantCascade(id: string) {
  const { error } = await supabase.rpc("admin_delete_variant_cascade", { p_variant_id: id });
  if (error) throw error;
  invalidate("skus:");
}
export async function adminDeleteSku(id: string) {
  const { error } = await supabase.rpc("admin_delete_sku", { p_sku_id: id });
  if (error) throw error;
  invalidate("skus:");
}

// ── Updates ─────────────────────────────────────────────────────────────
export async function updateBrand(id: string, patch: { name?: string; notes?: string | null }) {
  const { error } = await supabase.from("brands").update(patch).eq("id", id);
  if (error) throw error;
  invalidate("skus:");
}
export async function updateModel(
  id: string,
  patch: { name?: string; category_id?: string; hs_code?: string | null; duty_rate_pct?: number | null },
) {
  const { error } = await supabase.from("product_models").update(patch).eq("id", id);
  if (error) throw error;
  invalidate("skus:");
}
export async function updateVariant(
  id: string,
  patch: {
    display_name?: string;
    attributes?: Record<string, string | number>;
    image_url?: string | null;
  },
) {
  const { error } = await supabase.from("variants").update(patch).eq("id", id);
  if (error) throw error;
  invalidate("skus:");
}

/** Upload a product photo for a variant to the public product-images bucket
 *  and return its public URL. Keyed by variant id (not original filename) so
 *  re-uploading replaces the same object instead of accumulating orphans. */
export async function uploadVariantImage(variantId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `variants/${variantId}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(path, file, { upsert: true, cacheControl: "3600" });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}
export async function updateSku(
  id: string,
  patch: Partial<{
    internal_code: string;
    supplier_barcode: string | null;
    pcs_per_pack: number;
    packs_per_carton: number;
    unit_size: number | null;
    unit_size_uom: string | null;
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
  invalidate("skus:");
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
  /** Which tiers products of this kind are sold in. Derived from the unit word
   *  when a category is created — a set, a tub or a bar is sold one at a time,
   *  so there is nothing to ask. Without this the column defaults to
   *  pack+carton and the New SKU form then demands a pack size for a bedding
   *  set, which is the busywork Ali complained about. */
  default_sellable_units?: SellUnit[];
}
export async function createCategory(input: CreateCategoryInput) {
  const { data, error } = await supabase
    .from("product_categories")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  invalidate("skus:");
  return data;
}

export async function updateCategory(id: string, patch: Partial<CreateCategoryInput>) {
  const { error } = await supabase
    .from("product_categories")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
  invalidate("skus:");
}

/** THE ONE PLACE how a kind of product is sold is decided (migration 0238).
 *  Sets it on the product TYPE and brings every active product of that type
 *  with it, audit-logged row by row in Postgres. Returns how many products
 *  followed, so the screen can say so rather than claiming a silent success.
 *
 *  Not a plain `update` on the category: that would leave the type saying one
 *  thing and its products another, which is the exact drift that let one XXXL
 *  diaper sit un-sellable by the carton. */
export async function setCategorySellableUnits(
  categoryId: string,
  units: SellUnit[],
): Promise<number> {
  const { data, error } = await supabase.rpc("set_category_sellable_units", {
    p_category_id: categoryId,
    p_units: units,
  });
  if (error) throw error;
  invalidate("skus:");
  return (data ?? 0) as number;
}

/** THE ONE PLACE the unit a net content is measured in is decided (0241) —
 *  millilitres, grams, or not measured at all. Stored as the type's
 *  `cost_basis`, which already carried exactly that fact; a second column
 *  would have been the same thing written twice.
 *
 *  Returns how many active products of that type still have NO size recorded,
 *  because that is the number worth showing him: a rival's price per 100 g
 *  means nothing until our own tubs carry one.
 *
 *  Throws rather than converts when products already record a size in the old
 *  unit. 700 ml is not 700 g — that is density, not arithmetic. */
export async function setCategoryMeasure(
  categoryId: string,
  measure: "ml" | "g" | null,
): Promise<number> {
  const { data, error } = await supabase.rpc("set_category_measure", {
    p_category_id: categoryId,
    p_measure: measure,
  });
  if (error) throw error;
  invalidate("skus:");
  return (data ?? 0) as number;
}

export async function deleteCategory(id: string) {
  const { error } = await supabase.from("product_categories").delete().eq("id", id);
  if (error) throw error;
  invalidate("skus:");
}

/* ── Creating a product in ONE transaction ─────────────────────────────────
 *
 * The New SKU card used to call createBrand -> createModel -> createVariant ->
 * createSku in sequence. Any failure at the last step left the first three
 * behind, and because a variant is unique on (model_id, attributes) — and most
 * categories here have no variant attributes, so every variant under a model
 * is {} — the NEXT attempt could not even reach the real error. It collided on
 * the orphan and reported THAT.
 *
 * Ali hit exactly this: a body butter with no carton dimensions was rejected by
 * the SKU's CHECK (carton_length_cm > 0), leaving brand + model + variant
 * stranded, and every retry then showed "duplicate key value violates unique
 * constraint variants_model_id_attributes_key" — an error about a completely
 * different thing.
 *
 * create_sku_full (migration 0177) does all four in one transaction and reuses
 * existing rows by name, so a retry HEALS instead of colliding. The four
 * functions above stay for the screens that genuinely create one thing at a
 * time; this is the only correct way to create a whole product at once.
 */
export interface CreateSkuFullInput {
  brand: string;
  category_id: string;
  model: string;
  /** Defaults to the model name when the category has no distinguishing attributes. */
  variant?: string | null;
  internal_code: string;
  pcs_per_pack: number;
  packs_per_carton: number;
  sellable_units?: SellUnit[];
  /** 0 or omitted means "no carton to measure" — stored as NULL, not zero. */
  carton_length_cm?: number | null;
  carton_width_cm?: number | null;
  carton_height_cm?: number | null;
  carton_weight_kg?: number | null;
  supplier_barcode?: string | null;
  /** The category's variant attributes, structured — `{ size: "Queen" }`.
   *
   *  WITHOUT THESE A MODEL CAN HOLD ONLY ONE VARIANT. `variants` is unique on
   *  (model_id, attributes), and this used to send nothing, so every variant
   *  the wizard ever made was `{}` and the second size of anything failed on
   *  the unique index. The wizard has always collected them; they just stopped
   *  here. Migration 0193. */
  attributes?: Record<string, string>;
}

export async function createSkuFull(input: CreateSkuFullInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_sku_full", {
    p_brand:            input.brand,
    p_category_id:      input.category_id,
    p_model:            input.model,
    p_variant:          input.variant ?? null,
    p_internal_code:    input.internal_code,
    p_pcs_per_pack:     input.pcs_per_pack,
    p_packs_per_carton: input.packs_per_carton,
    // null means "however this KIND of product is sold" — Postgres reads it
    // from the product type (0236). It used to be `?? ["pack","carton"]`, a
    // guess made here on top of the same guess made twice in the function, so
    // the product type was never consulted and every new product was born with
    // a hand-typed copy that could drift. Passing a value is still allowed and
    // is a deliberate override for that one product.
    p_sellable_units:   input.sellable_units ?? null,
    p_length_cm:        input.carton_length_cm ?? null,
    p_width_cm:         input.carton_width_cm ?? null,
    p_height_cm:        input.carton_height_cm ?? null,
    p_weight_kg:        input.carton_weight_kg ?? null,
    p_barcode:          input.supplier_barcode ?? null,
    p_attributes:       input.attributes ?? {},
  });
  if (error) throw error;
  invalidate("skus:");
  return data as string;
}

// ── Correcting a mistyped name (migration 0205) ──────────────────────────
//
// Ali, 2026-08-24: *"I entered a product name by mistake... How can I correct
// this and any other future mistakes? Like spelling mistakes or a different
// name by mistake?"*
//
// He could not. `updateBrand`, `updateModel` and `updateVariant` above have
// been in this file the whole time and are called from NOWHERE — the dialogs
// that used them were deleted as dead code in August with a note saying names
// are edited through products-explorer's own sheets. They are not.
//
// This goes through an RPC rather than three table updates for three reasons,
// none of them style: the audit row and the change must be one transaction
// (a rename rewrites what every past document appears to say); a name clash
// must come back as a sentence rather than "duplicate key value violates
// unique constraint"; and one door cannot drift from another.
//
// THE SKU CODE DOES NOT CHANGE. That is deliberate and is the universal
// convention — the code is the permanent reference that ends up on labels and
// paperwork, the name is the description. See migration 0205.

export type CataloguePart = "brand" | "model" | "variant";

/** Corrects a mistyped brand, product or size name. History stays attached:
 *  every past batch, movement and order line keeps pointing at the same row,
 *  so they simply start reading the corrected name. Returns the OLD name, so
 *  the screen can say exactly what changed. Admin or manager only — enforced
 *  in Postgres, not here. */
export async function renameCataloguePart(
  kind: CataloguePart, id: string, name: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("rename_catalogue_part", {
    p_kind: kind, p_id: id, p_name: name,
  });
  if (error) throw error;
  invalidate("skus:");
  return data as string;
}

/* ── Correcting a pack size that was typed wrong (migrations 0224–0226) ─────
 *
 * `block_pack_config_change_with_history` refuses to change pcs_per_pack or
 * packs_per_carton once a product has batches or sales, and it is right to: a
 * different pack format is a different product. But it cannot tell that case
 * apart from a plain typo, where no business event happened at all and only
 * the number the app divides by was wrong.
 *
 * That is what these two are for. `getPackConfigChangeImpact` is read-only and
 * says what would move, in packs and cartons and rufiyaa. `correctPackConfig`
 * does it — as a restatement, with a written reason, re-deriving every piece
 * figure from the packs and cartons that were actually transacted.
 *
 * Cost per pack is carton cost / packs per carton, so pcs_per_pack does not
 * appear in it: correcting only the pack size moves no money at all, and
 * `money_moves` says so before anyone agrees.
 */
export interface PackConfigImpact {
  sku_id: string;
  internal_code: string;
  code_after: string;
  from: { pcs_per_pack: number; packs_per_carton: number; pcs_per_carton: number };
  to:   { pcs_per_pack: number; packs_per_carton: number; pcs_per_carton: number };
  /** True only when packs-per-carton moves — the one change that re-costs. */
  money_moves: boolean;
  stock: { godown: string; packs: number; pieces_now: number; pieces_after: number }[];
  cost: {
    batches: number;
    cost_per_carton_mvr: number | null;
    cost_per_pack_now_mvr: number | null;
    cost_per_pack_after_mvr: number | null;
  };
  sales: { lines: number; revenue_mvr: number; cogs_now_mvr: number; cogs_after_mvr: number };
  /** Non-empty means the restatement is refused, and why. */
  blockers: { godown: string; pieces: number; detail: string }[];
}

export async function getPackConfigChangeImpact(
  skuId: string, pcsPerPack: number, packsPerCarton: number,
): Promise<PackConfigImpact> {
  const { data, error } = await supabase.rpc("get_pack_config_change_impact", {
    p_sku_id: skuId, p_pcs_per_pack: pcsPerPack, p_packs_per_carton: packsPerCarton,
  });
  if (error) throw error;
  return data as PackConfigImpact;
}

export async function correctPackConfig(
  skuId: string, pcsPerPack: number, packsPerCarton: number, reason: string,
): Promise<{ internal_code: string; ledger_entries: number }> {
  const { data, error } = await supabase.rpc("correct_pack_config", {
    p_sku_id: skuId, p_pcs_per_pack: pcsPerPack,
    p_packs_per_carton: packsPerCarton, p_reason: reason,
  });
  if (error) throw error;
  invalidate("skus:");
  return data as { internal_code: string; ledger_entries: number };
}

"use client";

import { supabase } from "@/lib/supabase";

export type SellUnit = "piece" | "pack" | "carton";

// Mirrors get_storefront_catalogue()'s return row exactly (migration 0115) —
// no cost/margin/internal column exists here even if someone adds one to
// v_skus later, because this never reads v_skus.
export interface CatalogueRow {
  sku_id: string;
  brand_id: string;
  brand_name: string;
  model_id: string;
  model_name: string;
  variant_id: string;
  variant_display: string;
  attributes: Record<string, string | number>;
  image_url: string | null;
  category_id: string;
  category_name: string;
  category_sort_order: number;
  pcs_per_pack: number;
  packs_per_carton: number;
  pcs_per_carton: number;
  sellable_units: SellUnit[];
  mixed_carton_pieces: number | null;
  is_seasonal: boolean;
  is_on_sale: boolean;
  selling_price_per_piece_mvr: number | null;
  selling_price_per_pack_mvr: number | null;
  selling_price_per_carton_mvr: number | null;
  is_orderable: boolean;
}

// The lowest per-unit price this variant is orderable at, for the "from
// MVR X" line on its card — usually the per-piece price, but not every SKU
// sells by the piece (sellable_units varies per SKU).
export function fromPrice(row: CatalogueRow): number | null {
  const candidates: number[] = [];
  if (row.sellable_units.includes("piece") && row.selling_price_per_piece_mvr != null) {
    candidates.push(row.selling_price_per_piece_mvr);
  }
  if (row.sellable_units.includes("pack") && row.selling_price_per_pack_mvr != null) {
    candidates.push(row.selling_price_per_pack_mvr);
  }
  if (row.sellable_units.includes("carton") && row.selling_price_per_carton_mvr != null) {
    candidates.push(row.selling_price_per_carton_mvr);
  }
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

export async function getCatalogue(): Promise<CatalogueRow[]> {
  const { data, error } = await supabase.rpc("get_storefront_catalogue");
  if (error) throw error;
  return data ?? [];
}

// ── Grouping helpers — the catalogue must always be browsed grouped by
// product (category → brand → model → variant), never as a flat SKU list. ──

export interface BrandGroup {
  brand_id: string;
  brand_name: string;
  models: ModelGroup[];
}

export interface ModelGroup {
  model_id: string;
  model_name: string;
  mixed_carton_pieces: number | null;
  is_seasonal: boolean;
  is_on_sale: boolean;
  variants: CatalogueRow[];
}

export interface CategoryGroup {
  category_id: string;
  category_name: string;
  category_sort_order: number;
  brands: BrandGroup[];
}

export function groupCatalogue(rows: CatalogueRow[]): CategoryGroup[] {
  const categories = new Map<string, CategoryGroup>();

  for (const row of rows) {
    let cat = categories.get(row.category_id);
    if (!cat) {
      cat = {
        category_id: row.category_id,
        category_name: row.category_name,
        category_sort_order: row.category_sort_order,
        brands: [],
      };
      categories.set(row.category_id, cat);
    }

    let brand = cat.brands.find((b) => b.brand_id === row.brand_id);
    if (!brand) {
      brand = { brand_id: row.brand_id, brand_name: row.brand_name, models: [] };
      cat.brands.push(brand);
    }

    let model = brand.models.find((m) => m.model_id === row.model_id);
    if (!model) {
      model = {
        model_id: row.model_id,
        model_name: row.model_name,
        mixed_carton_pieces: row.mixed_carton_pieces,
        is_seasonal: row.is_seasonal,
        is_on_sale: row.is_on_sale,
        variants: [],
      };
      brand.models.push(model);
    }

    model.variants.push(row);
  }

  return Array.from(categories.values()).sort(
    (a, b) => a.category_sort_order - b.category_sort_order,
  );
}

// Seasonal is not a real category — it's a synthesized cross-cut that pulls
// every is_seasonal model out of whatever category/brand it actually lives
// in (e.g. The Body Shop under Body Care). A model can be seasonal from any
// category, so this scans all rows, not one category's rows. Models still
// appear in their real category too — Seasonal is an additional lens, not a
// move.
export function groupSeasonal(rows: CatalogueRow[]): BrandGroup[] {
  const seasonalRows = rows.filter((r) => r.is_seasonal);
  const brands = new Map<string, BrandGroup>();

  for (const row of seasonalRows) {
    let brand = brands.get(row.brand_id);
    if (!brand) {
      brand = { brand_id: row.brand_id, brand_name: row.brand_name, models: [] };
      brands.set(row.brand_id, brand);
    }

    let model = brand.models.find((m) => m.model_id === row.model_id);
    if (!model) {
      model = {
        model_id: row.model_id,
        model_name: row.model_name,
        mixed_carton_pieces: row.mixed_carton_pieces,
        is_seasonal: row.is_seasonal,
        is_on_sale: row.is_on_sale,
        variants: [],
      };
      brand.models.push(model);
    }

    model.variants.push(row);
  }

  return Array.from(brands.values());
}

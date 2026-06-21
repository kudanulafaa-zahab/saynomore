import "server-only";
import { getSupabaseServer } from "@/lib/supabase-server";
import {
  compareSkusForDisplay,
  type CategoryRow, type BrandRow, type ModelRow, type VariantRow, type SkuFullRow,
} from "@/lib/queries/products";

/**
 * Server-side data for the Products explorer (default tab) — see
 * app/(app)/shipments/data.ts. Replaces five client-side mount queries.
 * Mirrors lib/queries/products.ts selects.
 */
export interface ProductsData {
  categories: CategoryRow[];
  brands: BrandRow[];
  models: ModelRow[];
  variants: VariantRow[];
  skus: SkuFullRow[];
}

export async function getProductsData(): Promise<ProductsData> {
  const supabase = await getSupabaseServer();

  const [catRes, brandRes, modelRes, variantRes, skuRes] = await Promise.all([
    supabase.from("product_categories").select("*").order("sort_order"),
    supabase.from("brands").select("id, name, notes").order("name"),
    supabase.from("product_models").select("*").order("name"),
    supabase.from("variants").select("*").order("display_name"),
    supabase.from("v_skus").select("*").order("brand_name"),
  ]);

  return {
    categories: (catRes.data ?? []) as CategoryRow[],
    brands: (brandRes.data ?? []) as BrandRow[],
    models: (modelRes.data ?? []) as ModelRow[],
    variants: (variantRes.data ?? []) as VariantRow[],
    skus: ((skuRes.data ?? []) as SkuFullRow[]).sort(compareSkusForDisplay),
  };
}

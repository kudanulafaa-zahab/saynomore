import "server-only";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { SkuFullRow } from "@/lib/queries/products";
import type { GodownRow } from "@/lib/queries/masters";
import type { BatchStock, SkuReorderAlert } from "@/lib/queries/inventory";
import { compareSkusForDisplay } from "@/lib/queries/products";

/**
 * Server-side data for the Inventory screen — see app/(app)/shipments/data.ts.
 * Replaces four client-side mount queries. Mirrors lib/queries/* selects.
 */
export interface InventoryData {
  skus: SkuFullRow[];
  godowns: GodownRow[];
  batches: BatchStock[];
  alerts: SkuReorderAlert[];
}

export async function getInventoryData(): Promise<InventoryData> {
  const supabase = await getSupabaseServer();

  const [skusRes, godownsRes, batchesRes, alertsRes] = await Promise.all([
    supabase.from("v_skus").select("*").order("brand_name"),
    supabase.from("godowns").select("*").order("name"),
    supabase.from("v_batch_stock").select("*"),
    supabase.rpc("get_sku_reorder_alerts"),
  ]);

  return {
    skus: ((skusRes.data ?? []) as SkuFullRow[]).sort(compareSkusForDisplay),
    godowns: (godownsRes.data ?? []) as GodownRow[],
    batches: (batchesRes.data ?? []) as BatchStock[],
    alerts: (alertsRes.data ?? []) as SkuReorderAlert[],
  };
}

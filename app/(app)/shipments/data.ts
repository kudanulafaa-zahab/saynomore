import "server-only";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { ShipmentRow } from "@/lib/queries/shipments";
import type { SupplierRow } from "@/lib/queries/masters";
import type { SkuFullRow } from "@/lib/queries/products";
import type { SkuReorderAlert } from "@/lib/queries/inventory";
import { compareSkusForDisplay } from "@/lib/queries/products";

/**
 * Server-side data for the Shipments screen.
 *
 * The list view used to fetch all four of these on the CLIENT after mount,
 * which meant the user waited for: JS download -> parse -> mount -> 4 network
 * round-trips, before seeing anything. Fetching here on the server runs the
 * same four queries close to the database and ships the result with the HTML,
 * so the screen arrives already populated. The route's loading.tsx streams the
 * skeleton instantly while this runs.
 *
 * Mirrors the browser queries in lib/queries/* (those are "use client" and bound
 * to the browser supabase client, so we re-issue the identical selects here with
 * the server client). Keep these in sync if the client query shapes change.
 */
export interface ShipmentsData {
  shipments: ShipmentRow[];
  suppliers: SupplierRow[];
  skus: SkuFullRow[];
  alerts: SkuReorderAlert[];
}

export async function getShipmentsData(): Promise<ShipmentsData> {
  const supabase = await getSupabaseServer();

  const [shipmentsRes, suppliersRes, skusRes, alertsRes] = await Promise.all([
    supabase.from("shipments").select("*").order("created_at", { ascending: false }),
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("v_skus").select("*").order("brand_name"),
    supabase.rpc("get_sku_reorder_alerts"),
  ]);

  // Soft-fail: a single failed query shouldn't blank the whole screen. Return
  // what we have; the client view re-fetches on user actions anyway.
  const shipments = (shipmentsRes.data ?? []) as ShipmentRow[];
  const suppliers = (suppliersRes.data ?? []) as SupplierRow[];
  const skus = ((skusRes.data ?? []) as SkuFullRow[]).sort(compareSkusForDisplay);
  const alerts = (alertsRes.data ?? []) as SkuReorderAlert[];

  return { shipments, suppliers, skus, alerts };
}

import "server-only";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { SalesOrderRow } from "@/lib/queries/sales";
import type { CustomerRow, GodownRow } from "@/lib/queries/masters";
import type { SkuFullRow } from "@/lib/queries/products";
import type { StockLevel } from "@/lib/queries/inventory";
import { compareSkusForDisplay } from "@/lib/queries/products";

/**
 * Server-side data for the Sales screen — see app/(app)/shipments/data.ts for
 * the rationale. The list view fetched FIVE queries on the client after mount;
 * we run them here so the page ships populated. Mirrors lib/queries/* selects.
 */
export interface SalesData {
  orders: SalesOrderRow[];
  customers: CustomerRow[];
  skus: SkuFullRow[];
  godowns: GodownRow[];
  stockLevels: StockLevel[];
}

export async function getSalesData(): Promise<SalesData> {
  const supabase = await getSupabaseServer();

  const [ordersRes, customersRes, skusRes, godownsRes, stockRes] = await Promise.all([
    supabase.from("sales_orders").select("*, sales_order_lines(line_total_mvr)").order("created_at", { ascending: false }),
    supabase.from("customers").select("*").order("name"),
    supabase.from("v_skus").select("*").order("brand_name"),
    supabase.from("godowns").select("*").order("name"),
    supabase.from("v_stock_levels").select("*"),
  ]);

  // Compute order_total_mvr from joined lines — identical to listOrders().
  const orders = ((ordersRes.data ?? []) as (SalesOrderRow & {
    sales_order_lines: { line_total_mvr: number }[];
  })[]).map((row) => ({
    ...row,
    order_total_mvr: row.sales_order_lines.reduce((s, l) => s + Number(l.line_total_mvr), 0),
  }));

  return {
    orders,
    customers: (customersRes.data ?? []) as CustomerRow[],
    skus: ((skusRes.data ?? []) as SkuFullRow[]).sort(compareSkusForDisplay),
    godowns: (godownsRes.data ?? []) as GodownRow[],
    stockLevels: (stockRes.data ?? []) as StockLevel[],
  };
}

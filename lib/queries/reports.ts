"use client";

import { supabase } from "@/lib/supabase";

export interface ReportRow {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string;
  internal_code: string;
  unit_uom: "pcs" | "ml" | "g";
  pcs_per_pack: number;
  packs_per_carton: number;
  total_qty_pieces: number;
  total_revenue_mvr: number;
  avg_unit_price_mvr: number;
  landed_per_piece_mvr: number;
  gross_margin_pct: number | null;
  stock_pieces: number;
  days_of_stock: number | null;
}

export async function getReportsData(from: string, to: string): Promise<ReportRow[]> {
  const { data, error } = await supabase.rpc("get_reports_data", {
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as ReportRow[];
}

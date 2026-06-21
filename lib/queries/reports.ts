"use client";

import { supabase } from "@/lib/supabase";

export interface ReportRow {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string;
  internal_code: string;
  pcs_per_pack: number;
  packs_per_carton: number;
  total_qty_pieces: number;
  total_revenue_mvr: number;
  avg_unit_price_mvr: number;
  landed_per_piece_mvr: number;
  total_landed_cost_mvr: number;
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

export interface ContributionRow {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string;
  internal_code: string;
  total_qty_pieces: number;
  total_revenue_mvr: number;
  avg_unit_price_mvr: number;
  landed_per_piece_mvr: number;
  total_landed_cost_mvr: number;
  gross_margin_pct: number | null;
  marketing_spend_mvr: number;
  mktg_per_piece_mvr: number;
  contribution_mvr: number;
  contribution_per_piece: number;
  contribution_margin_pct: number | null;
}

export async function getContributionMargin(from: string, to: string): Promise<ContributionRow[]> {
  const { data, error } = await supabase.rpc("get_contribution_margin", {
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as ContributionRow[];
}

export interface MonthlyRevenueRow {
  month_label: string;
  month_start: string;
  revenue_mvr: number;
  opex_mvr: number;
}

export async function getMonthlyRevenue(months = 6): Promise<MonthlyRevenueRow[]> {
  const { data, error } = await supabase.rpc("get_monthly_revenue", { p_months: months });
  if (error) throw error;
  return (data ?? []) as MonthlyRevenueRow[];
}

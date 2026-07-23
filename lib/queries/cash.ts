"use client";

import { supabase } from "@/lib/supabase";

// ── Cash-flow forecast (migration 0089) ──────────────────────────────────────
// The import-runway blind spot: "will I have cash for the next shipment?"
// All figures are computed in Postgres; the UI only renders them and shows the
// assumptions the engine returns so the forecast is honest about its inputs.

export interface CashForecastMeta {
  opening_balance_mvr: number;
  has_opening: boolean;
  snapshot_as_of: string | null;
  snapshot_age_days: number | null;
  weekly_sales_in_mvr: number;       // trailing-90d avg weekly collections
  weekly_operating_out_mvr: number;  // trailing-90d avg weekly (expenses + marketing)
  receivables_total_mvr: number;     // owed now, spread over the first 4 weeks
  undated_shipment_cost_mvr: number; // open shipments with no arrival date yet
  undated_shipment_count: number;
}

export interface CashForecastWeek {
  week_index: number;
  week_start: string;              // ISO date (Monday of the week)
  cash_in_mvr: number;
  cash_out_mvr: number;            // operating out (excludes shipment)
  shipment_out_mvr: number;
  net_mvr: number;
  projected_balance_mvr: number;
}

export async function getCashForecastMeta(): Promise<CashForecastMeta | null> {
  const { data, error } = await supabase.rpc("get_cash_forecast_meta");
  if (error) throw error;
  return (data?.[0] ?? null) as CashForecastMeta | null;
}

export async function getCashForecast(weeks = 13): Promise<CashForecastWeek[]> {
  const { data, error } = await supabase.rpc("get_cash_forecast", { p_weeks: weeks });
  if (error) throw error;
  return (data ?? []) as CashForecastWeek[];
}

export async function setCashBalance(
  amountMvr: number,
  asOf: string,
  note?: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc("set_cash_balance", {
    p_amount: amountMvr,
    p_as_of: asOf,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as string;
}

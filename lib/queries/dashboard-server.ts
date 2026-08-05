import { getSupabaseServer } from "@/lib/supabase-server";

/**
 * Server-side query layer for the dashboard.
 *
 * Hard rule 4 says pages never call Supabase directly — but every module in
 * `lib/queries/` is a `"use client"` module built on the browser client, and
 * the dashboard is a React Server Component. It physically cannot use them,
 * which is how it ended up calling `supabase.rpc(...)` inline. This is the
 * missing half of the query layer: same discipline, server client.
 *
 * These functions return raw rows; every number in them is already computed
 * by Postgres. Do not add arithmetic here.
 */

export interface DailyRevenuePoint {
  day_label: string;
  day_date: string;
  revenue_mvr: number;
  orders_count: number;
}

export async function getDashboardMetricsServer(): Promise<Record<string, number> | null> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("get_dashboard_metrics");
  if (error) throw error;
  return (data?.[0] ?? null) as Record<string, number> | null;
}

export async function getPnlServer(from: string, to: string): Promise<Record<string, unknown> | null> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("get_pnl", { p_from: from, p_to: to });
  if (error) throw error;
  return (data?.[0] ?? null) as Record<string, unknown> | null;
}

export async function getDailyRevenueServer(days = 7): Promise<DailyRevenuePoint[]> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("get_daily_revenue", { p_days: days });
  if (error) throw error;
  return (data ?? []) as DailyRevenuePoint[];
}

/** First name for the greeting. Reads the caller's own profile only. */
export async function getSignedInFirstName(): Promise<string> {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "";
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const full = profile?.full_name;
  return full ? String(full).trim().split(/\s+/)[0] : "";
}

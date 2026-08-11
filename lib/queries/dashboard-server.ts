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

/**
 * Customers who have run out of what they last bought.
 *
 * The intelligence already existed — get_customer_insights computes
 * `expected_supply_days` from the packs on their last order times the cohort's
 * MEASURED days-per-pack (median 6.8 days on live data), and flags `ran_out`
 * when more time has passed than that could have covered. What was missing is
 * that it never reached the dashboard: it lived behind a lens on the Customers
 * screen that you had to know to open.
 *
 * That matters more than any other number in this business. 52 of 73 customers
 * have never bought a second time, on a product a household finishes in about
 * two weeks. The second order is the whole game, and nothing was asking for it.
 *
 * Ordered by lifetime value so the most worthwhile conversation is first.
 * `ran_out` only — a `rhythm` customer is merely later than usual, which is a
 * softer signal and does not belong on a screen that is meant to be silent
 * when healthy.
 */
export interface AtRiskCustomer {
  customer_id: string;
  name: string;
  phone: string | null;
  days_since_last: number | null;
  expected_supply_days: number | null;
  revenue_mvr: number;
  orders_count: number;
}

export async function getRanOutCustomersServer(limit = 3): Promise<{ rows: AtRiskCustomer[]; total: number }> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("get_customer_insights");
  if (error) throw error;

  const all = ((data ?? []) as Record<string, unknown>[])
    .filter((r) => r.at_risk === true && r.risk_reason === "ran_out")
    .sort((a, b) => Number(b.revenue_mvr ?? 0) - Number(a.revenue_mvr ?? 0));

  return {
    total: all.length,
    rows: all.slice(0, limit).map((r) => ({
      customer_id:          String(r.customer_id),
      name:                 String(r.name ?? ""),
      phone:                (r.phone as string | null) ?? null,
      days_since_last:      r.days_since_last      == null ? null : Number(r.days_since_last),
      expected_supply_days: r.expected_supply_days == null ? null : Number(r.expected_supply_days),
      revenue_mvr:          Number(r.revenue_mvr ?? 0),
      orders_count:         Number(r.orders_count ?? 0),
    })),
  };
}

"use client";

import { supabase } from "@/lib/supabase";

export type SpendChannel = "meta_boost" | "google" | "tiktok_ad" | "other";

export interface MarketingSpendRow {
  id: string;
  channel: SpendChannel;
  amount_mvr: number;
  campaign_name: string | null;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  sku_ids?: string[];
}

export interface MarketingSpendInput {
  channel: SpendChannel;
  amount_mvr: number;
  campaign_name?: string | null;
  start_date: string;
  end_date?: string | null;
  notes?: string | null;
  sku_ids?: string[];
}

export async function listMarketingSpend(): Promise<MarketingSpendRow[]> {
  const { data, error } = await supabase
    .from("marketing_spend")
    .select("*, marketing_spend_skus(sku_id)")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as Omit<MarketingSpendRow, "sku_ids">),
    sku_ids: ((row.marketing_spend_skus as { sku_id: string }[]) ?? []).map((r) => r.sku_id),
  }));
}

export async function createMarketingSpend(input: MarketingSpendInput): Promise<MarketingSpendRow> {
  const { sku_ids, ...rest } = input;
  const { data, error } = await supabase.from("marketing_spend").insert(rest).select().single();
  if (error) throw error;
  const spend = data as MarketingSpendRow;
  if (sku_ids && sku_ids.length > 0) {
    const links = sku_ids.map((sku_id) => ({ spend_id: spend.id, sku_id }));
    const { error: linkErr } = await supabase.from("marketing_spend_skus").insert(links);
    if (linkErr) throw linkErr;
  }
  return { ...spend, sku_ids: sku_ids ?? [] };
}

export async function updateMarketingSpend(id: string, input: MarketingSpendInput): Promise<void> {
  const { sku_ids, ...rest } = input;
  const { error } = await supabase.from("marketing_spend").update(rest).eq("id", id);
  if (error) throw error;
  // replace SKU links
  await supabase.from("marketing_spend_skus").delete().eq("spend_id", id);
  if (sku_ids && sku_ids.length > 0) {
    const links = sku_ids.map((sku_id) => ({ spend_id: id, sku_id }));
    const { error: linkErr } = await supabase.from("marketing_spend_skus").insert(links);
    if (linkErr) throw linkErr;
  }
}

export async function deleteMarketingSpend(id: string): Promise<void> {
  const { error } = await supabase.from("marketing_spend").delete().eq("id", id);
  if (error) throw error;
}

// ── General business expenses (rent, salaries, utilities, …) — 0056 ───────
// Marketing spend above stays its own thing (it has campaign dates + SKU
// attribution); these are the simple dated costs a true P&L needs.

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

export interface BusinessExpenseRow {
  id: string;
  category_id: string;
  amount_mvr: number;
  expense_date: string;
  description: string | null;
  created_at: string;
  /** Set when this row was generated from a standing monthly cost (0167).
   *  Generated rows are ordinary expense rows in every other respect — the
   *  P&L, the totals and this list do not special-case them. */
  recurring_id?: string | null;
  period_month?: string | null;
}

export interface BusinessExpenseInput {
  category_id: string;
  amount_mvr: number;
  expense_date: string;
  description?: string | null;
}

export async function listExpenseCategories(): Promise<ExpenseCategoryRow[]> {
  const { data, error } = await supabase
    .from("expense_categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExpenseCategoryRow[];
}

export async function listBusinessExpenses(from?: string, to?: string): Promise<BusinessExpenseRow[]> {
  let q = supabase.from("business_expenses").select("*").order("expense_date", { ascending: false });
  if (from) q = q.gte("expense_date", from);
  if (to)   q = q.lte("expense_date", to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as BusinessExpenseRow[];
}

export async function createBusinessExpense(input: BusinessExpenseInput): Promise<BusinessExpenseRow> {
  const { data, error } = await supabase.from("business_expenses").insert(input).select().single();
  if (error) throw error;
  return data as BusinessExpenseRow;
}

export async function deleteBusinessExpense(id: string): Promise<void> {
  const { error } = await supabase.from("business_expenses").delete().eq("id", id);
  if (error) throw error;
}

// ── Standing monthly costs (rent, salaries…) — migration 0167 ──────────────
//
// Rent is the same every month. The app used to model it as a one-off event
// and ask for it again every month, which is why business_expenses held ONE
// row and the P&L reported a net profit with no running costs in it.
//
// A recurring row is a TEMPLATE. Postgres generates the real expense rows from
// it (materialise_recurring_expenses, fired by a trigger on write and by
// pg_cron monthly), so nothing here computes money — the client only ever
// describes the cost.

export interface RecurringExpenseRow {
  id: string;
  category_id: string;
  amount_mvr: number;
  starts_on: string;
  ends_on: string | null;
  description: string | null;
  is_active: boolean;
}

export interface RecurringExpenseInput {
  category_id: string;
  amount_mvr: number;
  /** Any date in the first month it applies; normalised to the 1st here
   *  because the table CHECKs it, and a friendlier error is no error. */
  starts_on: string;
  description?: string | null;
}

/** First of the month, in the local (Maldives) sense — never UTC-shifted.
 *  Built from the string parts rather than a Date so a `2026-08-01` on a phone
 *  behind UTC cannot become July. */
function firstOfMonth(isoDate: string): string {
  const [y, m] = isoDate.split("-");
  return `${y}-${m}-01`;
}

export async function listRecurringExpenses(): Promise<RecurringExpenseRow[]> {
  const { data, error } = await supabase
    .from("recurring_expenses")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RecurringExpenseRow[];
}

export async function createRecurringExpense(input: RecurringExpenseInput): Promise<RecurringExpenseRow> {
  const { data, error } = await supabase
    .from("recurring_expenses")
    .insert({ ...input, starts_on: firstOfMonth(input.starts_on) })
    .select()
    .single();
  if (error) throw error;
  return data as RecurringExpenseRow;
}

/** Ending a cost, not deleting it. The months it already generated are real
 *  expenses that were really paid — deleting the template must never rewrite
 *  history. `ends_on` is the LAST month it applies. */
export async function endRecurringExpense(id: string, lastMonth: string): Promise<void> {
  const { error } = await supabase
    .from("recurring_expenses")
    .update({ is_active: false, ends_on: firstOfMonth(lastMonth), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Does the P&L for this period actually have running costs behind it?
 *  Period-aware on purpose (0168): one expense entered months ago does not
 *  make THIS month complete. */
export interface RunningCostsStatus {
  has_costs: boolean;
  amount_mvr: number;
  from_recurring: boolean | null;
  ever_recorded: boolean;
}

export async function getRunningCostsStatus(from: string, to: string): Promise<RunningCostsStatus | null> {
  const { data, error } = await supabase.rpc("running_costs_status", { p_from: from, p_to: to });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as RunningCostsStatus | null;
}

// ── The P&L — one Postgres call, zero client-side financial math ──────────

export interface PnlRow {
  revenue_mvr: number;
  cogs_mvr: number;
  gross_profit_mvr: number;
  marketing_mvr: number;      // prorated by day-overlap with the period
  other_opex_mvr: number;
  stock_writeoff_mvr: number; // landed cost of damaged/expired/lost stock (0093)
  /** Net cost of customer returns (0098): revenue given back minus the cost of
   *  goods actually back on the shelf — the true margin lost. */
  returns_net_mvr: number;
  net_profit_mvr: number;
  gross_margin_pct: number | null;
  net_margin_pct: number | null;
  opex_by_category: { name: string; amount: number }[];
  has_estimated_cost: boolean;
}

export async function getPnl(from: string, to: string): Promise<PnlRow | null> {
  const { data, error } = await supabase.rpc("get_pnl", { p_from: from, p_to: to });
  if (error) throw error;
  return (data?.[0] ?? null) as PnlRow | null;
}

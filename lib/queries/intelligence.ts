import { supabase } from "@/lib/supabase";
import type { CustomerRiskReason } from "@/lib/queries/customer-insights";

// ── Business intelligence reads (all math in Postgres, migrations 0070-0072) ──

export interface ReceivableRow {
  customer_id: string | null;
  customer_name: string;
  phone: string | null;
  orders_count: number;
  outstanding_mvr: number;
  oldest_days: number;
  bucket: "current" | "watch" | "overdue";
}

/** Who owes money, how much, and for how long — worst first. */
export async function getReceivablesAging(): Promise<ReceivableRow[]> {
  const { data, error } = await supabase.rpc("get_receivables_aging");
  if (error) throw error;
  return (data ?? []) as ReceivableRow[];
}

/** WHY this product needs a promo (migration 0150). The distinction is not
 *  cosmetic: "over-bought but selling well" used to land on this list too,
 *  which had the advisor recommending a discount on the best-selling product
 *  in the business. That case is a BUYING correction and lives on Reorder
 *  (status 'overstock'), never here. */
export type PromoReason =
  | "expiring"   // a batch dies within 180 days — a deadline beats everything
  | "dead"       // zero sales in 90 days
  | "stagnant";  // it sells, but the stock lasts over a year at that pace

export interface PromoSuggestionRow {
  sku_id: string;
  internal_code: string;
  full_path: string;
  stock_pieces: number;
  stock_value_mvr: number;
  days_of_stock: number | null; // null = no sales in the last 90 days
  expiry_days_left: number | null; // soonest expiring batch, null if unknown
  current_pack_mvr: number;
  promo_pack_mvr: number;       // price at the 10% floor margin
  discount_pct: number;
  pcs_per_pack: number;
  reason: PromoReason;
}

/** Stock that genuinely isn't moving, with margin headroom for a clearance
 *  promo. Already ordered by urgency (expiring, then dead, then stagnant)
 *  and by cash within each — don't re-sort it on the client. */
export async function getPromoSuggestions(): Promise<PromoSuggestionRow[]> {
  const { data, error } = await supabase.rpc("get_promo_suggestions");
  if (error) throw error;
  return (data ?? []) as PromoSuggestionRow[];
}

export interface MorningBriefing {
  yesterday_revenue: number;
  yesterday_orders: number;
  yesterday_delivered: number;
  yesterday_collected: number;
  /** Products at zero stock that SOLD in the last 30 days — proven demand,
   *  nothing to sell. The most expensive thing a distributor can get wrong,
   *  so it leads the watch list (migration 0148). Quantities are packs; the
   *  conversion happens in Postgres so no piece count ever reaches here. */
  stockout_count: number;
  stockout_mvr_month: number;
  stockouts: { product: string; packs_per_month: number; mvr_per_month: number }[];
  /** Still has stock, but under 7 days of cover at the last 30 days' rate. */
  running_out_count: number;
  running_out: { product: string; packs_left: number; days_left: number }[];
  overdue_count: number;
  overdue_mvr: number;
  /** Cash locked in stock that isn't moving — dead, stagnant or expiring
   *  (migration 0150). Replaced a bare `slow_movers` count that fired on 20
   *  of 31 SKUs because it counted over-bought best sellers as slow. Money
   *  leads and the worst two are named, so the line is a decision, not a
   *  statistic. */
  stuck_stock_count: number;
  stuck_stock_mvr: number;
  stuck_stock_top: { product: string; mvr: number; reason: PromoReason }[];
  expiring_value_mvr: number;
  /** Batches holding stock with NO expiry date recorded. Without these,
   *  expiring_value_mvr = 0 means "I cannot see", not "nothing is expiring"
   *  — and every batch is currently in this state. */
  batches_without_expiry: number;
  stock_value_without_expiry_mvr: number;
  /** Rival prices past their check cycle, or never taken on an A/B item. */
  price_checks_due: number;
  /** The urgent subset — a shipment landed at a new cost, so margin moved. */
  price_checks_cost_changed: number;
  /** Customers who have gone quiet, from the SINGLE at-risk definition in
   *  get_customer_insights (0151). The briefing used to inline its own
   *  rhythm-only copy, which required three orders and so named nobody.
   *  Worst three by revenue — if only three fit, they should be the three
   *  worth the most. */
  at_risk_count: number;
  overdue_customers: {
    name: string;
    phone: string | null;
    /** Null for a 'ran_out' customer — they have no established rhythm. */
    usual_gap_days: number | null;
    days_since_last: number;
    expected_supply_days: number | null;
    reason: CustomerRiskReason;
  }[];
}

/** Yesterday's business + the watch list, one call. */
export async function getMorningBriefing(): Promise<MorningBriefing> {
  const { data, error } = await supabase.rpc("get_morning_briefing");
  if (error) throw error;
  return data as MorningBriefing;
}

export type CampaignVerdict = "worked" | "marginal" | "no_effect" | "insufficient";

export interface CampaignRoiRow {
  spend_id: string;
  window_days: number;
  spend_mvr: number;
  revenue_during: number;
  /** Contribution (revenue − snapshot COGS) of attached SKUs during the window. */
  profit_during: number;
  /** Smoothed baseline: the same SKUs' average contribution for an equal window,
   *  averaged over the 3 windows before the campaign. */
  profit_before: number;
  profit_lift: number;          // during − before
  net_after_spend: number;      // profit_lift − spend  (the real "did it pay off")
  units_during: number;
  units_before: number;
  orders_during: number;
  new_customers: number;        // first-ever order within the window, bought an attached SKU
  enough_data: boolean;
  verdict: CampaignVerdict;
  /** An attached SKU hit zero stock during the window — demand was throttled by
   *  supply, not the promo, so the lift is understated (0091). */
  confounded_stockout: boolean;
  /** Average unit price shifted ≥8% vs the baseline — the before/after mixes a
   *  price move in with the promo effect (0091). */
  confounded_price: boolean;
}

/** Per-campaign VERDICT: profit lift (not just revenue) net of spend, vs a
 *  noise-smoothed baseline, plus units + new customers. Judges, not records. */
export async function getCampaignRoi(): Promise<CampaignRoiRow[]> {
  const { data, error } = await supabase.rpc("get_campaign_roi");
  if (error) throw error;
  return (data ?? []) as CampaignRoiRow[];
}

export interface ExpiringStockRow {
  sku_id: string;
  expiry_date: string;
  days_left: number;
  pieces: number;
  value_mvr: number;
}

/** Stock expiring within 120 days (already expired = negative days_left). */
export async function getExpiringStock(): Promise<ExpiringStockRow[]> {
  const { data, error } = await supabase
    .from("v_expiring_stock")
    .select("*")
    .order("days_left");
  if (error) throw error;
  return (data ?? []) as ExpiringStockRow[];
}

import { supabase } from "@/lib/supabase";

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
}

/** Slow movers with margin headroom for a clearance promo. */
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
  overdue_count: number;
  overdue_mvr: number;
  slow_movers: number;
  expiring_value_mvr: number;
  /** Repeat customers past 1.5× their own median ordering gap (0078) —
   *  empty when everyone's on rhythm. */
  overdue_customers: { name: string; phone: string | null; usual_gap_days: number; days_since_last: number }[];
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

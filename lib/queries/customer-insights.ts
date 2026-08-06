"use client";

import { supabase } from "@/lib/supabase";

// ── Customer insights (migration 0099) ───────────────────────────────────────
// Who your best customers really are — ranked by PROFIT, not revenue, and net
// of returns. All money math in Postgres; the UI only renders it.

export interface CustomerInsight {
  customer_id: string;
  name: string;
  phone: string | null;
  island: string | null;
  price_tier: string | null;
  orders_count: number;
  first_order_at: string | null;
  last_order_at: string | null;
  days_since_last: number | null;
  revenue_mvr: number;
  profit_mvr: number;
  avg_order_mvr: number;
  /** Median days between order days; null until they've ordered on 2+ days. */
  usual_gap_days: number | null;
  /** Overdue by EITHER rule below — see risk_reason for which (0151). */
  at_risk: boolean;
  outstanding_mvr: number;
  /** Share of all customer revenue — concentration risk. */
  revenue_share_pct: number;
  /** How long what they last bought should have lasted, in days: packs on
   *  their last order × the cohort's measured days-per-pack. Null when the
   *  last order had no pack-based quantity. */
  expected_supply_days: number | null;
  /** Which rule fired, so the screen can use the right words (0151). */
  risk_reason: CustomerRiskReason | null;
}

/** Two different ways a customer goes quiet, needing different sentences.
 *
 *  `rhythm` — a repeat buyer (3+ order days) is past their OWN usual gap.
 *  `ran_out` — they bought once or twice, and more time has passed than what
 *    they bought could possibly have lasted. These customers have no rhythm
 *    to break, which is why at_risk used to flag 0 of 58: the rhythm rule
 *    needs three orders and 42 of 58 customers have ordered exactly once. */
export type CustomerRiskReason = "rhythm" | "ran_out";

export interface CustomerProduct {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string | null;
  pcs_per_pack: number;
  pcs_per_carton: number;
  qty_pieces: number;
  revenue_mvr: number;
  profit_mvr: number;
  last_bought: string | null;
}

export interface CustomerOrder {
  order_id: string;
  order_number: string;
  created_at: string;
  status: string;
  payment_status: string;
  channel: string | null;
  total_mvr: number;
  paid_mvr: number;
  balance_mvr: number;
  items: number;
}

export async function getCustomerInsights(): Promise<CustomerInsight[]> {
  const { data, error } = await supabase.rpc("get_customer_insights");
  if (error) throw error;
  return (data ?? []) as CustomerInsight[];
}

export async function getCustomerProducts(customerId: string): Promise<CustomerProduct[]> {
  const { data, error } = await supabase.rpc("get_customer_products", { p_customer_id: customerId });
  if (error) throw error;
  return (data ?? []) as CustomerProduct[];
}

export async function getCustomerOrders(customerId: string, limit = 100): Promise<CustomerOrder[]> {
  const { data, error } = await supabase.rpc("get_customer_orders", {
    p_customer_id: customerId, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as CustomerOrder[];
}

import { supabase } from "@/lib/supabase";

// ── Price review after an arrival ────────────────────────────────────────
//
// Ali, 2026-08-27, the morning after SH-2026-002 landed at a much higher
// freight rate: *"For me to set the selling price with the best profit how do
// I see it? ... Also how do I know compared the 001 shipment price."*
//
// All of it is computed in Postgres (get_price_review / migration 0213),
// including the unit noun and the stock label. This module ships rows; it
// never does arithmetic on money and never picks a word for a unit.

/** Why this product is (or is not) on the list.
 *
 *  `auto_adjusted` is the one verdict that is good news: the product had no
 *  fixed price, so the app derives it from the target margin and the newest
 *  landed cost — its price moved with the container and its margin never
 *  changed. X-Tra Kering NB/S did exactly that through a 28% cost rise while
 *  every fixed-price product paid the freight out of its margin.
 *
 *  `capped_by_market` is the honest refusal: restoring the old margin would
 *  need a price above what the shops charge, so the arithmetic answer is not
 *  the business answer.
 *
 *  `repriced` ends the review for a product (migration 0214). Without it,
 *  accepting a suggestion re-anchors "the margin this price used to earn" on
 *  the price just set, and the screen asks for a higher one, for ever.
 *
 *  `not_compared` is only possible once he picks the comparison arrival
 *  himself: the product simply was not on that shipment. Saying
 *  `first_arrival` there would read as "this product is new", which is a
 *  different and untrue statement (migration 0218). */
export type PriceReviewVerdict =
  | "below_cost"
  | "raise"
  | "capped_by_market"
  | "repriced"
  | "cheaper"
  | "no_change"
  | "auto_adjusted"
  | "first_arrival"
  | "not_compared"
  | "no_price";

export interface PriceReviewRow {
  sku_id: string;
  internal_code: string;
  full_path: string;
  /** 'pack' | 'bottle' | 'tub' … straight from the category. NEVER re-derive
   *  it here — that mistake has been made in five other files. */
  unit_noun: string;
  sells_pack: boolean;
  sells_carton: boolean;

  this_reference: string;
  this_received_on: string;
  prev_reference: string | null;
  prev_received_on: string | null;

  prev_cost_unit: number | null;
  prev_cost_carton: number | null;
  this_cost_unit: number | null;
  this_cost_carton: number | null;
  cost_change_pct: number | null;

  price_unit: number | null;
  price_carton: number | null;
  /** false = the price is derived from a target margin and looks after itself. */
  price_is_fixed: boolean;

  margin_before_pct: number | null;
  margin_now_pct: number | null;
  /** Rufiyaa on one sale at today's price, and how much of it the new cost
   *  took. Money leads, percentages follow (skills.md Seat 4). */
  profit_now_unit: number | null;
  profit_lost_unit: number | null;

  suggested_unit: number | null;
  suggested_carton: number | null;

  /** Cheapest competitor on record, converted to Ali's own selling unit. */
  market_unit_mvr: number | null;
  market_competitor: string | null;
  market_observed_on: string | null;

  verdict: PriceReviewVerdict;
  /** "26 cartons + 1 bottle" — already in trade units. Render as-is. */
  stock_label: string;
  stock_value_mvr: number;
}

/** An arrival the two menus can offer: a shipment that has been received, so
 *  it carries a landed cost to compare or to price from. */
export interface ArrivalRow {
  id: string;
  reference: string;
  received_on: string;
  sku_count: number;
}

export async function getArrivals(): Promise<ArrivalRow[]> {
  const { data, error } = await supabase.rpc("get_arrivals");
  if (error) throw error;
  return (data ?? []) as ArrivalRow[];
}

/** Every product that landed on a shipment, with what it cost on the arrival
 *  being compared against, what it costs now, and the price that restores the
 *  margin the current price used to earn. Pass no id for the most recent GRN.
 *
 *  THE TWO ARGUMENTS ARE NOT "current" AND "previous" — they are two arrivals,
 *  and Postgres puts them in order (migration 0218). The later one is always
 *  what the money is computed from, because landed cost is a property of an
 *  arrival and pricing off the older one prices stock to replace itself at a
 *  cost that no longer exists. Pass them either way round; the rows come back
 *  labelled correctly. There is deliberately no ordering logic here. */
export async function getPriceReview(
  shipmentId?: string,
  compareShipmentId?: string,
): Promise<PriceReviewRow[]> {
  const { data, error } = await supabase.rpc("get_price_review", {
    p_shipment_id: shipmentId ?? null,
    p_compare_shipment_id: compareShipmentId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as PriceReviewRow[];
}

/** Set the fixed selling price on one or both selling units.
 *
 *  The below-cost guard lives in Postgres, not here (hard rule 7 — losing
 *  money is a decision, never an accident). A price under landed cost throws
 *  with the real rufiyaa in the message unless `allowBelowCost` is passed, and
 *  every change is written to audit_log with the old and new figures. */
export async function setSellingPrices(args: {
  skuId: string;
  priceUnit?: number | null;
  priceCarton?: number | null;
  allowBelowCost?: boolean;
  reason?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("set_selling_prices", {
    p_sku_id: args.skuId,
    p_price_unit: args.priceUnit ?? null,
    p_price_carton: args.priceCarton ?? null,
    p_allow_below_cost: args.allowBelowCost ?? false,
    p_reason: args.reason ?? null,
  });
  if (error) throw error;
}

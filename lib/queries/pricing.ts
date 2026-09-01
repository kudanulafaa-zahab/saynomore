import { supabase } from "@/lib/supabase";

// ── Pricing health (margin drift) ────────────────────────────────────────
// All margin math happens in Postgres (get_pricing_health / migration 0068);
// this module only ships the rows to the UI.

/** `below_cost` (migration 0162) needs NO target margin — it is the absolute
 *  judgement that a price is at or under landed cost, so every sale loses
 *  money. It exists because `below_target` was the only bad verdict and it
 *  requires target_margin_pct, which is unset on every SKU holding stock: a
 *  below-cost price used to fall through to 'ok'. */
export type PricingHealthStatus =
  | "below_cost"
  | "below_target"
  | "no_price"
  | "no_cost";

export interface PricingHealthRow {
  sku_id: string;
  internal_code: string;
  full_path: string;
  stock_pieces: number;
  stock_value_mvr: number;
  landed_per_piece_mvr: number | null;
  target_margin_pct: number | null;
  margin_piece_pct: number | null;
  margin_pack_pct: number | null;
  margin_carton_pct: number | null;
  worst_margin_pct: number | null;
  suggested_piece_mvr: number | null;
  suggested_pack_mvr: number | null;
  suggested_carton_mvr: number | null;
  status: PricingHealthStatus;
  /** From the product's category (migration 0202). The screen needs it to
   *  NAME the unit — a tub is not a "pack" — and must never infer the word
   *  itself; containerLabel is the single source. */
  unit_uom: string | null;
}

/** SKUs whose pricing needs attention: fixed prices whose real margin (vs the
 *  latest landed cost) drifted below target, SKUs with stock but no way to
 *  price them, and stock received without a landed cost. Sorted by severity,
 *  then by the stock value exposed. Empty array = every price is healthy. */
export async function getPricingHealth(): Promise<PricingHealthRow[]> {
  const { data, error } = await supabase.rpc("get_pricing_health");
  if (error) throw error;
  return (data ?? []) as PricingHealthRow[];
}

/** One-tap reprice: recomputes this SKU's fixed prices from the latest landed
 *  cost at its target margin (only the price fields already in use), with an
 *  audit_log entry. Admin/manager only — enforced in Postgres. */
export async function applyTargetPrices(skuId: string): Promise<void> {
  const { error } = await supabase.rpc("apply_target_prices", { p_sku_id: skuId });
  if (error) throw error;
}

// ── Price Book ───────────────────────────────────────────────────────────
// Every active SKU's cost, price, profit and live margin at the unit it trades
// in — all computed in Postgres (get_price_book / migration 0087). The UI only
// renders these numbers and layers the competitor gap on top from the price log.

export type PriceBookFlag = "ok" | "thin" | "loss" | "no_price" | "no_cost";

export interface PriceBookRow {
  sku_id: string;
  brand_name: string;
  category_name: string;
  category_sort_order: number;
  model_name: string;
  variant_display: string | null;
  internal_code: string;
  pcs_per_pack: number;
  packs_per_carton: number;
  trade_unit: "pack" | "carton" | "piece";
  landed_cost_mvr: number | null;
  price_mvr: number | null;
  profit_mvr: number | null;
  margin_pct: number | null;
  target_margin_pct: number | null;
  flag: PriceBookFlag;
}

export async function getPriceBook(): Promise<PriceBookRow[]> {
  const { data, error } = await supabase.rpc("get_price_book");
  if (error) throw error;
  return (data ?? []) as PriceBookRow[];
}

// ── Setup gaps (master-data completeness) ────────────────────────────────
//
// Ali, 2026-08-24: *"Solve the problems professionally so it doesn't repeat and
// I will be able to add any new product without coming back and debugging every
// time."*
//
// Margin Watch above answers "is this product priced WELL". It cannot answer
// "is this product FINISHED", for a reason built into it: it inner-joins stock,
// because its job is the money sitting in the godown. So a product with no
// price and no stock is invisible to it — and stays invisible until the day a
// container lands and someone tries to sell it. X-Tra Kering NB/S was in exactly
// that state, with no price on any unit at all.
//
// get_setup_gaps (migration 0202) is the master-data completeness check every
// ERP has. Every string it returns is already written for Ali IN TRADE UNITS by
// Postgres — headline, blocks and stock_label are rendered as-is. Nothing here
// composes a sentence or picks a unit word, which is the whole point: the unit
// noun has been re-derived in the UI five times already, and each time it fell
// through to a wrong "pack".

/** What is unfinished. `no_price` blocks selling outright; `no_carton_size`
 *  blocks RECEIVING, because a zero-CBM line has nothing for freight to be
 *  apportioned on (hard rule 4). */
/** Every gap get_setup_gaps() can return. It had drifted: `no_unit_price` has
 *  existed in Postgres since 0208 and was never added here, so the one type
 *  that is supposed to describe this contract silently under-described it. */
export type SetupGap =
  | "no_price"
  | "no_carton_price"
  | "no_unit_price"
  | "carton_not_sellable"
  | "no_carton_size"
  | "no_cost";

export interface SetupGapRow {
  sku_id: string;
  internal_code: string;
  full_path: string;
  gap: SetupGap;
  /** One plain sentence, already in trade units. Render as-is. */
  headline: string;
  /** What it stops him doing, already in trade units. Render as-is. */
  blocks: string;
  /** "6 tubs", "14 cartons" — never a piece count. Render as-is. */
  stock_label: string;
  stock_pieces: number;
  severity: number;
}

/** Every active product with something unfinished that will block a sale, a
 *  purchase or a receipt — worst first. An empty array means every product in
 *  the catalogue is ready to trade, and the UI shows nothing at all. */
export async function getSetupGaps(): Promise<SetupGapRow[]> {
  const { data, error } = await supabase.rpc("get_setup_gaps");
  if (error) throw error;
  return (data ?? []) as SetupGapRow[];
}

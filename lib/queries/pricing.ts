import { supabase } from "@/lib/supabase";

// ── Pricing health (margin drift) ────────────────────────────────────────
// All margin math happens in Postgres (get_pricing_health / migration 0068);
// this module only ships the rows to the UI.

export type PricingHealthStatus = "below_target" | "no_price" | "no_cost";

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

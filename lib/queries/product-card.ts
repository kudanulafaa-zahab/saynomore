"use client";

import { supabase } from "@/lib/supabase";

/**
 * The Product Card — everything known about one SKU, in one call.
 *
 * Ali, 2026-08-12: *"a new module where I can get all details about an sku when
 * I search… fob price, landed cost, selling price, profit by MVR and percentage
 * and any other detail I might have missed… Must have competitor price."*
 *
 * NOT A NEW SOURCE OF TRUTH. Every figure comes from `get_product_card`
 * (migration 0178), which reads the same rows the rest of the app reads —
 * shipment_lines for landed cost, v_skus for price, stock_movements for stock,
 * sales_order_lines for what it earned. Hard rule 1: the screen renders, it
 * never calculates. A fact sheet that did its own arithmetic would be a fifth
 * opinion about margin, and the entire value of this page is that it agrees
 * with the ledger.
 *
 * UNITS. Packs and cartons throughout. The rival's price arrives already
 * converted into OUR pack size (`their_price_at_our_pack_size`), so no screen
 * ever has to render a per-piece figure — the one place pieces are unavoidable
 * is comparing across different pack formats, and Postgres does that conversion
 * before the number leaves the database.
 */

export interface ProductCardCost {
  shipment_ref: string;
  received_at: string;
  qty_cartons: number;
  fob_currency: string;
  fob_per_carton: number;
  /** Rate locked at GRN — never recalculated (hard rule 3). */
  fx_rate: number | null;
  fob_mvr: number;
  freight_mvr: number;
  local_mvr: number;
  duty_mvr: number;
  landed_total_mvr: number;
  per_carton_mvr: number;
  per_pack_mvr: number;
  per_piece_mvr: number;
}

export interface ProductCardPrice {
  per_pack_mvr: number | null;
  per_carton_mvr: number | null;
  pack_cost_mvr: number | null;
  carton_cost_mvr: number | null;
  pack_profit_mvr: number | null;
  carton_profit_mvr: number | null;
  pack_margin_pct: number | null;
  carton_margin_pct: number | null;
  /** What a carton saves the customer against buying that many packs. */
  carton_discount_mvr: number | null;
}

export interface ProductCardRival {
  competitor: string;
  observed_date: string;
  days_old: number;
  their_pack_size: number;
  their_price_mvr: number;
  /** Their price for a pack OUR size — the only honest comparison. */
  their_price_at_our_pack_size: number;
  our_price_mvr: number | null;
  we_are_cheaper_by_mvr: number | null;
  we_are_cheaper_by_pct: number | null;
}

export interface ProductCardIncoming {
  shipment_ref: string;
  status: string;
  qty_cartons: number;
  expected_date: string | null;
  fob_currency: string;
  fob_per_carton: number;
  fx_rate: number | null;
  /** Supplier price in MVR at each shipment's own locked rate. A cheaper
   *  foreign price can still land dearer — that comparison is the point. */
  fob_mvr_per_carton: number | null;
  last_fob_mvr_per_carton: number | null;
}

export interface ProductCard {
  sku_id: string;
  internal_code: string;
  brand: string;
  model: string;
  variant: string | null;
  category: string | null;
  is_active: boolean;
  unit_noun: string;
  sellable_units: string[] | null;
  pack: {
    pcs_per_pack: number;
    packs_per_carton: number;
    length_cm: number | null;
    width_cm: number | null;
    height_cm: number | null;
    cbm_per_carton: number | null;
    duty_rate_pct: number | null;
  };
  cost: ProductCardCost | null;
  price: ProductCardPrice;
  stock: {
    pieces: number;
    by_godown: { godown: string; pieces: number }[];
    in_stock: boolean;
  };
  incoming: ProductCardIncoming | null;
  sales: {
    orders: number;
    customers: number;
    packs_sold: number | null;
    revenue_mvr: number;
    gross_profit_mvr: number;
    last_sold_at: string | null;
  };
  rival: ProductCardRival | null;
}

export async function getProductCard(skuId: string): Promise<ProductCard | null> {
  const { data, error } = await supabase.rpc("get_product_card", { p_sku_id: skuId });
  if (error) throw error;
  return (data as ProductCard | null) ?? null;
}

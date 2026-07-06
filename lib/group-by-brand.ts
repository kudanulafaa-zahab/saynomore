// ── Brand grouping for reports/financials ────────────────────────────────
// DISPLAY-ONLY aggregation. Sums per-SKU figures that were already computed and
// audited in Postgres (revenue, landed cost snapshotted at sale). This does NOT
// recompute any cost or margin from raw inputs — brand revenue/profit are plain
// sums of trusted per-row numbers, and the blended margin is
// SUM(profit)/SUM(revenue) of those same numbers. No financial logic lives here.

export interface BrandGroupSku {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string;
  internal_code: string;
  revenue: number;
  landedCost: number;
  grossProfit: number;   // revenue − landedCost (both from the audited row)
  marginPct: number | null;
  qtyPieces: number;
  hasEstimatedCost: boolean;
}

export interface BrandGroup {
  brand: string;
  revenue: number;
  landedCost: number;
  grossProfit: number;
  marginPct: number | null;   // blended: grossProfit / revenue
  skuCount: number;
  soldSkuCount: number;       // SKUs with any sales in the period
  hasEstimatedCost: boolean;
  skus: BrandGroupSku[];
}

/** Minimal shape every report row already satisfies (ReportRow). */
interface RowLike {
  sku_id: string;
  brand_name: string;
  model_name: string;
  variant_display: string;
  internal_code: string;
  total_revenue_mvr: number;
  total_landed_cost_mvr: number;
  gross_margin_pct: number | null;
  total_qty_pieces: number;
  has_estimated_cost: boolean;
}

/**
 * Groups audited report rows by brand → SKU, with per-brand subtotals.
 * Brands are sorted by gross profit (desc); SKUs within a brand likewise.
 * Purely for display — sums trusted numbers, computes no cost.
 */
export function groupByBrand<T extends RowLike>(rows: T[]): BrandGroup[] {
  const map = new Map<string, BrandGroup>();

  for (const r of rows) {
    const grossProfit = r.total_revenue_mvr - r.total_landed_cost_mvr;
    const sku: BrandGroupSku = {
      sku_id: r.sku_id,
      brand_name: r.brand_name,
      model_name: r.model_name,
      variant_display: r.variant_display,
      internal_code: r.internal_code,
      revenue: r.total_revenue_mvr,
      landedCost: r.total_landed_cost_mvr,
      grossProfit,
      marginPct: r.gross_margin_pct,
      qtyPieces: r.total_qty_pieces,
      hasEstimatedCost: r.has_estimated_cost,
    };

    let g = map.get(r.brand_name);
    if (!g) {
      g = {
        brand: r.brand_name,
        revenue: 0, landedCost: 0, grossProfit: 0, marginPct: null,
        skuCount: 0, soldSkuCount: 0, hasEstimatedCost: false, skus: [],
      };
      map.set(r.brand_name, g);
    }
    g.revenue    += sku.revenue;
    g.landedCost += sku.landedCost;
    g.grossProfit += sku.grossProfit;
    g.skuCount   += 1;
    if (sku.qtyPieces > 0) g.soldSkuCount += 1;
    if (sku.hasEstimatedCost) g.hasEstimatedCost = true;
    g.skus.push(sku);
  }

  const groups = [...map.values()];
  for (const g of groups) {
    g.marginPct = g.revenue > 0 ? (g.grossProfit / g.revenue) * 100 : null;
    g.skus.sort((a, b) => b.grossProfit - a.grossProfit);
  }
  groups.sort((a, b) => b.grossProfit - a.grossProfit);
  return groups;
}

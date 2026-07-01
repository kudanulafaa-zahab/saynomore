// Shared helpers for showing quantities and per-unit costs in whatever unit
// a SKU actually trades in (pack/carton), never raw pieces. Pieces are the
// correct internal unit for the stock ledger, but meaningless to a business
// owner who buys and sells by the pack or carton -- per fmcg-import-expert
// and pricing-sales-expert doctrine.
//
// Consolidates the formatStock/containerLabel pattern that already existed
// in components/reports/reports-view.tsx (Days of Stock tab only) so every
// report and screen uses the same conversion, respecting each SKU's actual
// sellable_units (e.g. detergent sells by carton only -- never show a
// fabricated "packs" figure for it).

export type UnitUom = "pcs" | "ml" | "g";
export type SellUnit = "piece" | "pack" | "carton";

/** Label for one "pack"-level unit, based on the category's unit_uom. */
export function containerLabel(uom: UnitUom | null | undefined): string {
  if (uom === "ml") return "bottle";
  if (uom === "g") return "pouch";
  return "pack";
}

export interface TradeUnitConfig {
  pcsPerPack: number;
  packsPerCarton: number;
  unitUom: UnitUom | null | undefined;
  /** From skus.sellable_units -- which tiers this SKU is actually sold in. Defaults to allowing all tiers if omitted (legacy rows). */
  sellableUnits?: SellUnit[] | null;
}

/**
 * Converts a raw piece count into a human string in the SKU's actual trade
 * unit(s) -- e.g. "6 ctn 2 pk", "12 pk", or "0". Never shows a "pack" figure
 * for a carton-only SKU (sellableUnits excludes "pack").
 */
export function formatQtyInTradeUnits(pieces: number, cfg: TradeUnitConfig): string {
  const { pcsPerPack, packsPerCarton } = cfg;
  const sellsCarton = !cfg.sellableUnits || cfg.sellableUnits.includes("carton");
  const sellsPack = !cfg.sellableUnits || cfg.sellableUnits.includes("pack");
  const label = containerLabel(cfg.unitUom);

  const pcsPerCarton = pcsPerPack * packsPerCarton;

  if (sellsCarton && pcsPerCarton > 0) {
    const ctns = Math.floor(pieces / pcsPerCarton);
    const rem = pieces % pcsPerCarton;
    const loose = sellsPack && pcsPerPack > 0 ? Math.floor(rem / pcsPerPack) : 0;
    const parts: string[] = [];
    if (ctns > 0) parts.push(`${ctns} ctn`);
    if (loose > 0) parts.push(`${loose} ${label}`);
    // Carton-only SKU (no pack tier): fold any remainder pieces into a
    // fractional carton note instead of silently dropping them.
    if (!sellsPack && rem > 0) parts.push(`${Math.round((rem / pcsPerCarton) * 100)}% ctn`);
    if (parts.length > 0) return parts.join(" + ");
    // A nonzero piece count too small to register as even one pack/carton
    // (e.g. 9 pcs of a 128-pcs-per-carton SKU) must not silently show "0".
    return pieces > 0 ? `< 1 ${sellsPack ? label : "ctn"}` : "0";
  }

  if (sellsPack && pcsPerPack > 0) {
    const pks = Math.floor(pieces / pcsPerPack);
    return pks > 0 || pieces === 0 ? `${pks} ${label}` : `< 1 ${label}`;
  }

  // Single-unit product (piece IS the trade unit) or no conversion data.
  return `${pieces.toLocaleString()} pcs`;
}

/**
 * Converts a per-piece cost/price into the SKU's primary trade-unit cost
 * (per pack, or per carton if the SKU is carton-only), for display in
 * Reports tables where a per-piece figure would be meaningless.
 * Returns { value, unitLabel } so callers can format/round as needed.
 */
export function costPerTradeUnit(
  costPerPiece: number,
  cfg: TradeUnitConfig,
): { value: number; unitLabel: string } {
  const { pcsPerPack, packsPerCarton } = cfg;
  const sellsPack = !cfg.sellableUnits || cfg.sellableUnits.includes("pack");
  const sellsCarton = !cfg.sellableUnits || cfg.sellableUnits.includes("carton");
  const label = containerLabel(cfg.unitUom);

  if (sellsPack && pcsPerPack > 0) {
    return { value: costPerPiece * pcsPerPack, unitLabel: label };
  }
  if (sellsCarton && pcsPerPack > 0 && packsPerCarton > 0) {
    return { value: costPerPiece * pcsPerPack * packsPerCarton, unitLabel: "ctn" };
  }
  return { value: costPerPiece, unitLabel: "pc" };
}

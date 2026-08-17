// The cart's arithmetic, with no React in it.
//
// Split out of sales-list.tsx (4,044 lines) on 2026-08-10. These are the
// functions that decide what a line SAYS and whether a carton is whole — which
// is where the money bugs of this month lived: "1.6666666666666667 cartons",
// "7 bottles blue", a part carton reaching checkout. They were buried in the
// middle of a four-thousand-line file alongside the wizard, the catalogue and
// two bottom sheets, all sharing one scope.
//
// Pure functions, no hooks, no JSX: they can be read in one sitting and, when
// it is worth doing, tested directly without a browser.
//
// The unit rule these enforce, which is permanent: a diaper is packs and
// cartons at every step. Sosoft is bottles because a bottle is what Sosoft is
// sold in. Never pieces in anything Ali reads.

import type { SkuFullRow } from "@/lib/queries/products";
import type { SaleUom } from "@/lib/queries/sales";
import {
  containerLabel, sellUnitLabel, formatQtyInTradeUnits,
  type TradeUnitConfig, type UnitUom,
} from "@/lib/trade-units";

/** Cart lines need a key that survives a merge, a split and a re-add, so it
 *  cannot be the SKU id. It lived at the bottom of sales-list.tsx next to the
 *  order list, which had nothing to do with it. */
let cartLineSeq = 0;
export const nextCartLineKey = (skuId: string) => `${skuId}-r${++cartLineSeq}`;

export interface DraftLine {
  key: string;
  sku: SkuFullRow;
  uom: SaleUom;
  qty: number;
  qty_pieces: number;
  unit_price_mvr: number;
  line_total_mvr: number;
  is_mixed_carton_fill: boolean;
  /** True when this line was built by adding the SAME product twice in
   *  DIFFERENT units — a carton, then a few loose packs. The line then holds
   *  one blended price, so the quantity has to be shown in trade units
   *  ("1 ctn + 2 pack") rather than as the flat pack count the arithmetic
   *  collapses to: Ali entered a carton and two packs, and "6 packs" is not
   *  what he typed. */
  merged_units?: boolean;
  /** Godown this line is picked from. undefined = the order's godown, which is
   *  the normal case. Set when the product is only stocked somewhere else, so
   *  a sale is never blocked by the warehouse chosen at the start (0164/0165). */
  source_godown_id?: string;
  /** Display only — the name behind source_godown_id. */
  source_godown_name?: string;
}

// ── UOM intelligence ──────────────────────────────────────────────────────────
// Derives a human label for what a "pack" actually is for this SKU.
// The SaleUom value stays "pack" in the DB — only the display word changes.

export function packLabel(sku: SkuFullRow): string {
  const fmt = String(sku.attributes?.format ?? "").toLowerCase();
  if (fmt === "bottle")  return "Bottle";
  if (fmt === "pouch")   return "Pouch";
  if (fmt === "sachet")  return "Sachet";
  if (fmt === "jar")     return "Jar";
  if (fmt === "can")     return "Can";
  if (fmt === "tube")    return "Tube";
  if (fmt === "box")     return "Box";
  // Fall back to unit_uom hint
  if (sku.unit_uom === "ml") return "Bottle";
  if (sku.unit_uom === "g")  return "Pouch";
  return "Pack";
}

// Default UOM for a SKU: liquids/powder sell by carton (master carton),
// diapers/unit goods sell by pack (single retail pack) — but never default to a
// tier the SKU isn't sold in (a carton-only product must default to carton).
export function defaultUom(sku: SkuFullRow): SaleUom {
  const su = sku.sellable_units ?? ["pack", "carton"];
  const preferred: SaleUom = sku.unit_uom === "ml" || sku.unit_uom === "g" ? "carton" : "pack";
  if (su.includes(preferred)) return preferred;
  if (su.includes("carton")) return "carton";
  if (su.includes("pack")) return "pack";
  return "carton";
}

// Adapter to the shared trade-unit helpers, so every quantity and per-unit
// cost on this screen is spoken in packs/cartons/bottles by one implementation.
export function tradeCfg(sku: SkuFullRow): TradeUnitConfig {
  return {
    pcsPerPack: sku.pcs_per_pack,
    packsPerCarton: sku.packs_per_carton,
    unitUom: sku.unit_uom,
    sellableUnits: sku.sellable_units,
  };
}

/** Quantity text for ONE cart line.
 *
 *  A mixed-carton fill is stated in bottles only — "8 bottles" — never
 *  "1 ctn + 2 bottles". In a MIXED carton the cartons are made ACROSS colours,
 *  so a single colour does not have a carton of its own; printing one there
 *  said something untrue. The carton count belongs to the brand GROUP, and
 *  CartLines shows it in the group header where it is actually meaningful.
 *
 *  Everything else reads in its own selling unit, exactly as before. */
export function lineQtyText(l: DraftLine): string {
  const per = l.sku.mixed_carton_pieces;
  if (per && per > 0 && l.is_mixed_carton_fill) {
    const noun = containerLabel(l.sku.unit_uom as UnitUom | null);
    return `${l.qty_pieces} ${plural(noun, l.qty_pieces)}`;
  }
  // A carton plus a few loose packs collapses to a flat pack count, because
  // that is the only shape the ledger accepts for one line. Showing "6 packs"
  // back to someone who typed "1 carton" and then "2 packs" is how a correct
  // total still reads as a mistake, so a joined line is described the way the
  // rest of the app describes quantities of this product.
  if (l.merged_units) return formatQtyInTradeUnits(l.qty_pieces, tradeCfg(l.sku));
  return `${l.qty} ${plural(sellUnitLabel(l.uom, tradeCfg(l.sku)), l.qty)}`;
}

/** "2 carton" is not a sentence. sellUnitLabel returns the singular noun, so
 *  anything that prints it beside a count has to agree with the count. */
export function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

/** The number the +/− buttons move, and the word for it. Every product works
 *  the same way: you step the unit that product is sold in. */
export function lineStepUnit(l: DraftLine): { value: number; word: string } {
  const per = l.sku.mixed_carton_pieces;
  if (per && per > 0 && l.is_mixed_carton_fill) {
    const noun = containerLabel(l.sku.unit_uom as UnitUom | null);
    return { value: l.qty_pieces, word: plural(noun, l.qty_pieces) };
  }
  return { value: l.qty, word: plural(sellUnitLabel(l.uom, tradeCfg(l.sku)), l.qty) };
}

/** Unit price for a cart line, quoted in the unit the product is SOLD in.
 *  A mixed fill is stored per bottle so the ledger can split a carton across
 *  colours, but "MVR 37/btl" is a price nobody is charged — the carton rate it
 *  was derived from is the real one. */
export function linePriceText(l: DraftLine): string {
  const per = l.sku.mixed_carton_pieces;
  if (per && per > 0 && l.is_mixed_carton_fill) {
    return `MVR ${(l.unit_price_mvr * per).toLocaleString(undefined, { maximumFractionDigits: 0 })}/carton`;
  }
  // Two decimals, never three. A joined line carries a BLENDED rate — a carton
  // at MVR 300 a pack plus loose packs at MVR 305 averages 301.6666… — and
  // `toLocaleString()` with no options prints "MVR 301.667/pack", which is not
  // a figure anyone quotes or pays. The line total is exact to the rufiyaa;
  // this is the per-unit rate it works out at.
  return `MVR ${l.unit_price_mvr.toLocaleString(undefined, { maximumFractionDigits: 2 })}/${sellUnitLabel(l.uom, tradeCfg(l.sku))}`;
}

// ── The cart ─────────────────────────────────────────────────────────────────
// Ali, 2026-08-09: "There must be function to add more products to each order.
// For example I add one case. There must be button or something to let me add
// more to this order or delete from order like a proper checkout page or cart."
// And: "This process should be same for all products. I mean the cart
// component. Not just sosoft. Everything must be harmonized ui/ux."
//
// So: ONE cart, used by New Sale step 2 AND step 3, and every product behaves
// identically — a +/− stepper on the unit that product is sold in, a bin, and
// a button to go back for more. There is no Sosoft-special cart.
//
// What was there before: step 2 had a bin and nothing else, and step 3 was a
// read-only list — no quantity, no delete, no way to add. Once an item was in,
// the only way to change it was to remove it and start again. The app already
// had this pattern in sale-detail.tsx (LineList: tap to edit, bin to remove,
// "Add item" to add); New Sale simply never got it.
//
// The ONE thing that varies by product is INFORMATION, not interaction:
// a mixed-carton brand also gets a group header saying how many cartons its
// lines add up to. That is the number Ali actually sells in, and it is the
// number the database enforces — it cannot be read off any single line,
// because a mixed carton is built across colours. When the group is short, the
// header says by how much and Place Order is blocked, so the shortfall is
// caught here rather than as a server error after the last tap.

export interface CartGroup {
  key: string;
  /** Set only for a mixed-carton brand — the group is then a real section. */
  brandName: string | null;
  piecesPerCarton: number;
  unitUom: UnitUom | null;
  lines: DraftLine[];
  /** Pieces across this brand's MIXED lines — what the whole-carton rule counts. */
  mixedPieces: number;
  totalPieces: number;
  totalMvr: number;
}

/** Lines of a mixed-carton brand collapse into one section; everything else is
 *  its own row. First-seen order is preserved either way. */
export function groupCartLines(lines: DraftLine[]): CartGroup[] {
  const out: CartGroup[] = [];
  const byBrand = new Map<string, CartGroup>();
  for (const l of lines) {
    const per = l.sku.mixed_carton_pieces ?? 0;
    if (per > 0) {
      let g = byBrand.get(l.sku.brand_id);
      if (!g) {
        g = {
          key: `brand-${l.sku.brand_id}`,
          brandName: l.sku.brand_name,
          piecesPerCarton: per,
          unitUom: (l.sku.unit_uom ?? null) as UnitUom | null,
          lines: [], mixedPieces: 0, totalPieces: 0, totalMvr: 0,
        };
        byBrand.set(l.sku.brand_id, g);
        out.push(g);
      }
      g.lines.push(l);
      if (l.is_mixed_carton_fill) g.mixedPieces += l.qty_pieces;
      g.totalPieces += l.qty_pieces;
      g.totalMvr += l.line_total_mvr;
    } else {
      out.push({
        key: l.key, brandName: null, piecesPerCarton: 0,
        unitUom: (l.sku.unit_uom ?? null) as UnitUom | null,
        lines: [l], mixedPieces: 0, totalPieces: l.qty_pieces, totalMvr: l.line_total_mvr,
      });
    }
  }
  return out;
}

/** Bottles still needed to round a brand's mixed lines up to whole cartons.
 *  0 means the group is valid. Mirrors the database rule exactly (0163). */
export function cartonShortfall(g: CartGroup): number {
  if (g.piecesPerCarton <= 0 || g.mixedPieces === 0) return 0;
  const rem = g.mixedPieces % g.piecesPerCarton;
  return rem === 0 ? 0 : g.piecesPerCarton - rem;
}

/** Every mixed-carton group that is not yet a whole number of cartons. */
export function cartShortfalls(lines: DraftLine[]): { brand: string; short: number; noun: string }[] {
  return groupCartLines(lines)
    .filter((g) => g.brandName != null && cartonShortfall(g) > 0)
    .map((g) => {
      const short = cartonShortfall(g);
      const noun = containerLabel(g.unitUom);
      return { brand: g.brandName!, short, noun: `${noun}${short === 1 ? "" : "s"}` };
    });
}

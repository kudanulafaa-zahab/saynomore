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

// Mirrors product_categories.unit_uom, widened in migration 0172 so a product
// sold as a single item can say what it IS. Measures (pcs/ml/g) describe how a
// unit is counted; the rest name the unit itself.
export type UnitUom =
  | "pcs" | "ml" | "g"
  | "tub" | "jar" | "tube" | "bar" | "sachet" | "bottle" | "unit" | "set";
export type SellUnit = "piece" | "pack" | "carton";

/** Label for one "pack"-level unit, based on the category's unit_uom.
 *
 *  THIS IS THE TWIN OF public.unit_noun(text) IN POSTGRES AND MUST MATCH IT.
 *  They had already drifted: 0172 taught the database that a unit can be a tub,
 *  while this still fell through to "pack" for anything it did not recognise —
 *  so the same 24 tubs would read "24 tubs" from a Postgres view and "24 packs"
 *  from a React component. Two sources of truth for one word is how a screen
 *  ends up contradicting itself.
 *
 *  The fallback stays "pack" deliberately: it is correct for most of this
 *  catalogue, and a wrong-but-familiar word beats an empty one. */
export function containerLabel(uom: UnitUom | null | undefined): string {
  switch (uom) {
    case "ml":     return "bottle";
    case "g":      return "pouch";
    case "tub":    return "tub";
    case "jar":    return "jar";
    case "tube":   return "tube";
    case "bar":    return "bar";
    case "sachet": return "sachet";
    case "bottle": return "bottle";
    // A bedding set is a set. Without this it fell through to the diaper
    // default and three duvet sets read as "3 packs" (0193). The Postgres twin
    // unit_noun() carries the same word — these two must never disagree.
    case "set":    return "set";
    case "unit":   return "unit";
    default:       return "pack";
  }
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
 * Quantity string for a MIXED-CARTON brand (Sosoft): the carton is the only
 * selling unit, but its contents are picked individually, so a customer can
 * hold a whole number of cartons plus loose bottles mid-build.
 *
 * "2 ctn", "2 ctn + 3 bottles", "3 bottles", "0".
 *
 * Separate from formatQtyInTradeUnits because that one is driven by
 * sellable_units: Sosoft is carton-only, so it has no pack tier to describe a
 * remainder with and falls back to "50% ctn" — true, but not a thing anyone
 * says. Here the remainder is real, countable stock the customer is choosing,
 * and the noun still comes from unit_uom, never a hardcoded word.
 */
export function formatMixedCartonQty(
  pieces: number,
  piecesPerCarton: number,
  uom: UnitUom | null | undefined,
): string {
  const noun = containerLabel(uom);
  if (piecesPerCarton <= 0) return `${pieces} ${noun}${pieces === 1 ? "" : "s"}`;
  const ctns = Math.floor(pieces / piecesPerCarton);
  const rem = pieces % piecesPerCarton;
  const parts: string[] = [];
  if (ctns > 0) parts.push(`${ctns} ctn`);
  if (rem > 0) parts.push(`${rem} ${noun}${rem === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" + ") : "0";
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

// ── Which tiers a SKU is actually sold in ─────────────────────────────────
//
// `sellable_units` is the single source of truth and every screen that offers
// a selling unit must read it. Screens used to SYNTHESISE a third "Piece"
// button for any pack-selling SKU ("breaking a pack open is a real sale"),
// which is simply not this trade: the supplier sells packs and cartons and
// Ali sells packs and cartons. Checked against every line ever sold — all 51
// `uom='piece'` lines are Sosoft bottles inside a mixed carton, and not one
// is a diaper. Meanwhile all 31 SKUs are {pack,carton}, {carton} or {pack};
// none says `piece`. The button offered a sale nobody makes.

/** The tiers this SKU is sold in, carton first. Never adds a tier that
 *  `sellable_units` doesn't list. */
export function sellableTiers(units: SellUnit[] | null | undefined): SellUnit[] {
  const su = units ?? ["pack", "carton"];
  const tiers = (["carton", "pack", "piece"] as SellUnit[]).filter((u) => su.includes(u));
  return tiers.length ? tiers : ["carton"];
}

/** The word for one unit at a given tier, lowercase ("carton", "pack",
 *  "bottle"). Never says "piece" for a product whose pack IS one unit —
 *  Sosoft's carton holds 6 packs of 1, so its loose unit is a bottle. */
export function sellUnitLabel(uom: SellUnit, cfg: TradeUnitConfig): string {
  if (uom === "carton") return "carton";
  if (uom === "pack") return containerLabel(cfg.unitUom);
  return cfg.pcsPerPack === 1 ? containerLabel(cfg.unitUom) : "piece";
}

// ── Price ↔ margin, one implementation ────────────────────────────────────
//
// The margin sliders in Sales (quick price check) and Market (competitor
// comparison) each carried their own copy of this arithmetic. They were
// identical, which is exactly how two screens quietly start disagreeing about
// money — one gets a rounding tweak, the other doesn't, and Ali sees two
// answers for the same product.
//
// AUTHORITY NOTE: Postgres owns the real figures. `v_skus.actual_margin_pct`
// is the margin of record and `simulate_landed_costs` computes the price for
// a target margin. These helpers exist ONLY to drive an interactive slider
// preview — they must never be used to store, post or report a number.

/** Selling price that yields `marginPct` on a given cost. Both in the same
 *  unit (per pack, per carton — never mixed). */
export function priceForMargin(cost: number, marginPct: number): number | null {
  if (!(cost > 0)) return null;
  // A 100% margin implies an infinite price; the sliders clamp to 99 but a
  // caller could pass anything.
  if (!(marginPct > -Infinity) || marginPct >= 100) return null;
  return cost / (1 - marginPct / 100);
}

/** Margin percentage a given price earns on a given cost. */
export function marginAtPrice(cost: number, price: number): number | null {
  if (!(price > 0) || !(cost >= 0)) return null;
  return (1 - cost / price) * 100;
}

/** The unit words a kind of product can be counted in, in the language a
 *  shopkeeper uses — and everything that follows from the choice.
 *
 *  ONE list, because there are two places that create a category: the New
 *  Category dialog and the "+ New" button inside the New SKU form. The second
 *  one used to hardcode `unit_uom: "pcs"` with NO variant attributes, so a
 *  category created there was always called a "pack" and could never show a
 *  size field — which is precisely the trap Ali would have hit adding Bedding
 *  from the screen he was already on.
 *
 *  Every `uom` here is one containerLabel() knows, which is the twin of
 *  Postgres unit_noun(), so a category can never be created with a unit the
 *  rest of the app cannot say. */
export const UNIT_WORDS: { uom: UnitUom; word: string; hint: string }[] = [
  { uom: "pcs",    word: "Pack",   hint: "nappies, wipes" },
  { uom: "set",    word: "Set",    hint: "bedding, cutlery" },
  { uom: "bottle", word: "Bottle", hint: "cleaner, drinks" },
  { uom: "tub",    word: "Tub",    hint: "body butter" },
  { uom: "jar",    word: "Jar",    hint: "jam, cream" },
  { uom: "tube",   word: "Tube",   hint: "toothpaste" },
  { uom: "bar",    word: "Bar",    hint: "soap, chocolate" },
  { uom: "sachet", word: "Sachet", hint: "single-use" },
  { uom: "unit",   word: "Item",   hint: "anything else" },
  { uom: "ml",     word: "Liquid", hint: "priced per 100ml" },
  { uom: "g",      word: "Powder", hint: "priced per 100g" },
];

/** Cost basis follows from the unit word — it is not a separate decision, and
 *  asking twice only invited the pair to disagree. */
export function costBasisFor(uom: UnitUom): "piece" | "per_100ml" | "per_100g" {
  return uom === "ml" ? "per_100ml" : uom === "g" ? "per_100g" : "piece";
}

/** So does how it is sold. Only loose pieces, a liquid or a powder arrive in
 *  packs and cartons; a set, a tub, a bottle or a bar is bought and sold one at
 *  a time. This is what stops the New SKU form demanding a pack size that does
 *  not exist.
 *
 *  ── WHY A SINGLE ITEM IS 'pack' AND NOT 'piece' (2026-08-23) ──────────────
 *
 *  This returned ["piece"] and it made every such product UNSELLABLE. The
 *  database trigger `assert_whole_mixed_cartons` refuses any line recorded in
 *  pieces unless it is part of a mixed carton on a brand that has
 *  `mixed_carton_pieces` set:
 *
 *      uom = 'piece' AND (b.mixed_carton_pieces IS NULL
 *                         OR NOT sol.is_mixed_carton_fill)   ->  REFUSED
 *
 *  So the five Body Shop tubs — sixteen in stock, MVR 380 each, about MVR 6,000
 *  of goods — offered exactly one button, "piece", and the app then refused the
 *  sale with "Bodyshop is not sold in single pieces. Sell it by the pack or the
 *  carton." It named units it had never offered. Sold zero times since they were
 *  added, and now it is clear why. Every tub, jar, bar, tube, bottle AND SET
 *  created since was born the same way — including the IKEA bedding.
 *
 *  'pack' is the correct tier for a single item, and the displayed word does
 *  not change: sellUnitLabel('pack', cfg) is containerLabel(unitUom), so a tub
 *  still reads "tub" and a bedding set still reads "set". What changes is that
 *  the line is recorded as a pack, which the trigger allows.
 *
 *  'piece' is left in the type because it remains legitimate for a mixed-carton
 *  fill — the loose bottles that make up a Sosoft carton — which is the one
 *  case the trigger permits. */
export function sellableUnitsFor(uom: UnitUom): ("piece" | "pack" | "carton")[] {
  return uom === "pcs" || uom === "ml" || uom === "g" ? ["pack", "carton"] : ["pack"];
}

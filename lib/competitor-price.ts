import type { PriceBasis } from "@/lib/queries/competitors";

/**
 * What a competitor's logged price means, in one place.
 *
 * ── WHY THIS IS A MODULE AND NOT TWO LINES IN A COMPONENT ──────────────────
 *
 * This conversion existed in FOUR places — get_competitor_price_gaps,
 * get_competitor_reference_prices, get_product_card, and twice inside
 * competitors-view.tsx — and they did not agree. The Product Card's copy
 * divided by pack size on EVERY basis, which is wrong for a per-piece price
 * and nonsense for a per-100ml one; it had simply never been given anything
 * but pack prices. Migration 0223 collapsed the three SQL copies into
 * `v_competitor_price_normalized`. This is its twin for the two in TypeScript,
 * and it must stay identical to it.
 *
 * ── THE LINE THAT MUST NOT BE CROSSED ──────────────────────────────────────
 *
 * A shelf price and a carton rate are two prices for two different buyers: a
 * shopper buying one pack, and a shop buying a case. A carton is discounted
 * per piece by definition, so taking "the cheapest rival price" across both
 * silently compares our PACK price against their CARTON rate — our margin
 * reads worse than it is, and the Promo Advisor pushes a price cut that was
 * never needed. `buysLike` is that line. Compare shelf to shelf and case to
 * case, never across.
 */
export type BuysLike = "shelf" | "carton" | "uncomparable";

/** Which buyer a logged price is for. Mirrors the view's `buys_like`. */
export function buysLike(basis: PriceBasis): BuysLike {
  if (basis === "per_carton") return "carton";
  if (basis === "per_piece" || basis === "per_pack") return "shelf";
  // per_100ml / per_100g. Nothing records how many millilitres are in one of
  // our own bottles, so these cannot be converted at all — see 0223's header.
  return "uncomparable";
}

/** The fields any competitor-price row must carry to be converted. */
export interface ConvertiblePrice {
  price_mvr: number | string;
  price_basis: PriceBasis;
  their_pcs_per_pack: number | null;
  their_packs_per_carton: number | null;
}

/**
 * One logged price as MVR per piece, or null when it cannot be converted.
 *
 * NEVER falls back to our own pack size. The old code did, which meant a blank
 * field produced a rival price that looked authoritative and was invented; the
 * database now refuses the blank outright (0223), so a null here means the
 * basis genuinely has no conversion, not that a number is missing.
 */
export function perPiece(p: ConvertiblePrice): number | null {
  const price = Number(p.price_mvr);
  if (!Number.isFinite(price)) return null;

  switch (p.price_basis) {
    case "per_piece":
      return price;
    case "per_pack": {
      const pcs = p.their_pcs_per_pack ?? 0;
      return pcs > 0 ? price / pcs : null;
    }
    case "per_carton": {
      const pcs = (p.their_pcs_per_pack ?? 0) * (p.their_packs_per_carton ?? 0);
      return pcs > 0 ? price / pcs : null;
    }
    default:
      return null;
  }
}

/** How a rival's carton is built, in his words: "3 packs of 34". */
export function theirCartonLabel(
  p: Pick<ConvertiblePrice, "their_pcs_per_pack" | "their_packs_per_carton">,
  unitNoun = "pack",
): string | null {
  const pcs = p.their_pcs_per_pack;
  const packs = p.their_packs_per_carton;
  if (!pcs || !packs) return null;
  return `${packs} ${unitNoun}${packs === 1 ? "" : "s"} of ${pcs}`;
}

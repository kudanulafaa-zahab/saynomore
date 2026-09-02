"use client";

// The Sosoft carton picker — one colour, or a mixed carton, any quantity.
//
// Its own file since 2026-08-10. It is the densest money logic on any screen in
// the app (whole-carton arithmetic, stock counted net of what the cart already
// holds, cross-godown fallback) and it had been living in the middle of
// sales-list.tsx next to the wizard and the order list.

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { SkuFullRow } from "@/lib/queries/products";
import type { GodownRow } from "@/lib/queries/masters";
import type { StockLevel } from "@/lib/queries/inventory";
import type { TierPrice } from "@/lib/queries/sales";
import { CARD } from "@/lib/surfaces";
import { containerLabel, sellableTiers, type UnitUom } from "@/lib/trade-units";
import { type DraftLine } from "./cart/cart-math";
import { mvr } from "@/lib/money";

// second time cannot oversell what the first visit reserved.
export type MixedCartonAdd = {
  sku: SkuFullRow; pieces: number;
  /** THREE PURCHASES, NOT TWO. `mixed: boolean` could not express the third
   *  Ali asked for — Ali, 2026-08-24: *"I also must have an option to sell the
   *  sosoft bottle individually if I want."*
   *
   *    carton  N whole cartons of one colour
   *    mix     bottles chosen across colours to fill whole cartons
   *    single  LOOSE bottles, priced per bottle, part of no carton
   *
   *  They are genuinely different money — a mix bottle is billed at the carton
   *  rate ÷ 6, a single at its own bottle price — so a boolean was one bit
   *  short of the question. */
  kind: "carton" | "mix" | "single";
  /** Set only when the chosen warehouse has none and this comes from another. */
  godownId?: string; godownName?: string;
};

export function MixedCartonSheet({
  skus, godownId, godowns, stockLevels, tierPrices, draftLines, onClose, onAdd,
}: {
  skus: SkuFullRow[];
  godownId: string;
  godowns: GodownRow[];
  stockLevels: StockLevel[];
  tierPrices: Map<string, TierPrice>;
  draftLines: DraftLine[];
  onClose: () => void;
  onAdd: (adds: MixedCartonAdd[]) => void;
}) {
  const piecesPerCarton = skus[0]?.mixed_carton_pieces ?? 0;
  const unitUom = (skus[0]?.unit_uom ?? null) as UnitUom | null;
  const noun = containerLabel(unitUom);

  // Ali, 2026-08-09: "Create mix carton is default." It is the common sale —
  // a customer picking six bottles across colours — so it should not cost a
  // tap to reach.
  const [mode, setMode] = useState<"single" | "mixed" | "loose">("mixed");
  const [cartons, setCartons] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loose, setLoose] = useState<Record<string, number>>({});
  const [targetCartons, setTargetCartons] = useState(1);

  /** Bottles still on the shelf AFTER what this order already holds. */
  const availablePieces = (s: SkuFullRow) => {
    const onShelf = godownId
      ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0
      : stockLevels.filter((l) => l.sku_id === s.id).reduce((a, l) => a + l.qty_pieces, 0);
    // Sum every cart entry for this product — since the cart splits a full
    // carton from a mixed fill, find() would see only the first and the sheet
    // would offer stock the cart has already claimed.
    const inCart = draftLines
      .filter((l) => l.sku.id === s.id)
      .reduce((a, l) => a + l.qty_pieces, 0);
    return Math.max(0, onShelf - inCart);
  };
  /** Where this line would actually be picked from. NULL = the order's own
   *  godown. Ali, 2026-08-09: "I must be able to choose the godown where the
   *  sku is available and fulfill the order without going back." So when the
   *  chosen warehouse has none and another has stock, the sale is sourced from
   *  there instead of being refused -- no restart, no second order. */
  const sourceFor = (s: SkuFullRow) =>
    availablePieces(s) > 0 ? null : (elsewhereList(s)[0] ?? null);

  /** What can actually be sold: here if here has it, otherwise the other
   *  godown's stock, because that is where it will come from. */
  const usablePieces = (s: SkuFullRow) => {
    const here = availablePieces(s);
    return here > 0 ? here : (elsewhereList(s)[0]?.pieces ?? 0);
  };
  const availableCartons = (s: SkuFullRow) =>
    piecesPerCarton > 0 ? Math.floor(usablePieces(s) / piecesPerCarton) : 0;

  /** Where this colour IS, when the chosen warehouse has none. Ali,
   *  2026-08-09, on a Purple row reading "None left": "It could be available
   *  at another godown. In which case app must be intelligent enough to
   *  suggest availability at the other godown."
   *
   *  The product GRID already refuses to hide a product owned elsewhere and
   *  says "None here · N in <other>". This sheet did not, so inside it a
   *  colony of stock in Funvilu looked like nothing at all. Same answer, same
   *  words, both doors. */
  const elsewhereList = (s: SkuFullRow) => stockLevels
    .filter((l) => l.sku_id === s.id && l.godown_id !== godownId && l.qty_pieces > 0)
    .map((l) => ({ id: l.godown_id,
                   name: godowns.find((g) => g.id === l.godown_id)?.name ?? "another godown",
                   pieces: l.qty_pieces }))
    .sort((a, b) => b.pieces - a.pieces);

  /** Money is quoted per CARTON — that is the unit Sosoft is sold in. */
  const cartonPriceOf = (s: SkuFullRow) => {
    const tp = tierPrices.get(s.id);
    return tp ? tp.price_per_carton_mvr : s.selling_price_per_carton_mvr;
  };

  /** And per BOTTLE for a loose one, which is NOT the carton rate ÷ 6.
   *  A single sells for more than a sixth of a case; that is the whole reason
   *  it is a separate price and a separate tier. Falls back to the sell
   *  sheet's own figure, so this screen can never quote something the rest of
   *  the app would not. */
  const bottlePriceOf = (s: SkuFullRow) =>
    !sellsSingle(s) ? null
      : (tierPrices.get(s.id)?.price_per_pack_mvr ?? s.selling_price_per_pack_mvr) ?? null;

  /** Whether THIS product sells one at a time. Asked per SKU, not once for the
   *  brand: `sellable_units` lives on the SKU, so a brand could legitimately
   *  sell one colour singly and another only by the case, and reading the first
   *  row's answer for all of them would offer a bottle of something that is not
   *  sold that way. `sellable_units` is the only input — the same rule the sell
   *  sheet and Stock Ops follow — so a carton-only brand never sees the tab at
   *  all. */
  function sellsSingle(s: SkuFullRow) {
    return sellableTiers(s.sellable_units).includes("pack");
  }
  const sellsSingles = skus.some(sellsSingle);

  // ── Single colour ──
  const singleCartons = skus.reduce((a, s) => a + (cartons[s.id] ?? 0), 0);
  const singleTotalMvr = skus.reduce(
    (a, s) => a + (cartons[s.id] ?? 0) * (cartonPriceOf(s) ?? 0), 0);
  const singlePriced = skus.every((s) => (cartons[s.id] ?? 0) === 0 || cartonPriceOf(s) != null);
  const canAddSingle = singleCartons > 0 && singlePriced;

  // ── Mixed ──
  const mixedBottles = skus.reduce((a, s) => a + (counts[s.id] ?? 0), 0);
  const mixedTarget = targetCartons * piecesPerCarton;
  const mixedRemaining = mixedTarget - mixedBottles;
  const totalAvailableBottles = skus.reduce((a, s) => a + availablePieces(s), 0);
  const maxMixedCartons = piecesPerCarton > 0
    ? Math.max(1, Math.floor(totalAvailableBottles / piecesPerCarton)) : 1;
  const mixedPriced = skus.every((s) => (counts[s.id] ?? 0) === 0 || cartonPriceOf(s) != null);
  const mixedTotalMvr = skus.reduce(
    (a, s) => a + (counts[s.id] ?? 0) * ((cartonPriceOf(s) ?? 0) / Math.max(1, piecesPerCarton)), 0);
  const canAddMixed = piecesPerCarton > 0 && mixedBottles === mixedTarget && mixedPriced;

  function setCartonCount(s: SkuFullRow, next: number) {
    setCartons((prev) => ({ ...prev, [s.id]: Math.max(0, Math.min(next, availableCartons(s))) }));
  }
  function setBottleCount(s: SkuFullRow, next: number) {
    setCounts((prev) => ({ ...prev, [s.id]: Math.max(0, Math.min(next, usablePieces(s))) }));
  }
  function setLooseCount(s: SkuFullRow, next: number) {
    setLoose((prev) => ({ ...prev, [s.id]: Math.max(0, Math.min(next, usablePieces(s))) }));
  }

  // ── Loose singles ──
  const looseBottles = skus.reduce((a, s) => a + (loose[s.id] ?? 0), 0);
  const loosePriced  = skus.every((s) => (loose[s.id] ?? 0) === 0 || bottlePriceOf(s) != null);
  const looseTotalMvr = skus.reduce(
    (a, s) => a + (loose[s.id] ?? 0) * (bottlePriceOf(s) ?? 0), 0);
  const canAddLoose = looseBottles > 0 && loosePriced;

  function handleAdd() {
    const adds: MixedCartonAdd[] = [];
    for (const s of skus) {
      const src = sourceFor(s);
      if (mode === "single") {
        const n = cartons[s.id] ?? 0;
        if (n > 0) adds.push({ sku: s, pieces: n * piecesPerCarton, kind: "carton",
                              godownId: src?.id, godownName: src?.name });
      } else if (mode === "loose") {
        const n = loose[s.id] ?? 0;
        if (n > 0) adds.push({ sku: s, pieces: n, kind: "single",
                              godownId: src?.id, godownName: src?.name });
      } else {
        const n = counts[s.id] ?? 0;
        if (n > 0) adds.push({ sku: s, pieces: n, kind: "mix",
                              godownId: src?.id, godownName: src?.name });
      }
    }
    if (adds.length > 0) onAdd(adds);
  }

  const canAdd = mode === "single" ? canAddSingle
               : mode === "loose"  ? canAddLoose
               : canAddMixed;

  return (
    // role="dialog" + aria-modal: a bottom sheet IS a modal dialog, and until
    // now it was an anonymous div — a screen reader announced nothing, and
    // nothing could tell "a sheet is open" from "a sheet is closed" without
    // guessing at class names. The journey audit waits on this.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${skus[0]?.brand_name ?? "Product"} — add to sale`}
      className="fixed inset-0 z-[80] flex items-end snm-scrim-in"
      style={{ background: "var(--scrim-bg)", touchAction: "none" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
        style={{
          background: "var(--background)",
          borderTop: "0.5px solid var(--glass-border-lo)",
          boxShadow: "var(--glass-shadow-lg)",
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
        }}
      >
        {/* Fixed header — grabber, title, mode choice, and (for a mix) the
            carton target with its progress. Always visible. */}
        <div className="shrink-0 px-5 pt-3 pb-3" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
          <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground truncate">
                {skus[0]?.brand_name} · Add to sale
              </h2>
              <p className="ios-subhead" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                {sellsSingles ? `By the carton or one ${noun} at a time` : "Sold by the carton"} · {piecesPerCarton} {noun}s in a carton
              </p>
            </div>
            <button onClick={onClose} className="shrink-0 h-11 w-11 rounded-full flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }} aria-label="Close">
              <X className="h-4 w-4 text-foreground" />
            </button>
          </div>

          {/* A choice, so it is content: real foreground text on a filled
              surface, never muted-on-transparent. */}
          {/* THREE WAYS TO BUY, and the third only appears for a brand that
              actually sells one at a time — `sellable_units`, the same rule the
              sell sheet follows, so a carton-only brand is unchanged. */}
          <div className={`mt-3 grid gap-2 ${sellsSingles ? "grid-cols-3" : "grid-cols-2"}`}>
            {([
              { key: "single" as const, label: "One colour" },
              { key: "mixed" as const,  label: "Mixed carton" },
              ...(sellsSingles
                ? [{ key: "loose" as const, label: `Single ${noun}s` }]
                : []),
            ]).map((m) => {
              const on = mode === m.key;
              return (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  className="h-11 rounded-xl ios-subhead font-semibold flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
                  style={{
                    background: on ? "var(--glass-accent)" : "var(--glass-bg-1)",
                    color: on ? "var(--snm-brand-on)" : "var(--foreground)",
                    border: "0.5px solid var(--glass-border-lo)",
                  }}
                >
                  {on && <Check className="h-4 w-4" />}
                  {m.label}
                </button>
              );
            })}
          </div>

          {mode === "mixed" && (
            <>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="ios-subhead font-semibold text-foreground">How many cartons</p>
                  <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                    = {mixedTarget} {noun}s to pick
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setTargetCartons((n) => Math.max(1, n - 1))}
                    disabled={targetCartons <= 1}
                    aria-label="One carton fewer"
                    className="w-11 h-11 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
                    style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--foreground)" }}>
                    −
                  </button>
                  <span className="w-6 text-center ios-subhead font-bold tabular-nums text-foreground">{targetCartons}</span>
                  <button
                    onClick={() => setTargetCartons((n) => Math.min(maxMixedCartons, n + 1))}
                    disabled={targetCartons >= maxMixedCartons}
                    aria-label="One carton more"
                    className="w-11 h-11 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
                    style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
                    +
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${Math.min(100, (mixedBottles / Math.max(1, mixedTarget)) * 100)}%`,
                    background: mixedBottles === mixedTarget ? "var(--snm-success)" : mixedBottles > mixedTarget ? "var(--snm-error)" : "var(--snm-brand)",
                  }} />
                </div>
                <p className="ios-subhead font-bold shrink-0 tabular-nums" style={{ color: mixedBottles === mixedTarget ? "var(--snm-success)" : "var(--foreground)" }}>
                  {mixedBottles} / {mixedTarget}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Scrollable body — one row per colour, the ONLY scroll region */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4 space-y-2" style={{ touchAction: "pan-y" }}>
          {skus.map((s) => {
            const looseMode = mode === "loose";
            const price = looseMode ? bottlePriceOf(s) : cartonPriceOf(s);
            const singleMode = mode === "single";
            const cap = singleMode ? availableCartons(s) : usablePieces(s);
            const count = singleMode ? (cartons[s.id] ?? 0)
                        : looseMode  ? (loose[s.id] ?? 0)
                        : (counts[s.id] ?? 0);
            const soldOut = availablePieces(s) <= 0;
            return (
              <div key={s.id} className="rounded-2xl p-4 flex items-center justify-between gap-3"
                style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", opacity: cap > 0 ? 1 : 0.5 }}>
                <div className="min-w-0 flex-1">
                  {/* Colour first — the team picks Sosoft by colour, not scent.
                      model_name is the colour, variant_display is the scent. */}
                  <p className="ios-subhead font-semibold text-foreground truncate">{s.model_name}</p>
                  <p className="ios-footnote truncate" style={{ color: "var(--muted-foreground)" }}>{s.variant_display}</p>
                  <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                    {soldOut
                      ? (singleMode ? "No full carton in this warehouse" : "None in this warehouse")
                      : singleMode
                        ? `${cap} carton${cap === 1 ? "" : "s"} available${price != null ? ` · MVR ${mvr(price)}/carton` : ""}`
                        : looseMode
                          // The BOTTLE price, said out loud. A single is not a
                          // sixth of a carton and the row must not imply it is.
                          ? `${cap} ${noun}${cap === 1 ? "" : "s"} available${price != null ? ` · MVR ${mvr(price)}/${noun}` : ""}`
                          : `${cap} ${noun}${cap === 1 ? "" : "s"} available`}
                  </p>
                  {/* Owned, just not here. Says which godown and how much, in
                      the unit he trades in — a warehouse he cannot sell from
                      today is still the difference between "we have none" and
                      "we have plenty, in the other place". */}
                  {soldOut && elsewhereList(s).length > 0 && (
                    <p className="ios-footnote font-semibold" style={{ color: "var(--snm-warning)" }}>
                      {(() => {
                        const e = elsewhereList(s)[0];
                        const n = singleMode && piecesPerCarton > 0
                          ? `${Math.floor(e.pieces / piecesPerCarton)} carton${Math.floor(e.pieces / piecesPerCarton) === 1 ? "" : "s"}`
                          : `${e.pieces} ${noun}${e.pieces === 1 ? "" : "s"}`;
                        return `Will be picked from ${e.name} · ${n} there`;
                      })()}
                    </p>
                  )}
                  {/* TWO DIFFERENT PROBLEMS, and sending him to the wrong one
                      wastes a trip to Products. "Not sold on its own" is the
                      catalogue's decision and there is no field to fill; "no
                      price set" is a field waiting for him. */}
                  {price == null && (
                    <p className="ios-footnote font-semibold" style={{ color: "var(--snm-error)" }}>
                      {!looseMode ? "No carton price set"
                        : !sellsSingle(s) ? `Not sold on its own — cartons only`
                        : `No price set for one ${noun}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => singleMode ? setCartonCount(s, count - 1) : looseMode ? setLooseCount(s, count - 1) : setBottleCount(s, count - 1)}
                    disabled={count <= 0}
                    aria-label={`One fewer ${s.model_name}`}
                    className="w-11 h-11 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
                    style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--foreground)" }}>
                    −
                  </button>
                  <span className="w-6 text-center ios-subhead font-bold tabular-nums text-foreground">{count}</span>
                  <button
                    onClick={() => singleMode ? setCartonCount(s, count + 1) : looseMode ? setLooseCount(s, count + 1) : setBottleCount(s, count + 1)}
                    disabled={count >= cap || price == null}
                    aria-label={`One more ${s.model_name}`}
                    className="w-11 h-11 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
                    style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed footer — money first, then one primary action */}
        <div className="shrink-0 px-5 py-4 flex flex-col gap-2" style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          {mode === "mixed" && !canAddMixed && (
            <p className="ios-footnote text-center" style={{ color: mixedRemaining < 0 ? "var(--snm-error)" : "var(--foreground)", opacity: mixedRemaining < 0 ? 1 : 0.7 }}>
              {mixedRemaining > 0
                ? `Pick ${mixedRemaining} more ${noun}${mixedRemaining === 1 ? "" : "s"} to fill ${targetCartons === 1 ? "the carton" : `${targetCartons} cartons`}`
                : mixedRemaining < 0
                  ? `${Math.abs(mixedRemaining)} too many — remove some`
                  : "Set a carton price on these products first"}
            </p>
          )}
          {/* The loose tab's own blocker, in its own words: a single cannot be
              sold for a price nobody has set, and saying "carton price" here
              would send him to the wrong field. */}
          {mode === "loose" && looseBottles > 0 && !loosePriced && (
            <p className="ios-footnote mb-2 text-center" style={{ color: "var(--snm-warning)" }}>
              Set a price for one {noun} on these products first
            </p>
          )}
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="h-14 w-full rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
            <Plus className="h-4 w-4" />
            {mode === "single"
              ? (singleCartons === 0
                  ? "Add cartons"
                  : `Add ${singleCartons} carton${singleCartons === 1 ? "" : "s"} · MVR ${mvr(singleTotalMvr)}`)
              : mode === "loose"
                ? (looseBottles === 0
                    ? `Add ${noun}s`
                    : `Add ${looseBottles} ${noun}${looseBottles === 1 ? "" : "s"}${canAddLoose ? ` · MVR ${mvr(looseTotalMvr)}` : ""}`)
                : `Add ${targetCartons} mixed carton${targetCartons === 1 ? "" : "s"}${canAddMixed ? ` · MVR ${mvr(mixedTotalMvr)}` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}


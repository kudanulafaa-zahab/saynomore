"use client";

// The cart, as it appears in New Sale steps 2 and 3 and in the desktop rail.
//
// One component, used everywhere a cart is shown. That is deliberate: the
// steppers, the bin, the stock cap and the whole-carton arithmetic are the
// guards that stop money going wrong, and a second cart would be a second door
// through them.

import { Trash2 } from "lucide-react";
import { formatMixedCartonQty, containerLabel } from "@/lib/trade-units";
import { CARD } from "@/lib/surfaces";
import { type DraftLine, groupCartLines, cartonShortfall, lineQtyText, linePriceText, lineStepUnit } from "./cart-math";

/** One item in the cart. Its own card with air around it — Ali, 2026-08-09:
 *  "Each product must have a line break so it's easier for me." Dense divided
 *  rows read as a table of numbers; a card per item reads as a list of things
 *  bought, which is what a cart is. */
export function CartItemRow({
  line, hideBrand, editable, onChangeQty, onRemove, maxPiecesFor,
}: {
  line: DraftLine;
  hideBrand: boolean;
  editable: boolean;
  onChangeQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  maxPiecesFor: (line: DraftLine) => number;
}) {
  const l = line;
  const step = lineStepUnit(l);
  const per = l.sku.mixed_carton_pieces && l.is_mixed_carton_fill
    ? 1
    : (l.uom === "carton" ? l.sku.pcs_per_pack * l.sku.packs_per_carton
       : l.uom === "pack" ? l.sku.pcs_per_pack : 1);
  const atCap = l.qty_pieces + per > maxPiecesFor(l);

  return (
    <div className="rounded-2xl p-3.5"
      style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="ios-subhead font-semibold text-foreground truncate">
            {hideBrand ? l.sku.model_name : `${l.sku.brand_name} · ${l.sku.model_name}`}
          </p>
          <p className="ios-footnote truncate" style={{ color: "var(--muted-foreground)" }}>
            {l.sku.variant_display}
          </p>
          <p className="ios-footnote snm-num mt-0.5" style={{ color: "var(--foreground)", opacity: 0.75 }}>
            {lineQtyText(l)} · {linePriceText(l)}
          </p>
          {/* Only shown when this line does NOT come from the order's own
              warehouse — a normal line stays quiet. This is the line the
              picker and the driver have to see. */}
          {l.source_godown_name && (
            <p className="ios-footnote font-semibold mt-0.5" style={{ color: "var(--snm-warning)" }}>
              Pick from {l.source_godown_name}
            </p>
          )}
        </div>
        <span className="ios-subhead font-bold snm-num shrink-0 text-foreground">
          MVR {l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>

      {editable && (
        <div className="flex items-center justify-between gap-3 mt-3">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => onChangeQty(l.key, -1)}
              disabled={step.value <= 1}
              aria-label="One less"
              className="w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
              style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)", color: "var(--foreground)" }}>
              −
            </button>
            <span className="min-w-[1.5rem] text-center ios-subhead font-bold tabular-nums text-foreground">
              {step.value}
            </span>
            <button
              onClick={() => onChangeQty(l.key, 1)}
              disabled={atCap}
              aria-label="One more"
              className="w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
              +
            </button>
            <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>{step.word}</span>
          </div>
          <button
            onClick={() => onRemove(l.key)}
            aria-label="Remove from order"
            className="snm-pressable w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Small section label inside a brand group. */
export function CartSectionLabel({ text, tone }: { text: string; tone?: string }) {
  return (
    <p className="label-caps text-[11px] px-0.5 pt-1"
      style={{ color: tone ?? "var(--foreground)", opacity: tone ? 1 : 0.6 }}>
      {text}
    </p>
  );
}

export function CartLines({
  lines, grandTotal, editable, onChangeQty, onRemove, maxPiecesFor,
}: {
  lines: DraftLine[];
  grandTotal: number;
  editable: boolean;
  onChangeQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  maxPiecesFor: (line: DraftLine) => number;
}) {
  if (lines.length === 0) return null;
  const groups = groupCartLines(lines);

  return (
    <div className="space-y-3">
      {/* Ali, 2026-08-09: "What's this big + sign? The actual '+add more' is
          scrolling."
          Both complaints had ONE cause: there were two ways to add another
          product — a pill in this cart and an icon in the footer — and the
          pill scrolled off because the cart scrolls. Adding the second control
          was the mistake; wherever an "add" control is placed INSIDE the page,
          it eventually leaves the screen. So the cart no longer carries one at
          all. It carries the list and the total, nothing else, and the single
          labelled "Add product" lives in the footer, which never moves. */}
      <div className="px-0.5">
        <p className="label-caps" style={{ color: "var(--muted-foreground)" }}>
          Order items · {lines.length}
        </p>
      </div>

      {groups.map((g) => {
        // Inside a mixed-carton brand, a whole carton of one colour and
        // bottles that make up a mixed carton are two different purchases and
        // must never share a list. Ali, 2026-08-09: "There is no
        // differentiator line between the single color carton and mix carton."
        const full = g.lines.filter((l) => !l.is_mixed_carton_fill);
        const mixed = g.lines.filter((l) => l.is_mixed_carton_fill);
        const short = cartonShortfall(g);
        const mixedCartons = g.piecesPerCarton > 0
          ? Math.floor(g.mixedPieces / g.piecesPerCarton) : 0;
        const noun = containerLabel(g.unitUom);

        // An ordinary product: one card, nothing around it.
        if (!g.brandName) {
          return (
            <CartItemRow key={g.key} line={g.lines[0]} hideBrand={false}
              editable={editable} onChangeQty={onChangeQty} onRemove={onRemove}
              maxPiecesFor={maxPiecesFor} />
          );
        }

        return (
          <div key={g.key} className="rounded-2xl p-3 space-y-2"
            style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <div className="min-w-0">
                <p className="ios-subhead font-bold text-foreground truncate">{g.brandName}</p>
                <p className="ios-footnote snm-num" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                  {formatMixedCartonQty(g.totalPieces, g.piecesPerCarton, g.unitUom)}
                </p>
              </div>
              <span className="ios-subhead font-bold snm-num shrink-0 text-foreground">
                MVR {g.totalMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>

            {full.length > 0 && (
              <>
                <CartSectionLabel text="Full cartons · one colour" />
                {full.map((l) => (
                  <CartItemRow key={l.key} line={l} hideBrand
                    editable={editable} onChangeQty={onChangeQty} onRemove={onRemove}
                    maxPiecesFor={maxPiecesFor} />
                ))}
              </>
            )}

            {mixed.length > 0 && (
              <>
                <CartSectionLabel
                  text={short > 0
                    ? `Mixed · ${g.mixedPieces} of ${(mixedCartons + 1) * g.piecesPerCarton} ${noun}s`
                    : `Mixed carton${mixedCartons === 1 ? "" : "s"} · ${mixedCartons} × ${g.piecesPerCarton} ${noun}s`}
                  tone={short > 0 ? "var(--snm-error)" : undefined}
                />
                {short > 0 && (
                  <p className="ios-footnote font-semibold px-0.5" style={{ color: "var(--snm-error)" }}>
                    {short} more {noun}{short === 1 ? "" : "s"} to fill the carton — {g.brandName} is only sold by the carton
                  </p>
                )}
                {mixed.map((l) => (
                  <CartItemRow key={l.key} line={l} hideBrand
                    editable={editable} onChangeQty={onChangeQty} onRemove={onRemove}
                    maxPiecesFor={maxPiecesFor} />
                ))}
              </>
            )}
          </div>
        );
      })}

      <div className="flex justify-between items-center px-3.5 py-3 rounded-2xl ios-subhead font-bold"
        style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
        <span style={{ color: "var(--muted-foreground)" }}>Total</span>
        <span className="text-foreground snm-num">MVR {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import type { PriceProvenance } from "@/lib/queries/sales";

/*
 * Sku identity block — the anti-wrong-pick display used in EVERY product picker
 * across the app (shipments, sales list, sale detail, competitors). One block,
 * one visual language everywhere.
 *
 * Ali's rule: when two SKUs are the same product but differ only by pack count
 * (e.g. 38/pk vs 42/pk), it's dangerously easy to tap the wrong one. So the
 * pack config is NOT a muted subtitle — it's a solid chip right under the name,
 * the second thing the eye lands on. The product name is still the largest
 * element and always wraps (never truncate a name — a cut-off name is exactly
 * how you pick wrong).
 *
 * Colour discipline (Apple HIG minimalist, max 3 colours, mode-matched):
 *   • --foreground       neutral text (name)            — adapts light/dark
 *   • --muted-foreground neutral secondary (chip text)  — adapts light/dark
 *   • the parent card owns the single accent (brand) for the active state only.
 * The chip itself uses only neutral tokens so it reads as structure, not alarm.
 */

export function PackConfigChip({
  pcsPerPack,
  packsPerCarton,
  className,
}: {
  pcsPerPack: number;
  packsPerCarton: number;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "flex-start",
        padding: "3px 9px",
        borderRadius: 7,
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.2,
        letterSpacing: "0.01em",
        color: "var(--foreground)",
        background: "var(--secondary)",
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {pcsPerPack}/pk × {packsPerCarton}/ctn
    </span>
  );
}

/*
 * Full identity block: prominent wrapping name + pack chip beneath.
 * `size`      — "row" (name 16px) for list rows, "card" (name 17px) for the
 *               selected-SKU confirmation card.
 * `separator` — "›" (default, hierarchy pickers) or "·" (flat product cards).
 * `trailing`  — inline node after the chip (e.g. CBM, stock count).
 * `dimmed`    — de-emphasise the whole block (used for out-of-stock items that
 *               are demoted but still shown). Keeps us to 3 colours: unavailable
 *               is signalled by lowered opacity, not by adding a 4th hue.
 */
export function SkuIdentity({
  brandName,
  modelName,
  variantDisplay,
  pcsPerPack,
  packsPerCarton,
  size = "row",
  separator = "›",
  trailing,
  dimmed = false,
}: {
  brandName: string;
  modelName: string;
  variantDisplay: string;
  pcsPerPack: number;
  packsPerCarton: number;
  size?: "row" | "card";
  separator?: "›" | "·";
  trailing?: React.ReactNode;
  dimmed?: boolean;
}) {
  const nameSize = size === "card" ? 17 : 16;
  return (
    <div style={{ minWidth: 0, opacity: dimmed ? 0.45 : 1 }}>
      <p
        style={{
          color: "var(--foreground)",
          fontSize: nameSize,
          fontWeight: 600,
          lineHeight: 1.25,
          overflowWrap: "anywhere",
          letterSpacing: "-0.01em",
        }}
      >
        {brandName} {separator} {modelName} {separator} {variantDisplay}
      </p>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        <PackConfigChip pcsPerPack={pcsPerPack} packsPerCarton={packsPerCarton} />
        {trailing != null && (
          <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
            {trailing}
          </span>
        )}
      </div>
    </div>
  );
}

/*
 * Price provenance tag — tells the salesperson WHERE the shown price came from,
 * so nobody sells on a mystery number. Neutral by default (stays inside the
 * grid's 3-colour budget); turns warning-red ONLY when the price is below cost
 * or below the SKU's target margin — the one case where colour must interrupt.
 *
 * `size` = "sm" for the grid card, "md" for the detail editor (which also shows
 * the `.detail` line separately).
 */
export function PriceSourceTag({
  provenance,
  size = "sm",
}: {
  provenance: PriceProvenance;
  size?: "sm" | "md";
}) {
  if (!provenance.source) return null;
  const warn = provenance.belowCost || provenance.belowTarget;
  const fs = size === "md" ? 13 : 12;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: size === "md" ? "3px 9px" : "2px 8px",
        borderRadius: 7,
        fontSize: fs,
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        color: warn ? "var(--snm-error)" : "var(--muted-foreground)",
        background: warn
          ? "color-mix(in srgb, var(--snm-error) 12%, transparent)"
          : "var(--secondary)",
      }}
    >
      {warn && <AlertTriangle size={fs - 1} strokeWidth={2.5} style={{ flexShrink: 0 }} />}
      {provenance.belowCost ? "Below cost" : provenance.label}
    </span>
  );
}

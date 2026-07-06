"use client";

import React from "react";

/*
 * Sku identity block — the anti-wrong-pick display used in every product picker.
 *
 * Ali's rule: when two SKUs are the same product but differ only by pack count
 * (e.g. 38/pk vs 42/pk), it's dangerously easy to tap the wrong one. So the
 * pack config is NOT a muted subtitle here — it's a solid high-contrast chip
 * right under the name, the second thing the eye lands on. The product name is
 * still the largest element and is allowed to wrap (never truncate a name, since
 * a cut-off name is exactly how you pick wrong).
 *
 * Deliberately overrides the generic "secondary data stays small/muted" rule:
 * for this operator, pack config is a primary safety signal, not a caption.
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
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1.2,
        letterSpacing: "0.01em",
        color: "var(--foreground)",
        background: "var(--glass-2)",
        border: "0.5px solid var(--glass-border)",
        whiteSpace: "nowrap",
      }}
    >
      {pcsPerPack}/pk × {packsPerCarton}/ctn
    </span>
  );
}

/*
 * Full identity block: prominent wrapping name + pack chip beneath.
 * `size` = "row" for list rows (name 15px), "card" for the selected-SKU
 * confirmation card (name 17px, the biggest it ever needs to be).
 * `trailing` renders inline after the chip on the same row (e.g. CBM, stock).
 */
export function SkuIdentity({
  brandName,
  modelName,
  variantDisplay,
  pcsPerPack,
  packsPerCarton,
  size = "row",
  trailing,
}: {
  brandName: string;
  modelName: string;
  variantDisplay: string;
  pcsPerPack: number;
  packsPerCarton: number;
  size?: "row" | "card";
  trailing?: React.ReactNode;
}) {
  const nameSize = size === "card" ? 17 : 15;
  return (
    <div style={{ minWidth: 0 }}>
      <p
        style={{
          color: "var(--foreground)",
          fontSize: nameSize,
          fontWeight: 600,
          lineHeight: 1.25,
          overflowWrap: "anywhere",
        }}
      >
        {brandName} › {modelName} › {variantDisplay}
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

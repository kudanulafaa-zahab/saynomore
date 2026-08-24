"use client";

// What is not finished — on the screen where products are added.
//
// Ali, 2026-08-24: *"Solve the problems professionally so it doesn't repeat and
// I will be able to add any new product without coming back and debugging every
// time."*
//
// ── WHY IT LIVES ON PRODUCTS AND NOT ON THE DASHBOARD ──────────────────────
//
// Every gap here is created at the moment a product is added, and fixed on the
// same screen. Putting it where the product is made closes the loop: add a
// product, see immediately what it still needs, tap through and finish it. On
// the dashboard it would be one more thing to carry across a screen.
//
// ── WHY IT IS A REPORT AND NOT A BLOCKING FORM ─────────────────────────────
//
// None of these should stop a product being created. Ali adds a product the day
// he hears about it — long before the carton has been measured or a price
// decided. A form that refuses him then is worse than one that reminds him
// later. That is the ERP master-data pattern, chosen deliberately, and it is
// stated here because "why didn't you just make the field required" is the
// obvious question.
//
// ── WHY IT COMPOSES NO SENTENCES ───────────────────────────────────────────
//
// `headline`, `blocks` and `stock_label` arrive already written, in trade units,
// from Postgres. This file renders them and adds nothing. The unit noun has been
// re-derived in the UI five times already (migration 0202's siblings), and each
// copy fell through to a wrong "pack" — a tub read "How many packs". There is no
// unit word anywhere in this component, by design.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tag, Ruler, Coins, PackageX } from "lucide-react";
import { getSetupGaps, type SetupGapRow, type SetupGap } from "@/lib/queries/pricing";

function GapIcon({ gap }: { gap: SetupGap }) {
  const cls = "h-4 w-4";
  if (gap === "no_price" || gap === "no_carton_price") return <Tag className={cls} />;
  if (gap === "no_carton_size") return <Ruler className={cls} />;
  if (gap === "no_cost") return <Coins className={cls} />;
  return <PackageX className={cls} />;
}

/** Products that are not finished being set up, worst first. Renders NOTHING
 *  when the catalogue is complete — an alert that is always on screen is one
 *  nobody reads (skills.md, Seat 6: every alert actionable or absent). */
export function SetupGaps() {
  const [rows, setRows] = useState<SetupGapRow[] | null>(null);

  useEffect(() => {
    // Guard against navigating away before this resolves — the same "Load
    // failed" fix as inventory-view.tsx and margin-watch.tsx.
    let cancelled = false;
    getSetupGaps()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  // Loading, and complete, are both SILENT. Margin Watch shows a green "all
  // healthy" line because it lives on a financial screen a person opens to ask
  // that question. Nobody opens Products to ask "is anything unfinished" — they
  // open it to add or find a product, so a permanent reassurance banner here
  // would be furniture between them and the tabs.
  if (rows === null || rows.length === 0) return null;

  const blocking = rows.filter((r) => r.gap === "no_price").length;

  return (
    <div className="glass-panel p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="label-caps" style={{ color: "var(--muted-foreground)" }}>
          Not ready to trade
        </p>
        <span
          className="ios-caption1 font-semibold px-2 py-0.5 rounded-full"
          style={{
            background: `color-mix(in srgb, ${blocking > 0 ? "var(--snm-error)" : "var(--snm-warning)"} 12%, transparent)`,
            color: blocking > 0 ? "var(--snm-error)" : "var(--snm-warning)",
          }}
        >
          {rows.length} {rows.length === 1 ? "product" : "products"}
        </span>
      </div>

      <p className="ios-footnote mb-4" style={{ color: "var(--foreground)", opacity: 0.8 }}>
        {/* Says what it checked, not "all good" — the same doctrine as the
            Margin Watch healthy line and the morning briefing's expiry note. */}
        Each of these will stop something the day you need it — a sale, or a
        container arriving. None of them stops you adding the product now.
      </p>

      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={`${r.sku_id}-${r.gap}`}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5"
            style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: r.gap === "no_price"
                  ? "color-mix(in srgb, var(--snm-error) 12%, transparent)"
                  : "color-mix(in srgb, var(--snm-warning) 14%, transparent)",
                color: r.gap === "no_price" ? "var(--snm-error)" : "var(--snm-warning)",
              }}
            >
              <GapIcon gap={r.gap} />
            </div>

            <div className="min-w-0 flex-1">
              <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
                {r.full_path}
              </p>
              {/* Both lines are --foreground, not --muted-foreground. This is
                  the content of the row, not a hint about it, and muted text on
                  a glass surface measured ~2.6:1 (CLAUDE.md). Hierarchy comes
                  from opacity, which keeps the contrast. */}
              <p className="ios-footnote font-semibold" style={{ color: "var(--foreground)" }}>
                {r.headline}
              </p>
              <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
                {r.blocks}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

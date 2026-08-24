"use client";

// What is not finished — one line, until you ask for more.
//
// Ali, 2026-08-24, with a screenshot of the first version: *"Product 'not ready
// to use' the message is confusing. And the pill doesn't have any function.
// It's just a text explanation. Is this the right UX?"*
//
// He was right three times over, and the third fault only showed up in the
// screenshot itself.
//
// ── 1. THE PILL LOOKED TAPPABLE AND WAS NOT ────────────────────────────────
//
// "5 products" was painted in --snm-error / --snm-warning. In this app those
// colours mean STATUS or TAPPABLE (skills.md Seat 1: colour communicates
// affordance; neutral grey means information). It is a count — pure metadata,
// the same class as the FIXED / VOL. / MIXED CTN badges — so it is neutral now.
// A coloured chip that does nothing was a bug by the app's own law.
//
// ── 2. THE SAME SENTENCE, FIVE TIMES ───────────────────────────────────────
//
// One problem affecting five products was drawn as five identical problems:
// every row repeated "No carton measurements" and the same two-line
// consequence. You had to read it five times to discover it was one thing.
// Grouped by the PROBLEM now — stated once, with the products listed under it.
//
// ── 3. IT BURIED THE SCREEN'S ACTUAL JOB ───────────────────────────────────
//
// Five expanded rows pushed the tabs and the search box off the bottom of the
// phone. His screenshot shows "Search SKUs" clipped at the very edge — so the
// panel warning him about five products he cannot receive was standing between
// him and finding a product at all. Nobody opens Products to read a report.
//
// So it is COLLAPSED by default: one line, one tap to open. The information is
// still there and no longer in the way. The browser audit scrolls the search
// box into view before using it, which is how this was caught in the first
// place.
//
// ── AND THE ROWS DO SOMETHING NOW ──────────────────────────────────────────
//
// Every alert in this app is actionable or absent (skills.md Seat 6). Tapping a
// product opens its edit sheet — where the missing measurement or price is
// typed — through the `?editSku=` deep link that already existed for exactly
// this purpose, so no second way of opening a product had to be invented.
//
// ── WHY IT COMPOSES NO SENTENCES ───────────────────────────────────────────
//
// `headline`, `blocks` and `stock_label` arrive already written, in trade
// units, from Postgres. This file renders them and adds nothing. The unit noun
// has been re-derived in the UI five times already, and each copy fell through
// to a wrong "pack" — a tub read "How many packs". There is no unit word
// anywhere in this component, by design.

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Tag, Ruler, Coins, PackageX, ChevronDown } from "lucide-react";
import { getSetupGaps, type SetupGapRow, type SetupGap } from "@/lib/queries/pricing";

function GapIcon({ gap }: { gap: SetupGap }) {
  const cls = "h-4 w-4";
  if (gap === "no_price" || gap === "no_carton_price") return <Tag className={cls} />;
  if (gap === "no_carton_size") return <Ruler className={cls} />;
  if (gap === "no_cost") return <Coins className={cls} />;
  return <PackageX className={cls} />;
}

/** Products that are not finished being set up. Renders NOTHING when the
 *  catalogue is complete — an alert that is always on screen is one nobody
 *  reads (skills.md, Seat 6: every alert actionable or absent). */
export function SetupGaps() {
  const [rows, setRows] = useState<SetupGapRow[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Guard against navigating away before this resolves — the same "Load
    // failed" fix as inventory-view.tsx and margin-watch.tsx.
    let cancelled = false;
    getSetupGaps()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  if (rows === null || rows.length === 0) return null;

  // GROUPED BY THE PROBLEM, not by the product. Five products missing the same
  // thing is ONE thing to fix, and reading it five times told him nothing the
  // first time did not.
  const groups = new Map<SetupGap, { headline: string; blocks: string; rows: SetupGapRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.gap);
    if (g) g.rows.push(r);
    else groups.set(r.gap, { headline: r.headline, blocks: r.blocks, rows: [r] });
  }

  return (
    <div className="glass-panel overflow-hidden">
      {/* THE WHOLE PANEL COLLAPSED IS ONE ROW. Tapping it is the only thing
          this header does, so the whole header is the target — a 44pt row, not
          a chevron someone has to aim at. */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left snm-pressable"
      >
        <div className="min-w-0 flex-1">
          <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
            {rows.length === 1
              ? "1 product needs one more thing"
              : `${rows.length} products need one more thing`}
          </p>
          <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
            {/* Says WHAT is missing at a glance, so the collapsed line is
                useful on its own rather than a teaser. */}
            {[...groups.values()].map((g) => g.headline.toLowerCase()).join(" · ")}
          </p>
        </div>
        {/* NEUTRAL. It is a count, not a status — see the header of this file.
            Ali: "the pill doesn't have any function. It's just a text
            explanation." */}
        <span
          className="ios-caption1 font-semibold px-2 py-0.5 rounded-full shrink-0 snm-num"
          style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
        >
          {rows.length}
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 transition-transform"
          style={{
            color: "var(--muted-foreground)",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
            None of this stops you adding a product. Each one stops something
            later — a sale, or a container arriving.
          </p>

          {[...groups.entries()].map(([gap, g]) => (
            <div key={gap} className="space-y-2">
              {/* THE PROBLEM, STATED ONCE. */}
              <div className="flex items-start gap-2.5">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{
                    background: gap === "no_price"
                      ? "color-mix(in srgb, var(--snm-error) 12%, transparent)"
                      : "color-mix(in srgb, var(--snm-warning) 14%, transparent)",
                    color: gap === "no_price" ? "var(--snm-error)" : "var(--snm-warning)",
                  }}
                >
                  <GapIcon gap={gap} />
                </div>
                <div className="min-w-0">
                  <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
                    {g.headline}
                  </p>
                  <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
                    {g.blocks}
                  </p>
                </div>
              </div>

              {/* AND THE PRODUCTS IT AFFECTS, each one a way IN. An alert you
                  cannot act on is one you learn to scroll past. */}
              <div className="space-y-1.5 pl-9">
                {g.rows.map((r) => (
                  <Link
                    key={`${r.sku_id}-${r.gap}`}
                    href={`/products?editSku=${r.sku_id}`}
                    scroll={false}
                    className="block rounded-xl px-3 py-2 snm-pressable"
                    style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}
                  >
                    <p className="ios-footnote font-semibold truncate" style={{ color: "var(--foreground)" }}>
                      {r.full_path}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

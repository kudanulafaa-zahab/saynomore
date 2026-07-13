"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Megaphone, ChevronDown, ChevronUp } from "lucide-react";
import { getPromoSuggestions, type PromoSuggestionRow } from "@/lib/queries/intelligence";

function fmt(n: number) {
  return Number(n).toLocaleString("en-MV", { maximumFractionDigits: 0 });
}

/** Promo Advisor — slow movers crossed with margin headroom. For each SKU
 *  sitting >180 days deep (or not selling at all), suggests a clearance
 *  price that still keeps a 10% margin at the latest landed cost, with a
 *  ready-to-post caption. Turning dead stock into cash beats holding it. */
const PREVIEW_COUNT = 3; // biggest cash-freers shown; the rest collapse

export function PromoAdvisor() {
  const [rows, setRows] = useState<PromoSuggestionRow[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    getPromoSuggestions()
      .then(setRows)
      .catch((e) => toast.error((e as Error).message));
  }, []);

  if (rows === null || rows.length === 0) return null; // quiet when healthy

  const totalValue = rows.reduce((s, r) => s + Number(r.stock_value_mvr), 0);

  // Most cash freed first — so the 3 shown by default are always the ones
  // worth acting on. The long tail collapses behind "Show N more".
  const sorted  = [...rows].sort((a, b) => Number(b.stock_value_mvr) - Number(a.stock_value_mvr));
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden  = sorted.length - visible.length;

  // A short, human month like "August" from an expiry days count — used to
  // give the caption a concrete "best before" instead of a vague "hurry".
  function expiryMonth(daysLeft: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysLeft);
    return d.toLocaleDateString("en-MV", { month: "long" });
  }

  // The caption adapts to WHY this SKU is on the list, so no two posts read
  // the same. Expiring stock leads with a best-before date (real urgency);
  // pure dead stock leads with the saving. Warm, order-now, no fake claims.
  function buildCaption(r: PromoSuggestionRow): string {
    const name = r.full_path.replace(/ › /g, " ");
    const priceLine = `Now just MVR ${fmt(r.promo_pack_mvr)}/pack — was MVR ${fmt(r.current_pack_mvr)}, you save ${r.discount_pct}%.`;
    const packLine  = `${r.pcs_per_pack} pieces in every pack.`;
    const order     = `📱 Message us on WhatsApp or Viber to order — delivery across Malé.`;

    const expiring = r.expiry_days_left != null && r.expiry_days_left <= 180;
    if (expiring) {
      return (
        `✨ ${name} — special price this month\n` +
        `${priceLine}\n` +
        `Best before ${expiryMonth(r.expiry_days_left!)} — stock up while it lasts. ${packLine}\n` +
        order
      );
    }
    return (
      `✨ ${name} — this week's deal\n` +
      `${priceLine}\n` +
      `${packLine} Limited stock — first come, first served.\n` +
      order
    );
  }

  async function copyCaption(r: PromoSuggestionRow) {
    try {
      await navigator.clipboard.writeText(buildCaption(r));
      toast.success("Caption copied — paste it on Facebook/Instagram/Viber");
    } catch {
      toast.error("Could not copy — long-press to select instead");
    }
  }

  return (
    <div className="snm-card p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <p className="label-caps" style={{ color: "var(--muted-foreground)" }}>Promo advisor</p>
        <span className="ios-caption1 font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", color: "var(--snm-warning)" }}>
          MVR {fmt(totalValue)} to free up
        </span>
      </div>
      <p className="ios-footnote mb-4" style={{ color: "var(--muted-foreground)" }}>
        {rows.length === 1 ? "This product is" : `These ${rows.length} products are`} moving slowly and tying up cash.
        Clear {rows.length === 1 ? "it" : "them"} at the promo price below — still MVR-positive at 10% on today&apos;s cost —
        and turn shelf stock back into money. Tap <span style={{ color: "var(--foreground)", fontWeight: 600 }}>Copy post</span> for a ready caption.
      </p>

      <div className="space-y-2">
        {visible.map((r) => (
          <div key={r.sku_id} className="rounded-xl px-3 py-2.5"
            style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
                  {r.full_path}
                </p>
                <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
                  {r.days_of_stock == null
                    ? "Hasn't sold in 90 days"
                    : r.days_of_stock > 730
                      ? "Over 2 years' stock at this pace"
                      : `${r.days_of_stock} days of stock left`}{" "}
                  · frees MVR {fmt(Number(r.stock_value_mvr))} in cash
                </p>
                {r.expiry_days_left != null && r.expiry_days_left <= 180 && (
                  <p className="ios-footnote font-semibold mt-0.5" style={{ color: "var(--snm-warning)" }}>
                    ⚠ Expires in {r.expiry_days_left} days — sell this one first or it's a write-off
                  </p>
                )}
                {/* Money in bold foreground; the qualifiers as chips — small
                    colored TEXT was illegible on mobile (Ali, screenshot).
                    Chips carry a tinted background, so the color reads even
                    at footnote size in daylight. */}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="ios-subhead snm-num" style={{ textDecoration: "line-through", color: "var(--muted-foreground)" }}>
                    {fmt(r.current_pack_mvr)}
                  </span>
                  <span className="ios-subhead font-bold snm-num" style={{ color: "var(--foreground)" }}>
                    → MVR {fmt(r.promo_pack_mvr)}/pack
                  </span>
                  <span className="ios-caption1 font-bold px-1.5 py-0.5 rounded-md snm-num"
                    style={{ background: "color-mix(in srgb, var(--snm-success) 15%, transparent)", color: "var(--snm-success)" }}>
                    −{r.discount_pct}%
                  </span>
                  <span className="ios-caption1 font-semibold px-1.5 py-0.5 rounded-md"
                    style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                    keeps 10%
                  </span>
                </div>
              </div>
              <button
                onClick={() => copyCaption(r)}
                className="snm-pressable shrink-0 flex items-center gap-1.5 rounded-full px-3 py-2 ios-footnote font-semibold"
                style={{ background: "var(--foreground)", color: "var(--background)" }}
              >
                <Megaphone className="h-3.5 w-3.5" />
                Copy post
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Collapse the long tail — only the biggest cash-freers show by default */}
      {(hidden > 0 || expanded) && sorted.length > PREVIEW_COUNT && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="snm-pressable w-full mt-3 flex items-center justify-center gap-1 rounded-xl py-2.5 ios-footnote font-semibold"
          style={{ background: "var(--muted)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
        >
          {expanded
            ? <>Show less <ChevronUp className="h-3.5 w-3.5" /></>
            : <>Show {hidden} more <ChevronDown className="h-3.5 w-3.5" /></>}
        </button>
      )}
    </div>
  );
}

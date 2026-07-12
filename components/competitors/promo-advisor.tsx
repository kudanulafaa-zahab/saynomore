"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { getPromoSuggestions, type PromoSuggestionRow } from "@/lib/queries/intelligence";

function fmt(n: number) {
  return Number(n).toLocaleString("en-MV", { maximumFractionDigits: 0 });
}

/** Promo Advisor — slow movers crossed with margin headroom. For each SKU
 *  sitting >180 days deep (or not selling at all), suggests a clearance
 *  price that still keeps a 10% margin at the latest landed cost, with a
 *  ready-to-post caption. Turning dead stock into cash beats holding it. */
export function PromoAdvisor() {
  const [rows, setRows] = useState<PromoSuggestionRow[] | null>(null);

  useEffect(() => {
    getPromoSuggestions()
      .then(setRows)
      .catch((e) => toast.error((e as Error).message));
  }, []);

  if (rows === null || rows.length === 0) return null; // quiet when healthy

  const totalValue = rows.reduce((s, r) => s + Number(r.stock_value_mvr), 0);

  async function copyCaption(r: PromoSuggestionRow) {
    const name = r.full_path.replace(/ › /g, " ");
    const caption =
      `🔥 OFFER — ${name}\n` +
      `Now MVR ${fmt(r.promo_pack_mvr)}/pack (was MVR ${fmt(r.current_pack_mvr)}) — save ${r.discount_pct}%!\n` +
      `${r.pcs_per_pack} pcs per pack · while stocks last.\n` +
      `📱 Order via WhatsApp / Viber.`;
    try {
      await navigator.clipboard.writeText(caption);
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
          MVR {fmt(totalValue)} sitting
        </span>
      </div>
      <p className="ios-footnote mb-4" style={{ color: "var(--muted-foreground)" }}>
        Slow stock you could clear at a promo price that still makes 10% on today&apos;s landed cost.
      </p>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.sku_id} className="rounded-xl px-3 py-2.5"
            style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
                  {r.full_path}
                </p>
                <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
                  {r.days_of_stock == null
                    ? "No sales in 90 days"
                    : `${r.days_of_stock}d of stock`}{" "}
                  · MVR {fmt(Number(r.stock_value_mvr))} at cost
                </p>
                <p className="ios-footnote snm-num mt-0.5" style={{ color: "var(--foreground)" }}>
                  <span style={{ textDecoration: "line-through", color: "var(--muted-foreground)" }}>
                    {fmt(r.current_pack_mvr)}
                  </span>{" "}
                  → <b>MVR {fmt(r.promo_pack_mvr)}/pack</b>{" "}
                  <span style={{ color: "var(--snm-success)", fontWeight: 600 }}>
                    (−{r.discount_pct}%, still 10% margin)
                  </span>
                </p>
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
    </div>
  );
}

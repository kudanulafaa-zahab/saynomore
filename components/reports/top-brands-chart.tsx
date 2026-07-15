"use client";

import type { BrandGroup } from "@/lib/group-by-brand";

// Top-brands horizontal bar chart — an executive glance above the detailed
// collapsible brand list already in BestSellersTable. Monochrome bars by
// default; margin health tints the bar exactly like everywhere else in the
// app (green ≥20%, amber ≥10%, red below) — color still only ever means
// money, never decoration.
function marginColor(pct: number | null): string {
  if (pct == null) return "color-mix(in srgb, var(--foreground) 30%, transparent)";
  if (pct >= 20) return "var(--snm-success)";
  if (pct >= 10) return "var(--snm-warning)";
  return "var(--snm-error)";
}

function fmt0(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function TopBrandsChart({ groups }: { groups: BrandGroup[] }) {
  const top = [...groups]
    .filter((g) => g.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  if (top.length === 0) return null;

  const max = Math.max(...top.map((g) => g.revenue), 1);

  return (
    <div className="glass-panel rounded-2xl p-5 mb-3" style={{ border: "0.5px solid var(--glass-border-lo)" }}>
      <p className="label-caps text-[12px] mb-4" style={{ color: "var(--muted-foreground)" }}>
        Top Brands by Revenue
      </p>
      <div className="space-y-3">
        {top.map((g) => {
          const pct = (g.revenue / max) * 100;
          return (
            <div key={g.brand} className="flex items-center gap-3">
              <p className="ios-footnote font-medium text-foreground shrink-0 truncate" style={{ width: 84 }}>
                {g.brand}
              </p>
              <div className="flex-1 h-6 rounded-lg overflow-hidden relative" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}>
                <div
                  className="h-full rounded-lg flex items-center justify-end px-2"
                  style={{ width: `${Math.max(pct, 14)}%`, background: marginColor(g.marginPct), transition: "width 0.3s ease" }}
                >
                  <span className="ios-caption1 font-bold snm-num" style={{ color: "var(--snm-on-fill)", whiteSpace: "nowrap" }}>
                    {fmt0(g.revenue)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

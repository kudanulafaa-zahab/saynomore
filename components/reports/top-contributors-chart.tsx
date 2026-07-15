"use client";

import type { ContributionRow } from "@/lib/queries/reports";

// Top-6 SKUs by true contribution margin (revenue - landed cost - allocated
// marketing) for the loaded period — the same audited numbers already in
// ContributionTable, just the executive-glance chart above the detail rows.
function fmt0(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function TopContributorsChart({ rows }: { rows: ContributionRow[] }) {
  const top = [...rows]
    .filter((r) => r.contribution_mvr !== 0)
    .sort((a, b) => b.contribution_mvr - a.contribution_mvr)
    .slice(0, 6);

  if (top.length === 0) return null;

  const max = Math.max(...top.map((r) => Math.abs(r.contribution_mvr)), 1);

  return (
    <div className="glass-panel rounded-2xl p-5 mb-3">
      <p className="label-caps text-[12px] mb-4" style={{ color: "var(--muted-foreground)" }}>
        Top Contributors — True Profit After Marketing
      </p>
      <div className="space-y-3">
        {top.map((r) => {
          const pct = (Math.abs(r.contribution_mvr) / max) * 100;
          const isNegative = r.contribution_mvr < 0;
          return (
            <div key={r.sku_id} className="flex items-center gap-3">
              <p className="ios-footnote font-medium text-foreground shrink-0 truncate" style={{ width: 96 }}>
                {r.brand_name} {r.model_name}
              </p>
              <div className="flex-1 h-6 rounded-lg overflow-hidden relative" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}>
                <div
                  className="h-full rounded-lg flex items-center justify-end px-2"
                  style={{
                    width: `${Math.max(pct, 14)}%`,
                    background: isNegative ? "var(--status-danger)" : "var(--glass-accent)",
                    transition: "width 0.3s ease",
                  }}
                >
                  <span className="ios-caption1 font-bold snm-num" style={{ color: "#ffffff", whiteSpace: "nowrap" }}>
                    {isNegative ? "-" : ""}{fmt0(Math.abs(r.contribution_mvr))}
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

"use client";

import type { ReportRow } from "@/lib/queries/reports";

// Margin health distribution — how many SKUs (by revenue) fall into healthy/
// watch/loss bands, for the period already loaded on the Margins tab. Same
// 30%/15% thresholds already used to color the table rows (marginColor in
// reports-view.tsx) — this chart is just a different view of the same
// audited numbers, not a new calculation.
export function MarginDistributionChart({ rows }: { rows: ReportRow[] }) {
  const priced = rows.filter((r) => r.gross_margin_pct !== null && r.total_revenue_mvr > 0);
  if (priced.length === 0) return null;

  const bands = [
    { label: "Healthy", sub: "≥30% margin", test: (p: number) => p >= 30, color: "var(--status-success)", bg: "var(--status-success-bg)" },
    { label: "Watch",    sub: "15–29% margin", test: (p: number) => p >= 15 && p < 30, color: "var(--status-warning)", bg: "var(--status-warning-bg)" },
    { label: "Thin",     sub: "<15% margin",  test: (p: number) => p < 15, color: "var(--status-danger)",  bg: "var(--status-danger-bg)"  },
  ].map((b) => {
    const matched = priced.filter((r) => b.test(Number(r.gross_margin_pct)));
    const revenue = matched.reduce((s, r) => s + Number(r.total_revenue_mvr), 0);
    return { ...b, count: matched.length, revenue };
  });

  const totalRevenue = bands.reduce((s, b) => s + b.revenue, 0);

  return (
    <div className="glass-panel rounded-2xl p-5 mb-3">
      <p className="label-caps text-[12px] mb-4" style={{ color: "var(--muted-foreground)" }}>
        Margin Health — {priced.length} priced SKU{priced.length !== 1 ? "s" : ""}
      </p>

      {/* Proportional revenue bar, one segment per band */}
      <div className="flex h-3 rounded-full overflow-hidden mb-4" style={{ background: "var(--glass-divider)" }}>
        {bands.filter((b) => b.revenue > 0).map((b) => (
          <div
            key={b.label}
            style={{ width: `${totalRevenue > 0 ? (b.revenue / totalRevenue) * 100 : 0}%`, background: b.color }}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {bands.map((b) => (
          <div key={b.label} className="rounded-xl p-3" style={{ background: b.bg }}>
            <p className="ios-caption1 font-semibold" style={{ color: b.color }}>{b.label}</p>
            <p className="text-[20px] font-bold leading-none mt-1.5 snm-num" style={{ color: b.color }}>{b.count}</p>
            <p className="ios-caption1 mt-1" style={{ color: "var(--muted-foreground)" }}>{b.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

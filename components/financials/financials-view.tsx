"use client";

import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { getReportsData, type ReportRow } from "@/lib/queries/reports";
import { listMarketingSpend } from "@/lib/queries/expenses";

const CARD = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
};

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-MV", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtShort(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toFixed(0);
}

const BAR_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const REV_HEIGHTS = [60, 75, 85, 90, 70, 100];
const EXP_HEIGHTS = [40, 35, 45, 30, 50, 45];

export function FinancialsView() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [expenses, setExpenses] = useState<{ amount_mvr: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // Default: current month
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getReportsData(firstOfMonth, tomorrow),
      listMarketingSpend(),
    ])
      .then(([r, e]) => { setRows(r); setExpenses(e); })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const totalRevenue = useMemo(() => rows.reduce((a, r) => a + Number(r.total_revenue_mvr), 0), [rows]);
  const totalLandedCost = useMemo(() => rows.reduce((a, r) => a + (Number(r.landed_per_piece_mvr) * Number(r.total_qty_pieces)), 0), [rows]);
  const totalOpex = useMemo(() => expenses.reduce((a, e) => a + Number(e.amount_mvr), 0), [expenses]);
  const netProfit = totalRevenue - totalLandedCost - totalOpex;
  const profitPct = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100) : 0;

  // Top brands by revenue
  const brandMap = useMemo(() => {
    const m = new Map<string, { revenue: number; cost: number; label: string }>();
    for (const r of rows) {
      const key = r.brand_name;
      const rev = Number(r.total_revenue_mvr);
      const cost = Number(r.landed_per_piece_mvr) * Number(r.total_qty_pieces);
      const existing = m.get(key);
      if (existing) {
        existing.revenue += rev;
        existing.cost += cost;
      } else {
        m.set(key, { revenue: rev, cost, label: key });
      }
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [rows]);

  const cashRunwayMonths = totalOpex > 0 ? Math.min((netProfit / (totalOpex / 1)) , 24) : 0;

  if (loading) {
    return (
      <div style={{ background: "var(--background)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--background)", minHeight: "100vh", padding: "0 0 120px 0" }}>

      {/* Hero — Net Profit */}
      <section style={{ ...CARD, borderRadius: 16, padding: 24, marginBottom: 12 }}>
        <div>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
            Real-Time Net Profit
          </p>
          <p style={{ color: netProfit >= 0 ? "var(--foreground)" : "#ffb4ab", fontSize: 48, fontWeight: 300, letterSpacing: "-0.03em", lineHeight: "56px" }}>
            MVR {fmt(netProfit, 2)}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
            <span className="material-symbols-outlined" style={{ color: netProfit >= 0 ? "#4ade80" : "#ffb4ab", fontSize: 16 }}>
              {netProfit >= 0 ? "trending_up" : "trending_down"}
            </span>
            <span style={{ color: netProfit >= 0 ? "#4ade80" : "#ffb4ab", fontSize: 14 }}>
              {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(1)}% margin
            </span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 32, paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {[
            { label: "Sales Revenue", value: fmtShort(totalRevenue) },
            { label: "Landed Costs", value: fmtShort(totalLandedCost) },
            { label: "OpEx", value: fmtShort(totalOpex) },
          ].map((m) => (
            <div key={m.label}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{m.label}</p>
              <p style={{ color: "var(--foreground)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>MVR {m.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bento row */}
      <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 12, marginBottom: 12 }}>

        {/* Cash Runway */}
        <div style={{ ...CARD, borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 256 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>Cash Runway</p>
              <span className="material-symbols-outlined" style={{ color: "var(--muted-foreground)", fontSize: 20 }}>schedule</span>
            </div>
            <p style={{ color: "var(--foreground)", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 8 }}>
              {cashRunwayMonths > 0 ? cashRunwayMonths.toFixed(1) + " Months" : "—"}
            </p>
            <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginTop: 4 }}>Based on current burn rate</p>
          </div>
          <div style={{ width: "100%", background: "rgba(255,255,255,0.05)", height: 4, borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min((cashRunwayMonths / 24) * 100, 100)}%`, background: "var(--foreground)", borderRadius: 999, transition: "width 0.6s" }} />
          </div>
        </div>

        {/* Revenue vs Expenses chart — spans 2 cols */}
        <div style={{ ...CARD, borderRadius: 16, padding: 24, gridColumn: "span 2", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>Revenue vs. Expenses</p>
            <div style={{ display: "flex", gap: 16 }}>
              {[{ label: "Revenue", color: "var(--foreground)" }, { label: "Expenses", color: "rgba(255,255,255,0.2)" }].map((l) => (
                <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 999, background: l.color }} />
                  <span style={{ color: "var(--muted-foreground)", fontSize: 10, textTransform: "uppercase" }}>{l.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 10 }}>
            {BAR_MONTHS.map((m, i) => (
              <div key={m} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: "100%", display: "flex", alignItems: "flex-end", gap: 3, height: 120 }}>
                  <div style={{ flex: 1, background: "rgba(255,255,255,0.2)", borderRadius: "3px 3px 0 0", height: `${EXP_HEIGHTS[i]}%` }} />
                  <div style={{ flex: 1, background: "var(--foreground)", borderRadius: "3px 3px 0 0", height: `${REV_HEIGHTS[i]}%` }} />
                </div>
                <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>{m}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Profit by Brand */}
      <div style={{ ...CARD, borderRadius: 16, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Lucrative Imports: Profit by Brand
          </p>
          <button style={{ color: "var(--foreground)", background: "none", border: "none", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            View Detailed Report
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_forward</span>
          </button>
        </div>
        {brandMap.length === 0 ? (
          <p style={{ color: "var(--muted-foreground)", fontSize: 14, textAlign: "center", padding: "24px 0" }}>No sales data this month.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {brandMap.map((b) => {
              const margin = b.revenue > 0 ? ((b.revenue - b.cost) / b.revenue * 100) : 0;
              return (
                <div key={b.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", background: "rgba(255,255,255,0.04)", borderRadius: 12, cursor: "pointer" }}>
                  <div>
                    <p style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 500 }}>{b.label}</p>
                    <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>FMCG Import</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 500 }}>MVR {fmt(b.revenue, 2)}</p>
                    <p style={{ color: margin >= 0 ? "#4ade80" : "#ffb4ab", fontSize: 12 }}>{margin.toFixed(1)}% Margin</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

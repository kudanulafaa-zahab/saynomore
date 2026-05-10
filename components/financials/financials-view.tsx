"use client";

import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { getReportsData, getMonthlyRevenue, type ReportRow, type MonthlyRevenueRow } from "@/lib/queries/reports";
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

export function FinancialsView() {
  const [rows, setRows]         = useState<ReportRow[]>([]);
  const [expenses, setExpenses] = useState<{ amount_mvr: number }[]>([]);
  const [monthly, setMonthly]   = useState<MonthlyRevenueRow[]>([]);
  const [loading, setLoading]   = useState(true);

  // Current month
  const today       = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const tomorrow     = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getReportsData(firstOfMonth, tomorrow),
      listMarketingSpend(),
      getMonthlyRevenue(6),
    ])
      .then(([r, e, m]) => { setRows(r); setExpenses(e); setMonthly(m); })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const totalRevenue    = useMemo(() => rows.reduce((a, r) => a + Number(r.total_revenue_mvr), 0), [rows]);
  const totalLandedCost = useMemo(() => rows.reduce((a, r) => a + (Number(r.landed_per_piece_mvr) * Number(r.total_qty_pieces)), 0), [rows]);
  const totalOpex       = useMemo(() => expenses.reduce((a, e) => a + Number(e.amount_mvr), 0), [expenses]);
  const netProfit       = totalRevenue - totalLandedCost - totalOpex;
  const profitPct       = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100) : 0;

  // Top brands by revenue
  const brandMap = useMemo(() => {
    const m = new Map<string, { revenue: number; cost: number; skuCount: number }>();
    for (const r of rows) {
      const rev  = Number(r.total_revenue_mvr);
      const cost = Number(r.landed_per_piece_mvr) * Number(r.total_qty_pieces);
      const entry = m.get(r.brand_name);
      if (entry) {
        entry.revenue  += rev;
        entry.cost     += cost;
        entry.skuCount += rev > 0 ? 1 : 0;
      } else {
        m.set(r.brand_name, { revenue: rev, cost, skuCount: rev > 0 ? 1 : 0 });
      }
    }
    return Array.from(m.entries())
      .map(([label, v]) => ({ label, ...v }))
      .filter((b) => b.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [rows]);

  // Bar chart — derived from real monthly data
  const maxRevenue = useMemo(() => Math.max(...monthly.map((m) => Number(m.revenue_mvr)), 1), [monthly]);
  const maxOpex    = useMemo(() => Math.max(...monthly.map((m) => Number(m.opex_mvr)), 1), [monthly]);
  const chartMax   = Math.max(maxRevenue, maxOpex, 1);

  if (loading) {
    return (
      <div style={{ background: "var(--background)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--background)", minHeight: "100vh", padding: "0 0 120px 0" }}>

      {/* Hero — Net Profit (this month) */}
      <section style={{ ...CARD, borderRadius: 16, padding: 24, marginBottom: 12 }}>
        <div>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
            Net Profit — {today.toLocaleString("en-MV", { month: "long" })}
          </p>
          <p style={{ color: netProfit >= 0 ? "var(--foreground)" : "#ffb4ab", fontSize: 48, fontWeight: 300, letterSpacing: "-0.03em", lineHeight: "56px" }}>
            MVR {fmt(netProfit, 2)}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
            {netProfit >= 0
              ? <TrendingUp style={{ color: "#4ade80", width: 16, height: 16 }} />
              : <TrendingDown style={{ color: "#ffb4ab", width: 16, height: 16 }} />}
            <span style={{ color: netProfit >= 0 ? "#4ade80" : "#ffb4ab", fontSize: 14 }}>
              {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(1)}% margin
            </span>
            <span style={{ color: "var(--muted-foreground)", fontSize: 12, marginLeft: 4 }}>
              (Revenue − Landed Costs − OpEx)
            </span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 32, paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {[
            { label: "Sales Revenue", value: fmtShort(totalRevenue) },
            { label: "Landed Costs", value: fmtShort(totalLandedCost) },
            { label: "OpEx (Marketing)", value: fmtShort(totalOpex) },
          ].map((item) => (
            <div key={item.label}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{item.label}</p>
              <p style={{ color: "var(--foreground)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>MVR {item.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Revenue vs OpEx chart — real 6-month data */}
      <div style={{ ...CARD, borderRadius: 16, padding: 24, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Revenue vs. Marketing OpEx — Last 6 Months
          </p>
          <div style={{ display: "flex", gap: 16 }}>
            {[
              { label: "Revenue",  color: "var(--foreground)" },
              { label: "OpEx",     color: "rgba(255,255,255,0.25)" },
            ].map((l) => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: l.color }} />
                <span style={{ color: "var(--muted-foreground)", fontSize: 10, textTransform: "uppercase" }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {monthly.length === 0 ? (
          <p style={{ color: "var(--muted-foreground)", fontSize: 14, textAlign: "center", padding: "24px 0" }}>No data yet.</p>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 120 }}>
            {monthly.map((m) => {
              const revH  = chartMax > 0 ? Math.max((Number(m.revenue_mvr) / chartMax) * 100, 2) : 2;
              const opexH = chartMax > 0 ? Math.max((Number(m.opex_mvr)    / chartMax) * 100, 2) : 2;
              const isCurrent = m.month_start.slice(0, 7) === today.toISOString().slice(0, 7);
              return (
                <div key={m.month_start} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ width: "100%", display: "flex", alignItems: "flex-end", gap: 3, height: 100 }}>
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.2)", borderRadius: "3px 3px 0 0", height: `${opexH}%` }} />
                    <div style={{ flex: 1, background: isCurrent ? "#4ade80" : "var(--foreground)", borderRadius: "3px 3px 0 0", height: `${revH}%`, opacity: isCurrent ? 1 : 0.8 }} />
                  </div>
                  <span style={{ color: isCurrent ? "var(--foreground)" : "var(--muted-foreground)", fontSize: 10, fontWeight: isCurrent ? 700 : 400 }}>{m.month_label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Axis labels */}
        {monthly.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>0</span>
            <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Peak: MVR {fmtShort(chartMax)}</span>
          </div>
        )}
      </div>

      {/* Profit by Brand */}
      <div style={{ ...CARD, borderRadius: 16, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Profit by Brand — {today.toLocaleString("en-MV", { month: "long" })}
          </p>
          <button style={{ color: "var(--foreground)", background: "none", border: "none", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            View Detailed Report
            <ArrowRight style={{ width: 14, height: 14 }} />
          </button>
        </div>
        {brandMap.length === 0 ? (
          <p style={{ color: "var(--muted-foreground)", fontSize: 14, textAlign: "center", padding: "24px 0" }}>No sales data this month.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {brandMap.map((b) => {
              const margin = b.revenue > 0 ? ((b.revenue - b.cost) / b.revenue * 100) : 0;
              return (
                <div key={b.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", background: "rgba(255,255,255,0.04)", borderRadius: 12 }}>
                  <div>
                    <p style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 500 }}>{b.label}</p>
                    <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
                      {b.skuCount} SKU{b.skuCount !== 1 ? "s" : ""} sold this month
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 500 }}>MVR {fmt(b.revenue, 2)}</p>
                    <p style={{ color: margin >= 20 ? "#4ade80" : margin >= 10 ? "#fb923c" : "#ffb4ab", fontSize: 12 }}>
                      {margin.toFixed(1)}% Gross Margin
                    </p>
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

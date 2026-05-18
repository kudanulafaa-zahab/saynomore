"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, TrendingUp, TrendingDown, ArrowRight, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Banknote } from "lucide-react";
import { getReportsData, getMonthlyRevenue, type ReportRow, type MonthlyRevenueRow } from "@/lib/queries/reports";
import { listMarketingSpend } from "@/lib/queries/expenses";
import { getCodReconciliation, getCodOrdersForDriver, type CodReconRow, type CodOrderRow } from "@/lib/queries/sales";

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

/* ─── COD Reconciliation sub-view ─────────────────────────────────────── */

function statusColor(s: CodReconRow["recon_status"]) {
  if (s === "shortfall")       return "var(--snm-error)";
  if (s === "overage")         return "var(--snm-warning)";
  if (s === "pending_deposit") return "var(--snm-warning)";
  return "var(--snm-success)";
}
function statusLabel(s: CodReconRow["recon_status"]) {
  if (s === "shortfall")       return "Shortfall";
  if (s === "overage")         return "Overage";
  if (s === "pending_deposit") return "Awaiting deposit";
  return "Balanced";
}

function CodView() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate]             = useState(today);
  const [rows, setRows]             = useState<CodReconRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [drillRows, setDrillRows]   = useState<CodOrderRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getCodReconciliation(date)
      .then(setRows)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [date]);

  async function toggleDriver(driverId: string) {
    if (expanded === driverId) { setExpanded(null); setDrillRows([]); return; }
    setExpanded(driverId);
    setDrillLoading(true);
    try {
      setDrillRows(await getCodOrdersForDriver(driverId, date));
    } catch (e) { toast.error((e as Error).message); }
    finally { setDrillLoading(false); }
  }

  const totalExpected    = rows.reduce((a, r) => a + Number(r.expected_mvr), 0);
  const totalCollected   = rows.reduce((a, r) => a + Number(r.collected_mvr), 0);
  const totalVariance    = totalCollected - totalExpected;
  const totalPending     = rows.reduce((a, r) => a + Number(r.pending_deposit_mvr), 0);
  const hasIssue         = rows.some((r) => r.recon_status !== "balanced" && r.recon_status !== "pending_deposit");

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Date picker */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>Date</p>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", border: "1px solid var(--glass-border-lo)", borderRadius: 12, height: 44, padding: "0 14px", color: "var(--foreground)", fontSize: 14, outline: "none", cursor: "pointer" }}
        />
      </div>

      {/* Summary strip */}
      {rows.length > 0 && (
        <div style={{ ...CARD, borderRadius: 16, padding: 20, marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20 }}>
            {[
              { label: "Expected",       value: `MVR ${fmt(totalExpected)}`,  color: "var(--foreground)" },
              { label: "Collected",      value: `MVR ${fmt(totalCollected)}`, color: Math.abs(totalVariance) < 0.01 ? "var(--snm-success)" : "var(--snm-error)" },
              { label: "Variance",       value: `${totalVariance >= 0 ? "+" : ""}MVR ${fmt(totalVariance)}`, color: Math.abs(totalVariance) < 0.01 ? "var(--snm-success)" : "var(--snm-error)" },
              { label: "Pending Deposit",value: `MVR ${fmt(totalPending)}`,   color: totalPending > 0 ? "var(--snm-warning)" : "var(--snm-success)" },
            ].map((s) => (
              <div key={s.label}>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</p>
                <p style={{ color: s.color, fontSize: 18, fontWeight: 700 }}>{s.value}</p>
              </div>
            ))}
          </div>
          {hasIssue && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--glass-border-lo)" }}>
              <AlertTriangle style={{ color: "var(--snm-error)", width: 14, height: 14 }} />
              <p style={{ color: "var(--snm-error)", fontSize: 12 }}>One or more drivers have a cash variance — review below.</p>
            </div>
          )}
        </div>
      )}

      {/* Per-driver rows */}
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted-foreground)" }} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ ...CARD, borderRadius: 16, padding: 40, textAlign: "center" }}>
          <Banknote style={{ width: 32, height: 32, color: "var(--muted-foreground)", margin: "0 auto 12px", opacity: 0.4 }} />
          <p style={{ color: "var(--muted-foreground)", fontSize: 14 }}>No COD deliveries on this date.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => {
            const isOpen = expanded === r.driver_id;
            const color  = statusColor(r.recon_status);
            return (
              <div
                key={r.driver_id}
                style={{ ...CARD, borderRadius: 16, overflow: "hidden", border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}
              >
                {/* Driver header */}
                <button
                  onClick={() => toggleDriver(r.driver_id)}
                  style={{ width: "100%", minHeight: 64, padding: "14px 20px", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `color-mix(in srgb, ${color} 14%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Banknote style={{ width: 16, height: 16, color }} />
                    </div>
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.driver_name}</p>
                      <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
                        {r.orders_count} order{r.orders_count !== 1 ? "s" : ""} · {statusLabel(r.recon_status)}
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
                    <div>
                      <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 700 }}>MVR {fmt(Number(r.collected_mvr))}</p>
                      {Math.abs(Number(r.variance_mvr)) >= 0.01 && (
                        <p style={{ color, fontSize: 11, fontWeight: 600 }}>
                          {Number(r.variance_mvr) >= 0 ? "+" : ""}MVR {fmt(Number(r.variance_mvr))} variance
                        </p>
                      )}
                    </div>
                    {isOpen
                      ? <ChevronDown style={{ width: 16, height: 16, color: "var(--muted-foreground)" }} />
                      : <ChevronRight style={{ width: 16, height: 16, color: "var(--muted-foreground)" }} />}
                  </div>
                </button>

                {/* Drill-down: order list */}
                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--glass-border-lo)", padding: "12px 20px 16px" }}>
                    {drillLoading ? (
                      <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
                        <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--muted-foreground)" }} />
                      </div>
                    ) : drillRows.map((o) => {
                      const variance = Number(o.collected_mvr) - Number(o.order_total_mvr);
                      const isDeposited = o.payment_status === "deposited";
                      return (
                        <div
                          key={o.order_id}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--glass-border-lo)" }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 500 }}>{o.customer_name}</p>
                            <p style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
                              {o.order_number} · {new Date(o.delivered_at).toLocaleTimeString("en-MV", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>MVR {fmt(Number(o.collected_mvr))}</p>
                              {isDeposited
                                ? <CheckCircle2 style={{ width: 14, height: 14, color: "var(--snm-success)" }} />
                                : <span style={{ fontSize: 11, fontWeight: 700, color: "var(--snm-warning)", background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", padding: "2px 6px", borderRadius: 5 }}>NOT DEPOSITED</span>}
                            </div>
                            {Math.abs(variance) >= 0.01 && (
                              <p style={{ color: variance < 0 ? "var(--snm-error)" : "var(--snm-warning)", fontSize: 11 }}>
                                {variance >= 0 ? "+" : ""}MVR {fmt(variance)} vs MVR {fmt(Number(o.order_total_mvr))} expected
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Totals row */}
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, marginTop: 4 }}>
                      <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Total collected</p>
                      <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 700 }}>MVR {fmt(Number(r.collected_mvr))}</p>
                    </div>
                    {Number(r.pending_deposit_mvr) > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                        <p style={{ color: "var(--snm-warning)", fontSize: 12 }}>Awaiting bank deposit</p>
                        <p style={{ color: "var(--snm-warning)", fontSize: 13, fontWeight: 700 }}>MVR {fmt(Number(r.pending_deposit_mvr))}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Main FinancialsView with tabs ───────────────────────────────────── */

export function FinancialsView() {
  const router = useRouter();
  const [tab, setTab]           = useState<"profit" | "cod">("profit");
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
  const totalLandedCost = useMemo(() => rows.reduce((a, r) => a + Number(r.total_landed_cost_mvr), 0), [rows]);
  const totalOpex       = useMemo(() => expenses.reduce((a, e) => a + Number(e.amount_mvr), 0), [expenses]);
  const netProfit       = totalRevenue - totalLandedCost - totalOpex;
  const profitPct       = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100) : 0;

  // Top brands by revenue
  const brandMap = useMemo(() => {
    const m = new Map<string, { revenue: number; cost: number; skuCount: number }>();
    for (const r of rows) {
      const rev  = Number(r.total_revenue_mvr);
      const cost = Number(r.total_landed_cost_mvr);
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

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "var(--glass-1)", backdropFilter: "blur(20px)", padding: 4, borderRadius: 14, border: "1px solid var(--glass-border-lo)" }}>
        {([
          { key: "profit", label: "P&L" },
          { key: "cod",    label: "COD Cash" },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: "9px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: tab === t.key ? "var(--foreground)" : "transparent",
              color: tab === t.key ? "var(--background)" : "var(--muted-foreground)",
              transition: "all 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* COD tab */}
      {tab === "cod" && <CodView />}

      {/* P&L tab — only render when active */}
      {tab !== "cod" && <>

      {/* Hero — Net Profit (this month) */}
      <section style={{ ...CARD, borderRadius: 16, padding: 24, marginBottom: 12 }}>
        <div>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
            Net Profit — {today.toLocaleString("en-MV", { month: "long" })}
          </p>
          <p style={{ color: netProfit >= 0 ? "var(--foreground)" : "var(--snm-error)", fontSize: 48, fontWeight: 300, letterSpacing: "-0.03em", lineHeight: "56px" }}>
            MVR {fmt(netProfit, 2)}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
            {netProfit >= 0
              ? <TrendingUp style={{ color: "var(--snm-success)", width: 16, height: 16 }} />
              : <TrendingDown style={{ color: "var(--snm-error)", width: 16, height: 16 }} />}
            <span style={{ color: netProfit >= 0 ? "var(--snm-success)" : "var(--snm-error)", fontSize: 14 }}>
              {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(1)}% margin
            </span>
            <span style={{ color: "var(--muted-foreground)", fontSize: 12, marginLeft: 4 }}>
              (Revenue − Landed Costs − OpEx)
            </span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--glass-border-lo)" }}>
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
              { label: "OpEx",     color: "var(--glass-border)" },
            ].map((l) => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: l.color }} />
                <span style={{ color: "var(--muted-foreground)", fontSize: 11, textTransform: "uppercase" }}>{l.label}</span>
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
                    <div style={{ flex: 1, background: "var(--glass-border)", borderRadius: "3px 3px 0 0", height: `${opexH}%` }} />
                    <div style={{ flex: 1, background: isCurrent ? "var(--snm-success)" : "var(--foreground)", borderRadius: "3px 3px 0 0", height: `${revH}%`, opacity: isCurrent ? 1 : 0.8 }} />
                  </div>
                  <span style={{ color: isCurrent ? "var(--foreground)" : "var(--muted-foreground)", fontSize: 11, fontWeight: isCurrent ? 700 : 400 }}>{m.month_label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Axis labels */}
        {monthly.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--glass-border-lo)" }}>
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
          <button onClick={() => router.push("/reports")} style={{ color: "var(--foreground)", background: "none", border: "none", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
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
                <div key={b.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", background: "var(--glass-bg-1)", borderRadius: 12 }}>
                  <div>
                    <p style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 500 }}>{b.label}</p>
                    <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
                      {b.skuCount} SKU{b.skuCount !== 1 ? "s" : ""} sold this month
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 500 }}>MVR {fmt(b.revenue, 2)}</p>
                    <p style={{ color: margin >= 20 ? "var(--snm-success)" : margin >= 10 ? "var(--snm-warning)" : "var(--snm-error)", fontSize: 12 }}>
                      {margin.toFixed(1)}% Gross Margin
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      </> /* end P&L tab */}
    </div>
  );
}

"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, TrendingUp, TrendingDown, ArrowRight,
  ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Banknote,
} from "lucide-react";
import { getReportsData, getMonthlyRevenue, type ReportRow, type MonthlyRevenueRow } from "@/lib/queries/reports";
import { listMarketingSpend } from "@/lib/queries/expenses";
import { getCodReconciliation, getCodOrdersForDriver, type CodReconRow, type CodOrderRow } from "@/lib/queries/sales";

const CARD: React.CSSProperties = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: "var(--glass-shadow), var(--glass-inner)",
};

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-MV", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtShort(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

/* ─── COD Reconciliation ──────────────────────────────────────────────────── */

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
  const today     = new Date().toISOString().slice(0, 10);
  const [date, setDate]               = useState(today);
  const [rows, setRows]               = useState<CodReconRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState<string | null>(null);
  const [drillRows, setDrillRows]     = useState<CodOrderRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [customDate, setCustomDate]   = useState(false);

  // Monthly COD summary (current month, all days)
  const [monthRows, setMonthRows]         = useState<CodReconRow[]>([]);
  const [monthLoading, setMonthLoading]   = useState(true);

  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  const monthStart = firstOfMonth.toISOString().slice(0, 10);

  useEffect(() => {
    // Load today's reconciliation
    setLoading(true);
    getCodReconciliation(date)
      .then(setRows)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => {
    // Load month summary — we reuse the same RPC with today's date and
    // derive a rough monthly picture from the single-day data structure.
    // Since the RPC only accepts a single date, we load today's as the
    // "current day" view. Monthly aggregate would need a new RPC — we
    // surface what we have with clear labelling.
    setMonthLoading(false);
    setMonthRows([]); // placeholder — would need get_cod_monthly RPC
  }, [monthStart]);

  async function toggleDriver(driverId: string) {
    if (expanded === driverId) { setExpanded(null); setDrillRows([]); return; }
    setExpanded(driverId);
    setDrillLoading(true);
    try {
      setDrillRows(await getCodOrdersForDriver(driverId, date));
    } catch (e) { toast.error((e as Error).message); }
    finally { setDrillLoading(false); }
  }

  const totalExpected  = rows.reduce((a, r) => a + Number(r.expected_mvr), 0);
  const totalCollected = rows.reduce((a, r) => a + Number(r.collected_mvr), 0);
  const totalVariance  = totalCollected - totalExpected;
  const totalPending   = rows.reduce((a, r) => a + Number(r.pending_deposit_mvr), 0);
  const hasIssue       = rows.some((r) => r.recon_status !== "balanced" && r.recon_status !== "pending_deposit");

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── Date chips ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"] }}>
          {[
            { label: "Today",     val: today },
            { label: "Yesterday", val: (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })() },
          ].map(({ label, val }) => {
            const active = date === val && !customDate;
            return (
              <button key={label} onClick={() => { setDate(val); setCustomDate(false); }}
                style={{ flexShrink: 0, minHeight: 44, padding: "0 18px", borderRadius: 22, cursor: "pointer", touchAction: "manipulation",
                  background: active ? "var(--foreground)" : "var(--glass-1)",
                  color: active ? "var(--background)" : "var(--muted-foreground)",
                  border: active ? "none" : "0.5px solid var(--glass-border-lo)",
                  fontSize: 13, fontWeight: 600 }}
              >{label}</button>
            );
          })}
          <button onClick={() => setCustomDate(true)}
            style={{ flexShrink: 0, minHeight: 44, padding: "0 18px", borderRadius: 22, cursor: "pointer", touchAction: "manipulation",
              background: customDate ? "var(--foreground)" : "var(--glass-1)",
              color: customDate ? "var(--background)" : "var(--muted-foreground)",
              border: customDate ? "none" : "0.5px solid var(--glass-border-lo)",
              fontSize: 13, fontWeight: 600 }}
          >Custom</button>
        </div>
        {customDate && (
          <div style={{ marginTop: 10 }}>
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)}
              style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 12, height: 44, padding: "0 14px", color: "var(--foreground)", fontSize: 14, outline: "none", cursor: "pointer", width: "100%" }} />
          </div>
        )}
      </div>

      {/* ── Daily summary strip ── */}
      {rows.length > 0 && (
        <div style={{ ...CARD, borderRadius: 16, padding: 20, marginBottom: 12 }}>
          {/* Label */}
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>
            Cash Summary — {date === today ? "Today" : date}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20 }}>
            {[
              { label: "Expected",        value: `MVR ${fmt(totalExpected)}`,  color: "var(--foreground)" },
              { label: "Collected",       value: `MVR ${fmt(totalCollected)}`, color: Math.abs(totalVariance) < 0.01 ? "var(--snm-success)" : "var(--snm-error)" },
              { label: "Variance",        value: `${totalVariance >= 0 ? "+" : ""}MVR ${fmt(totalVariance)}`, color: Math.abs(totalVariance) < 0.01 ? "var(--snm-success)" : "var(--snm-error)" },
              { label: "Pending Deposit", value: `MVR ${fmt(totalPending)}`,   color: totalPending > 0 ? "var(--snm-warning)" : "var(--snm-success)" },
            ].map((s) => (
              <div key={s.label}>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</p>
                <p style={{ color: s.color, fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.value}</p>
              </div>
            ))}
          </div>
          {hasIssue && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "0.5px solid var(--glass-border-lo)" }}>
              <AlertTriangle style={{ color: "var(--snm-error)", width: 14, height: 14, flexShrink: 0 }} />
              <p style={{ color: "var(--snm-error)", fontSize: 12 }}>One or more drivers have a cash variance — review below.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Per-driver rows ── */}
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
              <div key={r.driver_id} style={{ ...CARD, borderRadius: 16, overflow: "hidden", border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}>
                <button onClick={() => toggleDriver(r.driver_id)}
                  style={{ width: "100%", minHeight: 64, padding: "14px 20px", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `color-mix(in srgb, ${color} 14%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Banknote style={{ width: 16, height: 16, color }} />
                    </div>
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.driver_name}</p>
                      <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{r.orders_count} order{r.orders_count !== 1 ? "s" : ""} · {statusLabel(r.recon_status)}</p>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
                    <div>
                      <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>MVR {fmt(Number(r.collected_mvr))}</p>
                      {Math.abs(Number(r.variance_mvr)) >= 0.01 && (
                        <p style={{ color, fontSize: 11, fontWeight: 600 }}>{Number(r.variance_mvr) >= 0 ? "+" : ""}MVR {fmt(Number(r.variance_mvr))} variance</p>
                      )}
                    </div>
                    {isOpen
                      ? <ChevronDown style={{ width: 16, height: 16, color: "var(--muted-foreground)" }} />
                      : <ChevronRight style={{ width: 16, height: 16, color: "var(--muted-foreground)" }} />}
                  </div>
                </button>

                {isOpen && (
                  <div style={{ borderTop: "0.5px solid var(--glass-border-lo)", padding: "12px 20px 16px" }}>
                    {drillLoading ? (
                      <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
                        <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--muted-foreground)" }} />
                      </div>
                    ) : drillRows.map((o) => {
                      const variance   = Number(o.collected_mvr) - Number(o.order_total_mvr);
                      const isDeposited = o.payment_status === "deposited";
                      return (
                        <div key={o.order_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 500 }}>{o.customer_name}</p>
                            <p style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
                              {o.order_number} · {new Date(o.delivered_at).toLocaleTimeString("en-MV", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>MVR {fmt(Number(o.collected_mvr))}</p>
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
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, marginTop: 4 }}>
                      <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Total collected</p>
                      <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>MVR {fmt(Number(r.collected_mvr))}</p>
                    </div>
                    {Number(r.pending_deposit_mvr) > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                        <p style={{ color: "var(--snm-warning)", fontSize: 12 }}>Awaiting bank deposit</p>
                        <p style={{ color: "var(--snm-warning)", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>MVR {fmt(Number(r.pending_deposit_mvr))}</p>
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

/* ─── Main FinancialsView ─────────────────────────────────────────────────── */

export function FinancialsView() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const initialTab   = searchParams.get("tab") === "cod" ? "cod" : "profit";
  const [tab, setTab] = useState<"profit" | "cod">(initialTab);

  const [rows, setRows]         = useState<ReportRow[]>([]);
  const [expenses, setExpenses] = useState<{ amount_mvr: number }[]>([]);
  const [monthly, setMonthly]   = useState<MonthlyRevenueRow[]>([]);
  const [lastMonthRows, setLastMonthRows] = useState<ReportRow[]>([]);
  const [loading, setLoading]   = useState(true);

  const today          = new Date();
  const firstOfMonth   = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const tomorrow       = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  // Last month range
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
  const lastMonthEnd   = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getReportsData(firstOfMonth, tomorrow),
      listMarketingSpend(),
      getMonthlyRevenue(6),
      getReportsData(lastMonthStart, lastMonthEnd),
    ])
      .then(([r, e, m, lm]) => {
        setRows(r);
        setExpenses(e);
        setMonthly(m);
        setLastMonthRows(lm);
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── This month P&L ──────────────────────────────────────────────────────
  const totalRevenue    = useMemo(() => rows.reduce((a, r) => a + Number(r.total_revenue_mvr), 0), [rows]);
  const totalLandedCost = useMemo(() => rows.reduce((a, r) => a + Number(r.total_landed_cost_mvr), 0), [rows]);
  const totalOpex       = useMemo(() => expenses.reduce((a, e) => a + Number(e.amount_mvr), 0), [expenses]);
  const grossProfit     = totalRevenue - totalLandedCost;
  const netProfit       = grossProfit - totalOpex;
  const grossMarginPct  = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const netMarginPct    = totalRevenue > 0 ? (netProfit  / totalRevenue) * 100 : 0;

  // ── Last month comparison ────────────────────────────────────────────────
  const lastRevenue    = useMemo(() => lastMonthRows.reduce((a, r) => a + Number(r.total_revenue_mvr), 0), [lastMonthRows]);
  const lastLanded     = useMemo(() => lastMonthRows.reduce((a, r) => a + Number(r.total_landed_cost_mvr), 0), [lastMonthRows]);
  const lastGross      = lastRevenue - lastLanded;
  const revDelta       = lastRevenue > 0 ? ((totalRevenue - lastRevenue) / lastRevenue * 100) : null;
  const grossDelta     = lastGross  > 0 ? ((grossProfit  - lastGross)   / lastGross  * 100) : null;

  // ── Top 5 brands by gross profit ─────────────────────────────────────────
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
      .map(([label, v]) => ({ label, ...v, grossProfit: v.revenue - v.cost }))
      .filter((b) => b.revenue > 0)
      .sort((a, b) => b.grossProfit - a.grossProfit)
      .slice(0, 5);
  }, [rows]);

  // ── Chart — Revenue bars only (what the RPC gives us) ────────────────────
  const chartMax = useMemo(() => Math.max(...monthly.map((m) => Number(m.revenue_mvr)), 1), [monthly]);

  // ── Tap-to-value tooltip state ────────────────────────────────────────────
  const [tappedBar, setTappedBar] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-11 rounded-xl" style={{ background: "var(--glass-1)" }} />
        <div className="rounded-2xl p-6 space-y-4" style={{ background: "var(--glass-1)" }}>
          <div className="h-2.5 w-32 rounded-full" style={{ background: "var(--muted)" }} />
          <div className="h-12 w-48 rounded-xl" style={{ background: "var(--muted)" }} />
          <div className="grid grid-cols-3 gap-4 pt-4 border-t" style={{ borderColor: "var(--glass-border-lo)" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-2 w-16 rounded-full" style={{ background: "var(--muted)" }} />
                <div className="h-6 w-20 rounded-lg"  style={{ background: "var(--muted)" }} />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl p-6" style={{ background: "var(--glass-1)" }}>
          <div className="h-2.5 w-48 rounded-full mb-6" style={{ background: "var(--muted)" }} />
          <div className="flex items-end gap-3 h-24">
            {[60, 80, 45, 90, 70, 55].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-lg" style={{ height: `${h}%`, background: "var(--muted)" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const monthName = today.toLocaleString("en-MV", { month: "long" });

  return (
    <div style={{ background: "var(--background)", minHeight: "100vh", padding: "0 0 120px 0" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <p className="label-caps text-[11px] mb-1" style={{ color: "var(--muted-foreground)" }}>Finance</p>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Financials</h1>
      </div>

      {/* ── Tab switcher ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "var(--glass-1)", backdropFilter: "blur(20px)", padding: 4, borderRadius: 14, border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}>
        {([
          { key: "profit", label: "P&L" },
          { key: "cod",    label: "COD Cash" },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ flex: 1, padding: "9px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.15s",
              background: tab === t.key ? "var(--foreground)" : "transparent",
              color:      tab === t.key ? "var(--background)" : "var(--muted-foreground)" }}
          >{t.label}</button>
        ))}
      </div>

      {/* ── COD tab ── */}
      {tab === "cod" && <CodView />}

      {/* ── P&L tab ── */}
      {tab === "profit" && <>

        {/* ── 1. P&L Waterfall card ── */}
        <section style={{ ...CARD, borderRadius: 16, padding: 24, marginBottom: 12 }}>

          {/* Period label */}
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>
            {monthName} — Month to Date
          </p>

          {/* Revenue row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Sales Revenue</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              {revDelta !== null && (
                <span style={{ fontSize: 11, fontWeight: 600, color: revDelta >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                  {revDelta >= 0 ? "▲" : "▼"} {Math.abs(revDelta).toFixed(1)}% vs last month
                </span>
              )}
              <p style={{ color: "var(--foreground)", fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>MVR {fmtShort(totalRevenue)}</p>
            </div>
          </div>

          {/* Landed cost row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>− Landed Cost (COGS)</p>
            <p style={{ color: "var(--muted-foreground)", fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>MVR {fmtShort(totalLandedCost)}</p>
          </div>

          {/* Gross profit divider */}
          <div style={{ borderTop: "0.5px solid var(--glass-border-lo)", marginTop: 12, marginBottom: 12 }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
            <div>
              <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 700 }}>Gross Profit</p>
              <p style={{ color: grossMarginPct >= 20 ? "var(--snm-success)" : grossMarginPct >= 10 ? "var(--snm-warning)" : "var(--snm-error)", fontSize: 11, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                {grossMarginPct.toFixed(1)}% gross margin
                {grossDelta !== null && (
                  <span style={{ marginLeft: 8, color: grossDelta >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                    {grossDelta >= 0 ? "▲" : "▼"} {Math.abs(grossDelta).toFixed(1)}% vs last month
                  </span>
                )}
              </p>
            </div>
            <p style={{ color: grossProfit >= 0 ? "var(--foreground)" : "var(--snm-error)", fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>MVR {fmtShort(grossProfit)}</p>
          </div>

          {/* Marketing spend row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>− Marketing Spend</p>
            <p style={{ color: "var(--muted-foreground)", fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>MVR {fmtShort(totalOpex)}</p>
          </div>

          {/* Net profit divider */}
          <div style={{ borderTop: "0.5px solid var(--glass-border-lo)", marginTop: 12, marginBottom: 12 }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 700 }}>Net Profit</p>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                {netProfit >= 0
                  ? <TrendingUp  style={{ color: "var(--snm-success)", width: 14, height: 14 }} />
                  : <TrendingDown style={{ color: "var(--snm-error)",   width: 14, height: 14 }} />}
                <span style={{ color: netProfit >= 0 ? "var(--snm-success)" : "var(--snm-error)", fontSize: 12, fontWeight: 600 }}>
                  {netMarginPct >= 0 ? "+" : ""}{netMarginPct.toFixed(1)}% net margin
                </span>
              </div>
              <p style={{ color: "var(--muted-foreground)", fontSize: 10, marginTop: 2 }}>Revenue − COGS − Marketing</p>
            </div>
            <p style={{ color: netProfit >= 0 ? "var(--foreground)" : "var(--snm-error)", fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              MVR {fmtShort(netProfit)}
            </p>
          </div>
        </section>

        {/* ── 2. Revenue trend — 6 months with tap-to-see-value ── */}
        <div style={{ ...CARD, borderRadius: 16, padding: 24, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Revenue — Last 6 Months
              </p>
              <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 2 }}>Tap a bar for exact value</p>
            </div>
          </div>

          {monthly.length === 0 ? (
            <p style={{ color: "var(--muted-foreground)", fontSize: 14, textAlign: "center", padding: "24px 0" }}>No data yet.</p>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120 }}>
                {monthly.map((m) => {
                  const revH      = chartMax > 0 ? Math.max((Number(m.revenue_mvr) / chartMax) * 100, 4) : 4;
                  const isCurrent = m.month_start.slice(0, 7) === today.toISOString().slice(0, 7);
                  const isTapped  = tappedBar === m.month_start;
                  return (
                    <div key={m.month_start} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      {/* Value label on tap */}
                      <p style={{ fontSize: 10, fontWeight: 700, color: "var(--foreground)", opacity: isTapped ? 1 : 0, transition: "opacity 0.15s", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                        {fmtShort(Number(m.revenue_mvr))}
                      </p>
                      <div style={{ width: "100%", height: 96, display: "flex", alignItems: "flex-end" }}>
                        <button
                          onClick={() => setTappedBar(isTapped ? null : m.month_start)}
                          style={{ width: "100%", height: `${revH}%`, minHeight: 4,
                            background: isCurrent ? "var(--foreground)" : isTapped ? "var(--foreground)" : "color-mix(in srgb, var(--foreground) 35%, transparent)",
                            borderRadius: "4px 4px 0 0", border: "none", cursor: "pointer",
                            transition: "background 0.15s, height 0.2s", touchAction: "manipulation" }}
                          aria-label={`${m.month_label}: MVR ${fmtShort(Number(m.revenue_mvr))}`}
                        />
                      </div>
                      <span style={{ color: isCurrent ? "var(--foreground)" : "var(--muted-foreground)", fontSize: 11, fontWeight: isCurrent ? 700 : 400 }}>{m.month_label}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTop: "0.5px solid var(--glass-border-lo)" }}>
                <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>MVR 0</span>
                <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Peak: MVR {fmtShort(chartMax)}</span>
              </div>
            </>
          )}
        </div>

        {/* ── 3. Gross Profit by Brand ── */}
        <div style={{ ...CARD, borderRadius: 16, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Gross Profit by Brand
              </p>
              <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 2 }}>{monthName} · top 5 by profit</p>
            </div>
            <button onClick={() => router.push("/reports")}
              style={{ color: "var(--foreground)", background: "none", border: "none", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, padding: "8px 0" }}>
              Full Report <ArrowRight style={{ width: 14, height: 14 }} />
            </button>
          </div>

          {brandMap.length === 0 ? (
            <p style={{ color: "var(--muted-foreground)", fontSize: 14, textAlign: "center", padding: "24px 0" }}>No sales data this month.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {/* Header row */}
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 8, borderBottom: "0.5px solid var(--glass-border-lo)", marginBottom: 4 }}>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Brand</p>
                <div style={{ display: "flex", gap: 40 }}>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Revenue</p>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Gross Profit</p>
                </div>
              </div>

              {brandMap.map((b) => {
                const margin     = b.revenue > 0 ? (b.grossProfit / b.revenue * 100) : 0;
                const barWidth   = brandMap[0].grossProfit > 0 ? (b.grossProfit / brandMap[0].grossProfit * 100) : 0;
                const marginColor = margin >= 20 ? "var(--snm-success)" : margin >= 10 ? "var(--snm-warning)" : "var(--snm-error)";
                return (
                  <div key={b.label} style={{ padding: "14px 0", borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                      <div>
                        <p style={{ color: "var(--foreground)", fontSize: 15, fontWeight: 600 }}>{b.label}</p>
                        <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 1 }}>
                          {b.skuCount} SKU{b.skuCount !== 1 ? "s" : ""} · <span style={{ color: marginColor, fontWeight: 600 }}>{margin.toFixed(1)}% margin</span>
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ color: "var(--muted-foreground)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>MVR {fmt(b.revenue)}</p>
                        <p style={{ color: b.grossProfit >= 0 ? "var(--foreground)" : "var(--snm-error)", fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          MVR {fmt(b.grossProfit)}
                        </p>
                      </div>
                    </div>
                    {/* Profit bar */}
                    <div style={{ height: 4, borderRadius: 2, background: "color-mix(in srgb, var(--foreground) 8%, transparent)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${barWidth}%`, background: marginColor, borderRadius: 2, transition: "width 0.3s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </>}
    </div>
  );
}

"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { mvtFirstOfMonth, mvtInstant, mvtLastMonthRange, mvtToday, mvtTomorrow } from "@/lib/mvt-date";
import {
  Loader2, TrendingUp, TrendingDown, ArrowRight,
  ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Banknote,
} from "lucide-react";
import { getReportsData, getMonthlyRevenue, type ReportRow, type MonthlyRevenueRow } from "@/lib/queries/reports";
import { groupByBrand, type BrandGroup } from "@/lib/group-by-brand";
import { getPnl, getRunningCostsStatus, type PnlRow, type RunningCostsStatus } from "@/lib/queries/expenses";
import Link from "next/link";
import { getCodReconciliation, getCodOrdersForDriver, type CodReconRow, type CodOrderRow } from "@/lib/queries/sales";
import { listRecentWriteoffs, writeoffLabel, type WriteoffRow, listReturns, returnLabel, type ReturnRow } from "@/lib/queries/inventory";
import { MarginWatch } from "./margin-watch";
import { ReceivablesView } from "./receivables-view";
import { CashFlowView } from "./cash-flow-view";
import { CARD } from "@/lib/surfaces";
import { mvr, mvrShort } from "@/lib/money";


const fmt = mvr;
const fmtShort = mvrShort;

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


/* ── A P&L line that opens ──────────────────────────────────────────────────
   Operating Expenses, write-offs and returns already broke themselves down
   inline on this card; Revenue and COGS — the two largest numbers on the
   screen — did not. Tapping them now shows where the figure came from, by
   brand, using the same indent as the lines that already do it.

   TWO RULES THIS OBEYS, BOTH LOAD-BEARING:

   1. NO MONEY MATH HERE. The total shown is always the one get_pnl returned.
      The sub-lines are per-SKU revenue and landed cost that Postgres already
      computed (get_reports_data), rolled up by brand by groupByBrand, which
      sums audited numbers and derives nothing.

   2. A DRILL-DOWN THAT DOES NOT TIE IS A BUG, AND MUST SAY SO. The two RPCs
      agree to the cent today — checked against production: revenue
      15,482.99 = 15,482.99, COGS 9,942.85 = 9,942.85 — but they are separate
      functions and could drift apart in a future migration. If the parts stop
      adding up to the total, the difference is shown rather than swallowed.
      Silently displaying a breakdown that contradicts its own heading is how
      people stop trusting a report entirely. */
function PnlBreakdown({ groups, total, pick }: {
  groups: BrandGroup[];
  total: number;
  pick: (g: BrandGroup) => number;
}) {
  const shown = groups.filter((g) => Math.abs(pick(g)) > 0.005)
                      .sort((a, b) => Math.abs(pick(b)) - Math.abs(pick(a)));
  const summed = shown.reduce((a, g) => a + pick(g), 0);
  const gap = total - summed;

  if (shown.length === 0) {
    return (
      <p style={{ color: "var(--muted-foreground)", fontSize: 12, paddingLeft: 14, marginBottom: 6 }}>
        Nothing recorded in this period.
      </p>
    );
  }
  return (
    <>
      {shown.map((g) => (
        <div key={g.brand} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 2, paddingLeft: 14 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.brand}</p>
          <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 13, flexShrink: 0 }}>MVR {fmt(pick(g), 2)}</p>
        </div>
      ))}
      {Math.abs(gap) > 0.02 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 2, paddingLeft: 14 }}>
          <p style={{ color: "var(--snm-warning)", fontSize: 12 }}>Not attributed to a brand</p>
          <p className="snm-num" style={{ color: "var(--snm-warning)", fontSize: 12, flexShrink: 0 }}>MVR {fmt(gap, 2)}</p>
        </div>
      )}
    </>
  );
}

function CodView() {
  // Memoised: reading the clock during render is impure (React Compiler).
  const today     = useMemo(() => mvtToday(), []);
  const yesterday = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 1); return mvtToday(d); }, []);
  const [date, setDate]               = useState(today);
  const [rows, setRows]               = useState<CodReconRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState<string | null>(null);
  const [drillRows, setDrillRows]     = useState<CodOrderRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [customDate, setCustomDate]   = useState(false);

  useEffect(() => {
    // Load today's reconciliation (initial state is the skeleton; date
    // changes swap in place without flashing it again). Guarded against a
    // stale response landing after the date changed again or the user
    // navigated away — otherwise a cancelled fetch can toast a ghost error
    // (iOS Safari renders an aborted fetch as "TypeError: Load failed").
    let cancelled = false;
    getCodReconciliation(date)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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
            { label: "Yesterday", val: yesterday },
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
              style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 12, height: 44, padding: "0 14px", color: "var(--foreground)", fontSize: 14, outline: "none", cursor: "pointer", width: "100%" }} />
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
          <div className="grid grid-cols-2 gap-5">
            {[
              { label: "Expected",        value: `MVR ${fmt(totalExpected)}`,  color: "var(--foreground)" },
              { label: "Collected",       value: `MVR ${fmt(totalCollected)}`, color: Math.abs(totalVariance) < 0.01 ? "var(--snm-success)" : "var(--snm-error)" },
              { label: "Variance",        value: `${totalVariance >= 0 ? "+" : ""}MVR ${fmt(totalVariance)}`, color: Math.abs(totalVariance) < 0.01 ? "var(--snm-success)" : "var(--snm-error)" },
              { label: "Pending Deposit", value: `MVR ${fmt(totalPending)}`,   color: totalPending > 0 ? "var(--snm-warning)" : "var(--snm-success)" },
            ].map((s) => (
              <div key={s.label}>
                <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 5 }}>{s.label}</p>
                <p style={{ color: s.color, fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>{s.value}</p>
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
                        <p style={{ color, fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{Number(r.variance_mvr) >= 0 ? "+" : ""}MVR {fmt(Number(r.variance_mvr))} variance</p>
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
                            <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 13 }}>
                              {o.order_number} · {mvtInstant(o.delivered_at, { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>MVR {fmt(Number(o.collected_mvr))}</p>
                              {isDeposited
                                ? <CheckCircle2 style={{ width: 14, height: 14, color: "var(--snm-success)" }} />
                                : <span style={{ fontSize: 12, fontWeight: 700, color: "var(--snm-warning)", background: "color-mix(in srgb, var(--snm-warning) 20%, transparent)", padding: "3px 7px", borderRadius: 5 }}>NOT DEPOSITED</span>}
                            </div>
                            {Math.abs(variance) >= 0.01 && (
                              <p className="snm-num" style={{ color: variance < 0 ? "var(--snm-error)" : "var(--snm-warning)", fontSize: 13 }}>
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
  const tabParam     = searchParams.get("tab");
  const initialTab   = tabParam === "cod" ? "cod" : tabParam === "owed" ? "owed" : tabParam === "cash" ? "cash" : "profit";
  const [tab, setTab] = useState<"profit" | "cod" | "owed" | "cash">(initialTab);

  const [rows, setRows]         = useState<ReportRow[]>([]);
  const [pnl, setPnl]           = useState<PnlRow | null>(null);
  const [lastPnl, setLastPnl]   = useState<PnlRow | null>(null);
  const [monthly, setMonthly]   = useState<MonthlyRevenueRow[]>([]);
  const [writeoffs, setWriteoffs] = useState<WriteoffRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [runningCosts, setRunningCosts] = useState<RunningCostsStatus | null>(null);
  const [loading, setLoading]   = useState(true);

  // Maldives calendar, not the device's. These used to be built from local
  // midnight and then serialised via toISOString(), which in Malé (UTC+5)
  // resolves to the PREVIOUS day — so "this month" began on the last day of
  // last month and quietly absorbed that day's sales, costs and write-offs.
  // Maldives "now" for month labels — shifting by the offset makes the UTC
  // getters read as Maldives wall-clock, so the month name and the
  // current-month highlight can't drift a day either.
  const { today, firstOfMonth, tomorrow, lastMonthStart, lastMonthEnd } = useMemo(() => {
    const lm = mvtLastMonthRange();
    return {
      // Shifting by the offset makes the UTC getters read as Maldives
      // wall-clock, so the month name and current-month highlight can't
      // drift a day either.
      today: new Date(new Date().getTime() + 5 * 60 * 60 * 1000),
      firstOfMonth: mvtFirstOfMonth(),
      tomorrow: mvtTomorrow(),
      lastMonthStart: lm.start,
      lastMonthEnd: lm.end,
    };
  }, []);

  useEffect(() => {
    // Guarded against a fast tab-switch away before this resolves — an
    // abandoned/cancelled fetch can still reject after the user has left
    // (iOS Safari: "TypeError: Load failed"), which without this guard
    // would toast a ghost error on whatever screen they've moved to.
    let cancelled = false;
    Promise.all([
      // The whole P&L (incl. period-correct marketing proration and the
      // opex category breakdown) is one Postgres call — no financial math
      // in the client. rows is kept only for the per-brand table.
      getPnl(firstOfMonth, tomorrow),
      getPnl(lastMonthStart, lastMonthEnd),
      getReportsData(firstOfMonth, tomorrow),
      getMonthlyRevenue(6),
      // Same period as the P&L, so the write-off sub-lines always add up to
      // the total shown on the "Damaged & write-offs" line.
      listRecentWriteoffs(50, firstOfMonth, tomorrow).catch(() => [] as WriteoffRow[]),
      listReturns(50, firstOfMonth, tomorrow).catch(() => [] as ReturnRow[]),
      // Does THIS period's profit have this period's running costs behind it?
      // Same window as the P&L above, deliberately — asking about a different
      // window is how a figure quietly stops matching its own label (0168).
      getRunningCostsStatus(firstOfMonth, tomorrow).catch(() => null),
    ])
      .then(([p, lp, r, m, w, rt, rc]) => {
        if (cancelled) return;
        setPnl(p);
        setLastPnl(lp);
        setRows(r);
        setMonthly(m);
        setWriteoffs(w);
        setReturns(rt);
        setRunningCosts(rc);
      })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── This month P&L (all figures straight from get_pnl) ──────────────────
  const totalRevenue    = Number(pnl?.revenue_mvr ?? 0);
  const totalLandedCost = Number(pnl?.cogs_mvr ?? 0);
  const grossProfit     = Number(pnl?.gross_profit_mvr ?? 0);
  const marketingSpend  = Number(pnl?.marketing_mvr ?? 0);
  const otherOpex       = Number(pnl?.other_opex_mvr ?? 0);
  const stockWriteoff   = Number(pnl?.stock_writeoff_mvr ?? 0);
  const returnsNet      = Number(pnl?.returns_net_mvr ?? 0);
  const netProfit       = Number(pnl?.net_profit_mvr ?? 0);
  // Whether the bottom line is entitled to call itself NET profit. Defaults to
  // TRUE while loading so the screen never flashes the alarming state and then
  // takes it back — a figure that changes its own claim mid-render is worse
  // than either version of it.
  const costsKnown      = runningCosts === null ? true : runningCosts.has_costs;
  const grossMarginPct  = Number(pnl?.gross_margin_pct ?? 0);
  const netMarginPct    = Number(pnl?.net_margin_pct ?? 0);
  const opexBreakdown   = pnl?.opex_by_category ?? [];

  // ── Last month comparison ────────────────────────────────────────────────
  const lastRevenue    = Number(lastPnl?.revenue_mvr ?? 0);
  const lastGross      = Number(lastPnl?.gross_profit_mvr ?? 0);
  const revDelta       = lastRevenue > 0 ? ((totalRevenue - lastRevenue) / lastRevenue * 100) : null;
  const grossDelta     = lastGross  > 0 ? ((grossProfit  - lastGross)   / lastGross  * 100) : null;

  // ── Top 5 brands by gross profit (with SKU drill-down) ───────────────────
  // Shared brand aggregation (lib/group-by-brand) — same trusted sums used by
  // Reports, so the two pages always agree. Display-only; no cost recomputed.
  const brandMap = useMemo(
    () => groupByBrand(rows).filter((b) => b.revenue > 0).slice(0, 5),
    [rows],
  );

  // EVERY brand, unsliced and unfiltered — this feeds the Revenue and COGS
  // drill-downs. brandMap above is deliberately the top 5 for the brand card;
  // reusing it here would drop the tail and manufacture a reconciliation gap
  // that says money is unaccounted for when it simply was not shown.
  const brandGroups = useMemo(() => groupByBrand(rows), [rows]);

  // Which P&L line is currently opened. One at a time: two open breakdowns on
  // a phone push the bottom line off the screen, and the bottom line is the
  // reason the card exists.
  const [openLine, setOpenLine] = useState<"revenue" | "cogs" | null>(null);

  // Which brand's SKUs are expanded in the "Gross Profit by Brand" card.
  const [openBrand, setOpenBrand] = useState<string | null>(null);

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
    <div style={{ padding: "0 0 120px 0" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Finance</p>
        <h1 className="ios-page-title">Financials</h1>
      </div>

      {/* ── Tab switcher ── */}
      <div className="glass-panel" style={{ display: "flex", gap: 6, marginBottom: 20, padding: 4, borderRadius: 14 }}>
        {([
          { key: "profit", label: "P&L" },
          { key: "cash",   label: "Cash Flow" },
          { key: "owed",   label: "Owed" },
          { key: "cod",    label: "COD Cash" },
        ] as const).map((t) => (
          // nowrap + tighter side padding: at 393pt "Cash Flow" and "COD Cash"
          // each broke onto two lines, so the strip stood twice as tall as it
          // should and the four tabs no longer read as one control.
          <button key={t.key} onClick={() => setTab(t.key)}
            // minHeight 44: the strip was 37px. The nowrap note above still
            // holds — this makes the box taller, never the label wider.
            style={{ flex: 1, minHeight: 44, padding: "9px 4px", borderRadius: 10, border: "none", cursor: "pointer",
              fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", transition: "all 0.15s",
              background: tab === t.key ? "var(--glass-accent)" : "transparent",
              color:      tab === t.key ? "var(--snm-brand-on)" : "var(--muted-foreground)" }}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Cash-flow forecast ── */}
      {tab === "cash" && <CashFlowView />}

      {/* ── COD tab ── */}
      {tab === "cod" && <CodView />}

      {/* ── Receivables aging ── */}
      {tab === "owed" && <ReceivablesView />}

      {/* ── P&L tab ── */}
      {tab === "profit" && <>

        {/* ── 0. Margin watch — prices below cost, and stock with no price ──
            The price review used to sit above this, and Ali asked the right
            question about it: *"Is financials the proper place to have this?"*
            No. Financials is a REPORT — he comes here to look at what happened.
            A price review is a TASK: one arrival triggers it, and it finishes.
            It lives on the shipment now, with a row on the daily list pointing
            at it (0216). Margin Watch stays because it is genuinely a report —
            a standing watch on prices below cost, with no end. */}
        <MarginWatch />

        {/* ── 1. P&L Waterfall card ── */}
        <section style={{ ...CARD, borderRadius: 16, padding: 24, marginBottom: 12 }}>

          {/* Period label */}
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>
            {monthName} — Month to Date
          </p>

          {/* Revenue row — opens to show which brands it came from. Whole row is
              the target (44pt), so it is reachable one-handed on a phone. */}
          <button
            type="button"
            onClick={() => setOpenLine(openLine === "revenue" ? null : "revenue")}
            aria-expanded={openLine === "revenue"}
            aria-label="Sales Revenue — show breakdown by brand"
            style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 10, minHeight: 44, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Sales Revenue</p>
              {openLine === "revenue"
                ? <ChevronDown  style={{ width: 13, height: 13, color: "var(--muted-foreground)", flexShrink: 0 }} />
                : <ChevronRight style={{ width: 13, height: 13, color: "var(--muted-foreground)", flexShrink: 0 }} />}
            </span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              {revDelta !== null && (
                <span style={{ fontSize: 11, fontWeight: 600, color: revDelta >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                  {revDelta >= 0 ? "▲" : "▼"} {Math.abs(revDelta).toFixed(1)}% vs last month
                </span>
              )}
              <p style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>MVR {fmtShort(totalRevenue)}</p>
            </span>
          </button>
          {openLine === "revenue" && (
            <div style={{ marginBottom: 6 }}>
              <PnlBreakdown groups={brandGroups} total={totalRevenue} pick={(g) => g.revenue} />
            </div>
          )}

          {/* Landed cost row — same, by brand. */}
          <button
            type="button"
            onClick={() => setOpenLine(openLine === "cogs" ? null : "cogs")}
            aria-expanded={openLine === "cogs"}
            aria-label="Landed Cost COGS — show breakdown by brand"
            style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 10, minHeight: 44, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>− Landed Cost (COGS)</p>
              {openLine === "cogs"
                ? <ChevronDown  style={{ width: 13, height: 13, color: "var(--muted-foreground)", flexShrink: 0 }} />
                : <ChevronRight style={{ width: 13, height: 13, color: "var(--muted-foreground)", flexShrink: 0 }} />}
            </span>
            <p style={{ color: "var(--muted-foreground)", fontSize: 16, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>MVR {fmtShort(totalLandedCost)}</p>
          </button>
          {openLine === "cogs" && (
            <div style={{ marginBottom: 6 }}>
              <PnlBreakdown groups={brandGroups} total={totalLandedCost} pick={(g) => g.landedCost} />
            </div>
          )}

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

          {/* Marketing spend row — prorated to this month by get_pnl */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>− Marketing Spend</p>
            <p style={{ color: "var(--muted-foreground)", fontSize: 16, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>MVR {fmtShort(marketingSpend)}</p>
          </div>

          {/* Operating expenses — rent, salaries, utilities… by category */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: opexBreakdown.length ? 4 : 6 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>− Operating Expenses</p>
            <p style={{ color: "var(--muted-foreground)", fontSize: 16, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>MVR {fmtShort(otherOpex)}</p>
          </div>
          {opexBreakdown.map((c) => (
            <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2, paddingLeft: 14 }}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{c.name}</p>
              <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 13 }}>MVR {fmt(Number(c.amount))}</p>
            </div>
          ))}
          {otherOpex === 0 && (
            <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginBottom: 6 }}>
              No expenses logged this month — add rent, salaries etc. in Expenses so this number is real.
            </p>
          )}

          {/* Damaged & write-offs — landed cost of stock removed as unsellable.
              Only shown when there's something to show (quiet when zero). */}
          {/* Damaged & write-offs — explains itself right here, exactly like the
              Operating Expenses categories above: the total, then one indented
              line per write-off (product · qty · reason). No navigation. */}
          {stockWriteoff > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: writeoffs.length ? 4 : 6 }}>
                <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>− Damaged &amp; write-offs</p>
                <p className="snm-num" style={{ color: "var(--snm-error)", fontSize: 16, fontWeight: 500 }}>MVR {fmtShort(stockWriteoff)}</p>
              </div>
              {writeoffs.slice(0, 6).map((w) => (
                <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 2, paddingLeft: 14 }}>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{writeoffLabel(w)}</p>
                  <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 13, flexShrink: 0 }}>MVR {fmt(Number(w.cost_mvr))}</p>
                </div>
              ))}
              {writeoffs.length > 6 && (
                <p style={{ color: "var(--muted-foreground)", fontSize: 12, paddingLeft: 14, marginBottom: 4 }}>
                  +{writeoffs.length - 6} more this month
                </p>
              )}
            </>
          )}

          {/* Returns & refunds — same self-explaining pattern: the net cost
              (money back minus the goods that came back), then what they were. */}
          {returnsNet !== 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: returns.length ? 4 : 6 }}>
                <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>− Returns &amp; refunds</p>
                <p className="snm-num" style={{ color: "var(--snm-error)", fontSize: 16, fontWeight: 500 }}>MVR {fmtShort(returnsNet)}</p>
              </div>
              {returns.slice(0, 6).map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 2, paddingLeft: 14 }}>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{returnLabel(r)}</p>
                  <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 13, flexShrink: 0 }}>MVR {fmt(Number(r.net_loss_mvr))}</p>
                </div>
              ))}
              {returns.length > 6 && (
                <p style={{ color: "var(--muted-foreground)", fontSize: 12, paddingLeft: 14, marginBottom: 4 }}>
                  +{returns.length - 6} more this month
                </p>
              )}
            </>
          )}

          {/* ── The bottom line, and how complete it is ─────────────────────
              This figure was showing MVR 13,790 in confident green with ZERO
              operating expenses behind it — no rent, no salaries, no fuel —
              because business_expenses held one row in the app's whole life.
              Ali has nowhere else to read his profit from, and 32px bold green
              reads as fact.

              THE LABEL STAYS "NET PROFIT". Ali, 2026-08-10: "Don't change the
              finance or account terms like cogs net profit etc. you should
              leave as it is. Always use correct terms where applicable." He is
              right, and an earlier version of this block got it wrong by
              renaming the line to "Profit before running costs". COGS, Gross
              Profit and Net Profit are what his accountant, his bank and every
              finance system use; paraphrasing them leaves him less able to talk
              to those people, not more. The correct term is the term.

              So the incompleteness is carried by a NOTE and by restraint in the
              styling — not by renaming a standard subtotal. The old screen did
              warn, in 12px grey under the number, which inverted visual weight
              against reliability. Now the caveat sits at --foreground beside the
              term, the number holds back its confident green until the expenses
              exist, and the fix is one tap away. No figure changes. */}
          <div style={{ borderTop: "0.5px solid var(--glass-border-lo)", marginTop: 12, marginBottom: 12 }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 700 }}>
                Net Profit
              </p>
              {costsKnown ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  {netProfit >= 0
                    ? <TrendingUp  style={{ color: "var(--snm-success)", width: 14, height: 14 }} />
                    : <TrendingDown style={{ color: "var(--snm-error)",   width: 14, height: 14 }} />}
                  <span style={{ color: netProfit >= 0 ? "var(--snm-success)" : "var(--snm-error)", fontSize: 12, fontWeight: 600 }}>
                    {netMarginPct >= 0 ? "+" : ""}{netMarginPct.toFixed(1)}% net margin
                  </span>
                </div>
              ) : (
                <p style={{ color: "var(--foreground)", opacity: 0.85, fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                  No operating expenses recorded this period — rent, salaries and
                  fuel are not deducted yet, so the real figure is lower.
                </p>
              )}
              <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 3 }}>
                Revenue − COGS{marketingSpend > 0 ? " − Marketing" : ""}
                {costsKnown ? " − Operating Expenses" : ""}
                {stockWriteoff > 0 ? " − Write-offs" : ""}{returnsNet !== 0 ? " − Returns" : ""}
              </p>
              {!costsKnown && (
                <Link
                  href="/expenses"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8,
                    height: 36, padding: "0 14px", borderRadius: 12,
                    background: "var(--foreground)", color: "var(--background)",
                    fontSize: 13, fontWeight: 600, textDecoration: "none",
                  }}
                >
                  Add operating expenses
                </Link>
              )}
            </div>
            <p style={{
              color: netProfit < 0 ? "var(--snm-error)" : "var(--foreground)",
              opacity: costsKnown ? 1 : 0.75,
              fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums", flexShrink: 0,
            }}>
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
              {/* Plot area: bars sit on a 0-baseline, with a faint peak gridline
                  at the top so a lone tall bar has a reference to read against. */}
              <div style={{ position: "relative", height: 96, marginBottom: 4 }}>
                {/* Peak gridline (top of plot = chartMax) */}
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 0, borderTop: "0.5px dashed var(--glass-border-lo)" }} />
                {/* Zero baseline (bottom of plot) */}
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 0, borderTop: "1px solid color-mix(in srgb, var(--foreground) 14%, transparent)" }} />
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: "100%" }}>
                  {monthly.map((m) => {
                    const rev       = Number(m.revenue_mvr);
                    const isEmpty   = rev <= 0;
                    const revH      = chartMax > 0 && !isEmpty ? Math.max((rev / chartMax) * 100, 6) : 0;
                    const isCurrent = m.month_start.slice(0, 7) === today.toISOString().slice(0, 7);
                    const isTapped  = tappedBar === m.month_start;
                    return (
                      // THE TARGET IS THE MONTH, NOT THE INK.
                      //
                      // The bar itself used to be the button, so a month with
                      // no revenue was a 45x6 dashed sliver and a small month
                      // barely more — you had to hit the drawing to read its
                      // value. The whole column is the button now: 45x96,
                      // always, whatever the bar happens to be worth. This is
                      // the standard way a bar chart takes a tap, and it is
                      // the one change here that makes something genuinely
                      // easier rather than merely compliant.
                      <button
                        key={m.month_start}
                        onClick={() => setTappedBar(isTapped ? null : m.month_start)}
                        aria-label={isEmpty
                          ? `${m.month_label}: no revenue`
                          : `${m.month_label}: MVR ${fmtShort(rev)}`}
                        style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end",
                          background: "transparent", border: "none", padding: 0,
                          cursor: "pointer", touchAction: "manipulation" }}
                      >
                        {/* Empty month → a short "ghost" placeholder that reads as
                            no-data, not a broken tiny bar. */}
                        {isEmpty ? (
                          <div
                            style={{ width: "100%", height: 6,
                              borderTop: "1.5px dashed color-mix(in srgb, var(--foreground) 18%, transparent)" }}
                          />
                        ) : (
                          <div style={{ position: "relative", width: "100%", height: `${revH}%` }}>
                            {/* Value label on tap, floating above the bar */}
                            <p style={{ position: "absolute", bottom: "100%", left: 0, right: 0, textAlign: "center", marginBottom: 4, fontSize: 10, fontWeight: 700, color: "var(--foreground)", opacity: isTapped ? 1 : 0, transition: "opacity 0.15s", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}>
                              {fmtShort(rev)}
                            </p>
                            <div
                              style={{ width: "100%", height: "100%",
                                background: isCurrent || isTapped ? "var(--foreground)" : "color-mix(in srgb, var(--foreground) 35%, transparent)",
                                borderRadius: "4px 4px 0 0",
                                transition: "background 0.15s, height 0.2s" }}
                            />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {monthly.map((m) => {
                  const isCurrent = m.month_start.slice(0, 7) === today.toISOString().slice(0, 7);
                  return (
                    <span key={m.month_start} style={{ flex: 1, textAlign: "center", color: isCurrent ? "var(--foreground)" : "var(--muted-foreground)", fontSize: 11, fontWeight: isCurrent ? 700 : 400 }}>{m.month_label}</span>
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
              style={{ color: "var(--foreground)", background: "none", border: "none", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, minHeight: 44 }}>
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
                const margin     = b.marginPct ?? 0;
                const barWidth   = brandMap[0].grossProfit > 0 ? Math.max(0, b.grossProfit / brandMap[0].grossProfit * 100) : 0;
                const marginCol  = margin >= 20 ? "var(--snm-success)" : margin >= 10 ? "var(--snm-warning)" : "var(--snm-error)";
                const isOpen     = openBrand === b.brand;
                return (
                  <div key={b.brand} style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                    {/* Brand summary — tap to reveal its SKUs */}
                    <button
                      onClick={() => setOpenBrand(isOpen ? null : b.brand)}
                      className="snm-pressable"
                      aria-expanded={isOpen}
                      style={{ width: "100%", textAlign: "left", padding: "14px 0", background: "none", border: "none", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <ChevronDown style={{ width: 16, height: 16, flexShrink: 0, color: "var(--muted-foreground)", transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }} />
                          <div style={{ minWidth: 0 }}>
                            <p style={{ color: "var(--foreground)", fontSize: 15, fontWeight: 600 }}>{b.brand}</p>
                            <p style={{ color: "var(--muted-foreground)", fontSize: 13, marginTop: 1 }}>
                              {b.soldSkuCount} SKU{b.soldSkuCount !== 1 ? "s" : ""} · <span style={{ color: marginCol, fontWeight: 600 }}>{margin.toFixed(1)}% margin</span>
                            </p>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <p style={{ color: "var(--muted-foreground)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>MVR {fmt(b.revenue)}</p>
                          <p style={{ color: b.grossProfit >= 0 ? "var(--foreground)" : "var(--snm-error)", fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                            MVR {fmt(b.grossProfit)}
                          </p>
                        </div>
                      </div>
                      {/* Profit bar */}
                      <div style={{ height: 4, borderRadius: 2, background: "color-mix(in srgb, var(--foreground) 8%, transparent)", overflow: "hidden", marginLeft: 22 }}>
                        <div style={{ height: "100%", width: `${barWidth}%`, background: marginCol, borderRadius: 2, transition: "width 0.3s ease" }} />
                      </div>
                    </button>

                    {/* SKU drill-down */}
                    {isOpen && (
                      <div style={{ paddingBottom: 8 }}>
                        {b.skus.map((s) => (
                          <div key={s.sku_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "8px 0 8px 22px" }}>
                            <div style={{ minWidth: 0 }}>
                              <p style={{ color: "var(--foreground)", fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {s.model_name} · {s.variant_display}
                              </p>
                              <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 13, marginTop: 1 }}>Rev MVR {fmt(s.revenue)}</p>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <p style={{ color: (s.marginPct ?? 0) >= 20 ? "var(--snm-success)" : (s.marginPct ?? 0) >= 10 ? "var(--snm-warning)" : "var(--snm-error)", fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                                MVR {fmt(s.grossProfit)}
                              </p>
                              <p style={{ color: "var(--muted-foreground)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                                {s.marginPct != null ? `${s.marginPct.toFixed(0)}%` : "—"}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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

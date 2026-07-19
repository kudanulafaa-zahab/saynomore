import { getSupabaseServer } from "@/lib/supabase-server";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  Banknote,
  Timer,
  ChevronRight,
  Truck,
  PackageCheck,
  ClipboardList,
  Ship,
  PackageX,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { MorningBriefing } from "@/components/layout/morning-briefing";
import { RevenueTrendChart } from "@/components/dashboard/revenue-trend-chart";
import { MarginCompositionChart } from "@/components/dashboard/margin-composition-chart";

function mvr(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

interface Metrics {
  revenue_today_mvr:           number;
  revenue_this_month_mvr:      number;
  revenue_last_month_mvr:      number;
  gross_profit_this_month_mvr: number;
  gross_margin_pct:            number;
  orders_awaiting_dispatch:    number;
  orders_out_for_delivery:     number;
  orders_dispatched_today:     number;
  orders_delivered_today:      number;
  overdue_orders_count:        number;
  low_stock_sku_count:         number;
  total_stock_value_mvr:       number;
  shipments_in_transit:        number;
  pending_payments_mvr:        number;
  pending_payments_count:      number;
  cod_undeposited_mvr:         number;
  shipments_arriving_soon:     number;
  overstock_sku_count:         number;
  reorder_needed_count:        number;
  slow_stock_value_mvr:        number;
  slow_stock_count:            number;
}

export default async function DashboardPage() {
  const supabase = await getSupabaseServer();

  // Month range for the P&L (net profit). get_pnl is the same audited RPC the
  // Financials page uses, so the dashboard net figure always matches it exactly.
  const nowMv          = new Date();
  const firstOfMonth   = new Date(nowMv.getFullYear(), nowMv.getMonth(), 1).toISOString().slice(0, 10);
  const tomorrow       = new Date(nowMv.getFullYear(), nowMv.getMonth(), nowMv.getDate() + 1).toISOString().slice(0, 10);

  const [{ data }, { data: pnlData }, { data: { user } }, { data: dailyRevenueData }] = await Promise.all([
    supabase.rpc("get_dashboard_metrics"),
    supabase.rpc("get_pnl", { p_from: firstOfMonth, p_to: tomorrow }),
    supabase.auth.getUser(),
    supabase.rpc("get_daily_revenue", { p_days: 7 }),
  ]);

  // First name for a personalised greeting — works for every user, since it
  // reads their own profile. Falls back cleanly to no name if unavailable.
  let firstName = "";
  if (user) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.full_name) firstName = String(profile.full_name).trim().split(/\s+/)[0];
  }

  const pnl         = pnlData?.[0] ?? null;
  const netProfit    = Number(pnl?.net_profit_mvr ?? 0);
  const netMargin    = pnl?.net_margin_pct != null ? Number(pnl.net_margin_pct) : null;
  const pnlCogs      = Number(pnl?.cogs_mvr ?? 0);
  const pnlRevenue   = Number(pnl?.revenue_mvr ?? 0);
  const pnlOtherCosts = Number(pnl?.marketing_mvr ?? 0) + Number(pnl?.other_opex_mvr ?? 0);

  const m: Metrics = (data?.[0] ?? {
    revenue_today_mvr:           0,
    revenue_this_month_mvr:      0,
    revenue_last_month_mvr:      0,
    gross_profit_this_month_mvr: 0,
    gross_margin_pct:            0,
    orders_awaiting_dispatch:    0,
    orders_out_for_delivery:     0,
    orders_dispatched_today:     0,
    orders_delivered_today:      0,
    overdue_orders_count:        0,
    low_stock_sku_count:         0,
    total_stock_value_mvr:       0,
    shipments_in_transit:        0,
    pending_payments_mvr:        0,
    pending_payments_count:      0,
    cod_undeposited_mvr:         0,
    shipments_arriving_soon:     0,
    overstock_sku_count:         0,
    reorder_needed_count:        0,
    slow_stock_value_mvr:        0,
    slow_stock_count:            0,
  }) as Metrics;

  const revenueMonth      = Number(m.revenue_this_month_mvr);
  const revenueLastMonth  = Number(m.revenue_last_month_mvr);
  const grossProfit       = Number(m.gross_profit_this_month_mvr);
  const grossMargin       = Number(m.gross_margin_pct);
  const revenueToday      = Number(m.revenue_today_mvr);
  const pendingMvr        = Number(m.pending_payments_mvr);
  const pendingCount      = Number(m.pending_payments_count);
  const codUndeposited    = Number(m.cod_undeposited_mvr);
  const awaitingDispatch  = Number(m.orders_awaiting_dispatch);
  const onRoad            = Number(m.orders_out_for_delivery);
  const deliveredToday    = Number(m.orders_delivered_today);
  const overdueOrders     = Number(m.overdue_orders_count);
  const lowStockCount     = Number(m.low_stock_sku_count);
  const arrivingSoon      = Number(m.shipments_arriving_soon);
  const reorderCount      = Number(m.reorder_needed_count);
  const slowStockValue    = Number(m.slow_stock_value_mvr);
  const slowStockCount    = Number(m.slow_stock_count);

  const revChangePct = revenueLastMonth > 0
    ? ((revenueMonth - revenueLastMonth) / revenueLastMonth) * 100
    : null;

  const now           = new Date();
  const monthName     = now.toLocaleString("en-MV", { month: "long", timeZone: "Indian/Maldives" });
  const todayLabel    = now.toLocaleString("en-MV", { weekday: "short", day: "numeric", month: "short", timeZone: "Indian/Maldives" });

  // Greeting by the owner's local hour (Maldives), so the header always reads true.
  const mvtHour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Indian/Maldives" }).format(now));
  const greeting = mvtHour < 12 ? "Good morning" : mvtHour < 17 ? "Good afternoon" : "Good evening";

  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Maldives" }).format(now); // YYYY-MM-DD

  const marginColor =
    grossMargin < 10 ? "var(--snm-error)"
    : grossMargin < 20 ? "var(--snm-warning)"
    : "var(--snm-success)";

  // Net profit is the owner's bottom line — colour by sign, not by a margin band.
  const netColor = netProfit >= 0 ? "var(--snm-success)" : "var(--snm-error)";

  // Single highest-priority action strip — only one shown at a time
  const exception =
    overdueOrders > 0
      ? { label: `${overdueOrders} order${overdueOrders !== 1 ? "s" : ""} overdue — no driver assigned`, cta: "Dispatch now", href: "/dispatch", color: "var(--snm-error)" }
      : awaitingDispatch > 0
      ? { label: `${awaitingDispatch} order${awaitingDispatch !== 1 ? "s" : ""} waiting for a driver`, cta: "Assign now", href: "/dispatch", color: "var(--snm-warning)" }
      : pendingMvr > 0
      ? { label: `MVR ${mvr(pendingMvr)} unpaid — ${pendingCount} order${pendingCount !== 1 ? "s" : ""}`, cta: "View orders", href: "/sales?filter=unpaid", color: "var(--snm-error)" }
      : codUndeposited > 0
      ? { label: `MVR ${mvr(codUndeposited)} COD cash not yet banked`, cta: "Check COD", href: "/financials?tab=cod", color: "var(--snm-warning)" }
      : lowStockCount > 0
      ? { label: `${lowStockCount} SKU${lowStockCount !== 1 ? "s" : ""} running low`, cta: "Check stock", href: "/inventory", color: "var(--snm-warning)" }
      : null;

  // Exceptions section: only items with NO other card representation on screen.
  // Each one is a genuine exception that needs owner awareness — not a duplicate.
  const hasExceptions = overdueOrders > 0 || lowStockCount > 0 || arrivingSoon > 0 || slowStockCount > 0 || reorderCount > 0;

  return (
    <div className="space-y-4">

      {/* ── Page header — the dashboard needs a visible title like every other
           screen. Time-aware greeting + today's date, Maldives time. ── */}
      <div>
        <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>
          {todayLabel}
        </p>
        <h1 className="ios-page-title">{greeting}{firstName ? `, ${firstName}` : ""}</h1>
      </div>

      {/* ── Zone 0a: Money-at-risk strip ──
           Surfaced right under the greeting: for a distributor owner, the
           single most urgent thing (money owed, cash not banked, orders
           stuck) is the first thing he should see — not buried below the
           month figures. Same one-exception logic, just lifted to the top. ── */}
      {exception && (
        <Link href={exception.href}
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 transition active:scale-[0.98]"
          style={{
            background: `color-mix(in srgb, ${exception.color} 8%, var(--glass-1))`,
            border: `1px solid color-mix(in srgb, ${exception.color} 30%, transparent)`,
            boxShadow: "var(--glass-shadow), var(--glass-inner)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: exception.color }} />
            {/* Wrap, never truncate: this strip exists to deliver ONE message —
                an alert that cuts itself off ("1 order waiting fo…") fails its
                only job. Two lines beats an unreadable one. */}
            <p className="text-[14px] font-semibold text-foreground leading-snug">{exception.label}</p>
          </div>
          <span className="ios-subhead font-bold shrink-0 px-3 py-1.5 rounded-xl"
            style={{ background: exception.color, color: "var(--snm-on-fill)" }}>
            {exception.cta} →
          </span>
        </Link>
      )}

      {/* ── Zone 0: Morning briefing — yesterday + the watch list ── */}
      <MorningBriefing />

      {/* ── Zone 1: This Month ──
           Clear top-to-bottom hierarchy: Revenue is the hero, Gross + Net
           sit below as a grouped 2-up (Net = the owner's bottom line). Whole
           card links to Reports (profit breaks down Brand → Model → SKU). ── */}
      <Link href="/reports" className="block glass-panel rounded-2xl transition active:scale-[0.98]" style={{ padding: 24 }}>
        <div className="flex items-center justify-between mb-4">
          <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            {monthName} — This Month
          </p>
          <span className="flex items-center gap-0.5 ios-subhead" style={{ color: "var(--muted-foreground)" }}>
            Profit by product <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>

        {/* Hero — Revenue, with month-over-month change beside it */}
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[40px] font-semibold tracking-tight text-foreground leading-none snm-num">
              {mvr(revenueMonth)}
              <span className="text-xl ml-1.5 font-medium" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
            <p className="ios-subhead font-medium mt-1.5" style={{ color: "var(--muted-foreground)" }}>Revenue</p>
          </div>
          {revChangePct !== null && (
            <div className="flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-full"
              style={{
                background: `color-mix(in srgb, ${revChangePct >= 0 ? "var(--snm-success)" : "var(--snm-error)"} 12%, transparent)`,
                color: revChangePct >= 0 ? "var(--snm-success)" : "var(--snm-error)",
              }}>
              {revChangePct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              <span className="ios-caption1 font-semibold snm-num">
                {revChangePct >= 0 ? "+" : ""}{revChangePct.toFixed(0)}%
              </span>
            </div>
          )}
        </div>

        {/* Grouped 2-up — Gross Profit and Net Profit (the bottom line) */}
        <div className="grid grid-cols-2 gap-6 mt-5 pt-5"
          style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
          <div>
            <p className="ios-caption1 font-medium mb-1.5 uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Gross Profit</p>
            <p className="text-[24px] font-bold tracking-tight text-foreground leading-none snm-num">
              {mvr(grossProfit)} <span className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
            <p className="ios-subhead mt-1.5 font-semibold snm-num" style={{ color: marginColor }}>
              {grossMargin.toFixed(1)}% margin
            </p>
          </div>
          <div>
            <p className="ios-caption1 font-medium mb-1.5 uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Net Profit</p>
            <p className="text-[24px] font-bold tracking-tight leading-none snm-num" style={{ color: netColor }}>
              {mvr(netProfit)} <span className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
            {netMargin !== null && (
              <p className="ios-subhead mt-1.5 font-semibold snm-num" style={{ color: netColor }}>
                {netMargin.toFixed(1)}% margin
              </p>
            )}
          </div>
        </div>
      </Link>

      {/* ── Zone 1a: Revenue trend — 7 days ── */}
      {dailyRevenueData && dailyRevenueData.length > 0 && (
        <RevenueTrendChart
          days={dailyRevenueData.map((d: { day_label: string; day_date: string; revenue_mvr: number | string; orders_count: number }) => ({
            ...d,
            revenue_mvr: Number(d.revenue_mvr),
          }))}
          todayIso={todayIso}
        />
      )}

      {/* ── Zone 1a2: Margin composition — where this month's revenue went ── */}
      {pnlRevenue > 0 && (
        <MarginCompositionChart
          revenueMvr={pnlRevenue}
          cogsMvr={pnlCogs}
          otherCostsMvr={pnlOtherCosts}
          netProfitMvr={netProfit}
          netMarginPct={netMargin}
        />
      )}

      {/* ── Zone 1b: Today ── a quiet, separate card so today's running total
           never competes with the month's headline figures. ── */}
      <div className="glass-panel flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>Today</p>
          <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{todayLabel}</p>
        </div>
        <p className="text-[18px] font-semibold text-foreground snm-num leading-none">
          {mvr(revenueToday)} <span className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>MVR</span>
        </p>
      </div>

      {/* ── Zone 2: Live Order Pipeline ──
           Single card, one tap → /dispatch which always shows real active orders.
           Three columns = three stages. Colour signals state, not just decoration.
      ── */}
      <Link href="/dispatch" className="block glass-panel transition active:scale-[0.98]" style={{ padding: 0, overflow: "hidden" }}>
        <div className="px-4 pt-4 pb-1">
          <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>Order Pipeline — Today</p>
        </div>
        <div className="glass-stat-strip" style={{ padding: "8px 0" }}>

          <div className="glass-stat-strip__item" style={{ textAlign: "left", paddingLeft: 16 }}>
            <div className="flex items-center gap-1.5 mb-2">
              <ClipboardList className="h-3.5 w-3.5 shrink-0"
                style={{ color: awaitingDispatch > 0 ? "var(--snm-warning)" : "var(--muted-foreground)" }} />
              <p className="text-[12px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--muted-foreground)" }}>Awaiting</p>
            </div>
            <p className="glass-stat-strip__value text-2xl font-bold leading-none snm-num"
              style={{ color: awaitingDispatch > 0 ? "var(--snm-warning)" : "var(--foreground)" }}>
              {awaitingDispatch}
            </p>
            <p className="glass-stat-strip__label ios-subhead mt-1">
              {awaitingDispatch === 1 ? "order" : "orders"}
            </p>
          </div>

          <div className="glass-stat-strip__divider" />

          <div className="glass-stat-strip__item" style={{ textAlign: "left", paddingLeft: 16 }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Truck className="h-3.5 w-3.5 shrink-0"
                style={{ color: onRoad > 0 ? "var(--glass-accent)" : "var(--muted-foreground)" }} />
              <p className="text-[12px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--muted-foreground)" }}>On Road</p>
              {onRoad > 0 && (
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
                  style={{ background: "var(--glass-accent)" }} />
              )}
            </div>
            <p className="glass-stat-strip__value text-2xl font-bold leading-none snm-num"
              style={{ color: onRoad > 0 ? "var(--glass-accent)" : "var(--foreground)" }}>
              {onRoad}
            </p>
            <p className="glass-stat-strip__label ios-subhead mt-1">
              {onRoad === 1 ? "order" : "orders"}
            </p>
          </div>

          <div className="glass-stat-strip__divider" />

          <div className="glass-stat-strip__item" style={{ textAlign: "left", paddingLeft: 16 }}>
            <div className="flex items-center gap-1.5 mb-2">
              <PackageCheck className="h-3.5 w-3.5 shrink-0"
                style={{ color: deliveredToday > 0 ? "var(--snm-success)" : "var(--muted-foreground)" }} />
              <p className="text-[12px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--muted-foreground)" }}>Delivered</p>
            </div>
            <p className="glass-stat-strip__value text-2xl font-bold leading-none snm-num"
              style={{ color: deliveredToday > 0 ? "var(--snm-success)" : "var(--foreground)" }}>
              {deliveredToday}
            </p>
            <p className="glass-stat-strip__label ios-subhead mt-1">today</p>
          </div>

        </div>
        <div className="flex items-center justify-end gap-1 px-4 py-2"
          style={{ borderTop: "1px solid var(--glass-divider)" }}>
          <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Open dispatch board</p>
          <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
        </div>
      </Link>

      {/* ── Zone 3: Money ──
           Only rendered when there is actual unpaid money.
           Cards disappear completely when everything is paid — no empty states.
      ── */}
      {(pendingMvr > 0 || codUndeposited > 0) && (
        <div className={pendingMvr > 0 && codUndeposited > 0 ? "grid grid-cols-2 gap-3" : "block"}>

          {pendingMvr > 0 && (
            <Link href="/sales?filter=unpaid"
              className="glass-panel active:scale-[0.97] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)" }}>
              <div className="flex justify-between items-start mb-3">
                <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>Unpaid</p>
                <Clock className="h-4 w-4" style={{ color: "var(--snm-error)" }} />
              </div>
              <p className="text-2xl font-semibold snm-num" style={{ color: "var(--snm-error)" }}>
                {mvr(pendingMvr)}
              </p>
              <div className="flex items-center justify-between mt-1">
                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                  {pendingCount} unpaid order{pendingCount !== 1 ? "s" : ""}
                </p>
                <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
              </div>
            </Link>
          )}

          {codUndeposited > 0 && (
            <Link href="/financials?tab=cod"
              className="glass-panel active:scale-[0.97] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" }}>
              <div className="flex justify-between items-start mb-3">
                <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>Cash in Hand</p>
                <Banknote className="h-4 w-4" style={{ color: "var(--snm-warning)" }} />
              </div>
              <p className="text-2xl font-semibold snm-num" style={{ color: "var(--snm-warning)" }}>
                {mvr(codUndeposited)}
              </p>
              <div className="flex items-center justify-between mt-1">
                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                  COD collected, not banked
                </p>
                <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
              </div>
            </Link>
          )}

        </div>
      )}

      {/* ── Zone 5: Exceptions ──
           RULE: Only items that have NO card representation elsewhere on this page.
           - Overdue orders: not shown in any card — genuinely needs attention
           - Low stock: not shown in any card — needs procurement action
           - Shipments arriving soon: not shown anywhere else — needs godown prep
           Unpaid and Cash in Hand are NOT here — they already have cards above.
           Every row taps to the exact screen where the user can act.
      ── */}
      {hasExceptions && (
        <div className="space-y-2">
          <p className="label-caps text-[12px] px-1" style={{ color: "var(--muted-foreground)" }}>
            Needs Attention
          </p>

          {overdueOrders > 0 && (
            <Link href="/dispatch"
              className="glass-panel flex items-center gap-4 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-error) 28%, transparent)" }}>
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}>
                <Timer className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold text-foreground">
                  {overdueOrders} order{overdueOrders !== 1 ? "s" : ""} overdue
                </p>
                <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Confirmed &gt;24 h — no driver assigned yet
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
            </Link>
          )}

          {lowStockCount > 0 && (
            <Link href="/inventory"
              className="glass-panel flex items-center gap-4 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-warning) 28%, transparent)" }}>
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", color: "var(--snm-warning)" }}>
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold text-foreground">
                  {lowStockCount} SKU{lowStockCount !== 1 ? "s" : ""} low on stock
                </p>
                <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Less than 10 days of stock remaining
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
            </Link>
          )}

          {arrivingSoon > 0 && (
            <Link href="/shipments"
              className="glass-panel flex items-center gap-4 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-brand) 25%, transparent)" }}>
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-brand) 12%, transparent)", color: "var(--snm-brand)" }}>
                <Ship className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold text-foreground">
                  {arrivingSoon} shipment{arrivingSoon !== 1 ? "s" : ""} arriving within 3 days
                </p>
                <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Prepare godown space for receiving
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
            </Link>
          )}

          {reorderCount > 0 && (
            <Link href="/reorder"
              className="glass-panel flex items-center gap-4 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-warning) 28%, transparent)" }}>
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", color: "var(--snm-warning)" }}>
                <RefreshCw className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold text-foreground">
                  {reorderCount} SKU{reorderCount !== 1 ? "s" : ""} due for reorder
                </p>
                <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Based on sales velocity and lead time
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
            </Link>
          )}

          {slowStockCount > 0 && (
            // Cash tied up in slow-moving stock, led with the MONEY (not a raw
            // SKU count) — the single biggest lever for freeing cash. Same
            // "slow movers" set the briefing names; links to the Promo Advisor
            // where a clearance promo turns it back into cash.
            <Link href="/competitors"
              className="glass-panel flex items-center gap-4 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-warning) 22%, transparent)" }}>
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", color: "var(--snm-warning)" }}>
                <PackageX className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold text-foreground snm-num">
                  MVR {mvr(slowStockValue)} tied up in slow stock
                </p>
                <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  {slowStockCount} slow mover{slowStockCount !== 1 ? "s" : ""} — a promo turns it back into cash
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
            </Link>
          )}

        </div>
      )}

    </div>
  );
}

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
}

export default async function DashboardPage() {
  const supabase = await getSupabaseServer();

  // Month range for the P&L (net profit). get_pnl is the same audited RPC the
  // Financials page uses, so the dashboard net figure always matches it exactly.
  const nowMv          = new Date();
  const firstOfMonth   = new Date(nowMv.getFullYear(), nowMv.getMonth(), 1).toISOString().slice(0, 10);
  const tomorrow       = new Date(nowMv.getFullYear(), nowMv.getMonth(), nowMv.getDate() + 1).toISOString().slice(0, 10);

  const [{ data }, { data: pnlData }] = await Promise.all([
    supabase.rpc("get_dashboard_metrics"),
    supabase.rpc("get_pnl", { p_from: firstOfMonth, p_to: tomorrow }),
  ]);

  const pnl        = pnlData?.[0] ?? null;
  const netProfit  = Number(pnl?.net_profit_mvr ?? 0);
  const netMargin  = pnl?.net_margin_pct != null ? Number(pnl.net_margin_pct) : null;

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
  const overstockCount    = Number(m.overstock_sku_count);
  const reorderCount      = Number(m.reorder_needed_count);

  const revChangePct = revenueLastMonth > 0
    ? ((revenueMonth - revenueLastMonth) / revenueLastMonth) * 100
    : null;

  const now           = new Date();
  const monthName     = now.toLocaleString("en-MV", { month: "long" });
  const lastMonthName = new Date(now.getFullYear(), now.getMonth() - 1).toLocaleString("en-MV", { month: "long" });
  const todayLabel    = now.toLocaleString("en-MV", { weekday: "short", day: "numeric", month: "short" });

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
  const hasExceptions = overdueOrders > 0 || lowStockCount > 0 || arrivingSoon > 0 || overstockCount > 0 || reorderCount > 0;

  return (
    <div className="space-y-4">

      {/* ── Zone 1: Business Health ──
           Whole card links to Reports, where profit breaks down by
           Brand → Model → SKU — the total here is just the summary. ── */}
      <Link href="/reports" className="block snm-card rounded-2xl p-6 transition active:scale-[0.98]" style={{ border: "0.5px solid var(--glass-border-lo)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            {monthName} Performance
          </p>
          <span className="flex items-center gap-0.5 ios-subhead" style={{ color: "var(--muted-foreground)" }}>
            Profit by product <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="ios-subhead font-medium mb-1" style={{ color: "var(--muted-foreground)" }}>Revenue</p>
            <p className="text-[36px] font-semibold tracking-tight text-foreground leading-none snm-num">
              {mvr(revenueMonth)}
              <span className="text-xl ml-1" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
          </div>
          <div>
            <p className="ios-subhead font-medium mb-1" style={{ color: "var(--muted-foreground)" }}>Gross Profit</p>
            <p className="text-[36px] font-semibold tracking-tight text-foreground leading-none snm-num">
              {mvr(grossProfit)}
              <span className="text-xl ml-1" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
            <p className="ios-subhead mt-1 font-semibold snm-num" style={{ color: marginColor }}>
              {grossMargin.toFixed(1)}% margin
            </p>
          </div>
        </div>

        {/* Net Profit — the owner's bottom line, after all costs & expenses.
            Matches Financials exactly (same get_pnl RPC). */}
        <div className="flex items-baseline justify-between gap-3 mt-4 pt-4"
          style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
          <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>Net Profit</p>
          <div className="flex items-baseline gap-2">
            <p className="text-[22px] font-bold tracking-tight snm-num leading-none" style={{ color: netColor }}>
              {mvr(netProfit)} <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
            {netMargin !== null && (
              <span className="ios-subhead font-semibold snm-num" style={{ color: netColor }}>
                {netMargin.toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        {revChangePct !== null && (
          <div className="flex items-center gap-1.5 mt-3"
            style={{ color: revChangePct >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
            {revChangePct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            <span className="ios-subhead snm-num">
              {revChangePct >= 0 ? "+" : ""}{revChangePct.toFixed(1)}% vs {lastMonthName}
            </span>
          </div>
        )}

        {/* Today's revenue — labelled clearly so context is never ambiguous */}
        <div className="flex items-baseline gap-3 mt-4 pt-4"
          style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
          <p className="text-[12px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--muted-foreground)" }}>Today</p>
          <p className="ios-subhead font-semibold text-foreground snm-num">{mvr(revenueToday)} MVR</p>
          <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{todayLabel}</p>
        </div>
      </Link>

      {/* ── Zone 2: Live Order Pipeline ──
           Single card, one tap → /dispatch which always shows real active orders.
           Three columns = three stages. Colour signals state, not just decoration.
      ── */}
      <Link href="/dispatch" className="block snm-card rounded-2xl overflow-hidden transition active:scale-[0.98]"
        style={{ border: "0.5px solid var(--glass-border-lo)" }}>
        <div className="px-4 pt-4 pb-1">
          <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>Order Pipeline — Today</p>
        </div>
        <div className="grid grid-cols-3 divide-x" style={{ borderColor: "var(--glass-border-lo)" }}>

          <div className="px-4 py-4">
            <div className="flex items-center gap-1.5 mb-2">
              <ClipboardList className="h-3.5 w-3.5 shrink-0"
                style={{ color: awaitingDispatch > 0 ? "var(--snm-warning)" : "var(--muted-foreground)" }} />
              <p className="text-[12px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--muted-foreground)" }}>Awaiting</p>
            </div>
            <p className="text-2xl font-bold leading-none snm-num"
              style={{ color: awaitingDispatch > 0 ? "var(--snm-warning)" : "var(--foreground)" }}>
              {awaitingDispatch}
            </p>
            <p className="ios-subhead mt-1" style={{ color: "var(--muted-foreground)" }}>
              {awaitingDispatch === 1 ? "order" : "orders"}
            </p>
          </div>

          <div className="px-4 py-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Truck className="h-3.5 w-3.5 shrink-0"
                style={{ color: onRoad > 0 ? "var(--snm-brand)" : "var(--muted-foreground)" }} />
              <p className="text-[12px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--muted-foreground)" }}>On Road</p>
              {onRoad > 0 && (
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
                  style={{ background: "var(--snm-brand)" }} />
              )}
            </div>
            <p className="text-2xl font-bold leading-none snm-num"
              style={{ color: onRoad > 0 ? "var(--snm-brand)" : "var(--foreground)" }}>
              {onRoad}
            </p>
            <p className="ios-subhead mt-1" style={{ color: "var(--muted-foreground)" }}>
              {onRoad === 1 ? "order" : "orders"}
            </p>
          </div>

          <div className="px-4 py-4">
            <div className="flex items-center gap-1.5 mb-2">
              <PackageCheck className="h-3.5 w-3.5 shrink-0"
                style={{ color: deliveredToday > 0 ? "var(--snm-success)" : "var(--muted-foreground)" }} />
              <p className="text-[12px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--muted-foreground)" }}>Delivered</p>
            </div>
            <p className="text-2xl font-bold leading-none snm-num"
              style={{ color: deliveredToday > 0 ? "var(--snm-success)" : "var(--foreground)" }}>
              {deliveredToday}
            </p>
            <p className="ios-subhead mt-1" style={{ color: "var(--muted-foreground)" }}>today</p>
          </div>

        </div>
        <div className="flex items-center justify-end gap-1 px-4 py-2"
          style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
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
              className="snm-card rounded-2xl p-5 active:scale-[0.97] block"
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
                  {pendingCount} delivered order{pendingCount !== 1 ? "s" : ""}
                </p>
                <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
              </div>
            </Link>
          )}

          {codUndeposited > 0 && (
            <Link href="/financials?tab=cod"
              className="snm-card rounded-2xl p-5 active:scale-[0.97] block"
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

      {/* ── Zone 4: Single action strip ──
           Highest priority exception only. Disappears on a clean day.
      ── */}
      {exception && (
        <Link href={exception.href}
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 transition active:scale-[0.98]"
          style={{
            background: `color-mix(in srgb, ${exception.color} 8%, var(--glass-1))`,
            border: `1px solid color-mix(in srgb, ${exception.color} 30%, transparent)`,
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "var(--glass-shadow), var(--glass-inner)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: exception.color }} />
            <p className="text-[14px] font-semibold text-foreground truncate">{exception.label}</p>
          </div>
          <span className="ios-subhead font-bold shrink-0 px-3 py-1.5 rounded-xl"
            style={{ background: exception.color, color: "#fff" }}>
            {exception.cta} →
          </span>
        </Link>
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
              className="snm-card rounded-2xl p-4 flex items-center gap-4 active:scale-[0.98] block"
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
              className="snm-card rounded-2xl p-4 flex items-center gap-4 active:scale-[0.98] block"
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
              className="snm-card rounded-2xl p-4 flex items-center gap-4 active:scale-[0.98] block"
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
              className="snm-card rounded-2xl p-4 flex items-center gap-4 active:scale-[0.98] block"
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

          {overstockCount > 0 && (
            <Link href="/inventory?filter=overstock"
              className="snm-card rounded-2xl p-4 flex items-center gap-4 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--muted-foreground) 25%, transparent)" }}>
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--muted-foreground) 12%, transparent)", color: "var(--muted-foreground)" }}>
                <PackageX className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold text-foreground">
                  {overstockCount} SKU{overstockCount !== 1 ? "s" : ""} overstocked
                </p>
                <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  More than 90 days of stock on hand
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

import { getSupabaseServer } from "@/lib/supabase-server";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  Package,
  Banknote,
  CheckCircle2,
  Timer,
  ChevronRight,
  Navigation,
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
  // Delivered orders where money has not yet been received
  pending_payments_mvr:        number;
  pending_payments_count:      number;
  // Subset: COD cash held by drivers, not yet banked
  cod_undeposited_mvr:         number;
}

export default async function DashboardPage() {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.rpc("get_dashboard_metrics");

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
  }) as Metrics;

  const revenueMonth      = Number(m.revenue_this_month_mvr);
  const revenueLastMonth  = Number(m.revenue_last_month_mvr);
  const grossProfit       = Number(m.gross_profit_this_month_mvr);
  const grossMargin       = Number(m.gross_margin_pct);
  const revenueToday      = Number(m.revenue_today_mvr);
  const stockValue        = Number(m.total_stock_value_mvr);
  const pendingMvr        = Number(m.pending_payments_mvr);
  const pendingCount      = Number(m.pending_payments_count);
  const codUndeposited    = Number(m.cod_undeposited_mvr);
  const awaitingDispatch  = Number(m.orders_awaiting_dispatch);
  const onRoad            = Number(m.orders_out_for_delivery);
  const dispatchedToday   = Number(m.orders_dispatched_today);
  const deliveredToday    = Number(m.orders_delivered_today);
  const overdueOrders     = Number(m.overdue_orders_count);
  const lowStockCount     = Number(m.low_stock_sku_count);

  const revChangePct = revenueLastMonth > 0
    ? ((revenueMonth - revenueLastMonth) / revenueLastMonth) * 100
    : null;

  const now           = new Date();
  const monthName     = now.toLocaleString("en-MV", { month: "long" });
  const lastMonthName = new Date(now.getFullYear(), now.getMonth() - 1).toLocaleString("en-MV", { month: "long" });
  const todayLabel    = now.toLocaleString("en-MV", { weekday: "short", day: "numeric", month: "short" });

  const hasAlerts = overdueOrders > 0 || lowStockCount > 0 || pendingMvr > 0 || codUndeposited > 0;

  const marginColor =
    grossMargin < 10 ? "var(--snm-error)"
    : grossMargin < 20 ? "var(--snm-warning)"
    : "var(--snm-success)";

  return (
    <div className="space-y-4">

      {/* ── Hero: Revenue + Gross Profit ── */}
      <div className="snm-card rounded-2xl p-6" style={{ border: "1px solid var(--glass-border-lo)" }}>
        <p className="label-caps text-[11px] mb-3" style={{ color: "var(--muted-foreground)" }}>
          {monthName} Performance
        </p>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-[11px] font-medium mb-1" style={{ color: "var(--muted-foreground)" }}>Revenue</p>
            <p className="text-[36px] font-light tracking-tight text-foreground leading-none">
              {mvr(revenueMonth)}
              <span className="text-xl ml-1" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium mb-1" style={{ color: "var(--muted-foreground)" }}>Gross Profit</p>
            <p className="text-[36px] font-light tracking-tight text-foreground leading-none">
              {mvr(grossProfit)}
              <span className="text-xl ml-1" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
            <p className="text-[11px] mt-1 font-semibold" style={{ color: marginColor }}>
              {grossMargin.toFixed(1)}% margin
            </p>
          </div>
        </div>

        {revChangePct !== null && (
          <div
            className="flex items-center gap-1.5 mt-3"
            style={{ color: revChangePct >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}
          >
            {revChangePct >= 0
              ? <TrendingUp className="h-3.5 w-3.5" />
              : <TrendingDown className="h-3.5 w-3.5" />}
            <span className="text-sm">
              {revChangePct >= 0 ? "+" : ""}{revChangePct.toFixed(1)}% vs {lastMonthName}
            </span>
          </div>
        )}

        {/* Today strip */}
        <div
          className="grid grid-cols-3 gap-4 mt-5 pt-4"
          style={{ borderTop: "1px solid var(--glass-border-lo)" }}
        >
          <div>
            <p className="label-caps text-[11px] mb-1" style={{ color: "var(--muted-foreground)" }}>
              {todayLabel}
            </p>
            <p className="text-sm font-semibold text-foreground">{mvr(revenueToday)} MVR</p>
          </div>
          <div>
            <p className="label-caps text-[11px] mb-1 flex items-center gap-1" style={{ color: "var(--muted-foreground)" }}>
              On the Road
              {onRoad > 0 && (
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--snm-brand)" }} />
              )}
            </p>
            <p className="text-sm font-semibold" style={{ color: onRoad > 0 ? "var(--snm-brand)" : "var(--foreground)" }}>
              {onRoad} {onRoad === 1 ? "order" : "orders"}
            </p>
          </div>
          <div>
            <p className="label-caps text-[11px] mb-1" style={{ color: "var(--muted-foreground)" }}>Awaiting Dispatch</p>
            <p className="text-sm font-semibold" style={{ color: awaitingDispatch > 0 ? "var(--snm-warning)" : "var(--foreground)" }}>
              {awaitingDispatch}
            </p>
          </div>
        </div>
      </div>

      {/* ── Live delivery pulse — only shown when orders are on the road ── */}
      {onRoad > 0 && (
        <Link
          href="/dispatch"
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 transition active:scale-[0.98]"
          style={{
            background: "color-mix(in srgb, var(--snm-brand) 8%, var(--glass-1))",
            border: "1px solid color-mix(in srgb, var(--snm-brand) 30%, transparent)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "color-mix(in srgb, var(--snm-brand) 15%, transparent)" }}
            >
              <Navigation className="h-4 w-4" style={{ color: "var(--snm-brand)" }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                {onRoad} {onRoad === 1 ? "order" : "orders"} on the road
                <span className="inline-block w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: "var(--snm-brand)" }} />
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                Live · updates when delivery marked complete
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--snm-brand)", opacity: 0.7 }} />
        </Link>
      )}

      {/* ── 2×2 metric grid ── */}
      <div className="grid grid-cols-2 gap-3">

        <Link href="/inventory" className="snm-card rounded-2xl p-5 transition hover:opacity-90 active:scale-[0.97] block"
          style={{ border: "1px solid var(--glass-border-lo)" }}>
          <div className="flex justify-between items-start mb-3">
            <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>Stock Value</p>
            <Package className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
          </div>
          <p className="text-2xl font-semibold text-foreground">{mvr(stockValue)}</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>MVR at landed cost</p>
            <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
          </div>
        </Link>

        {/*
          Unpaid — all delivered orders where money not yet received.
          Includes: COD not collected, bank transfer unpaid, partial payments.
          Excludes: undelivered orders (money doesn't exist yet).
          Taps to Sales filtered view so owner can see exactly which orders.
        */}
        <Link href="/sales?filter=unpaid" className="snm-card rounded-2xl p-5 transition hover:opacity-90 active:scale-[0.97] block"
          style={{ border: pendingMvr > 0 ? "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)" : "1px solid var(--glass-border-lo)" }}>
          <div className="flex justify-between items-start mb-3">
            <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>Unpaid</p>
            <Clock className="h-4 w-4" style={{ color: pendingMvr > 0 ? "var(--snm-error)" : "var(--muted-foreground)" }} />
          </div>
          <p className="text-2xl font-semibold" style={{ color: pendingMvr > 0 ? "var(--snm-error)" : "var(--foreground)" }}>
            {pendingMvr > 0 ? mvr(pendingMvr) : "—"}
          </p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {pendingMvr > 0 ? `${pendingCount} delivered order${pendingCount !== 1 ? "s" : ""}` : "All collected"}
            </p>
            <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
          </div>
        </Link>

        {/*
          COD Cash in Hand — subset of Unpaid above.
          This is money that EXISTS (driver collected it) but hasn't reached the bank.
          Different urgency and action: go to COD reconciliation, not Sales list.
        */}
        <Link href="/financials?tab=cod" className="snm-card rounded-2xl p-5 transition hover:opacity-90 active:scale-[0.97] block"
          style={{ border: codUndeposited > 0 ? "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" : "1px solid var(--glass-border-lo)" }}>
          <div className="flex justify-between items-start mb-3">
            <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>Cash in Hand</p>
            <Banknote className="h-4 w-4" style={{ color: codUndeposited > 0 ? "var(--snm-warning)" : "var(--muted-foreground)" }} />
          </div>
          <p className="text-2xl font-semibold" style={{ color: codUndeposited > 0 ? "var(--snm-warning)" : "var(--foreground)" }}>
            {codUndeposited > 0 ? mvr(codUndeposited) : "—"}
          </p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {codUndeposited > 0 ? "COD collected, not banked" : "All cash deposited"}
            </p>
            <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
          </div>
        </Link>

        <Link href="/dispatch" className="snm-card rounded-2xl p-5 transition hover:opacity-90 active:scale-[0.97] block"
          style={{ border: "1px solid var(--glass-border-lo)" }}>
          <div className="flex justify-between items-start mb-3">
            <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>Delivered Today</p>
            <CheckCircle2 className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
          </div>
          <p className="text-2xl font-semibold text-foreground">{deliveredToday}</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {dispatchedToday > 0 ? `${dispatchedToday} dispatched` : "orders completed"}
            </p>
            <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
          </div>
        </Link>

      </div>

      {/* ── Next Action strip ──
           One line, one button — the single most urgent thing right now.
           Priority: overdue > awaiting dispatch > unpaid > COD not banked > low stock ── */}
      {(overdueOrders > 0 || awaitingDispatch > 0 || pendingMvr > 0 || codUndeposited > 0 || lowStockCount > 0) && (() => {
        const action =
          overdueOrders > 0
            ? { label: `${overdueOrders} order${overdueOrders !== 1 ? "s" : ""} overdue — not dispatched`, cta: "Dispatch now", href: "/dispatch", color: "var(--snm-error)" }
            : awaitingDispatch > 0
            ? { label: `${awaitingDispatch} order${awaitingDispatch !== 1 ? "s" : ""} ready to dispatch`, cta: "Assign delivery", href: "/dispatch", color: "var(--snm-warning)" }
            : pendingMvr > 0
            ? { label: `MVR ${mvr(pendingMvr)} unpaid across ${pendingCount} order${pendingCount !== 1 ? "s" : ""}`, cta: "View", href: "/sales?filter=unpaid", color: "var(--snm-error)" }
            : codUndeposited > 0
            ? { label: `MVR ${mvr(codUndeposited)} COD cash not yet banked`, cta: "Check COD", href: "/financials?tab=cod", color: "var(--snm-warning)" }
            : { label: `${lowStockCount} SKU${lowStockCount !== 1 ? "s" : ""} running low`, cta: "Check stock", href: "/inventory", color: "var(--snm-warning)" };
        return (
          <Link
            href={action.href}
            className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3 transition active:scale-[0.98]"
            style={{
              background: `color-mix(in srgb, ${action.color} 8%, var(--glass-1))`,
              border: `1px solid color-mix(in srgb, ${action.color} 30%, transparent)`,
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: action.color }} />
              <p className="text-[14px] font-semibold text-foreground truncate">{action.label}</p>
            </div>
            <span
              className="text-[12px] font-bold shrink-0 px-3 py-1.5 rounded-xl"
              style={{ background: action.color, color: "#fff" }}
            >
              {action.cta} →
            </span>
          </Link>
        );
      })()}

      {/* ── Alerts — only shown when something needs attention ── */}
      {hasAlerts && (
        <div className="space-y-2">
          <p className="label-caps text-[11px] px-1" style={{ color: "var(--muted-foreground)" }}>Needs Attention</p>

          {overdueOrders > 0 && (
            <Link href="/dispatch"
              className="snm-card rounded-2xl p-4 flex items-center gap-4 transition hover:opacity-90 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-error) 28%, transparent)" }}
            >
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}>
                <Timer className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {overdueOrders} order{overdueOrders !== 1 ? "s" : ""} overdue
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Confirmed &gt;24 h — not yet dispatched
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
            </Link>
          )}

          {pendingMvr > 0 && (
            <Link href="/sales?filter=unpaid"
              className="snm-card rounded-2xl p-4 flex items-center gap-4 transition hover:opacity-90 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-error) 20%, transparent)" }}
            >
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}>
                <Clock className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  MVR {mvr(pendingMvr)} unpaid — {pendingCount} order{pendingCount !== 1 ? "s" : ""}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Delivered but payment not yet received
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
            </Link>
          )}

          {codUndeposited > 0 && (
            <Link href="/financials?tab=cod"
              className="snm-card rounded-2xl p-4 flex items-center gap-4 transition hover:opacity-90 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-warning) 20%, transparent)" }}
            >
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", color: "var(--snm-warning)" }}>
                <Banknote className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  MVR {mvr(codUndeposited)} cash not banked
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  COD collected by drivers — awaiting bank deposit
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
            </Link>
          )}

          {lowStockCount > 0 && (
            <Link href="/inventory"
              className="snm-card rounded-2xl p-4 flex items-center gap-4 transition hover:opacity-90 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-warning) 28%, transparent)" }}
            >
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", color: "var(--snm-warning)" }}>
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {lowStockCount} SKU{lowStockCount !== 1 ? "s" : ""} low on stock
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Less than 10 days remaining
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

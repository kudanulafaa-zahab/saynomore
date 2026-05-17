import { getSupabaseServer } from "@/lib/supabase-server";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  Package,
  Truck,
  CheckCircle2,
  Timer,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

function mvr(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

interface Metrics {
  revenue_today_mvr:          number;
  revenue_this_month_mvr:     number;
  revenue_last_month_mvr:     number;
  gross_profit_this_month_mvr: number;
  gross_margin_pct:           number;
  orders_awaiting_dispatch:   number;
  orders_dispatched_today:    number;
  orders_delivered_today:     number;
  overdue_orders_count:       number;
  low_stock_sku_count:        number;
  total_stock_value_mvr:      number;
  shipments_in_transit:       number;
  pending_payments_mvr:       number;
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
    orders_dispatched_today:     0,
    orders_delivered_today:      0,
    overdue_orders_count:        0,
    low_stock_sku_count:         0,
    total_stock_value_mvr:       0,
    shipments_in_transit:        0,
    pending_payments_mvr:        0,
  }) as Metrics;

  const revenueMonth     = Number(m.revenue_this_month_mvr);
  const revenueLastMonth = Number(m.revenue_last_month_mvr);
  const grossProfit      = Number(m.gross_profit_this_month_mvr);
  const grossMargin      = Number(m.gross_margin_pct);
  const revenueToday     = Number(m.revenue_today_mvr);
  const stockValue       = Number(m.total_stock_value_mvr);
  const pendingPayments  = Number(m.pending_payments_mvr);
  const awaitingDispatch = Number(m.orders_awaiting_dispatch);
  const dispatchedToday  = Number(m.orders_dispatched_today);
  const deliveredToday   = Number(m.orders_delivered_today);
  const overdueOrders    = Number(m.overdue_orders_count);
  const lowStockCount    = Number(m.low_stock_sku_count);
  const inTransit        = Number(m.shipments_in_transit);

  const revChangePct = revenueLastMonth > 0
    ? ((revenueMonth - revenueLastMonth) / revenueLastMonth) * 100
    : null;

  const now           = new Date();
  const monthName     = now.toLocaleString("en-MV", { month: "long" });
  const lastMonthName = new Date(now.getFullYear(), now.getMonth() - 1).toLocaleString("en-MV", { month: "long" });
  const todayLabel    = now.toLocaleString("en-MV", { weekday: "short", day: "numeric", month: "short" });

  const hasAlerts = lowStockCount > 0 || overdueOrders > 0 || pendingPayments > 0;

  // Margin colour: red < 10%, amber < 20%, green ≥ 20%
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
            {/* Always show margin — colour signals health */}
            <p className="text-[11px] mt-1 font-semibold" style={{ color: marginColor }}>
              {grossMargin.toFixed(1)}% margin
            </p>
          </div>
        </div>

        {/* vs last month */}
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

        {/* Today strip — date makes zero values unambiguous */}
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
            <p className="label-caps text-[11px] mb-1" style={{ color: "var(--muted-foreground)" }}>Dispatched</p>
            <p className="text-sm font-semibold text-foreground">{dispatchedToday} orders</p>
          </div>
          <div>
            <p className="label-caps text-[11px] mb-1" style={{ color: "var(--muted-foreground)" }}>Awaiting Dispatch</p>
            <p
              className="text-sm font-semibold"
              style={{ color: awaitingDispatch > 0 ? "var(--snm-warning)" : "var(--foreground)" }}
            >
              {awaitingDispatch}
            </p>
          </div>
        </div>
      </div>

      {/* ── 2×2 metric grid — chevron signals tappable ── */}
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

        <Link href="/financials" className="snm-card rounded-2xl p-5 transition hover:opacity-90 active:scale-[0.97] block"
          style={{ border: "1px solid var(--glass-border-lo)" }}>
          <div className="flex justify-between items-start mb-3">
            <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>Uncollected</p>
            <Clock className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
          </div>
          <p
            className="text-2xl font-semibold"
            style={{ color: pendingPayments > 0 ? "var(--snm-error)" : "var(--foreground)" }}
          >
            {pendingPayments > 0 ? mvr(pendingPayments) : "—"}
          </p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {pendingPayments > 0 ? "MVR unpaid" : "All collected"}
            </p>
            <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
          </div>
        </Link>

        <Link href="/shipments" className="snm-card rounded-2xl p-5 transition hover:opacity-90 active:scale-[0.97] block"
          style={{ border: "1px solid var(--glass-border-lo)" }}>
          <div className="flex justify-between items-start mb-3">
            <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>In Transit</p>
            <Truck className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
          </div>
          <p className="text-2xl font-semibold text-foreground">{inTransit}</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>shipments en route</p>
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
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>orders completed</p>
            <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
          </div>
        </Link>

      </div>

      {/* ── Alerts — only shown when something needs attention ── */}
      {hasAlerts && (
        <div className="space-y-2">
          <p className="label-caps text-[11px] px-1" style={{ color: "var(--muted-foreground)" }}>Needs Attention</p>

          {overdueOrders > 0 && (
            <Link
              href="/dispatch"
              className="snm-card rounded-2xl p-4 flex items-center gap-4 transition hover:opacity-90 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-error) 28%, transparent)" }}
            >
              <div
                className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}
              >
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

          {lowStockCount > 0 && (
            <Link
              href="/inventory"
              className="snm-card rounded-2xl p-4 flex items-center gap-4 transition hover:opacity-90 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-warning) 28%, transparent)" }}
            >
              <div
                className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", color: "var(--snm-warning)" }}
              >
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

          {pendingPayments > 0 && (
            <Link
              href="/financials"
              className="snm-card rounded-2xl p-4 flex items-center gap-4 transition hover:opacity-90 active:scale-[0.98] block"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-error) 20%, transparent)" }}
            >
              <div
                className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}
              >
                <Clock className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {mvr(pendingPayments)} MVR uncollected
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Delivered orders awaiting payment
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

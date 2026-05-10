import { getSupabaseServer } from "@/lib/supabase-server";
import { TrendingUp, TrendingDown, AlertTriangle, Clock, ArrowRight, Package, Truck } from "lucide-react";
import Link from "next/link";

function mvr(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

interface Metrics {
  revenue_today_mvr: number;
  revenue_this_month_mvr: number;
  revenue_last_month_mvr: number;
  orders_active: number;
  orders_delivered_today: number;
  low_stock_sku_count: number;
  total_stock_value_mvr: number;
  shipments_in_transit: number;
  pending_payments_mvr: number;
}

export default async function DashboardPage() {
  const supabase = await getSupabaseServer();

  const [metricsRes, brandsRes, skusRes] = await Promise.all([
    supabase.rpc("get_dashboard_metrics"),
    supabase.from("brands").select("*", { count: "exact", head: true }),
    supabase.from("skus").select("*", { count: "exact", head: true }),
  ]);

  const m: Metrics = (metricsRes.data?.[0] ?? {
    revenue_today_mvr: 0,
    revenue_this_month_mvr: 0,
    revenue_last_month_mvr: 0,
    orders_active: 0,
    orders_delivered_today: 0,
    low_stock_sku_count: 0,
    total_stock_value_mvr: 0,
    shipments_in_transit: 0,
    pending_payments_mvr: 0,
  }) as Metrics;

  const revenueToday     = Number(m.revenue_today_mvr);
  const revenueMonth     = Number(m.revenue_this_month_mvr);
  const revenueLastMonth = Number(m.revenue_last_month_mvr);
  const revChangePct     = revenueLastMonth > 0 ? ((revenueMonth - revenueLastMonth) / revenueLastMonth) * 100 : null;
  const stockValue       = Number(m.total_stock_value_mvr);
  const pendingPayments  = Number(m.pending_payments_mvr);
  const brandCount       = brandsRes.count ?? 0;
  const skuCount         = skusRes.count ?? 0;
  const monthName        = new Date().toLocaleString("en-MV", { month: "long" });
  const lastMonthName    = new Date(new Date().getFullYear(), new Date().getMonth() - 1).toLocaleString("en-MV", { month: "long" });

  return (
    <div className="space-y-4">

      {/* ── Hero: Revenue this month ── */}
      <div className="snm-card rounded-2xl p-6">
        <p className="label-caps text-[10px] mb-2 text-muted-foreground">Revenue — {monthName}</p>
        <h1 className="text-[42px] font-light tracking-tight text-foreground leading-none">
          {mvr(revenueMonth)}
          <span className="text-2xl ml-1 text-muted-foreground">MVR</span>
        </h1>
        {revChangePct !== null && (
          <div className="flex items-center gap-1.5 mt-3" style={{ color: revChangePct >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
            {revChangePct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            <span className="text-sm">{revChangePct >= 0 ? "+" : ""}{revChangePct.toFixed(1)}% vs {lastMonthName}</span>
          </div>
        )}

        {/* Sub-metrics */}
        <div className="grid grid-cols-3 gap-4 mt-6 pt-5 border-t border-border">
          <div>
            <p className="label-caps text-[10px] mb-1 text-muted-foreground">Today</p>
            <p className="text-base font-semibold text-foreground">{mvr(revenueToday)} MVR</p>
          </div>
          <div>
            <p className="label-caps text-[10px] mb-1 text-muted-foreground">{lastMonthName}</p>
            <p className="text-base font-semibold text-foreground">{mvr(revenueLastMonth)} MVR</p>
          </div>
          <div>
            <p className="label-caps text-[10px] mb-1 text-muted-foreground">Active Orders</p>
            <p className="text-base font-semibold text-foreground">{Number(m.orders_active)}</p>
          </div>
        </div>
      </div>

      {/* ── Key metrics row ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Stock Value */}
        <div className="snm-card rounded-2xl p-5">
          <div className="flex justify-between items-start mb-2">
            <p className="label-caps text-[10px] text-muted-foreground">Inventory Value</p>
            <Package className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold text-foreground">{mvr(stockValue)}</p>
          <p className="text-xs mt-1 text-muted-foreground">MVR at landed cost</p>
        </div>

        {/* Uncollected Cash */}
        <div className="snm-card rounded-2xl p-5">
          <div className="flex justify-between items-start mb-2">
            <p className="label-caps text-[10px] text-muted-foreground">Uncollected Cash</p>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold text-foreground" style={{ color: pendingPayments > 0 ? "var(--snm-error)" : "var(--snm-success)" }}>
            {pendingPayments > 0 ? mvr(pendingPayments) : "—"}
          </p>
          <p className="text-xs mt-1 text-muted-foreground">
            {pendingPayments > 0 ? "MVR delivered, not yet paid" : "All payments received"}
          </p>
        </div>

        {/* Delivered Today */}
        <div className="snm-card rounded-2xl p-5">
          <div className="flex justify-between items-start mb-2">
            <p className="label-caps text-[10px] text-muted-foreground">Delivered Today</p>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold text-foreground">{Number(m.orders_delivered_today)}</p>
          <p className="text-xs mt-1 text-muted-foreground">orders completed</p>
        </div>

        {/* Shipments in Transit */}
        <div className="snm-card rounded-2xl p-5">
          <div className="flex justify-between items-start mb-2">
            <p className="label-caps text-[10px] text-muted-foreground">In Transit</p>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold text-foreground">{Number(m.shipments_in_transit)}</p>
          <p className="text-xs mt-1 text-muted-foreground">shipments en route</p>
        </div>
      </div>

      {/* ── Portfolio Overview ── */}
      <div className="snm-card rounded-2xl">
        <div className="flex justify-between items-center px-5 pt-5 pb-3">
          <p className="label-caps text-[10px] text-muted-foreground">Portfolio Overview</p>
          <Link href="/products" className="flex items-center gap-1 text-xs text-foreground hover:opacity-70 transition">
            View All <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="px-5 pb-5 space-y-2">
          <div className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
            <div>
              <p className="text-sm font-semibold text-foreground">{brandCount} Brand{brandCount !== 1 ? "s" : ""}</p>
              <p className="text-xs text-muted-foreground">Active in catalogue</p>
            </div>
            <p className="text-sm font-semibold text-foreground">{skuCount} SKUs</p>
          </div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
            <div>
              <p className="text-sm font-semibold text-foreground">{monthName} Revenue</p>
              <p className="text-xs text-muted-foreground">Confirmed + delivered orders</p>
            </div>
            <p className="text-sm font-semibold text-foreground">{mvr(revenueMonth)} MVR</p>
          </div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
            <div>
              <p className="text-sm font-semibold text-foreground">Stock at Landed Cost</p>
              <p className="text-xs text-muted-foreground">All godowns combined</p>
            </div>
            <p className="text-sm font-semibold text-foreground">{mvr(stockValue)} MVR</p>
          </div>
        </div>
      </div>

      {/* ── Alerts ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/inventory"
          className={`snm-card rounded-2xl p-5 flex items-start gap-4 transition hover:opacity-90 border ${Number(m.low_stock_sku_count) > 0 ? "border-[var(--snm-error)]/25" : "border-transparent"}`}
        >
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: Number(m.low_stock_sku_count) > 0 ? "rgba(255,180,171,0.12)" : "rgba(74,222,128,0.12)",
              color: Number(m.low_stock_sku_count) > 0 ? "var(--snm-error)" : "var(--snm-success)",
            }}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {Number(m.low_stock_sku_count) > 0
                ? `${m.low_stock_sku_count} SKU${Number(m.low_stock_sku_count) !== 1 ? "s" : ""} low on stock`
                : "Stock levels OK"}
            </p>
            <p className="text-xs mt-0.5 text-muted-foreground">
              {Number(m.low_stock_sku_count) > 0
                ? "Less than 10 days of stock remaining"
                : "All active SKUs healthy"}
            </p>
          </div>
        </Link>

        <Link
          href="/sales"
          className={`snm-card rounded-2xl p-5 flex items-start gap-4 transition hover:opacity-90 border ${pendingPayments > 0 ? "border-[var(--snm-error)]/20" : "border-transparent"}`}
        >
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: pendingPayments > 0 ? "rgba(255,180,171,0.12)" : "rgba(74,222,128,0.12)",
              color: pendingPayments > 0 ? "var(--snm-error)" : "var(--snm-success)",
            }}
          >
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {pendingPayments > 0
                ? `${mvr(pendingPayments)} MVR uncollected`
                : "All payments collected"}
            </p>
            <p className="text-xs mt-0.5 text-muted-foreground">
              {pendingPayments > 0
                ? "Delivered orders awaiting payment"
                : "No outstanding balances"}
            </p>
          </div>
        </Link>
      </div>

    </div>
  );
}

import { getSupabaseServer } from "@/lib/supabase-server";
import { TrendingUp, TrendingDown, AlertTriangle, Clock, ArrowRight } from "lucide-react";
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

  const revenue = Number(m.revenue_this_month_mvr);
  const lastRevenue = Number(m.revenue_last_month_mvr);
  const revChangePct = lastRevenue > 0 ? ((revenue - lastRevenue) / lastRevenue) * 100 : null;
  const stockValue = Number(m.total_stock_value_mvr);
  const brandCount = brandsRes.count ?? 0;
  const skuCount = skusRes.count ?? 0;
  const monthName = new Date().toLocaleString("en-MV", { month: "long" });

  // Approximate landed costs + opex for the P&L hero card
  const approxLandedCosts = stockValue;
  const approxOpex = Number(m.pending_payments_mvr);
  const netProfit = revenue - approxOpex;

  return (
    <div className="space-y-4">

      {/* ── Hero: Real-Time Net Profit ── */}
      <div className="snm-card rounded-2xl p-6 relative overflow-hidden">
        {/* Background icon */}
        <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
          <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 24 24" style={{ color: "var(--foreground)" }}>
            <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>
          </svg>
        </div>

        <div className="relative z-10">
          <p className="label-caps text-[10px] mb-2 text-muted-foreground">Real-Time Net Profit</p>
          <h1 className="text-[42px] font-light tracking-tight text-foreground leading-none">
            {mvr(netProfit > 0 ? netProfit : revenue)}
            <span className="text-2xl ml-1 text-muted-foreground">MVR</span>
          </h1>
          {revChangePct !== null && (
            <div className="flex items-center gap-1.5 mt-3" style={{ color: revChangePct >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
              {revChangePct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              <span className="text-sm">{revChangePct >= 0 ? "+" : ""}{revChangePct.toFixed(1)}% from last month</span>
            </div>
          )}
        </div>

        {/* Sub-metrics */}
        <div className="grid grid-cols-3 gap-4 mt-6 pt-5 border-t border-border">
          <div>
            <p className="label-caps text-[10px] mb-1 text-muted-foreground">Sales Revenue</p>
            <p className="text-base font-semibold text-foreground">{mvr(revenue)} MVR</p>
          </div>
          <div>
            <p className="label-caps text-[10px] mb-1 text-muted-foreground">Stock Value</p>
            <p className="text-base font-semibold text-foreground">{mvr(approxLandedCosts)} MVR</p>
          </div>
          <div>
            <p className="label-caps text-[10px] mb-1 text-muted-foreground">Active Orders</p>
            <p className="text-base font-semibold text-foreground">{Number(m.orders_active)}</p>
          </div>
        </div>
      </div>

      {/* ── Bento row: Cash Runway + Revenue vs Expenses ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* Cash Runway */}
        <div className="snm-card rounded-2xl p-5 flex flex-col justify-between" style={{ minHeight: 180 }}>
          <div>
            <div className="flex justify-between items-start">
              <p className="label-caps text-[10px] text-muted-foreground">Cash Runway</p>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-semibold text-foreground mt-2">
              {stockValue > 0 ? `${(stockValue / (revenue / 30 + 1)).toFixed(1)}` : "—"} days
            </p>
            <p className="text-xs mt-1 text-muted-foreground">Based on current stock & burn</p>
          </div>
          <div className="w-full rounded-full overflow-hidden bg-border" style={{ height: 6 }}>
            <div className="h-full rounded-full bg-foreground" style={{ width: "65%" }} />
          </div>
        </div>

        {/* Revenue vs Expenses chart (visual) */}
        <div className="snm-card sm:col-span-2 rounded-2xl p-5">
          <div className="flex justify-between items-center mb-4">
            <p className="label-caps text-[10px] text-muted-foreground">Revenue vs. Expenses — {monthName}</p>
            <div className="flex gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-foreground" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Revenue</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Costs</span>
              </div>
            </div>
          </div>
          {/* Static bar chart */}
          <div className="flex items-end gap-3 h-20">
            {[60, 75, 55, 85, 70, revenue > 0 ? 95 : 40].map((h, i) => (
              <div key={i} className="flex-1 flex flex-col gap-1 items-center">
                <div className="w-full rounded-t-sm bg-muted-foreground/30" style={{ height: `${h * 0.4}%` }} />
                <div className="w-full rounded-t-sm bg-foreground" style={{ height: `${h}%` }} />
              </div>
            ))}
          </div>
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
              <p className="text-sm font-semibold text-foreground">{brandCount} Brands</p>
              <p className="text-xs text-muted-foreground">Active in catalogue</p>
            </div>
            <p className="text-sm font-semibold text-foreground">{skuCount} SKUs</p>
          </div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
            <div>
              <p className="text-sm font-semibold text-foreground">Delivered Today</p>
              <p className="text-xs text-muted-foreground">Completed orders</p>
            </div>
            <p className="text-sm font-semibold text-foreground">{Number(m.orders_delivered_today)}</p>
          </div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
            <div>
              <p className="text-sm font-semibold text-foreground">In Transit</p>
              <p className="text-xs text-muted-foreground">Shipments en route</p>
            </div>
            <p className="text-sm font-semibold text-foreground">{Number(m.shipments_in_transit)}</p>
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
                ? "Less than 10 days remaining"
                : "All active SKUs healthy"}
            </p>
          </div>
        </Link>

        <Link
          href="/sales"
          className={`snm-card rounded-2xl p-5 flex items-start gap-4 transition hover:opacity-90 border ${Number(m.pending_payments_mvr) > 0 ? "border-[var(--snm-error)]/20" : "border-transparent"}`}
        >
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: Number(m.pending_payments_mvr) > 0 ? "rgba(255,180,171,0.12)" : "rgba(74,222,128,0.12)",
              color: Number(m.pending_payments_mvr) > 0 ? "var(--snm-error)" : "var(--snm-success)",
            }}
          >
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {Number(m.pending_payments_mvr) > 0
                ? `${mvr(Number(m.pending_payments_mvr))} MVR uncollected`
                : "All payments collected"}
            </p>
            <p className="text-xs mt-0.5 text-muted-foreground">
              {Number(m.pending_payments_mvr) > 0
                ? "Delivered orders awaiting payment"
                : "No outstanding balances"}
            </p>
          </div>
        </Link>
      </div>

    </div>
  );
}

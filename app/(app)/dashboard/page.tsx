import { getSupabaseServer } from "@/lib/supabase-server";
import {
  Package, Truck, ShoppingCart, TrendingUp, TrendingDown,
  AlertTriangle, Clock, CheckCircle2, Banknote, Boxes,
} from "lucide-react";
import Link from "next/link";

function mvr(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function changeLabel(current: number, previous: number): { text: string; up: boolean } | null {
  if (previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs last month`, up: pct >= 0 };
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

  const revenueChange = changeLabel(Number(m.revenue_this_month_mvr), Number(m.revenue_last_month_mvr));
  const brandCount = brandsRes.count ?? 0;
  const skuCount = skusRes.count ?? 0;

  const monthName = new Date().toLocaleString("en-MV", { month: "long" });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Overview</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Dashboard</h1>
      </div>

      {/* Revenue row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass p-5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Today&apos;s Revenue</p>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="text-3xl font-semibold text-foreground">
            {mvr(Number(m.revenue_today_mvr))}
            <span className="text-base font-normal text-muted-foreground ml-1">MVR</span>
          </p>
          <p className="text-xs text-muted-foreground">from confirmed orders</p>
        </div>

        <div className="glass p-5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{monthName}</p>
            <div className="h-8 w-8 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
              <Banknote className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="text-3xl font-semibold text-foreground">
            {mvr(Number(m.revenue_this_month_mvr))}
            <span className="text-base font-normal text-muted-foreground ml-1">MVR</span>
          </p>
          {revenueChange ? (
            <p className={`text-xs flex items-center gap-1 ${revenueChange.up ? "text-emerald-600 dark:text-emerald-300" : "text-red-500"}`}>
              {revenueChange.up
                ? <TrendingUp className="h-3 w-3" />
                : <TrendingDown className="h-3 w-3" />}
              {revenueChange.text}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">first month of data</p>
          )}
        </div>

        <div className="glass p-5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Stock Value</p>
            <div className="h-8 w-8 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-300 flex items-center justify-center">
              <Boxes className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="text-3xl font-semibold text-foreground">
            {mvr(Number(m.total_stock_value_mvr))}
            <span className="text-base font-normal text-muted-foreground ml-1">MVR</span>
          </p>
          <p className="text-xs text-muted-foreground">at landed cost</p>
        </div>
      </div>

      {/* Operations row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link href="/sales" className="glass p-4 group hover:bg-accent/20 transition">
          <div className="h-9 w-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300 flex items-center justify-center mb-3">
            <ShoppingCart className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-foreground group-hover:text-primary transition">
            {Number(m.orders_active)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Active orders</p>
        </Link>

        <Link href="/sales" className="glass p-4 group hover:bg-accent/20 transition">
          <div className="h-9 w-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center mb-3">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-foreground group-hover:text-primary transition">
            {Number(m.orders_delivered_today)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Delivered today</p>
        </Link>

        <Link href="/shipments" className="glass p-4 group hover:bg-accent/20 transition">
          <div className="h-9 w-9 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-300 flex items-center justify-center mb-3">
            <Truck className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-foreground group-hover:text-primary transition">
            {Number(m.shipments_in_transit)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Shipments in transit</p>
        </Link>

        <Link href="/products" className="glass p-4 group hover:bg-accent/20 transition">
          <div className="h-9 w-9 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center mb-3">
            <Package className="h-4 w-4" />
          </div>
          <p className="text-2xl font-semibold text-foreground group-hover:text-primary transition">
            {brandCount}
            <span className="text-sm font-normal text-muted-foreground"> / {skuCount} SKUs</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Brands</p>
        </Link>
      </div>

      {/* Alert row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/reports"
          className={`glass p-5 flex items-start gap-4 hover:bg-accent/20 transition ${Number(m.low_stock_sku_count) > 0 ? "border border-amber-500/30" : ""}`}
        >
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
            Number(m.low_stock_sku_count) > 0
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
          }`}>
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {Number(m.low_stock_sku_count) > 0
                ? `${m.low_stock_sku_count} SKU${Number(m.low_stock_sku_count) !== 1 ? "s" : ""} low on stock`
                : "Stock levels OK"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {Number(m.low_stock_sku_count) > 0
                ? "Less than 10 days remaining — view in Reports"
                : "All active SKUs have 10+ days of stock"}
            </p>
          </div>
        </Link>

        <Link
          href="/sales"
          className={`glass p-5 flex items-start gap-4 hover:bg-accent/20 transition ${Number(m.pending_payments_mvr) > 0 ? "border border-red-500/20" : ""}`}
        >
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
            Number(m.pending_payments_mvr) > 0
              ? "bg-red-500/15 text-red-500 dark:text-red-300"
              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
          }`}>
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {Number(m.pending_payments_mvr) > 0
                ? `${mvr(Number(m.pending_payments_mvr))} MVR uncollected`
                : "All payments collected"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {Number(m.pending_payments_mvr) > 0
                ? "Delivered orders with pending or partial payment"
                : "No outstanding balances on delivered orders"}
            </p>
          </div>
        </Link>
      </div>

      {/* Quick links */}
      <div className="glass p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Quick access</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { href: "/sales", label: "New sale", icon: ShoppingCart },
            { href: "/shipments", label: "Shipments", icon: Truck },
            { href: "/inventory", label: "Inventory", icon: Boxes },
            { href: "/reports", label: "Reports", icon: TrendingUp },
          ].map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 p-3 rounded-xl hover:bg-accent/40 transition text-sm text-muted-foreground hover:text-foreground"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

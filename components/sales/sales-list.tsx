"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, Plus, Search, ShoppingCart, CheckCircle2,
  Clock, Truck, Package, XCircle, UserPlus, ChevronRight, Trash2,
  Banknote, Smartphone, ArrowRight, X, Users, List, ChevronDown, ScanLine,
  Warehouse, TrendingUp,
} from "lucide-react";
import dynamic from "next/dynamic";

// Lazy-load the barcode scanner: it pulls in the heavy @zxing decoding library,
// which we don't want in this route's bundle. It only renders when the user taps
// the scan button, so we fetch the chunk on demand instead of on every visit.
const BarcodeScanner = dynamic(
  () => import("@/components/ui/barcode-scanner").then((m) => m.BarcodeScanner),
  { ssr: false },
);
import {
  listOrders, createOrder, nextOrderNumber, createOrderLine, postSale,
  getTierPricesForSkus,
  type SalesOrderRow, type OrderStatus, type OrderChannel, type SaleUom, type TierPrice,
} from "@/lib/queries/sales";
import {
  listCustomers, listGodowns,
  type CustomerRow, type GodownRow, type PriceTier,
} from "@/lib/queries/masters";
import { CustomerForm } from "@/components/masters/customer-form";
import { listSkusFlat, getCurrentUserRole, updateSku, type SkuFullRow } from "@/lib/queries/products";
import { SkuIdentity, PriceSourceTag } from "@/components/ui/sku-identity";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { listStockLevels, type StockLevel } from "@/lib/queries/inventory";
import { toPieces, describePriceSource } from "@/lib/queries/sales";
import { withOfflineFallback } from "@/lib/offline-write";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

// ── Styling constants ─────────────────────────────────────────────────────────

const CARD = {
  background: "var(--glass-1)",
  boxShadow: "var(--glass-shadow), var(--glass-inner)",
} as const;

const CARD_L2 = {
  background: "var(--glass-2)",
  boxShadow: "var(--glass-shadow-lg), var(--glass-inner)",
} as const;

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft", confirmed: "Confirmed", picked: "Picked",
  out_for_delivery: "Out for Delivery", delivered: "Delivered", cancelled: "Cancelled",
};

const STATUS_COLOR: Record<OrderStatus, { bg: string; text: string }> = {
  draft:            { bg: "var(--muted)",                   text: "var(--muted-foreground)" },
  confirmed:        { bg: "color-mix(in srgb, var(--snm-info) 12%, transparent)",  text: "var(--snm-info)"  },
  picked:           { bg: "color-mix(in srgb, var(--snm-warning) 15%, transparent)",  text: "var(--snm-warning)"      },
  out_for_delivery: { bg: "color-mix(in srgb, var(--snm-warning) 10%, transparent)",  text: "var(--snm-warning)"      },
  delivered:        { bg: "color-mix(in srgb, var(--snm-success) 15%, transparent)",  text: "var(--snm-success)"      },
  cancelled:        { bg: "color-mix(in srgb, var(--snm-error) 10%, transparent)",    text: "var(--snm-error)"        },
};

const STATUS_ICON: Record<OrderStatus, typeof Clock> = {
  draft: Clock, confirmed: CheckCircle2, picked: Package,
  out_for_delivery: Truck, delivered: CheckCircle2, cancelled: XCircle,
};

const CHANNELS: { value: OrderChannel; label: string }[] = [
  { value: "whatsapp",  label: "WhatsApp"  },
  { value: "viber",     label: "Viber"     },
  { value: "messenger", label: "Messenger" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok",    label: "TikTok"    },
  { value: "facebook",  label: "Facebook"  },
  { value: "phone",     label: "Phone"     },
  { value: "walkin",    label: "Walk-in"   },
  { value: "other",     label: "Other"     },
];


type PaymentMethod = "bank_transfer" | "cod";

interface DraftLine {
  key: string;
  sku: SkuFullRow;
  uom: SaleUom;
  qty: number;
  qty_pieces: number;
  unit_price_mvr: number;
  line_total_mvr: number;
  is_mixed_carton_fill: boolean;
}

// ── UOM intelligence ──────────────────────────────────────────────────────────
// Derives a human label for what a "pack" actually is for this SKU.
// The SaleUom value stays "pack" in the DB — only the display word changes.

function packLabel(sku: SkuFullRow): string {
  const fmt = String(sku.attributes?.format ?? "").toLowerCase();
  if (fmt === "bottle")  return "Bottle";
  if (fmt === "pouch")   return "Pouch";
  if (fmt === "sachet")  return "Sachet";
  if (fmt === "jar")     return "Jar";
  if (fmt === "can")     return "Can";
  if (fmt === "tube")    return "Tube";
  if (fmt === "box")     return "Box";
  // Fall back to unit_uom hint
  if (sku.unit_uom === "ml") return "Bottle";
  if (sku.unit_uom === "g")  return "Pouch";
  return "Pack";
}

// Default UOM for a SKU: liquids/powder sell by carton (master carton),
// diapers/unit goods sell by pack (single retail pack) — but never default to a
// tier the SKU isn't sold in (a carton-only product must default to carton).
function defaultUom(sku: SkuFullRow): SaleUom {
  const su = sku.sellable_units ?? ["pack", "carton"];
  const preferred: SaleUom = sku.unit_uom === "ml" || sku.unit_uom === "g" ? "carton" : "pack";
  if (su.includes(preferred)) return preferred;
  if (su.includes("carton")) return "carton";
  if (su.includes("pack")) return "pack";
  return "carton";
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function GlassSelect({ label, value, onChange, children }: {
  label?: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none appearance-none"
        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
      >
        {children}
      </select>
    </div>
  );
}

// ── Prominent warehouse picker ────────────────────────────────────────────────
// The godown a sale ships from decides which stock gets deducted, so a wrong
// pick is a real operational error. This makes it impossible to skip past: a
// brand-accented card with an icon and the chosen warehouse shown large, with
// the native <select> laid transparently over the whole card for tapping.
function WarehouseSelect({ value, onChange, godowns }: {
  value: string; onChange: (v: string) => void; godowns: GodownRow[];
}) {
  const selected = godowns.find((g) => g.id === value);
  return (
    <div
      className="relative rounded-2xl px-4 py-3.5 flex items-center gap-3.5"
      style={{
        background: "var(--snm-brand-muted)",
        border: "1.5px solid var(--snm-brand-border)",
      }}
    >
      <div
        className="shrink-0 flex items-center justify-center rounded-xl"
        style={{ width: 44, height: 44, background: "var(--snm-brand)" }}
      >
        <Warehouse className="h-6 w-6" style={{ color: "var(--snm-brand-on)" }} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] uppercase tracking-widest font-semibold" style={{ color: "var(--snm-brand-text)" }}>
          Ship from warehouse
        </p>
        <p className="ios-body font-bold text-foreground truncate">
          {selected ? `${selected.name}${selected.is_default ? " (default)" : ""}` : "Tap to choose warehouse"}
        </p>
      </div>
      <ChevronDown className="h-5 w-5 shrink-0" style={{ color: "var(--snm-brand-text)" }} />
      {/* Transparent native select covers the card so the whole thing is tappable */}
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        aria-label="Ship from warehouse"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {godowns.map((g) => (
          <option key={g.id} value={g.id}>{g.name}{g.is_default ? " (default)" : ""}</option>
        ))}
      </select>
    </div>
  );
}

// ── Order row (memoized — search re-renders SalesList on every keystroke,
// but a row only needs to re-render if its own order/customer changed) ──────

const OrderRow = memo(function OrderRow({ order: o, customer: cust }: { order: SalesOrderRow; customer?: CustomerRow }) {
  const Icon = STATUS_ICON[o.status];
  const colors = STATUS_COLOR[o.status];
  const total = o.order_total_mvr ?? 0;

  // Plain tappable row — Void/Delete live on the order detail screen
  // (one tap away via this link), so no per-row action affordance is
  // needed here.
  return (
    <Link href={`/sales/${o.id}`}
      className="flex items-center justify-between gap-3 p-4 rounded-2xl snm-pressable active:opacity-80"
      style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: colors.bg, color: colors.text }}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-foreground truncate">
            {cust?.name ?? "Walk-in"}
            <span className="ios-subhead ml-2 snm-num" style={{ color: "var(--muted-foreground)" }}>{o.order_number}</span>
          </p>
          <p className="ios-subhead truncate" style={{ color: "var(--muted-foreground)" }}>
            via {o.channel}{cust?.island && <> · {cust.island}</>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="text-right">
          {total > 0 && (
            <p className="text-[14px] font-semibold text-foreground snm-num">
              {total >= 1000 ? `${(total / 1000).toFixed(1)}K` : total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              <span className="ios-subhead font-medium ml-0.5" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
          )}
          <span className="text-[12px] uppercase tracking-widest font-semibold rounded-lg px-2 py-0.5 inline-block mt-0.5" style={{ background: colors.bg, color: colors.text }}>
            {STATUS_LABEL[o.status]}
          </span>
        </div>
        <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
      </div>
    </Link>
  );
});

// ── SalesList ─────────────────────────────────────────────────────────────────

export function SalesList() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  // ?filter=unpaid → pre-filter to delivered orders with pending payment
  const unpaidMode   = searchParams.get("filter") === "unpaid";

  const [rows, setRows] = useState<SalesOrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">(unpaidMode ? "delivered" : "all");
  const [newDialog, setNewDialog] = useState(false);
  const [groupBy, setGroupBy] = useState<"orders" | "customers">("orders");
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    getCurrentUserRole().then((r) => {
      setCanWrite(r !== "viewer");
    }).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [o, c, sk, g, lvl] = await Promise.all([
        listOrders(), listCustomers(), listSkusFlat(), listGodowns(), listStockLevels(),
      ]);
      setRows(o); setCustomers(c); setSkus(sk); setGodowns(g); setStockLevels(lvl);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    // Unpaid mode: further restrict to delivered orders with pending/partial payment
    if (unpaidMode) r = r.filter((x) => ["pending", "partial"].includes(x.payment_status));
    const term = q.trim().toLowerCase();
    if (term) r = r.filter((x) => {
      const cust = customerById.get(x.customer_id ?? "");
      return [x.order_number, cust?.name ?? "", cust?.phone ?? ""].join(" ").toLowerCase().includes(term);
    });
    return r;
  }, [rows, q, statusFilter, unpaidMode, customerById]);

  // Render cap for the flat list — at 100+ orders, rendering every row at
  // once is both a performance problem and a wall of near-identical cards to
  // scroll past. Search/filter already narrow `filtered` directly, so typing
  // a name always shows every match regardless of this cap; it only limits
  // the default unfiltered browse view. Resets to 20 whenever the filter set
  // changes so switching tabs/search never leaves a stale "Load more" state.
  const [visibleCount, setVisibleCount] = useState(20);
  useEffect(() => { setVisibleCount(20); }, [q, statusFilter, groupBy]);
  const visibleOrders = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Group by customer — collapse all orders per customer into one expandable row.
  // Walk-in orders are grouped under a single "Walk-in" bucket.
  const grouped = useMemo(() => {
    const map = new Map<string, { customer: CustomerRow | null; orders: SalesOrderRow[] }>();
    for (const o of filtered) {
      const key = o.customer_id ?? "__walkin__";
      const cust = o.customer_id ? customerById.get(o.customer_id) ?? null : null;
      if (!map.has(key)) map.set(key, { customer: cust, orders: [] });
      map.get(key)!.orders.push(o);
    }
    // Sort buckets: most recent order first
    return Array.from(map.values()).sort((a, b) => {
      const aDate = a.orders[0]?.created_at ?? "";
      const bDate = b.orders[0]?.created_at ?? "";
      return bDate.localeCompare(aDate);
    });
  }, [filtered, customerById]);

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-2.5 w-20 rounded-full" style={{ background: "var(--muted)" }} />
          <div className="h-8 w-24 rounded-xl" style={{ background: "var(--muted)" }} />
        </div>
        <div className="h-11 w-28 rounded-2xl" style={{ background: "var(--muted)" }} />
      </div>
      {/* Search bar */}
      <div className="h-12 rounded-2xl" style={{ background: "var(--muted)" }} />
      {/* Filter chips */}
      <div className="flex gap-2">
        {[64, 40, 72, 56, 80, 64].map((w, i) => (
          <div key={i} className="h-11 rounded-full shrink-0" style={{ width: w, background: "var(--muted)" }} />
        ))}
      </div>
      {/* Order cards */}
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-3 p-4 rounded-2xl" style={{ background: "var(--glass-1)" }}>
            <div className="h-10 w-10 rounded-xl shrink-0" style={{ background: "var(--muted)" }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-32 rounded-full" style={{ background: "var(--muted)" }} />
              <div className="h-2.5 w-20 rounded-full" style={{ background: "var(--muted)" }} />
            </div>
            <div className="h-6 w-16 rounded-lg" style={{ background: "var(--muted)" }} />
          </div>
          <div className="h-11 w-11 rounded-xl shrink-0" style={{ background: "var(--muted)" }} />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[12px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Operations</p>
          <h1 className="ios-page-title">Sales</h1>
        </div>
        {canWrite && (
          <button
            onClick={() => setNewDialog(true)}
            className="flex items-center gap-2 h-11 px-5 rounded-2xl text-sm font-semibold transition active:scale-95"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Plus className="h-4 w-4" /> New Sale
          </button>
        )}
      </div>

      {/* Unpaid filter banner — shown when arriving from dashboard */}
      {unpaidMode && (
        <div
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
          style={{
            background: "color-mix(in srgb, var(--snm-error) 8%, var(--glass-1))",
            border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)",
            boxShadow: "var(--glass-shadow), var(--glass-inner)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--snm-error)" }} />
            <p className="ios-subhead font-semibold text-foreground">
              Showing {filtered.length} unpaid delivered order{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => router.push("/sales")}
            className="ios-subhead font-medium shrink-0"
            style={{ color: "var(--muted-foreground)" }}
          >
            Clear ✕
          </button>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3 rounded-2xl px-4 h-12" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer…"
          aria-label="Search orders"
          className="flex-1 bg-transparent ios-subhead text-foreground placeholder:text-muted-foreground outline-none" />
        {q && (
          <button onClick={() => setQ("")} aria-label="Clear search" className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 active:opacity-60"
            style={{ color: "var(--muted-foreground)" }}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Status filter chips */}
      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {([
          { key: "all" as const, label: "All" },
          ...( Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => ({ key: s as "all" | OrderStatus, label: STATUS_LABEL[s] })),
        ]).map(({ key, label }) => {
          const active = statusFilter === key;
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className="shrink-0 h-11 px-4 rounded-full text-[14px] font-semibold transition active:scale-95"
              style={{
                background: active ? "var(--foreground)" : "var(--glass-1)",
                color:      active ? "var(--background)" : "var(--muted-foreground)",
                border:     active ? "none" : "0.5px solid var(--glass-border-lo)",
                touchAction: "manipulation",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* View toggle — Orders (flat) vs Customers (grouped) */}
      <div className="flex rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--glass-border-lo)", ...CARD }}>
        {([
          { val: "orders",    icon: List,  label: "Orders"    },
          { val: "customers", icon: Users, label: "Customers" },
        ] as const).map(({ val, icon: Icon, label }) => (
          <button key={val} onClick={() => setGroupBy(val)}
            className="flex-1 flex items-center justify-center gap-2 h-10 text-[14px] font-semibold transition"
            style={groupBy === val
              ? { background: "var(--foreground)", color: "var(--background)" }
              : { background: "transparent", color: "var(--muted-foreground)" }}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl p-10 flex flex-col items-center text-center space-y-3" style={CARD}>
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
            <ShoppingCart className="h-6 w-6 text-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">{rows.length === 0 ? "No sales yet" : "No matches"}</h3>
          <p className="ios-subhead max-w-sm" style={{ color: "var(--muted-foreground)" }}>
            {unpaidMode ? "All delivered orders have been paid. Nothing outstanding." : rows.length === 0 ? "Record a sale when a customer messages you on WhatsApp, Viber, or other channels." : "Try a different filter."}
          </p>
          {rows.length === 0 && (
            <button onClick={() => setNewDialog(true)} className="mt-2 h-11 px-6 rounded-2xl ios-subhead font-semibold"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              Record first sale
            </button>
          )}
        </div>

      ) : groupBy === "orders" ? (
        /* ── Flat order list ── */
        <div className="space-y-1.5">
          {visibleOrders.map((o) => (
            <OrderRow key={o.id} order={o} customer={customerById.get(o.customer_id ?? "")} />
          ))}
          {filtered.length > visibleOrders.length && (
            <button
              onClick={() => setVisibleCount((n) => n + 20)}
              className="w-full h-12 rounded-2xl ios-subhead font-semibold transition active:scale-[0.99]"
              style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}
            >
              Load more ({filtered.length - visibleOrders.length} more)
            </button>
          )}
        </div>

      ) : (
        /* ── Grouped by customer ── */
        <div className="space-y-2">
          {grouped.map(({ customer, orders }) => {
            const key = customer?.id ?? "__walkin__";
            const isOpen = expandedCustomers.has(key);
            const toggle = () => setExpandedCustomers((prev) => {
              const next = new Set(prev);
              isOpen ? next.delete(key) : next.add(key);
              return next;
            });
            const name = customer?.name ?? "Walk-in";
            const initials = name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
            // Count by status for the summary badge row
            const active = orders.filter((o) => !["delivered", "cancelled"].includes(o.status));
            const delivered = orders.filter((o) => o.status === "delivered").length;

            return (
              <div key={key} className="rounded-2xl overflow-hidden" style={CARD}>
                {/* Customer header row — always visible */}
                <button onClick={toggle} className="w-full flex items-center gap-3 px-4 py-3.5 text-left snm-pressable">
                  <div className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                    style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}>
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-foreground">{name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                        {orders.length} order{orders.length !== 1 ? "s" : ""}
                      </span>
                      {active.length > 0 && (
                        <span className="ios-subhead font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: "color-mix(in srgb, var(--snm-warning) 15%, transparent)", color: "var(--snm-warning)" }}>
                          {active.length} active
                        </span>
                      )}
                      {customer?.island && (
                        <span className="ios-subhead" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>{customer.island}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 mr-1">
                    <p className="ios-subhead font-semibold text-foreground">{delivered} done</p>
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>of {orders.length}</p>
                  </div>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 transition-transform"
                    style={{ color: "var(--muted-foreground)", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>

                {/* Expanded order rows */}
                {isOpen && (
                  <div style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                    {orders.map((o) => {
                      const Icon = STATUS_ICON[o.status];
                      const colors = STATUS_COLOR[o.status];
                      // Plain tappable row — Void/Delete live on the order
                      // detail screen, one tap away via this link.
                      return (
                        <Link key={o.id} href={`/sales/${o.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-3 snm-pressable"
                          style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: colors.bg, color: colors.text }}>
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <p className="ios-subhead font-semibold text-foreground">{o.order_number}</p>
                              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                                {new Date(o.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · via {o.channel}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[12px] uppercase tracking-widest font-semibold rounded-lg px-2 py-1" style={{ background: colors.bg, color: colors.text }}>
                              {STATUS_LABEL[o.status]}
                            </span>
                            <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)" }} />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {newDialog && canWrite && (
        <NewSaleSheet
          customers={customers} skus={skus} godowns={godowns}
          stockLevels={stockLevels} existingOrders={rows}
          onClose={() => setNewDialog(false)}
          onCreated={(id) => { setNewDialog(false); load(); if (id !== "reload") router.push(`/sales/${id}`); }}
          onCustomerCreated={(c) => setCustomers((prev) => [c, ...prev])}
        />
      )}

    </div>
  );
}

// ── NewSaleSheet ──────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

function NewSaleSheet({
  customers, skus, godowns, stockLevels, existingOrders, onClose, onCreated, onCustomerCreated,
}: {
  customers: CustomerRow[]; skus: SkuFullRow[]; godowns: GodownRow[];
  stockLevels: StockLevel[]; existingOrders: SalesOrderRow[];
  onClose: () => void; onCreated: (id: string) => void;
  onCustomerCreated: (c: CustomerRow) => void;
}) {
  // Portal target — mounted flag set in an effect (not a bare `typeof
  // document !== "undefined"` inline check), because that inline check
  // still evaluates during React's render pass and can race with
  // hydration: createPortal was thrown with "Target container is not a
  // DOM element" and crashed this entire component, silently falling back
  // to a broken render that LOOKED like the old, unfixed sheet — which is
  // exactly why the previous fix appeared to do nothing. Gating on a
  // state flag flipped inside useEffect guarantees this only ever runs
  // client-side, after mount, when document.body is unquestionably real.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  const [step, setStep] = useState<Step>(1);
  const [orderNumber] = useState(nextOrderNumber(existingOrders));
  const [channel, setChannel] = useState<OrderChannel>("whatsapp");

  // Step 1 — customer
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  // Order-level tier override — defaults to customer's tier, can be changed per order
  const [orderTier, setOrderTier] = useState<PriceTier>("retail");

  // Step 2 — products
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [skuSearch, setSkuSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [lineUom, setLineUom] = useState<SaleUom>("pack");
  const [lineQty, setLineQty] = useState("");
  const [linePrice, setLinePrice] = useState("");
  const [mixedCarton, setMixedCarton] = useState(false);
  const [godownId, setGodownId] = useState(() => (godowns.find((g) => g.is_default) ?? godowns[0])?.id ?? "");

  // Step 3 — payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [orderNotes, setOrderNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Tier pricing — fetched once when customer is confirmed and we move to step 2
  const [tierPrices, setTierPrices] = useState<Map<string, TierPrice>>(new Map());

  const customer = customers.find((c) => c.id === customerId);
  // Local price fixes made from the "why is this the price?" sheet (see
  // showPriceExplain below) — applied on top of the parent's `skus` list so
  // a correction is reflected immediately without leaving New Sale or
  // waiting for the parent to reload. The parent's own data refreshes
  // normally next time this screen loads.
  const [priceOverrides, setPriceOverrides] = useState<Record<string, Partial<SkuFullRow>>>({});
  const selectedSku = useMemo(() => {
    const base = skus.find((s) => s.id === selectedSkuId);
    if (!base) return base;
    const ov = priceOverrides[base.id];
    return ov ? { ...base, ...ov } : base;
  }, [skus, selectedSkuId, priceOverrides]);

  // ── Recent customers from localStorage (IDEO: Recents first) ──
  // Store the last 3 used customer IDs so repeat orders need zero search.
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("snm_recent_customers") ?? "[]"); }
    catch { return []; }
  });
  function touchRecentCustomer(id: string) {
    const next = [id, ...recentIds.filter((x) => x !== id)].slice(0, 3);
    setRecentIds(next);
    try { localStorage.setItem("snm_recent_customers", JSON.stringify(next)); } catch { /* ignore */ }
  }
  const recentCustomers = useMemo(() => {
    const pinned = recentIds.map((id) => customers.find((c) => c.id === id)).filter(Boolean) as CustomerRow[];
    // Fill remaining slots from the head of the list so there's always something to show
    const rest = customers.filter((c) => !recentIds.includes(c.id)).slice(0, Math.max(0, 5 - pinned.length));
    return [...pinned, ...rest].slice(0, 5);
  }, [customers, recentIds]);
  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return [];
    // Phone is the primary identity for repeat customers. Normalise both sides
    // (strip +960 / spaces / dashes) so typing "7712345" matches a stored
    // "+960 771 2345". Text still matches name/island as before.
    const digits = term.replace(/\D/g, "").replace(/^960/, "");
    const normPhone = (p: string | null) => (p ?? "").replace(/\D/g, "").replace(/^960/, "");
    return customers.filter((c) => {
      const textHit = [c.name, c.phone ?? "", c.island ?? ""].join(" ").toLowerCase().includes(term);
      const phoneHit = digits.length >= 3 && normPhone(c.phone).includes(digits);
      return textHit || phoneHit;
    }).slice(0, 10);
  }, [customers, customerSearch]);

  const filteredSkus = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    const matched = term
      ? active.filter((s) => [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""].join(" ").toLowerCase().includes(term))
      : active;
    // Stock in the CHOSEN godown vs across ALL godowns. Two different questions:
    // "where does it ship from" (chosen) vs "do we own it at all" (total).
    const stockFor = (s: SkuFullRow) =>
      godownId ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0 : 1;
    const totalStockFor = (s: SkuFullRow) =>
      stockLevels.filter((l) => l.sku_id === s.id).reduce((sum, l) => sum + l.qty_pieces, 0);
    // NEVER hide a product we own. Show every SKU with stock in ANY godown, so a
    // product sitting in another warehouse can't be mistaken for out-of-stock and
    // lose a sale (the card will say "None here · N in <other>"). Only SKUs with
    // zero stock EVERYWHERE drop to the bottom (dimmed). When searching by name we
    // show all matches so a typed product never vanishes.
    const pool = term ? matched : matched.filter((s) => totalStockFor(s) > 0);
    // Rank: in the chosen godown first, then owned-elsewhere, then zero-everywhere.
    const rank = (s: SkuFullRow) => (stockFor(s) > 0 ? 2 : totalStockFor(s) > 0 ? 1 : 0);
    const ranked = [...pool].sort((a, b) => rank(b) - rank(a));
    // Cap raised from the old flat-list limit — SKUs are now grouped by
    // brand/model (see normalSkus below), so this only needs to bound a
    // pathological catalogue size, not the visible row count.
    return ranked.slice(0, 400);
  }, [skus, skuSearch, godownId, stockLevels]);

  const stockHere = selectedSku && godownId
    ? stockLevels.find((l) => l.sku_id === selectedSku.id && l.godown_id === godownId)?.qty_pieces ?? 0
    : null;

  // ── Mixed-carton brands (e.g. Sosoft: 5 scents, sold as a carton the
  // customer fills with any mix) collapse to ONE card in the grid instead of
  // one per SKU — opening MixedCartonSheet instead of the single-SKU editor.
  // brands.mixed_carton_pieces is the data-driven flag (migration 0065):
  // any brand can opt in, nothing here is hardcoded to "Sosoft".
  const { normalSkus, mixedCartonGroups } = useMemo(() => {
    const groups = new Map<string, SkuFullRow[]>();
    const normal: SkuFullRow[] = [];
    for (const s of filteredSkus) {
      if (s.mixed_carton_pieces != null) {
        const arr = groups.get(s.brand_id) ?? [];
        arr.push(s);
        groups.set(s.brand_id, arr);
      } else {
        normal.push(s);
      }
    }
    return { normalSkus: normal, mixedCartonGroups: groups };
  }, [filteredSkus]);

  const [mixedCartonBrandId, setMixedCartonBrandId] = useState<string | null>(null);

  // ── Brand → Model grouping for the normal product grid ──
  // Mamypoko alone spans 5 model lines (Royal Soft, Royal Soft Boy/Girl,
  // Skin Comfort, Xtra Kering) — flattened by SKU this became a long scroll
  // of near-identical cards. Brand stays a fixed section label (never
  // collapses, always visible); each model underneath is independently
  // collapsible, same chevron-row control Products already uses for its
  // brand divider, one level deeper. Collapsed by default — New Sale's job
  // is scanning many brands fast, the opposite default from the Products
  // catalogue (which stays expanded since that screen IS the catalogue).
  const brandModelGroups = useMemo(() => {
    const brands = new Map<string, { brandId: string; brandName: string; models: Map<string, { modelId: string; modelName: string; skus: SkuFullRow[] }> }>();
    for (const s of normalSkus) {
      let brand = brands.get(s.brand_id);
      if (!brand) {
        brand = { brandId: s.brand_id, brandName: s.brand_name, models: new Map() };
        brands.set(s.brand_id, brand);
      }
      let model = brand.models.get(s.model_id);
      if (!model) {
        model = { modelId: s.model_id, modelName: s.model_name, skus: [] };
        brand.models.set(s.model_id, model);
      }
      model.skus.push(s);
    }
    return [...brands.values()].map((b) => ({ ...b, models: [...b.models.values()] }));
  }, [normalSkus]);

  // Empty = every model collapsed (the default). A model is expanded once
  // its id is in this set — inverted vs. Products' collapsedBrands because
  // that screen defaults to EXPANDED (nothing pre-hidden); this one defaults
  // to COLLAPSED, so tracking "expanded" avoids having to pre-seed every id.
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  function toggleModel(modelId: string) {
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId); else next.add(modelId);
      return next;
    });
  }

  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [showPriceExplain, setShowPriceExplain] = useState(false);
  // Quick-add on a below-cost SKU pauses for a deliberate choice — losing
  // money must never be a single accidental tap. Holds the pending add.
  const [belowCostAdd, setBelowCostAdd] = useState<{ sku: SkuFullRow; uom: ReturnType<typeof defaultUom>; price: number } | null>(null);

  function pushQuickLine(s: SkuFullRow, uom: ReturnType<typeof defaultUom>, price: number) {
    const pcs = toPieces(uom, 1, s.pcs_per_pack, s.packs_per_carton);
    setDraftLines((prev) => [...prev, {
      key: `${s.id}-${Date.now()}`,
      sku: s, uom, qty: 1,
      qty_pieces: pcs,
      unit_price_mvr: price,
      line_total_mvr: price,
      is_mixed_carton_fill: false,
    }]);
    toast.success(`${s.brand_name} ${s.variant_display} added`);
  }
  const [editingPrice, setEditingPrice] = useState(false);
  // Margin-simulator state for the inline price fix — mirrors the Pricing
  // screen's Margin Simulator exactly (slider drives a live price from
  // landed cost, always saved per-pack internally regardless of display
  // unit) so fixing a price here is never a disconnected typed number.
  const [simPackPrice, setSimPackPrice] = useState(0);
  const [simTyped, setSimTyped] = useState("");
  const [simEditingTyped, setSimEditingTyped] = useState(false);
  const [savingFixedPrice, setSavingFixedPrice] = useState<"margin" | "fixed" | null>(null);
  const [autoPriceSource, setAutoPriceSource] = useState<"price_list" | "sku_default" | "margin" | null>(null);

  // Lock the background page while this full-screen sheet is mounted (shared hook).
  useBodyScrollLock(true);

  function autoPrice(
    sku: typeof selectedSku,
    uom: SaleUom,
    isMixed: boolean,
  ): { price: string; source: "price_list" | "sku_default" | "margin" | null } {
    if (!sku) return { price: "", source: null };
    const tp = tierPrices.get(sku.id);
    // Mixed carton: charge the per-piece equivalent of the carton price
    if (isMixed && uom === "piece") {
      const pcsPerCarton = sku.pcs_per_pack * sku.packs_per_carton;
      if (pcsPerCarton > 0) {
        if (tp) {
          return { price: (tp.price_per_carton_mvr / pcsPerCarton).toFixed(4), source: tp.source };
        }
        const cartonPrice = sku.selling_price_per_carton_mvr;
        if (cartonPrice != null) {
          return { price: (cartonPrice / pcsPerCarton).toFixed(4), source: "sku_default" };
        }
      }
    }
    if (tp) {
      const p = uom === "piece" ? tp.price_per_piece_mvr
        : uom === "pack" ? tp.price_per_pack_mvr
        : tp.price_per_carton_mvr;
      return { price: p.toFixed(0), source: tp.source };
    }
    const p = uom === "piece" ? sku.selling_price_per_piece_mvr
      : uom === "pack" ? sku.selling_price_per_pack_mvr
      : sku.selling_price_per_carton_mvr;
    return { price: p != null ? p.toFixed(0) : "", source: p != null ? "sku_default" : null };
  }

  // When a new SKU is selected: set smart default UOM, then auto-fill price
  useEffect(() => {
    if (!selectedSku) return;
    const smartUom = defaultUom(selectedSku);
    setMixedCarton(false);
    const ap = autoPrice(selectedSku, smartUom, false);
    setLineUom(smartUom);
    setLinePrice(ap.price);
    setAutoPriceSource(ap.source);
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkuId, tierPrices]);

  // When UOM changes (user picks a different one): re-fill price, reset mixed carton
  useEffect(() => {
    if (!selectedSku) return;
    // Mixed carton only makes sense on piece UOM — auto-clear on UOM switch
    const nextMixed = lineUom === "piece" ? mixedCarton : false;
    if (lineUom !== "piece" && mixedCarton) setMixedCarton(false);
    const ap = autoPrice(selectedSku, lineUom, nextMixed);
    setLinePrice(ap.price);
    setAutoPriceSource(ap.source);
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineUom, tierPrices]);

  // When mixed carton toggle changes: re-fill price
  useEffect(() => {
    if (!selectedSku || lineUom !== "piece") return;
    const ap = autoPrice(selectedSku, lineUom, mixedCarton);
    setLinePrice(ap.price);
    setAutoPriceSource(ap.source);
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixedCarton]);

  function handlePriceChange(raw: string) {
    // Allow empty string while typing — don't restore auto price mid-keystroke
    setLinePrice(raw);
    if (raw === "") {
      setPriceManuallyEdited(false);
      // source stays — restored on blur if still empty
    } else {
      const ap = autoPrice(selectedSku, lineUom, mixedCarton);
      setPriceManuallyEdited(raw !== ap.price);
      if (raw !== ap.price) setAutoPriceSource(null);
      else setAutoPriceSource(ap.source);
    }
  }

  function handlePriceBlur() {
    // Only restore auto price on blur if field is empty
    if (linePrice === "") {
      const ap = autoPrice(selectedSku, lineUom, mixedCarton);
      setLinePrice(ap.price);
      setAutoPriceSource(ap.source);
      setPriceManuallyEdited(false);
    }
  }

  const lineQtyPieces = useMemo(() => {
    if (!selectedSku || !lineQty) return 0;
    const n = parseFloat(lineQty);
    if (isNaN(n) || n <= 0) return 0;
    return toPieces(lineUom, n, selectedSku.pcs_per_pack, selectedSku.packs_per_carton);
  }, [selectedSku, lineQty, lineUom]);

  // Guardrail on the manual price override — warns, never blocks (the rep
  // may genuinely intend a special price). Red: below what the goods cost
  // you. Amber: wildly different from the usual auto price, the classic
  // "typed the pack price on a carton line" mistake.
  const priceWarning = useMemo(() => {
    if (!selectedSku || linePrice === "") return null;
    const p = parseFloat(linePrice);
    if (isNaN(p) || p <= 0) return null;
    const perUom = lineUom === "carton" ? selectedSku.pcs_per_pack * selectedSku.packs_per_carton
      : lineUom === "pack" ? selectedSku.pcs_per_pack : 1;
    const landed = selectedSku.landed_per_piece_mvr;
    if (landed != null && landed > 0 && p / perUom < landed) {
      return { color: "var(--snm-error)", text: `Below cost — this ${lineUom} cost you ~MVR ${(landed * perUom).toFixed(0)}` };
    }
    const ap = autoPrice(selectedSku, lineUom, mixedCarton);
    const auto = ap.price ? parseFloat(ap.price) : NaN;
    if (!isNaN(auto) && auto > 0 && Math.abs(p - auto) / auto > 0.4) {
      return { color: "var(--snm-warning)", text: `Usual price is MVR ${auto.toFixed(0)} — double-check` };
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSku, linePrice, lineUom, mixedCarton]);

  const lineTotal = useMemo(() => {
    const q = parseFloat(lineQty); const p = parseFloat(linePrice);
    if (isNaN(q) || isNaN(p)) return 0;
    return q * p;
  }, [lineQty, linePrice]);

  const insufficient = stockHere !== null && lineQtyPieces > stockHere;
  const grandTotal = useMemo(() => draftLines.reduce((s, l) => s + l.line_total_mvr, 0), [draftLines]);


  function handleScanResult(code: string) {
    setShowScanner(false);
    const match = skus.find(
      (s) => s.internal_code === code || s.supplier_barcode === code,
    );
    if (match) {
      setSelectedSkuId(match.id);
      setSkuSearch("");
      toast.success(`Found: ${match.brand_name} ${match.variant_display}`);
    } else {
      setSkuSearch(code);
      toast.warning(`No SKU matched "${code}" — showing search results`);
    }
  }

  // The actual add — reached directly for healthy prices, or via the
  // below-cost confirm sheet. Both entry doors share one guard.
  function doAddLine() {
    if (!selectedSku || !lineQty || !linePrice || lineQtyPieces <= 0) return;
    setDraftLines((prev) => [...prev, {
      key: `${selectedSku.id}-${Date.now()}`,
      sku: selectedSku, uom: lineUom, qty: parseFloat(lineQty),
      qty_pieces: lineQtyPieces, unit_price_mvr: parseFloat(linePrice), line_total_mvr: lineTotal,
      is_mixed_carton_fill: lineUom === "piece" && mixedCarton,
    }]);
    setSelectedSkuId(""); setSkuSearch(""); setLineQty(""); setLinePrice(""); setLineUom("pack");
    setMixedCarton(false); setPriceManuallyEdited(false); setAutoPriceSource(null);
  }

  const [editorBelowCostConfirm, setEditorBelowCostConfirm] = useState(false);

  function handleAddLine() {
    if (!selectedSku || !lineQty || !linePrice || lineQtyPieces <= 0) return;
    const landed = selectedSku.landed_per_piece_mvr;
    const mult = lineUom === "carton" ? selectedSku.pcs_per_pack * selectedSku.packs_per_carton
               : lineUom === "pack" ? selectedSku.pcs_per_pack : 1;
    const pricePerPiece = parseFloat(linePrice) / mult;
    if (landed != null && pricePerPiece < landed) {
      setEditorBelowCostConfirm(true);
      return;
    }
    doAddLine();
  }

  // Create order + lines + immediately confirm (post_sale) in one shot
  async function handleSubmit() {
    if (draftLines.length === 0) return;
    setSaving(true);
    try {
      const cust = customers.find((c) => c.id === customerId);
      const orderPayload = {
        order_number: orderNumber,
        customer_id: customerId && customerId !== "walkin" ? customerId : null,
        channel: cust?.channel ?? channel,
        status: "draft" as const,
        source_godown_id: godownId || null,
        payment_method: paymentMethod,
        payment_status: "pending" as const,
        notes: orderNotes.trim() || null,
      };
      const linePayloads = draftLines.map((l) => ({
        sku_id: l.sku.id, uom: l.uom, qty: l.qty,
        qty_pieces: l.qty_pieces, unit_price_mvr: l.unit_price_mvr,
        line_total_mvr: l.line_total_mvr, is_mixed_carton_fill: l.is_mixed_carton_fill,
      }));

      const { queued } = await withOfflineFallback(
        async () => {
          const created = await createOrder(orderPayload);
          await Promise.all(linePayloads.map((l) => createOrderLine({ order_id: created.id, ...l })));
          await postSale(created.id);
          return created;
        },
        {
          table: "sales_orders",
          action: "insert",
          payload: { order: orderPayload, lines: linePayloads },
          tempId: `offline-${orderNumber}`,
        },
      );

      if (queued) {
        toast.success("Saved offline — will sync when connected", { duration: 4000 });
        onClose();
      } else {
        toast.success("Order placed — stock deducted");
        // result is the created order but onCreated needs the ID;
        // reload the list to pick up the new order
        onCreated("reload");
      }
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  const stepLabels: Record<Step, string> = { 1: "Customer", 2: "Products", 3: "Confirm" };

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex flex-col"
      style={{
        background: "var(--background)",
        touchAction: "none",
        // 100dvh = dynamic viewport height — shrinks when keyboard opens on iOS 15.4+
        // This is the correct, CSS-native solution. No JS measurement needed.
        height: "100dvh",
      }}
      onTouchMove={(e) => e.stopPropagation()}
    >

      {/* Header — safe-area aware, clears Dynamic Island / notch */}
      <header className="snm-overlay-header px-5 shrink-0">
        {/* Visible row sits BELOW the safe area inset */}
        <div className="flex items-center justify-between py-3.5">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="text-foreground opacity-60 active:opacity-100 text-xl">✕</button>
            <span className="text-[18px] font-bold text-foreground tracking-tight">New Sale</span>
          </div>
          <span className="snm-num ios-subhead font-mono" style={{ color: "var(--muted-foreground)" }}>{orderNumber}</span>
        </div>
      </header>

      {/* Content — takes all remaining space; touch-action auto re-enables scrolling inside */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-5 space-y-5 pb-6"
        style={{ touchAction: "pan-y", overscrollBehavior: "none" } as React.CSSProperties}
      >

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className="h-6 w-6 rounded-full flex items-center justify-center ios-subhead font-bold shrink-0 transition-all"
                style={step === s ? { background: "var(--foreground)", color: "var(--background)" }
                  : step > s ? { background: "color-mix(in srgb, var(--snm-success) 20%, transparent)", color: "var(--snm-success)" }
                  : { background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                {step > s ? "✓" : s}
              </div>
              <span className="ios-subhead" style={{ color: step === s ? "var(--foreground)" : "var(--muted-foreground)" }}>{stepLabels[s]}</span>
              {s < 3 && <div className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>

        {/* ── Step 1: Customer ── */}
        {step === 1 && (
          <div className="space-y-4">
            {!customerId && !showNewCustomer && (
              <>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-3 rounded-xl px-4 h-12" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                    <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                    <input autoFocus value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Search name, phone…"
                      className="flex-1 bg-transparent ios-subhead text-foreground placeholder:text-muted-foreground outline-none" />
                    {customerSearch && (
                      <button onClick={() => setCustomerSearch("")}
                        aria-label="Clear search"
                        className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 active:opacity-60"
                        style={{ color: "var(--muted-foreground)" }}>
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <button onClick={() => setShowNewCustomer(true)}
                    className="flex items-center gap-1.5 h-12 px-4 rounded-xl text-sm font-semibold transition"
                    style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>
                    <UserPlus className="h-4 w-4" /> New
                  </button>
                </div>

                <div>
                  {/* Pinned recent chips — 1-tap reselect for repeat orders */}
                  {!customerSearch.trim() && recentIds.length > 0 && (
                    <div className="flex gap-2 mb-3 flex-wrap">
                      {recentIds.map((id) => {
                        const rc = customers.find((c) => c.id === id);
                        if (!rc) return null;
                        return (
                          <button
                            key={id}
                            onClick={() => { const rc2 = customers.find((c) => c.id === id); setCustomerId(id); setOrderTier(rc2?.price_tier ?? "retail"); setChannel((rc2?.channel as OrderChannel) ?? "whatsapp"); touchRecentCustomer(id); }}
                            className="flex items-center gap-2 px-3 h-9 rounded-full ios-subhead font-semibold transition active:scale-95"
                            style={{
                              background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--snm-brand) 25%, transparent)",
                              color: "var(--snm-brand-text)",
                            }}
                          >
                            ★ {rc.name.split(" ")[0]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[12px] uppercase tracking-widest mb-3 font-medium" style={{ color: "var(--muted-foreground)" }}>
                    {customerSearch.trim() ? "Results" : "All Customers"}
                  </p>
                  <div className="space-y-1.5">
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).map((c) => {
                      const initials = c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                      return (
                        <button key={c.id}
                          onClick={() => { setCustomerId(c.id); setOrderTier(c.price_tier ?? "retail"); setChannel((c.channel as OrderChannel) ?? "whatsapp"); touchRecentCustomer(c.id); }}
                          className="w-full flex items-center gap-3 px-4 h-14 rounded-xl text-left transition active:scale-[0.99]"
                          style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                          <div className="h-9 w-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-semibold text-foreground truncate">{c.name}</p>
                            <p className="ios-subhead truncate" style={{ color: "var(--muted-foreground)" }}>{[c.island, c.channel].filter(Boolean).join(" · ")}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                        </button>
                      );
                    })}
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).length === 0 && (
                      <p className="ios-subhead py-4 text-center" style={{ color: "var(--muted-foreground)" }}>
                        {customerSearch.trim() ? "No matches." : "No customers yet."}
                      </p>
                    )}
                  </div>
                </div>

                <button onClick={() => setCustomerId("walkin")}
                  className="w-full h-12 rounded-xl text-sm font-semibold transition"
                  style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--muted-foreground)" }}>
                  Walk-in / No account
                </button>
              </>
            )}

            {showNewCustomer && !customerId && (
              <div className="rounded-xl py-4 flex flex-col" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", maxHeight: "70dvh" }}>
                <p className="ios-subhead font-bold text-foreground flex items-center gap-2 px-5 pb-2 shrink-0">
                  <UserPlus className="h-4 w-4" /> New Customer
                </p>
                {/* Same canonical form used on the Customers page — identical fields */}
                <CustomerForm
                  saveLabel="Create & Select"
                  existing={customers}
                  onPickExisting={(c) => {
                    setCustomerId(c.id);
                    setOrderTier(c.price_tier ?? "retail");
                    setChannel((c.channel as OrderChannel) ?? "whatsapp");
                    touchRecentCustomer(c.id);
                    setShowNewCustomer(false);
                  }}
                  onCancel={() => setShowNewCustomer(false)}
                  onSaved={(created) => {
                    onCustomerCreated(created);
                    setCustomerId(created.id);
                    setOrderTier(created.price_tier ?? "retail");
                    setChannel((created.channel as OrderChannel) ?? "whatsapp");
                    touchRecentCustomer(created.id);
                    setShowNewCustomer(false);
                  }}
                />
              </div>
            )}

            {customerId && customerId !== "walkin" && customer && (
              <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)" }}>
                {/* Customer identity row */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-semibold text-foreground">{customer.name}</p>
                    <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>{[customer.phone, customer.island, customer.channel].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button onClick={() => { setCustomerId(""); setCustomerSearch(""); setOrderTier("retail"); }}
                    className="ios-subhead font-semibold px-3 h-8 rounded-lg transition active:scale-95"
                    style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                    Change
                  </button>
                </div>

                {/* Order-level pricing tier — defaults to customer's tier, overrideable per order */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] uppercase tracking-widest font-semibold" style={{ color: "var(--muted-foreground)" }}>
                      Pricing tier for this order
                    </p>
                    {orderTier !== customer.price_tier && (
                      <button onClick={() => setOrderTier(customer.price_tier)}
                        className="ios-subhead font-semibold"
                        style={{ color: "var(--snm-brand-text)" }}>
                        Reset to default ({customer.price_tier})
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(["retail", "wholesale", "vip", "promo"] as PriceTier[]).map((t) => {
                      const isDefault = t === customer.price_tier;
                      const isActive = t === orderTier;
                      return (
                        <button key={t} type="button" onClick={() => setOrderTier(t)}
                          className="py-2 rounded-xl ios-subhead font-semibold capitalize transition active:scale-95 relative"
                          style={isActive
                            ? { background: "var(--foreground)", color: "var(--background)" }
                            : { background: "color-mix(in srgb, var(--foreground) 7%, transparent)", color: "var(--muted-foreground)" }}>
                          {t}
                          {isDefault && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{ background: "var(--snm-brand)" }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                    {orderTier !== customer.price_tier
                      ? `⚠ Override active — customer's default is ${customer.price_tier}`
                      : `Default tier for ${customer.name.split(" ")[0]}`}
                  </p>
                </div>
              </div>
            )}
            {customerId === "walkin" && (
              <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)" }}>
                <div>
                  <p className="text-[14px] font-semibold text-foreground">Walk-in customer</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>No account</p>
                </div>
                <button onClick={() => setCustomerId("")} className="ios-subhead text-foreground opacity-60 active:opacity-100">Change</button>
              </div>
            )}

            {customerId && (
              <GlassSelect label="Order received via" value={channel} onChange={(v) => setChannel(v as OrderChannel)}>
                {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </GlassSelect>
            )}
          </div>
        )}

        {/* ── Step 2: Products ── */}
        {step === 2 && (
          <div className="space-y-4">
            <WarehouseSelect value={godownId} onChange={setGodownId} godowns={godowns} />

            {/* Product picker */}
            {!selectedSkuId ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-3 rounded-xl px-4 h-12" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                    <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                    <input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)}
                      placeholder="Search brand, product, variant…"
                      aria-label="Search products"
                      className="flex-1 bg-transparent ios-subhead text-foreground placeholder:text-muted-foreground outline-none" autoComplete="off" />
                  </div>
                  {/* Scan button */}
                  <button
                    onClick={() => setShowScanner(true)}
                    style={{
                      width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                      background: "var(--snm-brand)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: "none", cursor: "pointer",
                      boxShadow: "0 4px 16px color-mix(in srgb, var(--snm-brand) 40%, transparent)",
                    }}
                    aria-label="Scan barcode"
                  >
                    <ScanLine size={20} color="var(--snm-brand-on)" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[...mixedCartonGroups.entries()].map(([brandId, groupSkus]) => {
                    const first = groupSkus[0];
                    const piecesNeeded = first.mixed_carton_pieces!;
                    const totalStock = groupSkus.reduce((sum, s) => {
                      const pcsPerCarton = s.pcs_per_pack * s.packs_per_carton || 1;
                      const stock = godownId
                        ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0
                        : stockLevels.filter((l) => l.sku_id === s.id).reduce((a, l) => a + l.qty_pieces, 0);
                      return sum + Math.floor(stock / pcsPerCarton);
                    }, 0);
                    const cartonPrice = first.selling_price_per_carton_mvr;
                    const outOfStock = totalStock <= 0;
                    const inCart = draftLines.filter((l) => l.is_mixed_carton_fill && groupSkus.some((s) => s.id === l.sku.id))
                      .reduce((a, l) => a + l.qty_pieces, 0) / piecesNeeded;
                    return (
                      <button key={brandId} onClick={() => !outOfStock && setMixedCartonBrandId(brandId)}
                        disabled={outOfStock}
                        className="w-full rounded-2xl p-4 text-left transition active:scale-[0.98]"
                        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", cursor: outOfStock ? "default" : "pointer" }}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="ios-headline font-semibold" style={{ color: outOfStock ? "var(--muted-foreground)" : "var(--foreground)" }}>
                            {first.brand_name}
                          </p>
                          <span className="ios-footnote font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "color-mix(in srgb, var(--snm-brand) 12%, transparent)", color: "var(--snm-brand-text)" }}>
                            Build a carton
                          </span>
                        </div>
                        <p className="ios-footnote mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                          {groupSkus.length} scents · mix any combo to fill {piecesNeeded}
                        </p>
                        <div className="flex items-end justify-between gap-2 mt-3" style={{ opacity: outOfStock ? 0.55 : 1 }}>
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-semibold" style={{ fontSize: 22, letterSpacing: "-0.02em", color: cartonPrice != null ? "var(--foreground)" : "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>
                              {cartonPrice != null ? cartonPrice.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "No GRN"}
                            </span>
                            {cartonPrice != null && <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>MVR / carton</span>}
                          </div>
                          <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                            {outOfStock ? "Out of stock" : `${totalStock} ctn in stock`}
                          </p>
                        </div>
                        {inCart > 0 && (
                          <span className="ios-footnote font-semibold shrink-0 px-2 py-0.5 rounded-full inline-block mt-2"
                            style={{ color: "var(--snm-brand-text)", background: "var(--snm-brand-muted)" }}>
                            {inCart} carton{inCart === 1 ? "" : "s"} in cart
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {brandModelGroups.map(({ brandId, brandName, models }) => (
                    <div key={brandId} className="col-span-1 sm:col-span-2">
                      {/* Brand — fixed section label, never collapses, always visible */}
                      <p className="label-caps text-[12px] px-1 pt-2 pb-1.5" style={{ color: "var(--muted-foreground)" }}>
                        {brandName}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {models.map(({ modelId, modelName, skus: modelSkus }) => {
                          // Every model behaves identically: collapsed by
                          // default, tap to expand. Search still force-
                          // expands so a typed match is never hidden.
                          const expanded = skuSearch.trim() !== "" || expandedModels.has(modelId);
                          return (
                            <div key={modelId} className="col-span-1 sm:col-span-2">
                              <button
                                onClick={() => toggleModel(modelId)}
                                aria-expanded={expanded}
                                className="w-full flex items-center gap-1.5 px-3 py-2 rounded-xl transition active:scale-[0.99]"
                                style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}
                              >
                                <ChevronDown
                                  className="h-3.5 w-3.5 shrink-0 transition-transform"
                                  style={{ color: "var(--muted-foreground)", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
                                />
                                <p className="ios-subhead font-semibold text-left flex-1" style={{ color: "var(--foreground)" }}>
                                  {modelName}
                                </p>
                                <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                                  {modelSkus.length} SKU{modelSkus.length !== 1 ? "s" : ""}
                                </p>
                              </button>
                              {expanded && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                                  {modelSkus.map((s) => {
                    const stock = godownId ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0 : null;
                    // Stock in OTHER godowns — so a product held in another warehouse
                    // is never mistaken for out-of-stock (would lose a real sale).
                    const otherGodownStock = stockLevels
                      .filter((l) => l.sku_id === s.id && l.godown_id !== godownId && l.qty_pieces > 0)
                      .map((l) => ({ name: godowns.find((g) => g.id === l.godown_id)?.name ?? "another godown", qty: l.qty_pieces }))
                      .sort((a, b) => b.qty - a.qty);
                    const elsewhereTotal = otherGodownStock.reduce((sum, g) => sum + g.qty, 0);
                    const pl = packLabel(s);
                    // Show price per default UOM on the card — tier price takes priority
                    const cardUom = defaultUom(s);
                    const tp = tierPrices.get(s.id);
                    const cardPrice = tp
                      ? (cardUom === "carton" ? tp.price_per_carton_mvr : tp.price_per_pack_mvr)
                      : (cardUom === "carton" ? s.selling_price_per_carton_mvr : s.selling_price_per_pack_mvr);
                    const cardUomLabel = cardUom === "carton" ? "carton" : pl.toLowerCase();
                    const hasPrice = cardPrice != null;

                    // Where did this price come from? Classify against the same
                    // source the RPC resolved + the SKU's cost/target so the
                    // salesperson never sells on a mystery number. Normalise the
                    // shown price to per-piece so margin math is unit-agnostic.
                    const cardPricePerPiece = cardPrice == null ? null
                      : cardUom === "carton" ? cardPrice / (s.pcs_per_pack * s.packs_per_carton)
                      : cardPrice / s.pcs_per_pack;
                    // A fixed price can come from any of three columns (per-piece
                    // default, or a per-pack/per-carton volume-break override —
                    // v_skus.selling_price_per_pack/carton_mvr prefers the tier
                    // override first). Checking only fixed_selling_price_mvr here
                    // missed that case entirely, leaving the card with NO source
                    // tag and no below-cost warning even though cardPrice itself
                    // was correctly reading the override.
                    const hasFixedOverride = s.fixed_selling_price_mvr != null
                      || (cardUom === "carton" ? s.fixed_price_per_carton_mvr != null : s.fixed_price_per_pack_mvr != null);
                    const cardProvenance = describePriceSource({
                      source: tp ? tp.source : (hasFixedOverride ? "sku_default" : (s.target_margin_pct ? "margin" : null)),
                      priceListName: tp?.price_list_name,
                      priceListDate: tp?.price_list_date,
                      pricePerPiece: cardPricePerPiece,
                      landedPerPiece: s.landed_per_piece_mvr,
                      targetMarginPct: s.target_margin_pct,
                    });
                    const inCart = draftLines.filter((l) => l.sku.id === s.id).reduce((a, l) => a + l.qty, 0);

                    // Work & Co: quick-add adds 1 unit of the default UOM directly to cart.
                    // Tapping the card body still opens the detail editor for custom qty/price.
                    function handleQuickAdd(e: React.MouseEvent) {
                      e.stopPropagation();
                      // Allow adding when stock exists in ANY godown; block only when
                      // out everywhere. Products in another warehouse are sellable.
                      if (!hasPrice || outOfStock) return;
                      // Below cost: pause for a deliberate choice instead of a
                      // silent one-tap loss (Ali, 12 Jul, with screenshot).
                      if (cardProvenance.belowCost) {
                        setBelowCostAdd({ sku: s, uom: cardUom, price: cardPrice! });
                        return;
                      }
                      pushQuickLine(s, cardUom, cardPrice!);
                    }

                    const hereQty = stock ?? 0;
                    const noneHere = godownId != null && godownId !== "" && hereQty <= 0;
                    // Genuinely unavailable ONLY when zero in every godown. A product
                    // in another warehouse stays sellable (ships from there).
                    const outOfStock = noneHere && elsewhereTotal <= 0;
                    // Convert a piece count into the card's default unit label.
                    const qtyLabel = (pcs: number) => {
                      const dUom = defaultUom(s);
                      if (dUom === "carton" && s.pcs_per_pack > 0 && s.packs_per_carton > 0) {
                        const c = Math.floor(pcs / (s.pcs_per_pack * s.packs_per_carton));
                        return c > 0 ? `${c} ctn` : "< 1 ctn";
                      }
                      if (s.pcs_per_pack > 0) {
                        const p = Math.floor(pcs / s.pcs_per_pack);
                        const pll = packLabel(s).toLowerCase();
                        return p > 0 ? `${p} ${pll}s` : `< 1 ${pll}`;
                      }
                      return `${pcs} pcs`;
                    };
                    // Availability line: in-stock here / none here but elsewhere / out everywhere.
                    const stockLabel = stock == null ? null
                      : hereQty > 0 ? `${qtyLabel(hereQty)} in stock`
                      : elsewhereTotal > 0 ? `None here · ${qtyLabel(elsewhereTotal)} in ${otherGodownStock[0].name}`
                      : "Out of stock";
                    const inOtherGodown = noneHere && elsewhereTotal > 0;

                    return (
                      <div key={s.id} className="relative">
                        <button onClick={() => setSelectedSkuId(s.id)}
                          disabled={outOfStock}
                          className="w-full rounded-2xl p-4 text-left transition active:scale-[0.98]"
                          style={{
                            ...CARD,
                            border: "0.5px solid var(--glass-border-lo)",
                            cursor: outOfStock ? "default" : "pointer",
                          }}>
                          {/* Identity — same block as every other picker in the app */}
                          <div className="pr-9">
                            <SkuIdentity
                              brandName={s.brand_name} modelName={s.model_name} variantDisplay={s.variant_display}
                              pcsPerPack={s.pcs_per_pack} packsPerCarton={s.packs_per_carton}
                              separator="·"
                              dimmed={outOfStock}
                            />
                          </div>

                          {/* Price + availability — one neutral row, one accent only */}
                          <div className="flex items-end justify-between gap-2 mt-3" style={{ opacity: outOfStock ? 0.55 : 1 }}>
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-1.5 flex-wrap">
                                <span className="font-semibold" style={{ fontSize: 22, letterSpacing: "-0.02em", color: hasPrice ? "var(--foreground)" : "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>
                                  {hasPrice ? cardPrice!.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "No GRN"}
                                </span>
                                {hasPrice && <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>MVR / {cardUomLabel}</span>}
                                {hasPrice && cardProvenance.source && (
                                  <span className="ml-0.5" style={{ position: "relative", top: 1 }}>
                                    <PriceSourceTag provenance={cardProvenance} />
                                  </span>
                                )}
                              </div>
                              <p className="ios-footnote mt-0.5" style={{ color: inOtherGodown ? "var(--snm-info)" : "var(--muted-foreground)", fontWeight: inOtherGodown ? 600 : 400 }}>
                                {stockLabel ?? " "}
                              </p>
                            </div>
                            {inCart > 0 && (
                              <span className="ios-footnote font-semibold shrink-0 px-2 py-0.5 rounded-full"
                                style={{ color: "var(--snm-brand-text)", background: "var(--snm-brand-muted)" }}>
                                {inCart} in cart
                              </span>
                            )}
                          </div>
                        </button>
                        {/* Quick-add — the single brand accent, present only when sellable */}
                        {hasPrice && !outOfStock && (
                          <button
                            onClick={handleQuickAdd}
                            className="absolute bottom-4 right-4 h-9 w-9 rounded-full flex items-center justify-center transition active:scale-90"
                            style={{
                              background: "var(--snm-brand)",
                              color: "var(--snm-brand-on)",
                              fontSize: 20,
                              fontWeight: 600,
                              lineHeight: 1,
                              boxShadow: "0 2px 10px color-mix(in srgb, var(--snm-brand) 35%, transparent)",
                            }}
                            aria-label={`Quick add ${s.brand_name} ${s.variant_display}`}
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {normalSkus.length === 0 && mixedCartonGroups.size === 0 && (
                    <p className="ios-subhead col-span-2 py-4 text-center" style={{ color: "var(--muted-foreground)" }}>
                      {skuSearch.trim()
                        ? "No products match your search."
                        : godownId
                          ? `No stock in ${godowns.find((g) => g.id === godownId)?.name ?? "this warehouse"}. Choose another warehouse or receive stock first.`
                          : "No products found."}
                    </p>
                  )}
                </div>
              </div>
            ) : selectedSku ? (() => {
              // ── Expert UX (Frog/IDEO/NNG): Display mode by default, edit on tap ──
              // No autoFocus. Qty uses +/− steppers — keyboard never opens automatically.
              // Price shows read-only; tap the pencil to edit it inline.
              // Keyboard only appears when user explicitly taps a field.
              const pl = packLabel(selectedSku);
              const uomLabel = lineUom === "carton" ? "Carton" : lineUom === "piece" ? "Piece" : pl;
              const qtyNum = parseFloat(lineQty) || 0;
              const hasNoPrice = !linePrice && selectedSku.landed_per_piece_mvr != null;

              // Cost + margin context
              const landed = selectedSku.landed_per_piece_mvr;
              const costForUom = landed == null ? null
                : lineUom === "piece" ? landed
                : lineUom === "pack"  ? landed * selectedSku.pcs_per_pack
                : landed * selectedSku.pcs_per_pack * selectedSku.packs_per_carton;
              const priceVal = parseFloat(linePrice);
              const margin = (costForUom != null && !isNaN(priceVal) && priceVal > 0)
                ? ((priceVal - costForUom) / priceVal) * 100 : null;

              // Price provenance — SAME classifier as the grid, so the tag the
              // salesperson saw while scanning matches what they see in the editor.
              // When the user has manually overridden the price, that's its own
              // state ("Edited") — provenance no longer describes an auto source.
              const tp = tierPrices.get(selectedSku.id);
              const editorPricePerPiece = !isNaN(priceVal) && priceVal > 0
                ? priceVal / (lineUom === "carton" ? selectedSku.pcs_per_pack * selectedSku.packs_per_carton : lineUom === "pack" ? selectedSku.pcs_per_pack : 1)
                : null;
              const editorProvenance = describePriceSource({
                source: priceManuallyEdited ? null : autoPriceSource,
                priceListName: tp?.price_list_name,
                priceListDate: tp?.price_list_date,
                pricePerPiece: editorPricePerPiece,
                landedPerPiece: selectedSku.landed_per_piece_mvr,
                targetMarginPct: selectedSku.target_margin_pct,
              });

              return (
                <div className="space-y-3">
                  {/* ── Product identity card — always visible, never obscured ── */}
                  <div className="rounded-2xl p-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                    <div className="flex items-start justify-between mb-3 gap-3">
                      <SkuIdentity
                        brandName={selectedSku.brand_name} modelName={selectedSku.model_name} variantDisplay={selectedSku.variant_display}
                        pcsPerPack={selectedSku.pcs_per_pack} packsPerCarton={selectedSku.packs_per_carton}
                        separator="·"
                        size="card"
                      />
                      <button
                        onClick={() => { setSelectedSkuId(""); setLineQty(""); setLinePrice(""); setPriceManuallyEdited(false); }}
                        className="shrink-0 ios-subhead font-semibold px-3 h-8 rounded-lg transition active:scale-95"
                        style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                        Change
                      </button>
                    </div>

                    {/* Stock + cost + margin in one clean row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {stockHere !== null && (
                        <span className="ios-subhead font-semibold px-2.5 py-1 rounded-full"
                          style={{ background: stockHere === 0 ? "color-mix(in srgb, var(--snm-error) 12%, transparent)" : "color-mix(in srgb, var(--snm-success) 12%, transparent)", color: stockHere === 0 ? "var(--snm-error)" : "var(--snm-success)" }}>
                          {stockHere === 0 ? "Out of stock" : (() => {
                            const dUom = defaultUom(selectedSku);
                            if (dUom === "carton" && selectedSku.pcs_per_pack > 0 && selectedSku.packs_per_carton > 0) {
                              const ctns = Math.floor(stockHere / (selectedSku.pcs_per_pack * selectedSku.packs_per_carton));
                              return ctns > 0 ? `${ctns} ctn in stock` : "< 1 ctn";
                            }
                            if (selectedSku.pcs_per_pack > 0) {
                              const pks = Math.floor(stockHere / selectedSku.pcs_per_pack);
                              return `${pks} ${packLabel(selectedSku).toLowerCase()}s in stock`;
                            }
                            return `${stockHere.toLocaleString()} pcs`;
                          })()}
                        </span>
                      )}
                      {costForUom != null && (
                        <span className="ios-subhead px-2.5 py-1 rounded-full" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)", color: "var(--muted-foreground)" }}>
                          Cost {costForUom.toFixed(lineUom === "piece" ? 4 : 2)} MVR/{uomLabel.toLowerCase()}
                        </span>
                      )}
                      {margin !== null && costForUom != null && (() => {
                        // Plain money, not accountant-speak: "Makes MVR 25/pack",
                        // never "-5.8% margin". Profit in rufiyaa is what the owner
                        // actually thinks in; percentages live in Financials.
                        const profit = priceVal - costForUom;
                        const amt = Math.abs(profit) >= 10 ? Math.abs(profit).toFixed(0) : Math.abs(profit).toFixed(2);
                        const u = uomLabel.toLowerCase();
                        return (
                          <span className="ios-subhead font-bold px-2.5 py-1 rounded-full"
                            style={{ background: profit >= 0 ? "color-mix(in srgb, var(--snm-success) 12%, transparent)" : "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: profit >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                            {profit >= 0 ? `Makes MVR ${amt}/${u} · ${Math.round((profit / priceVal) * 100)}%` : `Loses MVR ${amt}/${u}`}
                          </span>
                        );
                      })()}
                    </div>

                    {/* No GRN warning */}
                    {selectedSku.landed_per_piece_mvr == null && (
                      <p className="ios-subhead mt-2 font-medium" style={{ color: "var(--snm-warning)" }}>
                        ⚠ No confirmed shipment — confirm a GRN first
                      </p>
                    )}

                    {/* Below-target-margin warning — suggestion only, never blocks the sale.
                        Distinct from the red "below 0%" badge above: this fires even on a
                        still-profitable sale if it undercuts the owner's own target margin. */}
                    {margin !== null && margin >= 0 && selectedSku.target_margin_pct != null && margin < selectedSku.target_margin_pct && (
                      <p className="ios-subhead mt-2 font-medium" style={{ color: "var(--snm-warning)" }}>
                        ⚠ Less profit than you usually aim for ({selectedSku.target_margin_pct}%)
                      </p>
                    )}
                  </div>

                  {/* ── UOM segmented control — only the tiers this SKU sells in.
                      sellable_units drives it: carton-only products show just
                      Carton; pack-sellable products also allow loose pieces. ── */}
                  <div className="rounded-2xl p-1 flex gap-1" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}>
                    {((): SaleUom[] => {
                      const su = selectedSku.sellable_units ?? ["pack", "carton"];
                      const opts: SaleUom[] = [];
                      if (su.includes("carton")) opts.push("carton");
                      if (su.includes("pack")) opts.push("pack");
                      // Loose pieces allowed when the SKU sells pieces, or packs
                      // (breaking a pack open is a real over-the-counter sale).
                      if (su.includes("piece") || su.includes("pack")) opts.push("piece");
                      return opts.length ? opts : ["carton"];
                    })().map((u) => {
                      const label = u === "carton" ? `Carton (${selectedSku.packs_per_carton} ${pl}s)` : u === "pack" ? pl : `Piece (${selectedSku.pcs_per_pack}/${pl})`;
                      return (
                        <button key={u} onClick={() => setLineUom(u)}
                          className="flex-1 py-2.5 rounded-xl ios-subhead font-semibold transition active:scale-95"
                          style={lineUom === u
                            ? { background: "var(--foreground)", color: "var(--background)" }
                            : { color: "var(--muted-foreground)" }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Mixed carton toggle — only visible when selling by piece ── */}
                  {lineUom === "piece" && (
                    <button
                      type="button"
                      onClick={() => setMixedCarton((v) => !v)}
                      className="w-full flex items-center justify-between px-4 h-12 rounded-xl transition active:scale-[0.99]"
                      style={{
                        background: mixedCarton
                          ? "color-mix(in srgb, var(--snm-brand) 10%, var(--glass-1))"
                          : "var(--glass-1)",
                        border: mixedCarton
                          ? "1px solid color-mix(in srgb, var(--snm-brand) 30%, transparent)"
                          : "0.5px solid var(--glass-border-lo)",
                      }}
                    >
                      <div className="text-left">
                        <p className="ios-subhead font-semibold" style={{ color: mixedCarton ? "var(--snm-brand)" : "var(--foreground)" }}>
                          Mixed carton fill
                        </p>
                        <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                          {mixedCarton
                            ? `Charging carton rate ÷ ${selectedSku.pcs_per_pack * selectedSku.packs_per_carton} pcs`
                            : "Customer assembles their own mixed carton"}
                        </p>
                      </div>
                      <div
                        className="w-10 h-6 rounded-full flex items-center transition-all shrink-0 ml-3"
                        style={{
                          background: mixedCarton ? "var(--snm-brand)" : "color-mix(in srgb, var(--foreground) 15%, transparent)",
                          padding: "2px",
                          justifyContent: mixedCarton ? "flex-end" : "flex-start",
                        }}
                      >
                        <div className="w-5 h-5 rounded-full" style={{ background: "var(--background)" }} />
                      </div>
                    </button>
                  )}

                  {/* ── Qty stepper + Price display — the key UX insight ──
                      Qty: large +/− stepper, no keyboard.
                      Price: shown read-only. Tap pencil → inline input appears.
                      Keyboard only fires when the user deliberately asks for it. ── */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Qty stepper */}
                    <div className="rounded-2xl p-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                      <p className="text-[12px] uppercase tracking-widest mb-3 font-semibold" style={{ color: "var(--muted-foreground)" }}>
                        QTY · {uomLabel}S
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => { const n = Math.max(0, qtyNum - 1); setLineQty(n > 0 ? String(n) : ""); }}
                          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-bold transition active:scale-90"
                          style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--foreground)" }}>
                          −
                        </button>
                        {/* Tapping the number opens the keyboard for direct entry */}
                        <input
                          type="number" inputMode="numeric" min="1"
                          value={lineQty}
                          onChange={(e) => setLineQty((e.target as HTMLInputElement).value)}
                          placeholder="0"
                          className="flex-1 text-center text-[28px] font-bold bg-transparent text-foreground outline-none"
                          style={{ minWidth: 0 }}
                        />
                        <button
                          onClick={() => setLineQty(String(qtyNum + 1))}
                          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-bold transition active:scale-90"
                          style={{ background: "var(--foreground)", color: "var(--background)" }}>
                          +
                        </button>
                      </div>
                    </div>

                    {/* Price — display until tapped */}
                    <div className="rounded-2xl p-4" style={{ ...CARD, border: hasNoPrice ? "1px solid color-mix(in srgb, var(--snm-warning) 40%, transparent)" : "0.5px solid var(--glass-border-lo)" }}>
                      <p className="text-[12px] uppercase tracking-widest mb-3 font-semibold flex items-center gap-1.5" style={{ color: "var(--muted-foreground)" }}>
                        MVR / {uomLabel}
                        {priceManuallyEdited && linePrice ? (
                          <span className="ios-subhead px-1.5 py-0.5 rounded font-semibold" style={{ background: "var(--snm-brand-muted)", color: "var(--snm-brand-text)" }}>
                            Edited
                          </span>
                        ) : editorProvenance.source ? (
                          <PriceSourceTag provenance={editorProvenance} size="md" onClick={() => setShowPriceExplain(true)} />
                        ) : null}
                      </p>
                      {/* Single input — no autoFocus, displays cleanly, editable on tap */}
                      <input
                        type="number" inputMode="decimal" step="0.01" min="0"
                        value={linePrice}
                        onChange={(e) => handlePriceChange((e.target as HTMLInputElement).value)}
                        onBlur={handlePriceBlur}
                        placeholder={hasNoPrice ? "Tap to set" : "0.00"}
                        className="w-full text-[28px] font-bold bg-transparent text-foreground outline-none text-center"
                        style={{ minWidth: 0 }}
                      />
                      {costForUom != null && !isNaN(priceVal) && priceVal > 0 && priceVal - costForUom >= 0 && (() => {
                        const profit = priceVal - costForUom;
                        const amt = profit >= 10 ? profit.toFixed(0) : profit.toFixed(2);
                        return (
                          <p className="w-full ios-subhead text-center mt-1 font-semibold leading-tight" style={{ color: "var(--snm-success)" }}>
                            Makes MVR {amt}/{uomLabel.toLowerCase()} · {Math.round((profit / priceVal) * 100)}%
                          </p>
                        );
                      })()}
                      {!priceManuallyEdited && editorProvenance.source && editorProvenance.detail && (
                        <button
                          type="button"
                          onClick={() => setShowPriceExplain(true)}
                          className="w-full ios-subhead text-center mt-1 leading-tight underline"
                          style={{ color: "var(--muted-foreground)", textUnderlineOffset: 2 }}
                        >
                          {editorProvenance.detail}
                        </button>
                      )}
                      {priceWarning && (
                        <button
                          type="button"
                          onClick={() => setShowPriceExplain(true)}
                          className="w-full ios-subhead text-center mt-1 font-semibold leading-tight underline"
                          style={{ color: priceWarning.color, textUnderlineOffset: 2 }}
                        >
                          ⚠ {priceWarning.text}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Line total — only shown once qty > 0 ── */}
                  {lineQtyPieces > 0 && (
                    <div className="flex items-center justify-between px-1">
                      <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>= {lineQtyPieces.toLocaleString()} pcs total</span>
                      <span className="text-[18px] font-bold text-foreground">MVR {lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {insufficient && (
                    <p className="ios-subhead font-semibold px-1" style={{ color: "var(--snm-error)" }}>
                      ⚠ Only {stockHere} pcs available in this warehouse
                    </p>
                  )}

                  {/* ── "Where did this price come from?" — answers exactly
                      what's driving the number on screen, plain language,
                      with a direct tap-through to go fix it. Never leaves
                      Ali staring at a number with no explanation. ── */}
                  {showPriceExplain && portalReady && createPortal(
                    // Portalled to document.body — NOT rendered inside
                    // NewSaleSheet's own `fixed inset-x-0 top-0` container.
                    // A `position: fixed` element nested inside ANOTHER fixed
                    // element is a known iOS Safari compositing trap: the
                    // inner fixed layer can fail to promote above the
                    // outer's later-painted children (here, the outer
                    // sheet's own pinned footer), so the footer visibly
                    // showed through UNDER this sheet's buttons on a real
                    // phone despite a higher z-index — z-index only
                    // resolves stacking within the SAME containing block, and
                    // nesting fixed-in-fixed silently creates a new one.
                    // Portalling to <body> guarantees this sheet is a true
                    // sibling of the page, not a descendant of any other
                    // fixed element, so it always paints on top of
                    // everything with no ambiguity.
                    <div
                      className="fixed inset-0 z-[80] flex items-end snm-scrim-in"
                      style={{ background: "var(--scrim-bg)", touchAction: "none" }}
                      onClick={() => { setShowPriceExplain(false); setEditingPrice(false); setSimEditingTyped(false); }}
                    >
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
                        style={{
                          background: "var(--background)",
                          borderTop: "0.5px solid var(--glass-border-lo)",
                          boxShadow: "var(--glass-shadow-lg)",
                          // Reaches the TRUE bottom of the screen — never a
                          // percentage guess. A 70dvh sheet left the real
                          // bottom 30% of the viewport exposed to the page
                          // underneath, which is exactly what showed through
                          // as "the old footer bleeding in below the sheet"
                          // on a real phone. maxHeight caps it so short
                          // content doesn't force the sheet absurdly tall.
                          maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
                        }}
                      >
                        {/* Fixed header — grabber + title stay pinned */}
                        <div className="shrink-0 px-5 pt-3">
                          <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />
                          <h2 className="text-lg font-semibold text-foreground text-center">Where this price comes from</h2>
                        </div>

                        {/* Scrollable body — the ONLY scroll region */}
                        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pt-4" style={{ touchAction: "pan-y" }}>
                          <div className="rounded-2xl p-4 space-y-2" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                            {editorProvenance.source === "sku_default" && (
                              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                                This is the <strong>fixed selling price</strong> saved on this product — not calculated from a formula, someone typed it in directly when the product was set up.
                              </p>
                            )}
                            {editorProvenance.source === "margin" && (
                              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                                This price is <strong>calculated automatically</strong>: landed cost {landed != null ? `(MVR ${landed.toFixed(2)}/pc)` : ""} plus a target margin of <strong>{selectedSku?.target_margin_pct ?? Math.round(editorProvenance.marginPct ?? 0)}%</strong>.
                              </p>
                            )}
                            {editorProvenance.source === "price_list" && (
                              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                                This price comes from a <strong>customer price list</strong>{editorProvenance.detail ? ` — ${editorProvenance.detail}` : ""}.
                              </p>
                            )}
                            {landed != null && (
                              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                                What this product costs you landed: <strong style={{ color: "var(--foreground)" }}>MVR {landed.toFixed(2)} / piece</strong>.
                              </p>
                            )}
                            {margin != null && (
                              <p className="ios-subhead" style={{ color: margin < 0 ? "var(--snm-error)" : "var(--foreground)" }}>
                                At the price shown, you're making <strong>{margin.toFixed(1)}% margin</strong>{margin < 0 ? " — you are losing money on this sale." : "."}
                              </p>
                            )}
                          </div>

                          {/* Inline price fix — the same Margin Simulator used
                              on the Pricing screen (slider + typed-override,
                              saved as either an auto-recalculating target
                              margin or a locked fixed price), not a bare
                              number box. Never leaves New Sale. Editing a
                              customer's price list is a bigger, separate job
                              (multiple tiers/SKUs) so that case still
                              deep-links out. */}
                          {editingPrice && (editorProvenance.source === "sku_default" || editorProvenance.source === "margin") && selectedSku && landed != null && (() => {
                            const pcsPerPack = selectedSku.pcs_per_pack || 1;
                            const packsPerCarton = selectedSku.packs_per_carton || 1;
                            const landedPerPack = landed * pcsPerPack;
                            const landedPerCarton = landedPerPack * packsPerCarton;
                            const simPiecePrice  = simPackPrice / pcsPerPack;
                            const simCartonPrice = simPackPrice * packsPerCarton;
                            const simDisplayPrice = lineUom === "piece" ? simPiecePrice : lineUom === "carton" ? simCartonPrice : simPackPrice;
                            const simLandedForUom = lineUom === "piece" ? landed : lineUom === "carton" ? landedPerCarton : landedPerPack;
                            const currentMarginPct = simPackPrice > 0 ? Math.round(((simPackPrice - landedPerPack) / simPackPrice) * 100) : 0;
                            const sliderVal = Math.max(1, Math.min(99, currentMarginPct));
                            const fillPct = ((sliderVal - 1) / 98) * 100;
                            const impliedMarginPct = landedPerPack > 0 && simPackPrice > landedPerPack
                              ? Math.round(((simPackPrice - landedPerPack) / simPackPrice) * 1000) / 10
                              : 0;

                            function setDisplayPrice(v: number) {
                              const asPack = lineUom === "piece" ? v * pcsPerPack : lineUom === "carton" ? v / packsPerCarton : v;
                              setSimPackPrice(asPack);
                            }

                            return (
                              <div className="rounded-2xl p-4 mt-3 space-y-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                                {/* Live price display — pencil to type an exact override */}
                                <div className="rounded-2xl px-5 pt-5 pb-4 text-center relative"
                                  style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}>
                                  {!simEditingTyped && (
                                    <button
                                      onClick={() => { setSimTyped(String(Math.round(simDisplayPrice))); setSimEditingTyped(true); }}
                                      className="absolute top-3 right-3 h-7 w-7 rounded-lg flex items-center justify-center transition active:scale-90"
                                      style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
                                      aria-label="Type exact price"
                                    >
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--muted-foreground)" }}>
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                      </svg>
                                    </button>
                                  )}
                                  {simEditingTyped ? (
                                    <input
                                      type="number" inputMode="decimal" autoFocus
                                      value={simTyped}
                                      onChange={(e) => setSimTyped(e.target.value)}
                                      onBlur={() => { const v = parseFloat(simTyped); if (!isNaN(v) && v > 0) setDisplayPrice(v); setSimEditingTyped(false); }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") { const v = parseFloat(simTyped); if (!isNaN(v) && v > 0) setDisplayPrice(v); setSimEditingTyped(false); }
                                        if (e.key === "Escape") setSimEditingTyped(false);
                                      }}
                                      className="text-[44px] font-light tracking-tight text-foreground text-center bg-transparent outline-none border-none w-full"
                                    />
                                  ) : (
                                    <p className="text-[44px] font-light tracking-tight text-foreground leading-none">{Math.round(simDisplayPrice)}</p>
                                  )}
                                  <p className="ios-subhead mt-1 font-medium" style={{ color: "var(--muted-foreground)" }}>MVR / {uomLabel.toLowerCase()}</p>
                                </div>

                                {/* Margin slider — always computed per-pack to avoid tiny-number drift */}
                                <div className="rounded-2xl px-5 py-4" style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}>
                                  <style>{`
                                    .snm-slider2 { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 9999px; outline: none; cursor: pointer; background: transparent; }
                                    .snm-slider2::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 32px; height: 32px; border-radius: 50%; background: var(--snm-brand); box-shadow: 0 2px 16px var(--snm-brand-muted); cursor: grab; border: 3px solid rgba(255,255,255,0.75); margin-top: -13px; }
                                    .snm-slider2::-moz-range-thumb { width: 32px; height: 32px; border-radius: 50%; background: var(--snm-brand); box-shadow: 0 2px 16px var(--snm-brand-muted); cursor: grab; border: 3px solid rgba(255,255,255,0.75); }
                                    .snm-slider2::-webkit-slider-runnable-track { height: 6px; border-radius: 9999px; }
                                    .snm-slider2::-moz-range-track { height: 6px; border-radius: 9999px; background: rgba(128,128,128,0.2); }
                                  `}</style>
                                  <div className="flex items-center justify-between mb-4">
                                    <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Margin</p>
                                    <div className="flex items-baseline gap-0.5">
                                      <p className="text-[28px] font-bold leading-none" style={{ color: "var(--snm-brand-text)" }}>{sliderVal}</p>
                                      <p className="text-[16px] font-semibold leading-none" style={{ color: "var(--muted-foreground)" }}>%</p>
                                    </div>
                                  </div>
                                  <div className="relative">
                                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full overflow-hidden pointer-events-none"
                                      style={{ background: "color-mix(in srgb, var(--foreground) 12%, transparent)" }}>
                                      <div className="h-full rounded-full" style={{ width: `${fillPct}%`, background: "var(--snm-brand)" }} />
                                    </div>
                                    <input
                                      type="range" min={1} max={99} step={1} value={sliderVal}
                                      onChange={(e) => {
                                        const pct = parseInt(e.target.value);
                                        if (landedPerPack > 0) setSimPackPrice(Math.round(landedPerPack / (1 - pct / 100)));
                                      }}
                                      className="snm-slider2 relative"
                                      style={{ touchAction: "none" }}
                                    />
                                  </div>
                                  <div className="flex justify-between mt-1">
                                    <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>1%</p>
                                    <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>99%</p>
                                  </div>
                                </div>

                                <p className="ios-subhead text-center" style={{ color: simDisplayPrice <= simLandedForUom ? "var(--snm-error)" : "var(--muted-foreground)" }}>
                                  Costs you {simLandedForUom.toFixed(2)} — {simDisplayPrice <= simLandedForUom ? "still below cost" : "you're above cost"}
                                </p>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Fixed footer — always visible, never scrolled past */}
                        <div className="shrink-0 flex flex-col gap-2 px-5 pt-3" style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
                          {editingPrice && (editorProvenance.source === "sku_default" || editorProvenance.source === "margin") && selectedSku && landed != null ? (() => {
                            const pcsPerPack = selectedSku.pcs_per_pack || 1;
                            const packsPerCarton = selectedSku.packs_per_carton || 1;
                            const landedPerPack = landed * pcsPerPack;
                            const piecePrice = simPackPrice / pcsPerPack;
                            const impliedMarginPct = landedPerPack > 0 && simPackPrice > landedPerPack
                              ? Math.round(((simPackPrice - landedPerPack) / simPackPrice) * 1000) / 10
                              : 0;
                            const displayNewPrice = lineUom === "piece" ? piecePrice : lineUom === "carton" ? simPackPrice * packsPerCarton : simPackPrice;
                            const canSave = simPackPrice > landedPerPack;

                            async function save(mode: "margin" | "fixed") {
                              if (!selectedSku || !canSave) return;
                              setSavingFixedPrice(mode);
                              try {
                                // v_skus resolves price per tier independently — a
                                // leftover fixed_price_per_pack/carton_mvr from an
                                // old volume-break override beats BOTH
                                // fixed_selling_price_mvr and target_margin_pct at
                                // that tier, silently reviving the stale price the
                                // next time this SKU loads. Whichever mode is
                                // chosen here must win at every tier, so always
                                // clear all three fixed-price columns first.
                                const cleared = { fixed_selling_price_mvr: null, fixed_price_per_pack_mvr: null, fixed_price_per_carton_mvr: null, target_margin_pct: null };
                                if (mode === "fixed") {
                                  await updateSku(selectedSku.id, { ...cleared, fixed_selling_price_mvr: piecePrice });
                                  setPriceOverrides((prev) => ({ ...prev, [selectedSku.id]: { ...prev[selectedSku.id], ...cleared, fixed_selling_price_mvr: piecePrice } }));
                                } else {
                                  await updateSku(selectedSku.id, { ...cleared, target_margin_pct: impliedMarginPct });
                                  setPriceOverrides((prev) => ({ ...prev, [selectedSku.id]: { ...prev[selectedSku.id], ...cleared, target_margin_pct: impliedMarginPct } }));
                                }
                                setLinePrice(String(Math.round(displayNewPrice)));
                                setPriceManuallyEdited(false);
                                setAutoPriceSource(mode === "fixed" ? "sku_default" : "margin");
                                toast.success(mode === "fixed" ? `Fixed price saved — MVR ${piecePrice.toFixed(2)}/pc` : `${impliedMarginPct}% margin saved`);
                                setEditingPrice(false);
                                setShowPriceExplain(false);
                              } catch (e) {
                                toast.error((e as Error).message);
                              } finally {
                                setSavingFixedPrice(null);
                              }
                            }

                            return (
                              <>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setEditingPrice(false)}
                                    className="flex-1 h-12 rounded-xl font-semibold"
                                    style={{ background: "var(--secondary)", color: "var(--foreground)" }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    disabled={!!savingFixedPrice || !canSave}
                                    onClick={() => save("margin")}
                                    className="flex-[2] h-12 rounded-xl font-semibold transition disabled:opacity-40 flex items-center justify-center gap-2"
                                    style={{ background: "var(--snm-brand)", color: "var(--snm-on-fill)" }}
                                  >
                                    {savingFixedPrice === "margin" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><TrendingUp className="h-4 w-4" /> Save at {impliedMarginPct}% margin</>}
                                  </button>
                                </div>
                                <button
                                  disabled={!!savingFixedPrice || !canSave}
                                  onClick={() => save("fixed")}
                                  className="h-11 w-full rounded-xl ios-subhead font-semibold transition disabled:opacity-40 flex items-center justify-center gap-1.5"
                                  style={{ background: "var(--secondary)", color: "var(--foreground)" }}
                                >
                                  {savingFixedPrice === "fixed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Or lock as fixed price · MVR ${Math.round(displayNewPrice)}`}
                                </button>
                              </>
                            );
                          })() : (editorProvenance.source === "sku_default" || editorProvenance.source === "margin") && selectedSku ? (
                            <button
                              onClick={() => {
                                // Seed the simulator from the current price so
                                // the slider/thumb starts exactly where the
                                // shown price already is, not from zero.
                                const pcsPerPack = selectedSku.pcs_per_pack || 1;
                                const cur = parseFloat(linePrice) || 0;
                                const asPack = lineUom === "piece" ? cur * pcsPerPack : lineUom === "carton" ? cur / (selectedSku.packs_per_carton || 1) : cur;
                                setSimPackPrice(asPack > 0 ? asPack : (selectedSku.landed_per_piece_mvr ?? 0) * pcsPerPack * 1.3);
                                setEditingPrice(true);
                              }}
                              className="h-12 w-full rounded-xl font-semibold"
                              style={{ background: "var(--foreground)", color: "var(--background)" }}
                            >
                              Fix this product&apos;s price
                            </button>
                          ) : null}
                          {editorProvenance.source === "price_list" && (
                            <button
                              onClick={() => { window.location.href = "/pricelists"; }}
                              className="h-12 w-full rounded-xl font-semibold"
                              style={{ background: "var(--foreground)", color: "var(--background)" }}
                            >
                              Manage price lists →
                            </button>
                          )}
                          {!editingPrice && (
                            <button onClick={() => setShowPriceExplain(false)} className="h-12 w-full rounded-xl font-semibold" style={{ background: "var(--secondary)", color: "var(--foreground)" }}>
                              Close
                            </button>
                          )}
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
              );
            })() : null}

            {/* Draft lines */}
            {draftLines.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                <p className="px-4 pt-3 pb-2 text-[12px] uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
                  Order items · {draftLines.length}
                </p>
                {draftLines.map((l) => {
                  const pl = packLabel(l.sku);
                  const uomWord = l.uom === "carton" ? "carton" : l.uom === "piece" ? "pc" : pl.toLowerCase();
                  return (
                  <div key={l.key} className="flex items-center justify-between gap-3 px-4 py-3 ios-subhead" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-foreground truncate">{l.sku.brand_name} · {l.sku.model_name}</p>
                        {l.is_mixed_carton_fill && (
                          <span className="ios-subhead font-bold px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                            MIXED CTN
                          </span>
                        )}
                      </div>
                      <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{l.qty} {uomWord} · MVR {l.unit_price_mvr.toLocaleString()}/{uomWord}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-foreground font-semibold ios-subhead snm-num">MVR {l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      <button onClick={() => setDraftLines((p) => p.filter((x) => x.key !== l.key))} className="opacity-40 active:opacity-100">
                        <Trash2 className="h-3.5 w-3.5 text-foreground" />
                      </button>
                    </div>
                  </div>
                  );
                })}
                <div className="flex justify-between px-4 py-3 ios-subhead font-semibold" style={{ borderTop: "0.5px solid var(--glass-border-lo)", background: "var(--glass-bg-1)" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>Total</span>
                  <span className="text-foreground snm-num">MVR {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Confirm + Payment ── */}
        {step === 3 && (
          <div className="space-y-4">

            {/* Order total hero */}
            <div className="rounded-2xl p-5" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
              <p className="text-[12px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Order Total</p>
              <p className="text-[36px] font-bold tracking-tight text-foreground leading-none mb-1 tabular-nums">
                {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="text-[16px] ml-1.5" style={{ color: "var(--muted-foreground)" }}>MVR</span>
              </p>
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                {draftLines.length} item{draftLines.length !== 1 ? "s" : ""} · {customerId === "walkin" ? "Walk-in" : (customer?.name ?? "—")} · via {CHANNELS.find((c) => c.value === channel)?.label}
              </p>
            </div>

            {/* Line items */}
            <div className="rounded-xl overflow-hidden" style={CARD}>
              {draftLines.map((l, i) => {
                const pl = packLabel(l.sku);
                const uomWord = l.uom === "carton" ? "carton" : l.uom === "piece" ? "pc" : pl.toLowerCase();
                return (
                  <div key={l.key} className="flex items-center justify-between gap-2 px-4 py-3 ios-subhead" style={{ borderBottom: i < draftLines.length - 1 ? "0.5px solid var(--glass-border-lo)" : "none" }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-foreground truncate">{l.sku.brand_name} · {l.sku.model_name} · {l.sku.variant_display}</p>
                        {l.is_mixed_carton_fill && (
                          <span className="ios-subhead font-bold px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                            MIXED CTN
                          </span>
                        )}
                      </div>
                      <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{l.qty} {uomWord} · MVR {l.unit_price_mvr.toLocaleString()}/{uomWord}</p>
                    </div>
                    <span className="text-foreground font-semibold ios-subhead shrink-0">MVR {l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                );
              })}
            </div>

            {/* Payment method */}
            <div className="space-y-2">
              <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>How will the customer pay?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod("bank_transfer")}
                  className="rounded-xl p-4 text-left transition active:scale-95 space-y-2"
                  style={{ ...CARD, border: paymentMethod === "bank_transfer" ? "2px solid var(--foreground)" : "0.5px solid var(--glass-border-lo)" }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
                    <Smartphone className="h-4 w-4 text-foreground" />
                  </div>
                  <p className="ios-subhead font-semibold text-foreground">Bank Transfer</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>They send payment slip via WhatsApp / Viber</p>
                </button>
                <button
                  onClick={() => setPaymentMethod("cod")}
                  className="rounded-xl p-4 text-left transition active:scale-95 space-y-2"
                  style={{ ...CARD, border: paymentMethod === "cod" ? "2px solid var(--foreground)" : "0.5px solid var(--glass-border-lo)" }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
                    <Banknote className="h-4 w-4 text-foreground" />
                  </div>
                  <p className="ios-subhead font-semibold text-foreground">Cash on Delivery</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Driver collects cash, hands it to you</p>
                </button>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>Delivery notes (optional)</p>
              <textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="e.g. Leave at the gate, call before arriving…"
                rows={2}
                className="w-full px-4 py-3 rounded-xl ios-subhead text-foreground outline-none resize-none"
                style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }} />
            </div>

            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
              Placing this order will immediately deduct stock from the warehouse.
            </p>
          </div>
        )}
      </div>

      {/* Fixed bottom actions */}
      <footer className="snm-overlay-footer shrink-0 px-5 gap-3" style={{ paddingTop: "12px" }}>
        {step === 1 && (
          <>
            <button onClick={onClose} className="flex-1 h-14 rounded-xl ios-subhead font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>Cancel</button>
            <button disabled={!customerId} onClick={async () => {
                try {
                  const skuIds = skus.map((s) => s.id);
                  const map = await getTierPricesForSkus(skuIds, orderTier);
                  setTierPrices(map);
                } catch {
                  // Non-fatal: fall back to SKU defaults
                  setTierPrices(new Map());
                }
                setStep(2);
              }}
              className="flex-[2] h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              Add Products <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}
        {step === 2 && (
          selectedSkuId ? (
            // A product is actively being configured — this docked bar IS
            // the primary action (was a second, in-flow button before,
            // which left a dead gap between it and this same bar). One
            // action, always in the same place, native-form style.
            <>
              <button onClick={() => setSelectedSkuId("")} className="flex-1 h-14 rounded-xl ios-subhead font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
              <button onClick={handleAddLine} disabled={!lineQty || !linePrice || lineQtyPieces <= 0 || insufficient}
                className="flex-[2] h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "var(--foreground)", color: "var(--background)" }}>
                <Plus className="h-4 w-4" /> Add to Order
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep(1)} className="flex-1 h-14 rounded-xl ios-subhead font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
              <button disabled={draftLines.length === 0} onClick={() => setStep(3)}
                className="flex-[2] h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "var(--foreground)", color: "var(--background)" }}>
                {draftLines.length === 0 ? "Add at least 1 item" : <>Review & Confirm <ArrowRight className="h-4 w-4" /></>}
              </button>
            </>
          )
        )}
        {step === 3 && (
          <>
            <button onClick={() => setStep(2)} className="flex-1 h-14 rounded-xl ios-subhead font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
            <button disabled={saving} onClick={handleSubmit}
              className="flex-[2] h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Place Order <ArrowRight className="h-4 w-4" /></>}
            </button>
          </>
        )}
      </footer>

      {showScanner && (
        <BarcodeScanner
          hint="Scan product barcode"
          onResult={handleScanResult}
          onClose={() => setShowScanner(false)}
        />
      )}

      {belowCostAdd && portalReady && createPortal(
        (() => {
          const s = belowCostAdd.sku;
          const mult = belowCostAdd.uom === "carton" ? s.pcs_per_pack * s.packs_per_carton
                     : belowCostAdd.uom === "pack" ? s.pcs_per_pack : 1;
          const cost = (s.landed_per_piece_mvr ?? 0) * mult;
          const loss = cost - belowCostAdd.price;
          const u = belowCostAdd.uom === "pack" ? packLabel(s).toLowerCase() : belowCostAdd.uom;
          return (
            <ConfirmSheet
              open
              title="This sells below cost"
              message={`${s.brand_name} ${s.variant_display} costs you MVR ${cost.toFixed(0)}/${u} right now — at MVR ${belowCostAdd.price.toFixed(0)} you lose about MVR ${loss.toFixed(loss >= 10 ? 0 : 2)} per ${u}. Cancel and tap the product card to adjust the price, or add it anyway.`}
              confirmLabel="Add at a loss"
              onConfirm={() => {
                pushQuickLine(s, belowCostAdd.uom, belowCostAdd.price);
                setBelowCostAdd(null);
              }}
              onClose={() => setBelowCostAdd(null)}
            />
          );
        })(),
        document.body,
      )}

      {editorBelowCostConfirm && selectedSku && portalReady && createPortal(
        (() => {
          const s = selectedSku;
          const mult = lineUom === "carton" ? s.pcs_per_pack * s.packs_per_carton
                     : lineUom === "pack" ? s.pcs_per_pack : 1;
          const cost = (s.landed_per_piece_mvr ?? 0) * mult;
          const price = parseFloat(linePrice) || 0;
          const qty = parseFloat(lineQty) || 0;
          const lossEach = cost - price;
          const lossTotal = lossEach * qty;
          const u = lineUom === "pack" ? packLabel(s).toLowerCase() : lineUom;
          return (
            <ConfirmSheet
              open
              title="This sells below cost"
              message={`${s.brand_name} ${s.variant_display} costs you MVR ${cost.toFixed(0)}/${u} right now — at MVR ${price.toFixed(0)} you lose about MVR ${lossEach.toFixed(lossEach >= 10 ? 0 : 2)} per ${u}${qty > 1 ? ` (MVR ${lossTotal.toFixed(0)} on this line)` : ""}. Go back to adjust the price, or add it anyway.`}
              confirmLabel="Add at a loss"
              onConfirm={() => { setEditorBelowCostConfirm(false); doAddLine(); }}
              onClose={() => setEditorBelowCostConfirm(false)}
            />
          );
        })(),
        document.body,
      )}

      {mixedCartonBrandId && portalReady && createPortal(
        // Portalled to document.body for the same reason as the price-explain
        // sheet above — this is a `position: fixed` layer that must never be a
        // descendant of NewSaleSheet's own `fixed inset-x-0 top-0` container.
        <MixedCartonSheet
          skus={mixedCartonGroups.get(mixedCartonBrandId) ?? []}
          godownId={godownId}
          stockLevels={stockLevels}
          tierPrices={tierPrices}
          onClose={() => setMixedCartonBrandId(null)}
          onAdd={(lines) => {
            setDraftLines((prev) => [...prev, ...lines]);
            setMixedCartonBrandId(null);
          }}
        />,
        document.body,
      )}
    </div>
  );
}

// ── Mixed-carton picker ──────────────────────────────────────────────────────
// One screen, one action: pick how many bottles of each scent fill the
// carton (must total exactly `piecesNeeded`), tap once to add every non-zero
// scent as its own is_mixed_carton_fill draft line. Each line still carries
// its own sku_id, so post_sale deducts FIFO stock from that scent's own
// batches — nothing about stock movements or costing changes, only how many
// taps it takes a salesperson to build the cart entry.
function MixedCartonSheet({
  skus, godownId, stockLevels, tierPrices, onClose, onAdd,
}: {
  skus: SkuFullRow[];
  godownId: string;
  stockLevels: StockLevel[];
  tierPrices: Map<string, TierPrice>;
  onClose: () => void;
  onAdd: (lines: DraftLine[]) => void;
}) {
  const piecesNeeded = skus[0]?.mixed_carton_pieces ?? 0;
  const [counts, setCounts] = useState<Record<string, number>>({});

  const stockFor = (s: SkuFullRow) => godownId
    ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0
    : stockLevels.filter((l) => l.sku_id === s.id).reduce((a, l) => a + l.qty_pieces, 0);

  // Per-piece price: mixed fill always charges carton-rate ÷ pieces, same
  // rule as the single-SKU "Mixed carton fill" toggle this sheet replaces.
  const pricePerPiece = (s: SkuFullRow) => {
    const tp = tierPrices.get(s.id);
    const cartonPrice = tp ? tp.price_per_carton_mvr : s.selling_price_per_carton_mvr;
    return cartonPrice != null && piecesNeeded > 0 ? cartonPrice / piecesNeeded : null;
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const remaining = piecesNeeded - total;
  const canAdd = total === piecesNeeded && piecesNeeded > 0;

  function setCount(skuId: string, next: number) {
    const sku = skus.find((s) => s.id === skuId);
    if (!sku) return;
    const stock = stockFor(sku);
    const clamped = Math.max(0, Math.min(next, stock, piecesNeeded));
    setCounts((prev) => ({ ...prev, [skuId]: clamped }));
  }

  function handleAdd() {
    const lines: DraftLine[] = [];
    for (const s of skus) {
      const qty = counts[s.id] ?? 0;
      if (qty <= 0) continue;
      const unitPrice = pricePerPiece(s);
      if (unitPrice == null) continue;
      lines.push({
        key: `${s.id}-${Date.now()}`,
        sku: s, uom: "piece", qty,
        qty_pieces: qty,
        unit_price_mvr: unitPrice,
        line_total_mvr: unitPrice * qty,
        is_mixed_carton_fill: true,
      });
    }
    if (lines.length > 0) onAdd(lines);
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end snm-scrim-in"
      style={{ background: "var(--scrim-bg)", touchAction: "none" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
        style={{
          background: "var(--background)",
          borderTop: "0.5px solid var(--glass-border-lo)",
          boxShadow: "var(--glass-shadow-lg)",
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
        }}
      >
        {/* Fixed header — grabber + title + running counter, always visible */}
        <div className="shrink-0 px-5 pt-3 pb-3" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
          <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{skus[0]?.brand_name} · Build a carton</h2>
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Mix any scents to fill {piecesNeeded} bottles</p>
            </div>
            <button onClick={onClose} className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }} aria-label="Close">
              <X className="h-4 w-4 text-foreground" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
              <div className="h-full rounded-full transition-all" style={{
                width: `${Math.min(100, (total / Math.max(1, piecesNeeded)) * 100)}%`,
                background: total === piecesNeeded ? "var(--snm-success)" : total > piecesNeeded ? "var(--snm-error)" : "var(--snm-brand)",
              }} />
            </div>
            <p className="ios-subhead font-bold shrink-0 tabular-nums" style={{ color: total === piecesNeeded ? "var(--snm-success)" : "var(--foreground)" }}>
              {total} / {piecesNeeded}
            </p>
          </div>
        </div>

        {/* Scrollable body — one stepper row per scent, the ONLY scroll region */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4 space-y-2" style={{ touchAction: "pan-y" }}>
          {skus.map((s) => {
            const stock = stockFor(s);
            const count = counts[s.id] ?? 0;
            const outOfStock = stock <= 0;
            const atCap = count >= stock || count >= piecesNeeded;
            return (
              <div key={s.id} className="rounded-2xl p-4 flex items-center justify-between gap-3"
                style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", opacity: outOfStock ? 0.5 : 1 }}>
                <div className="min-w-0 flex-1">
                  <p className="ios-subhead font-semibold text-foreground truncate">{s.variant_display}</p>
                  <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                    {outOfStock ? "Out of stock" : `${stock} bottle${stock === 1 ? "" : "s"} in stock`}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setCount(s.id, count - 1)}
                    disabled={count <= 0}
                    className="w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
                    style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--foreground)" }}>
                    −
                  </button>
                  <span className="w-6 text-center ios-subhead font-bold tabular-nums text-foreground">{count}</span>
                  <button
                    onClick={() => setCount(s.id, count + 1)}
                    disabled={outOfStock || atCap}
                    className="w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}>
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed footer — one primary action, disabled until exactly full */}
        <div className="shrink-0 px-5 py-4 flex flex-col gap-2" style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          {!canAdd && (
            <p className="ios-footnote text-center" style={{ color: remaining < 0 ? "var(--snm-error)" : "var(--muted-foreground)" }}>
              {remaining > 0 ? `Add ${remaining} more bottle${remaining === 1 ? "" : "s"} to fill the carton` : `${Math.abs(remaining)} too many — remove some`}
            </p>
          )}
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="h-14 w-full rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "var(--foreground)", color: "var(--background)" }}>
            <Plus className="h-4 w-4" /> Add Carton to Order
          </button>
        </div>
      </div>
    </div>
  );
}

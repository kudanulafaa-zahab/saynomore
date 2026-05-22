"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, Plus, Search, ShoppingCart, CheckCircle2,
  Clock, Truck, Package, XCircle, UserPlus, ChevronRight, Trash2,
  Banknote, Smartphone, ArrowRight, X, Users, List, ChevronDown,
} from "lucide-react";
import {
  listOrders, createOrder, nextOrderNumber, createOrderLine, postSale, deleteOrder,
  getTierPricesForSkus,
  type SalesOrderRow, type OrderStatus, type OrderChannel, type SaleUom, type TierPrice,
} from "@/lib/queries/sales";
import {
  listCustomers, createCustomer, listGodowns,
  type CustomerRow, type CustomerChannel, type CustomerInput, type GodownRow, type PriceTier,
} from "@/lib/queries/masters";
import { listSkusFlat, getCurrentUserRole, type SkuFullRow } from "@/lib/queries/products";
import { listStockLevels, type StockLevel } from "@/lib/queries/inventory";
import { toPieces } from "@/lib/queries/sales";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";

// ── Styling constants ─────────────────────────────────────────────────────────

const CARD = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: "var(--glass-shadow), var(--glass-inner)",
} as const;

const CARD_L2 = {
  background: "var(--glass-2)",
  backdropFilter: "blur(30px)",
  WebkitBackdropFilter: "blur(30px)",
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

const CUSTOMER_CHANNELS = CHANNELS as { value: CustomerChannel; label: string }[];

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
// diapers/unit goods sell by pack (single retail pack).
function defaultUom(sku: SkuFullRow): SaleUom {
  if (sku.unit_uom === "ml" || sku.unit_uom === "g") return "carton";
  return "pack";
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function GlassInput({ label, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <input
        {...props}
        className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground transition"
        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
      />
    </div>
  );
}

function GlassSelect({ label, value, onChange, children }: {
  label?: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none appearance-none"
        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
      >
        {children}
      </select>
    </div>
  );
}

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
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    getCurrentUserRole().then((r) => setCanWrite(r !== "viewer")).catch(() => {});
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

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    // Unpaid mode: further restrict to delivered orders with pending/partial payment
    if (unpaidMode) r = r.filter((x) => ["pending", "partial"].includes(x.payment_status));
    const term = q.trim().toLowerCase();
    if (term) r = r.filter((x) => {
      const cust = customers.find((c) => c.id === x.customer_id);
      return [x.order_number, cust?.name ?? "", cust?.phone ?? ""].join(" ").toLowerCase().includes(term);
    });
    return r;
  }, [rows, q, statusFilter, unpaidMode, customers]);

  // Group by customer — collapse all orders per customer into one expandable row.
  // Walk-in orders are grouped under a single "Walk-in" bucket.
  const grouped = useMemo(() => {
    const map = new Map<string, { customer: CustomerRow | null; orders: SalesOrderRow[] }>();
    for (const o of filtered) {
      const key = o.customer_id ?? "__walkin__";
      const cust = o.customer_id ? customers.find((c) => c.id === o.customer_id) ?? null : null;
      if (!map.has(key)) map.set(key, { customer: cust, orders: [] });
      map.get(key)!.orders.push(o);
    }
    // Sort buckets: most recent order first
    return Array.from(map.values()).sort((a, b) => {
      const aDate = a.orders[0]?.created_at ?? "";
      const bDate = b.orders[0]?.created_at ?? "";
      return bDate.localeCompare(aDate);
    });
  }, [filtered, customers]);

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
          <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Operations</p>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Sales</h1>
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
            backdropFilter: "blur(20px)",
            boxShadow: "var(--glass-shadow), var(--glass-inner)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--snm-error)" }} />
            <p className="text-[13px] font-semibold text-foreground">
              Showing {filtered.length} unpaid delivered order{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => router.push("/sales")}
            className="text-[12px] font-medium shrink-0"
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
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" />
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
              className="shrink-0 h-11 px-4 rounded-full text-[12px] font-semibold transition active:scale-95"
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
            className="flex-1 flex items-center justify-center gap-2 h-10 text-[13px] font-semibold transition"
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
          <p className="text-sm max-w-sm" style={{ color: "var(--muted-foreground)" }}>
            {unpaidMode ? "All delivered orders have been paid. Nothing outstanding." : rows.length === 0 ? "Record a sale when a customer messages you on WhatsApp, Viber, or other channels." : "Try a different filter."}
          </p>
          {rows.length === 0 && (
            <button onClick={() => setNewDialog(true)} className="mt-2 h-11 px-6 rounded-2xl text-sm font-semibold"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              Record first sale
            </button>
          )}
        </div>

      ) : groupBy === "orders" ? (
        /* ── Flat order list ── */
        <div className="space-y-1.5">
          {filtered.map((o) => {
            const Icon = STATUS_ICON[o.status];
            const cust = customers.find((c) => c.id === o.customer_id);
            const colors = STATUS_COLOR[o.status];
            return (
              <div key={o.id} className="flex items-center gap-2">
                <Link href={`/sales/${o.id}`}
                  className="flex-1 flex items-center justify-between gap-3 p-4 rounded-2xl active:opacity-75"
                  style={CARD}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: colors.bg, color: colors.text }}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-foreground">
                        {cust?.name ?? "Walk-in"}
                        <span className="text-[11px] ml-2 snm-num" style={{ color: "var(--muted-foreground)" }}>{o.order_number}</span>
                      </p>
                      <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>
                        via {o.channel}{cust?.island && <> · {cust.island}</>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] uppercase tracking-widest font-semibold rounded-lg px-2.5 py-1" style={{ background: colors.bg, color: colors.text }}>
                      {STATUS_LABEL[o.status]}
                    </span>
                    <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
                  </div>
                </Link>
                {/* Delete button — outside the link so tap doesn't navigate */}
                {canWrite && (
                  <button
                    onClick={() => setConfirmDelete({ id: o.id, label: o.order_number })}
                    aria-label={`Delete order ${o.order_number}`}
                    className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 active:opacity-60"
                    style={{ color: "var(--snm-error)" }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
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
                <button onClick={toggle} className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition active:opacity-80">
                  <div className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                    style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}>
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-foreground">{name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                        {orders.length} order{orders.length !== 1 ? "s" : ""}
                      </span>
                      {active.length > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: "color-mix(in srgb, var(--snm-warning) 15%, transparent)", color: "var(--snm-warning)" }}>
                          {active.length} active
                        </span>
                      )}
                      {customer?.island && (
                        <span className="text-[11px]" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>{customer.island}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 mr-1">
                    <p className="text-[13px] font-semibold text-foreground">{delivered} done</p>
                    <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>of {orders.length}</p>
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
                      return (
                        <div key={o.id} className="flex items-center"
                          style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                          <Link href={`/sales/${o.id}`}
                            className="flex-1 flex items-center justify-between gap-3 px-4 py-3 active:opacity-75">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: colors.bg, color: colors.text }}>
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[13px] font-semibold text-foreground">{o.order_number}</p>
                                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                                  {new Date(o.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · via {o.channel}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] uppercase tracking-widest font-semibold rounded-lg px-2 py-1" style={{ background: colors.bg, color: colors.text }}>
                                {STATUS_LABEL[o.status]}
                              </span>
                              <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)" }} />
                            </div>
                          </Link>
                          {canWrite && (
                            <button
                              onClick={() => setConfirmDelete({ id: o.id, label: o.order_number })}
                              aria-label={`Delete order ${o.order_number}`}
                              className="h-11 w-11 mr-1 rounded-lg flex items-center justify-center shrink-0 active:opacity-60"
                              style={{ color: "var(--snm-error)" }}
                            >
                              <Trash2 className="h-4 w-4" />
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
      )}

      {newDialog && canWrite && (
        <NewSaleSheet
          customers={customers} skus={skus} godowns={godowns}
          stockLevels={stockLevels} existingOrders={rows}
          onClose={() => setNewDialog(false)}
          onCreated={(id) => { setNewDialog(false); load(); router.push(`/sales/${id}`); }}
          onCustomerCreated={(c) => setCustomers((prev) => [c, ...prev])}
        />
      )}

      <ConfirmSheet
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete order?"
        message={confirmDelete ? `${confirmDelete.label} will be permanently deleted.` : ""}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={async () => {
          if (!confirmDelete) return;
          setDeleting(true);
          try { await deleteOrder(confirmDelete.id); toast.success("Order deleted"); load(); setConfirmDelete(null); }
          catch (e) { toast.error((e as Error).message); }
          finally { setDeleting(false); }
        }}
      />
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
  const [step, setStep] = useState<Step>(1);
  const [orderNumber] = useState(nextOrderNumber(existingOrders));
  const [channel, setChannel] = useState<OrderChannel>("whatsapp");

  // Step 1 — customer
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustIsland, setNewCustIsland] = useState("");
  const [newCustEmail, setNewCustEmail] = useState("");
  const [newCustTier, setNewCustTier] = useState<PriceTier>("retail");
  const [newCustChannel, setNewCustChannel] = useState<CustomerChannel>("whatsapp");
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Order-level tier override — defaults to customer's tier, can be changed per order
  const [orderTier, setOrderTier] = useState<PriceTier>("retail");

  // Step 2 — products
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [skuSearch, setSkuSearch] = useState("");
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
  const selectedSku = skus.find((s) => s.id === selectedSkuId);

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
    return customers.filter((c) => [c.name, c.phone ?? "", c.island ?? ""].join(" ").toLowerCase().includes(term)).slice(0, 10);
  }, [customers, customerSearch]);

  const filteredSkus = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    if (!term) return active.slice(0, 40);
    return active.filter((s) => [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""].join(" ").toLowerCase().includes(term)).slice(0, 40);
  }, [skus, skuSearch]);

  const stockHere = selectedSku && godownId
    ? stockLevels.find((l) => l.sku_id === selectedSku.id && l.godown_id === godownId)?.qty_pieces ?? 0
    : null;

  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [autoPriceSource, setAutoPriceSource] = useState<"price_list" | "sku_default" | null>(null);

  // ── iOS body scroll lock ────────────────────────────────────────────────────
  // Lock the body so the background page cannot scroll or bleed through.
  // We use position:fixed + saved scrollY so the page stays in place.
  useEffect(() => {
    const scrollY = window.scrollY;
    const prev = { overflow: document.body.style.overflow, position: document.body.style.position, top: document.body.style.top, width: document.body.style.width };
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top      = `-${scrollY}px`;
    document.body.style.width    = "100%";
    return () => {
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.top      = prev.top;
      document.body.style.width    = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  function autoPrice(
    sku: typeof selectedSku,
    uom: SaleUom,
    isMixed: boolean,
  ): { price: string; source: "price_list" | "sku_default" | null } {
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
      return { price: p.toFixed(2), source: tp.source };
    }
    const p = uom === "piece" ? sku.selling_price_per_piece_mvr
      : uom === "pack" ? sku.selling_price_per_pack_mvr
      : sku.selling_price_per_carton_mvr;
    return { price: p != null ? p.toFixed(2) : "", source: p != null ? "sku_default" : null };
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

  const lineTotal = useMemo(() => {
    const q = parseFloat(lineQty); const p = parseFloat(linePrice);
    if (isNaN(q) || isNaN(p)) return 0;
    return q * p;
  }, [lineQty, linePrice]);

  const insufficient = stockHere !== null && lineQtyPieces > stockHere;
  const grandTotal = useMemo(() => draftLines.reduce((s, l) => s + l.line_total_mvr, 0), [draftLines]);

  async function handleCreateCustomer() {
    if (!newCustName.trim()) return;
    setSavingCustomer(true);
    try {
      const input: CustomerInput = {
        name: newCustName.trim(),
        phone: newCustPhone.trim() || null,
        island: newCustIsland.trim() || null,
        email: newCustEmail.trim() || null,
        channel: newCustChannel,
        price_tier: newCustTier,
      };
      const created = await createCustomer(input);
      onCustomerCreated(created as CustomerRow);
      setCustomerId(created.id);
      setOrderTier(newCustTier); // order starts with their tier
      setChannel(newCustChannel as OrderChannel);
      setShowNewCustomer(false);
    } catch (err) { toast.error((err as Error).message); }
    finally { setSavingCustomer(false); }
  }

  function handleAddLine() {
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

  // Create order + lines + immediately confirm (post_sale) in one shot
  async function handleSubmit() {
    if (draftLines.length === 0) return;
    setSaving(true);
    try {
      const cust = customers.find((c) => c.id === customerId);
      const created = await createOrder({
        order_number: orderNumber,
        customer_id: customerId && customerId !== "walkin" ? customerId : null,
        channel: cust?.channel ?? channel,
        status: "draft",
        source_godown_id: godownId || null,
        payment_method: paymentMethod,
        payment_status: paymentMethod === "cod" ? "pending" : "pending",
        notes: orderNotes.trim() || null,
      });
      await Promise.all(draftLines.map((l) => createOrderLine({
        order_id: created.id, sku_id: l.sku.id, uom: l.uom, qty: l.qty,
        qty_pieces: l.qty_pieces, unit_price_mvr: l.unit_price_mvr, line_total_mvr: l.line_total_mvr,
        is_mixed_carton_fill: l.is_mixed_carton_fill,
      })));
      // Confirm stock immediately
      await postSale(created.id);
      toast.success("Order placed — stock deducted");
      onCreated(created.id);
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
          <span className="text-[12px] font-mono" style={{ color: "var(--muted-foreground)" }}>{orderNumber}</span>
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
              <div className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-all"
                style={step === s ? { background: "var(--foreground)", color: "var(--background)" }
                  : step > s ? { background: "color-mix(in srgb, var(--snm-success) 20%, transparent)", color: "var(--snm-success)" }
                  : { background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                {step > s ? "✓" : s}
              </div>
              <span className="text-[11px]" style={{ color: step === s ? "var(--foreground)" : "var(--muted-foreground)" }}>{stepLabels[s]}</span>
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
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" />
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
                            className="flex items-center gap-2 px-3 h-9 rounded-full text-[13px] font-semibold transition active:scale-95"
                            style={{
                              background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--snm-brand) 25%, transparent)",
                              color: "var(--snm-brand)",
                            }}
                          >
                            ★ {rc.name.split(" ")[0]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[11px] uppercase tracking-widest mb-3 font-medium" style={{ color: "var(--muted-foreground)" }}>
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
                            <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>{[c.island, c.channel].filter(Boolean).join(" · ")}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                        </button>
                      );
                    })}
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).length === 0 && (
                      <p className="text-sm py-4 text-center" style={{ color: "var(--muted-foreground)" }}>
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

            {showNewCustomer && !customerId && (() => {
              // Live-match existing customers as the user types the name.
              // If they pick a match → select that customer (no duplicate created).
              // If no match → show full new-customer form to create.
              const nameMatches = newCustName.trim().length >= 1
                ? customers.filter((c) =>
                    [c.name, c.phone ?? "", c.island ?? ""].join(" ").toLowerCase()
                      .includes(newCustName.trim().toLowerCase())
                  ).slice(0, 5)
                : [];

              return (
                <div className="rounded-xl p-5 space-y-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                  <p className="text-[13px] font-bold text-foreground flex items-center gap-2">
                    <UserPlus className="h-4 w-4" /> New Customer
                  </p>

                  {/* Name field — live-searches existing customers */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>Name *</p>
                    <input
                      autoFocus
                      value={newCustName}
                      onChange={(e) => setNewCustName((e.target as HTMLInputElement).value)}
                      placeholder="Start typing a name…"
                      className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground transition"
                      style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
                    />

                    {/* Live match results — shown while typing */}
                    {nameMatches.length > 0 && (
                      <div className="rounded-xl overflow-hidden mt-1" style={{ border: "1px solid color-mix(in srgb, var(--snm-brand) 30%, transparent)" }}>
                        <p className="text-[10px] uppercase tracking-widest px-3 pt-2 pb-1 font-semibold"
                          style={{ background: "color-mix(in srgb, var(--snm-brand) 6%, transparent)", color: "var(--snm-brand)" }}>
                          Existing customers — tap to select instead of creating new
                        </p>
                        {nameMatches.map((c) => {
                          const initials = c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                          return (
                            <button key={c.id}
                              type="button"
                              onClick={() => {
                                setCustomerId(c.id);
                                setOrderTier(c.price_tier ?? "retail");
                                setChannel((c.channel as OrderChannel) ?? "whatsapp");
                                touchRecentCustomer(c.id);
                                setShowNewCustomer(false);
                                setNewCustName("");
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70"
                              style={{ borderTop: "0.5px solid var(--glass-border-lo)", background: "color-mix(in srgb, var(--snm-brand) 4%, transparent)" }}>
                              <div className="h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0"
                                style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>
                                {initials}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-semibold text-foreground truncate">{c.name}</p>
                                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                                  {[c.phone, c.island, c.channel].filter(Boolean).join(" · ")}
                                </p>
                              </div>
                              <span className="text-[10px] font-bold px-2 py-1 rounded-lg shrink-0"
                                style={{ background: "color-mix(in srgb, var(--snm-brand) 12%, transparent)", color: "var(--snm-brand)" }}>
                                Select
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Contact details */}
                  <div className="grid grid-cols-2 gap-3">
                    <GlassInput label="Phone" value={newCustPhone} onChange={(e) => setNewCustPhone((e.target as HTMLInputElement).value)} placeholder="+960…" inputMode="tel" />
                    <GlassInput label="Island" value={newCustIsland} onChange={(e) => setNewCustIsland((e.target as HTMLInputElement).value)} placeholder="Malé…" />
                  </div>
                  <GlassInput label="Email (optional)" value={newCustEmail} onChange={(e) => setNewCustEmail((e.target as HTMLInputElement).value)} placeholder="name@example.com" inputMode="email" />

                  {/* Price tier — critical: determines which price list applies to all their orders */}
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>Price Tier *</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(["retail", "wholesale", "vip", "promo"] as PriceTier[]).map((t) => (
                        <button key={t} type="button" onClick={() => setNewCustTier(t)}
                          className="py-2 rounded-xl text-[12px] font-semibold capitalize transition active:scale-95"
                          style={newCustTier === t
                            ? { background: "var(--foreground)", color: "var(--background)" }
                            : { background: "color-mix(in srgb, var(--foreground) 7%, transparent)", color: "var(--muted-foreground)" }}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                      Determines which price list applies to this customer's orders by default.
                    </p>
                  </div>

                  <GlassSelect label="Usually orders via" value={newCustChannel} onChange={(v) => setNewCustChannel(v as CustomerChannel)}>
                    {CUSTOMER_CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </GlassSelect>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowNewCustomer(false); setNewCustName(""); }} className="flex-1 h-11 rounded-xl text-sm" style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}>Back</button>
                    <button onClick={handleCreateCustomer} disabled={savingCustomer || !newCustName.trim()}
                      className="flex-[2] h-11 rounded-xl text-sm font-bold transition disabled:opacity-40"
                      style={{ background: "var(--foreground)", color: "var(--background)" }}>
                      {savingCustomer ? "Saving…" : "Create New & Select"}
                    </button>
                  </div>
                </div>
              );
            })()}

            {customerId && customerId !== "walkin" && customer && (
              <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)" }}>
                {/* Customer identity row */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-semibold text-foreground">{customer.name}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{[customer.phone, customer.island, customer.channel].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button onClick={() => { setCustomerId(""); setCustomerSearch(""); setOrderTier("retail"); }}
                    className="text-[12px] font-semibold px-3 h-8 rounded-lg transition active:scale-95"
                    style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                    Change
                  </button>
                </div>

                {/* Order-level pricing tier — defaults to customer's tier, overrideable per order */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--muted-foreground)" }}>
                      Pricing tier for this order
                    </p>
                    {orderTier !== customer.price_tier && (
                      <button onClick={() => setOrderTier(customer.price_tier)}
                        className="text-[10px] font-semibold"
                        style={{ color: "var(--snm-brand)" }}>
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
                          className="py-2 rounded-xl text-[11px] font-semibold capitalize transition active:scale-95 relative"
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
                  <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
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
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>No account</p>
                </div>
                <button onClick={() => setCustomerId("")} className="text-[11px] text-foreground opacity-60 active:opacity-100">Change</button>
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
            <GlassSelect label="Ship from warehouse" value={godownId} onChange={setGodownId}>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}{g.is_default ? " (default)" : ""}</option>)}
            </GlassSelect>

            {/* Product picker */}
            {!selectedSkuId ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-xl px-4 h-12" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                  <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                  <input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)}
                    placeholder="Search brand, product, variant…"
                    aria-label="Search products"
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" autoComplete="off" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {filteredSkus.map((s) => {
                    const stock = godownId ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0 : null;
                    const pl = packLabel(s);
                    // Show price per default UOM on the card — tier price takes priority
                    const cardUom = defaultUom(s);
                    const tp = tierPrices.get(s.id);
                    const cardPrice = tp
                      ? (cardUom === "carton" ? tp.price_per_carton_mvr : tp.price_per_pack_mvr)
                      : (cardUom === "carton" ? s.selling_price_per_carton_mvr : s.selling_price_per_pack_mvr);
                    const cardUomLabel = cardUom === "carton" ? "carton" : pl.toLowerCase();
                    const hasPrice = cardPrice != null;
                    const inCart = draftLines.filter((l) => l.sku.id === s.id).reduce((a, l) => a + l.qty, 0);

                    // Work & Co: quick-add adds 1 unit of the default UOM directly to cart.
                    // Tapping the card body still opens the detail editor for custom qty/price.
                    function handleQuickAdd(e: React.MouseEvent) {
                      e.stopPropagation();
                      if (!hasPrice || (stock != null && stock <= 0)) return;
                      const qty = 1;
                      const pcs = toPieces(cardUom, qty, s.pcs_per_pack, s.packs_per_carton);
                      setDraftLines((prev) => [...prev, {
                        key: `${s.id}-${Date.now()}`,
                        sku: s, uom: cardUom, qty,
                        qty_pieces: pcs,
                        unit_price_mvr: cardPrice!,
                        line_total_mvr: cardPrice!,
                        is_mixed_carton_fill: false,
                      }]);
                      toast.success(`${s.brand_name} ${s.variant_display} added`);
                    }

                    return (
                      <div key={s.id} className="relative">
                        <button onClick={() => setSelectedSkuId(s.id)}
                          className="w-full rounded-xl p-4 text-left transition active:scale-[0.98]"
                          style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1 pr-8">
                              <p className="text-[13px] font-semibold text-foreground truncate">{s.brand_name} · {s.model_name}</p>
                              <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>{s.variant_display}</p>
                            </div>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
                              style={{ background: stock != null && stock > 0 ? "color-mix(in srgb, var(--snm-success) 12%, transparent)" : "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: stock != null && stock > 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                              {stock != null ? (() => {
                                const dUom = defaultUom(s);
                                if (dUom === "carton" && s.pcs_per_pack > 0 && s.packs_per_carton > 0) {
                                  const cartons = Math.floor(stock / (s.pcs_per_pack * s.packs_per_carton));
                                  return cartons > 0 ? `${cartons} ctn` : "< 1 ctn";
                                }
                                if (s.pcs_per_pack > 0) {
                                  const packs = Math.floor(stock / s.pcs_per_pack);
                                  return packs > 0 ? `${packs} ${packLabel(s).toLowerCase()}s` : `< 1 ${packLabel(s).toLowerCase()}`;
                                }
                                return `${stock} pcs`;
                              })() : "—"}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-1">
                            <div className="flex items-baseline gap-1">
                              <span className="text-[20px] font-semibold" style={{ color: hasPrice ? "var(--foreground)" : "var(--muted-foreground)" }}>
                                {hasPrice ? cardPrice!.toFixed(2) : "No GRN"}
                              </span>
                              {hasPrice && <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>MVR / {cardUomLabel}</span>}
                            </div>
                            {inCart > 0 && (
                              <span className="text-[11px] font-bold" style={{ color: "var(--snm-brand)" }}>
                                ×{inCart} in cart
                              </span>
                            )}
                          </div>
                        </button>
                        {/* Quick-add button — Work & Co progressive disclosure:
                            tap + to add 1 unit instantly; tap card to customise */}
                        {hasPrice && stock !== 0 && (
                          <button
                            onClick={handleQuickAdd}
                            className="absolute bottom-3 right-3 h-8 w-8 rounded-full flex items-center justify-center transition active:scale-90"
                            style={{
                              background: "var(--foreground)",
                              color: "var(--background)",
                              fontSize: 18,
                              fontWeight: 700,
                              lineHeight: 1,
                            }}
                            aria-label={`Quick add ${s.brand_name} ${s.variant_display}`}
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {filteredSkus.length === 0 && <p className="text-sm col-span-2 py-4" style={{ color: "var(--muted-foreground)" }}>No products found.</p>}
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

              // Price badge
              const priceBadge = linePrice && !priceManuallyEdited && autoPriceSource === "price_list"
                ? { label: orderTier.toUpperCase(), color: "var(--snm-brand)", bg: "color-mix(in srgb, var(--snm-brand) 15%, transparent)" }
                : linePrice && !priceManuallyEdited && autoPriceSource === "sku_default"
                  ? { label: "AUTO", color: "var(--snm-success)", bg: "color-mix(in srgb, var(--snm-success) 15%, transparent)" }
                  : linePrice && priceManuallyEdited
                    ? { label: "MANUAL", color: "var(--snm-warning)", bg: "color-mix(in srgb, var(--snm-warning) 15%, transparent)" }
                    : null;

              // Price list source info
              const tp = tierPrices.get(selectedSku.id);
              const priceListInfo = (!priceManuallyEdited && autoPriceSource === "price_list" && tp?.price_list_name)
                ? `${tp.price_list_name}${tp.price_list_date ? " · " + new Date(tp.price_list_date).toLocaleDateString("en-MV", { month: "short", year: "numeric" }) : ""}`
                : null;

              return (
                <div className="space-y-3">
                  {/* ── Product identity card — always visible, never obscured ── */}
                  <div className="rounded-2xl p-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-bold text-foreground leading-tight">{selectedSku.brand_name} · {selectedSku.model_name}</p>
                        <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{selectedSku.variant_display}</p>
                      </div>
                      <button
                        onClick={() => { setSelectedSkuId(""); setLineQty(""); setLinePrice(""); setPriceManuallyEdited(false); }}
                        className="ml-3 shrink-0 text-[12px] font-semibold px-3 h-8 rounded-lg transition active:scale-95"
                        style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                        Change
                      </button>
                    </div>

                    {/* Stock + cost + margin in one clean row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {stockHere !== null && (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
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
                        <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)", color: "var(--muted-foreground)" }}>
                          Cost {costForUom.toFixed(lineUom === "piece" ? 4 : 2)} MVR/{uomLabel.toLowerCase()}
                        </span>
                      )}
                      {margin !== null && (
                        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                          style={{ background: margin >= 0 ? "color-mix(in srgb, var(--snm-success) 12%, transparent)" : "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: margin >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                          {margin.toFixed(1)}% margin
                        </span>
                      )}
                    </div>

                    {/* No GRN warning */}
                    {selectedSku.landed_per_piece_mvr == null && (
                      <p className="text-[11px] mt-2 font-medium" style={{ color: "var(--snm-warning)" }}>
                        ⚠ No confirmed shipment — confirm a GRN first
                      </p>
                    )}
                  </div>

                  {/* ── UOM segmented control — tap to switch, no keyboard ── */}
                  <div className="rounded-2xl p-1 flex gap-1" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}>
                    {(["carton", "pack", "piece"] as SaleUom[]).map((u) => {
                      const label = u === "carton" ? `Carton (${selectedSku.packs_per_carton} ${pl}s)` : u === "pack" ? pl : `Piece (${selectedSku.pcs_per_pack}/${pl})`;
                      return (
                        <button key={u} onClick={() => setLineUom(u)}
                          className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold transition active:scale-95"
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
                        backdropFilter: "blur(20px)",
                        WebkitBackdropFilter: "blur(20px)",
                      }}
                    >
                      <div className="text-left">
                        <p className="text-[13px] font-semibold" style={{ color: mixedCarton ? "var(--snm-brand)" : "var(--foreground)" }}>
                          Mixed carton fill
                        </p>
                        <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
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
                      <p className="text-[10px] uppercase tracking-widest mb-3 font-semibold" style={{ color: "var(--muted-foreground)" }}>
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
                      <p className="text-[10px] uppercase tracking-widest mb-3 font-semibold flex items-center gap-1.5" style={{ color: "var(--muted-foreground)" }}>
                        MVR / {uomLabel}
                        {priceBadge && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: priceBadge.bg, color: priceBadge.color }}>
                            {priceBadge.label}
                          </span>
                        )}
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
                      {priceListInfo && (
                        <p className="text-[9px] text-center mt-1 leading-tight" style={{ color: "var(--muted-foreground)" }}>
                          {priceListInfo}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* ── Line total — only shown once qty > 0 ── */}
                  {lineQtyPieces > 0 && (
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>= {lineQtyPieces.toLocaleString()} pcs total</span>
                      <span className="text-[18px] font-bold text-foreground">MVR {lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {insufficient && (
                    <p className="text-[12px] font-semibold px-1" style={{ color: "var(--snm-error)" }}>
                      ⚠ Only {stockHere} pcs available in this warehouse
                    </p>
                  )}

                  {/* ── Add to Order — full width, always accessible ── */}
                  <button onClick={handleAddLine} disabled={!lineQty || !linePrice || lineQtyPieces <= 0 || insufficient}
                    className="w-full h-14 rounded-2xl text-[15px] font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}>
                    <Plus className="h-5 w-5" /> Add to Order
                  </button>
                </div>
              );
            })() : null}

            {/* Draft lines */}
            {draftLines.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                <p className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
                  Order items · {draftLines.length}
                </p>
                {draftLines.map((l) => {
                  const pl = packLabel(l.sku);
                  const uomWord = l.uom === "carton" ? "carton" : l.uom === "piece" ? "pc" : pl.toLowerCase();
                  return (
                  <div key={l.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-foreground truncate">{l.sku.brand_name} · {l.sku.model_name}</p>
                        {l.is_mixed_carton_fill && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: "color-mix(in srgb, var(--snm-brand) 12%, transparent)", color: "var(--snm-brand)" }}>
                            MIXED CTN
                          </span>
                        )}
                      </div>
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{l.qty} {uomWord} · MVR {l.unit_price_mvr.toLocaleString()}/{uomWord}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-foreground font-semibold text-[13px] snm-num">MVR {l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      <button onClick={() => setDraftLines((p) => p.filter((x) => x.key !== l.key))} className="opacity-40 active:opacity-100">
                        <Trash2 className="h-3.5 w-3.5 text-foreground" />
                      </button>
                    </div>
                  </div>
                  );
                })}
                <div className="flex justify-between px-4 py-3 text-sm font-semibold" style={{ borderTop: "0.5px solid var(--glass-border-lo)", background: "var(--glass-bg-1)" }}>
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
              <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Order Total</p>
              <p className="text-[36px] font-bold tracking-tight text-foreground leading-none mb-1 tabular-nums">
                {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="text-[16px] ml-1.5" style={{ color: "var(--muted-foreground)" }}>MVR</span>
              </p>
              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                {draftLines.length} item{draftLines.length !== 1 ? "s" : ""} · {customerId === "walkin" ? "Walk-in" : (customer?.name ?? "—")} · via {CHANNELS.find((c) => c.value === channel)?.label}
              </p>
            </div>

            {/* Line items */}
            <div className="rounded-xl overflow-hidden" style={CARD}>
              {draftLines.map((l, i) => {
                const pl = packLabel(l.sku);
                const uomWord = l.uom === "carton" ? "carton" : l.uom === "piece" ? "pc" : pl.toLowerCase();
                return (
                  <div key={l.key} className="flex items-center justify-between gap-2 px-4 py-3 text-sm" style={{ borderBottom: i < draftLines.length - 1 ? "0.5px solid var(--glass-border-lo)" : "none" }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-foreground truncate">{l.sku.brand_name} · {l.sku.model_name} · {l.sku.variant_display}</p>
                        {l.is_mixed_carton_fill && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: "color-mix(in srgb, var(--snm-brand) 12%, transparent)", color: "var(--snm-brand)" }}>
                            MIXED CTN
                          </span>
                        )}
                      </div>
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{l.qty} {uomWord} · MVR {l.unit_price_mvr.toLocaleString()}/{uomWord}</p>
                    </div>
                    <span className="text-foreground font-semibold text-[13px] shrink-0">MVR {l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                );
              })}
            </div>

            {/* Payment method */}
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>How will the customer pay?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod("bank_transfer")}
                  className="rounded-xl p-4 text-left transition active:scale-95 space-y-2"
                  style={{ ...CARD, border: paymentMethod === "bank_transfer" ? "2px solid var(--foreground)" : "0.5px solid var(--glass-border-lo)" }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
                    <Smartphone className="h-4 w-4 text-foreground" />
                  </div>
                  <p className="text-[13px] font-semibold text-foreground">Bank Transfer</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>They send payment slip via WhatsApp / Viber</p>
                </button>
                <button
                  onClick={() => setPaymentMethod("cod")}
                  className="rounded-xl p-4 text-left transition active:scale-95 space-y-2"
                  style={{ ...CARD, border: paymentMethod === "cod" ? "2px solid var(--foreground)" : "0.5px solid var(--glass-border-lo)" }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
                    <Banknote className="h-4 w-4 text-foreground" />
                  </div>
                  <p className="text-[13px] font-semibold text-foreground">Cash on Delivery</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Driver collects cash, hands it to you</p>
                </button>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>Delivery notes (optional)</p>
              <textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="e.g. Leave at the gate, call before arriving…"
                rows={2}
                className="w-full px-4 py-3 rounded-xl text-sm text-foreground outline-none resize-none"
                style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }} />
            </div>

            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              Placing this order will immediately deduct stock from the warehouse.
            </p>
          </div>
        )}
      </div>

      {/* Fixed bottom actions */}
      <footer className="snm-overlay-footer shrink-0 px-5 gap-3" style={{ paddingTop: "12px" }}>
        {step === 1 && (
          <>
            <button onClick={onClose} className="flex-1 h-14 rounded-xl text-sm font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>Cancel</button>
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
              className="flex-[2] h-14 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              Add Products <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <button onClick={() => setStep(1)} className="flex-1 h-14 rounded-xl text-sm font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
            <button disabled={draftLines.length === 0} onClick={() => setStep(3)}
              className="flex-[2] h-14 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              {draftLines.length === 0 ? "Add at least 1 item" : <>Review & Confirm <ArrowRight className="h-4 w-4" /></>}
            </button>
          </>
        )}
        {step === 3 && (
          <>
            <button onClick={() => setStep(2)} className="flex-1 h-14 rounded-xl text-sm font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
            <button disabled={saving} onClick={handleSubmit}
              className="flex-[2] h-14 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Place Order <ArrowRight className="h-4 w-4" /></>}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus, Package, CheckCircle2, Clock, Anchor, Truck,
  Trash2, AlertTriangle, ChevronRight, Factory, ShoppingCart,
} from "lucide-react";
import {
  listShipments, createShipment, deleteShipment,
  nextShipmentRef,
  type ShipmentRow, type ShipmentStatus,
} from "@/lib/queries/shipments";
import { listSuppliers, type SupplierRow } from "@/lib/queries/masters";
import { getCurrentUserRole, listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { listReorderAlerts, type SkuReorderAlert } from "@/lib/queries/inventory";

/* ── Style helpers ───────────────────────────────────────────────────────── */

const CARD: React.CSSProperties = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
};

const CARD_L2: React.CSSProperties = {
  background: "var(--glass-2)",
  backdropFilter: "blur(30px)",
  WebkitBackdropFilter: "blur(30px)",
};

/* ── Status config ───────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<ShipmentStatus, string> = {
  draft:         "Draft",
  ordered:       "Ordered",
  in_transit:    "In Transit",
  arrived:       "Arrived",
  grn_confirmed: "Received",
};

const STATUS_COLOR: Record<ShipmentStatus, { bg: string; text: string }> = {
  draft:         { bg: "var(--glass-2)",                                              text: "var(--muted-foreground)" },
  ordered:       { bg: "color-mix(in srgb, var(--snm-warning) 15%, transparent)",    text: "var(--snm-warning)"      },
  in_transit:    { bg: "color-mix(in srgb, var(--snm-info) 15%, transparent)",      text: "var(--snm-info)"         },
  arrived:       { bg: "color-mix(in srgb, var(--snm-warning) 20%, transparent)",    text: "var(--snm-warning)"      },
  grn_confirmed: { bg: "color-mix(in srgb, var(--snm-success) 20%, transparent)",    text: "var(--snm-success)"      },
};

const STATUS_ICON: Record<ShipmentStatus, typeof Truck> = {
  draft:         Package,
  ordered:       Clock,
  in_transit:    Truck,
  arrived:       Anchor,
  grn_confirmed: CheckCircle2,
};

const STATUS_ORDER: ShipmentStatus[] = ["draft", "ordered", "in_transit", "arrived", "grn_confirmed"];
const ACTIVE_STATUSES: ShipmentStatus[] = ["draft", "ordered", "in_transit", "arrived"];

/* ── Date helpers ────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-MV", { day: "numeric", month: "short" });
}

function etaState(date: string | null | undefined): "overdue" | "today" | "upcoming" | null {
  if (!date) return null;
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  if (d < today) return "overdue";
  if (d.getTime() === today.getTime()) return "today";
  return "upcoming";
}

/* ── Main component ──────────────────────────────────────────────────────── */

export function ShipmentsList() {
  const router = useRouter();
  const [rows, setRows]         = useState<ShipmentRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [skus, setSkus]         = useState<SkuFullRow[]>([]);
  const [alerts, setAlerts]     = useState<SkuReorderAlert[]>([]);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | "all">("all");
  const [newSheet, setNewSheet] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<ShipmentRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [role, setRole]         = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [s, sup, sk, al] = await Promise.all([
        listShipments(), listSuppliers(), listSkusFlat(), listReorderAlerts(),
      ]);
      setRows(s);
      setSuppliers(sup);
      setSkus(sk);
      setAlerts(al);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);
  const isAdmin = role === "admin";

  /* counts per status */
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: rows.length };
    for (const s of STATUS_ORDER) m[s] = rows.filter((r) => r.status === s).length;
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const activeFiltered    = filtered.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const completedFiltered = filtered.filter((r) => r.status === "grn_confirmed");

  // Reorder suggestions: critical/low SKUs that don't already have an active PO
  const reorderSuggestions = useMemo(() => {
    const urgentAlerts = alerts.filter((a) => a.alert_level !== "ok");
    return urgentAlerts
      .map((a) => {
        const sku = skus.find((s) => s.id === a.sku_id);
        if (!sku) return null;
        return { alert: a, sku };
      })
      .filter((x): x is { alert: SkuReorderAlert; sku: SkuFullRow } => x !== null)
      .sort((a, b) => {
        // critical first, then sort by DIR ascending (most urgent first)
        if (a.alert.alert_level !== b.alert.alert_level) {
          return a.alert.alert_level === "critical" ? -1 : 1;
        }
        const aDir = a.alert.dir ?? 999;
        const bDir = b.alert.dir ?? 999;
        return aDir - bDir;
      });
  }, [alerts, skus]);

  function supplierFor(id: string | null) {
    if (!id) return null;
    return suppliers.find((s) => s.id === id) ?? null;
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {/* Header */}
        <div className="space-y-2 mb-4">
          <div className="h-2.5 w-36 rounded-full" style={{ background: "var(--muted)" }} />
          <div className="h-8 w-44 rounded-xl" style={{ background: "var(--muted)" }} />
        </div>
        {/* Filter chips */}
        <div className="flex gap-2">
          {[32, 28, 44, 56, 44, 52].map((w, i) => (
            <div key={i} className="h-11 rounded-full shrink-0" style={{ width: w, background: "var(--muted)" }} />
          ))}
        </div>
        {/* 4 PO card skeletons */}
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl p-4 flex items-center gap-3" style={{ background: "var(--glass-1)" }}>
            <div className="h-10 w-10 rounded-xl shrink-0" style={{ background: "var(--muted)" }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-28 rounded-full" style={{ background: "var(--muted)" }} />
              <div className="h-2.5 w-20 rounded-full" style={{ background: "var(--muted)" }} />
            </div>
            <div className="h-6 w-16 rounded-lg shrink-0" style={{ background: "var(--muted)" }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-0 pb-28">

      {/* ── Header ── */}
      <div className="mb-4">
        <p className="label-caps text-[11px] mb-1" style={{ color: "var(--muted-foreground)" }}>Inventory Procurement</p>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Purchase Orders</h1>
      </div>

      {/* ── Reorder suggestions banner ── */}
      {reorderSuggestions.length > 0 && (
        <div
          className="rounded-2xl overflow-hidden mb-2"
          style={{
            border: reorderSuggestions.some((r) => r.alert.alert_level === "critical")
              ? "1px solid color-mix(in srgb, var(--snm-error) 30%, transparent)"
              : "1px solid color-mix(in srgb, var(--snm-warning) 30%, transparent)",
            background: reorderSuggestions.some((r) => r.alert.alert_level === "critical")
              ? "color-mix(in srgb, var(--snm-error) 8%, transparent)"
              : "color-mix(in srgb, var(--snm-warning) 8%, transparent)",
          }}
        >
          <div className="px-4 pt-3 pb-2 flex items-center gap-2">
            <AlertTriangle
              className="h-4 w-4 shrink-0"
              style={{
                color: reorderSuggestions.some((r) => r.alert.alert_level === "critical")
                  ? "var(--snm-error)" : "var(--snm-warning)",
              }}
            />
            <p className="text-[13px] font-bold" style={{
              color: reorderSuggestions.some((r) => r.alert.alert_level === "critical")
                ? "var(--snm-error)" : "var(--snm-warning)",
            }}>
              {reorderSuggestions.length} SKU{reorderSuggestions.length !== 1 ? "s" : ""} need reordering
            </p>
          </div>
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {reorderSuggestions.map(({ alert: a, sku }) => {
              const isCritical = a.alert_level === "critical";
              const dirText = a.dir != null ? `${a.dir}d` : "No data";
              return (
                <button
                  key={a.sku_id}
                  onClick={() => setNewSheet(true)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    minHeight: 44, padding: "0 14px", borderRadius: 22,
                    background: isCritical
                      ? "color-mix(in srgb, var(--snm-error) 15%, transparent)"
                      : "color-mix(in srgb, var(--snm-warning) 15%, transparent)",
                    border: `1px solid color-mix(in srgb, ${isCritical ? "var(--snm-error)" : "var(--snm-warning)"} 25%, transparent)`,
                    color: isCritical ? "var(--snm-error)" : "var(--snm-warning)",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                    touchAction: "manipulation",
                  }}
                >
                  <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />
                  <span>{sku.brand_name} {sku.model_name}{sku.variant_display ? ` ${sku.variant_display}` : ""}</span>
                  <span style={{ opacity: 0.7, fontWeight: 400 }}>{dirText}</span>
                  <Plus style={{ width: 12, height: 12 }} />
                </button>
              );
            })}
          </div>
          <div className="px-4 pb-3">
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              Tap any SKU to create a purchase order. Days shown = estimated stock remaining.
            </p>
          </div>
        </div>
      )}

      {/* ── Status filter chips ── */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4" style={{ scrollbarWidth: "none" }}>
        {([
          { key: "all",          label: "All"        },
          { key: "draft",        label: "Draft"      },
          { key: "ordered",      label: "Ordered"    },
          { key: "in_transit",   label: "In Transit" },
          { key: "arrived",      label: "Arrived"    },
          { key: "grn_confirmed",label: "Received"   },
        ] as { key: ShipmentStatus | "all"; label: string }[]).map(({ key, label }) => {
          const active = statusFilter === key;
          const count  = counts[key] ?? 0;
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className="shrink-0 h-11 px-3 rounded-full text-[12px] font-semibold transition active:scale-95 flex items-center gap-1.5"
              style={{
                background: active ? "var(--foreground)" : "var(--glass-1)",
                color:      active ? "var(--background)" : "var(--muted-foreground)",
                border:     active ? "none" : "1px solid var(--glass-border-lo)",
              }}
            >
              {label}
              <span className="text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* ── Empty state ── */}
      {filtered.length === 0 && (
        <div className="rounded-2xl p-10 flex flex-col items-center text-center space-y-3" style={CARD}>
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
            <ShoppingCart className="h-6 w-6" style={{ color: "var(--muted-foreground)" }} />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {rows.length === 0 ? "No purchase orders yet" : "No matches"}
          </h3>
          <p className="text-sm max-w-[260px]" style={{ color: "var(--muted-foreground)" }}>
            {rows.length === 0
              ? "Tap + to create your first PO. Add supplier, products and costs before goods arrive."
              : "Try a different filter."}
          </p>
          {rows.length === 0 && (
            <button
              onClick={() => setNewSheet(true)}
              className="mt-2 h-11 px-6 rounded-full text-sm font-bold"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              Create first PO
            </button>
          )}
        </div>
      )}

      {/* ── Active POs ── */}
      {activeFiltered.length > 0 && (
        <div className="space-y-2 mb-4">
          {activeFiltered.map((s) => (
            <PoCard key={s.id} shipment={s} supplier={supplierFor(s.supplier_id)} isAdmin={isAdmin} onDelete={setDeleteDialog} />
          ))}
        </div>
      )}

      {/* ── Completed divider ── */}
      {completedFiltered.length > 0 && (
        <>
          <div className="flex items-center gap-3 py-2 mb-2">
            <div className="flex-1 h-px" style={{ background: "var(--glass-border-lo)" }} />
            <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>Completed</span>
            <div className="flex-1 h-px" style={{ background: "var(--glass-border-lo)" }} />
          </div>
          <div className="space-y-2">
            {completedFiltered.map((s) => (
              <PoCard key={s.id} shipment={s} supplier={supplierFor(s.supplier_id)} isAdmin={isAdmin} onDelete={setDeleteDialog} dimmed />
            ))}
          </div>
        </>
      )}

      {/* ── FAB ── */}
      <button
        onClick={() => setNewSheet(true)}
        className="fixed bottom-24 right-4 h-14 w-14 rounded-full flex items-center justify-center transition active:scale-95 z-40"
        style={{ background: "var(--foreground)", boxShadow: "0 4px 16px rgba(0,0,0,0.24)" }}
        aria-label="New purchase order"
      >
        <Plus className="h-6 w-6" style={{ color: "var(--background)" }} />
      </button>

      {/* ── New PO sheet ── */}
      {newSheet && (
        <NewPoSheet
          suppliers={suppliers}
          existing={rows}
          onClose={() => setNewSheet(false)}
          onCreated={(id) => { setNewSheet(false); router.push(`/shipments/${id}`); }}
        />
      )}

      {/* ── Delete confirm ── */}
      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.60)" }}>
          <div className="w-full max-w-sm rounded-3xl p-6 space-y-4" style={CARD_L2}>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-error) 15%, transparent)", color: "var(--snm-error)" }}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-foreground">Delete purchase order?</p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{deleteDialog.reference}</p>
              </div>
            </div>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              All lines will be permanently removed. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteDialog(null)}
                className="flex-1 h-12 rounded-xl text-sm font-semibold"
                style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await deleteShipment(deleteDialog.id);
                    toast.success("Purchase order deleted");
                    setDeleteDialog(null);
                    load();
                  } catch (e) { toast.error((e as Error).message); }
                  finally { setDeleting(false); }
                }}
                className="flex-1 h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
                style={{ background: "var(--snm-error)", color: "#fff" }}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── PO Card ─────────────────────────────────────────────────────────────── */

function PoCard({
  shipment, supplier, isAdmin, onDelete, dimmed,
}: {
  shipment: ShipmentRow;
  supplier: SupplierRow | null;
  isAdmin: boolean;
  onDelete: (s: ShipmentRow) => void;
  dimmed?: boolean;
}) {
  const colors = STATUS_COLOR[shipment.status];
  const Icon   = STATUS_ICON[shipment.status];
  const locked = shipment.status === "grn_confirmed";

  /* ETA display */
  const eta  = shipment.expected_arrival_date;
  const etaS = etaState(eta);
  const etaColor =
    etaS === "overdue" ? "var(--snm-error)"   :
    etaS === "today"   ? "var(--snm-warning)"  :
                         "var(--muted-foreground)";
  const etaLabel =
    etaS === "overdue"  ? `Overdue · ${fmtDate(eta)}` :
    etaS === "today"    ? "Arriving today"              :
    eta                 ? `ETA ${fmtDate(eta)}`         : "ETA not set";

  const confirmedLabel = shipment.grn_confirmed_at
    ? `Received ${fmtDate(shipment.grn_confirmed_at)}`
    : "Received";

  return (
    <div
      className="rounded-2xl overflow-hidden transition"
      style={{
        ...(!dimmed ? {
          background: "var(--glass-1)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border-lo)",
        } : {
          background: "transparent",
          border: "1px solid var(--glass-border-lo)",
          opacity: 0.65,
        }),
      }}
    >
      <Link href={`/shipments/${shipment.id}`} className="block p-4">
        {/* Row 1: reference + status badge */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: colors.bg }}>
              <Icon className="h-3.5 w-3.5" style={{ color: colors.text }} />
            </div>
            <p className="text-[14px] font-bold text-foreground truncate">{shipment.reference}</p>
          </div>
          <span
            className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg"
            style={{ background: colors.bg, color: colors.text }}
          >
            {STATUS_LABEL[shipment.status]}
          </span>
        </div>

        {/* Row 2: supplier */}
        <p className="text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>
          {supplier ? supplier.name : <span style={{ fontStyle: "italic" }}>No supplier assigned</span>}
          {supplier?.country ? ` · ${supplier.country}` : ""}
        </p>

        {/* Row 3: ETA / confirmed date — right side; notes left */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            {shipment.notes ? shipment.notes : "No notes"}
          </p>
          {locked ? (
            <p className="text-[11px] shrink-0 font-medium" style={{ color: "var(--snm-success)" }}>{confirmedLabel}</p>
          ) : (
            <p className="text-[11px] shrink-0" style={{ color: etaColor }}>{etaLabel}</p>
          )}
        </div>
      </Link>

      {/* Admin delete strip — only for non-locked, admin */}
      {isAdmin && !locked && (
        <div
          className="flex justify-end px-3 py-1.5"
          style={{ borderTop: "1px solid var(--glass-border-lo)" }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(shipment); }}
            aria-label={`Delete shipment ${shipment.reference}`}
            className="h-11 w-11 rounded-xl flex items-center justify-center active:opacity-60"
            style={{ color: "var(--snm-error)" }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── New PO bottom sheet ─────────────────────────────────────────────────── */

function NewPoSheet({
  suppliers, existing, onClose, onCreated,
}: {
  suppliers: SupplierRow[];
  existing: ShipmentRow[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [reference, setReference]   = useState(nextShipmentRef(existing));
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [saving, setSaving]         = useState(false);

  async function create() {
    if (!reference.trim()) return;
    setSaving(true);
    try {
      const created = await createShipment({
        reference: reference.trim(),
        supplier_id: supplierId || null,
        status: "draft",
      });
      toast.success("Purchase order created");
      onCreated(created.id);
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.60)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl"
        style={{
          background: "var(--glass-2)",
          backdropFilter: "blur(40px)",
          WebkitBackdropFilter: "blur(40px)",
          padding: "12px 24px",
          paddingBottom: "calc(32px + env(safe-area-inset-bottom, 16px))",
          maxWidth: 480,
        }}
      >
        {/* Handle */}
        <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: "var(--glass-border)" }} />

        {/* Icon + title */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--glass-bg-2)" }}>
            <Factory className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <p className="text-[17px] font-bold text-foreground">New Purchase Order</p>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Draft → add products → confirm on arrival</p>
          </div>
        </div>

        {/* Reference */}
        <div className="space-y-1.5 mb-4">
          <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>PO REFERENCE</p>
          <input
            autoFocus
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="PO-2026-001"
            className="w-full h-12 rounded-xl px-4 text-sm text-foreground outline-none"
            style={{ background: "var(--glass-bg-1)", border: "1px solid var(--glass-border-lo)" }}
          />
          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Auto-generated — edit if you have your own reference.</p>
        </div>

        {/* Supplier */}
        <div className="space-y-1.5 mb-6">
          <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>SUPPLIER</p>
          <div className="relative">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full h-12 rounded-xl px-4 pr-10 text-sm text-foreground outline-none appearance-none"
              style={{ background: "var(--glass-bg-1)", border: "1px solid var(--glass-border-lo)" }}
            >
              <option value="">No supplier yet</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.country ? ` · ${s.country}` : ""}</option>)}
            </select>
            <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 rotate-90 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
          </div>
          {suppliers.length === 0 && (
            <p className="text-[11px]" style={{ color: "var(--snm-warning)" }}>No suppliers yet — add one under Vendors first.</p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-12 rounded-xl text-sm font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}
          >
            Cancel
          </button>
          <button
            onClick={create}
            disabled={saving || !reference.trim()}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {saving
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <><span>Create & Add Products</span><ChevronRight className="h-4 w-4" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}

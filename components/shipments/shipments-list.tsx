"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Search,
  Truck,
  Package,
  CheckCircle2,
  Clock,
  Anchor,
  Pencil,
  Trash2,
  AlertTriangle,
  ChevronRight,
  Factory,
} from "lucide-react";
import {
  listShipments,
  createShipment,
  updateShipment,
  deleteShipment,
  nextShipmentRef,
  type ShipmentRow,
  type ShipmentStatus,
} from "@/lib/queries/shipments";
import { listSuppliers, type SupplierRow } from "@/lib/queries/masters";
import { getCurrentUserRole } from "@/lib/queries/products";

const CARD = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
} as const;

const CARD_L2 = {
  background: "var(--glass-2)",
  backdropFilter: "blur(30px)",
  WebkitBackdropFilter: "blur(30px)",
} as const;

const STATUS_LABEL: Record<ShipmentStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  in_transit: "In Transit",
  arrived: "Arrived",
  grn_confirmed: "Received",
};

const STATUS_COLOR: Record<ShipmentStatus, { bg: string; text: string; dot: string }> = {
  draft:         { bg: "var(--muted)",             text: "var(--muted-foreground)", dot: "var(--muted-foreground)" },
  ordered:       { bg: "rgba(255,64,0,0.10)",      text: "var(--snm-brand)",        dot: "var(--snm-brand)"        },
  in_transit:    { bg: "rgba(251,146,60,0.15)",    text: "var(--snm-warning)",      dot: "var(--snm-warning)"      },
  arrived:       { bg: "rgba(251,146,60,0.10)",    text: "var(--snm-warning)",      dot: "var(--snm-warning)"      },
  grn_confirmed: { bg: "rgba(74,222,128,0.15)",    text: "var(--snm-success)",      dot: "var(--snm-success)"      },
};

const STATUS_ICON: Record<ShipmentStatus, typeof Truck> = {
  draft: Package,
  ordered: Clock,
  in_transit: Truck,
  arrived: Anchor,
  grn_confirmed: CheckCircle2,
};

function GlassInput({ label, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      {label && <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <input
        {...props}
        className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-[#444748] transition"
        style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
      />
    </div>
  );
}

function GlassSelect({ label, value, onChange, children }: { label?: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none appearance-none"
        style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
      >
        {children}
      </select>
    </div>
  );
}

export function ShipmentsList() {
  const router = useRouter();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | "all">("all");
  const [newDialog, setNewDialog] = useState(false);
  const [editDialog, setEditDialog] = useState<ShipmentRow | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<ShipmentRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [s, sup] = await Promise.all([listShipments(), listSuppliers()]);
      setRows(s);
      setSuppliers(sup);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);
  const isAdmin = role === "admin";

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    const term = q.trim().toLowerCase();
    if (term) {
      r = r.filter((x) => x.reference.toLowerCase().includes(term) || (x.notes ?? "").toLowerCase().includes(term));
    }
    return r;
  }, [rows, statusFilter, q]);

  function supplierName(id: string | null): string {
    if (!id) return "—";
    return suppliers.find((s) => s.id === id)?.name ?? "—";
  }

  if (loading) {
    return (
      <div className="rounded-2xl p-12 flex flex-col items-center" style={{ ...CARD, color: "var(--muted-foreground)" }}>
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="label-caps text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>Batch Lifecycle Phase 1</p>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Shipment Intake</h1>
        </div>
        <button
          onClick={() => setNewDialog(true)}
          className="flex items-center gap-2 h-11 px-5 rounded-full text-sm font-bold transition active:scale-95"
          style={{ background: "#ffffff", color: "#2f3131" }}
        >
          <Plus className="h-4 w-4" />
          New Batch
        </button>
      </div>

      {/* ── Search + Filter ── */}
      <div className="flex gap-2">
        <div
          className="flex-1 flex items-center gap-3 rounded-2xl px-4 h-12"
          style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reference…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            inputMode="search"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-12 rounded-2xl px-4 text-sm text-foreground outline-none appearance-none"
          style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <option value="all">All Status</option>
          {(Object.keys(STATUS_LABEL) as ShipmentStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {/* ── Empty state ── */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl p-10 flex flex-col items-center text-center space-y-3" style={CARD}>
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.08)" }}>
            <Truck className="h-6 w-6 text-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {rows.length === 0 ? "No shipments yet" : "No matches"}
          </h3>
          <p className="text-sm max-w-sm" style={{ color: "var(--muted-foreground)" }}>
            {rows.length === 0
              ? "Create a shipment when you place an order. Add lines, set FX rate, then confirm GRN when goods arrive."
              : "Try a different filter."}
          </p>
          {rows.length === 0 && (
            <button
              onClick={() => setNewDialog(true)}
              className="mt-2 h-11 px-6 rounded-full text-sm font-bold"
              style={{ background: "#ffffff", color: "#2f3131" }}
            >
              Create first shipment
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((s) => {
            const Icon = STATUS_ICON[s.status];
            const locked = s.status === "grn_confirmed";
            const colors = STATUS_COLOR[s.status];
            const sup = suppliers.find((x) => x.id === s.supplier_id);
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 p-4 rounded-2xl transition"
                style={CARD}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                <Link href={`/shipments/${s.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: colors.bg, color: colors.text }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-bold text-foreground">{s.reference}</p>
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-lg flex items-center gap-1"
                        style={{ background: colors.bg, color: colors.text }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: colors.dot }} />
                        {STATUS_LABEL[s.status]}
                      </span>
                    </div>
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--muted-foreground)" }}>
                      {sup ? `${sup.name}${sup.country ? ` · ${sup.country}` : ""}` : "No supplier assigned"}
                      {s.notes && <> · {s.notes}</>}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                </Link>

                {(!locked || isAdmin) && (
                  <div className="flex items-center gap-1 shrink-0">
                    {!locked && (
                      <button
                        onClick={() => setEditDialog(s)}
                        className="h-8 w-8 rounded-lg flex items-center justify-center transition"
                        style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)" }}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isAdmin && !locked && (
                      <button
                        onClick={() => setDeleteDialog(s)}
                        className="h-8 w-8 rounded-lg flex items-center justify-center transition"
                        style={{ background: "rgba(255,180,171,0.08)", color: "#ffb4ab" }}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── New Shipment Modal ── */}
      {newDialog && (
        <NewShipmentModal
          suppliers={suppliers}
          existing={rows}
          onClose={() => setNewDialog(false)}
          onCreated={(id) => {
            setNewDialog(false);
            router.push(`/shipments/${id}`);
          }}
        />
      )}

      {/* ── Edit Modal ── */}
      {editDialog && (
        <EditShipmentModal
          shipment={editDialog}
          suppliers={suppliers}
          onClose={() => setEditDialog(null)}
          onSaved={() => { setEditDialog(null); load(); }}
        />
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.60)" }}>
          <div className="w-full max-w-sm rounded-3xl p-6 space-y-4" style={CARD_L2}>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,180,171,0.15)", color: "#ffb4ab" }}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-foreground">Delete shipment?</p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{deleteDialog.reference}</p>
              </div>
            </div>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              All lines will be permanently removed. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteDialog(null)}
                className="flex-1 h-12 rounded-xl text-sm font-semibold"
                style={{ background: "rgba(255,255,255,0.06)", color: "var(--foreground)" }}
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await deleteShipment(deleteDialog.id);
                    toast.success("Shipment deleted");
                    setDeleteDialog(null);
                    load();
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="flex-1 h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
                style={{ background: "rgba(255,180,171,0.20)", color: "#ffb4ab", border: "1px solid rgba(255,180,171,0.20)" }}
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

// ── New Shipment Modal ────────────────────────────────────────────────────────

function NewShipmentModal({
  suppliers, existing, onClose, onCreated,
}: {
  suppliers: SupplierRow[];
  existing: ShipmentRow[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [reference, setReference] = useState(nextShipmentRef(existing));
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!reference.trim()) return;
    setSaving(true);
    try {
      const created = await createShipment({
        reference: reference.trim(),
        supplier_id: supplierId || null,
        status: "draft",
      });
      toast.success("Shipment created");
      onCreated(created.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.60)" }}>
      <div className="w-full max-w-md rounded-3xl p-6 space-y-5" style={CARD_L2}>
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.08)" }}>
            <Factory className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <p className="text-[16px] font-bold text-foreground">New Shipment</p>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Draft → Add lines → Confirm GRN on arrival</p>
          </div>
        </div>

        <GlassInput
          label="BATCH REFERENCE *"
          value={reference}
          onChange={(e) => setReference((e.target as HTMLInputElement).value)}
          placeholder="SH-2026-001"
          autoFocus
        />
        <p className="text-[11px] -mt-3" style={{ color: "var(--muted-foreground)" }}>Auto-generated. Edit if you have your own scheme.</p>

        <GlassSelect label="VENDOR" value={supplierId} onChange={setSupplierId}>
          <option value="">No vendor selected</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </GlassSelect>

        {suppliers.length === 0 && (
          <p className="text-[11px]" style={{ color: "#fb923c" }}>
            No suppliers yet. Add one under Vendors first.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-12 rounded-xl text-sm font-semibold"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--foreground)" }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !reference.trim()}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
            style={{ background: "#ffffff", color: "#2f3131" }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Create Batch"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Shipment Modal ───────────────────────────────────────────────────────

function EditShipmentModal({
  shipment, suppliers, onClose, onSaved,
}: {
  shipment: ShipmentRow;
  suppliers: SupplierRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reference, setReference] = useState(shipment.reference);
  const [supplierId, setSupplierId] = useState(shipment.supplier_id ?? "");
  const [notes, setNotes] = useState(shipment.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!reference.trim()) return;
    setSaving(true);
    try {
      await updateShipment(shipment.id, {
        reference: reference.trim(),
        supplier_id: supplierId || null,
        notes: notes.trim() || null,
      });
      toast.success("Shipment updated");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.60)" }}>
      <div className="w-full max-w-md rounded-3xl p-6 space-y-5" style={CARD_L2}>
        <p className="text-[16px] font-bold text-foreground">Edit Shipment</p>

        <GlassInput label="REFERENCE *" value={reference} onChange={(e) => setReference((e.target as HTMLInputElement).value)} />
        <GlassSelect label="VENDOR" value={supplierId} onChange={setSupplierId}>
          <option value="">No vendor</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </GlassSelect>
        <GlassInput label="NOTES" value={notes} onChange={(e) => setNotes((e.target as HTMLInputElement).value)} placeholder="Optional" />

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl text-sm font-semibold" style={{ background: "rgba(255,255,255,0.06)", color: "var(--foreground)" }}>Cancel</button>
          <button
            onClick={save}
            disabled={saving || !reference.trim()}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
            style={{ background: "#ffffff", color: "#2f3131" }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

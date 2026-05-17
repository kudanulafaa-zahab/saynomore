"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2, ArrowLeft, Plus, Trash2, CheckCircle2, Lock,
  AlertTriangle, Truck, ChevronDown, RotateCcw, Calendar,
  ChevronRight, Minus, MoreHorizontal, Package,
} from "lucide-react";
import {
  getShipment, listShipmentLines, updateShipment, deleteShipment,
  createShipmentLine, updateShipmentLine, deleteShipmentLine,
  confirmGrn, forceVoidGrn,
  type ShipmentRow, type ShipmentLineRow, type FobCurrency, type ShipmentStatus,
} from "@/lib/queries/shipments";
import { listSkusFlat, type SkuFullRow, getCurrentUserRole } from "@/lib/queries/products";
import { listSuppliers, listGodowns, type SupplierRow, type GodownRow } from "@/lib/queries/masters";

/* ── Style helpers ───────────────────────────────────────────────────────── */

const CARD: React.CSSProperties = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  borderRadius: 16,
};

const SHEET: React.CSSProperties = {
  background: "var(--glass-2)",
  backdropFilter: "blur(40px)",
  WebkitBackdropFilter: "blur(40px)",
};

const inputCls = [
  "w-full h-12 rounded-xl px-4 text-sm text-foreground outline-none",
  "placeholder:text-muted-foreground transition",
].join(" ");

const inputSty: React.CSSProperties = {
  background: "var(--glass-bg-1)",
  border: "1px solid var(--glass-border-lo)",
};

const disabledSty: React.CSSProperties = {
  ...inputSty,
  opacity: 0.5,
  cursor: "not-allowed",
};

/* ── Status stepper config ───────────────────────────────────────────────── */

const STEPS: { value: ShipmentStatus; label: string }[] = [
  { value: "draft",      label: "Draft"      },
  { value: "ordered",    label: "Ordered"    },
  { value: "in_transit", label: "In Transit" },
  { value: "arrived",    label: "Arrived"    },
];

const STEP_IDX: Record<ShipmentStatus, number> = {
  draft: 0, ordered: 1, in_transit: 2, arrived: 3, grn_confirmed: 4,
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function fmt0(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function fmt2(n: number) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" });
}

/* ── Number input with local state ──────────────────────────────────────── */

function NumInput({
  value, onChange, disabled, placeholder, compact,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
}) {
  const [local, setLocal] = useState(value != null ? String(value) : "");
  useEffect(() => { setLocal(value != null ? String(value) : ""); }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      value={local}
      placeholder={placeholder ?? "0"}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = local === "" ? null : Number(local);
        if (n !== (value ?? null)) onChange(n);
      }}
      disabled={disabled}
      className={`${inputCls} ${compact ? "h-10 text-[13px]" : ""}`}
      style={disabled ? disabledSty : inputSty}
    />
  );
}

/* ── Qty stepper ─────────────────────────────────────────────────────────── */

function QtyStepper({
  value, onChange, disabled, min = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  min?: number;
}) {
  const [draft, setDraft] = useState(String(value));

  // Keep draft in sync when value changes externally (e.g. after save)
  useEffect(() => { setDraft(String(value)); }, [value]);

  function commit(raw: string) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= min) {
      onChange(n);
      setDraft(String(n));
    } else {
      // revert to current value if invalid
      setDraft(String(value));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => { const v = Math.max(min, value - 1); onChange(v); setDraft(String(v)); }}
        disabled={disabled || value <= min}
        className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition active:scale-95 disabled:opacity-30"
        style={{ background: "var(--glass-bg-2)", border: "1px solid var(--glass-border-lo)", color: "var(--foreground)" }}
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
        onFocus={(e) => e.target.select()}
        className="flex-1 h-11 rounded-xl text-center text-[15px] font-semibold text-foreground outline-none"
        style={{
          background: "var(--glass-bg-1)",
          border: "1px solid var(--glass-border-lo)",
          minWidth: 56,
          // hide browser spin arrows — keyboard +/- buttons handle stepping
          MozAppearance: "textfield",
        } as React.CSSProperties}
      />
      <button
        onClick={() => { const v = value + 1; onChange(v); setDraft(String(v)); }}
        disabled={disabled}
        className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition active:scale-95 disabled:opacity-30"
        style={{ background: "var(--glass-bg-2)", border: "1px solid var(--glass-border-lo)", color: "var(--foreground)" }}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ── Bottom sheet wrapper ────────────────────────────────────────────────── */

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-60 flex items-end" style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl"
        style={{ ...SHEET, padding: "12px 24px 40px", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: "var(--glass-border)" }} />
        {children}
      </div>
    </div>
  );
}

/* ── Section header ──────────────────────────────────────────────────────── */

function SectionHeader({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="label-caps text-[11px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{label}</p>
      {action}
    </div>
  );
}

/* ── Labeled field wrapper ───────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                                            */
/* ══════════════════════════════════════════════════════════════════════════ */

export function ShipmentDetail({ id }: { id: string }) {
  const router = useRouter();

  const [shipment, setShipment]   = useState<ShipmentRow | null>(null);
  const [lines, setLines]         = useState<ShipmentLineRow[]>([]);
  const [skus, setSkus]           = useState<SkuFullRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [godowns, setGodowns]     = useState<GodownRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [voiding, setVoiding]     = useState(false);
  const [role, setRole]           = useState<string | null>(null);
  const [showMore, setShowMore]   = useState(false);
  const [costsOpen, setCostsOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  type PriceChange = { skuPath: string; before: number; after: number; changePct: number };
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);

  type Panel = "confirmGrn" | "voidGrn" | "deleteShipment" | "deleteLine" | "addLine" | null;
  const [panel, setPanel]               = useState<Panel>(null);
  const [editingLine, setEditingLine]   = useState<ShipmentLineRow | undefined>();
  const [pendingDeleteLine, setPendingDeleteLine] = useState<ShipmentLineRow | null>(null);

  /* ── Data loading ──────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, ls, sk, sup, gd] = await Promise.all([
        getShipment(id), listShipmentLines(id), listSkusFlat(), listSuppliers(), listGodowns(),
      ]);
      setShipment(s);
      setLines(ls);
      setSkus(sk);
      setSuppliers(sup);
      setGodowns(gd);
      // Auto-expand costs when in transit or later
      if (s && ["in_transit", "arrived", "grn_confirmed"].includes(s.status)) setCostsOpen(true);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);

  const isAdmin = role === "admin";
  const locked  = shipment?.status === "grn_confirmed";
  const arrived = shipment?.status === "arrived";

  /* ── Live landed-cost preview ──────────────────────────────────────────── */

  const preview = useMemo(() => {
    if (!shipment) return null;
    const idr = shipment.rate_idr_to_mvr ?? 0;
    const usd = shipment.rate_usd_to_mvr ?? 0;
    if (lines.length === 0) return null;

    const totalCbm = lines.reduce((acc, l) => acc + l.qty_cartons * l.cbm_per_carton, 0);
    if (totalCbm <= 0) return null;

    const freightMvr = (shipment.my_freight_share_usd ?? 0) * (usd || 0);
    const localMvr =
      (shipment.customs_duty_mvr ?? 0) + (shipment.mpl_charges_mvr ?? 0) +
      (shipment.agent_fee_mvr ?? 0) + (shipment.last_mile_mvr ?? 0) +
      (shipment.insurance_mvr ?? 0) + (shipment.other_mvr ?? 0);
    const poolMvr = freightMvr + localMvr;

    const ratesSet = idr > 0 && usd > 0;

    const linesPreview = lines.map((l) => {
      const sku = skus.find((s) => s.id === l.sku_id);
      const fxToMvr = l.fob_currency === "IDR" ? idr : l.fob_currency === "USD" ? usd : 1;
      const fobMvr   = ratesSet ? l.qty_cartons * l.fob_per_carton * fxToMvr : 0;
      const cbmShare = totalCbm > 0 ? (l.qty_cartons * l.cbm_per_carton) / totalCbm : 0;
      const apportioned = cbmShare * poolMvr;
      const lineTotal   = fobMvr + apportioned;
      const perCarton   = l.qty_cartons > 0 ? lineTotal / l.qty_cartons : 0;
      const perPack     = sku && sku.packs_per_carton > 0 ? perCarton / sku.packs_per_carton : 0;
      const perPiece    = sku && sku.pcs_per_pack > 0 ? perPack / sku.pcs_per_pack : 0;
      return { line: l, sku, fobMvr, apportioned, lineTotal, perCarton, perPack, perPiece, ratesSet };
    });

    const grandTotal = linesPreview.reduce((acc, p) => acc + p.lineTotal, 0);
    return { totalCbm, freightMvr, localMvr, poolMvr, lines: linesPreview, grandTotal, ratesSet };
  }, [shipment, lines, skus]);

  /* ── Field patch ───────────────────────────────────────────────────────── */

  async function patch(field: string, value: number | string | boolean | null) {
    if (!shipment || locked) return;
    setSaveState("saving");
    try {
      await updateShipment(shipment.id, { [field]: value } as Parameters<typeof updateShipment>[1]);
      setShipment((prev) => prev ? { ...prev, [field]: value } as ShipmentRow : prev);
      setSaveState("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveState("idle"), 2500);
    } catch (e) {
      setSaveState("idle");
      toast.error((e as Error).message);
    }
  }

  async function patchStatus(newStatus: ShipmentStatus) {
    if (!shipment || locked) return;
    await patch("status", newStatus);
  }

  /* ── GRN confirm ───────────────────────────────────────────────────────── */

  async function handleConfirmGrn() {
    if (!shipment) return;
    setConfirming(true);
    try {
      const beforePrices = new Map(
        skus.filter((s) => lines.some((l) => l.sku_id === s.id))
          .map((s) => [s.id, s.selling_price_per_piece_mvr]),
      );
      await confirmGrn(shipment.id);
      setPanel(null);
      await load();
      const { listSkusFlat: freshFetch } = await import("@/lib/queries/products");
      const freshSkus = await freshFetch();
      const changes: PriceChange[] = [];
      for (const line of lines) {
        const fresh  = freshSkus.find((s) => s.id === line.sku_id);
        const before = beforePrices.get(line.sku_id) ?? null;
        const after  = fresh?.selling_price_per_piece_mvr ?? null;
        if (before != null && after != null && before > 0) {
          const changePct = ((after - before) / before) * 100;
          if (Math.abs(changePct) >= 2)
            changes.push({ skuPath: fresh?.full_path ?? line.sku_id, before, after, changePct });
        }
      }
      setPriceChanges(changes);
      if (changes.length > 0)
        toast.warning(`${changes.length} SKU${changes.length > 1 ? "s" : ""} had a price change — review below`);
      else
        toast.success("GRN confirmed — stock is now live");
    } catch (e) { toast.error((e as Error).message); }
    finally { setConfirming(false); }
  }

  /* ── Validate GRN ──────────────────────────────────────────────────────── */

  const grnBlockReason = useMemo(() => {
    if (!shipment) return "No shipment";
    if (lines.length === 0) return "Add at least one product first";
    if (!shipment.rate_usd_to_mvr || shipment.rate_usd_to_mvr <= 0) return "Set USD → MVR rate in Costs section";
    if (!shipment.rate_idr_to_mvr || shipment.rate_idr_to_mvr <= 0) return "Set USD → IDR rate in Costs section";
    if (lines.some((l) => l.cbm_per_carton <= 0)) return "One or more lines has zero CBM";
    return null;
  }, [shipment, lines]);

  /* ── Loading / not found ───────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }
  if (!shipment) {
    return (
      <div className="p-6">
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Purchase order not found.</p>
        <Link href="/shipments" className="text-sm mt-3 block" style={{ color: "var(--foreground)" }}>← Back</Link>
      </div>
    );
  }

  const currentStepIdx = STEP_IDX[shipment.status];

  /* ════════════════════════════════════════════════════════════════════════ */
  /*  RENDER                                                                  */
  /* ════════════════════════════════════════════════════════════════════════ */

  return (
    <div className="pb-48 lg:pb-28">

      {/* ── Sticky header ── */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 px-0 py-3 mb-4"
        style={{ background: "var(--background)", borderBottom: "1px solid var(--glass-border-lo)" }}
      >
        <Link
          href="/shipments"
          className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition active:scale-95"
          style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>Purchase Order</p>
          <h1 className="text-[17px] font-semibold text-foreground leading-tight truncate">{shipment.reference}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Auto-save indicator */}
          {!locked && saveState === "saving" && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium"
              style={{ color: "var(--muted-foreground)" }}>
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          )}
          {!locked && saveState === "saved" && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold"
              style={{ color: "var(--snm-success)" }}>
              <CheckCircle2 className="h-3 w-3" /> Saved
            </span>
          )}
          {locked && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full"
              style={{ background: "color-mix(in srgb, var(--snm-success) 12%, transparent)", color: "var(--snm-success)" }}>
              <Lock className="h-2.5 w-2.5" /> Locked
            </span>
          )}
          <button
            onClick={() => setShowMore(true)}
            className="h-10 w-10 rounded-xl flex items-center justify-center transition active:scale-95"
            style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── Arrived banner ── */}
      {arrived && (
        <button
          onClick={() => document.getElementById("grn-bar")?.scrollIntoView({ behavior: "smooth" })}
          className="w-full flex items-center gap-3 px-4 py-3 mb-4 rounded-xl transition active:scale-95"
          style={{
            background: "color-mix(in srgb, var(--snm-warning) 15%, transparent)",
            border: "1px solid color-mix(in srgb, var(--snm-warning) 30%, transparent)",
          }}
        >
          <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: "var(--snm-warning)" }} />
          <p className="text-sm font-medium flex-1 text-left" style={{ color: "var(--snm-warning)" }}>
            Goods arrived — confirm receipt to update stock
          </p>
          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--snm-warning)" }} />
        </button>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1 — ORDER DETAILS                                         */}
      {/* ══════════════════════════════════════════════════════════════════ */}

      <div className="rounded-2xl p-5 mb-4 space-y-4" style={CARD}>
        <SectionHeader label="ORDER DETAILS" />

        {/* Reference */}
        <Field label="PO REFERENCE">
          {locked
            ? <p className="text-sm font-semibold text-foreground">{shipment.reference}</p>
            : <input
                value={shipment.reference}
                onChange={(e) => setShipment((p) => p ? { ...p, reference: e.target.value } : p)}
                onBlur={(e) => patch("reference", e.target.value)}
                className={inputCls}
                style={inputSty}
              />
          }
        </Field>

        {/* Supplier */}
        <Field label="SUPPLIER">
          {locked
            ? <p className="text-sm text-foreground">{suppliers.find((s) => s.id === shipment.supplier_id)?.name ?? "—"}</p>
            : <div className="relative">
                <select
                  value={shipment.supplier_id ?? ""}
                  onChange={(e) => patch("supplier_id", e.target.value || null)}
                  className={`${inputCls} appearance-none pr-10`}
                  style={inputSty}
                >
                  <option value="">No supplier assigned</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.country ? ` · ${s.country}` : ""}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
              </div>
          }
        </Field>

        {/* Status stepper */}
        {!locked && (
          <div className="space-y-3">
            <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>STATUS</p>

            {/* Read-only visual track */}
            <div className="flex items-center">
              {STEPS.map((step, i) => {
                const done    = currentStepIdx > i;
                const current = currentStepIdx === i;
                const isLast  = i === STEPS.length - 1;
                return (
                  <div key={step.value} className="flex items-center" style={{ flex: isLast ? "none" : 1 }}>
                    <div className="flex flex-col items-center gap-1.5">
                      <div
                        className="h-6 w-6 rounded-full flex items-center justify-center"
                        style={{
                          background: done || current ? "var(--foreground)" : "transparent",
                          border: done || current ? "none" : "2px solid var(--glass-border)",
                        }}
                      >
                        {done
                          ? <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--background)" }} />
                          : current
                            ? <div className="h-2 w-2 rounded-full" style={{ background: "var(--background)" }} />
                            : null
                        }
                      </div>
                      <p className="text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap"
                        style={{ color: done || current ? "var(--foreground)" : "var(--muted-foreground)" }}>
                        {step.label}
                      </p>
                    </div>
                    {!isLast && (
                      <div className="flex-1 h-px mx-1 mb-4" style={{ background: done ? "var(--foreground)" : "var(--glass-border)" }} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Explicit advance + back buttons */}
            {(() => {
              const nextStep = STEPS[currentStepIdx + 1];
              const prevStep = currentStepIdx > 0 ? STEPS[currentStepIdx - 1] : null;
              return (
                <div className="flex gap-2 pt-1">
                  {prevStep && (
                    <button
                      onClick={() => patchStatus(prevStep.value)}
                      className="flex items-center gap-1.5 h-11 px-4 rounded-xl text-[13px] font-medium transition active:scale-95"
                      style={{ background: "var(--glass-bg-2)", border: "1px solid var(--glass-border-lo)", color: "var(--muted-foreground)" }}
                    >
                      ← {prevStep.label}
                    </button>
                  )}
                  {nextStep && (
                    <button
                      onClick={() => patchStatus(nextStep.value)}
                      className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl text-[13px] font-semibold transition active:scale-95"
                      style={{ background: "var(--foreground)", color: "var(--background)" }}
                    >
                      <Truck className="h-4 w-4" />
                      Mark as {nextStep.label} →
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        )}
        {locked && (
          <Field label="STATUS">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" style={{ color: "var(--snm-success)" }} />
              <p className="text-sm font-semibold" style={{ color: "var(--snm-success)" }}>
                Received — {fmtDate(shipment.grn_confirmed_at)}
              </p>
            </div>
          </Field>
        )}

        {/* Supplier PO # + ETA — 2 col */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="SUPPLIER PO #">
            {locked
              ? <p className="text-sm text-foreground">{shipment.supplier_po_number ?? "—"}</p>
              : <input
                  value={shipment.supplier_po_number ?? ""}
                  onChange={(e) => setShipment((p) => p ? { ...p, supplier_po_number: e.target.value } : p)}
                  onBlur={(e) => patch("supplier_po_number", e.target.value || null)}
                  placeholder="Optional"
                  className={inputCls}
                  style={inputSty}
                />
            }
          </Field>
          <Field label="EXPECTED ARRIVAL">
            {locked
              ? <p className="text-sm text-foreground">{fmtDate(shipment.expected_arrival_date) || "—"}</p>
              : <div className="relative">
                  <input
                    type="date"
                    value={shipment.expected_arrival_date ?? ""}
                    onChange={(e) => patch("expected_arrival_date", e.target.value || null)}
                    disabled={locked}
                    className={`${inputCls} pr-10`}
                    style={inputSty}
                  />
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
                </div>
            }
          </Field>
        </div>

        {/* Notes */}
        <Field label="NOTES">
          <textarea
            value={shipment.notes ?? ""}
            onChange={(e) => setShipment((p) => p ? { ...p, notes: e.target.value } : p)}
            onBlur={(e) => patch("notes", e.target.value || null)}
            disabled={locked}
            placeholder="Add notes about this order…"
            rows={3}
            className="w-full rounded-xl px-4 py-3 text-sm text-foreground outline-none resize-none placeholder:text-muted-foreground"
            style={locked ? disabledSty : inputSty}
          />
        </Field>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2 — LINE ITEMS                                            */}
      {/* ══════════════════════════════════════════════════════════════════ */}

      <div className="rounded-2xl p-5 mb-4" style={CARD}>
        <SectionHeader
          label="PRODUCTS ORDERED"
          action={!locked
            ? <button
                onClick={() => { setEditingLine(undefined); setPanel("addLine"); }}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-bold transition active:scale-95"
                style={{ background: "var(--foreground)", color: "var(--background)" }}
              >
                <Plus className="h-3 w-3" /> Add Product
              </button>
            : null
          }
        />

        {lines.length === 0 ? (
          <button
            onClick={() => { setEditingLine(undefined); setPanel("addLine"); }}
            disabled={locked}
            className="w-full h-14 rounded-xl flex items-center justify-center gap-2 text-sm transition active:scale-95"
            style={{
              border: "1.5px dashed var(--glass-border)",
              background: "transparent",
              color: "var(--muted-foreground)",
            }}
          >
            <Plus className="h-4 w-4" />
            Add first product
          </button>
        ) : (
          <div className="space-y-3">
            {lines.map((l) => {
              const sku      = skus.find((s) => s.id === l.sku_id);
              const godown   = godowns.find((g) => g.id === l.destination_godown_id);
              const livePer  = preview?.lines.find((p) => p.line.id === l.id);
              const estPiece = livePer?.perPiece ?? null;
              const ratesSet = preview?.ratesSet ?? false;
              const actualQty = l.qty_cartons_actual ?? l.qty_cartons;
              const isShort  = l.qty_cartons_actual != null && l.qty_cartons_actual < l.qty_cartons;

              return (
                <div key={l.id} className="rounded-xl overflow-hidden" style={{ background: "var(--glass-bg-1)", border: "1px solid var(--glass-border-lo)" }}>
                  {/* Top: SKU name + actions */}
                  <div className="flex items-start justify-between gap-2 p-4 pb-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-foreground leading-tight">
                        {sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "Unknown SKU"}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                        {sku ? `${sku.pcs_per_pack}/pk × ${sku.packs_per_carton}/ctn` : ""}
                        {godown ? ` · → ${godown.name}` : ""}
                      </p>
                    </div>
                    {!locked && (
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => { setEditingLine(l); setPanel("addLine"); }}
                          className="h-8 px-2 rounded-lg text-[11px] font-medium transition"
                          style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}>
                          Edit
                        </button>
                        <button onClick={() => { setPendingDeleteLine(l); setPanel("deleteLine"); }}
                          className="h-8 w-8 rounded-lg flex items-center justify-center transition"
                          style={{ background: "color-mix(in srgb, var(--snm-error) 8%, transparent)", color: "var(--snm-error)" }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* FOB + est. landed cost */}
                  <div className="flex items-center justify-between px-4 pb-3 gap-4">
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      FOB <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                        {l.fob_per_carton.toLocaleString()} {l.fob_currency}/ctn
                      </span>
                    </p>
                    {estPiece != null && estPiece > 0 ? (
                      <p className="text-[11px] font-semibold" style={{ color: ratesSet ? "var(--snm-success)" : "var(--snm-warning)" }}>
                        {ratesSet ? "" : "~"}Est MVR {fmt2(estPiece)}/pc
                      </p>
                    ) : (
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Est. cost TBD</p>
                    )}
                  </div>

                  {/* Ordered qty */}
                  <div className="px-4 pb-3">
                    <p className="text-[11px] mb-1.5 font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                      Ordered
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <QtyStepper
                          value={l.qty_cartons}
                          min={1}
                          disabled={locked}
                          onChange={async (v) => {
                            await updateShipmentLine(l.id, { qty_cartons: v } as Parameters<typeof updateShipmentLine>[1]);
                            load();
                          }}
                        />
                      </div>
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>cartons</p>
                    </div>
                  </div>

                  {/* Actual received qty — only when arrived or grn_confirmed */}
                  {(arrived || locked) && (
                    <div className="px-4 pb-4" style={{ borderTop: "1px solid var(--glass-border-lo)", paddingTop: 12, marginTop: 4 }}>
                      <p className="text-[11px] mb-1.5 font-semibold uppercase tracking-wider"
                        style={{ color: isShort ? "var(--snm-warning)" : "var(--muted-foreground)" }}>
                        Actually Received {isShort ? "⚠ Short shipment" : ""}
                      </p>
                      {locked
                        ? <p className="text-sm font-semibold" style={{ color: isShort ? "var(--snm-warning)" : "var(--foreground)" }}>
                            {actualQty} cartons {isShort ? `(${l.qty_cartons - actualQty} short)` : ""}
                          </p>
                        : <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <QtyStepper
                                value={actualQty}
                                min={0}
                                disabled={locked}
                                onChange={async (v) => {
                                  const val = v === l.qty_cartons ? null : v;
                                  await updateShipmentLine(l.id, { qty_cartons_actual: val } as Parameters<typeof updateShipmentLine>[1]);
                                  load();
                                }}
                              />
                            </div>
                            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>cartons</p>
                          </div>
                      }
                    </div>
                  )}

                  {/* Locked: landed cost breakdown */}
                  {locked && (
                    <div className="grid grid-cols-4 gap-2 px-4 pb-4" style={{ borderTop: "1px solid var(--glass-border-lo)", paddingTop: 12, marginTop: 0 }}>
                      {[
                        { label: "Total",   value: l.landed_total_mvr     != null ? `MVR ${fmt0(Number(l.landed_total_mvr))}` : "—" },
                        { label: "/carton", value: l.landed_per_carton_mvr != null ? fmt0(Number(l.landed_per_carton_mvr)) : "—" },
                        { label: "/pack",   value: l.landed_per_pack_mvr   != null ? fmt2(Number(l.landed_per_pack_mvr)) : "—" },
                        { label: "/piece",  value: l.landed_per_piece_mvr  != null ? fmt2(Number(l.landed_per_piece_mvr)) : "—", highlight: true },
                      ].map((c) => (
                        <div key={c.label} className="rounded-lg p-2 text-center" style={{ background: "var(--glass-bg-2)" }}>
                          <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
                          <p className="text-[12px] font-semibold" style={{ color: c.highlight ? "var(--snm-success)" : "var(--foreground)" }}>{c.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Dashed "add more" button below lines */}
            {!locked && (
              <button
                onClick={() => { setEditingLine(undefined); setPanel("addLine"); }}
                className="w-full h-12 rounded-xl flex items-center justify-center gap-2 text-sm transition active:scale-95"
                style={{ border: "1.5px dashed var(--glass-border)", background: "transparent", color: "var(--muted-foreground)" }}
              >
                <Plus className="h-4 w-4" />
                Add another product
              </button>
            )}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SECTION 3 — COSTS & FOREX (collapsible)                          */}
      {/* ══════════════════════════════════════════════════════════════════ */}

      <div className="rounded-2xl overflow-hidden mb-4" style={CARD}>
        {/* Collapsible header */}
        <button
          onClick={() => setCostsOpen(!costsOpen)}
          className="w-full flex items-center justify-between p-5 transition"
        >
          <div>
            <p className="label-caps text-[11px] text-left mb-0.5" style={{ color: "var(--muted-foreground)" }}>COSTS & FOREX</p>
            {!costsOpen && preview && (
              <p className="text-[12px] font-semibold text-foreground">
                Total landed: MVR {fmt0(preview.grandTotal)}
              </p>
            )}
            {!costsOpen && !preview && (
              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>Tap to enter rates and costs</p>
            )}
          </div>
          <ChevronDown
            className="h-4 w-4 shrink-0 transition-transform"
            style={{ color: "var(--muted-foreground)", transform: costsOpen ? "rotate(180deg)" : "none" }}
          />
        </button>

        {costsOpen && (
          <div className="px-5 pb-5 space-y-5" style={{ borderTop: "1px solid var(--glass-border-lo)" }}>

            {/* Forex */}
            <div className="pt-5">
              <p className="text-[11px] mb-3" style={{ color: "var(--muted-foreground)" }}>
                Enter your bank&apos;s rates — locked permanently when you confirm GRN.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <Field label="1 USD = ___ MVR *">
                  <NumInput
                    value={shipment.rate_usd_to_mvr}
                    disabled={locked}
                    placeholder="e.g. 15.42"
                    onChange={async (v) => {
                      await patch("rate_usd_to_mvr", v);
                      const idrUsd = shipment.rate_idr_to_usd;
                      if (idrUsd && idrUsd > 0 && v) await patch("rate_idr_to_mvr", v * idrUsd);
                    }}
                  />
                </Field>
                <Field label="1 USD = ___ IDR *">
                  <NumInput
                    value={shipment.rate_idr_to_usd
                      ? Math.round(1 / shipment.rate_idr_to_usd)
                      : null
                    }
                    disabled={locked}
                    placeholder="e.g. 15820"
                    onChange={async (usdToIdr) => {
                      if (!usdToIdr || usdToIdr <= 0) { await patch("rate_idr_to_usd", null); await patch("rate_idr_to_mvr", null); return; }
                      const idrToUsd = 1 / usdToIdr;
                      await patch("rate_idr_to_usd", idrToUsd);
                      const usdMvr = shipment.rate_usd_to_mvr;
                      if (usdMvr) await patch("rate_idr_to_mvr", usdMvr * idrToUsd);
                    }}
                  />
                </Field>
              </div>
              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                IDR → MVR (auto): {shipment.rate_idr_to_mvr != null ? shipment.rate_idr_to_mvr.toFixed(6) : "—"}
              </p>
            </div>

            {/* Freight */}
            <div>
              <Field label="MY FREIGHT SHARE (USD)">
                <NumInput value={shipment.my_freight_share_usd} disabled={locked} placeholder="0" onChange={(v) => patch("my_freight_share_usd", v ?? 0)} />
              </Field>
              {preview && (
                <p className="text-[11px] mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                  = MVR <span className="font-semibold text-foreground">{fmt0(preview.freightMvr)}</span>
                </p>
              )}
            </div>

            {/* Local costs */}
            <div>
              <p className="label-caps text-[11px] mb-3" style={{ color: "var(--muted-foreground)" }}>LOCAL COSTS (MVR)</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Customs duty",  field: "customs_duty_mvr" },
                  { label: "MPL / Port",    field: "mpl_charges_mvr"  },
                  { label: "Agent fee",     field: "agent_fee_mvr"    },
                  { label: "Last mile",     field: "last_mile_mvr"    },
                  { label: "Insurance",     field: "insurance_mvr"    },
                  { label: "Other",         field: "other_mvr"        },
                ].map(({ label, field }) => (
                  <div key={field} className="space-y-1">
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>
                    <NumInput
                      value={(shipment as unknown as Record<string, number>)[field]}
                      disabled={locked}
                      compact
                      placeholder="0"
                      onChange={(v) => patch(field, v ?? 0)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Cost summary bar */}
            {preview && (
              <div className="rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap" style={{ background: "var(--glass-bg-2)" }}>
                {[
                  { label: "FOB",     value: preview.ratesSet ? `MVR ${fmt0(preview.lines.reduce((a, l) => a + l.fobMvr, 0))}` : "?" },
                  { sep: "+" },
                  { label: "Freight", value: `MVR ${fmt0(preview.freightMvr)}` },
                  { sep: "+" },
                  { label: "Local",   value: `MVR ${fmt0(preview.localMvr)}` },
                  { sep: "=" },
                  { label: "Total",   value: preview.ratesSet ? `MVR ${fmt0(preview.grandTotal)}` : "?", bold: true },
                ].map((item, i) =>
                  "sep" in item
                    ? <span key={i} className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{item.sep}</span>
                    : <div key={i} className="text-center">
                        <p className="text-[9px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{item.label}</p>
                        <p className={`text-[12px] ${item.bold ? "font-bold" : "font-medium"}`} style={{ color: item.bold ? "var(--foreground)" : "var(--muted-foreground)" }}>
                          {item.value}
                        </p>
                      </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Post-GRN: price change alerts ── */}
      {locked && priceChanges.length > 0 && (
        <div className="rounded-2xl p-5 mb-4" style={{ ...CARD, border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" }}>
          <p className="text-[13px] font-bold mb-3" style={{ color: "var(--snm-warning)" }}>
            ⚠ {priceChanges.length} SKU{priceChanges.length > 1 ? "s" : ""} had a selling price change
          </p>
          <div className="space-y-2">
            {priceChanges.map((c) => (
              <div key={c.skuPath} className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: "var(--glass-bg-1)" }}>
                <p className="text-[12px] flex-1 truncate text-foreground">{c.skuPath}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>MVR {c.before.toFixed(2)}</span>
                  <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>→</span>
                  <span className="text-[13px] font-bold" style={{ color: c.changePct > 0 ? "var(--snm-warning)" : "var(--snm-success)" }}>
                    MVR {c.after.toFixed(2)}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: c.changePct > 0 ? "var(--snm-warning)" : "var(--snm-success)" }}>
                    {c.changePct > 0 ? "+" : ""}{c.changePct.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-3" style={{ color: "var(--muted-foreground)" }}>
            Prices are live now. Go to Products → Edit SKU to lock a fixed price.
          </p>
          <button onClick={() => setPriceChanges([])} className="mt-2 text-[11px] underline" style={{ background: "none", border: "none", color: "var(--muted-foreground)", cursor: "pointer" }}>
            Dismiss
          </button>
        </div>
      )}

      {/* ── Sticky bottom bar (id for smooth scroll anchor) ── */}
      {/* Mobile: z-50 sits above the bottom nav (z-40), offset by nav height.  */}
      {/* Desktop (lg): nav is lg:hidden, bar sits at true viewport bottom.      */}
      {/* We use a CSS var --grn-bottom set by a style tag below.                */}
      <div
        id="grn-bar"
        className="fixed left-0 lg:left-60 right-0 z-50 px-4 pt-3"
        style={{
          bottom: 0,
          paddingBottom: "calc(60px + env(safe-area-inset-bottom, 0px))",
          background: "color-mix(in srgb, var(--background) 92%, transparent)",
          borderTop: "1px solid var(--glass-border-lo)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        {locked ? (
          /* State C — confirmed */
          <div className="flex items-center gap-3 h-14 rounded-xl px-4"
            style={{ background: "color-mix(in srgb, var(--snm-success) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
            <Truck className="h-5 w-5 shrink-0" style={{ color: "var(--snm-success)" }} />
            <div>
              <p className="text-[13px] font-semibold" style={{ color: "var(--snm-success)" }}>Stock Live</p>
              {shipment.grn_confirmed_at && (
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  Confirmed {fmtDate(shipment.grn_confirmed_at)}
                </p>
              )}
            </div>
          </div>
        ) : arrived ? (
          /* State B — confirm GRN */
          <button
            onClick={() => !grnBlockReason && setPanel("confirmGrn")}
            disabled={!!grnBlockReason}
            title={grnBlockReason ?? undefined}
            className="w-full h-14 rounded-xl text-sm font-bold uppercase tracking-widest transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            style={{
              background: grnBlockReason ? "var(--glass-2)" : "var(--snm-success)",
              color: grnBlockReason ? "var(--muted-foreground)" : "#fff",
            }}
          >
            {grnBlockReason
              ? <><AlertTriangle className="h-4 w-4" /> {grnBlockReason}</>
              : <><CheckCircle2 className="h-4 w-4" /> Confirm GRN — Lock & Create Stock</>}
          </button>
        ) : (
          /* State A — in progress */
          <div className="flex items-center justify-between gap-3 h-14">
            {preview && preview.ratesSet ? (
              <div>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Est. landed total</p>
                <p className="text-[17px] font-semibold text-foreground">MVR {fmt0(preview.grandTotal)}</p>
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>Enter costs to see estimate</p>
            )}
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              <Package className="h-3.5 w-3.5" />
              {lines.length} line{lines.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* BOTTOM SHEETS                                                      */}
      {/* ══════════════════════════════════════════════════════════════════ */}

      {/* ··· More menu */}
      <Sheet open={showMore} onClose={() => setShowMore(false)}>
        <p className="text-[16px] font-bold text-foreground mb-4">Options</p>
        <div className="space-y-2">
          {!locked && isAdmin && (
            <button
              onClick={() => { setShowMore(false); setPanel("deleteShipment"); }}
              className="w-full flex items-center gap-3 h-12 px-4 rounded-xl text-sm font-medium transition"
              style={{ background: "color-mix(in srgb, var(--snm-error) 8%, transparent)", color: "var(--snm-error)" }}
            >
              <Trash2 className="h-4 w-4" /> Delete Purchase Order
            </button>
          )}
          {locked && isAdmin && (
            <button
              onClick={() => { setShowMore(false); setPanel("voidGrn"); }}
              className="w-full flex items-center gap-3 h-12 px-4 rounded-xl text-sm font-medium transition"
              style={{ background: "color-mix(in srgb, var(--snm-error) 8%, transparent)", color: "var(--snm-error)" }}
            >
              <RotateCcw className="h-4 w-4" /> Void GRN &amp; Re-enter
            </button>
          )}
          <button
            onClick={() => setShowMore(false)}
            className="w-full h-12 px-4 rounded-xl text-sm font-medium"
            style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}
          >
            Close
          </button>
        </div>
      </Sheet>

      {/* Confirm GRN */}
      <Sheet open={panel === "confirmGrn"} onClose={() => setPanel(null)}>
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--snm-success) 12%, transparent)", color: "var(--snm-success)" }}>
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <h2 className="text-[20px] font-semibold text-foreground">Confirm Receipt</h2>
        </div>

        {/* Summary */}
        {preview && (
          <div className="rounded-xl p-4 mb-4 space-y-2" style={{ background: "var(--glass-bg-1)" }}>
            {[
              { label: "Products",        value: `${lines.length}` },
              { label: "Total CBM",       value: preview.totalCbm.toFixed(4) },
              { label: "USD → MVR rate",  value: shipment.rate_usd_to_mvr ? `${shipment.rate_usd_to_mvr}` : "—" },
              { label: "Total landed",    value: `MVR ${fmt0(preview.grandTotal)}`, bold: true },
            ].map((r) => (
              <div key={r.label} className="flex justify-between">
                <span className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>{r.label}</span>
                <span className="text-[13px]" style={{ color: "var(--foreground)", fontWeight: r.bold ? 700 : 500 }}>{r.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Short shipment warning */}
        {lines.some((l) => l.qty_cartons_actual != null && l.qty_cartons_actual < l.qty_cartons) && (
          <div className="rounded-xl p-4 mb-4" style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" }}>
            <p className="text-[12px] font-semibold mb-2" style={{ color: "var(--snm-warning)" }}>⚠ Short shipment on some lines</p>
            {lines.filter((l) => l.qty_cartons_actual != null && l.qty_cartons_actual < l.qty_cartons).map((l) => {
              const sku = skus.find((s) => s.id === l.sku_id);
              return (
                <p key={l.id} className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  • {sku?.model_name ?? "SKU"}: {l.qty_cartons} ordered, {l.qty_cartons_actual} received
                </p>
              );
            })}
          </div>
        )}

        <p className="text-[13px] mb-5" style={{ color: "var(--muted-foreground)" }}>
          Forex rates and costs will be <strong style={{ color: "var(--foreground)" }}>permanently locked</strong>. Stock becomes available for sale immediately.
        </p>

        <div className="flex gap-3">
          <button onClick={() => setPanel(null)} className="flex-1 h-12 rounded-xl text-sm font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>
            Cancel
          </button>
          <button onClick={handleConfirmGrn} disabled={confirming}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "var(--snm-success)", color: "#fff" }}>
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & Lock →"}
          </button>
        </div>
      </Sheet>

      {/* Void GRN */}
      <Sheet open={panel === "voidGrn"} onClose={() => setPanel(null)}>
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h2 className="text-[20px] font-semibold" style={{ color: "var(--snm-error)" }}>Void GRN?</h2>
        </div>
        <p className="text-sm mb-2" style={{ color: "var(--muted-foreground)" }}>
          <strong style={{ color: "var(--foreground)" }}>{shipment.reference}</strong> — all inventory batches, stock movements, and linked sales orders will be permanently deleted.
        </p>
        <p className="text-[11px] rounded-xl px-3 py-2 mb-5" style={{ background: "color-mix(in srgb, var(--snm-error) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--muted-foreground)" }}>
          ⚠ If stock from this shipment has already been sold, those sales orders will also be deleted.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setPanel(null)} className="flex-1 h-12 rounded-xl text-sm font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button
            onClick={async () => {
              setVoiding(true);
              try { await forceVoidGrn(shipment.id); toast.success("Shipment voided"); router.push("/shipments"); }
              catch (e) { toast.error((e as Error).message); }
              finally { setVoiding(false); }
            }}
            disabled={voiding}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center"
            style={{ background: "var(--snm-error)", color: "#fff" }}>
            {voiding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Void & Delete"}
          </button>
        </div>
      </Sheet>

      {/* Delete shipment */}
      <Sheet open={panel === "deleteShipment"} onClose={() => setPanel(null)}>
        <h2 className="text-[20px] font-semibold mb-2" style={{ color: "var(--snm-error)" }}>Delete Purchase Order?</h2>
        <p className="text-sm mb-5" style={{ color: "var(--muted-foreground)" }}>
          <strong style={{ color: "var(--foreground)" }}>{shipment.reference}</strong> and all its lines will be permanently removed.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setPanel(null)} className="flex-1 h-12 rounded-xl text-sm font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button
            onClick={async () => {
              try { await deleteShipment(shipment.id); toast.success("Deleted"); router.push("/shipments"); }
              catch (e) { toast.error((e as Error).message); }
            }}
            className="flex-[2] h-12 rounded-xl text-sm font-bold"
            style={{ background: "var(--snm-error)", color: "#fff" }}>
            Delete
          </button>
        </div>
      </Sheet>

      {/* Delete line */}
      <Sheet open={panel === "deleteLine"} onClose={() => { setPendingDeleteLine(null); setPanel(null); }}>
        <h2 className="text-[20px] font-semibold mb-2" style={{ color: "var(--snm-error)" }}>Remove product?</h2>
        <p className="text-sm mb-5" style={{ color: "var(--muted-foreground)" }}>
          {pendingDeleteLine && (() => {
            const sku = skus.find((s) => s.id === pendingDeleteLine.sku_id);
            return sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "This line";
          })()} will be removed from the PO.
        </p>
        <div className="flex gap-3">
          <button onClick={() => { setPendingDeleteLine(null); setPanel(null); }} className="flex-1 h-12 rounded-xl text-sm font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button
            onClick={async () => {
              if (!pendingDeleteLine) return;
              try {
                await deleteShipmentLine(pendingDeleteLine.id);
                toast.success("Removed");
                setPendingDeleteLine(null); setPanel(null); load();
              } catch (e) { toast.error((e as Error).message); }
            }}
            className="flex-[2] h-12 rounded-xl text-sm font-bold"
            style={{ background: "var(--snm-error)", color: "#fff" }}>
            Remove
          </button>
        </div>
      </Sheet>

      {/* Add / edit line */}
      {panel === "addLine" && (
        <LineDialog
          editing={editingLine}
          shipmentId={id}
          skus={skus}
          godowns={godowns}
          onClose={() => { setEditingLine(undefined); setPanel(null); }}
          onSaved={() => { setEditingLine(undefined); setPanel(null); load(); }}
        />
      )}
    </div>
  );
}

/* ── Line dialog ─────────────────────────────────────────────────────────── */

function LineDialog({
  editing, shipmentId, skus, godowns, onClose, onSaved,
}: {
  editing?: ShipmentLineRow;
  shipmentId: string;
  skus: SkuFullRow[];
  godowns: GodownRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [skuId, setSkuId]               = useState(editing?.sku_id ?? "");
  const [qtyCartons, setQtyCartons]     = useState(editing?.qty_cartons ?? 1);
  const [fobPerCarton, setFobPerCarton] = useState(editing ? String(editing.fob_per_carton) : "");
  const [fobCurrency, setFobCurrency]   = useState<FobCurrency>(editing?.fob_currency ?? "IDR");
  const [godownId, setGodownId]         = useState(
    editing?.destination_godown_id ?? (godowns.find((g) => g.is_default)?.id ?? godowns[0]?.id ?? "")
  );
  const [saving, setSaving]             = useState(false);
  const [search, setSearch]             = useState("");

  const sku = skus.find((s) => s.id === skuId);

  const filteredSkus = useMemo(() => {
    const term = search.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    if (!term) return active.slice(0, 50);
    return active.filter((s) =>
      [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""].join(" ").toLowerCase().includes(term)
    ).slice(0, 50);
  }, [skus, search]);

  async function save() {
    if (!skuId || !fobPerCarton || !godownId || !sku) return;
    const parsedFob = parseFloat(fobPerCarton);
    if (isNaN(parsedFob) || parsedFob <= 0) { toast.error("FOB must be > 0"); return; }
    const payload = {
      shipment_id: shipmentId, sku_id: skuId,
      qty_cartons: qtyCartons,
      cbm_per_carton: Number(sku.cbm_per_carton),
      fob_per_carton: parsedFob,
      fob_currency: fobCurrency,
      destination_godown_id: godownId,
    };
    setSaving(true);
    try {
      if (editing) await updateShipmentLine(editing.id, payload);
      else await createShipmentLine(payload);
      toast.success(editing ? "Line updated" : "Product added");
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  const inputSty2: React.CSSProperties = {
    background: "var(--glass-bg-1)",
    border: "1px solid var(--glass-border-lo)",
  };

  return (
    <div className="fixed inset-0 z-60 flex items-end" style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl"
        style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", padding: "12px 24px 40px", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "var(--glass-border)" }} />
        <h2 className="text-[20px] font-semibold text-foreground mb-5">{editing ? "Edit Product" : "Add Product"}</h2>

        {/* SKU picker */}
        <div className="mb-4">
          <p className="label-caps text-[11px] mb-2" style={{ color: "var(--muted-foreground)" }}>PRODUCT *</p>
          {!skuId ? (
            <>
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search brand, model, code…"
                className="w-full h-12 rounded-xl px-4 text-sm text-foreground outline-none"
                style={inputSty2}
              />
              <div className="mt-2 rounded-xl overflow-hidden" style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--glass-border-lo)", background: "var(--glass-bg-1)" }}>
                {filteredSkus.length === 0
                  ? <p className="p-4 text-sm" style={{ color: "var(--muted-foreground)" }}>No matches.</p>
                  : filteredSkus.map((s) => (
                    <button key={s.id} onClick={() => setSkuId(s.id)}
                      className="w-full text-left px-4 py-3 transition"
                      style={{ borderBottom: "1px solid var(--glass-border-lo)", background: "transparent" }}>
                      <p className="text-[13px] font-medium text-foreground">{s.brand_name} › {s.model_name} › {s.variant_display}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                        {s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn · CBM {Number(s.cbm_per_carton).toFixed(4)}
                      </p>
                    </button>
                  ))
                }
              </div>
            </>
          ) : sku ? (
            <div className="rounded-xl p-4" style={{ background: "var(--glass-bg-1)", border: "1px solid var(--glass-border-lo)" }}>
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="text-[13px] font-semibold text-foreground">{sku.brand_name} › {sku.model_name} › {sku.variant_display}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    {sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn · CBM {Number(sku.cbm_per_carton).toFixed(4)}
                  </p>
                </div>
                <button onClick={() => setSkuId("")} className="text-[11px] shrink-0" style={{ color: "var(--muted-foreground)", background: "none", border: "none", cursor: "pointer" }}>
                  Change
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Qty stepper */}
        {skuId && (
          <>
            <div className="mb-4">
              <p className="label-caps text-[11px] mb-2" style={{ color: "var(--muted-foreground)" }}>QTY CARTONS *</p>
              <QtyStepper value={qtyCartons} min={1} onChange={setQtyCartons} />
              {sku && (
                <p className="text-[11px] mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                  = {qtyCartons * sku.packs_per_carton * sku.pcs_per_pack} pcs
                  · {(qtyCartons * Number(sku.cbm_per_carton)).toFixed(4)} CBM
                </p>
              )}
            </div>

            {/* FOB price */}
            <div className="mb-4">
              <p className="label-caps text-[11px] mb-2" style={{ color: "var(--muted-foreground)" }}>SUPPLIER PRICE / CARTON *</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={fobPerCarton}
                  onChange={(e) => setFobPerCarton(e.target.value)}
                  placeholder="e.g. 51200"
                  className="flex-1 h-12 rounded-xl px-4 text-sm text-foreground outline-none"
                  style={inputSty2}
                />
                <div className="relative">
                  <select
                    value={fobCurrency}
                    onChange={(e) => setFobCurrency(e.target.value as FobCurrency)}
                    className="h-12 rounded-xl px-3 pr-8 text-sm text-foreground outline-none appearance-none"
                    style={{ ...inputSty2, width: 80 }}
                  >
                    <option value="IDR">IDR</option>
                    <option value="USD">USD</option>
                    <option value="MVR">MVR</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
                </div>
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                Price on this shipment&apos;s invoice — can differ from previous shipments.
              </p>
            </div>

            {/* Destination godown */}
            <div className="mb-6">
              <p className="label-caps text-[11px] mb-2" style={{ color: "var(--muted-foreground)" }}>DESTINATION WAREHOUSE *</p>
              <div className="relative">
                <select
                  value={godownId}
                  onChange={(e) => setGodownId(e.target.value)}
                  className="w-full h-12 rounded-xl px-4 pr-10 text-sm text-foreground outline-none appearance-none"
                  style={inputSty2}
                >
                  <option value="">Select…</option>
                  {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}{g.is_default ? " (default)" : ""}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
              </div>
              {godowns.length === 0 && (
                <p className="text-[11px] mt-1.5" style={{ color: "var(--snm-warning)" }}>No warehouses yet — add one in Settings.</p>
              )}
            </div>
          </>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl text-sm font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button
            onClick={save}
            disabled={saving || !skuId || !fobPerCarton || !godownId}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save Changes" : "Add to PO"}
          </button>
        </div>
      </div>
    </div>
  );
}

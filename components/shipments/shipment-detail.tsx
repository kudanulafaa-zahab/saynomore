"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2, ArrowLeft, Plus, Trash2, CheckCircle2, Lock,
  AlertTriangle, Truck, ChevronDown, RotateCcw, Calendar,
  ChevronRight, Minus, MoreHorizontal, Package, ScanLine, Warehouse, Pencil,
  Container, Sparkles, Check,
} from "lucide-react";
import dynamic from "next/dynamic";

// Lazy-load the barcode scanner so the heavy @zxing library stays out of this
// route's bundle; it only loads when the user taps the scan button.
const BarcodeScanner = dynamic(
  () => import("@/components/ui/barcode-scanner").then((m) => m.BarcodeScanner),
  { ssr: false },
);
import {
  getShipment, listShipmentLines, updateShipment, deleteShipment,
  createShipmentLine, updateShipmentLine, deleteShipmentLine,
  confirmGrn, forceVoidGrn, reopenGrn, CONTAINER_CAPACITY_CBM, getLastConfirmedRates,
  type ShipmentRow, type ShipmentLineRow, type FobCurrency, type ShipmentStatus,
  type ContainerSizeHint,
} from "@/lib/queries/shipments";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { notifyAdmins } from "@/lib/push";
import { getPricingHealth } from "@/lib/queries/pricing";
import { SkuIdentity } from "@/components/ui/sku-identity";
import { listSkusFlat, type SkuFullRow, getCurrentUserRole } from "@/lib/queries/products";
import { listSuppliers, listGodowns, type SupplierRow, type GodownRow } from "@/lib/queries/masters";
import { haptic } from "@/lib/haptics";

/* ── Style helpers ───────────────────────────────────────────────────────── */

const CARD: React.CSSProperties = {
  background: "linear-gradient(180deg, var(--glass-fill-top), var(--glass-fill-bottom))",
  backdropFilter: "blur(calc(14px * var(--frost-b))) saturate(var(--glass-saturate))",
  WebkitBackdropFilter: "blur(calc(14px * var(--frost-b))) saturate(var(--glass-saturate))",
  borderRadius: 16,
  boxShadow: "inset 0 1px 1px var(--glass-specular), var(--glass-shadow)",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.65))",
};

const SHEET: React.CSSProperties = {
  background: "var(--glass-2)",
  backdropFilter: "var(--glass-blur-lg)",
  WebkitBackdropFilter: "var(--glass-blur-lg)",
};

const inputCls = [
  "w-full h-12 rounded-xl px-4 text-sm text-foreground outline-none",
  "placeholder:text-muted-foreground transition",
].join(" ");

const inputSty: React.CSSProperties = {
  background: "var(--glass-bg-1)",
  border: "0.5px solid var(--glass-border-lo)",
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
  value, onChange, disabled, placeholder, compact, min,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
  min?: number;
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
      onFocus={(e) => e.target.select()}
      onBlur={() => {
        let n = local === "" ? null : Number(local);
        // Costs can never be negative — a stray minus sign here would
        // deflate landed cost permanently at GRN. Clamp and show what
        // was actually saved (DB CHECKs from 0055 are the backstop).
        if (n != null && min != null && n < min) { n = min; setLocal(String(min)); }
        if (n !== (value ?? null)) onChange(n);
      }}
      disabled={disabled}
      className={`${inputCls} ${compact ? "h-10 ios-subhead" : ""}`}
      style={disabled ? disabledSty : inputSty}
    />
  );
}

/* ── Qty stepper ─────────────────────────────────────────────────────────── */

function QtyStepper({
  value, onChange, disabled, min = 0, max,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));

  // Keep draft in sync when value changes externally (e.g. after save)
  useEffect(() => { setDraft(String(value)); }, [value]);

  function commit(raw: string) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= min && (max == null || n <= max)) {
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
        style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}
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
          border: "0.5px solid var(--glass-border-lo)",
          minWidth: 56,
          // hide browser spin arrows — keyboard +/- buttons handle stepping
          MozAppearance: "textfield",
        } as React.CSSProperties}
      />
      <button
        onClick={() => { const v = max != null ? Math.min(max, value + 1) : value + 1; onChange(v); setDraft(String(v)); }}
        disabled={disabled || (max != null && value >= max)}
        className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition active:scale-95 disabled:opacity-30"
        style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ── Bottom sheet wrapper ────────────────────────────────────────────────── */

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useBodyScrollLock(open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-60 flex items-end snm-scrim-in" style={{ background: "var(--scrim-bg)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl snm-sheet-in"
        style={{
          ...SHEET,
          padding: "12px 24px",
          paddingBottom: "calc(32px + env(safe-area-inset-bottom, 16px))",
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
          overflowY: "auto",
        }}
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
      <p className="label-caps text-[12px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{label}</p>
      {action}
    </div>
  );
}

/* ── Labeled field wrapper ───────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>
      {children}
    </div>
  );
}

/* ── Shared-container freight estimator ──────────────────────────────────── */
// Ali's brother pays the whole container's freight bill; Ali reimburses a
// fair share. Neither side reliably knows the container's actual loaded
// CBM, so this estimates using standard nominal capacity (20ft/40HQ) as the
// denominator — clearly labeled an estimate, never presented as exact.
// Result only pre-fills my_freight_share_usd; it stays fully editable.
function SharedContainerEstimator({
  shipment, myCbm, disabled, onApply, onPatch,
}: {
  shipment: ShipmentRow;
  myCbm: number;
  disabled: boolean;
  onApply: (v: number) => void;
  onPatch: (field: string, value: number | string | boolean | null) => void;
}) {
  const [open, setOpen] = useState(shipment.shared_container);
  const [totalFreight, setTotalFreight] = useState(
    shipment.total_container_freight_usd != null ? String(shipment.total_container_freight_usd) : "",
  );
  const size = shipment.container_size_hint;

  const capacity = size ? CONTAINER_CAPACITY_CBM[size] : null;
  const totalFreightNum = totalFreight === "" ? null : Number(totalFreight);
  const estimate = capacity && totalFreightNum != null && myCbm > 0
    ? (totalFreightNum * (myCbm / capacity))
    : null;
  // A shipment bigger than the chosen container can't be right — the share
  // would exceed 100% of the partner's bill. Warn instead of estimating
  // nonsense; the wrong container size is the usual cause.
  const overCapacity = capacity != null && myCbm > capacity;

  // Auto-apply the estimate into My Freight Share (USD) as soon as the
  // container size + partner total are both set. The whole reason this
  // exists is so the freight flows into landed cost — making the user hunt
  // for a "Use this" button meant freight silently stayed at 0 (real
  // confusion this caused). Only writes when the value actually changed,
  // and only while sharing is toggled on and the section is editable.
  const applied = estimate != null && !overCapacity ? Number(estimate.toFixed(2)) : null;
  useEffect(() => {
    if (disabled || !open || applied == null) return;
    if (Math.abs((shipment.my_freight_share_usd ?? 0) - applied) > 0.005) {
      onApply(applied);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, open, disabled]);

  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next !== shipment.shared_container) onPatch("shared_container", next);
        }}
        disabled={disabled}
        className="w-full flex items-center gap-2.5 px-3.5 h-12 transition active:opacity-70"
      >
        <Container className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <span className="flex-1 text-left ios-subhead font-medium text-foreground">Sharing a container?</span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 transition-transform"
          style={{ color: "var(--muted-foreground)", transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>

      {open && (
        <div className="px-3.5 pb-4 space-y-3" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
          <div className="pt-3.5 flex items-center gap-1.5 ios-subhead" style={{ color: "var(--muted-foreground)" }}>
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            Estimate only — based on standard container size, not the real loaded CBM.
          </div>

          {/* Container size — segmented control, matches app-wide pattern */}
          <div className="rounded-2xl p-1 flex gap-1" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}>
            {(["20ft", "40hq"] as ContainerSizeHint[]).map((s) => (
              <button
                key={s}
                type="button"
                disabled={disabled}
                onClick={() => onPatch("container_size_hint", s)}
                className="flex-1 py-2.5 rounded-xl ios-subhead font-semibold transition active:scale-95"
                style={size === s
                  ? { background: "var(--foreground)", color: "var(--background)" }
                  : { color: "var(--muted-foreground)" }}
              >
                {s === "20ft" ? "20ft (~28 CBM)" : "40ft HQ (~68 CBM)"}
              </button>
            ))}
          </div>

          <Field label="TOTAL FREIGHT YOUR PARTNER PAID (USD)">
            <input
              type="number"
              inputMode="decimal"
              value={totalFreight}
              placeholder="e.g. 8000"
              disabled={disabled}
              onChange={(e) => setTotalFreight(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => {
                const n = totalFreight === "" ? null : Number(totalFreight);
                if (n !== (shipment.total_container_freight_usd ?? null)) onPatch("total_container_freight_usd", n);
              }}
              className={inputCls}
              style={disabled ? disabledSty : inputSty}
            />
          </Field>

          <div className="flex items-center justify-between px-1 ios-subhead" style={{ color: "var(--muted-foreground)" }}>
            <span>Your CBM (this shipment)</span>
            <span className="font-semibold text-foreground snm-num">{myCbm.toFixed(4)}</span>
          </div>

          {overCapacity && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
              style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 22%, transparent)" }}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--snm-warning)" }} />
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                Your shipment is {myCbm.toFixed(1)} CBM but a {size === "20ft" ? "20ft holds ~28" : "40ft HQ holds ~68"} CBM —
                your share would come out above 100% of the bill. Check the container size.
              </p>
            </div>
          )}

          {/* Silent-failure fixes: say exactly which input the estimate is
              waiting for instead of showing nothing (real confusion hit:
              freight typed, no container size picked → blank). */}
          {!size && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
              style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--muted-foreground)" }} />
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                Tap <strong>20ft</strong> or <strong>40ft HQ</strong> above — your share can&apos;t be calculated without the container size.
              </p>
            </div>
          )}
          {size && totalFreightNum == null && (
            <p className="ios-subhead px-1" style={{ color: "var(--muted-foreground)" }}>
              Enter the total freight your partner paid to see your estimated share.
            </p>
          )}
          {size && totalFreightNum != null && myCbm <= 0 && (
            <p className="ios-subhead px-1" style={{ color: "var(--snm-warning)" }}>
              Add products to this shipment first — your share is based on your goods&apos; CBM.
            </p>
          )}

          {estimate != null && !overCapacity && (
            <div className="rounded-xl px-3.5 py-3" style={{ background: "var(--glass-bg-2)" }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Your estimated share</p>
                  <p className="text-[17px] font-bold text-foreground snm-num">${estimate.toFixed(2)}</p>
                </div>
                <span className="flex items-center gap-1 ios-subhead font-semibold" style={{ color: "var(--snm-success)" }}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Applied
                </span>
              </div>
              <p className="ios-subhead mt-2" style={{ color: "var(--muted-foreground)" }}>
                Added to <strong>My Freight Share</strong> above and split across your products by CBM. You can overtype that box if you agree a different amount.
              </p>
            </div>
          )}
        </div>
      )}
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
  const [reopening, setReopening] = useState(false);
  const [role, setRole]           = useState<string | null>(null);
  const [showMore, setShowMore]   = useState(false);
  const [costsOpen, setCostsOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  type PriceChange = { skuPath: string; before: number; after: number; changePct: number };
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);

  // Warehouse is chosen at receiving (GRN), not at PO. Default to the default
  // godown; the confirm sheet lets the user change it.
  const [grnGodownId, setGrnGodownId]   = useState<string>("");

  type Panel = "confirmGrn" | "voidGrn" | "reopenGrn" | "deleteShipment" | "deleteLine" | "addLine" | null;
  const [panel, setPanel]               = useState<Panel>(null);
  const [editingLine, setEditingLine]   = useState<ShipmentLineRow | undefined>();
  const [pendingDeleteLine, setPendingDeleteLine] = useState<ShipmentLineRow | null>(null);

  // Rates from the last confirmed GRN — typo tripwire for the forex fields.
  const [lastRates, setLastRates] = useState<{ rate_usd_to_mvr: number | null; rate_usd_to_idr: number | null } | null>(null);

  /* ── Data loading ──────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, ls, sk, sup, gd, lr] = await Promise.all([
        getShipment(id), listShipmentLines(id), listSkusFlat(), listSuppliers(), listGodowns(),
        getLastConfirmedRates(id).catch(() => null),
      ]);
      setShipment(s);
      setLines(ls);
      setSkus(sk);
      setSuppliers(sup);
      setGodowns(gd);
      setLastRates(lr);
      // Default the receiving warehouse to any line's existing destination, else
      // the default godown — chosen/changed in the GRN confirm sheet.
      setGrnGodownId((prev) =>
        prev || ls.find((l) => l.destination_godown_id)?.destination_godown_id
              || gd.find((g) => g.is_default)?.id || gd[0]?.id || "");
      // Auto-expand costs when in transit or later
      if (s && ["in_transit", "arrived", "grn_confirmed"].includes(s.status)) setCostsOpen(true);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);

  const isAdmin  = role === "admin" || role === "manager";
  const canWrite = role !== "viewer" && role !== null;
  const locked   = shipment?.status === "grn_confirmed" || !canWrite;
  const arrived  = shipment?.status === "arrived";

  // Forex typo tripwire — warn (never block) when an entered rate is wildly
  // off: vs the last confirmed shipment when one exists, else vs broad
  // plausibility bands. Catches e.g. the IDR figure typed into the MVR box,
  // which would otherwise lock a 1000x landed-cost error at GRN.
  const rateWarning = useMemo(() => {
    if (!shipment || locked) return null;
    const msgs: string[] = [];
    const check = (label: string, v: number | null, prev: number | null | undefined, lo: number, hi: number) => {
      if (v == null || v <= 0) return;
      if (prev != null && prev > 0) {
        if (Math.abs(v - prev) / prev > 0.2) {
          msgs.push(`${label} is ${v} but your last shipment used ${prev} — double-check before confirming.`);
        }
      } else if (v < lo || v > hi) {
        msgs.push(`${label} of ${v} looks unusual — double-check before confirming.`);
      }
    };
    check("1 USD = MVR", shipment.rate_usd_to_mvr, lastRates?.rate_usd_to_mvr, 10, 25);
    check("1 USD = IDR", shipment.rate_usd_to_idr, lastRates?.rate_usd_to_idr, 8000, 25000);
    return msgs.length ? msgs.join(" ") : null;
  }, [shipment, lastRates, locked]);

  /* ── Live landed-cost preview ──────────────────────────────────────────── */

  const preview = useMemo(() => {
    if (!shipment) return null;
    const idr = shipment.rate_idr_to_mvr ?? 0;
    const usd = shipment.rate_usd_to_mvr ?? 0;
    if (lines.length === 0) return null;

    const totalCbm = lines.reduce((acc, l) => acc + l.qty_cartons * l.cbm_per_carton, 0);
    if (totalCbm <= 0) return null;

    const freightMvr = (shipment.my_freight_share_usd ?? 0) * (usd || 0);
    // Duty is apportioned separately from the other local costs — by each
    // line's rate-weighted FOB value, not CBM share (mirrors confirm_grn()
    // in migration 0064: a 200%-duty Tobacco carton must absorb far more of
    // the real duty bill than a same-volume 0%-duty carton, not an equal
    // CBM slice of it).
    const dutyMvr = shipment.customs_duty_mvr ?? 0;
    const otherLocalMvr =
      (shipment.mpl_charges_mvr ?? 0) + (shipment.agent_fee_mvr ?? 0) +
      (shipment.last_mile_mvr ?? 0) + (shipment.insurance_mvr ?? 0) + (shipment.other_mvr ?? 0);
    const localMvr = dutyMvr + otherLocalMvr; // shown to the user as one "Port & clearing" figure
    const poolMvr = freightMvr + otherLocalMvr;

    const ratesSet = idr > 0 && usd > 0;

    const rawLines = lines.map((l) => {
      const sku = skus.find((s) => s.id === l.sku_id);
      const fxToMvr = l.fob_currency === "IDR" ? idr : l.fob_currency === "USD" ? usd : 1;
      const fobMvr = ratesSet ? l.qty_cartons * l.fob_per_carton * fxToMvr : 0;
      const dutyRatePct = sku?.duty_rate_pct ?? 0;
      return { l, sku, fxToMvr, fobMvr, dutyWeight: fobMvr * dutyRatePct };
    });
    const totalDutyWeight = rawLines.reduce((acc, r) => acc + r.dutyWeight, 0);

    const linesPreview = rawLines.map(({ l, sku, fobMvr, dutyWeight }) => {
      const cbmShare = totalCbm > 0 ? (l.qty_cartons * l.cbm_per_carton) / totalCbm : 0;
      const apportionedOther = cbmShare * poolMvr;
      const apportionedDuty  = totalDutyWeight > 0 ? (dutyWeight / totalDutyWeight) * dutyMvr : cbmShare * dutyMvr;
      const apportioned = apportionedOther + apportionedDuty;
      const lineTotal   = fobMvr + apportioned;
      const perCarton   = l.qty_cartons > 0 ? lineTotal / l.qty_cartons : 0;
      const perPack     = sku && sku.packs_per_carton > 0 ? perCarton / sku.packs_per_carton : 0;
      const perPiece    = sku && sku.pcs_per_pack > 0 ? perPack / sku.pcs_per_pack : 0;
      return { line: l, sku, fobMvr, apportioned, apportionedDuty, lineTotal, perCarton, perPack, perPiece, ratesSet };
    });

    const grandTotal = linesPreview.reduce((acc, p) => acc + p.lineTotal, 0);
    return { totalCbm, freightMvr, localMvr, poolMvr, lines: linesPreview, grandTotal, ratesSet };
  }, [shipment, lines, skus]);

  // Suggested customs duty total — sum of each line's FOB × its category's
  // duty rate. Shown as a tappable "Use suggested" affordance next to the
  // manual Customs duty field; the field itself stays the source of truth
  // (Ali can always type what customs actually charged instead).
  const suggestedDutyMvr = useMemo(() => {
    if (!shipment) return null;
    const idr = shipment.rate_idr_to_mvr ?? 0;
    const usd = shipment.rate_usd_to_mvr ?? 0;
    if (!(idr > 0 && usd > 0) || lines.length === 0) return null;
    const total = lines.reduce((acc, l) => {
      const sku = skus.find((s) => s.id === l.sku_id);
      const dutyRatePct = sku?.duty_rate_pct ?? 0;
      if (dutyRatePct <= 0) return acc;
      const fxToMvr = l.fob_currency === "IDR" ? idr : l.fob_currency === "USD" ? usd : 1;
      const fobMvr = l.qty_cartons * l.fob_per_carton * fxToMvr;
      return acc + fobMvr * (dutyRatePct / 100);
    }, 0);
    return total > 0 ? total : null;
  }, [shipment, lines, skus]);

  /* ── Field patch ───────────────────────────────────────────────────────── */

  async function patch(field: string, value: number | string | boolean | null) {
    if (!shipment || locked) return;
    setSaveState("saving");
    try {
      const updated = await updateShipment(shipment.id, { [field]: value } as Parameters<typeof updateShipment>[1]);
      // Use the row Postgres returns (not the optimistic value) so any
      // server-derived columns -- e.g. rate_idr_to_mvr, computed by the
      // derive_idr_to_mvr trigger -- reflect the real stored value.
      setShipment(updated);
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
    // Warehouse is required at receiving (unless every line already has one).
    const needsGodown = lines.some((l) => !l.destination_godown_id);
    if (needsGodown && !grnGodownId) {
      toast.error("Choose the destination warehouse first");
      return;
    }
    setConfirming(true);
    try {
      const beforePrices = new Map(
        skus.filter((s) => lines.some((l) => l.sku_id === s.id))
          .map((s) => [s.id, s.selling_price_per_piece_mvr]),
      );
      await confirmGrn(shipment.id, grnGodownId || null);
      setPanel(null);
      await load();
      // Close the costing loop: tell the office stock landed, and whether
      // any selling prices drifted below target at the new landed costs.
      getPricingHealth()
        .then((rows) => {
          const drifted = rows.filter((r) => r.status === "below_target").length;
          notifyAdmins({
            title: "Shipment received",
            body: `GRN confirmed for ${shipment.reference}. ${drifted > 0
              ? `${drifted} price${drifted === 1 ? "" : "s"} now below target — see Margin Watch.`
              : "All margins still on target."}`,
            url: drifted > 0 ? "/financials" : "/shipments",
          }, "stock");
        })
        .catch(() => {/* notification is non-critical */});
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
      haptic("success");
      if (changes.length > 0)
        toast.warning(`${changes.length} SKU${changes.length > 1 ? "s" : ""} had a price change — review below`);
      else
        toast.success("GRN confirmed — stock is now live");
    } catch (e) { haptic("error"); toast.error((e as Error).message); }
    finally { setConfirming(false); }
  }

  /* ── Validate GRN ──────────────────────────────────────────────────────── */

  const grnBlockReason = useMemo(() => {
    if (!shipment) return "No shipment";
    if (lines.length === 0) return "Add at least one product first";
    if (!shipment.rate_usd_to_mvr || shipment.rate_usd_to_mvr <= 0) return "Enter the exchange rate first (Costs section)";
    if (!shipment.rate_idr_to_mvr || shipment.rate_idr_to_mvr <= 0) return "Enter the exchange rate first (Costs section)";
    if (lines.some((l) => l.cbm_per_carton <= 0)) return "A product has no carton size — fix it in Products";
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
        <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Purchase order not found.</p>
        <Link href="/shipments" className="ios-subhead mt-3 block" style={{ color: "var(--foreground)" }}>← Back</Link>
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
        style={{ background: "var(--background)", borderBottom: "0.5px solid var(--glass-border-lo)" }}
      >
        <Link
          href="/shipments"
          className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition active:scale-95"
          style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>Purchase Order</p>
          <h1 className="text-[17px] font-semibold text-foreground leading-tight truncate snm-num">{shipment.reference}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Auto-save indicator */}
          {!locked && saveState === "saving" && (
            <span className="inline-flex items-center gap-1.5 ios-subhead font-medium"
              style={{ color: "var(--muted-foreground)" }}>
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          )}
          {!locked && saveState === "saved" && (
            <span className="inline-flex items-center gap-1.5 ios-subhead font-semibold"
              style={{ color: "var(--snm-success)" }}>
              <CheckCircle2 className="h-3 w-3" /> Saved
            </span>
          )}
          {locked && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider px-3 py-1 rounded-full"
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
          <p className="ios-subhead font-medium flex-1 text-left" style={{ color: "var(--snm-warning)" }}>
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
            ? <p className="ios-subhead font-semibold text-foreground">{shipment.reference}</p>
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
            ? <p className="ios-subhead text-foreground">{suppliers.find((s) => s.id === shipment.supplier_id)?.name ?? "—"}</p>
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
            <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>STATUS</p>

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
                      <p className="text-[12px] font-semibold uppercase tracking-wider whitespace-nowrap"
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
                      className="flex items-center gap-1.5 h-11 px-4 rounded-xl ios-subhead font-medium transition active:scale-95"
                      style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)", color: "var(--muted-foreground)" }}
                    >
                      ← {prevStep.label}
                    </button>
                  )}
                  {nextStep && (
                    <button
                      onClick={() => patchStatus(nextStep.value)}
                      className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl ios-subhead font-semibold transition active:scale-95"
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
              <p className="ios-subhead font-semibold" style={{ color: "var(--snm-success)" }}>
                Received — {fmtDate(shipment.grn_confirmed_at)}
              </p>
            </div>
          </Field>
        )}

        {/* Supplier PO # + ETA — 2 col */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="SUPPLIER PO #">
            {locked
              ? <p className="ios-subhead text-foreground">{shipment.supplier_po_number ?? "—"}</p>
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
              ? <p className="ios-subhead text-foreground">{fmtDate(shipment.expected_arrival_date) || "—"}</p>
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
            className="w-full rounded-xl px-4 py-3 ios-subhead text-foreground outline-none resize-none placeholder:text-muted-foreground"
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
                className="flex items-center gap-1.5 h-8 px-3 rounded-full ios-subhead font-bold transition active:scale-95"
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
            className="w-full h-14 rounded-xl flex items-center justify-center gap-2 ios-subhead transition active:scale-95"
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
              const estPack  = livePer?.perPack ?? null;
              const ratesSet = preview?.ratesSet ?? false;
              const actualQty = l.qty_cartons_actual ?? l.qty_cartons;
              const isShort  = l.qty_cartons_actual != null && l.qty_cartons_actual < l.qty_cartons;

              return (
                <div key={l.id} className="rounded-xl overflow-hidden" style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
                  {/* Top: SKU name + actions */}
                  <div className="flex items-start justify-between gap-2 p-4 pb-3">
                    <div className="min-w-0 flex-1">
                      <p className="ios-subhead font-semibold text-foreground leading-tight">
                        {sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "Unknown SKU"}
                      </p>
                      <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                        {sku ? `${sku.pcs_per_pack}/pk × ${sku.packs_per_carton}/ctn` : ""}
                        {godown ? ` · → ${godown.name}` : ""}
                      </p>
                    </div>
                    {!locked && (
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => { setEditingLine(l); setPanel("addLine"); }}
                          className="h-8 px-2 rounded-lg ios-subhead font-medium transition"
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

                  {/* FOB + est. landed cost — these are figures the user must
                      verify correctly before GRN locks them permanently, so
                      the numbers themselves are sized above the label. */}
                  <div className="flex items-center justify-between px-4 pb-3 gap-4">
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                      FOB <span className="font-semibold snm-num" style={{ color: "var(--foreground)", fontSize: 14 }}>
                        {l.fob_per_carton.toLocaleString()} {l.fob_currency}/ctn
                      </span>
                    </p>
                    {estPiece != null && estPiece > 0 ? (
                      <div className="text-right">
                        <p className="font-semibold snm-num" style={{ color: ratesSet ? "var(--snm-success)" : "var(--snm-warning)", fontSize: 14 }}>
                          {ratesSet ? "" : "~"}Est MVR {fmt2(estPiece)}/pc
                        </p>
                        {estPack != null && estPack > 0 && sku && sku.pcs_per_pack > 1 && (
                          <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 13 }}>
                            {fmt2(estPack)}/pack
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Est. cost TBD</p>
                    )}
                  </div>

                  {/* Ordered qty */}
                  <div className="px-4 pb-3">
                    <p className="text-[12px] mb-1.5 font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
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
                      <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>cartons</p>
                    </div>
                  </div>

                  {/* Actual received qty — only when arrived or grn_confirmed */}
                  {(arrived || locked) && (
                    <div className="px-4 pb-4" style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingTop: 12, marginTop: 4 }}>
                      <p className="text-[12px] mb-1.5 font-semibold uppercase tracking-wider flex items-center gap-1"
                        style={{ color: isShort ? "var(--snm-warning)" : "var(--muted-foreground)" }}>
                        Actually Received
                        {isShort && (
                          <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                            <AlertTriangle className="h-3 w-3" /> Short shipment
                          </span>
                        )}
                      </p>
                      {locked
                        ? <p className="ios-subhead font-semibold" style={{ color: isShort ? "var(--snm-warning)" : "var(--foreground)" }}>
                            {actualQty} cartons{l.qty_loose_packs > 0 ? ` + ${l.qty_loose_packs} pk` : ""} {isShort ? `(${l.qty_cartons - actualQty} short)` : ""}
                          </p>
                        : <div className="space-y-2.5">
                            <div className="flex items-center gap-3">
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
                              <p className="ios-subhead w-16 shrink-0" style={{ color: "var(--muted-foreground)" }}>cartons</p>
                            </div>
                            {/* Loose packs — rare; only the odd partial carton */}
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <QtyStepper
                                  value={l.qty_loose_packs ?? 0}
                                  min={0}
                                  max={sku ? sku.packs_per_carton - 1 : undefined}
                                  disabled={locked}
                                  onChange={async (v) => {
                                    await updateShipmentLine(l.id, { qty_loose_packs: v } as Parameters<typeof updateShipmentLine>[1]);
                                    load();
                                  }}
                                />
                              </div>
                              <p className="ios-subhead w-16 shrink-0" style={{ color: "var(--muted-foreground)" }}>+ loose pk</p>
                            </div>
                          </div>
                      }
                    </div>
                  )}

                  {/* Locked: landed cost breakdown */}
                  {locked && (
                    <div className="px-4 pb-4 space-y-2" style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingTop: 12, marginTop: 0 }}>
                      {/* Row 1: Total + per-carton (bulk view) */}
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: "Total landed",  value: l.landed_total_mvr     != null ? `MVR ${fmt0(Number(l.landed_total_mvr))}` : "—" },
                          { label: "Per carton",    value: l.landed_per_carton_mvr != null ? `MVR ${fmt0(Number(l.landed_per_carton_mvr))}` : "—" },
                        ].map((c) => (
                          <div key={c.label} className="rounded-lg p-2 text-center" style={{ background: "var(--glass-bg-2)" }}>
                            <p className="text-[12px] uppercase tracking-wider mb-1" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
                            <p className="ios-subhead font-semibold text-foreground snm-num">{c.value}</p>
                          </div>
                        ))}
                      </div>
                      {/* Row 2: Per pack (trade unit, primary) + /pc (secondary, for competitor comparison) */}
                      <div className="rounded-lg p-3 flex items-center justify-between"
                        style={{ background: "color-mix(in srgb, var(--snm-success) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
                        <div>
                          <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>Cost per pack</p>
                          <p className="text-[18px] font-bold snm-num" style={{ color: "var(--snm-success)" }}>
                            {l.landed_per_pack_mvr != null ? `MVR ${fmt2(Number(l.landed_per_pack_mvr))}` : "—"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>/pc · for comparison</p>
                          <p className="ios-subhead font-semibold text-foreground snm-num">
                            {l.landed_per_piece_mvr != null ? `MVR ${fmt2(Number(l.landed_per_piece_mvr))}` : "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Dashed "add more" button below lines */}
            {!locked && (
              <button
                onClick={() => { setEditingLine(undefined); setPanel("addLine"); }}
                className="w-full h-12 rounded-xl flex items-center justify-center gap-2 ios-subhead transition active:scale-95"
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
        {/* Collapsible header — plain language, no "Forex" jargon */}
        <button
          onClick={() => setCostsOpen(!costsOpen)}
          className="w-full flex items-center justify-between p-5 transition"
        >
          <div>
            <p className="label-caps text-[12px] text-left mb-0.5" style={{ color: "var(--muted-foreground)" }}>WHAT THIS SHIPMENT COST</p>
            {!costsOpen && preview && preview.ratesSet && (
              <p className="snm-num" style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
                Total landed cost: MVR {fmt0(preview.grandTotal)}
              </p>
            )}
            {!costsOpen && (!preview || !preview.ratesSet) && (
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Tap to enter shipping &amp; port costs</p>
            )}
          </div>
          <ChevronDown
            className="h-4 w-4 shrink-0 transition-transform"
            style={{ color: "var(--muted-foreground)", transform: costsOpen ? "rotate(180deg)" : "none" }}
          />
        </button>

        {costsOpen && (
          <div className="px-5 pb-5 space-y-5" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>

            {/* Locked-state banner — explains WHY nothing responds when confirmed
                (the exact confusion Ali hit: tapping fields did nothing). */}
            {locked && shipment.status === "grn_confirmed" && (
              <div className="mt-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl"
                style={{ background: "color-mix(in srgb, var(--snm-success) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
                <Lock className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--snm-success)" }} />
                <div className="flex-1">
                  <p className="ios-subhead font-semibold text-foreground">These costs are locked in</p>
                  <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    This shipment is received, so its costs can&apos;t change — that keeps your profit figures honest.
                    {isAdmin ? " To fix a mistake, use “Reopen to Edit” in the ⋯ menu." : " Ask an admin to reopen it if something needs fixing."}
                  </p>
                </div>
              </div>
            )}

            {/* Intro — plain-English "what you're filling in and why" */}
            {!locked && (
              <p className="ios-subhead mt-5" style={{ color: "var(--muted-foreground)" }}>
                Fill in the exchange rate, your shipping cost, and any port/clearing charges. The app spreads them across your products by size (CBM) to work out what each one truly cost you.
              </p>
            )}

            {/* ── Step 1: Exchange rate ── */}
            <div className={locked ? "" : "pt-1"}>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="ios-subhead font-bold" style={{ color: "var(--snm-brand-text)" }}>1</span>
                <p className="ios-subhead font-semibold text-foreground">Exchange rate</p>
              </div>
              <p className="ios-subhead mb-3" style={{ color: "var(--muted-foreground)" }}>
                What your bank charged to convert money. Locked once you confirm.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <Field label="1 USD = ___ MVR *">
                  <NumInput
                    value={shipment.rate_usd_to_mvr}
                    disabled={locked}
                    min={0}
                    placeholder="e.g. 15.42"
                    onChange={async (v) => {
                      // rate_idr_to_mvr (the rate landed-cost math actually uses) is
                      // derived in Postgres by the derive_idr_to_mvr trigger from
                      // rate_usd_to_mvr / rate_usd_to_idr -- never computed here.
                      await patch("rate_usd_to_mvr", v);
                    }}
                  />
                </Field>
                <Field label="1 USD = ___ IDR *">
                  <NumInput
                    value={shipment.rate_usd_to_idr}
                    disabled={locked}
                    min={0}
                    placeholder="e.g. 15820"
                    onChange={async (usdToIdr) => {
                      // rate_idr_to_mvr is derived in Postgres by the
                      // derive_idr_to_mvr trigger -- never computed here.
                      await patch("rate_usd_to_idr", usdToIdr);
                    }}
                  />
                </Field>
              </div>
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                1 IDR = MVR {shipment.rate_idr_to_mvr != null ? shipment.rate_idr_to_mvr.toFixed(6) : "—"} <span style={{ opacity: 0.7 }}>(worked out for you)</span>
              </p>
              {rateWarning && (
                <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 22%, transparent)" }}>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--snm-warning)" }} />
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{rateWarning}</p>
                </div>
              )}
            </div>

            {/* ── Step 2: Shipping (freight) ── */}
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="ios-subhead font-bold" style={{ color: "var(--snm-brand-text)" }}>2</span>
                <p className="ios-subhead font-semibold text-foreground">Shipping cost</p>
              </div>
              <p className="ios-subhead mb-3" style={{ color: "var(--muted-foreground)" }}>
                What you paid to ship your goods (in USD). Sharing a container? Use the estimator below.
              </p>
              <Field label="MY SHIPPING COST (USD)">
                <NumInput value={shipment.my_freight_share_usd} disabled={locked} min={0} placeholder="0" onChange={(v) => patch("my_freight_share_usd", v ?? 0)} />
              </Field>
              {preview && (shipment.my_freight_share_usd ?? 0) > 0 && (
                <p className="ios-subhead mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                  = MVR <span className="font-semibold text-foreground">{fmt0(preview.freightMvr)}</span> in your money
                </p>
              )}
              <SharedContainerEstimator
                shipment={shipment}
                myCbm={preview?.totalCbm ?? lines.reduce((acc, l) => acc + l.qty_cartons * l.cbm_per_carton, 0)}
                disabled={locked}
                onApply={(v) => patch("my_freight_share_usd", v)}
                onPatch={(field, value) => patch(field, value)}
              />
            </div>

            {/* ── Step 3: Port & clearing costs ── */}
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="ios-subhead font-bold" style={{ color: "var(--snm-brand-text)" }}>3</span>
                <p className="ios-subhead font-semibold text-foreground">Port &amp; clearing costs <span className="font-normal" style={{ color: "var(--muted-foreground)" }}>(in MVR)</span></p>
              </div>
              <p className="ios-subhead mb-3" style={{ color: "var(--muted-foreground)" }}>
                Charges you paid here in the Maldives. Leave any at 0 if they don&apos;t apply.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Customs duty</p>
                  <NumInput
                    value={shipment.customs_duty_mvr}
                    disabled={locked}
                    compact
                    min={0}
                    placeholder="0"
                    onChange={(v) => patch("customs_duty_mvr", v ?? 0)}
                  />
                  {/* Suggested from each product's category duty rate (e.g.
                      Tobacco = 200%) — a starting point, not a silent
                      override. Ali still enters what customs actually
                      charged; this just saves the arithmetic. */}
                  {!locked && suggestedDutyMvr != null && Math.round(suggestedDutyMvr) !== Math.round(shipment.customs_duty_mvr ?? 0) && (
                    <button
                      type="button"
                      onClick={() => patch("customs_duty_mvr", Math.round(suggestedDutyMvr))}
                      className="ios-footnote font-medium active:opacity-70"
                      style={{ color: "var(--snm-brand-text)" }}
                    >
                      Use suggested MVR {fmt0(suggestedDutyMvr)}
                    </button>
                  )}
                </div>
                {[
                  { label: "Port (MPL)",    field: "mpl_charges_mvr"  },
                  { label: "Clearing agent", field: "agent_fee_mvr"   },
                  { label: "Delivery to godown", field: "last_mile_mvr" },
                  { label: "Insurance",     field: "insurance_mvr"    },
                  { label: "Anything else", field: "other_mvr"        },
                ].map(({ label, field }) => (
                  <div key={field} className="space-y-1">
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{label}</p>
                    <NumInput
                      value={(shipment as unknown as Record<string, number>)[field]}
                      disabled={locked}
                      compact
                      min={0}
                      placeholder="0"
                      onChange={(v) => patch(field, v ?? 0)}
                    />
                  </div>
                ))}
              </div>
              {/* Explain WHY the suggestion may differ per product — visible
                  whenever any line's category actually carries a duty rate. */}
              {lines.some((l) => (skus.find((s) => s.id === l.sku_id)?.duty_rate_pct ?? 0) > 0) && (
                <p className="ios-footnote mt-2" style={{ color: "var(--muted-foreground)" }}>
                  Some products here have a category duty rate (e.g. Tobacco). Their share of the customs duty above is calculated from their value and rate, not just their carton volume — set duty rates per category under Products.
                </p>
              )}
            </div>

            {/* Plain-language cost summary — no FOB/Freight/Local jargon */}
            {preview && (
              <div className="rounded-xl px-4 py-3.5 space-y-1.5" style={{ background: "var(--glass-bg-2)" }}>
                {[
                  { label: "Goods (supplier price)", value: preview.ratesSet ? `MVR ${fmt0(preview.lines.reduce((a, l) => a + l.fobMvr, 0))}` : "—" },
                  { label: "+ Shipping", value: `MVR ${fmt0(preview.freightMvr)}` },
                  { label: "+ Port & clearing", value: `MVR ${fmt0(preview.localMvr)}` },
                ].map((r) => (
                  <div key={r.label} className="flex items-center justify-between">
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{r.label}</p>
                    <p className="ios-subhead font-medium text-foreground snm-num">{r.value}</p>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                  <p className="ios-subhead font-bold text-foreground">Total landed cost</p>
                  <p className="text-[15px] font-bold text-foreground snm-num">{preview.ratesSet ? `MVR ${fmt0(preview.grandTotal)}` : "enter rate first"}</p>
                </div>
                {preview.ratesSet && (
                  <p className="ios-subhead pt-1" style={{ color: "var(--muted-foreground)" }}>
                    This is what your goods really cost, landed in your godown — split across each product by size. See per-product cost on each line above.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Post-GRN: price change alerts ── */}
      {locked && priceChanges.length > 0 && (
        <div className="rounded-2xl p-5 mb-4" style={{ ...CARD, border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" }}>
          <p className="ios-subhead font-bold mb-3 flex items-center gap-1.5" style={{ color: "var(--snm-warning)" }}>
            <AlertTriangle className="h-3.5 w-3.5" />
            {priceChanges.length} SKU{priceChanges.length > 1 ? "s" : ""} had a selling price change
          </p>
          <div className="space-y-2">
            {priceChanges.map((c) => (
              <div key={c.skuPath} className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: "var(--glass-bg-1)" }}>
                <p className="ios-subhead flex-1 truncate text-foreground">{c.skuPath}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="snm-num ios-subhead" style={{ color: "var(--muted-foreground)" }}>MVR {c.before.toFixed(2)}</span>
                  <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>→</span>
                  <span className="snm-num text-[14px] font-bold" style={{ color: c.changePct > 0 ? "var(--snm-warning)" : "var(--snm-success)" }}>
                    MVR {c.after.toFixed(2)}
                  </span>
                  <span className="snm-num ios-subhead font-semibold" style={{ color: c.changePct > 0 ? "var(--snm-warning)" : "var(--snm-success)" }}>
                    {c.changePct > 0 ? "+" : ""}{c.changePct.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="ios-subhead mt-3" style={{ color: "var(--muted-foreground)" }}>
            Prices are live now. Go to Products → Edit SKU to lock a fixed price.
          </p>
          <button onClick={() => setPriceChanges([])} className="mt-2 ios-subhead underline" style={{ background: "none", border: "none", color: "var(--muted-foreground)", cursor: "pointer" }}>
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
          paddingBottom: "calc(64px + env(safe-area-inset-bottom, 8px))",
          background: "color-mix(in srgb, var(--background) 92%, transparent)",
          borderTop: "0.5px solid var(--glass-border-lo)",
          backdropFilter: "var(--glass-blur)",
          WebkitBackdropFilter: "var(--glass-blur)",
        }}
      >
        {locked ? (
          /* State C — confirmed */
          <div className="flex items-center gap-3 h-14 rounded-xl px-4"
            style={{ background: "color-mix(in srgb, var(--snm-success) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
            <Truck className="h-5 w-5 shrink-0" style={{ color: "var(--snm-success)" }} />
            <div>
              <p className="ios-subhead font-semibold" style={{ color: "var(--snm-success)" }}>Stock Live</p>
              {shipment.grn_confirmed_at && (
                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
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
              color: grnBlockReason ? "var(--muted-foreground)" : "var(--snm-on-fill)",
            }}
          >
            {grnBlockReason
              ? <><AlertTriangle className="h-4 w-4" /> {grnBlockReason}</>
              : <><CheckCircle2 className="h-4 w-4" /> Confirm Receipt — Add to Stock</>}
          </button>
        ) : (
          /* State A — in progress */
          <div className="flex items-center justify-between gap-3 h-14">
            {preview && preview.ratesSet ? (
              <div>
                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Est. landed total</p>
                <p className="text-[17px] font-semibold text-foreground">MVR {fmt0(preview.grandTotal)}</p>
              </div>
            ) : (
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Enter costs to see estimate</p>
            )}
            <div className="flex items-center gap-1.5 ios-subhead" style={{ color: "var(--muted-foreground)" }}>
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
              onClick={() => { setShowMore(false); setPanel("reopenGrn"); }}
              className="w-full flex items-center gap-3 h-12 px-4 rounded-xl text-sm font-medium transition"
              style={{ background: "color-mix(in srgb, var(--snm-warning) 8%, transparent)", color: "var(--snm-warning)" }}
            >
              <Pencil className="h-4 w-4" /> Reopen to Edit
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
            className="w-full h-12 px-4 rounded-xl ios-subhead font-medium"
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
                <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{r.label}</span>
                <span className="ios-subhead" style={{ color: "var(--foreground)", fontWeight: r.bold ? 700 : 500 }}>{r.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Short shipment warning */}
        {lines.some((l) => l.qty_cartons_actual != null && l.qty_cartons_actual < l.qty_cartons) && (
          <div className="rounded-xl p-4 mb-4" style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" }}>
            <p className="ios-subhead font-semibold mb-2 flex items-center gap-1.5" style={{ color: "var(--snm-warning)" }}>
              <AlertTriangle className="h-3.5 w-3.5" /> Short shipment on some lines
            </p>
            {lines.filter((l) => l.qty_cartons_actual != null && l.qty_cartons_actual < l.qty_cartons).map((l) => {
              const sku = skus.find((s) => s.id === l.sku_id);
              return (
                <p key={l.id} className="snm-num ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                  • {sku?.model_name ?? "SKU"}: {l.qty_cartons} ordered, {l.qty_cartons_actual} received
                </p>
              );
            })}
          </div>
        )}

        {/* Destination warehouse — pre-filled to the default godown; this is a
            receiving bay, not a final decision. If stock needs to end up
            somewhere else, that's a Stock Transfer afterward, not a choice you
            have to get right here. */}
        <div className="mb-4">
          <p className="label-caps text-[12px] mb-2" style={{ color: "var(--muted-foreground)" }}>RECEIVING WAREHOUSE</p>
          <div className="relative">
            <select
              value={grnGodownId}
              onChange={(e) => setGrnGodownId(e.target.value)}
              className="w-full h-12 rounded-xl px-4 pr-10 ios-subhead text-foreground outline-none appearance-none"
              style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}
            >
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}{g.is_default ? " (default)" : ""}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
          </div>
          <p className="ios-subhead mt-1.5" style={{ color: "var(--muted-foreground)" }}>
            Not sure yet? Leave this as-is — you can move stock to another godown anytime from Stock Ops → Transfer.
          </p>
        </div>

        <p className="ios-subhead mb-5" style={{ color: "var(--muted-foreground)" }}>
          Forex rates and costs will be <strong style={{ color: "var(--foreground)" }}>permanently locked</strong>. Stock becomes available for sale immediately.
        </p>

        <div className="flex gap-3">
          <button onClick={() => setPanel(null)} className="flex-1 h-12 rounded-xl ios-subhead font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>
            Cancel
          </button>
          <button onClick={handleConfirmGrn} disabled={confirming}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "var(--snm-success)", color: "var(--snm-on-fill)" }}>
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & Lock →"}
          </button>
        </div>
      </Sheet>

      {/* Void GRN */}
      <Sheet open={panel === "reopenGrn"} onClose={() => setPanel(null)}>
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", color: "var(--snm-warning)" }}>
            <Pencil className="h-5 w-5" />
          </div>
          <h2 className="text-[20px] font-semibold" style={{ color: "var(--snm-warning)" }}>Reopen this GRN?</h2>
        </div>
        <p className="ios-subhead mb-2" style={{ color: "var(--muted-foreground)" }}>
          <strong style={{ color: "var(--foreground)" }}>{shipment.reference}</strong> will unlock for editing — you can fix the FOB price, forex rate, freight/customs, or add a missed line, then confirm receipt again.
        </p>
        <p className="ios-subhead rounded-xl px-3 py-2 mb-5" style={{ background: "color-mix(in srgb, var(--snm-warning) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 12%, transparent)", color: "var(--muted-foreground)" }}>
          Sales history is untouched. If any stock from this shipment has already been sold, reopening is blocked — you&apos;d need a stock adjustment instead.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setPanel(null)} className="flex-1 h-12 rounded-xl ios-subhead font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button
            onClick={async () => {
              setReopening(true);
              try {
                await reopenGrn(shipment.id);
                haptic("warning");
                toast.success("GRN reopened — edit and confirm again");
                setPanel(null);
                await load();
              }
              catch (e) { haptic("error"); toast.error((e as Error).message); }
              finally { setReopening(false); }
            }}
            disabled={reopening}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center"
            style={{ background: "var(--snm-warning)", color: "var(--snm-on-fill)" }}>
            {reopening ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reopen to Edit"}
          </button>
        </div>
      </Sheet>

      <Sheet open={panel === "voidGrn"} onClose={() => setPanel(null)}>
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h2 className="text-[20px] font-semibold" style={{ color: "var(--snm-error)" }}>Void GRN?</h2>
        </div>
        <p className="ios-subhead mb-2" style={{ color: "var(--muted-foreground)" }}>
          <strong style={{ color: "var(--foreground)" }}>{shipment.reference}</strong> — all inventory batches, stock movements, and linked sales orders will be permanently deleted.
        </p>
        <p className="ios-subhead rounded-xl px-3 py-2 mb-5" style={{ background: "color-mix(in srgb, var(--snm-error) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--muted-foreground)" }}>
          ⚠ If stock from this shipment has already been sold, those sales orders will also be deleted.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setPanel(null)} className="flex-1 h-12 rounded-xl ios-subhead font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button
            onClick={async () => {
              setVoiding(true);
              try { await forceVoidGrn(shipment.id); haptic("warning"); toast.success("Shipment voided"); router.push("/shipments"); }
              catch (e) { haptic("error"); toast.error((e as Error).message); }
              finally { setVoiding(false); }
            }}
            disabled={voiding}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center"
            style={{ background: "var(--snm-error)", color: "var(--snm-on-fill)" }}>
            {voiding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Void & Delete"}
          </button>
        </div>
      </Sheet>

      {/* Delete shipment */}
      <Sheet open={panel === "deleteShipment"} onClose={() => setPanel(null)}>
        <h2 className="text-[20px] font-semibold mb-2" style={{ color: "var(--snm-error)" }}>Delete Purchase Order?</h2>
        <p className="ios-subhead mb-5" style={{ color: "var(--muted-foreground)" }}>
          <strong style={{ color: "var(--foreground)" }}>{shipment.reference}</strong> and all its lines will be permanently removed.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setPanel(null)} className="flex-1 h-12 rounded-xl ios-subhead font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button
            onClick={async () => {
              try { await deleteShipment(shipment.id); haptic("warning"); toast.success("Deleted"); router.push("/shipments"); }
              catch (e) { haptic("error"); toast.error((e as Error).message); }
            }}
            className="flex-[2] h-12 rounded-xl ios-subhead font-bold"
            style={{ background: "var(--snm-error)", color: "var(--snm-on-fill)" }}>
            Delete
          </button>
        </div>
      </Sheet>

      {/* Delete line */}
      <Sheet open={panel === "deleteLine"} onClose={() => { setPendingDeleteLine(null); setPanel(null); }}>
        <h2 className="text-[20px] font-semibold mb-2" style={{ color: "var(--snm-error)" }}>Remove product?</h2>
        <p className="ios-subhead mb-5" style={{ color: "var(--muted-foreground)" }}>
          {pendingDeleteLine && (() => {
            const sku = skus.find((s) => s.id === pendingDeleteLine.sku_id);
            return sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "This line";
          })()} will be removed from the PO.
        </p>
        <div className="flex gap-3">
          <button onClick={() => { setPendingDeleteLine(null); setPanel(null); }} className="flex-1 h-12 rounded-xl ios-subhead font-semibold"
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
            className="flex-[2] h-12 rounded-xl ios-subhead font-bold"
            style={{ background: "var(--snm-error)", color: "var(--snm-on-fill)" }}>
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
          onClose={() => { setEditingLine(undefined); setPanel(null); }}
          onSaved={() => { setEditingLine(undefined); setPanel(null); load(); }}
        />
      )}
    </div>
  );
}

/* ── Line dialog ─────────────────────────────────────────────────────────── */

function LineDialog({
  editing, shipmentId, skus, onClose, onSaved,
}: {
  editing?: ShipmentLineRow;
  shipmentId: string;
  skus: SkuFullRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [skuId, setSkuId]               = useState(editing?.sku_id ?? "");
  const [qtyCartons, setQtyCartons]     = useState(editing?.qty_cartons ?? 1);
  const [fobCurrency, setFobCurrency]   = useState<FobCurrency>(editing?.fob_currency ?? "IDR");
  // Supplier price entry ALWAYS defaults to Pack — Ali quotes per pack, so the
  // sheet opens in pack mode every time (new lines and edits alike). The schema
  // only stores fob_per_carton; the field shows the per-pack price and save
  // converts back (× packs_per_carton). When editing, seed the field by dividing
  // the stored carton value by packs_per_carton so the displayed pack price is
  // correct on open.
  const [fobEntryUnit, setFobEntryUnit] = useState<"pack" | "carton">("pack");
  const [fobPerCarton, setFobPerCarton] = useState<string>(() => {
    if (!editing) return "";
    const editSku = skus.find((s) => s.id === editing.sku_id);
    const ppc = editSku?.packs_per_carton ?? 0;
    return ppc > 0
      ? String(+(editing.fob_per_carton / ppc).toFixed(4))
      : String(editing.fob_per_carton);
  });
  const [saving, setSaving]             = useState(false);
  // Batch expiry — optional but first-class for FMCG. Captured here at the
  // shipment line; confirm_grn batches inherit it (migration 0071 trigger).
  const [expiryDate, setExpiryDate]     = useState(editing?.expiry_date ?? "");
  const [search, setSearch]             = useState("");
  const [showScanner, setShowScanner]   = useState(false);

  const sku = skus.find((s) => s.id === skuId);

  function handleScanResult(code: string) {
    setShowScanner(false);
    const match = skus.find(
      (s) => s.internal_code === code || s.supplier_barcode === code,
    );
    if (match) {
      setSkuId(match.id);
      setSearch("");
      toast.success(`Found: ${match.brand_name} ${match.variant_display}`);
    } else {
      setSearch(code);
      toast.warning(`No SKU matched "${code}" — showing search results`);
    }
  }

  const filteredSkus = useMemo(() => {
    const term = search.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    if (!term) return active.slice(0, 50);
    return active.filter((s) =>
      [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""].join(" ").toLowerCase().includes(term)
    ).slice(0, 50);
  }, [skus, search]);

  async function save() {
    if (!skuId || !fobPerCarton || !sku) return;
    const parsedFob = parseFloat(fobPerCarton);
    if (isNaN(parsedFob) || parsedFob <= 0) { toast.error("FOB must be > 0"); return; }
    // fob_per_carton is the only value the schema stores — if the supplier
    // quoted per pack, convert to per-carton here before saving so every
    // downstream cost calc (which is all per-carton) keeps working unchanged.
    const fobPerCartonValue = fobEntryUnit === "pack" ? parsedFob * sku.packs_per_carton : parsedFob;
    // Warehouse is no longer chosen here — it's assigned at receiving (GRN).
    const payload = {
      shipment_id: shipmentId, sku_id: skuId,
      qty_cartons: qtyCartons,
      cbm_per_carton: Number(sku.cbm_per_carton),
      fob_per_carton: fobPerCartonValue,
      fob_currency: fobCurrency,
      expiry_date: expiryDate || null,
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
    border: "0.5px solid var(--glass-border-lo)",
  };

  return (
    <div className="fixed inset-0 z-60 flex items-end snm-scrim-in" style={{ background: "var(--scrim-bg)", touchAction: "none" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
        style={{ background: "var(--glass-2)", backdropFilter: "var(--glass-blur-lg)", WebkitBackdropFilter: "var(--glass-blur-lg)", height: "85dvh", maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)", touchAction: "none" }}
      >
        {/* Fixed header — grabber + title stay pinned at the top */}
        <div className="shrink-0 px-6 pt-3">
          <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "var(--glass-border)" }} />
          <h2 className="text-[20px] font-semibold text-foreground mb-5">{editing ? "Edit Product" : "Add Product"}</h2>
        </div>

        {/* Scrollable body — only this region scrolls, so the footer never leaves the screen.
            touchAction: pan-y so a drag here only scrolls vertically — never pans the sheet itself. */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-6" style={{ touchAction: "pan-y" }}>

        {/* SKU picker */}
        <div className="mb-4">
          <p className="label-caps text-[12px] mb-2" style={{ color: "var(--muted-foreground)" }}>PRODUCT *</p>
          {!skuId ? (
            <>
              <div className="flex items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search brand, model, code…"
                  className="flex-1 h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                  style={inputSty2}
                />
                <button
                  onClick={() => setShowScanner(true)}
                  style={{
                    width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                    background: "var(--snm-brand)", border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 4px 16px color-mix(in srgb, var(--snm-brand) 40%, transparent)",
                  }}
                  aria-label="Scan barcode"
                >
                  <ScanLine size={20} color="var(--snm-brand-on)" />
                </button>
              </div>
              <div className="mt-2 rounded-xl overflow-hidden" style={{ maxHeight: "55dvh", overflowY: "auto", border: "0.5px solid var(--glass-border-lo)", background: "var(--glass-bg-1)" }}>
                {filteredSkus.length === 0
                  ? <p className="p-4 ios-subhead" style={{ color: "var(--muted-foreground)" }}>No matches.</p>
                  : filteredSkus.map((s) => (
                    <button key={s.id} onClick={() => setSkuId(s.id)}
                      className="w-full text-left px-4 py-3 transition"
                      style={{ borderBottom: "0.5px solid var(--glass-border-lo)", background: "transparent" }}>
                      <SkuIdentity
                        brandName={s.brand_name} modelName={s.model_name} variantDisplay={s.variant_display}
                        pcsPerPack={s.pcs_per_pack} packsPerCarton={s.packs_per_carton}
                        trailing={`CBM ${Number(s.cbm_per_carton).toFixed(4)}`}
                      />
                    </button>
                  ))
                }
              </div>
            </>
          ) : sku ? (
            <div className="rounded-xl p-4" style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
              <div className="flex justify-between items-start gap-3">
                <SkuIdentity
                  brandName={sku.brand_name} modelName={sku.model_name} variantDisplay={sku.variant_display}
                  pcsPerPack={sku.pcs_per_pack} packsPerCarton={sku.packs_per_carton}
                  size="card"
                  trailing={`CBM ${Number(sku.cbm_per_carton).toFixed(4)}`}
                />
                <button onClick={() => setSkuId("")} className="ios-subhead shrink-0" style={{ color: "var(--muted-foreground)", background: "none", border: "none", cursor: "pointer" }}>
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
              <p className="label-caps text-[12px] mb-2" style={{ color: "var(--muted-foreground)" }}>QTY CARTONS *</p>
              <QtyStepper value={qtyCartons} min={1} onChange={setQtyCartons} />
              {sku && (
                <p className="ios-subhead mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                  = {qtyCartons * sku.packs_per_carton} packs · {qtyCartons * sku.packs_per_carton * sku.pcs_per_pack} pcs
                  · {(qtyCartons * Number(sku.cbm_per_carton)).toFixed(4)} CBM
                </p>
              )}
            </div>

            {/* FOB price — supplier can quote per pack or per carton; toggle
                which one the typed number means. Stored value is always
                per-carton (converted on save), since costing downstream is
                carton-based. */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>SUPPLIER PRICE *</p>
                <div className="flex gap-2">
                  {([
                    { key: "pack" as const, label: "Pack" },
                    { key: "carton" as const, label: "Carton" },
                  ]).map((opt) => {
                    const on = fobEntryUnit === opt.key;
                    return (
                      <button key={opt.key} type="button"
                        onClick={() => setFobEntryUnit(opt.key)}
                        className="flex items-center gap-1.5"
                        style={{
                          padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
                          border: on ? "none" : "0.5px solid var(--glass-border-lo)",
                          background: on ? "var(--foreground)" : "transparent",
                          color: on ? "var(--background)" : "var(--muted-foreground)",
                          transition: "all 0.15s",
                        }}>
                        {on && <Check className="h-3 w-3" style={{ flexShrink: 0 }} />}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={fobPerCarton}
                  onChange={(e) => setFobPerCarton(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder={fobEntryUnit === "pack" ? "e.g. 12800" : "e.g. 51200"}
                  className="flex-1 h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                  style={inputSty2}
                />
                <div className="relative">
                  <select
                    value={fobCurrency}
                    onChange={(e) => setFobCurrency(e.target.value as FobCurrency)}
                    className="h-12 rounded-xl px-3 pr-8 ios-subhead text-foreground outline-none appearance-none"
                    style={{ ...inputSty2, width: 80 }}
                  >
                    <option value="IDR">IDR</option>
                    <option value="USD">USD</option>
                    <option value="MVR">MVR</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
                </div>
              </div>
              <p className="ios-subhead mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                {fobEntryUnit === "pack" && sku && fobPerCarton && !isNaN(parseFloat(fobPerCarton))
                  ? `= ${(parseFloat(fobPerCarton) * sku.packs_per_carton).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${fobCurrency} / carton`
                  : "Price on this shipment's invoice — can differ from previous shipments."}
              </p>
            </div>

            {/* Batch expiry — optional; powers the expiring-stock alerts. */}
            <div className="mb-6">
              <p className="label-caps text-[12px] mb-2" style={{ color: "var(--muted-foreground)" }}>
                Expiry date <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </p>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="snm-input"
                style={{ colorScheme: "inherit" }}
              />
              <p className="ios-subhead mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                From the carton print. The app warns you before this batch dies on the shelf.
              </p>
            </div>

            {/* Warehouse is chosen at receiving (GRN), not when ordering. */}
            <div className="mb-6 rounded-xl px-4 py-3 flex items-start gap-2.5"
              style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
              <Warehouse className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                You&apos;ll choose the destination warehouse when you receive this shipment — no need to decide now.
              </p>
            </div>
          </>
        )}
        </div>
        {/* End scrollable body */}

        {/* Pinned footer — always visible in the thumb zone, never scrolls away */}
        <div
          className="shrink-0 flex gap-3 px-6 pt-3"
          style={{
            paddingBottom: "max(calc(20px + env(safe-area-inset-bottom, 16px)), var(--kb-inset))",
            borderTop: "0.5px solid var(--glass-border-lo)",
          }}
        >
          <button onClick={onClose} className="flex-1 h-12 rounded-xl ios-subhead font-semibold"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button
            onClick={save}
            disabled={saving || !skuId || !fobPerCarton}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save Changes" : "Add to PO"}
          </button>
        </div>
      </div>

      {showScanner && (
        <BarcodeScanner
          hint="Scan product barcode"
          onResult={handleScanResult}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}

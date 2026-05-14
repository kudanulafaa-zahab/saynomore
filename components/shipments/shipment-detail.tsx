"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2,
  ArrowLeft,
  Plus,
  Trash2,
  CheckCircle2,
  Lock,
  AlertTriangle,
  Truck,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import {
  getShipment,
  listShipmentLines,
  updateShipment,
  deleteShipment,
  createShipmentLine,
  updateShipmentLine,
  deleteShipmentLine,
  confirmGrn,
  forceVoidGrn,
  type ShipmentRow,
  type ShipmentLineRow,
  type FobCurrency,
  type ShipmentStatus,
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--glass-bg-1)",
  color: "var(--foreground)",
  border: "1px solid var(--glass-border-lo)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const disabledInputStyle: React.CSSProperties = {
  ...inputStyle,
  opacity: 0.5,
  cursor: "not-allowed",
};

const labelStyle: React.CSSProperties = {
  color: "var(--muted-foreground)",
  fontSize: 11,
  fontWeight: 500,
  marginBottom: 6,
  display: "block",
};

/* ── Status ──────────────────────────────────────────────────────────────── */

const STATUS_OPTIONS: { value: ShipmentStatus; label: string }[] = [
  { value: "draft",         label: "Draft" },
  { value: "ordered",       label: "Ordered" },
  { value: "in_transit",    label: "In Transit" },
  { value: "arrived",       label: "Arrived" },
];

const STATUS_COLOR: Record<ShipmentStatus, string> = {
  draft:         "var(--glass-border)",
  ordered:       "color-mix(in srgb, var(--snm-brand) 30%, transparent)",
  in_transit:    "color-mix(in srgb, var(--snm-warning) 30%, transparent)",
  arrived:       "color-mix(in srgb, var(--snm-warning) 20%, transparent)",
  grn_confirmed: "color-mix(in srgb, var(--snm-success) 30%, transparent)",
};

/* ── Main component ──────────────────────────────────────────────────────── */

export function ShipmentDetail({ id }: { id: string }) {
  const router = useRouter();
  const [shipment, setShipment] = useState<ShipmentRow | null>(null);
  const [lines, setLines] = useState<ShipmentLineRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [voiding, setVoiding] = useState(false);
  type PriceChange = { skuPath: string; before: number; after: number; changePct: number };
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);
  const [deletingShipment, setDeletingShipment] = useState(false);
  const [deletingLine, setDeletingLine] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  // sheet panels
  type Panel = "confirmGrn" | "voidGrn" | "deleteShipment" | "deleteLine" | "addLine" | null;
  const [panel, setPanel] = useState<Panel>(null);
  const [editingLine, setEditingLine] = useState<ShipmentLineRow | undefined>();
  const [pendingDeleteLine, setPendingDeleteLine] = useState<ShipmentLineRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, ls, sk, sup, gd] = await Promise.all([
        getShipment(id),
        listShipmentLines(id),
        listSkusFlat(),
        listSuppliers(),
        listGodowns(),
      ]);
      setShipment(s);
      setLines(ls);
      setSkus(sk);
      setSuppliers(sup);
      setGodowns(gd);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);

  const isAdmin = role === "admin";
  const locked  = shipment?.status === "grn_confirmed";

  /* ── Live landed-cost preview ──────────────────────────────────────────── */
  const preview = useMemo(() => {
    if (!shipment) return null;
    const idr = shipment.rate_idr_to_mvr ?? 0;
    const usd = shipment.rate_usd_to_mvr ?? 0;
    if (lines.length === 0 || idr <= 0 || usd <= 0) return null;

    const totalCbm = lines.reduce((acc, l) => acc + l.qty_cartons * l.cbm_per_carton, 0);
    if (totalCbm <= 0) return null;

    const freightMvr = (shipment.my_freight_share_usd ?? 0) * usd;
    const localMvr =
      (shipment.customs_duty_mvr ?? 0) +
      (shipment.mpl_charges_mvr ?? 0) +
      (shipment.agent_fee_mvr ?? 0) +
      (shipment.last_mile_mvr ?? 0) +
      (shipment.insurance_mvr ?? 0) +
      (shipment.other_mvr ?? 0);
    const poolMvr = freightMvr + localMvr;

    const linesPreview = lines.map((l) => {
      const sku = skus.find((s) => s.id === l.sku_id);
      const fxToMvr = l.fob_currency === "IDR" ? idr : l.fob_currency === "USD" ? usd : 1;
      const fobMvr   = l.qty_cartons * l.fob_per_carton * fxToMvr;
      const cbmShare = (l.qty_cartons * l.cbm_per_carton) / totalCbm;
      const apportioned = cbmShare * poolMvr;
      const lineTotal   = fobMvr + apportioned;
      const perCarton   = lineTotal / l.qty_cartons;
      const perPack     = sku ? perCarton / sku.packs_per_carton : 0;
      const perPiece    = sku ? perPack / sku.pcs_per_pack : 0;
      return { line: l, sku, fobMvr, apportioned, lineTotal, perCarton, perPack, perPiece };
    });

    const grandTotal = linesPreview.reduce((acc, p) => acc + p.lineTotal, 0);
    return { totalCbm, freightMvr, localMvr, poolMvr, lines: linesPreview, grandTotal };
  }, [shipment, lines, skus]);

  /* ── Header patch ──────────────────────────────────────────────────────── */
  async function patch(field: keyof ShipmentRow, value: number | string | boolean | null) {
    if (!shipment || locked) return;
    try {
      await updateShipment(shipment.id, { [field]: value } as Record<string, unknown>);
      setShipment({ ...shipment, [field]: value } as ShipmentRow);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleConfirmGrn() {
    if (!shipment) return;
    setConfirming(true);
    try {
      // Snapshot selling prices before confirmation
      const beforePrices = new Map(
        skus
          .filter((s) => lines.some((l) => l.sku_id === s.id))
          .map((s) => [s.id, s.selling_price_per_piece_mvr])
      );

      await confirmGrn(shipment.id);
      setPanel(null);

      // Reload, then compare new prices
      await load();

      // After load(), skus state updates asynchronously — compare via fresh fetch
      const { listSkusFlat: freshFetch } = await import("@/lib/queries/products");
      const freshSkus = await freshFetch();
      const changes: PriceChange[] = [];
      for (const line of lines) {
        const fresh = freshSkus.find((s) => s.id === line.sku_id);
        const before = beforePrices.get(line.sku_id) ?? null;
        const after  = fresh?.selling_price_per_piece_mvr ?? null;
        if (before != null && after != null && before > 0) {
          const changePct = ((after - before) / before) * 100;
          if (Math.abs(changePct) >= 2) {
            changes.push({ skuPath: fresh?.full_path ?? line.sku_id, before, after, changePct });
          }
        }
      }
      setPriceChanges(changes);
      if (changes.length > 0) {
        toast.warning(`${changes.length} SKU${changes.length > 1 ? "s" : ""} had a price change — review below`);
      } else {
        toast.success("GRN confirmed — stock is now live");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  /* ── Loading / not found ───────────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }
  if (!shipment) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: "var(--muted-foreground)" }}>Shipment not found.</p>
        <Link href="/shipments" style={{ color: "var(--foreground)", fontSize: 14, marginTop: 12, display: "block" }}>← Back</Link>
      </div>
    );
  }

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div style={{ background: "var(--background)", minHeight: "100vh", padding: "0 0 140px 0" }}>

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/shipments" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, background: "var(--glass-bg-1)", color: "var(--muted-foreground)", textDecoration: "none", flexShrink: 0 }}>
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>Shipment</p>
          <h1 style={{ color: "var(--foreground)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>{shipment.reference}</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {locked && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: "color-mix(in srgb, var(--snm-success) 12%, transparent)", color: "var(--snm-success)", borderRadius: 999, padding: "4px 10px" }}>
              <Lock style={{ width: 10, height: 10 }} /> Locked
            </span>
          )}
          {isAdmin && !locked && (
            <button
              onClick={() => setPanel("deleteShipment")}
              style={{ width: 36, height: 36, borderRadius: 10, background: "color-mix(in srgb, var(--snm-error) 8%, transparent)", border: "none", color: "var(--snm-error)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              title="Delete shipment"
            >
              <Trash2 style={{ width: 16, height: 16 }} />
            </button>
          )}
        </div>
      </div>

      {/* ── Status + supplier row ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <span style={labelStyle}>Status</span>
          {locked ? (
            <div style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 8, background: "color-mix(in srgb, var(--snm-success) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
              <Truck style={{ width: 14, height: 14, color: "var(--snm-success)", flexShrink: 0 }} />
              <span style={{ color: "var(--snm-success)", fontSize: 14, fontWeight: 600 }}>Received</span>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <select
                value={shipment.status}
                onChange={(e) => patch("status", e.target.value as ShipmentStatus)}
                style={{ ...inputStyle, appearance: "none", paddingRight: 32, background: STATUS_COLOR[shipment.status] }}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--muted-foreground)", pointerEvents: "none" }} />
            </div>
          )}
        </div>
        <div>
          <span style={labelStyle}>Supplier</span>
          <div style={{ position: "relative" }}>
            <select
              value={shipment.supplier_id ?? ""}
              onChange={(e) => e.target.value && patch("supplier_id", e.target.value)}
              disabled={locked}
              style={{ ...(locked ? disabledInputStyle : inputStyle), appearance: "none", paddingRight: 32 }}
            >
              <option value="">Select…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <ChevronDown style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--muted-foreground)", pointerEvents: "none" }} />
          </div>
        </div>
      </div>

      {/* ── Forex rates ──────────────────────────────────────────────────── */}
      <div style={{ ...CARD, padding: 20, marginBottom: 10 }}>
        <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>Forex Rates</p>
        <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginBottom: 16 }}>Locked at GRN — enter your bank&apos;s rates.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <ForexField
            label="1 USD = ___ IDR *"
            value={shipment.rate_idr_to_usd && shipment.rate_idr_to_usd > 0 ? Math.round(1 / shipment.rate_idr_to_usd) : null}
            onChange={async (usdToIdr) => {
              if (!usdToIdr || usdToIdr <= 0) { await patch("rate_idr_to_usd", null); await patch("rate_idr_to_mvr", null); return; }
              const idrToUsd = 1 / usdToIdr;
              await patch("rate_idr_to_usd", idrToUsd);
              const usdMvr = shipment.rate_usd_to_mvr;
              if (usdMvr) await patch("rate_idr_to_mvr", usdMvr / usdToIdr);
            }}
            disabled={locked}
            hint="e.g. 16420"
          />
          <ForexField
            label="1 USD = ___ MVR *"
            value={shipment.rate_usd_to_mvr}
            onChange={async (usdMvr) => {
              await patch("rate_usd_to_mvr", usdMvr);
              const idrUsd = shipment.rate_idr_to_usd;
              if (idrUsd && idrUsd > 0 && usdMvr) await patch("rate_idr_to_mvr", usdMvr * idrUsd);
            }}
            disabled={locked}
            hint="e.g. 15.42"
          />
          <div>
            <span style={labelStyle}>1 IDR = ___ MVR (auto)</span>
            <input
              type="text"
              readOnly
              value={shipment.rate_idr_to_mvr != null ? shipment.rate_idr_to_mvr.toFixed(8) : ""}
              style={{ ...disabledInputStyle, fontFamily: "monospace", fontSize: 12 }}
            />
            <p style={{ color: "var(--muted-foreground)", fontSize: 10, marginTop: 4 }}>= USD→MVR ÷ USD→IDR</p>
          </div>
        </div>
      </div>

      {/* ── Freight + Local costs side by side ───────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>

        {/* Freight */}
        <div style={{ ...CARD, padding: 20 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>Freight</p>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: locked ? "not-allowed" : "pointer" }}>
            <input
              type="checkbox"
              checked={shipment.shared_container}
              onChange={(e) => patch("shared_container", e.target.checked)}
              disabled={locked}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ color: "var(--foreground)", fontSize: 13 }}>Shared container</span>
          </label>

          <NumberField
            label="My share (USD) *"
            value={shipment.my_freight_share_usd}
            onChange={(v) => patch("my_freight_share_usd", v ?? 0)}
            disabled={locked}
          />

          {preview && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--glass-bg-1)", borderRadius: 10 }}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>= MVR</p>
              <p style={{ color: "var(--foreground)", fontSize: 18, fontWeight: 700 }}>{preview.freightMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            </div>
          )}
        </div>

        {/* Local costs */}
        <div style={{ ...CARD, padding: 20 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>Local Costs (MVR)</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <NumberField label="Customs"   value={shipment.customs_duty_mvr} onChange={(v) => patch("customs_duty_mvr", v ?? 0)} disabled={locked} compact />
            <NumberField label="MPL / Port" value={shipment.mpl_charges_mvr}  onChange={(v) => patch("mpl_charges_mvr",  v ?? 0)} disabled={locked} compact />
            <NumberField label="Agent"      value={shipment.agent_fee_mvr}    onChange={(v) => patch("agent_fee_mvr",    v ?? 0)} disabled={locked} compact />
            <NumberField label="Last Mile"  value={shipment.last_mile_mvr}    onChange={(v) => patch("last_mile_mvr",    v ?? 0)} disabled={locked} compact />
            <NumberField label="Insurance"  value={shipment.insurance_mvr}    onChange={(v) => patch("insurance_mvr",    v ?? 0)} disabled={locked} compact />
            <NumberField label="Other"      value={shipment.other_mvr}        onChange={(v) => patch("other_mvr",        v ?? 0)} disabled={locked} compact />
          </div>
          {preview && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--glass-bg-1)", borderRadius: 10 }}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Total local</p>
              <p style={{ color: "var(--foreground)", fontSize: 18, fontWeight: 700 }}>{preview.localMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Cost preview banner ───────────────────────────────────────────── */}
      {preview && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}>
          {[
            { label: "Total CBM", value: preview.totalCbm.toFixed(4), sub: `${lines.length} line${lines.length !== 1 ? "s" : ""}` },
            { label: "Freight (MVR)", value: preview.freightMvr.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
            { label: "Local (MVR)",   value: preview.localMvr.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
            { label: "Total Landed",  value: "MVR " + preview.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }), highlight: true },
          ].map((s) => (
            <div key={s.label} style={{ ...CARD, padding: "14px 16px" }}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</p>
              <p style={{ color: s.highlight ? "var(--snm-success)" : "var(--foreground)", fontSize: 18, fontWeight: 700 }}>{s.value}</p>
              {s.sub && <p style={{ color: "var(--muted-foreground)", fontSize: 10, marginTop: 2 }}>{s.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* ── Line items ────────────────────────────────────────────────────── */}
      <div style={{ ...CARD, padding: 20, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h2 style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 600 }}>Line items</h2>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 2 }}>{lines.length} line{lines.length !== 1 ? "s" : ""} · apportioned by CBM</p>
          </div>
          {!locked && (
            <button
              onClick={() => { setEditingLine(undefined); setPanel("addLine"); }}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 999, padding: "8px 16px", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}
            >
              <Plus style={{ width: 14, height: 14 }} /> Add Line
            </button>
          )}
        </div>

        {lines.length === 0 ? (
          <p style={{ color: "var(--muted-foreground)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No lines yet. Add a product to start.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lines.map((l) => {
              const sku     = skus.find((s) => s.id === l.sku_id);
              const godown  = godowns.find((g) => g.id === l.destination_godown_id);
              const livePer = preview?.lines.find((p) => p.line.id === l.id);
              return (
                <div key={l.id} style={{ background: "var(--glass-bg-1)", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                        {sku?.full_path ?? "Unknown SKU"}
                      </p>
                      <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
                        {l.qty_cartons} ctn · <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{l.fob_per_carton.toLocaleString()} {l.fob_currency}/ctn</span>
                        · {Number(l.cbm_per_carton).toFixed(4)} CBM/ctn
                        {godown && <> · → {godown.name}</>}
                      </p>
                    </div>
                    {!locked && (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => { setEditingLine(l); setPanel("addLine"); }}
                          style={{ background: "none", border: "none", color: "var(--muted-foreground)", fontSize: 12, cursor: "pointer", padding: "4px 8px" }}
                        >Edit</button>
                        <button
                          onClick={() => { setPendingDeleteLine(l); setPanel("deleteLine"); }}
                          style={{ background: "none", border: "none", color: "var(--snm-error)", fontSize: 12, cursor: "pointer", padding: "4px 8px" }}
                        >Remove</button>
                      </div>
                    )}
                  </div>

                  {/* Per-line landed cost breakdown */}
                  {(livePer || locked) && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--glass-border-lo)" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                        {(livePer ? [
                          { label: "Total", value: "MVR " + livePer.lineTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
                          { label: "/carton", value: livePer.perCarton.toFixed(0) },
                          { label: "/pack", value: livePer.perPack.toFixed(2) },
                          { label: "/piece", value: livePer.perPiece.toFixed(3), highlight: true },
                        ] : [
                          { label: "Total", value: l.landed_total_mvr != null ? "MVR " + Number(l.landed_total_mvr).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—" },
                          { label: "/carton", value: l.landed_per_carton_mvr != null ? Number(l.landed_per_carton_mvr).toFixed(0) : "—" },
                          { label: "/pack", value: l.landed_per_pack_mvr != null ? Number(l.landed_per_pack_mvr).toFixed(2) : "—" },
                          { label: "/piece", value: l.landed_per_piece_mvr != null ? Number(l.landed_per_piece_mvr).toFixed(3) : "—", highlight: true },
                        ]).map((c) => (
                          <div key={c.label} style={{ background: "var(--glass-bg-1)", borderRadius: 8, padding: "8px 10px" }}>
                            <p style={{ color: "var(--muted-foreground)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{c.label}</p>
                            <p style={{ color: c.highlight ? "var(--snm-success)" : "var(--foreground)", fontSize: 14, fontWeight: 600 }}>{c.value}</p>
                          </div>
                        ))}
                      </div>
                      {/* Locked: show resulting selling price for this SKU */}
                      {locked && sku && (sku.selling_price_per_piece_mvr != null) && l.landed_per_piece_mvr != null && (
                        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between",
                          background: "color-mix(in srgb, var(--snm-success) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 15%, transparent)" }}>
                          <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
                            Current selling price / piece
                            {sku.fixed_selling_price_mvr != null
                              ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: "var(--snm-brand)" }}>FIXED</span>
                              : <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: "var(--snm-success)" }}>AUTO</span>
                            }
                          </span>
                          <span style={{ color: "var(--snm-success)", fontSize: 14, fontWeight: 700 }}>
                            MVR {Number(sku.selling_price_per_piece_mvr).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Notes (optional, collapsed by default) ───────────────────────── */}
      <NotesField value={shipment.notes} locked={locked} onSave={(v) => patch("notes", v)} />

      {/* ── GRN action / locked state ─────────────────────────────────────── */}
      {!locked ? (
        <button
          onClick={() => setPanel("confirmGrn")}
          disabled={!preview || lines.length === 0}
          style={{
            width: "100%", background: preview && lines.length > 0 ? "var(--foreground)" : "var(--glass-bg-2)",
            color: preview && lines.length > 0 ? "var(--background)" : "var(--muted-foreground)",
            border: "none", borderRadius: 999, padding: "16px", fontSize: 13, fontWeight: 700,
            letterSpacing: "0.06em", textTransform: "uppercase",
            cursor: preview && lines.length > 0 ? "pointer" : "not-allowed",
          }}
        >
          Confirm GRN — Lock Costs & Create Stock →
        </button>
      ) : (
        <>
          {/* Confirmed state */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: "color-mix(in srgb, var(--snm-success) 8%, transparent)", borderRadius: 14, border: "1px solid color-mix(in srgb, var(--snm-success) 15%, transparent)", marginBottom: 10 }}>
            <Truck style={{ color: "var(--snm-success)", width: 20, height: 20, flexShrink: 0 }} />
            <div>
              <p style={{ color: "var(--snm-success)", fontSize: 14, fontWeight: 700 }}>Goods received — stock live</p>
              {shipment.grn_confirmed_at && (
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 2 }}>
                  Confirmed {new Date(shipment.grn_confirmed_at).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          {/* Price change alert */}
          {priceChanges.length > 0 && (
            <div style={{ ...CARD, padding: 20, marginBottom: 10, border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" }}>
              <p style={{ color: "var(--snm-warning)", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                ⚠ {priceChanges.length} SKU{priceChanges.length > 1 ? "s" : ""} had a selling price change from this shipment
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {priceChanges.map((c) => (
                  <div key={c.skuPath} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                    background: "var(--glass-bg-1)", borderRadius: 10, padding: "10px 14px" }}>
                    <p style={{ color: "var(--foreground)", fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.skuPath}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>MVR {c.before.toFixed(2)}</span>
                      <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>→</span>
                      <span style={{ color: c.changePct > 0 ? "var(--snm-warning)" : "var(--snm-success)", fontSize: 13, fontWeight: 700 }}>
                        MVR {c.after.toFixed(2)}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600,
                        color: c.changePct > 0 ? "var(--snm-warning)" : "var(--snm-success)" }}>
                        {c.changePct > 0 ? "+" : ""}{c.changePct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 12 }}>
                These prices are live in your sales modal now. If you want to lock a price, go to Products → Edit SKU → set a fixed price.
              </p>
              <button
                onClick={() => setPriceChanges([])}
                style={{ marginTop: 10, fontSize: 11, color: "var(--muted-foreground)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Made a mistake? */}
          {isAdmin && (
            <div style={{ ...CARD, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <RotateCcw style={{ color: "var(--snm-warning)", width: 18, height: 18 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Made a mistake in the figures?</p>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                    Once GRN is confirmed, costs are locked to protect stock valuations. To correct a figure, you need to <strong style={{ color: "var(--foreground)" }}>void this GRN</strong> — which removes all inventory batches and stock movements — then re-enter the correct figures and confirm GRN again.
                  </p>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginBottom: 16, padding: "8px 12px", background: "color-mix(in srgb, var(--snm-error) 6%, transparent)", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--snm-error) 12%, transparent)" }}>
                    ⚠ If any stock from this shipment has already been sold, voiding will also delete those sales orders.
                  </p>
                  <button
                    onClick={() => setPanel("voidGrn")}
                    style={{ display: "flex", alignItems: "center", gap: 8, background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)", border: "1px solid color-mix(in srgb, var(--snm-error) 20%, transparent)", borderRadius: 999, padding: "10px 20px", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}
                  >
                    <RotateCcw style={{ width: 14, height: 14 }} /> Void GRN & Re-enter
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Bottom sheets ─────────────────────────────────────────────────── */}

      {/* Confirm GRN */}
      <Sheet open={panel === "confirmGrn"} onClose={() => setPanel(null)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <AlertTriangle style={{ color: "var(--snm-warning)", width: 20, height: 20 }} />
          </div>
          <h2 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600 }}>Confirm GRN?</h2>
        </div>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 20 }}>
          Forex rates and all costs will be <strong style={{ color: "var(--foreground)" }}>permanently locked</strong>. Stock is created in the destination warehouses and becomes available for sale immediately.
        </p>
        {preview && (
          <div style={{ background: "var(--glass-bg-1)", borderRadius: 12, padding: 16, marginBottom: 24 }}>
            {[
              { label: "Lines", value: String(lines.length) },
              { label: "Total CBM", value: preview.totalCbm.toFixed(4) },
              { label: "Total Landed (MVR)", value: preview.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }), bold: true },
            ].map((r) => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--glass-border-lo)" }}>
                <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{r.label}</span>
                <span style={{ color: "var(--foreground)", fontSize: 13, fontWeight: r.bold ? 700 : 500 }}>{r.value}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          <button onClick={handleConfirmGrn} disabled={confirming} style={{ ...primaryBtn, background: "var(--snm-success)" }}>
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Confirm & Lock"}
          </button>
        </div>
      </Sheet>

      {/* Void GRN */}
      <Sheet open={panel === "voidGrn"} onClose={() => setPanel(null)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <AlertTriangle style={{ color: "var(--snm-error)", width: 20, height: 20 }} />
          </div>
          <h2 style={{ color: "var(--snm-error)", fontSize: 20, fontWeight: 600 }}>Void GRN & Delete?</h2>
        </div>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>
          <strong style={{ color: "var(--foreground)" }}>{shipment.reference}</strong> will be completely removed — all inventory batches, stock movements, and any linked sales orders will be deleted. This cannot be undone.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          <button
            onClick={async () => {
              setVoiding(true);
              try {
                await forceVoidGrn(shipment.id);
                toast.success("Shipment voided — all linked data deleted");
                router.push("/shipments");
              } catch (e) { toast.error((e as Error).message); }
              finally { setVoiding(false); }
            }}
            disabled={voiding}
            style={{ ...primaryBtn, background: "var(--snm-error)" }}
          >
            {voiding ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Void & Delete"}
          </button>
        </div>
      </Sheet>

      {/* Delete shipment */}
      <Sheet open={panel === "deleteShipment"} onClose={() => setPanel(null)}>
        <h2 style={{ color: "var(--snm-error)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Delete Shipment?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>
          <strong style={{ color: "var(--foreground)" }}>{shipment.reference}</strong> and all its lines will be permanently removed.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          <button
            onClick={async () => {
              setDeletingShipment(true);
              try {
                await deleteShipment(shipment.id);
                toast.success("Shipment deleted");
                router.push("/shipments");
              } catch (e) { toast.error((e as Error).message); }
              finally { setDeletingShipment(false); }
            }}
            disabled={deletingShipment}
            style={{ ...primaryBtn, background: "var(--snm-error)" }}
          >
            {deletingShipment ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Delete"}
          </button>
        </div>
      </Sheet>

      {/* Delete line */}
      <Sheet open={panel === "deleteLine"} onClose={() => { setPendingDeleteLine(null); setPanel(null); }}>
        <h2 style={{ color: "var(--snm-error)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Remove line?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>
          {pendingDeleteLine && (() => {
            const sku = skus.find((s) => s.id === pendingDeleteLine.sku_id);
            return sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "This line";
          })()} will be removed from the shipment.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => { setPendingDeleteLine(null); setPanel(null); }} style={ghostBtn}>Cancel</button>
          <button
            onClick={async () => {
              if (!pendingDeleteLine) return;
              setDeletingLine(true);
              try {
                await deleteShipmentLine(pendingDeleteLine.id);
                toast.success("Line removed");
                setPendingDeleteLine(null);
                setPanel(null);
                load();
              } catch (e) { toast.error((e as Error).message); }
              finally { setDeletingLine(false); }
            }}
            disabled={deletingLine}
            style={{ ...primaryBtn, background: "var(--snm-error)" }}
          >
            {deletingLine ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Remove"}
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

/* ── Shared button styles ─────────────────────────────────────────────────── */

const ghostBtn: React.CSSProperties = {
  flex: 1, background: "var(--glass-bg-1)", color: "var(--muted-foreground)",
  border: "none", borderRadius: 999, padding: "14px", fontSize: 14, cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  flex: 2, background: "var(--foreground)", color: "var(--background)",
  border: "none", borderRadius: 999, padding: "14px", fontSize: 13,
  fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
};

/* ── Sheet ────────────────────────────────────────────────────────────────── */

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 60, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", borderRadius: "20px 20px 0 0", width: "100%", padding: "28px 24px 40px", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ width: 40, height: 4, background: "var(--glass-border)", borderRadius: 999, margin: "0 auto 24px" }} />
        {children}
      </div>
    </div>
  );
}

/* ── NumberField ──────────────────────────────────────────────────────────── */

function NumberField({
  label, value, onChange, disabled, hint, compact,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  hint?: string;
  compact?: boolean;
}) {
  const [local, setLocal] = useState<string>(value != null ? String(value) : "");
  useEffect(() => { setLocal(value != null ? String(value) : ""); }, [value]);
  const sz = compact ? 12 : 14;
  return (
    <div>
      <span style={{ ...labelStyle, fontSize: compact ? 10 : 11 }}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const num = local === "" ? null : Number(local);
          const prevNum = value != null ? Number(value) : null;
          if (num !== prevNum) onChange(num);
        }}
        disabled={disabled}
        style={{ ...(disabled ? disabledInputStyle : inputStyle), fontSize: sz, padding: compact ? "8px 10px" : "10px 12px" }}
      />
      {hint && <p style={{ color: "var(--muted-foreground)", fontSize: 10, marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

/* ── ForexField — same as NumberField but step=1 ─────────────────────────── */

function ForexField({ label, value, onChange, disabled, hint }: {
  label: string; value: number | null | undefined;
  onChange: (v: number | null) => Promise<void>;
  disabled?: boolean; hint?: string;
}) {
  const [local, setLocal] = useState<string>(value != null ? String(value) : "");
  useEffect(() => { setLocal(value != null ? String(value) : ""); }, [value]);
  return (
    <div>
      <span style={labelStyle}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="1"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={async () => {
          const num = local === "" ? null : Number(local);
          const prev = value != null ? Number(value) : null;
          if (num !== prev) await onChange(num);
        }}
        disabled={disabled}
        style={disabled ? disabledInputStyle : inputStyle}
      />
      {hint && <p style={{ color: "var(--muted-foreground)", fontSize: 10, marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

/* ── Notes collapsible ────────────────────────────────────────────────────── */

function NotesField({ value, locked, onSave }: { value: string | null; locked: boolean; onSave: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => { setLocal(value ?? ""); }, [value]);
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--muted-foreground)", fontSize: 12, cursor: "pointer", padding: "4px 0" }}
      >
        <ChevronDown style={{ width: 14, height: 14, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        Notes {value ? "(1)" : "(optional)"}
      </button>
      {open && (
        <textarea
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => onSave(local || null)}
          disabled={locked}
          placeholder="e.g. container split rationale, broker contact, etc."
          style={{ ...inputStyle, marginTop: 8, minHeight: 80, resize: "vertical" as const }}
        />
      )}
    </div>
  );
}

/* ── Line dialog (bottom sheet) ──────────────────────────────────────────── */

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
  const [skuId, setSkuId]           = useState(editing?.sku_id ?? "");
  const [qtyCartons, setQtyCartons] = useState(editing ? String(editing.qty_cartons) : "");
  const [fobPerCarton, setFobPerCarton] = useState(editing ? String(editing.fob_per_carton) : "");
  const [fobCurrency, setFobCurrency]   = useState<FobCurrency>(editing?.fob_currency ?? "IDR");
  const [godownId, setGodownId]     = useState(editing?.destination_godown_id ?? (godowns.find((g) => g.is_default)?.id ?? godowns[0]?.id ?? ""));
  const [saving, setSaving]         = useState(false);
  const [search, setSearch]         = useState("");

  const sku = skus.find((s) => s.id === skuId);

  const filteredSkus = useMemo(() => {
    const term = search.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    if (!term) return active.slice(0, 50);
    return active.filter((s) =>
      [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""].join(" ").toLowerCase().includes(term),
    ).slice(0, 50);
  }, [skus, search]);

  async function save() {
    if (!skuId || !qtyCartons || !fobPerCarton || !godownId || !sku) return;
    const parsedQty = parseInt(qtyCartons, 10);
    const parsedFob = parseFloat(fobPerCarton);
    if (isNaN(parsedQty) || parsedQty < 1) { toast.error("Qty must be ≥ 1 carton"); return; }
    if (isNaN(parsedFob) || parsedFob <= 0) { toast.error("FOB must be > 0"); return; }
    const payload = {
      shipment_id: shipmentId,
      sku_id: skuId,
      qty_cartons: parsedQty,
      cbm_per_carton: Number(sku.cbm_per_carton),
      fob_per_carton: parsedFob,
      fob_currency: fobCurrency,
      destination_godown_id: godownId,
    };
    setSaving(true);
    try {
      if (editing) await updateShipmentLine(editing.id, payload);
      else await createShipmentLine(payload);
      toast.success(editing ? "Line updated" : "Line added");
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 60, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", borderRadius: "20px 20px 0 0", width: "100%", padding: "28px 24px 40px", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div style={{ width: 40, height: 4, background: "var(--glass-border)", borderRadius: 999, margin: "0 auto 24px" }} />
        <h2 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, marginBottom: 20 }}>{editing ? "Edit Line" : "Add Line"}</h2>

        {/* SKU picker */}
        <div style={{ marginBottom: 16 }}>
          <span style={labelStyle}>Product *</span>
          {!skuId ? (
            <>
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search brand, model, code…"
                style={inputStyle}
              />
              <div style={{ borderRadius: 10, border: "1px solid var(--glass-border-lo)", maxHeight: 240, overflowY: "auto", marginTop: 8, background: "var(--glass-bg-1)" }}>
                {filteredSkus.length === 0 ? (
                  <p style={{ color: "var(--muted-foreground)", fontSize: 13, padding: 12 }}>No matches.</p>
                ) : filteredSkus.map((s) => (
                  <button key={s.id} onClick={() => setSkuId(s.id)}
                    style={{ width: "100%", textAlign: "left", padding: "10px 14px", background: "transparent", border: "none", borderBottom: "1px solid var(--glass-border-lo)", cursor: "pointer" }}
                  >
                    <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 500 }}>{s.brand_name} › {s.model_name} › {s.variant_display}</p>
                    <p style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
                      {s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn · {Number(s.cbm_per_carton).toFixed(4)} CBM · {s.internal_code}
                    </p>
                  </button>
                ))}
              </div>
            </>
          ) : sku ? (
            <div style={{ background: "var(--glass-bg-1)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>{sku.brand_name} › {sku.model_name} › {sku.variant_display}</p>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 2 }}>
                    {sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn
                  </p>
                </div>
                <button onClick={() => setSkuId("")} style={{ background: "none", border: "none", color: "var(--muted-foreground)", fontSize: 12, cursor: "pointer" }}>Change</button>
              </div>
              {/* CBM verification row — always shows what will be saved */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                <div style={{ background: "var(--glass-bg-1)", borderRadius: 8, padding: "8px 10px" }}>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>CBM / carton (from SKU)</p>
                  <p style={{ color: "var(--snm-success)", fontSize: 15, fontWeight: 700 }}>{Number(sku.cbm_per_carton).toFixed(6)}</p>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 9, marginTop: 1 }}>{sku.carton_length_cm} × {sku.carton_width_cm} × {sku.carton_height_cm} cm</p>
                </div>
                {qtyCartons && !isNaN(parseInt(qtyCartons)) && parseInt(qtyCartons) > 0 && (
                  <div style={{ background: "var(--glass-bg-1)", borderRadius: 8, padding: "8px 10px" }}>
                    <p style={{ color: "var(--muted-foreground)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Total CBM ({qtyCartons} ctn)</p>
                    <p style={{ color: "var(--foreground)", fontSize: 15, fontWeight: 700 }}>{(Number(sku.cbm_per_carton) * parseInt(qtyCartons)).toFixed(4)}</p>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Qty + FOB */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div>
            <span style={labelStyle}>Qty cartons *</span>
            <input type="number" inputMode="numeric" min="1" step="1" value={qtyCartons}
              onChange={(e) => setQtyCartons(e.target.value)} placeholder="50" style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>Supplier price / carton *</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="number" inputMode="decimal" step="0.01" value={fobPerCarton}
                onChange={(e) => setFobPerCarton(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="e.g. 51200" />
              <div style={{ position: "relative" }}>
                <select value={fobCurrency} onChange={(e) => setFobCurrency(e.target.value as FobCurrency)}
                  style={{ ...inputStyle, width: 72, appearance: "none", paddingRight: 4 }}>
                  <option value="IDR">IDR</option>
                  <option value="USD">USD</option>
                  <option value="MVR">MVR</option>
                </select>
              </div>
            </div>
            <p style={{ color: "var(--muted-foreground)", fontSize: 10, marginTop: 4 }}>Enter the price on this shipment&apos;s invoice — can differ from previous shipments.</p>
          </div>
        </div>

        {/* Destination godown */}
        <div style={{ marginBottom: 24 }}>
          <span style={labelStyle}>Destination Warehouse *</span>
          <div style={{ position: "relative" }}>
            <select value={godownId} onChange={(e) => setGodownId(e.target.value)}
              style={{ ...inputStyle, appearance: "none", paddingRight: 32 }}>
              <option value="">Select…</option>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}{g.is_default ? " (default)" : ""}</option>)}
            </select>
            <ChevronDown style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--muted-foreground)", pointerEvents: "none" }} />
          </div>
          {godowns.length === 0 && <p style={{ color: "var(--snm-warning)", fontSize: 11, marginTop: 4 }}>No warehouses yet — add one in Settings.</p>}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button
            onClick={save}
            disabled={saving || !skuId || !qtyCartons || !fobPerCarton || !godownId}
            style={{ ...primaryBtn, opacity: saving || !skuId || !qtyCartons || !fobPerCarton || !godownId ? 0.5 : 1, cursor: saving || !skuId || !qtyCartons || !fobPerCarton || !godownId ? "not-allowed" : "pointer" }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : editing ? "Save" : "Add Line"}
          </button>
        </div>
      </div>
    </div>
  );
}

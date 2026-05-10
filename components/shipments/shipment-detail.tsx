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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getShipment,
  listShipmentLines,
  updateShipment,
  deleteShipment,
  createShipmentLine,
  updateShipmentLine,
  deleteShipmentLine,
  confirmGrn,
  voidGrn,
  forceVoidGrn,
  type ShipmentRow,
  type ShipmentLineRow,
  type FobCurrency,
  type ShipmentStatus,
} from "@/lib/queries/shipments";
import { listSkusFlat, type SkuFullRow, getCurrentUserRole } from "@/lib/queries/products";
import { listSuppliers, listGodowns, type SupplierRow, type GodownRow } from "@/lib/queries/masters";

const STATUS_LABEL: Record<ShipmentStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  in_transit: "In Transit",
  arrived: "Arrived",
  grn_confirmed: "Locked / Received",
};

export function ShipmentDetail({ id }: { id: string }) {
  const router = useRouter();
  const [shipment, setShipment] = useState<ShipmentRow | null>(null);
  const [lines, setLines] = useState<ShipmentLineRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [deleteShipmentDialog, setDeleteShipmentDialog] = useState(false);
  const [deletingShipment, setDeletingShipment] = useState(false);
  const [voidDialog, setVoidDialog] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [deleteLineDialog, setDeleteLineDialog] = useState<ShipmentLineRow | null>(null);
  const [deletingLine, setDeletingLine] = useState(false);
  const [lineDialog, setLineDialog] = useState<{ open: boolean; editing?: ShipmentLineRow }>({ open: false });
  const [role, setRole] = useState<string | null>(null);

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
  const locked = shipment?.status === "grn_confirmed";

  // ── Live landed-cost preview ───────────────────────────────────────────
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
      const fobMvr = l.qty_cartons * l.fob_per_carton * fxToMvr;
      const cbmShare = (l.qty_cartons * l.cbm_per_carton) / totalCbm;
      const apportioned = cbmShare * poolMvr;
      const lineTotal = fobMvr + apportioned;
      const perCarton = lineTotal / l.qty_cartons;
      const perPack = sku ? perCarton / sku.packs_per_carton : 0;
      const perPiece = sku ? perPack / sku.pcs_per_pack : 0;
      return { line: l, sku, fobMvr, apportioned, lineTotal, perCarton, perPack, perPiece };
    });

    const grandTotal = linesPreview.reduce((acc, p) => acc + p.lineTotal, 0);
    return { totalCbm, freightMvr, localMvr, poolMvr, lines: linesPreview, grandTotal };
  }, [shipment, lines, skus]);

  // ── Header changes ─────────────────────────────────────────────────────
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
      await confirmGrn(shipment.id);
      toast.success("GRN confirmed — stock is now live");
      setConfirmDialog(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading shipment…</p>
      </div>
    );
  }

  if (!shipment) {
    return (
      <div className="glass p-12 text-center text-muted-foreground">
        Shipment not found.
        <div className="mt-4">
          <Link href="/shipments" className="text-primary text-sm hover:underline">Back to shipments</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/shipments"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Shipment</p>
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground truncate">{shipment.reference}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {locked && (
            <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider rounded px-2 py-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
              <Lock className="h-3 w-3" /> Locked
            </span>
          )}
          {isAdmin && locked && (
            <button
              onClick={() => setVoidDialog(true)}
              className="p-2 rounded-lg text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
              title="Void GRN & delete (admin)"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {isAdmin && !locked && (
            <button
              onClick={() => setDeleteShipmentDialog(true)}
              className="p-2 rounded-lg text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
              title="Delete (admin)"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Header card */}
      <div className="glass p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-foreground">Header</h2>
          {!locked && (
            <Select
              value={shipment.status}
              onValueChange={(v) => v && patch("status", v as ShipmentStatus)}
            >
              <SelectTrigger className="w-[180px] h-9 text-xs">
                <SelectValue>{STATUS_LABEL[shipment.status]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABEL) as ShipmentStatus[])
                  .filter((s) => s !== "grn_confirmed")
                  .map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Supplier</Label>
            <Select
              value={shipment.supplier_id ?? ""}
              onValueChange={(v) => v && patch("supplier_id", v)}
            >
              <SelectTrigger disabled={locked}>
                <SelectValue>{suppliers.find((s) => s.id === shipment.supplier_id)?.name ?? "—"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Input
              value={shipment.notes ?? ""}
              onChange={(e) => setShipment({ ...shipment, notes: e.target.value })}
              onBlur={(e) => patch("notes", e.target.value || null)}
              disabled={locked}
              placeholder="Optional"
            />
          </div>
        </div>

        {/* Forex */}
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Forex Rates (locked at GRN)</p>
          <p className="text-[11px] text-muted-foreground -mt-2">Enter rates as your bank quotes them. The system handles the conversion.</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* 1 USD = X IDR — stored as IDR→USD = 1/X */}
            <NumberField
              label="1 USD = ___ IDR *"
              value={
                shipment.rate_idr_to_usd && shipment.rate_idr_to_usd > 0
                  ? Math.round(1 / shipment.rate_idr_to_usd)
                  : null
              }
              onChange={async (usdToIdr) => {
                if (!usdToIdr || usdToIdr <= 0) {
                  await patch("rate_idr_to_usd", null);
                  await patch("rate_idr_to_mvr", null);
                  return;
                }
                const idrToUsd = 1 / usdToIdr;
                await patch("rate_idr_to_usd", idrToUsd);
                // Recompute IDR→MVR = USD→MVR ÷ USD→IDR
                const usdMvr = shipment.rate_usd_to_mvr;
                if (usdMvr) await patch("rate_idr_to_mvr", usdMvr / usdToIdr);
              }}
              disabled={locked}
              step="1"
              hint="e.g. 16420"
            />

            {/* 1 USD = Y MVR — stored as-is */}
            <NumberField
              label="1 USD = ___ MVR *"
              value={shipment.rate_usd_to_mvr}
              onChange={async (usdMvr) => {
                await patch("rate_usd_to_mvr", usdMvr);
                // Recompute IDR→MVR = USD→MVR ÷ USD→IDR
                const idrUsd = shipment.rate_idr_to_usd;
                if (idrUsd && idrUsd > 0 && usdMvr) {
                  await patch("rate_idr_to_mvr", usdMvr * idrUsd);
                  // (idrUsd is already 1/usdToIdr, so multiplying gives MVR per IDR)
                }
              }}
              disabled={locked}
              step="0.01"
              hint="e.g. 15.42"
            />

            {/* Derived: 1 IDR = ___ MVR */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">1 IDR = ___ MVR (auto)</Label>
              <Input
                type="text"
                value={
                  shipment.rate_idr_to_mvr !== null && shipment.rate_idr_to_mvr !== undefined
                    ? shipment.rate_idr_to_mvr.toFixed(8)
                    : ""
                }
                disabled
                className="bg-muted/50 text-foreground font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                = (USD→MVR) ÷ (USD→IDR)
              </p>
            </div>
          </div>
        </div>

        {/* Freight */}
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Freight</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={shipment.shared_container}
                  onChange={(e) => patch("shared_container", e.target.checked)}
                  disabled={locked}
                  className="h-4 w-4 rounded border-border"
                />
                Shared container
              </Label>
            </div>
            {shipment.shared_container && (
              <NumberField
                label="Total container freight (USD)"
                value={shipment.total_container_freight_usd}
                onChange={(v) => patch("total_container_freight_usd", v)}
                disabled={locked}
                hint="Reference only"
              />
            )}
          </div>
          <NumberField
            label="My share of freight (USD) *"
            value={shipment.my_freight_share_usd}
            onChange={(v) => patch("my_freight_share_usd", v ?? 0)}
            disabled={locked}
            hint="The amount you actually pay. Negotiated with partner."
            required
          />
          <Textarea
            value={shipment.freight_share_notes ?? ""}
            onChange={(e) => setShipment({ ...shipment, freight_share_notes: e.target.value })}
            onBlur={(e) => patch("freight_share_notes", e.target.value || null)}
            disabled={locked}
            placeholder="How was the share calculated? (optional)"
            className="min-h-[50px] text-sm"
          />
        </div>

        {/* Local costs */}
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Local Costs (MVR)</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <NumberField label="Customs Duty"   value={shipment.customs_duty_mvr} onChange={(v) => patch("customs_duty_mvr", v ?? 0)} disabled={locked} />
            <NumberField label="MPL / Port"     value={shipment.mpl_charges_mvr}  onChange={(v) => patch("mpl_charges_mvr",  v ?? 0)} disabled={locked} />
            <NumberField label="Agent Fee"      value={shipment.agent_fee_mvr}    onChange={(v) => patch("agent_fee_mvr",    v ?? 0)} disabled={locked} />
            <NumberField label="Last Mile"      value={shipment.last_mile_mvr}    onChange={(v) => patch("last_mile_mvr",    v ?? 0)} disabled={locked} />
            <NumberField label="Insurance"      value={shipment.insurance_mvr}    onChange={(v) => patch("insurance_mvr",    v ?? 0)} disabled={locked} />
            <NumberField label="Other"          value={shipment.other_mvr}        onChange={(v) => patch("other_mvr",        v ?? 0)} disabled={locked} />
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="glass p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium text-foreground">Line items</h2>
            <p className="text-xs text-muted-foreground">{lines.length} line{lines.length === 1 ? "" : "s"}</p>
          </div>
          {!locked && (
            <Button onClick={() => setLineDialog({ open: true })} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Line
            </Button>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No lines yet.</p>
        ) : (
          <div className="space-y-2">
            {lines.map((l) => {
              const sku = skus.find((s) => s.id === l.sku_id);
              const godown = godowns.find((g) => g.id === l.destination_godown_id);
              const livePer = preview?.lines.find((p) => p.line.id === l.id);
              return (
                <div key={l.id} className="glass-flat p-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">
                        {sku?.full_path ?? "Unknown SKU"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {l.qty_cartons} ctn · {l.fob_per_carton.toLocaleString()} {l.fob_currency}/ctn
                        · {Number(l.cbm_per_carton).toFixed(4)} CBM
                        {godown && <> · → {godown.name}</>}
                      </p>
                    </div>
                    {!locked && (
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => setLineDialog({ open: true, editing: l })}
                          className="text-xs text-primary hover:opacity-80 px-2"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteLineDialog(l)}
                          className="text-xs text-red-500 hover:opacity-80 px-2"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  {livePer && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-2 border-t border-border">
                      <div>
                        <span className="text-muted-foreground">Total: </span>
                        <span className="text-foreground">{livePer.lineTotal.toFixed(0)} MVR</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">/ctn: </span>
                        <span className="text-foreground">{livePer.perCarton.toFixed(0)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">/pack: </span>
                        <span className="text-foreground">{livePer.perPack.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">/piece: </span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">{livePer.perPiece.toFixed(3)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live preview totals */}
      {preview && (
        <div className="glass p-5 space-y-3">
          <h2 className="text-base font-medium text-foreground">Cost preview</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Total CBM" value={preview.totalCbm.toFixed(4)} />
            <Stat label="Freight (MVR)" value={preview.freightMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
            <Stat label="Local (MVR)" value={preview.localMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
            <Stat label="Total Landed (MVR)" value={preview.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} highlight />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Apportioned by CBM. FOB is direct-to-line. Confirm GRN to lock these numbers and create stock.
          </p>
        </div>
      )}

      {/* GRN action */}
      {!locked && (
        <div className="glass p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="space-y-1 flex-1">
              <h3 className="text-base font-medium text-foreground">Confirm Goods Receipt (GRN)</h3>
              <p className="text-xs text-muted-foreground">
                Locks forex rates and costs. Creates inventory batches in the destination godowns.
                Stock becomes available for sale immediately.
              </p>
            </div>
          </div>
          <Button
            onClick={() => setConfirmDialog(true)}
            disabled={!preview || lines.length === 0}
            className="w-full sm:w-auto"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Confirm GRN
          </Button>
        </div>
      )}

      {locked && (
        <div className="glass-flat p-4 flex items-start gap-3">
          <Truck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-foreground">Goods received and stock created.</p>
            <p className="text-xs text-muted-foreground">
              Confirmed {shipment.grn_confirmed_at ? new Date(shipment.grn_confirmed_at).toLocaleString() : ""}.
              Costs locked.
            </p>
          </div>
        </div>
      )}

      {/* Line dialog */}
      <LineDialog
        open={lineDialog.open}
        editing={lineDialog.editing}
        shipmentId={id}
        skus={skus}
        godowns={godowns}
        onOpenChange={(o) => setLineDialog({ open: o })}
        onSaved={load}
      />

      {/* Confirm GRN dialog */}
      <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Confirm GRN — irreversible</DialogTitle>
            </div>
            <DialogDescription>
              All forex rates and costs are locked permanently. Stock is created in the destination godowns and becomes available for sale.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="rounded-xl bg-secondary/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lines</span>
                <span className="text-foreground">{lines.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total CBM</span>
                <span className="text-foreground">{preview.totalCbm.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total landed (MVR)</span>
                <span className="text-foreground font-medium">{preview.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDialog(false)}>Cancel</Button>
            <Button onClick={handleConfirmGrn} disabled={confirming} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & lock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete shipment dialog */}
      <Dialog open={deleteShipmentDialog} onOpenChange={setDeleteShipmentDialog}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Delete shipment?</DialogTitle>
            </div>
            <DialogDescription>
              <strong>{shipment.reference}</strong> and all its lines will be permanently removed.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteShipmentDialog(false)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deletingShipment}
              onClick={async () => {
                setDeletingShipment(true);
                try {
                  await deleteShipment(shipment.id);
                  toast.success("Shipment deleted");
                  router.push("/shipments");
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setDeletingShipment(false);
                }
              }}
            >
              {deletingShipment ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void GRN dialog (admin, locked shipments only) */}
      <Dialog open={voidDialog} onOpenChange={setVoidDialog}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Void GRN &amp; delete shipment?</DialogTitle>
            </div>
            <DialogDescription>
              <strong>{shipment.reference}</strong> will be completely removed — all inventory batches,
              stock movements, and any linked sales orders will be deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVoidDialog(false)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={voiding}
              onClick={async () => {
                setVoiding(true);
                try {
                  await forceVoidGrn(shipment.id);
                  toast.success("Shipment voided — all linked data deleted");
                  router.push("/shipments");
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setVoiding(false);
                }
              }}
            >
              {voiding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Void & delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete line dialog */}
      <Dialog open={!!deleteLineDialog} onOpenChange={(o) => { if (!o) setDeleteLineDialog(null); }}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Remove line?</DialogTitle>
            </div>
            <DialogDescription>
              {deleteLineDialog && (() => {
                const sku = skus.find((s) => s.id === deleteLineDialog.sku_id);
                return sku
                  ? <><strong>{sku.brand_name} › {sku.model_name} › {sku.variant_display}</strong> will be removed from this shipment.</>
                  : "This line will be permanently removed.";
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteLineDialog(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deletingLine}
              onClick={async () => {
                if (!deleteLineDialog) return;
                setDeletingLine(true);
                try {
                  await deleteShipmentLine(deleteLineDialog.id);
                  toast.success("Line removed");
                  setDeleteLineDialog(null);
                  load();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setDeletingLine(false);
                }
              }}
            >
              {deletingLine ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Number field with debounced commit ────────────────────────────────

function NumberField({
  label,
  value,
  onChange,
  disabled,
  step = "0.01",
  hint,
  required,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  step?: string;
  hint?: string;
  required?: boolean;
}) {
  const [local, setLocal] = useState<string>(value !== null && value !== undefined ? String(value) : "");
  useEffect(() => {
    setLocal(value !== null && value !== undefined ? String(value) : "");
  }, [value]);
  return (
    <div className="space-y-2">
      <Label>{label}{required ? " *" : ""}</Label>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const num = local === "" ? null : Number(local);
          // Only fire if the numeric value actually changed
          const prevNum = value !== null && value !== undefined ? Number(value) : null;
          if (num !== prevNum) onChange(num);
        }}
        disabled={disabled}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="glass-flat p-3 rounded-xl">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-lg font-semibold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

// ── Line dialog ───────────────────────────────────────────────────────

function LineDialog({
  open, editing, shipmentId, skus, godowns, onOpenChange, onSaved,
}: {
  open: boolean;
  editing?: ShipmentLineRow;
  shipmentId: string;
  skus: SkuFullRow[];
  godowns: GodownRow[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [skuId, setSkuId] = useState("");
  const [qtyCartons, setQtyCartons] = useState("");
  const [fobPerCarton, setFobPerCarton] = useState("");
  const [fobCurrency, setFobCurrency] = useState<FobCurrency>("IDR");
  const [godownId, setGodownId] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      if (editing) {
        setSkuId(editing.sku_id);
        setQtyCartons(String(editing.qty_cartons));
        setFobPerCarton(String(editing.fob_per_carton));
        setFobCurrency(editing.fob_currency);
        setGodownId(editing.destination_godown_id);
      } else {
        setSkuId("");
        setQtyCartons("");
        setFobPerCarton("");
        setFobCurrency("IDR");
        setGodownId(godowns.find((g) => g.is_default)?.id ?? godowns[0]?.id ?? "");
      }
      setSearch("");
    }
  }, [open, editing, godowns]);

  const sku = skus.find((s) => s.id === skuId);

  const filteredSkus = useMemo(() => {
    const term = search.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    if (!term) return active.slice(0, 50);
    return active
      .filter((s) =>
        [s.brand_name, s.model_name, s.variant_display, s.internal_code].join(" ").toLowerCase().includes(term),
      )
      .slice(0, 50);
  }, [skus, search]);

  async function save() {
    if (!skuId || !qtyCartons || !fobPerCarton || !godownId) return;
    if (!sku) { toast.error("Pick a SKU"); return; }
    const parsedQty = parseInt(qtyCartons, 10);
    if (isNaN(parsedQty) || parsedQty < 1) { toast.error("Qty must be at least 1 carton"); return; }
    const parsedFob = parseFloat(fobPerCarton);
    if (isNaN(parsedFob) || parsedFob <= 0) { toast.error("FOB price must be greater than zero"); return; }
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
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit line" : "New line"}</DialogTitle>
          <DialogDescription>
            FOB is per carton in the supplier&apos;s currency. CBM is taken from the SKU.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          {/* SKU picker */}
          <div className="space-y-2">
            <Label>Product (SKU) *</Label>
            {!skuId ? (
              <>
                <Input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by brand, model, code…"
                />
                <div className="rounded-xl border border-border max-h-[240px] overflow-y-auto bg-background/50">
                  {filteredSkus.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-3 py-2">No SKUs match.</p>
                  ) : (
                    filteredSkus.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSkuId(s.id)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent/30 transition border-b border-border last:border-0"
                      >
                        <p className="text-foreground">{s.brand_name} › {s.model_name} › {s.variant_display}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn · {Number(s.cbm_per_carton).toFixed(4)} CBM · {s.internal_code}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : sku ? (
              <div className="rounded-xl border border-border p-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{sku.brand_name} › {sku.model_name} › {sku.variant_display}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn · {Number(sku.cbm_per_carton).toFixed(4)} CBM
                  </p>
                </div>
                <button onClick={() => setSkuId("")} className="text-xs text-primary hover:opacity-80 shrink-0">
                  Change
                </button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Qty cartons *</Label>
              <Input type="number" inputMode="numeric" min="1" step="1" value={qtyCartons} onChange={(e) => setQtyCartons(e.target.value)} placeholder="50" />
            </div>
            <div className="space-y-2">
              <Label>FOB per carton *</Label>
              <div className="flex gap-2">
                <Input type="number" inputMode="decimal" step="0.01" value={fobPerCarton} onChange={(e) => setFobPerCarton(e.target.value)} className="flex-1" />
                <Select value={fobCurrency} onValueChange={(v) => v && setFobCurrency(v as FobCurrency)}>
                  <SelectTrigger className="w-24"><SelectValue>{fobCurrency}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IDR">IDR</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="MVR">MVR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Destination Godown *</Label>
            <Select value={godownId} onValueChange={(v) => v && setGodownId(v)}>
              <SelectTrigger>
                <SelectValue>{godowns.find((g) => g.id === godownId)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {godowns.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}{g.is_default ? " (default)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {godowns.length === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">No godowns yet — add one in Settings.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={save}
            disabled={saving || !skuId || !qtyCartons || !fobPerCarton || !godownId}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Add line"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

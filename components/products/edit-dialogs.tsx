"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
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
  updateBrand,
  updateModel,
  updateVariant,
  updateSku,
  adminDeleteBrandCascade,
  adminDeleteModelCascade,
  adminDeleteVariantCascade,
  adminDeleteSku,
  type BrandRow,
  type ModelRow,
  type VariantRow,
  type SkuRow,
  type SkuFullRow,
  type CategoryRow,
  type AttrKey,
} from "@/lib/queries/products";

// ── Brand editor ────────────────────────────────────────────────────────

export function EditBrandDialog({
  brand,
  open,
  onOpenChange,
  onSaved,
}: {
  brand: BrandRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && brand) {
      setName(brand.name);
      setNotes(brand.notes ?? "");
    }
  }, [open, brand]);

  async function save() {
    if (!brand || !name.trim()) return;
    setSaving(true);
    try {
      await updateBrand(brand.id, { name: name.trim(), notes: notes.trim() || null });
      toast.success("Saved");
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
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle>Edit Brand</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Model editor ────────────────────────────────────────────────────────

export function EditModelDialog({
  model,
  categories,
  open,
  onOpenChange,
  onSaved,
}: {
  model: ModelRow | null;
  categories: CategoryRow[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [catId, setCatId] = useState("");
  const [hs, setHs] = useState("");
  const [duty, setDuty] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && model) {
      setName(model.name);
      setCatId(model.category_id);
      setHs(model.hs_code ?? "");
      setDuty(model.duty_rate_pct?.toString() ?? "");
    }
  }, [open, model]);

  async function save() {
    if (!model || !name.trim() || !catId) return;
    setSaving(true);
    try {
      await updateModel(model.id, {
        name: name.trim(),
        category_id: catId,
        hs_code: hs.trim() || null,
        duty_rate_pct: duty ? parseFloat(duty) : null,
      });
      toast.success("Saved");
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
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle>Edit Model</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Category *</Label>
            <Select value={catId} onValueChange={(v) => v && setCatId(v)}>
              <SelectTrigger>
                <SelectValue>{categories.find((c) => c.id === catId)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>HS Code</Label>
              <Input value={hs} onChange={(e) => setHs(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Duty %</Label>
              <Input type="number" step="0.01" value={duty} onChange={(e) => setDuty(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim() || !catId}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Variant editor (category-driven attributes) ─────────────────────────

const ATTR_LABELS: Record<AttrKey, string> = {
  size: "Size",
  scent: "Scent",
  format: "Format",
  volume_ml: "Volume (ml)",
  weight_g: "Weight (g)",
  colour: "Colour",
  other: "Other",
};

export function EditVariantDialog({
  variant,
  category,
  open,
  onOpenChange,
  onSaved,
}: {
  variant: VariantRow | null;
  category?: CategoryRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [display, setDisplay] = useState("");
  const [saving, setSaving] = useState(false);

  const schema: AttrKey[] = useMemo(
    () => (category?.variant_attributes ?? []) as AttrKey[],
    [category],
  );

  useEffect(() => {
    if (open && variant) {
      const fromDb: Record<string, string> = {};
      Object.entries(variant.attributes).forEach(([k, v]) => { fromDb[k] = String(v); });
      setAttrs(fromDb);
      setDisplay(variant.display_name);
    }
  }, [open, variant]);

  async function save() {
    if (!variant || !display.trim()) return;
    const cleaned: Record<string, string | number> = {};
    for (const k of schema.length > 0 ? schema : Object.keys(attrs)) {
      const v = attrs[k];
      if (v === undefined || v.trim() === "") continue;
      cleaned[k] = /^[0-9.]+$/.test(v) ? Number(v) : v.trim();
    }
    setSaving(true);
    try {
      await updateVariant(variant.id, { display_name: display.trim(), attributes: cleaned });
      toast.success("Saved");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const keys = schema.length > 0 ? schema : (Object.keys(attrs) as AttrKey[]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Variant</DialogTitle>
          {category && <DialogDescription>Category: {category.name}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          {keys.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {keys.map((k) => (
                <div key={k} className="space-y-2">
                  <Label>{ATTR_LABELS[k] ?? k}</Label>
                  <Input
                    value={attrs[k] ?? ""}
                    onChange={(e) => setAttrs({ ...attrs, [k]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <Label>Display name *</Label>
            <Input value={display} onChange={(e) => setDisplay(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !display.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── SKU (Pack) editor ───────────────────────────────────────────────────

export function EditSkuDialog({
  sku,
  open,
  onOpenChange,
  onSaved,
}: {
  sku: SkuFullRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState("");
  const [barcode, setBarcode] = useState("");
  const [pcsPerPack, setPcsPerPack] = useState("");
  const [packsPerCarton, setPacksPerCarton] = useState("");
  const [l, setL] = useState("");
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [kg, setKg] = useState("");
  const [marginPct, setMarginPct] = useState("");
  const [fixedPrice, setFixedPrice] = useState("");
  const [fixedPackPrice, setFixedPackPrice] = useState("");
  const [fixedCartonPrice, setFixedCartonPrice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && sku) {
      setCode(sku.internal_code);
      setBarcode(sku.supplier_barcode ?? "");
      setPcsPerPack(String(sku.pcs_per_pack));
      setPacksPerCarton(String(sku.packs_per_carton));
      setL(String(sku.carton_length_cm));
      setW(String(sku.carton_width_cm));
      setH(String(sku.carton_height_cm));
      setKg(sku.carton_weight_kg?.toString() ?? "");
      setMarginPct(sku.target_margin_pct?.toString() ?? "");
      setFixedPrice(sku.fixed_selling_price_mvr?.toString() ?? "");
      setFixedPackPrice(sku.fixed_price_per_pack_mvr?.toString() ?? "");
      setFixedCartonPrice(sku.fixed_price_per_carton_mvr?.toString() ?? "");
    }
  }, [open, sku]);

  const cbm = useMemo(() => {
    const lv = parseFloat(l), wv = parseFloat(w), hv = parseFloat(h);
    if (!lv || !wv || !hv) return null;
    return (lv * wv * hv) / 1_000_000;
  }, [l, w, h]);

  const landedPerPiece = sku?.landed_per_piece_mvr ?? null;
  const pcs = parseInt(pcsPerPack, 10);
  const packs = parseInt(packsPerCarton, 10);

  // Preview from margin formula
  const marginPreview = useMemo(() => {
    const margin = parseFloat(marginPct);
    if (!landedPerPiece || isNaN(margin) || margin <= 0 || margin >= 100) return null;
    const perPiece = landedPerPiece / (1 - margin / 100);
    return {
      piece: perPiece,
      pack: perPiece * (isNaN(pcs) ? 0 : pcs),
      carton: perPiece * (isNaN(pcs) ? 0 : pcs) * (isNaN(packs) ? 0 : packs),
    };
  }, [marginPct, landedPerPiece, pcs, packs]);

  // Preview from fixed price
  const fixedPreview = useMemo(() => {
    const fp = parseFloat(fixedPrice);
    if (isNaN(fp) || fp <= 0) return null;
    const actualMargin = landedPerPiece && landedPerPiece > 0
      ? ((1 - landedPerPiece / fp) * 100)
      : null;
    return {
      piece: fp,
      pack: fp * (isNaN(pcs) ? 0 : pcs),
      carton: fp * (isNaN(pcs) ? 0 : pcs) * (isNaN(packs) ? 0 : packs),
      actualMargin,
    };
  }, [fixedPrice, landedPerPiece, pcs, packs]);

  // Which pricing method is active?
  const usingFixed = fixedPrice.trim() !== "";

  async function save() {
    if (!sku) return;
    setSaving(true);
    try {
      await updateSku(sku.id, {
        internal_code: code.trim(),
        supplier_barcode: barcode.trim() || null,
        pcs_per_pack: parseInt(pcsPerPack, 10),
        packs_per_carton: parseInt(packsPerCarton, 10),
        carton_length_cm: parseFloat(l),
        carton_width_cm: parseFloat(w),
        carton_height_cm: parseFloat(h),
        carton_weight_kg: kg ? parseFloat(kg) : null,
        target_margin_pct: marginPct ? parseFloat(marginPct) : null,
        fixed_selling_price_mvr: fixedPrice ? parseFloat(fixedPrice) : null,
        fixed_price_per_pack_mvr: fixedPackPrice ? parseFloat(fixedPackPrice) : null,
        fixed_price_per_carton_mvr: fixedCartonPrice ? parseFloat(fixedCartonPrice) : null,
      });
      toast.success("Saved");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const unit = (sku?.attributes as Record<string, string> | undefined)?.format || "Pc";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-xl overflow-y-auto max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle>Edit Pack Configuration</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">

          {/* ── Current live prices (read-only summary) ── */}
          {sku?.landed_per_piece_mvr != null && (
            <div className="rounded-xl p-3 space-y-2"
              style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)", border: "1px solid var(--glass-border-lo)" }}>
              <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--muted-foreground)" }}>
                Current landed cost
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] font-bold text-foreground">
                  MVR {Number(sku.landed_per_piece_mvr).toFixed(4)}
                </span>
                <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>per {unit.toLowerCase()}</span>
              </div>
              {sku.selling_price_per_piece_mvr != null && (
                <div className="pt-2 border-t" style={{ borderColor: "var(--glass-border-lo)" }}>
                  <p className="text-[11px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: "var(--muted-foreground)" }}>
                    Active selling prices
                    {sku.fixed_selling_price_mvr != null
                      ? <span className="ml-2 px-1.5 py-0.5 rounded text-[9px]" style={{ background: "color-mix(in srgb, var(--snm-brand) 15%, transparent)", color: "var(--snm-brand)" }}>FIXED</span>
                      : <span className="ml-2 px-1.5 py-0.5 rounded text-[9px]" style={{ background: "color-mix(in srgb, var(--snm-success) 15%, transparent)", color: "var(--snm-success)" }}>AUTO</span>
                    }
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    {[
                      { label: `Per ${unit.toLowerCase()}`, value: Number(sku.selling_price_per_piece_mvr).toFixed(2) },
                      { label: "Per pack",   value: Number(sku.selling_price_per_pack_mvr).toFixed(2) },
                      { label: "Per carton", value: Number(sku.selling_price_per_carton_mvr).toFixed(2) },
                    ].map((c) => (
                      <div key={c.label} className="text-center">
                        <p className="text-[9px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
                        <p className="font-semibold text-foreground text-[13px]">MVR {c.value}</p>
                      </div>
                    ))}
                  </div>
                  {sku.fixed_selling_price_mvr != null && sku.actual_margin_pct != null && (
                    <p className="text-[11px] mt-1.5 pt-1.5 border-t" style={{ borderColor: "var(--glass-border-lo)", color: "var(--muted-foreground)" }}>
                      Actual margin on current cost: <strong style={{ color: "var(--snm-success)" }}>{sku.actual_margin_pct}%</strong>
                    </p>
                  )}
                  {sku.fixed_selling_price_mvr == null && sku.target_margin_pct != null && (
                    <p className="text-[11px] mt-1.5 pt-1.5 border-t" style={{ borderColor: "var(--glass-border-lo)", color: "var(--muted-foreground)" }}>
                      Target margin: {sku.target_margin_pct}% — price updates automatically with each shipment
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Pack config */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{unit}s per Pack *</Label>
              <Input type="number" min="1" value={pcsPerPack} onChange={(e) => setPcsPerPack(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Packs per Carton *</Label>
              <Input type="number" min="1" value={packsPerCarton} onChange={(e) => setPacksPerCarton(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Carton Dimensions (cm) *</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input type="number" step="0.1" value={l} onChange={(e) => setL(e.target.value)} placeholder="L" />
              <Input type="number" step="0.1" value={w} onChange={(e) => setW(e.target.value)} placeholder="W" />
              <Input type="number" step="0.1" value={h} onChange={(e) => setH(e.target.value)} placeholder="H" />
            </div>
            {cbm !== null && (
              <p className="text-[11px]" style={{ color: "var(--snm-success)" }}>→ {cbm.toFixed(5)} CBM per carton</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Carton Weight (kg)</Label>
              <Input type="number" step="0.01" value={kg} onChange={(e) => setKg(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Supplier Barcode</Label>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Internal Code *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>

          {/* ── Pricing section ── */}
          <div className="border-t border-border pt-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Pricing</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                Use margin % (price auto-updates with cost) or set a fixed price per {unit.toLowerCase()} (overrides margin).
              </p>
            </div>

            {/* Option A: Target margin */}
            <div className="space-y-2">
              <Label>
                Option A — Target Margin %
                {!usingFixed && marginPct && (
                  <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: "color-mix(in srgb, var(--snm-success) 15%, transparent)", color: "var(--snm-success)" }}>
                    ACTIVE
                  </span>
                )}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" inputMode="decimal" step="0.5" min="1" max="99"
                  value={marginPct}
                  onChange={(e) => setMarginPct(e.target.value)}
                  placeholder="e.g. 30"
                  className="max-w-[120px]"
                  disabled={usingFixed}
                />
                <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>%</span>
                {usingFixed && (
                  <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    (overridden by fixed price below)
                  </span>
                )}
              </div>
              {marginPreview && !usingFixed && (
                <div className="rounded-lg p-2.5 grid grid-cols-3 gap-2 text-center"
                  style={{ background: "color-mix(in srgb, var(--snm-success) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
                  {[
                    { label: `Per ${unit.toLowerCase()}`, value: marginPreview.piece.toFixed(2) },
                    { label: "Per pack",   value: marginPreview.pack.toFixed(2) },
                    { label: "Per carton", value: marginPreview.carton.toFixed(2) },
                  ].map((c) => (
                    <div key={c.label}>
                      <p className="text-[9px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
                      <p className="text-[13px] font-semibold text-foreground">MVR {c.value}</p>
                    </div>
                  ))}
                </div>
              )}
              {!marginPreview && !usingFixed && landedPerPiece && marginPct && (
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  Enter a valid margin (1–99%) to preview prices.
                </p>
              )}
            </div>

            {/* Option B: Fixed price */}
            <div className="space-y-2">
              <Label>
                Option B — Fixed Price per {unit} (MVR)
                {usingFixed && (
                  <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: "color-mix(in srgb, var(--snm-brand) 15%, transparent)", color: "var(--snm-brand)" }}>
                    ACTIVE
                  </span>
                )}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" inputMode="decimal" step="0.01" min="0.01"
                  value={fixedPrice}
                  onChange={(e) => setFixedPrice(e.target.value)}
                  placeholder="e.g. 4.50"
                  className="max-w-[140px]"
                />
                <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>MVR / {unit.toLowerCase()}</span>
                {fixedPrice && (
                  <button
                    type="button"
                    onClick={() => setFixedPrice("")}
                    className="text-[11px] underline"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {fixedPreview && (
                <div className="rounded-lg p-2.5 space-y-2"
                  style={{ background: "color-mix(in srgb, var(--snm-brand) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-brand) 18%, transparent)" }}>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: `Per ${unit.toLowerCase()}`, value: fixedPreview.piece.toFixed(2) },
                      { label: "Per pack",   value: fixedPreview.pack.toFixed(2) },
                      { label: "Per carton", value: fixedPreview.carton.toFixed(2) },
                    ].map((c) => (
                      <div key={c.label}>
                        <p className="text-[9px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
                        <p className="text-[13px] font-semibold text-foreground">MVR {c.value}</p>
                      </div>
                    ))}
                  </div>
                  {fixedPreview.actualMargin != null && (
                    <p className="text-[11px] pt-1.5 border-t text-center"
                      style={{ borderColor: "color-mix(in srgb, var(--snm-brand) 20%, transparent)", color: fixedPreview.actualMargin >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                      Actual margin on current cost: <strong>{fixedPreview.actualMargin.toFixed(1)}%</strong>
                      {fixedPreview.actualMargin < 0 && " — ⚠ below cost!"}
                    </p>
                  )}
                  {!landedPerPiece && (
                    <p className="text-[11px] pt-1 border-t" style={{ borderColor: "color-mix(in srgb, var(--snm-brand) 20%, transparent)", color: "var(--muted-foreground)" }}>
                      Margin % visible after first shipment is confirmed.
                    </p>
                  )}
                </div>
              )}
            </div>

            {!landedPerPiece && !fixedPrice && (
              <p className="text-[11px]" style={{ color: "var(--snm-warning)" }}>
                No stock received yet — margin preview available after first GRN. You can set pricing now.
              </p>
            )}
          </div>

          {/* ── Volume-break pricing ── */}
          <div className="border-t border-border pt-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Volume-Break Pricing</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                Optional — set a lower price for pack or carton buyers. Overrides the base price above for that unit only.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Fixed pack price */}
              <div className="space-y-1.5">
                <Label className="text-[12px]">Pack price (MVR)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" inputMode="decimal" step="0.01" min="0.01"
                    value={fixedPackPrice}
                    onChange={(e) => setFixedPackPrice(e.target.value)}
                    placeholder={marginPreview ? `Auto: ${marginPreview.pack.toFixed(2)}` : "e.g. 88.00"}
                  />
                </div>
                {fixedPackPrice && landedPerPiece && pcs > 0 && (
                  <p className="text-[11px]" style={{ color: "var(--snm-success)" }}>
                    MVR {(parseFloat(fixedPackPrice) / pcs).toFixed(2)}/pc · {(((parseFloat(fixedPackPrice) - landedPerPiece * pcs) / parseFloat(fixedPackPrice)) * 100).toFixed(1)}% margin
                  </p>
                )}
              </div>
              {/* Fixed carton price */}
              <div className="space-y-1.5">
                <Label className="text-[12px]">Carton price (MVR)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" inputMode="decimal" step="0.01" min="0.01"
                    value={fixedCartonPrice}
                    onChange={(e) => setFixedCartonPrice(e.target.value)}
                    placeholder={marginPreview && packs > 0 ? `Auto: ${(marginPreview.pack * packs).toFixed(2)}` : "e.g. 320.00"}
                  />
                </div>
                {fixedCartonPrice && landedPerPiece && pcs > 0 && packs > 0 && (
                  <p className="text-[11px]" style={{ color: "var(--snm-success)" }}>
                    MVR {(parseFloat(fixedCartonPrice) / (pcs * packs)).toFixed(2)}/pc · {(((parseFloat(fixedCartonPrice) - landedPerPiece * pcs * packs) / parseFloat(fixedCartonPrice)) * 100).toFixed(1)}% margin
                  </p>
                )}
              </div>
            </div>
            {(fixedPackPrice || fixedCartonPrice) && (
              <div className="rounded-lg px-3 py-2" style={{ background: "color-mix(in srgb, var(--snm-success) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
                <p className="text-[11px]" style={{ color: "var(--snm-success)" }}>
                  Volume-break active — customers buying
                  {fixedPackPrice ? ` packs get MVR ${parseFloat(fixedPackPrice).toFixed(2)}/pack` : ""}
                  {fixedPackPrice && fixedCartonPrice ? " ·" : ""}
                  {fixedCartonPrice ? ` cartons get MVR ${parseFloat(fixedCartonPrice).toFixed(2)}/carton` : ""}
                </p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !code.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Cascade-delete confirmation (admin only) ────────────────────────────

export type CascadeTarget =
  | { kind: "brand";   id: string; label: string }
  | { kind: "model";   id: string; label: string }
  | { kind: "variant"; id: string; label: string }
  | { kind: "sku";     id: string; label: string };

export function CascadeDeleteDialog({
  target,
  open,
  onOpenChange,
  onDone,
}: {
  target: CascadeTarget | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setConfirmText(""); }, [open]);

  if (!target) return null;

  const matches = confirmText.trim().toLowerCase() === target.label.toLowerCase();

  async function go() {
    if (!target) return;
    setBusy(true);
    try {
      if (target.kind === "brand")        await adminDeleteBrandCascade(target.id);
      else if (target.kind === "model")   await adminDeleteModelCascade(target.id);
      else if (target.kind === "variant") await adminDeleteVariantCascade(target.id);
      else if (target.kind === "sku")     await adminDeleteSku(target.id);
      toast.success("Deleted");
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}>
              <AlertTriangle className="h-4 w-4" />
            </div>
            <DialogTitle>Delete {target.kind}</DialogTitle>
          </div>
          <DialogDescription>
            This will permanently delete <strong className="text-foreground">{target.label}</strong> and
            everything beneath it. This action is logged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs">Type the name to confirm:</Label>
          <Input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={target.label}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={go}
            disabled={!matches || busy}
            style={{ background: "var(--snm-error)", color: "var(--background)" }} className="disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Delete ${target.kind}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

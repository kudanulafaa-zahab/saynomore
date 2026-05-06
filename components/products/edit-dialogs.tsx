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
  sku: SkuRow | null;
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
    }
  }, [open, sku]);

  const cbm = useMemo(() => {
    const lv = parseFloat(l), wv = parseFloat(w), hv = parseFloat(h);
    if (!lv || !wv || !hv) return null;
    return (lv * wv * hv) / 1_000_000;
  }, [l, w, h]);

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
      <DialogContent className="bg-popover border-border max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Pack Configuration</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Pcs per Pack *</Label>
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
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400">→ {cbm.toFixed(5)} CBM per carton</p>
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
            <div className="h-9 w-9 rounded-xl bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-red-500" />
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
            className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Delete ${target.kind}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

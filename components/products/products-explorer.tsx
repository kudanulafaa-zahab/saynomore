"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  Package,
  Boxes,
  Tag,
  Droplet,
  Box,
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
  listBrands,
  listModels,
  listVariants,
  listSkus,
  createBrand,
  createModel,
  createVariant,
  createSku,
  deleteBrand,
  deleteModel,
  deleteVariant,
  toggleSkuActive,
  type BrandRow,
  type ModelRow,
  type VariantRow,
  type SkuRow,
  type ModelCategory,
  type CostBasis,
  type UnitUom,
} from "@/lib/queries/products";

// ── Helpers ──────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<ModelCategory, string> = {
  diaper: "Diapers / Hygiene",
  liquid: "Liquid (ml)",
  powder: "Powder (g)",
  pieces: "Pieces / Other",
};

const COST_BASIS_FOR: Record<ModelCategory, CostBasis> = {
  diaper: "piece",
  liquid: "per_100ml",
  powder: "per_100g",
  pieces: "piece",
};

const UOM_FOR: Record<ModelCategory, UnitUom> = {
  diaper: "pcs",
  liquid: "ml",
  powder: "g",
  pieces: "pcs",
};

function formatAttributes(attrs: Record<string, string | number>): string {
  return Object.entries(attrs)
    .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
    .join(" · ");
}

// ── Main explorer ────────────────────────────────────────────────────────

export function ProductsExplorer() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [openBrand, setOpenBrand] = useState<string | null>(null);
  const [openModel, setOpenModel] = useState<string | null>(null);
  const [openVariant, setOpenVariant] = useState<string | null>(null);

  const [brandDialog, setBrandDialog] = useState(false);
  const [modelDialog, setModelDialog] = useState<{ open: boolean; brandId?: string }>({ open: false });
  const [variantDialog, setVariantDialog] = useState<{ open: boolean; modelId?: string }>({ open: false });
  const [skuDialog, setSkuDialog] = useState<{ open: boolean; variantId?: string }>({ open: false });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [b, m, v, s] = await Promise.all([
        listBrands(),
        listModels(),
        listVariants(),
        listSkus(),
      ]);
      setBrands(b);
      setModels(m);
      setVariants(v);
      setSkus(s);
    } catch (err) {
      toast.error("Failed to load: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const totals = useMemo(() => {
    return {
      brands: brands.length,
      skus: skus.length,
      activeSkus: skus.filter((s) => s.is_active).length,
    };
  }, [brands, skus]);

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading catalogue…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-foreground">Catalogue</h2>
          <p className="text-sm text-muted-foreground">
            {totals.brands} brands · {totals.activeSkus} active SKUs
          </p>
        </div>
        <Button onClick={() => setBrandDialog(true)} className="font-medium">
          <Plus className="h-4 w-4 mr-2" />
          New Brand
        </Button>
      </div>

      {brands.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <Package className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-medium text-foreground">No brands yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Start by creating your first brand. Then add product lines (Models),
            variants (size/scent), and SKUs (specific pack/carton config).
          </p>
          <Button onClick={() => setBrandDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create first brand
          </Button>
        </div>
      ) : (
        brands.map((brand) => (
          <BrandCard
            key={brand.id}
            brand={brand}
            models={models.filter((m) => m.brand_id === brand.id)}
            variants={variants}
            skus={skus}
            isOpen={openBrand === brand.id}
            openModel={openModel}
            openVariant={openVariant}
            onToggle={() => setOpenBrand(openBrand === brand.id ? null : brand.id)}
            onToggleModel={(id) => setOpenModel(openModel === id ? null : id)}
            onToggleVariant={(id) => setOpenVariant(openVariant === id ? null : id)}
            onAddModel={() => setModelDialog({ open: true, brandId: brand.id })}
            onAddVariant={(modelId) => setVariantDialog({ open: true, modelId })}
            onAddSku={(variantId) => setSkuDialog({ open: true, variantId })}
            onDeleteBrand={async () => {
              if (!confirm(`Delete brand "${brand.name}"? Removes all its models, variants, and SKUs.`)) return;
              try { await deleteBrand(brand.id); toast.success("Deleted"); loadAll(); }
              catch (e) { toast.error((e as Error).message); }
            }}
            onDeleteModel={async (id) => {
              if (!confirm("Delete model and all its variants/SKUs?")) return;
              try { await deleteModel(id); toast.success("Deleted"); loadAll(); }
              catch (e) { toast.error((e as Error).message); }
            }}
            onDeleteVariant={async (id) => {
              if (!confirm("Delete variant and its SKUs?")) return;
              try { await deleteVariant(id); toast.success("Deleted"); loadAll(); }
              catch (e) { toast.error((e as Error).message); }
            }}
            onToggleSku={async (id, active) => {
              try { await toggleSkuActive(id, active); loadAll(); }
              catch (e) { toast.error((e as Error).message); }
            }}
          />
        ))
      )}

      <BrandDialog open={brandDialog} onOpenChange={setBrandDialog} onSaved={loadAll} />
      <ModelDialog
        open={modelDialog.open}
        brandId={modelDialog.brandId}
        brands={brands}
        onOpenChange={(o) => setModelDialog({ open: o })}
        onSaved={loadAll}
      />
      <VariantDialog
        open={variantDialog.open}
        modelId={variantDialog.modelId}
        models={models}
        brands={brands}
        onOpenChange={(o) => setVariantDialog({ open: o })}
        onSaved={loadAll}
      />
      <SkuDialog
        open={skuDialog.open}
        variantId={skuDialog.variantId}
        variants={variants}
        models={models}
        brands={brands}
        onOpenChange={(o) => setSkuDialog({ open: o })}
        onSaved={loadAll}
      />
    </div>
  );
}

// ── Brand card ───────────────────────────────────────────────────────────

function BrandCard({
  brand,
  models,
  variants,
  skus,
  isOpen,
  openModel,
  openVariant,
  onToggle,
  onToggleModel,
  onToggleVariant,
  onAddModel,
  onAddVariant,
  onAddSku,
  onDeleteBrand,
  onDeleteModel,
  onDeleteVariant,
  onToggleSku,
}: {
  brand: BrandRow;
  models: ModelRow[];
  variants: VariantRow[];
  skus: SkuRow[];
  isOpen: boolean;
  openModel: string | null;
  openVariant: string | null;
  onToggle: () => void;
  onToggleModel: (id: string) => void;
  onToggleVariant: (id: string) => void;
  onAddModel: () => void;
  onAddVariant: (modelId: string) => void;
  onAddSku: (variantId: string) => void;
  onDeleteBrand: () => void;
  onDeleteModel: (id: string) => void;
  onDeleteVariant: (id: string) => void;
  onToggleSku: (id: string, active: boolean) => void;
}) {
  const skuCount = skus.filter((s) =>
    variants.some(
      (v) => v.id === s.variant_id && models.some((m) => m.id === v.model_id),
    ),
  ).length;

  return (
    <div className="glass overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-accent/30 transition">
        <div className="flex items-center gap-3 sm:gap-4">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <Package className="h-5 w-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-base font-medium text-foreground">{brand.name}</p>
            <p className="text-xs text-muted-foreground">
              {models.length} models · {skuCount} SKUs
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteBrand();
            }}
            className="p-2 rounded-lg text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border p-3 sm:p-4 space-y-2 bg-secondary/30">
          <div className="flex items-center justify-between mb-1 px-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Models</p>
            <Button size="sm" variant="ghost" onClick={onAddModel} className="text-primary h-7">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Model
            </Button>
          </div>
          {models.length === 0 && <p className="text-xs text-muted-foreground px-2 py-3">No models yet.</p>}

          {models.map((model) => {
            const modelVariants = variants.filter((v) => v.model_id === model.id);
            return (
              <ModelRowCard
                key={model.id}
                model={model}
                variants={modelVariants}
                skus={skus}
                isOpen={openModel === model.id}
                openVariant={openVariant}
                onToggle={() => onToggleModel(model.id)}
                onToggleVariant={onToggleVariant}
                onAddVariant={() => onAddVariant(model.id)}
                onAddSku={onAddSku}
                onDelete={() => onDeleteModel(model.id)}
                onDeleteVariant={onDeleteVariant}
                onToggleSku={onToggleSku}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Model row ────────────────────────────────────────────────────────────

function ModelRowCard({
  model,
  variants,
  skus,
  isOpen,
  openVariant,
  onToggle,
  onToggleVariant,
  onAddVariant,
  onAddSku,
  onDelete,
  onDeleteVariant,
  onToggleSku,
}: {
  model: ModelRow;
  variants: VariantRow[];
  skus: SkuRow[];
  isOpen: boolean;
  openVariant: string | null;
  onToggle: () => void;
  onToggleVariant: (id: string) => void;
  onAddVariant: () => void;
  onAddSku: (variantId: string) => void;
  onDelete: () => void;
  onDeleteVariant: (id: string) => void;
  onToggleSku: (id: string, active: boolean) => void;
}) {
  const Icon = model.category === "liquid" ? Droplet : model.category === "powder" ? Box : Boxes;

  return (
    <div className="glass-flat overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-3 hover:bg-accent/30 transition">
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <div className="text-left">
            <p className="text-sm text-foreground">{model.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {CATEGORY_LABEL[model.category]} · {variants.length} variants
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 rounded text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border p-3 space-y-2 bg-background/30">
          <div className="flex items-center justify-between mb-1 px-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Variants</p>
            <Button size="sm" variant="ghost" onClick={onAddVariant} className="text-primary h-6 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              Variant
            </Button>
          </div>

          {variants.length === 0 && <p className="text-xs text-muted-foreground px-1 py-2">No variants yet.</p>}

          {variants.map((variant) => {
            const variantSkus = skus.filter((s) => s.variant_id === variant.id);
            return (
              <div key={variant.id} className="rounded-xl bg-card/50 border border-border overflow-hidden">
                <button
                  onClick={() => onToggleVariant(variant.id)}
                  className="w-full flex items-center justify-between p-2.5 hover:bg-accent/30 transition"
                >
                  <div className="flex items-center gap-2.5">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm text-foreground">{variant.display_name}</span>
                    <span className="text-xs text-muted-foreground">({variantSkus.length} SKU)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteVariant(variant.id);
                      }}
                      className="p-1 rounded text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${openVariant === variant.id ? "rotate-180" : ""}`} />
                  </div>
                </button>

                {openVariant === variant.id && (
                  <div className="border-t border-border p-2.5 space-y-1.5 bg-background/30">
                    <div className="flex items-center justify-between mb-1 px-1">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">SKUs</p>
                      <Button size="sm" variant="ghost" onClick={() => onAddSku(variant.id)} className="text-primary h-6 text-xs">
                        <Plus className="h-3 w-3 mr-1" />
                        SKU
                      </Button>
                    </div>

                    {variantSkus.length === 0 && <p className="text-xs text-muted-foreground px-1 py-2">No SKUs yet.</p>}

                    {variantSkus.map((sku) => (
                      <div
                        key={sku.id}
                        className="grid grid-cols-12 gap-2 items-center text-xs px-2.5 py-2 rounded-lg bg-card/40 border border-border"
                      >
                        <span className="col-span-3 text-foreground truncate" title={sku.internal_code}>
                          {sku.format ? `${sku.format} ` : ""}
                          {sku.unit_size}{sku.unit_uom}
                        </span>
                        <span className="col-span-2 text-muted-foreground">{sku.pcs_per_pack}/pk</span>
                        <span className="col-span-2 text-muted-foreground">{sku.packs_per_carton}/ctn</span>
                        <span className="col-span-2 text-muted-foreground">
                          {sku.pcs_per_pack * sku.packs_per_carton} pcs/ctn
                        </span>
                        <span className="col-span-2 text-muted-foreground">
                          {Number(sku.cbm_per_carton).toFixed(4)} CBM
                        </span>
                        <button
                          onClick={() => onToggleSku(sku.id, !sku.is_active)}
                          className={`col-span-1 text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 ${
                            sku.is_active ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {sku.is_active ? "On" : "Off"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Brand dialog ────────────────────────────────────────────────────────

function BrandDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setName(""); setNotes(""); } }, [open]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createBrand(name.trim(), notes.trim() || undefined);
      toast.success("Brand created");
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
          <DialogTitle>New Brand</DialogTitle>
          <DialogDescription>e.g. MamyPoko, Merries, Sosoft.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="MamyPoko" />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Model dialog ────────────────────────────────────────────────────────

function ModelDialog({
  open,
  brandId,
  brands,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  brandId?: string;
  brands: BrandRow[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ModelCategory>("diaper");
  const [hsCode, setHsCode] = useState("");
  const [dutyPct, setDutyPct] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(brandId ?? "");
      setName("");
      setCategory("diaper");
      setHsCode("");
      setDutyPct("");
    }
  }, [open, brandId]);

  async function save() {
    if (!name.trim() || !selected) return;
    setSaving(true);
    try {
      await createModel({
        brand_id: selected,
        name: name.trim(),
        category,
        hs_code: hsCode.trim() || null,
        duty_rate_pct: dutyPct ? parseFloat(dutyPct) : null,
      });
      toast.success("Model created");
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
          <DialogTitle>New Model / Product Line</DialogTitle>
          <DialogDescription>e.g. Xtra Kering, Royal Soft, Sosoft Mint.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Brand *</Label>
            <Select value={selected} onValueChange={(v) => v && setSelected(v)}>
              <SelectTrigger><SelectValue placeholder="Pick a brand" /></SelectTrigger>
              <SelectContent>
                {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Xtra Kering" />
          </div>
          <div className="space-y-2">
            <Label>Category *</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ModelCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABEL).map(([v, label]) => (
                  <SelectItem key={v} value={v}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Drives how SKUs are sized & how cost is reported.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>HS Code</Label>
              <Input value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Duty Rate %</Label>
              <Input type="number" step="0.01" value={dutyPct} onChange={(e) => setDutyPct(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim() || !selected}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Variant dialog (attribute-aware) ─────────────────────────────────────

function VariantDialog({
  open,
  modelId,
  models,
  brands,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  modelId?: string;
  models: ModelRow[];
  brands: BrandRow[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [size, setSize] = useState("");
  const [scent, setScent] = useState("");
  const [colour, setColour] = useState("");
  const [other, setOther] = useState("");
  const [displayOverride, setDisplayOverride] = useState("");
  const [saving, setSaving] = useState(false);

  const model = models.find((m) => m.id === selected);
  const brand = brands.find((b) => b.id === model?.brand_id);

  useEffect(() => {
    if (open) {
      setSelected(modelId ?? "");
      setSize(""); setScent(""); setColour(""); setOther(""); setDisplayOverride("");
    }
  }, [open, modelId]);

  function autoDisplay(): string {
    const parts: string[] = [];
    if (size) parts.push(size);
    if (scent) parts.push(scent);
    if (colour) parts.push(colour);
    if (other) parts.push(other);
    return parts.join(" / ");
  }

  async function save() {
    if (!selected) return;
    const attrs: Record<string, string> = {};
    if (size.trim())   attrs.size = size.trim();
    if (scent.trim())  attrs.scent = scent.trim();
    if (colour.trim()) attrs.colour = colour.trim();
    if (other.trim())  attrs.other = other.trim();
    if (Object.keys(attrs).length === 0) {
      toast.error("Enter at least one attribute (size, scent, etc).");
      return;
    }
    const display = displayOverride.trim() || autoDisplay();
    setSaving(true);
    try {
      await createVariant({ model_id: selected, attributes: attrs, display_name: display });
      toast.success("Variant created");
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
      <DialogContent className="bg-popover border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>New Variant</DialogTitle>
          <DialogDescription>
            e.g. for diapers: Size = M. For detergent: Scent = Mint.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Model *</Label>
            <Select value={selected} onValueChange={(v) => v && setSelected(v)}>
              <SelectTrigger><SelectValue placeholder="Pick a model" /></SelectTrigger>
              <SelectContent>
                {models.map((m) => {
                  const b = brands.find((br) => br.id === m.brand_id);
                  return <SelectItem key={m.id} value={m.id}>{b?.name} › {m.name}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>

          {model && (
            <p className="text-xs text-muted-foreground -mt-2">
              {brand?.name} › {model.name} · {CATEGORY_LABEL[model.category]}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Size</Label>
              <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="M, L, XL…" />
            </div>
            <div className="space-y-2">
              <Label>Scent</Label>
              <Input value={scent} onChange={(e) => setScent(e.target.value)} placeholder="Mint, Lemon…" />
            </div>
            <div className="space-y-2">
              <Label>Colour</Label>
              <Input value={colour} onChange={(e) => setColour(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Other</Label>
              <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Display name</Label>
            <Input
              value={displayOverride || autoDisplay()}
              onChange={(e) => setDisplayOverride(e.target.value)}
              placeholder="Auto-generated from attributes"
            />
            <p className="text-[11px] text-muted-foreground">Shown in lists. Auto-fills from attributes.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !selected}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── SKU dialog ───────────────────────────────────────────────────────────

const FORMAT_OPTIONS = ["Pack", "Bottle", "Pouch", "Can", "Sachet", "Box", "Tube", "Jar"];

function SkuDialog({
  open,
  variantId,
  variants,
  models,
  brands,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  variantId?: string;
  variants: VariantRow[];
  models: ModelRow[];
  brands: BrandRow[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [barcode, setBarcode] = useState("");
  const [format, setFormat] = useState("Pack");
  const [unitSize, setUnitSize] = useState("");
  const [unitUom, setUnitUom] = useState<UnitUom>("pcs");
  const [pcsPerPack, setPcsPerPack] = useState("1");
  const [packsPerCarton, setPacksPerCarton] = useState("");
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [costBasis, setCostBasis] = useState<CostBasis>("piece");
  const [saving, setSaving] = useState(false);

  const variant = variants.find((v) => v.id === selected);
  const model = models.find((m) => m.id === variant?.model_id);
  const brand = brands.find((b) => b.id === model?.brand_id);

  useEffect(() => {
    if (open) {
      setSelected(variantId ?? "");
      setCode("");
      setBarcode("");
      setUnitSize("");
      setPcsPerPack("1");
      setPacksPerCarton("");
      setLengthCm("");
      setWidthCm("");
      setHeightCm("");
      setWeightKg("");
    }
  }, [open, variantId]);

  // Auto-pick UoM and cost basis from model category
  useEffect(() => {
    if (!model) return;
    setUnitUom(UOM_FOR[model.category]);
    setCostBasis(COST_BASIS_FOR[model.category]);
    if (model.category === "diaper") setFormat("Pack");
    else if (model.category === "liquid") setFormat("Bottle");
    else if (model.category === "powder") setFormat("Pack");
  }, [model]);

  // Auto-generate internal code
  useEffect(() => {
    if (!variant || !model || !brand) return;
    if (code) return; // don't overwrite manual edits
    const sizePart = String(variant.attributes.size ?? variant.attributes.scent ?? "").toUpperCase().slice(0, 4);
    const fmtPart = format ? format.charAt(0) : "X";
    const sizeNum = unitSize ? `${unitSize}${unitUom}` : "";
    const packPart = pcsPerPack && pcsPerPack !== "1" ? `${pcsPerPack}P` : "";
    const ctnPart = packsPerCarton ? `${packsPerCarton}C` : "";
    const auto = [
      brand.name.replace(/\s/g, "").toUpperCase().slice(0, 3),
      model.name.replace(/\s/g, "").toUpperCase().slice(0, 3),
      sizePart,
      fmtPart,
      sizeNum,
      packPart,
      ctnPart,
    ].filter(Boolean).join("-");
    setCode(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, model, brand, format, unitSize, unitUom, pcsPerPack, packsPerCarton]);

  const cbm = useMemo(() => {
    const l = parseFloat(lengthCm), w = parseFloat(widthCm), h = parseFloat(heightCm);
    if (!l || !w || !h) return null;
    return (l * w * h) / 1_000_000;
  }, [lengthCm, widthCm, heightCm]);

  const pcsPerCarton = useMemo(() => {
    const p = parseInt(pcsPerPack, 10), c = parseInt(packsPerCarton, 10);
    if (!p || !c) return null;
    return p * c;
  }, [pcsPerPack, packsPerCarton]);

  async function save() {
    if (!selected || !code.trim() || !unitSize || !packsPerCarton || !lengthCm || !widthCm || !heightCm) return;
    setSaving(true);
    try {
      await createSku({
        variant_id: selected,
        internal_code: code.trim(),
        supplier_barcode: barcode.trim() || null,
        format: format || null,
        unit_uom: unitUom,
        unit_size: parseFloat(unitSize),
        pcs_per_pack: parseInt(pcsPerPack, 10),
        packs_per_carton: parseInt(packsPerCarton, 10),
        carton_length_cm: parseFloat(lengthCm),
        carton_width_cm: parseFloat(widthCm),
        carton_height_cm: parseFloat(heightCm),
        carton_weight_kg: weightKg ? parseFloat(weightKg) : null,
        cost_basis: costBasis,
      });
      toast.success("SKU created");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function variantPath(vid: string): string {
    const v = variants.find((x) => x.id === vid);
    if (!v) return "";
    const m = models.find((x) => x.id === v.model_id);
    const b = brands.find((x) => x.id === m?.brand_id);
    return `${b?.name} › ${m?.name} › ${v.display_name}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle>New SKU</DialogTitle>
          <DialogDescription>The actual sellable product. CBM auto-calculates from dimensions.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Variant *</Label>
            <Select value={selected} onValueChange={(v) => v && setSelected(v)}>
              <SelectTrigger><SelectValue placeholder="Pick a variant" /></SelectTrigger>
              <SelectContent>
                {variants.map((v) => <SelectItem key={v.id} value={v.id}>{variantPath(v.id)}</SelectItem>)}
              </SelectContent>
            </Select>
            {variant && (
              <p className="text-[11px] text-muted-foreground">{formatAttributes(variant.attributes)}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Format *</Label>
              <Select value={format} onValueChange={(v) => v && setFormat(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORMAT_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Pouch vs Bottle distinction.</p>
            </div>

            <div className="space-y-2">
              <Label>Unit Size *</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.001" value={unitSize} onChange={(e) => setUnitSize(e.target.value)} placeholder="500" className="flex-1" />
                <Select value={unitUom} onValueChange={(v) => setUnitUom(v as UnitUom)}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ml">ml</SelectItem>
                    <SelectItem value="g">g</SelectItem>
                    <SelectItem value="pcs">pcs</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] text-muted-foreground">Volume / weight per piece (or 1 pcs for diapers).</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Pcs per Pack *</Label>
              <Input type="number" min="1" value={pcsPerPack} onChange={(e) => setPcsPerPack(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">e.g. 22 pcs / pack for diapers; 1 for a bottle.</p>
            </div>
            <div className="space-y-2">
              <Label>Packs per Carton *</Label>
              <Input type="number" min="1" value={packsPerCarton} onChange={(e) => setPacksPerCarton(e.target.value)} placeholder="4" />
              {pcsPerCarton && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                  → {pcsPerCarton} pcs per carton
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Carton Dimensions (cm) *</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input type="number" step="0.1" value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} placeholder="L" />
              <Input type="number" step="0.1" value={widthCm}  onChange={(e) => setWidthCm(e.target.value)}  placeholder="W" />
              <Input type="number" step="0.1" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="H" />
            </div>
            {cbm !== null && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                → {cbm.toFixed(5)} CBM per carton
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Carton Weight (kg)</Label>
              <Input type="number" step="0.01" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Cost Basis *</Label>
              <Select value={costBasis} onValueChange={(v) => setCostBasis(v as CostBasis)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="piece">Per Piece</SelectItem>
                  <SelectItem value="per_100ml">Per 100ml</SelectItem>
                  <SelectItem value="per_100g">Per 100g</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Internal Code *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto-generated" />
            </div>
            <div className="space-y-2">
              <Label>Supplier Barcode</Label>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={save}
            disabled={saving || !selected || !code.trim() || !unitSize || !packsPerCarton || !lengthCm || !widthCm || !heightCm}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create SKU"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

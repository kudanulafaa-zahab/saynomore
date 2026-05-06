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
  Layers,
  Pencil,
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
  listCategories,
  listBrands,
  listModels,
  listVariants,
  listSkus,
  createBrand,
  createModel,
  createVariant,
  createSku,
  createCategory,
  toggleSkuActive,
  getCurrentUserRole,
  type CategoryRow,
  type BrandRow,
  type ModelRow,
  type VariantRow,
  type SkuRow,
  type AttrKey,
  type UnitUom,
  type CostBasis,
} from "@/lib/queries/products";
import {
  EditBrandDialog,
  EditModelDialog,
  EditVariantDialog,
  EditSkuDialog,
  CascadeDeleteDialog,
  type CascadeTarget,
} from "./edit-dialogs";

// ── Attribute metadata: how each attribute renders ──────────────────────

interface AttrSpec {
  key: AttrKey;
  label: string;
  placeholder?: string;
  type: "text" | "number";
  options?: string[]; // if present, renders a Select
  suffix?: string;
}

const ATTR_SPECS: Record<AttrKey, AttrSpec> = {
  size:      { key: "size",      label: "Size",       placeholder: "NB, S, M, L, XL…", type: "text" },
  scent:     { key: "scent",     label: "Scent",      placeholder: "Mint, Lemon…",     type: "text" },
  format:    { key: "format",    label: "Format",     type: "text", options: ["Bottle", "Pouch", "Sachet", "Jar", "Box", "Tube", "Pack", "Can"] },
  volume_ml: { key: "volume_ml", label: "Volume",     placeholder: "700, 1500…",       type: "number", suffix: "ml" },
  weight_g:  { key: "weight_g",  label: "Weight",     placeholder: "100, 250…",        type: "number", suffix: "g" },
  colour:    { key: "colour",    label: "Colour",     placeholder: "Pink, Blue…",      type: "text" },
  other:     { key: "other",     label: "Other",      placeholder: "Optional",         type: "text" },
};

// Pretty-print a value: "Mint Pouch 1500ml"
function attrsToDisplay(attrs: Record<string, string | number>, schema: AttrKey[]): string {
  return schema
    .map((k) => {
      const v = attrs[k];
      if (v === undefined || v === "") return "";
      const spec = ATTR_SPECS[k];
      if (!spec) return String(v);
      if (spec.suffix) return `${v}${spec.suffix}`;
      return String(v);
    })
    .filter(Boolean)
    .join(" ");
}

// ── Main explorer ────────────────────────────────────────────────────────

export function ProductsExplorer() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
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

  // Edit dialogs
  const [editBrand, setEditBrand] = useState<BrandRow | null>(null);
  const [editModel, setEditModel] = useState<ModelRow | null>(null);
  const [editVariant, setEditVariant] = useState<VariantRow | null>(null);
  const [editSku, setEditSku] = useState<SkuRow | null>(null);

  // Cascade-delete dialog (admin only)
  const [cascadeTarget, setCascadeTarget] = useState<CascadeTarget | null>(null);

  // Current user role
  const [role, setRole] = useState<"admin" | "manager" | "staff" | null>(null);
  useEffect(() => {
    getCurrentUserRole().then(setRole).catch(() => setRole(null));
  }, []);
  const isAdmin = role === "admin";

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, b, m, v, s] = await Promise.all([
        listCategories(),
        listBrands(),
        listModels(),
        listVariants(),
        listSkus(),
      ]);
      setCategories(c);
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

  const totals = useMemo(() => ({
    brands: brands.length,
    skus: skus.length,
    activeSkus: skus.filter((s) => s.is_active).length,
  }), [brands, skus]);

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
            {totals.brands} brands · {totals.activeSkus} active products
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
            Start with a brand like <strong>MamyPoko</strong>. Then add product lines
            (e.g. Xtra Kering), variants (e.g. Size M), and pack configurations.
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
            categories={categories}
            models={models.filter((m) => m.brand_id === brand.id)}
            variants={variants}
            skus={skus}
            isOpen={openBrand === brand.id}
            openModel={openModel}
            openVariant={openVariant}
            isAdmin={isAdmin}
            onToggle={() => setOpenBrand(openBrand === brand.id ? null : brand.id)}
            onToggleModel={(id) => setOpenModel(openModel === id ? null : id)}
            onToggleVariant={(id) => setOpenVariant(openVariant === id ? null : id)}
            onAddModel={() => setModelDialog({ open: true, brandId: brand.id })}
            onAddVariant={(modelId) => setVariantDialog({ open: true, modelId })}
            onAddSku={(variantId) => setSkuDialog({ open: true, variantId })}
            onEditBrand={() => setEditBrand(brand)}
            onEditModel={(m) => setEditModel(m)}
            onEditVariant={(v) => setEditVariant(v)}
            onEditSku={(s) => setEditSku(s)}
            onDeleteBrand={() => setCascadeTarget({ kind: "brand", id: brand.id, label: brand.name })}
            onDeleteModel={(m) => setCascadeTarget({ kind: "model", id: m.id, label: m.name })}
            onDeleteVariant={(v) => setCascadeTarget({ kind: "variant", id: v.id, label: v.display_name })}
            onDeleteSku={(s) => setCascadeTarget({ kind: "sku", id: s.id, label: s.internal_code })}
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
        categories={categories}
        onOpenChange={(o) => setModelDialog({ open: o })}
        onSaved={loadAll}
      />
      <VariantDialog
        open={variantDialog.open}
        modelId={variantDialog.modelId}
        models={models}
        brands={brands}
        categories={categories}
        onOpenChange={(o) => setVariantDialog({ open: o })}
        onSaved={loadAll}
      />
      <SkuDialog
        open={skuDialog.open}
        variantId={skuDialog.variantId}
        variants={variants}
        models={models}
        brands={brands}
        categories={categories}
        existingSkus={skus}
        onOpenChange={(o) => setSkuDialog({ open: o })}
        onSaved={loadAll}
      />

      {/* Edit dialogs */}
      <EditBrandDialog
        brand={editBrand}
        open={!!editBrand}
        onOpenChange={(o) => !o && setEditBrand(null)}
        onSaved={loadAll}
      />
      <EditModelDialog
        model={editModel}
        categories={categories}
        open={!!editModel}
        onOpenChange={(o) => !o && setEditModel(null)}
        onSaved={loadAll}
      />
      <EditVariantDialog
        variant={editVariant}
        category={
          editVariant
            ? categories.find(
                (c) => c.id === models.find((m) => m.id === editVariant.model_id)?.category_id,
              )
            : undefined
        }
        open={!!editVariant}
        onOpenChange={(o) => !o && setEditVariant(null)}
        onSaved={loadAll}
      />
      <EditSkuDialog
        sku={editSku}
        open={!!editSku}
        onOpenChange={(o) => !o && setEditSku(null)}
        onSaved={loadAll}
      />

      {/* Cascade delete (admin) */}
      <CascadeDeleteDialog
        target={cascadeTarget}
        open={!!cascadeTarget}
        onOpenChange={(o) => !o && setCascadeTarget(null)}
        onDone={loadAll}
      />
    </div>
  );
}

// ── Brand card ───────────────────────────────────────────────────────────

function BrandCard({
  brand,
  categories,
  models,
  variants,
  skus,
  isOpen,
  openModel,
  openVariant,
  isAdmin,
  onToggle,
  onToggleModel,
  onToggleVariant,
  onAddModel,
  onAddVariant,
  onAddSku,
  onEditBrand,
  onEditModel,
  onEditVariant,
  onEditSku,
  onDeleteBrand,
  onDeleteModel,
  onDeleteVariant,
  onDeleteSku,
  onToggleSku,
}: {
  brand: BrandRow;
  categories: CategoryRow[];
  models: ModelRow[];
  variants: VariantRow[];
  skus: SkuRow[];
  isOpen: boolean;
  openModel: string | null;
  openVariant: string | null;
  isAdmin: boolean;
  onToggle: () => void;
  onToggleModel: (id: string) => void;
  onToggleVariant: (id: string) => void;
  onAddModel: () => void;
  onAddVariant: (modelId: string) => void;
  onAddSku: (variantId: string) => void;
  onEditBrand: () => void;
  onEditModel: (m: ModelRow) => void;
  onEditVariant: (v: VariantRow) => void;
  onEditSku: (s: SkuRow) => void;
  onDeleteBrand: () => void;
  onDeleteModel: (m: ModelRow) => void;
  onDeleteVariant: (v: VariantRow) => void;
  onDeleteSku: (s: SkuRow) => void;
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
              {models.length} models · {skuCount} packs
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onEditBrand(); }}
            className="p-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-secondary transition"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteBrand(); }}
              className="p-2 rounded-lg text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
              title="Delete (admin)"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
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
            const category = categories.find((c) => c.id === model.category_id);
            return (
              <ModelRowCard
                key={model.id}
                model={model}
                category={category}
                variants={modelVariants}
                skus={skus}
                isOpen={openModel === model.id}
                openVariant={openVariant}
                isAdmin={isAdmin}
                onToggle={() => onToggleModel(model.id)}
                onToggleVariant={onToggleVariant}
                onAddVariant={() => onAddVariant(model.id)}
                onAddSku={onAddSku}
                onEdit={() => onEditModel(model)}
                onDelete={() => onDeleteModel(model)}
                onEditVariant={onEditVariant}
                onDeleteVariant={onDeleteVariant}
                onEditSku={onEditSku}
                onDeleteSku={onDeleteSku}
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
  category,
  variants,
  skus,
  isOpen,
  openVariant,
  isAdmin,
  onToggle,
  onToggleVariant,
  onAddVariant,
  onAddSku,
  onEdit,
  onDelete,
  onEditVariant,
  onDeleteVariant,
  onEditSku,
  onDeleteSku,
  onToggleSku,
}: {
  model: ModelRow;
  category?: CategoryRow;
  variants: VariantRow[];
  skus: SkuRow[];
  isOpen: boolean;
  openVariant: string | null;
  isAdmin: boolean;
  onToggle: () => void;
  onToggleVariant: (id: string) => void;
  onAddVariant: () => void;
  onAddSku: (variantId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditVariant: (v: VariantRow) => void;
  onDeleteVariant: (v: VariantRow) => void;
  onEditSku: (s: SkuRow) => void;
  onDeleteSku: (s: SkuRow) => void;
  onToggleSku: (id: string, active: boolean) => void;
}) {
  const variantWord = category?.name === "Diapers" ? "Sizes" : "Variants";
  const variantWordSingular = category?.name === "Diapers" ? "Size" : "Variant";

  return (
    <div className="glass-flat overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-3 hover:bg-accent/30 transition">
        <div className="flex items-center gap-3">
          <Boxes className="h-4 w-4 text-muted-foreground" />
          <div className="text-left">
            <p className="text-sm text-foreground">{model.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {category?.name ?? "—"} · {variants.length} {variantWord.toLowerCase()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-secondary transition"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1.5 rounded text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
              title="Delete (admin)"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border p-3 space-y-2 bg-background/30">
          <div className="flex items-center justify-between mb-1 px-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{variantWord}</p>
            <Button size="sm" variant="ghost" onClick={onAddVariant} className="text-primary h-6 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              {variantWordSingular}
            </Button>
          </div>

          {variants.length === 0 && <p className="text-xs text-muted-foreground px-1 py-2">None yet.</p>}

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
                    <span className="text-xs text-muted-foreground">({variantSkus.length} pack{variantSkus.length === 1 ? "" : "s"})</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditVariant(variant); }}
                      className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-secondary transition"
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    {isAdmin && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteVariant(variant); }}
                        className="p-1 rounded text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
                        title="Delete (admin)"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${openVariant === variant.id ? "rotate-180" : ""}`} />
                  </div>
                </button>

                {openVariant === variant.id && (
                  <div className="border-t border-border p-2.5 space-y-1.5 bg-background/30">
                    <div className="flex items-center justify-between mb-1 px-1">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Pack configurations</p>
                      <Button size="sm" variant="ghost" onClick={() => onAddSku(variant.id)} className="text-primary h-6 text-xs">
                        <Plus className="h-3 w-3 mr-1" />
                        Pack
                      </Button>
                    </div>

                    {variantSkus.length === 0 && <p className="text-xs text-muted-foreground px-1 py-2">No pack configurations yet.</p>}

                    {variantSkus.map((sku) => (
                      <div
                        key={sku.id}
                        className="grid grid-cols-12 gap-2 items-center text-xs px-2.5 py-2 rounded-lg bg-card/40 border border-border"
                      >
                        <span className="col-span-3 text-foreground font-mono truncate" title={sku.internal_code}>
                          {sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn
                        </span>
                        <span className="col-span-2 text-muted-foreground">
                          = {sku.pcs_per_pack * sku.packs_per_carton} pcs/ctn
                        </span>
                        <span className="col-span-2 text-muted-foreground">
                          {Number(sku.cbm_per_carton).toFixed(4)} CBM
                        </span>
                        <span className="col-span-2 text-muted-foreground truncate" title={sku.internal_code}>
                          {sku.internal_code}
                        </span>
                        <div className="col-span-1">
                          <button
                            onClick={() => onToggleSku(sku.id, !sku.is_active)}
                            className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 ${
                              sku.is_active ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {sku.is_active ? "On" : "Off"}
                          </button>
                        </div>
                        <div className="col-span-2 flex items-center justify-end gap-1">
                          <button
                            onClick={() => onEditSku(sku)}
                            className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-secondary transition"
                            title="Edit"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => onDeleteSku(sku)}
                              className="p-1 rounded text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
                              title="Delete (admin)"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
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
  open, onOpenChange, onSaved,
}: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
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

// ── Model dialog (with category picker) ─────────────────────────────────

function ModelDialog({
  open,
  brandId,
  brands,
  categories,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  brandId?: string;
  brands: BrandRow[];
  categories: CategoryRow[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedCat, setSelectedCat] = useState("");
  const [name, setName] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [dutyPct, setDutyPct] = useState("");
  const [saving, setSaving] = useState(false);
  // Inline new-category state
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatUom, setNewCatUom] = useState<UnitUom>("pcs");
  const [newCatBasis, setNewCatBasis] = useState<CostBasis>("piece");
  const [newCatAttrs, setNewCatAttrs] = useState<Set<AttrKey>>(new Set(["size"]));
  const [savingCat, setSavingCat] = useState(false);

  // When categories array changes (after inline create), auto-select the new one
  const [pendingCatName, setPendingCatName] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingCatName) return;
    const created = categories.find((c) => c.name === pendingCatName);
    if (created) {
      setSelectedCat(created.id);
      setPendingCatName(null);
    }
  }, [categories, pendingCatName]);

  useEffect(() => {
    if (open) {
      setSelectedBrand(brandId ?? "");
      setSelectedCat(categories[0]?.id ?? "");
      setName(""); setHsCode(""); setDutyPct("");
      setShowNewCat(false);
      setNewCatName("");
      setNewCatUom("pcs");
      setNewCatBasis("piece");
      setNewCatAttrs(new Set(["size"]));
    }
  }, [open, brandId, categories]);

  function toggleNewCatAttr(k: AttrKey) {
    const next = new Set(newCatAttrs);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setNewCatAttrs(next);
  }

  async function saveNewCategory() {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    setSavingCat(true);
    try {
      await createCategory({
        name: trimmed,
        unit_uom: newCatUom,
        cost_basis: newCatBasis,
        variant_attributes: Array.from(newCatAttrs),
      });
      setPendingCatName(trimmed);
      setShowNewCat(false);
      setNewCatName("");
      toast.success("Category created");
      onSaved(); // refresh the parent's categories list
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingCat(false);
    }
  }

  async function save() {
    if (!name.trim() || !selectedBrand || !selectedCat) return;
    setSaving(true);
    try {
      await createModel({
        brand_id: selectedBrand,
        category_id: selectedCat,
        name: name.trim(),
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
            <Select value={selectedBrand} onValueChange={(v) => v && setSelectedBrand(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a brand">
                  {brands.find((b) => b.id === selectedBrand)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Category *</Label>
              {!showNewCat && (
                <button
                  type="button"
                  onClick={() => setShowNewCat(true)}
                  className="text-xs text-primary hover:opacity-80 transition"
                >
                  + New category
                </button>
              )}
            </div>

            {!showNewCat ? (
              <>
                <Select value={selectedCat} onValueChange={(v) => v && setSelectedCat(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a category">
                      {categories.find((c) => c.id === selectedCat)?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Drives which attributes appear when adding variants.
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">New category</span>
                  <button
                    type="button"
                    onClick={() => setShowNewCat(false)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
                <Input
                  autoFocus
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="e.g. Shampoo, Toothpaste"
                  className="h-9 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Select value={newCatUom} onValueChange={(v) => v && setNewCatUom(v as UnitUom)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue>{newCatUom}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pcs">pcs</SelectItem>
                      <SelectItem value="ml">ml</SelectItem>
                      <SelectItem value="g">g</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={newCatBasis} onValueChange={(v) => v && setNewCatBasis(v as CostBasis)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue>{newCatBasis}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="piece">per piece</SelectItem>
                      <SelectItem value="per_100ml">per 100ml</SelectItem>
                      <SelectItem value="per_100g">per 100g</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1.5">Variant attributes:</p>
                  <div className="flex flex-wrap gap-1">
                    {(["size","scent","format","volume_ml","weight_g","colour","other"] as AttrKey[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleNewCatAttr(k)}
                        className={`text-[11px] rounded px-2 py-0.5 border transition ${
                          newCatAttrs.has(k)
                            ? "bg-primary/15 border-primary/30 text-foreground"
                            : "bg-card/40 border-border text-muted-foreground"
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full h-9"
                  onClick={saveNewCategory}
                  disabled={savingCat || !newCatName.trim()}
                >
                  {savingCat ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save category"}
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Xtra Kering" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>HS Code</Label>
              <Input value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Duty %</Label>
              <Input type="number" step="0.01" value={dutyPct} onChange={(e) => setDutyPct(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim() || !selectedBrand || !selectedCat}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Variant dialog (CATEGORY-DRIVEN) ────────────────────────────────────

function VariantDialog({
  open,
  modelId,
  models,
  brands,
  categories,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  modelId?: string;
  models: ModelRow[];
  brands: BrandRow[];
  categories: CategoryRow[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [selectedModel, setSelectedModel] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [displayOverride, setDisplayOverride] = useState("");
  const [displayTouched, setDisplayTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const model = models.find((m) => m.id === selectedModel);
  const brand = brands.find((b) => b.id === model?.brand_id);
  const category = categories.find((c) => c.id === model?.category_id);
  const schema: AttrKey[] = (category?.variant_attributes ?? []) as AttrKey[];

  useEffect(() => {
    if (open) {
      setSelectedModel(modelId ?? "");
      setAttrs({});
      setDisplayOverride("");
      setDisplayTouched(false);
    }
  }, [open, modelId]);

  // Auto-derive display name from attributes following the schema order
  const autoDisplay = useMemo(() => attrsToDisplay(attrs, schema), [attrs, schema]);
  // Once user types in the display field, it's theirs — show exactly what they typed
  const displayValue = displayTouched ? displayOverride : autoDisplay;

  async function save() {
    if (!selectedModel) return;
    if (schema.length === 0) {
      toast.error("This category has no attributes defined.");
      return;
    }
    const cleaned: Record<string, string | number> = {};
    for (const k of schema) {
      const v = attrs[k];
      if (v === undefined || v.trim() === "") continue;
      const spec = ATTR_SPECS[k];
      cleaned[k] = spec?.type === "number" ? Number(v) : v.trim();
    }
    if (Object.keys(cleaned).length === 0) {
      toast.error("Fill at least one attribute.");
      return;
    }
    const display = displayValue.trim() || autoDisplay || "Variant";
    setSaving(true);
    try {
      await createVariant({ model_id: selectedModel, attributes: cleaned, display_name: display });
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
          <DialogTitle>
            {category?.name === "Diapers" ? "New Size" : "New Variant"}
          </DialogTitle>
          <DialogDescription>
            {category?.name === "Diapers"
              ? "e.g. NB, S, M, L, XL."
              : category?.name === "Liquid Detergent"
              ? "e.g. Mint Pouch 1500ml."
              : "Pick the model — fields adapt to the category."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Model *</Label>
            <Select value={selectedModel} onValueChange={(v) => v && setSelectedModel(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a model">
                  {model && brand ? `${brand.name} › ${model.name}` : ""}
                </SelectValue>
              </SelectTrigger>
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
              {brand?.name} › {model.name} · {category?.name}
            </p>
          )}

          {/* Dynamic attribute fields based on category schema */}
          {schema.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {schema.map((key) => {
                const spec = ATTR_SPECS[key];
                if (!spec) return null;
                return (
                  <div key={key} className="space-y-2">
                    <Label>{spec.label}{spec.suffix ? ` (${spec.suffix})` : ""}</Label>
                    {spec.options ? (
                      <Select value={attrs[key] ?? ""} onValueChange={(v) => v && setAttrs({ ...attrs, [key]: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder={spec.placeholder ?? "Pick"}>
                            {attrs[key] || ""}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {spec.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={spec.type === "number" ? "number" : "text"}
                        value={attrs[key] ?? ""}
                        onChange={(e) => setAttrs({ ...attrs, [key]: e.target.value })}
                        placeholder={spec.placeholder}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : selectedModel ? (
            <p className="text-sm text-muted-foreground">This category has no attributes.</p>
          ) : null}

          {selectedModel && (
            <div className="space-y-2">
              <Label>Display name</Label>
              <Input
                value={displayValue}
                onChange={(e) => {
                  setDisplayTouched(true);
                  setDisplayOverride(e.target.value);
                }}
                placeholder={autoDisplay || "Type a name…"}
              />
              <p className="text-[11px] text-muted-foreground">
                Auto-fills from attributes. Edit freely — your text overrides.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !selectedModel}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── SKU dialog (PACK CONFIGURATION) ─────────────────────────────────────

function SkuDialog({
  open,
  variantId,
  variants,
  models,
  brands,
  categories,
  existingSkus,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  variantId?: string;
  variants: VariantRow[];
  models: ModelRow[];
  brands: BrandRow[];
  categories: CategoryRow[];
  existingSkus: SkuRow[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [pcsPerPack, setPcsPerPack] = useState("");
  const [packsPerCarton, setPacksPerCarton] = useState("");
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [code, setCode] = useState("");
  const [barcode, setBarcode] = useState("");
  const [saving, setSaving] = useState(false);

  const variant = variants.find((v) => v.id === selected);
  const model = models.find((m) => m.id === variant?.model_id);
  const brand = brands.find((b) => b.id === model?.brand_id);
  const category = categories.find((c) => c.id === model?.category_id);

  // Suggest dimensions from the variant's most-recent SKU (lots of SKUs share the same carton size)
  useEffect(() => {
    if (!open) return;
    setSelected(variantId ?? "");
    setPcsPerPack("");
    setPacksPerCarton("");
    setLengthCm("");
    setWidthCm("");
    setHeightCm("");
    setWeightKg("");
    setCode("");
    setBarcode("");
  }, [open, variantId]);

  // Auto-fill dimensions from a sibling SKU of the same variant
  useEffect(() => {
    if (!variant) return;
    const sibling = existingSkus.find((s) => s.variant_id === variant.id);
    if (sibling && !lengthCm && !widthCm && !heightCm) {
      setLengthCm(String(sibling.carton_length_cm));
      setWidthCm(String(sibling.carton_width_cm));
      setHeightCm(String(sibling.carton_height_cm));
      if (sibling.carton_weight_kg) setWeightKg(String(sibling.carton_weight_kg));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.id]);

  // Auto-generate internal code
  useEffect(() => {
    if (!variant || !model || !brand) return;
    if (code) return;
    const brandPart = brand.name.replace(/\s/g, "").toUpperCase().slice(0, 4);
    const modelPart = model.name.replace(/\s/g, "").toUpperCase().slice(0, 4);
    const variantPart = variant.display_name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
    const packPart = pcsPerPack && packsPerCarton ? `${pcsPerPack}x${packsPerCarton}` : "";
    setCode([brandPart, modelPart, variantPart, packPart].filter(Boolean).join("-"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.id, model?.id, brand?.id, pcsPerPack, packsPerCarton]);

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
    if (!selected || !pcsPerPack || !packsPerCarton || !lengthCm || !widthCm || !heightCm || !code.trim()) return;
    setSaving(true);
    try {
      await createSku({
        variant_id: selected,
        internal_code: code.trim(),
        supplier_barcode: barcode.trim() || null,
        pcs_per_pack: parseInt(pcsPerPack, 10),
        packs_per_carton: parseInt(packsPerCarton, 10),
        carton_length_cm: parseFloat(lengthCm),
        carton_width_cm: parseFloat(widthCm),
        carton_height_cm: parseFloat(heightCm),
        carton_weight_kg: weightKg ? parseFloat(weightKg) : null,
      });
      toast.success("Pack configuration created");
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
      <DialogContent className="bg-popover border-border max-w-xl">
        <DialogHeader>
          <DialogTitle>New Pack Configuration</DialogTitle>
          <DialogDescription>
            One sellable pack/carton config. Same variant can have many — e.g. 34 pcs/pk × 4 pk/ctn AND 48 pcs/pk × 3 pk/ctn.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Variant *</Label>
            <Select value={selected} onValueChange={(v) => v && setSelected(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a variant">
                  {selected ? variantPath(selected) : ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {variants.map((v) => <SelectItem key={v.id} value={v.id}>{variantPath(v.id)}</SelectItem>)}
              </SelectContent>
            </Select>
            {category && <p className="text-[11px] text-muted-foreground">Cost basis: {category.cost_basis} · UoM: {category.unit_uom}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Pcs per Pack *</Label>
              <Input type="number" min="1" value={pcsPerPack} onChange={(e) => setPcsPerPack(e.target.value)} placeholder="34" />
              <p className="text-[11px] text-muted-foreground">e.g. 34 diapers in one retail pack.</p>
            </div>
            <div className="space-y-2">
              <Label>Packs per Carton *</Label>
              <Input type="number" min="1" value={packsPerCarton} onChange={(e) => setPacksPerCarton(e.target.value)} placeholder="4" />
              {pcsPerCarton && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">→ {pcsPerCarton} pcs per carton</p>
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
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400">→ {cbm.toFixed(5)} CBM per carton</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Carton Weight (kg)</Label>
              <Input type="number" step="0.01" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Supplier Barcode</Label>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Internal Code *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto-generated" />
            <p className="text-[11px] text-muted-foreground">Auto-built from brand/model/variant. Override if you prefer.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={save}
            disabled={saving || !selected || !pcsPerPack || !packsPerCarton || !lengthCm || !widthCm || !heightCm || !code.trim()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Pack"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Re-export Layers icon to silence unused-import (keeps tree-shaking happy)
export const _layers = Layers;

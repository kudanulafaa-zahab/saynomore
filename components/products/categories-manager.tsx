"use client";

import { useEffect, useState } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
  createCategory,
  updateCategory,
  deleteCategory,
  getCurrentUserRole,
  type CategoryRow,
  type AttrKey,
  type UnitUom,
  type CostBasis,
} from "@/lib/queries/products";
import { SkeletonRows } from "@/components/layout/page-skeleton";

// Human-readable summary of category configuration — no raw field codes shown to user
function humanMeta(c: CategoryRow): string {
  const uomLabel =
    c.unit_uom === "ml" ? "Liquid" :
    c.unit_uom === "g"  ? "Powder" :
                          "Pieces";
  const costLabel =
    c.cost_basis === "per_100ml" ? "per 100 ml" :
    c.cost_basis === "per_100g"  ? "per 100 g"  :
                                   "per piece";
  const attrLabels: Record<AttrKey, string> = {
    size: "Size", scent: "Scent", format: "Format", volume_ml: "Volume",
    weight_g: "Weight", colour: "Colour", other: "Other",
  };
  const attrs = c.variant_attributes.map((a) => attrLabels[a] ?? a).join(", ");
  const duty = c.duty_rate_pct > 0 ? `${c.duty_rate_pct}% duty` : null;
  return [uomLabel, costLabel, attrs, duty].filter(Boolean).join(" · ");
}

const ATTR_OPTIONS: { key: AttrKey; label: string }[] = [
  { key: "size",      label: "Size" },
  { key: "scent",     label: "Scent" },
  { key: "format",    label: "Format (Bottle/Pouch/etc.)" },
  { key: "volume_ml", label: "Volume (ml)" },
  { key: "weight_g",  label: "Weight (g)" },
  { key: "colour",    label: "Colour" },
  { key: "other",     label: "Other (free text)" },
];

export function CategoriesManager() {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<CategoryRow | null>(null);
  const [confirmCat, setConfirmCat] = useState<{ id: string; name: string } | null>(null);
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => { getCurrentUserRole().then((r) => setCanWrite(r !== "viewer" && r !== null)).catch(() => {}); }, []);

  async function load() {
    setLoading(true);
    try {
      setRows(await listCategories());
    } catch (err) {
      toast.error("Failed: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (loading) {
    return <SkeletonRows rows={6} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-foreground">Categories</h2>
          <p className="ios-subhead text-muted-foreground">
            Each category controls which attributes appear on its variants.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Category
          </Button>
        )}
      </div>

      <div className="glass divide-y divide-border overflow-hidden">
        {rows.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => canWrite && setEditingCat(c)}
            className="w-full p-4 flex items-start justify-between gap-3 text-left active:opacity-70"
            disabled={!canWrite}
          >
            <div className="space-y-1 min-w-0">
              <p className="text-base font-medium text-foreground">{c.name}</p>
              {c.description && <p className="ios-subhead text-muted-foreground">{c.description}</p>}
              <p className="ios-subhead text-muted-foreground">{humanMeta(c)}</p>
            </div>
            {!c.is_system && canWrite && (
              <span
                onClick={(e) => { e.stopPropagation(); setConfirmCat({ id: c.id, name: c.name }); }}
                className="h-11 w-11 flex items-center justify-center rounded-lg text-muted-foreground/70 hover:text-[var(--snm-error)] hover:bg-[color-mix(in_srgb,var(--snm-error)_10%,transparent)] transition shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </span>
            )}
          </button>
        ))}
      </div>

      <CategoryDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={load} />
      <EditCategoryDialog category={editingCat} onOpenChange={(o) => !o && setEditingCat(null)} onSaved={load} />

      <ConfirmSheet
        open={confirmCat !== null}
        onClose={() => setConfirmCat(null)}
        title="Delete category?"
        message={confirmCat ? `"${confirmCat.name}" will be permanently deleted.` : ""}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmCat) return;
          try { await deleteCategory(confirmCat.id); toast.success("Deleted"); setConfirmCat(null); load(); }
          catch (e) { toast.error((e as Error).message); }
        }}
      />
    </div>
  );
}

function CategoryDialog({
  open, onOpenChange, onSaved,
}: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [uom, setUom] = useState<UnitUom>("pcs");
  const [basis, setBasis] = useState<CostBasis>("piece");
  const [attrs, setAttrs] = useState<Set<AttrKey>>(new Set(["size"]));
  const [duty, setDuty] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(""); setDescription("");
      setUom("pcs"); setBasis("piece");
      setAttrs(new Set(["size"]));
      setDuty("");
    }
  }, [open]);

  function toggleAttr(k: AttrKey) {
    const next = new Set(attrs);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setAttrs(next);
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCategory({
        name: name.trim(),
        description: description.trim() || null,
        unit_uom: uom,
        cost_basis: basis,
        variant_attributes: Array.from(attrs),
        duty_rate_pct: duty ? parseFloat(duty) : 0,
      });
      toast.success("Category created");
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
      <DialogContent className="bg-popover border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Category</DialogTitle>
          <DialogDescription>e.g. Shampoo, Toothpaste, Snacks.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[60px]" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Unit of Measure *</Label>
              <Select value={uom} onValueChange={(v) => v && setUom(v as UnitUom)}>
                <SelectTrigger><SelectValue>{uom}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pcs">pcs (pieces)</SelectItem>
                  <SelectItem value="ml">ml (millilitres)</SelectItem>
                  <SelectItem value="g">g (grams)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cost Basis *</Label>
              <Select value={basis} onValueChange={(v) => v && setBasis(v as CostBasis)}>
                <SelectTrigger><SelectValue>{basis}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="piece">Per piece</SelectItem>
                  <SelectItem value="per_100ml">Per 100ml</SelectItem>
                  <SelectItem value="per_100g">Per 100g</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Customs Duty %</Label>
            <Input type="number" step="0.01" min="0" placeholder="0" value={duty} onChange={(e) => setDuty(e.target.value)} />
            <p className="ios-subhead text-muted-foreground">
              e.g. Tobacco is 200% in the Maldives. Every brand and pack size in this category inherits this rate automatically. Leave at 0 if this category has no duty.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Variant Attributes</Label>
            <p className="ios-subhead text-muted-foreground">
              These fields will appear when adding a variant in this category.
            </p>
            <div className="grid grid-cols-2 gap-1">
              {ATTR_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleAttr(key)}
                  className={`text-left text-xs rounded-lg px-3 py-2 border transition ${
                    attrs.has(key)
                      ? "bg-primary/15 border-primary/30 text-foreground"
                      : "bg-card/40 border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
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

// ── Category editor — mainly for adjusting the duty rate later (customs
// rates change) since there's no other way to edit an existing category. ──

function EditCategoryDialog({
  category, onOpenChange, onSaved,
}: { category: CategoryRow | null; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [duty, setDuty] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (category) setDuty(category.duty_rate_pct > 0 ? String(category.duty_rate_pct) : "");
  }, [category]);

  async function save() {
    if (!category) return;
    setSaving(true);
    try {
      await updateCategory(category.id, { duty_rate_pct: duty ? parseFloat(duty) : 0 });
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
    <Dialog open={category !== null} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle>{category?.name}</DialogTitle>
          <DialogDescription>Adjust this category&apos;s customs duty rate.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Customs Duty %</Label>
            <Input type="number" step="0.01" min="0" placeholder="0" value={duty} onChange={(e) => setDuty(e.target.value)} />
            <p className="ios-subhead text-muted-foreground">
              e.g. Tobacco is 200% in the Maldives. Applies to every brand and pack size in this category on future shipments — already-confirmed GRNs keep the rate that was in effect at the time.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type SellUnit,
} from "@/lib/queries/products";
import { containerLabel, UNIT_WORDS, costBasisFor, sellableUnitsFor } from "@/lib/trade-units";
import { SkeletonRows } from "@/components/layout/page-skeleton";
import { useOnMount } from "@/lib/use-on-mount";

// Human-readable summary of category configuration — no raw field codes shown to user
function humanMeta(c: CategoryRow): string {
  // Says what one of them is called, from the one place that knows — the twin
  // of Postgres unit_noun. This used to collapse everything that was not a
  // liquid or a powder into "Pieces", so a bedding category would have
  // described itself as pieces on the very screen where its unit was chosen.
  const uomLabel =
    c.unit_uom === "ml" ? "Liquid" :
    c.unit_uom === "g"  ? "Powder" :
    `Sold by the ${containerLabel(c.unit_uom)}`;
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


export function CategoriesManager() {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<CategoryRow | null>(null);
  const [confirmCat, setConfirmCat] = useState<{ id: string; name: string } | null>(null);
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => { getCurrentUserRole().then((r) => setCanWrite(r !== "viewer" && r !== null)).catch(() => {}); }, []);

  async function load() {
    try {
      setRows(await listCategories());
    } catch (err) {
      toast.error("Failed: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useOnMount(load);

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

/** The ONE question this dialog asks, and everything it decides.
 *
 *  Ali, 2026-08-21, with a screenshot of the New SKU sheet: *"How do I add ikea
 *  and set it up? It's very complicated."*
 *
 *  It was. Creating a kind of product asked for a Unit of Measure, a Cost Basis
 *  and a set of Variant Attributes — three pieces of database vocabulary, none
 *  of which mean anything to the person selling the thing. Worse, the Unit of
 *  Measure list offered only pcs / ml / g, so there was NO WAY to say that one
 *  IKEA bedding item is a "set". The database has supported eleven unit words
 *  for months; the form could reach three of them.
 *
 *  So it asks the only question a shopkeeper can actually answer — WHAT DO YOU
 *  CALL ONE OF THEM — and derives the rest:
 *
 *    unit_uom            the word he picked
 *    cost_basis          per_100ml for a liquid, per_100g for a powder,
 *                        otherwise per piece. It only ever had three values and
 *                        each one follows from the unit; asking twice invited
 *                        the pair to disagree.
 *    variant_attributes  ['size'], because sizes are OPTIONAL at the point of
 *                        adding a product — leave the size box empty and the
 *                        product simply has none. Nothing is gained by making
 *                        him declare in advance which fields he might use.
 *
 *  Every word here is one `containerLabel`/`unit_noun` already knows, so a
 *  category can never be created with a unit the rest of the app cannot say. */



function CategoryDialog({
  open, onOpenChange, onSaved,
}: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [uom, setUom] = useState<UnitUom>("pcs");
  const [duty, setDuty] = useState("");
  const [showDuty, setShowDuty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(""); setUom("pcs"); setDuty(""); setShowDuty(false);
    }
  }, [open]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCategory({
        name: name.trim(),
        description: null,
        unit_uom: uom,
        cost_basis: costBasisFor(uom),
        // Sizes are optional per product, so nothing has to be declared here.
        variant_attributes: ["size"] as AttrKey[],
        default_sellable_units: sellableUnitsFor(uom),
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
          <DialogTitle>New kind of product</DialogTitle>
          <DialogDescription>e.g. Bedding, Shampoo, Snacks.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>What kind of thing is it? *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bedding" />
          </div>

          {/* THE ONE QUESTION. It decides the unit word, the cost basis and how
              every screen in the app will name this thing. Asked in the words a
              shopkeeper uses, because "Unit of Measure" is not one of them. */}
          <div className="space-y-2">
            <Label>What do you call ONE of them? *</Label>
            <div className="flex flex-wrap gap-1.5">
              {UNIT_WORDS.map(({ uom: u, word, hint }) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUom(u)}
                  aria-pressed={uom === u}
                  className="text-left rounded-xl px-3 py-2 border transition"
                  style={{
                    background: uom === u ? "var(--snm-brand)" : "var(--glass-bg-1)",
                    borderColor: uom === u ? "var(--snm-brand)" : "var(--glass-border)",
                    // Unselected pills carry a CHOICE, so they are content and
                    // get real foreground — never muted-on-transparent.
                    color: uom === u ? "var(--snm-brand-on)" : "var(--foreground)",
                  }}
                >
                  <span className="ios-subhead font-semibold block">{word}</span>
                  <span className="ios-footnote block" style={{ opacity: 0.7 }}>{hint}</span>
                </button>
              ))}
            </div>
            <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
              Stock and prices will read “3 {UNIT_WORDS.find((x) => x.uom === uom)?.word.toLowerCase()}s”
              everywhere in the app.
            </p>
          </div>

          {/* Duty matters for tobacco and almost nothing else, so it is out of
              the way until asked for. It is not a decision most kinds need. */}
          {!showDuty ? (
            <button
              type="button"
              onClick={() => setShowDuty(true)}
              className="ios-subhead underline"
              style={{ color: "var(--foreground)", opacity: 0.75 }}
            >
              Does it pay customs duty?
            </button>
          ) : (
            <div className="space-y-2">
              <Label>Customs duty %</Label>
              <Input type="number" step="0.01" min="0" placeholder="0" value={duty} onChange={(e) => setDuty(e.target.value)} />
              <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
                Tobacco is 200% in the Maldives. Everything in this kind inherits the rate. Leave blank for none.
              </p>
            </div>
          )}
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

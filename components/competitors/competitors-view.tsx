"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Plus, Search, Store, Pencil, Trash2, AlertTriangle, ChevronDown, ChevronUp,
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
  listCompetitors,
  listCompetitorPrices,
  createCompetitor,
  updateCompetitor,
  deleteCompetitor,
  createCompetitorPrice,
  updateCompetitorPrice,
  deleteCompetitorPrice,
  type CompetitorRow,
  type CompetitorPriceRow,
  type PriceBasis,
} from "@/lib/queries/competitors";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";

const BASIS_LABEL: Record<PriceBasis, string> = {
  per_pack: "Per pack",
  per_piece: "Per piece",
  per_100ml: "Per 100ml",
  per_100g: "Per 100g",
  per_carton: "Per carton",
};

function priceBasisLabel(basis: PriceBasis) {
  return BASIS_LABEL[basis] ?? basis;
}

export function CompetitorsView() {
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([]);
  const [prices, setPrices] = useState<CompetitorPriceRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [competitorDialog, setCompetitorDialog] = useState<{ open: boolean; editing?: CompetitorRow }>({ open: false });
  const [priceDialog, setPriceDialog] = useState<{ open: boolean; editing?: CompetitorPriceRow; competitorId?: string }>({ open: false });
  const [deleteCompDialog, setDeleteCompDialog] = useState<CompetitorRow | null>(null);
  const [deletePriceDialog, setDeletePriceDialog] = useState<CompetitorPriceRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const [c, p, s] = await Promise.all([listCompetitors(), listCompetitorPrices(), listSkusFlat()]);
      setCompetitors(c);
      setPrices(p);
      setSkus(s);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Group prices by competitor
  const pricesByComp = useMemo(() => {
    const map = new Map<string, CompetitorPriceRow[]>();
    for (const p of prices) {
      const arr = map.get(p.competitor_id) ?? [];
      arr.push(p);
      map.set(p.competitor_id, arr);
    }
    return map;
  }, [prices]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return competitors;
    return competitors.filter((c) => c.name.toLowerCase().includes(term));
  }, [competitors, q]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Intelligence</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Competitor Pricing</h1>
        </div>
        <Button onClick={() => setCompetitorDialog({ open: true })}>
          <Plus className="h-4 w-4 mr-2" />
          Add Competitor
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search competitors…"
          className="pl-9 h-11"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <Store className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-medium text-foreground">No competitors yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Add competitors and log their prices to compare against your products.
          </p>
          <Button onClick={() => setCompetitorDialog({ open: true })}>
            <Plus className="h-4 w-4 mr-2" />
            Add first competitor
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((comp) => {
            const compPrices = pricesByComp.get(comp.id) ?? [];
            const isExpanded = expanded.has(comp.id);
            return (
              <div key={comp.id} className="glass overflow-hidden">
                {/* Competitor header */}
                <div className="p-4 flex items-center justify-between gap-3">
                  <button
                    onClick={() => toggleExpanded(comp.id)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <div className="h-10 w-10 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">
                      <Store className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{comp.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {compPrices.length} price{compPrices.length !== 1 ? "s" : ""} logged
                        {comp.notes && <> · {comp.notes}</>}
                      </p>
                    </div>
                    {isExpanded
                      ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setPriceDialog({ open: true, competitorId: comp.id })}
                      className="text-xs text-primary hover:opacity-80 px-2 py-1 rounded-lg hover:bg-primary/10 transition"
                    >
                      + Price
                    </button>
                    <button
                      onClick={() => setCompetitorDialog({ open: true, editing: comp })}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteCompDialog(comp)}
                      className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Price rows */}
                {isExpanded && compPrices.length > 0 && (
                  <div className="border-t border-border">
                    {compPrices.map((p) => {
                      const sku = skus.find((s) => s.variant_id === p.variant_id);
                      return (
                        <div key={p.id} className="px-4 py-3 flex items-start justify-between gap-3 border-b border-border/50 last:border-0 hover:bg-accent/20 transition">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-foreground">
                              {sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "Unknown variant"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              <span className="text-foreground font-medium">{Number(p.price_mvr).toLocaleString(undefined, { maximumFractionDigits: 2 })} MVR</span>
                              {" "}{priceBasisLabel(p.price_basis)}
                              {p.their_pcs_per_pack && <> · {p.their_pcs_per_pack} pcs/pk</>}
                              {" · "}{new Date(p.observed_date).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                            </p>
                            {p.notes && <p className="text-[11px] text-muted-foreground mt-0.5">{p.notes}</p>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => setPriceDialog({ open: true, editing: p, competitorId: p.competitor_id })}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setDeletePriceDialog(p)}
                              className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {isExpanded && compPrices.length === 0 && (
                  <div className="border-t border-border px-4 py-4 text-center">
                    <p className="text-sm text-muted-foreground">No prices logged yet.</p>
                    <button
                      onClick={() => setPriceDialog({ open: true, competitorId: comp.id })}
                      className="text-xs text-primary hover:opacity-80 mt-1"
                    >
                      Log first price
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Competitor add/edit dialog */}
      <CompetitorDialog
        open={competitorDialog.open}
        editing={competitorDialog.editing}
        onOpenChange={(o) => { if (!o) setCompetitorDialog({ open: false }); }}
        onDone={() => { setCompetitorDialog({ open: false }); load(); }}
      />

      {/* Price add/edit dialog */}
      <PriceDialog
        open={priceDialog.open}
        editing={priceDialog.editing}
        competitorId={priceDialog.competitorId}
        competitors={competitors}
        skus={skus}
        onOpenChange={(o) => { if (!o) setPriceDialog({ open: false }); }}
        onDone={() => { setPriceDialog({ open: false }); load(); }}
      />

      {/* Delete competitor dialog */}
      <Dialog open={!!deleteCompDialog} onOpenChange={(o) => { if (!o) setDeleteCompDialog(null); }}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Delete competitor?</DialogTitle>
            </div>
            <DialogDescription>
              <strong>{deleteCompDialog?.name}</strong> and all their logged prices will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteCompDialog(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleting}
              onClick={async () => {
                if (!deleteCompDialog) return;
                setDeleting(true);
                try {
                  await deleteCompetitor(deleteCompDialog.id);
                  toast.success("Competitor removed");
                  setDeleteCompDialog(null);
                  load();
                } catch (e) { toast.error((e as Error).message); }
                finally { setDeleting(false); }
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete price dialog */}
      <Dialog open={!!deletePriceDialog} onOpenChange={(o) => { if (!o) setDeletePriceDialog(null); }}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Remove price entry?</DialogTitle>
            </div>
            <DialogDescription>This price record will be permanently deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeletePriceDialog(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleting}
              onClick={async () => {
                if (!deletePriceDialog) return;
                setDeleting(true);
                try {
                  await deleteCompetitorPrice(deletePriceDialog.id);
                  toast.success("Price removed");
                  setDeletePriceDialog(null);
                  load();
                } catch (e) { toast.error((e as Error).message); }
                finally { setDeleting(false); }
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Competitor dialog ────────────────────────────────────────────────────

function CompetitorDialog({
  open, editing, onOpenChange, onDone,
}: {
  open: boolean;
  editing?: CompetitorRow;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(editing?.name ?? ""); setNotes(editing?.notes ?? ""); }
  }, [open, editing]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) await updateCompetitor(editing.id, { name: name.trim(), notes: notes.trim() || null });
      else await createCompetitor(name.trim(), notes.trim() || null);
      toast.success(editing ? "Updated" : "Competitor added");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit competitor" : "Add competitor"}</DialogTitle>
          <DialogDescription>Track a competitor's prices against your own products.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Novelty" />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Price dialog ──────────────────────────────────────────────────────────

function PriceDialog({
  open, editing, competitorId, competitors, skus, onOpenChange, onDone,
}: {
  open: boolean;
  editing?: CompetitorPriceRow;
  competitorId?: string;
  competitors: CompetitorRow[];
  skus: SkuFullRow[];
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [selectedCompId, setSelectedCompId] = useState(competitorId ?? "");
  const [variantId, setVariantId] = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const [priceMvr, setPriceMvr] = useState("");
  const [priceBasis, setPriceBasis] = useState<PriceBasis>("per_pack");
  const [theirPcsPerPack, setTheirPcsPerPack] = useState("");
  const [observedDate, setObservedDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedCompId(competitorId ?? editing?.competitor_id ?? "");
      setVariantId(editing?.variant_id ?? "");
      setPriceMvr(editing ? String(editing.price_mvr) : "");
      setPriceBasis(editing?.price_basis ?? "per_pack");
      setTheirPcsPerPack(editing?.their_pcs_per_pack ? String(editing.their_pcs_per_pack) : "");
      setObservedDate(editing?.observed_date ?? new Date().toISOString().slice(0, 10));
      setNotes(editing?.notes ?? "");
      setSkuSearch("");
    }
  }, [open, editing, competitorId]);

  // Deduplicate variants for display
  const uniqueVariants = useMemo(() => {
    const seen = new Set<string>();
    return skus.filter((s) => {
      if (seen.has(s.variant_id)) return false;
      seen.add(s.variant_id);
      return true;
    });
  }, [skus]);

  const filteredVariants = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    if (!term) return uniqueVariants.slice(0, 30);
    return uniqueVariants
      .filter((s) => [s.brand_name, s.model_name, s.variant_display].join(" ").toLowerCase().includes(term))
      .slice(0, 30);
  }, [uniqueVariants, skuSearch]);

  const selectedSku = skus.find((s) => s.variant_id === variantId);

  async function save() {
    if (!selectedCompId || !variantId || !priceMvr) return;
    setSaving(true);
    try {
      const payload = {
        competitor_id: selectedCompId,
        variant_id: variantId,
        price_mvr: parseFloat(priceMvr),
        price_basis: priceBasis,
        their_pcs_per_pack: theirPcsPerPack ? parseInt(theirPcsPerPack) : null,
        observed_date: observedDate,
        notes: notes.trim() || null,
      };
      if (editing) await updateCompetitorPrice(editing.id, payload);
      else await createCompetitorPrice(payload);
      toast.success(editing ? "Price updated" : "Price logged");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit price" : "Log competitor price"}</DialogTitle>
          <DialogDescription>Record what a competitor charges for a product we also carry.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          {/* Competitor */}
          <div className="space-y-2">
            <Label>Competitor *</Label>
            <Select value={selectedCompId} onValueChange={(v) => v && setSelectedCompId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Pick competitor">
                  {competitors.find((c) => c.id === selectedCompId)?.name ?? "Pick competitor"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {competitors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Product (variant) */}
          <div className="space-y-2">
            <Label>Product *</Label>
            {!variantId ? (
              <>
                <Input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} placeholder="Search brand, model…" autoFocus={!editing} />
                <div className="rounded-xl border border-border max-h-[200px] overflow-y-auto bg-background/50">
                  {filteredVariants.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-3 py-2">No matches</p>
                  ) : filteredVariants.map((s) => (
                    <button
                      key={s.variant_id}
                      onClick={() => setVariantId(s.variant_id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent/30 transition border-b border-border last:border-0"
                    >
                      <p className="text-foreground">{s.brand_name} › {s.model_name} › {s.variant_display}</p>
                      <p className="text-[11px] text-muted-foreground">{s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn</p>
                    </button>
                  ))}
                </div>
              </>
            ) : selectedSku ? (
              <div className="rounded-xl border border-border p-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-foreground">{selectedSku.brand_name} › {selectedSku.model_name} › {selectedSku.variant_display}</p>
                  <p className="text-[11px] text-muted-foreground">{selectedSku.pcs_per_pack}/pk × {selectedSku.packs_per_carton}/ctn</p>
                </div>
                <button onClick={() => setVariantId("")} className="text-xs text-primary hover:opacity-80 shrink-0">Change</button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Their price (MVR) *</Label>
              <Input type="number" step="0.01" min="0" value={priceMvr} onChange={(e) => setPriceMvr(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Price basis *</Label>
              <Select value={priceBasis} onValueChange={(v) => v && setPriceBasis(v as PriceBasis)}>
                <SelectTrigger><SelectValue>{BASIS_LABEL[priceBasis]}</SelectValue></SelectTrigger>
                <SelectContent>
                  {(Object.keys(BASIS_LABEL) as PriceBasis[]).map((b) => (
                    <SelectItem key={b} value={b}>{BASIS_LABEL[b]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Their pcs/pack</Label>
              <Input type="number" min="1" value={theirPcsPerPack} onChange={(e) => setTheirPcsPerPack(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Date observed *</Label>
              <Input type="date" value={observedDate} onChange={(e) => setObservedDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" placeholder="e.g. Promotion price, seen at Novelty Maafannu" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !selectedCompId || !variantId || !priceMvr}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Log price"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

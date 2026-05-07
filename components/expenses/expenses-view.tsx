"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Plus, Megaphone, Pencil, Trash2, AlertTriangle, Search,
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
  listMarketingSpend,
  createMarketingSpend,
  updateMarketingSpend,
  deleteMarketingSpend,
  type MarketingSpendRow,
  type SpendChannel,
} from "@/lib/queries/expenses";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";

const CHANNEL_LABEL: Record<SpendChannel, string> = {
  meta_boost: "Meta Boost (FB/IG)",
  google: "Google Ads",
  tiktok_ad: "TikTok Ads",
  other: "Other",
};

const CHANNEL_COLOR: Record<SpendChannel, string> = {
  meta_boost: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  google: "bg-red-500/15 text-red-500 dark:text-red-300",
  tiktok_ad: "bg-pink-500/15 text-pink-600 dark:text-pink-300",
  other: "bg-muted text-muted-foreground",
};

export function ExpensesView() {
  const [rows, setRows] = useState<MarketingSpendRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [spendDialog, setSpendDialog] = useState<{ open: boolean; editing?: MarketingSpendRow }>({ open: false });
  const [deleteDialog, setDeleteDialog] = useState<MarketingSpendRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([listMarketingSpend(), listSkusFlat()]);
      setRows(r);
      setSkus(s);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const totalMvr = useMemo(() => rows.reduce((a, r) => a + Number(r.amount_mvr), 0), [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.campaign_name ?? "", CHANNEL_LABEL[r.channel], r.notes ?? ""].join(" ").toLowerCase().includes(term),
    );
  }, [rows, q]);

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
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Operations</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Marketing Spend</h1>
        </div>
        <Button onClick={() => setSpendDialog({ open: true })}>
          <Plus className="h-4 w-4 mr-2" />
          Log spend
        </Button>
      </div>

      {/* Summary */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="glass-flat p-4 rounded-xl space-y-1">
            <p className="text-xs text-muted-foreground">Total spend (all time)</p>
            <p className="text-xl font-semibold text-foreground">
              {totalMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-sm font-normal text-muted-foreground">MVR</span>
            </p>
          </div>
          <div className="glass-flat p-4 rounded-xl space-y-1">
            <p className="text-xs text-muted-foreground">Campaigns</p>
            <p className="text-xl font-semibold text-foreground">{rows.length}</p>
          </div>
          <div className="glass-flat p-4 rounded-xl space-y-1 col-span-2 sm:col-span-1">
            <p className="text-xs text-muted-foreground">Biggest channel</p>
            <p className="text-base font-medium text-foreground">
              {(Object.keys(CHANNEL_LABEL) as SpendChannel[])
                .map((ch) => ({
                  ch,
                  total: rows.filter((r) => r.channel === ch).reduce((a, r) => a + Number(r.amount_mvr), 0),
                }))
                .sort((a, b) => b.total - a.total)[0]
                ? CHANNEL_LABEL[(Object.keys(CHANNEL_LABEL) as SpendChannel[])
                    .map((ch) => ({
                      ch,
                      total: rows.filter((r) => r.channel === ch).reduce((a, r) => a + Number(r.amount_mvr), 0),
                    }))
                    .sort((a, b) => b.total - a.total)[0].ch]
                : "—"}
            </p>
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search campaigns…"
          className="pl-9 h-11"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <Megaphone className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-medium text-foreground">
            {rows.length === 0 ? "No marketing spend yet" : "No matches"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {rows.length === 0
              ? "Log your Meta boosts, TikTok ads, and other marketing costs here."
              : "Try a different search."}
          </p>
          {rows.length === 0 && (
            <Button onClick={() => setSpendDialog({ open: true })}>
              <Plus className="h-4 w-4 mr-2" />
              Log first spend
            </Button>
          )}
        </div>
      ) : (
        <div className="glass divide-y divide-border overflow-hidden">
          {filtered.map((r) => {
            const linkedSkus = (r.sku_ids ?? [])
              .map((sid) => skus.find((s) => s.id === sid))
              .filter(Boolean) as SkuFullRow[];
            return (
              <div key={r.id} className="p-4 flex items-start justify-between gap-3 hover:bg-accent/30 transition">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${CHANNEL_COLOR[r.channel]}`}>
                    <Megaphone className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">
                        {r.campaign_name ?? CHANNEL_LABEL[r.channel]}
                      </p>
                      <span className={`text-[10px] uppercase tracking-wider rounded px-2 py-0.5 ${CHANNEL_COLOR[r.channel]}`}>
                        {CHANNEL_LABEL[r.channel]}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="text-foreground font-medium">{Number(r.amount_mvr).toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR</span>
                      {" · "}{new Date(r.start_date).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                      {r.end_date && <> → {new Date(r.end_date).toLocaleDateString("en-MV", { day: "numeric", month: "short" })}</>}
                    </p>
                    {linkedSkus.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        SKUs: {linkedSkus.map((s) => `${s.brand_name} ${s.variant_display}`).join(", ")}
                      </p>
                    )}
                    {r.notes && <p className="text-[11px] text-muted-foreground mt-0.5">{r.notes}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setSpendDialog({ open: true, editing: r })}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteDialog(r)}
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

      <SpendDialog
        open={spendDialog.open}
        editing={spendDialog.editing}
        skus={skus}
        onOpenChange={(o) => { if (!o) setSpendDialog({ open: false }); }}
        onDone={() => { setSpendDialog({ open: false }); load(); }}
      />

      <Dialog open={!!deleteDialog} onOpenChange={(o) => { if (!o) setDeleteDialog(null); }}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Delete spend record?</DialogTitle>
            </div>
            <DialogDescription>
              <strong>{deleteDialog?.campaign_name ?? CHANNEL_LABEL[deleteDialog?.channel ?? "other"]}</strong> will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDialog(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleting}
              onClick={async () => {
                if (!deleteDialog) return;
                setDeleting(true);
                try {
                  await deleteMarketingSpend(deleteDialog.id);
                  toast.success("Deleted");
                  setDeleteDialog(null);
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

// ── Spend dialog ──────────────────────────────────────────────────────────

function SpendDialog({
  open, editing, skus, onOpenChange, onDone,
}: {
  open: boolean;
  editing?: MarketingSpendRow;
  skus: SkuFullRow[];
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [channel, setChannel] = useState<SpendChannel>("meta_boost");
  const [amountMvr, setAmountMvr] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedSkuIds, setSelectedSkuIds] = useState<string[]>([]);
  const [skuSearch, setSkuSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setChannel(editing?.channel ?? "meta_boost");
      setAmountMvr(editing ? String(editing.amount_mvr) : "");
      setCampaignName(editing?.campaign_name ?? "");
      setStartDate(editing?.start_date ?? new Date().toISOString().slice(0, 10));
      setEndDate(editing?.end_date ?? "");
      setNotes(editing?.notes ?? "");
      setSelectedSkuIds(editing?.sku_ids ?? []);
      setSkuSearch("");
    }
  }, [open, editing]);

  const filteredSkus = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    if (!term) return skus.filter((s) => s.is_active).slice(0, 30);
    return skus.filter((s) => s.is_active &&
      [s.brand_name, s.model_name, s.variant_display].join(" ").toLowerCase().includes(term),
    ).slice(0, 30);
  }, [skus, skuSearch]);

  function toggleSku(id: string) {
    setSelectedSkuIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function save() {
    if (!amountMvr || parseFloat(amountMvr) <= 0) { toast.error("Enter an amount"); return; }
    if (endDate && endDate < startDate) { toast.error("End date must be on or after start date"); return; }
    setSaving(true);
    try {
      const payload = {
        channel,
        amount_mvr: parseFloat(amountMvr),
        campaign_name: campaignName.trim() || null,
        start_date: startDate,
        end_date: endDate || null,
        notes: notes.trim() || null,
        sku_ids: selectedSkuIds,
      };
      if (editing) await updateMarketingSpend(editing.id, payload);
      else await createMarketingSpend(payload);
      toast.success(editing ? "Updated" : "Spend logged");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit spend" : "Log marketing spend"}</DialogTitle>
          <DialogDescription>Track what you spend on ads and promotions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Channel *</Label>
              <Select value={channel} onValueChange={(v) => v && setChannel(v as SpendChannel)}>
                <SelectTrigger><SelectValue>{CHANNEL_LABEL[channel]}</SelectValue></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHANNEL_LABEL) as SpendChannel[]).map((c) => (
                    <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount (MVR) *</Label>
              <Input type="number" step="0.01" min="0" value={amountMvr} onChange={(e) => setAmountMvr(e.target.value)} autoFocus={!editing} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Campaign name</Label>
            <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. Eid Sale — Aiko" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Start date *</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          {/* SKU picker */}
          <div className="space-y-2">
            <Label>Linked SKUs <span className="text-muted-foreground font-normal">(optional)</span></Label>
            {selectedSkuIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {selectedSkuIds.map((sid) => {
                  const s = skus.find((sk) => sk.id === sid);
                  return s ? (
                    <span key={sid} className="text-[11px] bg-primary/10 text-primary rounded px-2 py-0.5 flex items-center gap-1">
                      {s.brand_name} {s.variant_display}
                      <button onClick={() => toggleSku(sid)} className="hover:opacity-70">×</button>
                    </span>
                  ) : null;
                })}
              </div>
            )}
            <Input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} placeholder="Search SKUs to link…" />
            <div className="rounded-xl border border-border max-h-[160px] overflow-y-auto bg-background/50">
              {filteredSkus.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-2">No matches</p>
              ) : filteredSkus.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleSku(s.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent/30 transition border-b border-border last:border-0 ${selectedSkuIds.includes(s.id) ? "bg-primary/10" : ""}`}
                >
                  <span className="text-foreground">{s.brand_name} › {s.model_name} › {s.variant_display}</span>
                  {selectedSkuIds.includes(s.id) && <span className="text-primary ml-2 text-xs">✓</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !amountMvr}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Log spend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "sonner";
import { Loader2, Warehouse, ChevronDown, Plus, Pencil, Trash2, Star, X, Check } from "lucide-react";
import { listBatchStock, type BatchStock } from "@/lib/queries/inventory";
import { listSkusFlat, type SkuFullRow, getCurrentUserRole } from "@/lib/queries/products";
import {
  listGodowns, createGodown, updateGodown, deleteGodown,
  type GodownRow, type GodownInput,
} from "@/lib/queries/masters";
import { Input } from "@/components/ui/input";

/* ── Helpers ── */

function toCtns(pcs: number, pcsPerCtn: number) {
  return pcsPerCtn > 0 ? Math.floor(pcs / pcsPerCtn) : 0;
}
function remPacks(pcs: number, pcsPerPack: number, pcsPerCtn: number) {
  const rem = pcsPerCtn > 0 ? pcs % pcsPerCtn : pcs;
  return pcsPerPack > 0 ? Math.floor(rem / pcsPerPack) : 0;
}
function fmtMvr(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-MV", { maximumFractionDigits: 0 });
}
function fmtQty(pcs: number, pcsPerPack: number, pcsPerCtn: number) {
  const ctns  = toCtns(pcs, pcsPerCtn);
  const packs = remPacks(pcs, pcsPerPack, pcsPerCtn);
  if (ctns > 0 && packs > 0) return `${ctns} ctn + ${packs} pk`;
  if (ctns > 0) return `${ctns} ctn`;
  if (packs > 0) return `${packs} pk`;
  return `${pcs} pcs`;
}

/* ── Types ── */

interface SkuSlot {
  sku: SkuFullRow;
  pieces: number;
  value: number;
  batches: BatchStock[];
}

interface GodownGroup {
  godown: GodownRow;
  skus: SkuSlot[];
  totalCartons: number;
  totalValue: number;
}

/* ── Inline edit form that replaces the godown card header ── */

function GodownEditRow({
  godown,
  onSave,
  onCancel,
}: {
  godown?: GodownRow;
  onSave: (name: string, location: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName]       = useState(godown?.name ?? "");
  const [location, setLoc]    = useState(godown?.location ?? "");
  const [saving, setSaving]   = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave(name.trim(), location.trim()); }
    finally { setSaving(false); }
  }

  return (
    <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
      <Warehouse className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
      <Input
        autoFocus
        className="h-10 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Godown name *"
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
      />
      <Input
        className="h-10 flex-1"
        value={location}
        onChange={(e) => setLoc(e.target.value)}
        placeholder="Location (optional)"
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
      />
      <button
        onClick={submit}
        disabled={saving || !name.trim()}
        className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition active:scale-90 disabled:opacity-40"
        style={{ background: "var(--foreground)", color: "var(--background)" }}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button
        onClick={onCancel}
        className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition active:scale-90"
        style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ── SKU row inside a godown card ── */

function SkuRow({ slot }: { slot: SkuSlot }) {
  const { sku, pieces, value, batches } = slot;
  const [expanded, setExpanded] = useState(false);
  const pcsPerCtn = sku.pcs_per_pack * sku.packs_per_carton;
  const qty = fmtQty(pieces, sku.pcs_per_pack, pcsPerCtn);
  const ctns = pcsPerCtn > 0 ? Math.floor(pieces / pcsPerCtn) : 0;

  // Visual urgency accent — IDEO: colour as primary signal, no text needed
  const urgency = ctns <= 2 ? "critical" : ctns <= 6 ? "low" : "ok";
  const urgencyColor =
    urgency === "critical" ? "var(--snm-error)"
    : urgency === "low"    ? "var(--snm-warning)"
    : "transparent";

  return (
    <div style={{ borderLeft: urgency !== "ok" ? `3px solid ${urgencyColor}` : "3px solid transparent", marginLeft: -2, paddingLeft: urgency !== "ok" ? 8 : 0, borderRadius: urgency !== "ok" ? "0 0 0 0" : undefined }}>
      <button
        className="w-full flex items-center justify-between py-3.5 text-left"
        style={{ borderBottom: "1px solid color-mix(in srgb, var(--foreground) 5%, transparent)" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-foreground truncate">
            {sku.brand_name} · {sku.model_name}
            {sku.variant_display
              ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {sku.variant_display}</span>
              : null}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            {sku.internal_code}
            {urgency !== "ok" && (
              <span className="ml-2 font-bold" style={{ color: urgencyColor }}>
                {urgency === "critical" ? "· critically low" : "· low stock"}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 ml-3 shrink-0">
          <div className="text-right">
            <p className="text-[14px] font-bold text-foreground">{qty}</p>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>MVR {fmtMvr(value)}</p>
          </div>
          <ChevronDown
            className="h-4 w-4 transition-transform duration-200 shrink-0"
            style={{ color: "var(--muted-foreground)", transform: expanded ? "rotate(180deg)" : "none" }}
          />
        </div>
      </button>

      {/* Batch rows */}
      {expanded && (
        <div className="py-2 pl-2 space-y-1">
          {[...batches]
            .sort((a, b) => a.received_at.localeCompare(b.received_at))
            .map((b, i) => {
              const bQty  = fmtQty(b.qty_pieces_remaining, sku.pcs_per_pack, pcsPerCtn);
              const bDate = new Date(b.received_at).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "2-digit" });
              return (
                <div
                  key={b.batch_id}
                  className="flex items-center justify-between px-3 py-2 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}
                >
                  <div className="flex items-center gap-2">
                    {i === 0 && (
                      <span
                        className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: "color-mix(in srgb, var(--foreground) 12%, transparent)", color: "var(--foreground)" }}
                      >
                        FIFO
                      </span>
                    )}
                    <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                      {bDate} · #{b.batch_id.slice(-6).toUpperCase()}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[13px] font-semibold text-foreground">{bQty}</span>
                    <span className="text-[11px] ml-1.5" style={{ color: "var(--muted-foreground)" }}>
                      MVR {b.landed_per_piece_mvr.toFixed(2)}/pc
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

/* ── Godown card ── */

function GodownCard({
  group,
  isAdmin,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  group: GodownGroup;
  isAdmin: boolean;
  onEdit: (g: GodownRow) => void;
  onSetDefault: (g: GodownRow) => void;
  onDelete: (g: GodownRow) => void;
}) {
  const [open, setOpen] = useState(true);
  const { godown, skus, totalCartons, totalValue } = group;
  const hasStock = skus.length > 0;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--glass-1)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: "var(--glass-shadow), var(--glass-inner)",
        border: "0.5px solid var(--glass-border-lo)",
      }}
    >
      {/* Header */}
      <div className="flex items-center px-4 py-3.5" style={{ borderBottom: open && hasStock ? "1px solid color-mix(in srgb, var(--foreground) 6%, transparent)" : "none" }}>
        {/* Icon + name — tappable to expand if has stock */}
        <button
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
          onClick={() => hasStock && setOpen(!open)}
        >
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: godown.is_default
                ? "color-mix(in srgb, var(--snm-brand) 15%, transparent)"
                : "color-mix(in srgb, var(--foreground) 8%, transparent)",
            }}
          >
            <Warehouse
              className="h-4 w-4"
              style={{ color: godown.is_default ? "var(--snm-brand)" : "var(--foreground)" }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[15px] font-semibold text-foreground">{godown.name}</p>
              {godown.is_default && (
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: "var(--snm-brand-muted)", color: "var(--snm-brand)" }}
                >
                  Default
                </span>
              )}
            </div>
            {godown.location
              ? <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>{godown.location}</p>
              : null}
          </div>
          {hasStock && (
            <div className="text-right shrink-0 ml-2">
              <p className="text-[14px] font-bold text-foreground">{totalCartons.toLocaleString()} ctn</p>
              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>MVR {fmtMvr(totalValue)}</p>
            </div>
          )}
          {!hasStock && (
            <p className="text-[12px] shrink-0 ml-2" style={{ color: "var(--muted-foreground)" }}>Empty</p>
          )}
          {hasStock && (
            <ChevronDown
              className="h-4 w-4 ml-2 transition-transform duration-200 shrink-0"
              style={{ color: "var(--muted-foreground)", transform: open ? "rotate(180deg)" : "none" }}
            />
          )}
        </button>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 ml-2 shrink-0">
          {!godown.is_default && (
            <button
              onClick={() => onSetDefault(godown)}
              className="h-9 w-9 rounded-xl flex items-center justify-center transition active:scale-90"
              style={{ color: "var(--muted-foreground)" }}
              title="Set as default"
            >
              <Star className="h-4 w-4" />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => onEdit(godown)}
              className="h-9 w-9 rounded-xl flex items-center justify-center transition active:scale-90"
              style={{ color: "var(--muted-foreground)" }}
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => onDelete(godown)}
              className="h-9 w-9 rounded-xl flex items-center justify-center transition active:scale-90"
              style={{ color: "var(--snm-error)" }}
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* SKU list */}
      {open && hasStock && (
        <div className="px-5 pb-2">
          {skus.map((slot) => <SkuRow key={slot.sku.id} slot={slot} />)}
        </div>
      )}
    </div>
  );
}

/* ── Main ── */

export function GodownsView() {
  const [skus, setSkus]       = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [batches, setBatches] = useState<BatchStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole]       = useState<string | null>(null);

  // Inline create/edit state
  const [showNew, setShowNew]           = useState(false);
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [confirmGodown, setConfirmGodown] = useState<GodownRow | null>(null);

  const isAdmin = role === "admin" || role === "manager";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, g, b] = await Promise.all([listSkusFlat(), listGodowns(), listBatchStock()]);
      setSkus(s); setGodowns(g); setBatches(b);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);

  const groups = useMemo<GodownGroup[]>(() => {
    return godowns.map((godown) => {
      const godownBatches = batches.filter((b) => b.godown_id === godown.id && b.qty_pieces_remaining > 0);

      const skuMap = new Map<string, { pieces: number; value: number; batches: BatchStock[] }>();
      for (const b of godownBatches) {
        const entry = skuMap.get(b.sku_id) ?? { pieces: 0, value: 0, batches: [] };
        entry.pieces += b.qty_pieces_remaining;
        entry.value  += b.qty_pieces_remaining * b.landed_per_piece_mvr;
        entry.batches.push(b);
        skuMap.set(b.sku_id, entry);
      }

      const skuSlots: SkuSlot[] = Array.from(skuMap.entries())
        .map(([skuId, entry]) => {
          const sku = skus.find((s) => s.id === skuId);
          return sku ? { sku, ...entry } : null;
        })
        .filter((x): x is SkuSlot => x !== null)
        .sort((a, b) => b.value - a.value);

      const totalCartons = skuSlots.reduce((sum, s) => {
        const pcsPerCtn = s.sku.pcs_per_pack * s.sku.packs_per_carton;
        return sum + toCtns(s.pieces, pcsPerCtn);
      }, 0);
      const totalValue = skuSlots.reduce((sum, s) => sum + s.value, 0);

      return { godown, skus: skuSlots, totalCartons, totalValue };
    })
    // Show godowns with stock first, then empty — never hide any
    .sort((a, b) => b.totalValue - a.totalValue);
  }, [godowns, batches, skus]);

  async function handleCreate(name: string, location: string) {
    const payload: GodownInput = { name, location: location || null };
    // First godown auto-becomes default
    if (godowns.length === 0) payload.is_default = true;
    await createGodown(payload);
    toast.success("Godown created");
    setShowNew(false);
    await load();
  }

  async function handleUpdate(id: string, name: string, location: string) {
    await updateGodown(id, { name, location: location || null });
    toast.success("Saved");
    setEditingId(null);
    await load();
  }

  async function handleSetDefault(godown: GodownRow) {
    try {
      const current = godowns.find((g) => g.is_default);
      if (current && current.id !== godown.id) {
        await updateGodown(current.id, { is_default: false });
      }
      await updateGodown(godown.id, { is_default: true });
      toast.success(`${godown.name} is now the default`);
      await load();
    } catch (e) { toast.error((e as Error).message); }
  }

  function handleDelete(godown: GodownRow) {
    if (godown.is_default) {
      toast.error("Cannot delete the default godown — set another as default first.");
      return;
    }
    const hasStock = groups.find((g) => g.godown.id === godown.id)?.skus.length ?? 0;
    if (hasStock > 0) {
      toast.error("Cannot delete a godown that has stock in it.");
      return;
    }
    setConfirmGodown(godown);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  const stockedCount = groups.filter((g) => g.skus.length > 0).length;
  const totalValue   = groups.reduce((s, g) => s + g.totalValue, 0);

  return (
    <div className="space-y-3 pb-28 lg:pb-10">

      {/* ── Page header ── */}
      <div>
        <p className="label-caps text-[11px] mb-1" style={{ color: "var(--muted-foreground)" }}>Catalogue</p>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Godowns</h1>
      </div>

      {/* Summary + New Godown button */}
      <div
        className="rounded-2xl px-4 py-3.5 flex items-center justify-between"
        style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}
      >
        <div>
          <p className="text-[15px] font-semibold text-foreground">
            {godowns.length} godown{godowns.length !== 1 ? "s" : ""}
          </p>
          {totalValue > 0 && (
            <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              {stockedCount} with stock · MVR {fmtMvr(totalValue)} total
            </p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowNew(true); setEditingId(null); }}
            className="h-10 px-4 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 transition active:scale-95"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Plus className="h-4 w-4" />
            New
          </button>
        )}
      </div>

      {/* Inline new godown form */}
      {showNew && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--glass-1)", border: "1px solid var(--snm-brand-border)" }}
        >
          <GodownEditRow
            onSave={handleCreate}
            onCancel={() => setShowNew(false)}
          />
        </div>
      )}

      {/* Empty state — no godowns at all */}
      {godowns.length === 0 && !showNew && (
        <div
          className="rounded-2xl p-10 text-center"
          style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)" }}
        >
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: "var(--snm-brand-muted)" }}
          >
            <Warehouse className="h-6 w-6" style={{ color: "var(--snm-brand)" }} />
          </div>
          <p className="text-[15px] font-semibold text-foreground">No godowns yet</p>
          <p className="text-[13px] mt-1 mb-4" style={{ color: "var(--muted-foreground)" }}>
            Add your warehouses and storage locations. Stock is tracked per godown.
          </p>
          <button
            onClick={() => setShowNew(true)}
            className="h-11 px-5 rounded-xl text-[13px] font-semibold transition active:scale-95"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            Add first godown
          </button>
        </div>
      )}

      {/* Godown cards */}
      {groups.map((group) => (
        editingId === group.godown.id ? (
          <div
            key={group.godown.id}
            className="rounded-2xl overflow-hidden"
            style={{ background: "var(--glass-1)", border: "1px solid var(--snm-brand-border)" }}
          >
            <GodownEditRow
              godown={group.godown}
              onSave={(name, loc) => handleUpdate(group.godown.id, name, loc)}
              onCancel={() => setEditingId(null)}
            />
            {/* Keep stock visible below edit row */}
            {group.skus.length > 0 && (
              <div className="px-5 pb-2 pt-1">
                {group.skus.map((slot) => <SkuRow key={slot.sku.id} slot={slot} />)}
              </div>
            )}
          </div>
        ) : (
          <GodownCard
            key={group.godown.id}
            group={group}
            isAdmin={isAdmin}
            onEdit={(g) => { setEditingId(g.id); setShowNew(false); }}
            onSetDefault={handleSetDefault}
            onDelete={handleDelete}
          />
        )
      ))}

      <ConfirmSheet
        open={confirmGodown !== null}
        onClose={() => setConfirmGodown(null)}
        title="Delete godown?"
        message={confirmGodown ? `"${confirmGodown.name}" will be permanently deleted.` : ""}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmGodown) return;
          try { await deleteGodown(confirmGodown.id); toast.success("Deleted"); setConfirmGodown(null); await load(); }
          catch (e) { toast.error((e as Error).message); }
        }}
      />
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "sonner";
import {
  Loader2, Tag, Plus, Trash2, Pencil, ChevronRight, X,
} from "lucide-react";
import { listSkusFlat, getCurrentUserRole, type SkuFullRow } from "@/lib/queries/products";
import {
  listPriceLists, createPriceList, deletePriceList,
  listPriceListItems, upsertPriceListItem, deletePriceListItem,
  type PriceListRow, type PriceListItemRow,
} from "@/lib/queries/pricelists";
import type { PriceTier } from "@/lib/queries/masters";

/* ── Tier config ──────────────────────────────────────────────────────────── */
const TIERS: { value: PriceTier; label: string; color: string }[] = [
  { value: "retail",    label: "Retail",    color: "var(--muted-foreground)" },
  { value: "wholesale", label: "Wholesale", color: "var(--snm-warning)"      },
  { value: "vip",       label: "VIP",       color: "var(--snm-brand)"        },
  { value: "promo",     label: "Promo",     color: "var(--snm-success)"      },
];

/* ── Shared UI primitives ─────────────────────────────────────────────────── */
const inputCls =
  "w-full rounded-xl px-4 py-3 text-sm outline-none transition-all focus:ring-1"
  + " bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]"
  + " text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
  + " border border-[var(--glass-border)] focus:ring-[var(--foreground)]";

function SheetInput({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>
        {label}{required && " *"}
      </label>
      {children}
    </div>
  );
}

/* ── Main exported component ─────────────────────────────────────────────── */
export function PriceListsView() {
  const [priceLists, setPriceLists] = useState<PriceListRow[]>([]);
  const [skus, setSkus]             = useState<SkuFullRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [openList, setOpenList]     = useState<PriceListRow | null>(null);
  const [newListTier, setNewListTier] = useState<PriceTier | null>(null);
  const [createdList, setCreatedList] = useState<PriceListRow | null>(null);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleting, setConfirmDeleting] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    getCurrentUserRole().then((r) => setCanWrite(r !== "viewer")).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [pl, sk] = await Promise.all([listPriceLists(), listSkusFlat()]);
      setPriceLists(pl);
      setSkus(sk);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Lock body scroll when any full-screen overlay is open — prevents iOS bleed-through
  const overlayOpen = !!(openList || newListTier);
  useEffect(() => {
    if (overlayOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [overlayOpen]);

  async function handleDelete(id: string, name: string) {
    setConfirmDelete({ id, name });
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setConfirmDeleting(true);
    try {
      await deletePriceList(confirmDelete.id);
      toast.success("Price list deleted");
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirmDeleting(false);
    }
  }

  const byTier = useMemo(() => {
    const m = new Map<PriceTier, PriceListRow[]>();
    for (const t of TIERS) m.set(t.value, []);
    for (const pl of priceLists) m.get(pl.tier as PriceTier)?.push(pl);
    return m;
  }, [priceLists]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  return (
    <>
      {/* Page header */}
      <div className="mb-5">
        <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Finance</p>
        <h1 className="ios-page-title">Price Lists</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          Tier-specific selling prices per SKU — auto-applied at order entry
        </p>
      </div>

      <div className="space-y-5">
        {TIERS.map(({ value: tier, label, color }) => {
          const lists = byTier.get(tier) ?? [];
          return (
            <section
              key={tier}
              className="rounded-2xl p-5"
              style={{
                background: "var(--glass-1)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "0.5px solid var(--glass-border-lo)",
                boxShadow: "var(--glass-shadow), var(--glass-inner)",
              }}
            >
              {/* Tier header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}
                  >
                    <Tag className="h-4 w-4" style={{ color }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{label}</h2>
                      <span
                        className="text-[12px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
                      >
                        {lists.length} list{lists.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                </div>
                {canWrite && (
                  <button
                    onClick={() => { setNewListTier(tier); setCreatedList(null); }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold active:opacity-70 active:scale-95"
                    style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
                  >
                    <Plus className="h-3 w-3" /> New list
                  </button>
                )}
              </div>

              {lists.length === 0 ? (
                <p className="text-xs px-1" style={{ color: "var(--muted-foreground)" }}>
                  No price list yet — all {label.toLowerCase()} customers use SKU default prices.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {lists.map((pl) => (
                    <div
                      key={pl.id}
                      className="flex items-center justify-between px-4 py-3 rounded-xl"
                      style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}
                    >
                      <button
                        className="flex items-center gap-3 min-w-0 flex-1 text-left"
                        onClick={() => setOpenList(pl)}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{pl.name}</p>
                          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                            Effective {new Date(pl.effective_from + "T00:00:00").toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                            {pl.notes ? ` · ${pl.notes}` : ""}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                      </button>
                      {canWrite && (
                        <button
                          onClick={() => handleDelete(pl.id, pl.name)}
                          disabled={deleting === pl.id}
                          className="ml-3 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 active:opacity-60"
                          style={{ color: "var(--snm-error)" }}
                          aria-label="Delete price list"
                        >
                          {deleting === pl.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />
                          }
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* New price list sheet */}
      {newListTier && (
        <NewPriceListWithSkusSheet
          tier={newListTier}
          skus={skus}
          createdList={createdList}
          onListCreated={setCreatedList}
          onClose={() => { setNewListTier(null); setCreatedList(null); }}
          onDone={() => { setNewListTier(null); setCreatedList(null); load(); }}
        />
      )}

      {/* Edit existing price list */}
      {openList && (
        <PriceListItemsSheet
          priceList={openList}
          skus={skus}
          canWrite={canWrite}
          onClose={() => setOpenList(null)}
          onDone={() => { setOpenList(null); load(); }}
        />
      )}

      <ConfirmSheet
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete price list?"
        message={confirmDelete ? `"${confirmDelete.name}" and all its prices will be permanently deleted.` : ""}
        confirmLabel="Delete"
        loading={confirmDeleting}
        onConfirm={doDelete}
      />
    </>
  );
}

/* ── New Price List + SKU prices in one screen ────────────────────────────── */
function NewPriceListWithSkusSheet({ tier, skus, createdList, onListCreated, onClose, onDone }: {
  tier: PriceTier;
  skus: SkuFullRow[];
  createdList: PriceListRow | null;
  onListCreated: (pl: PriceListRow) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = TIERS.find((x) => x.value === tier)!;
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName]                     = useState(`${t.label} Price List`);
  const [effectiveFrom, setEffectiveFrom]   = useState(today);
  const [items, setItems]                   = useState<PriceListItemRow[]>([]);
  const [search, setSearch]                 = useState("");
  const [selectedSkuId, setSelectedSkuId]   = useState("");
  const [showSkuPrice, setShowSkuPrice]     = useState(false);
  const [creatingHeader, setCreatingHeader] = useState(false);
  const [deleting, setDeleting]             = useState<string | null>(null);

  const setSkuIds = useMemo(() => new Set(items.map((i) => i.sku_id)), [items]);
  const filteredSkus = useMemo(() => {
    const term = search.trim().toLowerCase();
    return skus
      .filter((s) => s.is_active && !setSkuIds.has(s.id))
      .filter((s) => !term || [s.brand_name, s.model_name, s.variant_display ?? "", s.internal_code ?? ""].join(" ").toLowerCase().includes(term))
      .slice(0, 40);
  }, [skus, setSkuIds, search]);

  async function ensureList(): Promise<PriceListRow> {
    if (createdList) return createdList;
    setCreatingHeader(true);
    try {
      const pl = await createPriceList({ name: name.trim() || `${t.label} Price List`, tier, effective_from: effectiveFrom, notes: null });
      onListCreated(pl);
      return pl;
    } finally {
      setCreatingHeader(false);
    }
  }

  async function handleSkuSaved(item: PriceListItemRow) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.sku_id === item.sku_id);
      return idx >= 0 ? prev.map((i, n) => n === idx ? item : i) : [...prev, item];
    });
    setShowSkuPrice(false);
    setSelectedSkuId("");
    setSearch("");
  }

  async function handleDelete(itemId: string) {
    setDeleting(itemId);
    try {
      await deletePriceListItem(itemId);
      setItems((p) => p.filter((i) => i.id !== itemId));
      toast.success("Removed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--background)", zIndex: 200 }}>
      {/* Fixed header */}
      <div className="snm-overlay-header px-4">
        <div className="pt-3 pb-3 space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 active:scale-95 transition"
            style={{ background: "var(--glass-1)", color: "var(--muted-foreground)" }}
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: t.color }}>{t.label} Tier</p>
            <p className="text-[15px] font-semibold leading-tight" style={{ color: "var(--foreground)" }}>New Price List</p>
          </div>
          {items.length > 0 ? (
            <button
              onClick={onDone}
              className="px-4 py-2 rounded-full text-xs font-bold active:scale-95 transition"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              Done ({items.length})
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-medium"
              style={{ background: "var(--glass-1)", color: "var(--muted-foreground)" }}
            >
              Cancel
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>List name *</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!createdList}
              placeholder="e.g. Retail Price List"
              className={inputCls + (createdList ? " opacity-50 cursor-not-allowed" : "")}
              style={{ height: 40, fontSize: 13 }}
            />
          </div>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Effective from *</p>
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              disabled={!!createdList}
              min={today}
              className={inputCls + (createdList ? " opacity-50 cursor-not-allowed" : "")}
              style={{ height: 40, fontSize: 13 }}
            />
          </div>
        </div>
        {createdList && (
          <p className="text-[12px] font-medium" style={{ color: "var(--snm-success)" }}>✓ List created — keep adding SKU prices below</p>
        )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-none px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-4">
        {items.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "var(--muted-foreground)" }}>Added ({items.length})</p>
            {items.map((item) => {
              const sku = skus.find((s) => s.id === item.sku_id);
              return (
                <div key={item.id} className="rounded-2xl p-4" style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
                        {sku ? `${sku.brand_name} › ${sku.model_name}` : item.sku_id}
                      </p>
                      {sku?.variant_display && <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{sku.variant_display}</p>}
                    </div>
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={deleting === item.id}
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {deleting === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {[
                      { label: "/ piece",  value: item.price_per_piece_mvr },
                      { label: "/ pack",   value: item.price_per_pack_mvr },
                      { label: "/ carton", value: item.price_per_carton_mvr },
                    ].map((p) => (
                      <div key={p.label} className="rounded-xl px-3 py-2 text-center" style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)" }}>
                        <p className="text-[12px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>{p.label}</p>
                        <p className="text-sm font-semibold snm-num" style={{ color: t.color }}>MVR {Number(p.value).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!showSkuPrice ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "var(--muted-foreground)" }}>Add SKU prices</p>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search brand, SKU, variant…"
              className={inputCls}
            />
            <div className="rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--glass-border-lo)", maxHeight: 280, overflowY: "auto" }}>
              {filteredSkus.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: "var(--muted-foreground)" }}>
                  {search ? "No matches" : skus.filter(s => s.is_active).length === setSkuIds.size ? "All SKUs added" : "Search for a SKU above"}
                </p>
              ) : filteredSkus.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedSkuId(s.id); setShowSkuPrice(true); }}
                  className="w-full text-left px-4 py-3 flex flex-col transition-colors"
                  style={{ borderBottom: "0.5px solid var(--glass-border-lo)", background: "transparent" }}
                >
                  <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                    {s.brand_name} › {s.model_name}
                    {s.variant_display ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {s.variant_display}</span> : null}
                  </p>
                  {s.landed_per_piece_mvr != null && (
                    <p className="text-xs mt-0.5 snm-num" style={{ color: "var(--muted-foreground)" }}>
                      Landed MVR {Number(s.landed_per_piece_mvr).toFixed(3)}/pc
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <SkuPriceEntry
            sku={skus.find((s) => s.id === selectedSkuId) ?? null}
            creatingHeader={creatingHeader}
            onBack={() => { setShowSkuPrice(false); setSelectedSkuId(""); }}
            onSave={async (prices) => {
              try {
                const list = await ensureList();
                await upsertPriceListItem({ price_list_id: list.id, sku_id: selectedSkuId, ...prices });
                const updated = await listPriceListItems(list.id);
                const newItem = updated.find((i) => i.sku_id === selectedSkuId);
                if (newItem) handleSkuSaved(newItem);
                else { setShowSkuPrice(false); setSelectedSkuId(""); }
                toast.success("Price saved");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ── Edit existing price list items ──────────────────────────────────────── */
function PriceListItemsSheet({ priceList, skus, canWrite, onClose, onDone }: {
  priceList: PriceListRow;
  skus: SkuFullRow[];
  canWrite: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = TIERS.find((x) => x.value === priceList.tier)!;
  const [items, setItems]           = useState<PriceListItemRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [addSkuId, setAddSkuId]     = useState("");
  const [addSheet, setAddSheet]     = useState(false);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmRemoving, setConfirmRemoving] = useState(false);

  async function loadItems() {
    setLoading(true);
    try { setItems(await listPriceListItems(priceList.id)); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadItems(); }, [priceList.id]);

  const setSkuIds = useMemo(() => new Set(items.map((i) => i.sku_id)), [items]);
  const filteredSkus = useMemo(() => {
    const term = search.trim().toLowerCase();
    return skus
      .filter((s) => s.is_active && !setSkuIds.has(s.id))
      .filter((s) => !term || [s.brand_name, s.model_name, s.variant_display ?? "", s.internal_code ?? ""].join(" ").toLowerCase().includes(term))
      .slice(0, 40);
  }, [skus, setSkuIds, search]);

  function handleDelete(itemId: string) {
    setConfirmRemove(itemId);
  }

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--background)", zIndex: 200 }}>
      {/* Header */}
      <div className="snm-overlay-header px-5">
      <div className="flex items-center gap-3 pt-4 pb-4">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "var(--glass-1)", color: "var(--muted-foreground)" }}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: t.color }}>{t.label} Tier</p>
          <h2 className="text-base font-semibold truncate" style={{ color: "var(--foreground)" }}>{priceList.name}</h2>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Effective {new Date(priceList.effective_from + "T00:00:00").toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => { setAddSheet(true); setAddSkuId(""); setSearch(""); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold shrink-0 active:scale-95 transition"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Plus className="h-3.5 w-3.5" /> Add SKU
          </button>
        )}
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto overscroll-none px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted-foreground)" }} />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <Tag className="h-8 w-8 mx-auto mb-3 opacity-30" style={{ color: "var(--muted-foreground)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>No SKUs yet</p>
            <p className="text-xs mt-1 mb-5" style={{ color: "var(--muted-foreground)" }}>
              {canWrite ? `Tap "Add SKU" to set prices for this tier` : "No SKUs in this price list yet"}
            </p>
            {canWrite && (
              <button
                onClick={() => { setAddSheet(true); setAddSkuId(""); setSearch(""); }}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-semibold active:scale-95 transition"
                style={{ background: "var(--foreground)", color: "var(--background)" }}
              >
                <Plus className="h-4 w-4" /> Add first SKU
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs px-1 pb-1" style={{ color: "var(--muted-foreground)" }}>
              {items.length} SKU{items.length !== 1 ? "s" : ""} — tap any row to edit prices
            </p>
            {items.map((item) => {
              const sku = skus.find((s) => s.id === item.sku_id);
              const isEditing = editingItemId === item.id;
              return (
                <div
                  key={item.id}
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: "var(--glass-1)",
                    boxShadow: "var(--glass-shadow), var(--glass-inner)",
                    border: isEditing
                      ? `1px solid color-mix(in srgb, ${t.color} 40%, transparent)`
                      : "0.5px solid var(--glass-border-lo)",
                  }}
                >
                  <button
                    className="w-full text-left px-4 py-3 flex items-center gap-3 transition active:bg-black/5"
                    onClick={() => canWrite && setEditingItemId(isEditing ? null : item.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
                        {sku ? `${sku.brand_name} › ${sku.model_name}` : item.sku_id}
                      </p>
                      {sku?.variant_display && (
                        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{sku.variant_display}</p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {[
                        { label: "pc",  value: item.price_per_piece_mvr },
                        { label: "pk",  value: item.price_per_pack_mvr },
                        { label: "ctn", value: item.price_per_carton_mvr },
                      ].map((p) => (
                        <div key={p.label} className="rounded-lg px-2 py-1 text-center" style={{ background: `color-mix(in srgb, ${t.color} 10%, transparent)` }}>
                          <p className="text-[12px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{p.label}</p>
                          <p className="text-[12px] font-bold snm-num" style={{ color: t.color }}>{Number(p.value).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                    {canWrite && (
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: isEditing ? `color-mix(in srgb, ${t.color} 15%, transparent)` : "color-mix(in srgb, var(--foreground) 6%, transparent)" }}
                      >
                        <Pencil className="h-3 w-3" style={{ color: isEditing ? t.color : "var(--muted-foreground)" }} />
                      </div>
                    )}
                  </button>

                  {isEditing && sku && (
                    <div className="px-4 pb-4 pt-1" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                      <SkuPriceEntry
                        sku={sku}
                        initialPrices={{
                          piece:  Number(item.price_per_piece_mvr),
                          pack:   Number(item.price_per_pack_mvr),
                          carton: Number(item.price_per_carton_mvr),
                        }}
                        creatingHeader={false}
                        onBack={() => setEditingItemId(null)}
                        onSave={async (prices) => {
                          await upsertPriceListItem({ price_list_id: priceList.id, sku_id: item.sku_id, ...prices });
                          toast.success("Price updated");
                          setEditingItemId(null);
                          loadItems();
                        }}
                        saveLabel="UPDATE PRICE"
                        extraAction={
                          <button
                            onClick={() => handleDelete(item.id)}
                            disabled={deleting === item.id}
                            className="flex-1 py-3 rounded-full text-sm font-medium flex items-center justify-center gap-1.5 active:opacity-60"
                            style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)", border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)" }}
                          >
                            {deleting === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Trash2 className="h-3.5 w-3.5" /> Remove</>}
                          </button>
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Add SKU — full-screen overlay */}
      {addSheet && (
        <div className="fixed inset-0 flex flex-col" style={{ background: "var(--background)", zIndex: 210 }}>
          <div className="snm-overlay-header px-5">
          <div className="flex items-center gap-3 pt-4 pb-4">
            <button
              onClick={() => { setAddSheet(false); setAddSkuId(""); setSearch(""); }}
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "var(--glass-1)", color: "var(--muted-foreground)" }}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: t.color }}>{t.label}</p>
              <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
                {addSkuId ? "Set Prices" : "Add SKU"}
              </h2>
            </div>
          </div>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-none px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
            {!addSkuId ? (
              <>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  Search and select a SKU to set its {t.label.toLowerCase()} tier prices.
                </p>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search brand, SKU, variant…"
                  className={inputCls}
                />
                <div className="rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--glass-border-lo)", maxHeight: 400, overflowY: "auto" }}>
                  {filteredSkus.length === 0 ? (
                    <p className="text-sm text-center py-6" style={{ color: "var(--muted-foreground)" }}>
                      {search ? "No matches" : "All active SKUs already have prices in this list"}
                    </p>
                  ) : filteredSkus.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setAddSkuId(s.id)}
                      className="w-full text-left px-4 py-3.5 flex flex-col transition active:bg-black/5"
                      style={{ borderBottom: "0.5px solid var(--glass-border-lo)", background: "transparent" }}
                    >
                      <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                        {s.brand_name} › {s.model_name}
                        {s.variant_display ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {s.variant_display}</span> : null}
                      </p>
                      {s.landed_per_piece_mvr != null && (
                        <p className="text-xs mt-0.5 snm-num" style={{ color: "var(--muted-foreground)" }}>Landed MVR {Number(s.landed_per_piece_mvr).toFixed(3)}/pc</p>
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <SkuPriceEntry
                sku={filteredSkus.find((s) => s.id === addSkuId) ?? skus.find((s) => s.id === addSkuId) ?? null}
                creatingHeader={false}
                onBack={() => setAddSkuId("")}
                onSave={async (prices) => {
                  await upsertPriceListItem({ price_list_id: priceList.id, sku_id: addSkuId, ...prices });
                  toast.success("Price saved");
                  setAddSheet(false); setAddSkuId(""); setSearch("");
                  loadItems();
                }}
              />
            )}
          </div>
        </div>
      )}

      <ConfirmSheet
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        title="Remove SKU?"
        message="This SKU will be removed from the price list."
        confirmLabel="Remove"
        loading={confirmRemoving}
        onConfirm={async () => {
          if (!confirmRemove) return;
          setConfirmRemoving(true);
          try {
            await deletePriceListItem(confirmRemove);
            toast.success("Removed");
            setConfirmRemove(null);
            loadItems();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setConfirmRemoving(false);
          }
        }}
      />
    </div>
  );
}

/* ── SKU price entry form (shared by new-list and edit-list flows) ────────── */
function SkuPriceEntry({ sku, creatingHeader, onBack, onSave, initialPrices, saveLabel, extraAction }: {
  sku: SkuFullRow | null;
  creatingHeader: boolean;
  onBack: () => void;
  onSave: (prices: { price_per_piece_mvr: number; price_per_pack_mvr: number; price_per_carton_mvr: number; margin_pct: number | null }) => Promise<void>;
  initialPrices?: { piece: number; pack: number; carton: number };
  saveLabel?: string;
  extraAction?: React.ReactNode;
}) {
  const landed         = sku?.landed_per_piece_mvr ? Number(sku.landed_per_piece_mvr) : null;
  const pcsPerPack     = sku?.pcs_per_pack    ?? 1;
  const packsPerCarton = sku?.packs_per_carton ?? 1;
  const pcsPerCarton   = pcsPerPack * packsPerCarton;

  const [marginStr, setMarginStr] = useState(() => {
    if (!initialPrices || !landed || initialPrices.piece <= 0) return "";
    return ((1 - landed / initialPrices.piece) * 100).toFixed(1);
  });
  const [packStr,   setPackStr]   = useState(() => initialPrices ? String(initialPrices.pack)   : "");
  const [cartonStr, setCartonStr] = useState(() => initialPrices ? String(initialPrices.carton) : "");
  const [pieceStr,  setPieceStr]  = useState(() => initialPrices ? String(initialPrices.piece)  : "");
  const [saving,    setSaving]    = useState(false);

  function applyMargin(mStr: string) {
    setMarginStr(mStr);
    const m = parseFloat(mStr);
    if (!landed || isNaN(m) || m >= 100 || m < 0) return;
    const piece = landed / (1 - m / 100);
    setPieceStr(piece.toFixed(2));
    setPackStr((piece * pcsPerPack).toFixed(2));
    setCartonStr((piece * pcsPerCarton).toFixed(2));
  }

  function applyPack(pStr: string) {
    setPackStr(pStr);
    const pk = parseFloat(pStr);
    if (isNaN(pk) || pk <= 0) return;
    const piece = pk / pcsPerPack;
    setPieceStr(piece.toFixed(2));
    if (landed && piece > 0) setMarginStr(((1 - landed / piece) * 100).toFixed(1));
  }

  function applyCarton(cStr: string) {
    setCartonStr(cStr);
  }

  function applyPiece(pStr: string) {
    setPieceStr(pStr);
    const p = parseFloat(pStr);
    if (isNaN(p) || p <= 0) return;
    if (landed && p > 0) setMarginStr(((1 - landed / p) * 100).toFixed(1));
  }

  const packMargin   = landed && parseFloat(packStr)   > 0 ? ((1 - landed / (parseFloat(packStr)   / pcsPerPack))   * 100) : null;
  const cartonMargin = landed && parseFloat(cartonStr) > 0 ? ((1 - landed / (parseFloat(cartonStr) / pcsPerCarton)) * 100) : null;

  function marginColor(m: number | null) {
    if (m === null) return "var(--muted-foreground)";
    return m >= 25 ? "var(--snm-success)" : m >= 15 ? "var(--snm-warning)" : "var(--snm-error)";
  }

  const canSave = sku && parseFloat(packStr) > 0 && parseFloat(cartonStr) > 0 && parseFloat(pieceStr) > 0;

  async function handleSave() {
    if (!canSave || !sku) return;
    setSaving(true);
    try {
      await onSave({
        price_per_piece_mvr:  parseFloat(pieceStr),
        price_per_pack_mvr:   parseFloat(packStr),
        price_per_carton_mvr: parseFloat(cartonStr),
        margin_pct:           packMargin !== null ? parseFloat(packMargin.toFixed(1)) : null,
      });
    } finally {
      setSaving(false);
    }
  }

  if (!sku) return null;

  return (
    <div className="rounded-2xl p-4 space-y-4" style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{sku.brand_name} › {sku.model_name}</p>
          {sku.variant_display && <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{sku.variant_display}</p>}
          <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
            {pcsPerPack} pcs/pack · {packsPerCarton} packs/carton · {pcsPerCarton} pcs/carton
          </p>
          {landed != null && (
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Landed: <span className="font-semibold" style={{ color: "var(--foreground)" }}>MVR {landed.toFixed(3)}/pc</span>
            </p>
          )}
        </div>
        <button
          onClick={onBack}
          className="text-xs px-2 py-1 rounded-lg shrink-0"
          style={{ color: "var(--muted-foreground)", background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}
        >
          ← Back
        </button>
      </div>

      {/* Margin quick-fill */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--muted-foreground)" }}>
          Quick fill: target margin %
        </p>
        <div className="relative">
          <input
            type="number" inputMode="decimal" step="0.5" min="0" max="99"
            value={marginStr}
            onChange={(e) => applyMargin(e.target.value)}
            placeholder={landed ? "e.g. 30 → fills all prices" : "No landed cost yet"}
            disabled={!landed}
            className={inputCls}
            style={{ paddingRight: 36 }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold" style={{ color: "var(--muted-foreground)" }}>%</span>
        </div>
        {!landed && <p className="text-xs mt-1" style={{ color: "var(--snm-warning)" }}>No landed cost — enter prices manually below.</p>}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: "var(--glass-border-lo)" }} />
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>set each price independently</p>
        <div className="flex-1 h-px" style={{ background: "var(--glass-border-lo)" }} />
      </div>

      <SheetInput label={`Pack price — ${pcsPerPack} pcs`} required>
        <input
          type="number" inputMode="decimal" step="0.5" min="0.01"
          value={packStr}
          onChange={(e) => applyPack(e.target.value)}
          placeholder="e.g. 100"
          className={inputCls}
        />
        {packMargin !== null && (
          <p className="text-xs mt-1 font-semibold" style={{ color: marginColor(packMargin) }}>
            {packMargin.toFixed(1)}% margin on packs
            {packMargin < 15 && " · ⚠ below minimum"}
          </p>
        )}
      </SheetInput>

      <SheetInput label={`Carton price — ${pcsPerCarton} pcs (volume discount)`} required>
        <input
          type="number" inputMode="decimal" step="1" min="0.01"
          value={cartonStr}
          onChange={(e) => applyCarton(e.target.value)}
          placeholder="e.g. 360 (lower than 4 × pack = 400)"
          className={inputCls}
        />
        {cartonMargin !== null && packMargin !== null && (
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs font-semibold" style={{ color: marginColor(cartonMargin) }}>
              {cartonMargin.toFixed(1)}% margin on cartons
            </p>
            {parseFloat(cartonStr) < parseFloat(packStr) * packsPerCarton && (
              <p className="text-xs" style={{ color: "var(--snm-success)" }}>
                ✓ MVR {(parseFloat(packStr) * packsPerCarton - parseFloat(cartonStr)).toFixed(2)} carton discount
              </p>
            )}
            {parseFloat(cartonStr) >= parseFloat(packStr) * packsPerCarton && (
              <p className="text-xs" style={{ color: "var(--snm-warning)" }}>
                ⚠ No discount vs buying packs
              </p>
            )}
          </div>
        )}
      </SheetInput>

      <SheetInput label="Piece price (optional)">
        <input
          type="number" inputMode="decimal" step="0.01" min="0.01"
          value={pieceStr}
          onChange={(e) => applyPiece(e.target.value)}
          placeholder="auto-filled from pack ÷ pcs"
          className={inputCls}
        />
      </SheetInput>

      <div className="flex gap-3 mt-6">
        {extraAction}
        <button
          onClick={onBack}
          className="flex-1 py-3 rounded-full text-sm font-medium active:opacity-60"
          style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--muted-foreground)" }}
        >Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving || creatingHeader || !canSave}
          className="flex-[2] py-3 rounded-full text-xs font-bold uppercase tracking-widest active:opacity-80 active:scale-95 disabled:opacity-40"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          {saving || creatingHeader ? "Saving…" : (saveLabel ?? "SAVE PRICE")}
        </button>
      </div>
    </div>
  );
}

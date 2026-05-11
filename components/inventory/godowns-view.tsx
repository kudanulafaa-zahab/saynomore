"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Warehouse, ChevronDown, Package } from "lucide-react";
import { listBatchStock, type BatchStock } from "@/lib/queries/inventory";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { listGodowns, type GodownRow } from "@/lib/queries/masters";

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

/* ── SKU row inside a godown card ── */

function SkuRow({ slot }: { slot: SkuSlot }) {
  const { sku, pieces, value, batches } = slot;
  const [expanded, setExpanded] = useState(false);
  const pcsPerCtn = sku.pcs_per_pack * sku.packs_per_carton;
  const qty = fmtQty(pieces, sku.pcs_per_pack, pcsPerCtn);

  return (
    <div>
      <button
        className="w-full flex items-center justify-between py-3 text-left"
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
            {sku.internal_code} · {sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn
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

function GodownCard({ group }: { group: GodownGroup }) {
  const [open, setOpen] = useState(true);
  const { godown, skus, totalCartons, totalValue } = group;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--glass-1)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid color-mix(in srgb, var(--foreground) 6%, transparent)",
      }}
    >
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-3">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}
          >
            <Warehouse className="h-4 w-4 text-foreground" />
          </div>
          <div className="text-left">
            <p className="text-[15px] font-semibold text-foreground">{godown.name}</p>
            {godown.location && (
              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{godown.location}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 ml-3 shrink-0">
          <div className="text-right">
            <p className="text-[15px] font-bold text-foreground">{totalCartons.toLocaleString()} ctn</p>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>MVR {fmtMvr(totalValue)}</p>
          </div>
          <ChevronDown
            className="h-4 w-4 transition-transform duration-200"
            style={{ color: "var(--muted-foreground)", transform: open ? "rotate(180deg)" : "none" }}
          />
        </div>
      </button>

      {/* SKU list */}
      {open && (
        <div
          className="px-5 pb-2"
          style={{ borderTop: "1px solid color-mix(in srgb, var(--foreground) 6%, transparent)" }}
        >
          {skus.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: "var(--muted-foreground)" }}>No stock in this godown.</p>
          ) : (
            skus.map((slot) => <SkuRow key={slot.sku.id} slot={slot} />)
          )}
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

  useEffect(() => {
    Promise.all([listSkusFlat(), listGodowns(), listBatchStock()])
      .then(([s, g, b]) => { setSkus(s); setGodowns(g); setBatches(b); })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo<GodownGroup[]>(() => {
    return godowns.map((godown) => {
      const godownBatches = batches.filter((b) => b.godown_id === godown.id && b.qty_pieces_remaining > 0);

      // Group batches by SKU
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
        // Sort by value descending — highest-value SKU first
        .sort((a, b) => b.value - a.value);

      const totalCartons = skuSlots.reduce((sum, s) => {
        const pcsPerCtn = s.sku.pcs_per_pack * s.sku.packs_per_carton;
        return sum + toCtns(s.pieces, pcsPerCtn);
      }, 0);
      const totalValue = skuSlots.reduce((sum, s) => sum + s.value, 0);

      return { godown, skus: skuSlots, totalCartons, totalValue };
    })
    // Only show godowns that have stock; sort by total value descending
    .filter((g) => g.skus.length > 0)
    .sort((a, b) => b.totalValue - a.totalValue);
  }, [godowns, batches, skus]);

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl p-12 text-center" style={{ background: "var(--glass-1)" }}>
        <Package className="h-8 w-8 mx-auto mb-3 opacity-25" style={{ color: "var(--muted-foreground)" }} />
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          No stock in any godown yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-28 lg:pb-10">
      {/* Summary strip */}
      <div
        className="rounded-2xl px-5 py-4 flex items-center justify-between"
        style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
      >
        <p className="text-[13px] font-medium text-foreground">
          {groups.length} godown{groups.length !== 1 ? "s" : ""} with stock
        </p>
        <p className="text-[13px] font-semibold text-foreground">
          MVR {fmtMvr(groups.reduce((s, g) => s + g.totalValue, 0))} total
        </p>
      </div>

      {groups.map((group) => (
        <GodownCard key={group.godown.id} group={group} />
      ))}
    </div>
  );
}

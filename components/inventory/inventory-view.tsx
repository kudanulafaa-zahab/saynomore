"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, AlertTriangle, Package, ChevronDown, MapPin, Layers } from "lucide-react";
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

interface GodownSlot {
  godown: GodownRow;
  pieces: number;
  batches: BatchStock[];
}

interface SkuStock {
  sku: SkuFullRow;
  totalPieces: number;
  totalValue: number;
  byGodown: GodownSlot[];
  fifoLandedPerPiece: number;
  isLow: boolean;
}

interface BrandGroup {
  skus: SkuStock[];
  totalCartons: number;
  totalValue: number;
  hasLow: boolean;
}

/* ── Sub-components ── */

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
    >
      <p className="label-caps text-[10px] mb-2" style={{ color: "var(--muted-foreground)" }}>{label}</p>
      <p className="text-[26px] font-light tracking-tight leading-none" style={{ color: accent ?? "var(--foreground)" }}>{value}</p>
      <p className="text-[11px] mt-1.5" style={{ color: "var(--muted-foreground)" }}>{sub}</p>
    </div>
  );
}

function BatchRow({ batch, idx, pcsPerPack, pcsPerCtn }: {
  batch: BatchStock; idx: number; pcsPerPack: number; pcsPerCtn: number;
}) {
  const qty  = fmtQty(batch.qty_pieces_remaining, pcsPerPack, pcsPerCtn);
  const date = new Date(batch.received_at).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "2-digit" });
  return (
    <div
      className="flex items-center justify-between px-3 py-2.5 rounded-xl"
      style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {idx === 0 && (
          <span
            className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0"
            style={{ background: "color-mix(in srgb, var(--foreground) 12%, transparent)", color: "var(--foreground)" }}
          >
            FIFO
          </span>
        )}
        <span className="text-[12px] truncate" style={{ color: "var(--muted-foreground)" }}>
          {date} · #{batch.batch_id.slice(-6).toUpperCase()}
        </span>
      </div>
      <div className="text-right shrink-0 ml-3">
        <span className="text-[13px] font-semibold text-foreground">{qty}</span>
        <span className="text-[11px] ml-1.5" style={{ color: "var(--muted-foreground)" }}>
          MVR {batch.landed_per_piece_mvr.toFixed(2)}/pc
        </span>
      </div>
    </div>
  );
}

function SkuCard({ row, searchActive }: { row: SkuStock; searchActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { sku, totalPieces, totalValue, byGodown, fifoLandedPerPiece, isLow } = row;
  const pcsPerCtn       = sku.pcs_per_pack * sku.packs_per_carton;
  const totalCtns       = toCtns(totalPieces, pcsPerCtn);
  const landedPerPack   = fifoLandedPerPiece * sku.pcs_per_pack;
  const landedPerCarton = landedPerPack * sku.packs_per_carton;

  // Godown pills sorted by qty descending — biggest location first
  const sortedGodowns = [...byGodown].sort((a, b) => b.pieces - a.pieces);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--glass-1)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: isLow
          ? "1px solid color-mix(in srgb, var(--snm-error, #ffb4ab) 30%, transparent)"
          : "1px solid color-mix(in srgb, var(--foreground) 6%, transparent)",
      }}
    >
      <button className="w-full text-left px-4 pt-4 pb-3 flex items-start gap-3" onClick={() => setExpanded(!expanded)}>
        <div
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ background: isLow ? "var(--snm-error, #ffb4ab)" : "var(--snm-success, #4ade80)" }}
        />

        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-foreground leading-snug">
            {searchActive && <span style={{ color: "var(--muted-foreground)" }}>{sku.brand_name} · </span>}
            {sku.model_name}
            {sku.variant_display
              ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {sku.variant_display}</span>
              : null}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            {sku.internal_code} · {sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn
          </p>

          {/* Godown pills — sorted by qty desc */}
          {sortedGodowns.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {sortedGodowns.map(({ godown, pieces }) => (
                <span
                  key={godown.id}
                  className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                  style={{
                    background: "color-mix(in srgb, var(--foreground) 8%, transparent)",
                    color: "var(--foreground)",
                  }}
                >
                  <MapPin className="h-2.5 w-2.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                  {godown.name}
                  <span className="ml-0.5" style={{ color: "var(--muted-foreground)" }}>
                    {fmtQty(pieces, sku.pcs_per_pack, pcsPerCtn)}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="text-right shrink-0 ml-2">
          <p
            className="text-[20px] font-bold leading-none tracking-tight"
            style={{ color: isLow ? "var(--snm-error, #ffb4ab)" : "var(--foreground)" }}
          >
            {totalCtns}
            <span className="text-[13px] font-medium ml-1" style={{ color: "var(--muted-foreground)" }}>ctn</span>
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--muted-foreground)" }}>MVR {fmtMvr(totalValue)}</p>
          <ChevronDown
            className="h-4 w-4 mt-1.5 ml-auto transition-transform duration-200"
            style={{ color: "var(--muted-foreground)", transform: expanded ? "rotate(180deg)" : "none" }}
          />
        </div>
      </button>

      {expanded && (
        <div
          className="px-4 pb-4 space-y-4"
          style={{ borderTop: "1px solid color-mix(in srgb, var(--foreground) 6%, transparent)", paddingTop: 16 }}
        >
          {/* Landed cost grid */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Landed / pc",  value: `MVR ${fifoLandedPerPiece.toFixed(3)}` },
              { label: "Landed / pk",  value: `MVR ${landedPerPack.toFixed(2)}` },
              { label: "Landed / ctn", value: `MVR ${landedPerCarton.toFixed(0)}` },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-xl p-3 text-center"
                style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)" }}
              >
                <p className="label-caps text-[9px] mb-1" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
                <p className="text-[13px] font-semibold text-foreground">{c.value}</p>
              </div>
            ))}
          </div>

          {/* FIFO batches per godown, sorted by qty desc */}
          {sortedGodowns.map(({ godown, pieces, batches }) => (
            <div key={godown.id}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Layers className="h-3 w-3" style={{ color: "var(--muted-foreground)" }} />
                  <p className="text-[12px] font-semibold text-foreground">{godown.name}</p>
                </div>
                <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                  {fmtQty(pieces, sku.pcs_per_pack, pcsPerCtn)} · {pieces.toLocaleString()} pcs
                </p>
              </div>
              <div className="space-y-1">
                {[...batches]
                  .sort((a, b) => a.received_at.localeCompare(b.received_at))
                  .map((batch, i) => (
                    <BatchRow key={batch.batch_id} batch={batch} idx={i} pcsPerPack={sku.pcs_per_pack} pcsPerCtn={pcsPerCtn} />
                  ))}
              </div>
            </div>
          ))}

          {isLow && (
            <div
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
              style={{
                background: "color-mix(in srgb, var(--snm-error, #ffb4ab) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--snm-error, #ffb4ab) 20%, transparent)",
              }}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--snm-error, #ffb4ab)" }} />
              <p className="text-[12px]" style={{ color: "var(--snm-error, #ffb4ab)" }}>
                Only {totalCtns} carton{totalCtns !== 1 ? "s" : ""} left — consider reordering.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main ── */

export function InventoryView() {
  const [skus, setSkus]       = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [batches, setBatches] = useState<BatchStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState("");
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listSkusFlat(), listGodowns(), listBatchStock()])
      .then(([s, g, b]) => { setSkus(s); setGodowns(g); setBatches(b); })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const stockList = useMemo<SkuStock[]>(() => {
    return skus
      .map((sku) => {
        const skuBatches = batches.filter((b) => b.sku_id === sku.id && b.qty_pieces_remaining > 0);
        const godownMap  = new Map<string, { pieces: number; batches: BatchStock[] }>();
        for (const b of skuBatches) {
          const entry = godownMap.get(b.godown_id) ?? { pieces: 0, batches: [] };
          entry.pieces += b.qty_pieces_remaining;
          entry.batches.push(b);
          godownMap.set(b.godown_id, entry);
        }
        const byGodown: GodownSlot[] = Array.from(godownMap.entries())
          .map(([gid, entry]) => {
            const godown = godowns.find((g) => g.id === gid);
            return godown ? { godown, ...entry } : null;
          })
          .filter((x): x is GodownSlot => x !== null);

        const totalPieces        = byGodown.reduce((a, x) => a + x.pieces, 0);
        const totalValue         = skuBatches.reduce((s, b) => s + b.qty_pieces_remaining * b.landed_per_piece_mvr, 0);
        const pcsPerCtn          = sku.pcs_per_pack * sku.packs_per_carton;
        const fifoLandedPerPiece = [...skuBatches].sort((a, b) => a.received_at.localeCompare(b.received_at))[0]?.landed_per_piece_mvr ?? 0;
        const isLow              = toCtns(totalPieces, pcsPerCtn) < 5;

        return { sku, totalPieces, totalValue, byGodown, fifoLandedPerPiece, isLow };
      })
      .filter((r) => r.sku.is_active && r.totalPieces > 0);
  }, [skus, batches, godowns]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return stockList;
    return stockList.filter((r) =>
      [r.sku.brand_name, r.sku.model_name, r.sku.variant_display ?? "", r.sku.internal_code ?? ""]
        .join(" ").toLowerCase().includes(term),
    );
  }, [stockList, q]);

  const byBrand = useMemo(() => {
    const map = new Map<string, BrandGroup>();
    for (const row of filtered) {
      const brand  = row.sku.brand_name;
      const entry  = map.get(brand) ?? { skus: [], totalCartons: 0, totalValue: 0, hasLow: false };
      const pcsPerCtn = row.sku.pcs_per_pack * row.sku.packs_per_carton;
      entry.skus.push(row);
      entry.totalCartons += toCtns(row.totalPieces, pcsPerCtn);
      entry.totalValue   += row.totalValue;
      entry.hasLow        = entry.hasLow || row.isLow;
      map.set(brand, entry);
    }
    // Sort each brand's SKUs: low stock first, then by value descending
    for (const [, g] of map) {
      g.skus.sort((a, b) => {
        if (a.isLow !== b.isLow) return a.isLow ? -1 : 1;
        return b.totalValue - a.totalValue;
      });
    }
    // Sort brands: brands with low stock first, then by total value descending
    return Array.from(map.entries()).sort(([, a], [, b]) => {
      if (a.hasLow !== b.hasLow) return a.hasLow ? -1 : 1;
      return b.totalValue - a.totalValue;
    });
  }, [filtered]);

  const totalValue    = stockList.reduce((s, r) => s + r.totalValue, 0);
  const totalCartons  = stockList.reduce((s, r) => s + toCtns(r.totalPieces, r.sku.pcs_per_pack * r.sku.packs_per_carton), 0);
  const lowStockCount = stockList.filter((r) => r.isLow).length;
  const activeBatches = batches.filter((b) => b.qty_pieces_remaining > 0).length;
  const searchActive  = q.trim() !== "";

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-28 lg:pb-10">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="SKUs in Stock" value={String(stockList.length)} sub={`${activeBatches} active batch${activeBatches !== 1 ? "es" : ""}`} />
        <StatCard label="Total Cartons" value={totalCartons.toLocaleString()} sub="across all SKUs" />
        <StatCard label="Inventory Value" value={`MVR ${fmtMvr(totalValue)}`} sub="at landed cost" />
        <StatCard
          label="Low Stock"
          value={String(lowStockCount)}
          sub={lowStockCount > 0 ? "SKUs below 5 cartons" : "All OK"}
          accent={lowStockCount > 0 ? "var(--snm-error, #ffb4ab)" : "var(--snm-success, #4ade80)"}
        />
      </div>

      {/* Search */}
      <div
        className="flex items-center gap-2.5 px-4 rounded-2xl"
        style={{
          background: "var(--glass-1)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          height: 46,
          border: "1px solid color-mix(in srgb, var(--foreground) 6%, transparent)",
        }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search brand, SKU, code…"
          className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Stock list */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background: "var(--glass-1)" }}>
          <Package className="h-8 w-8 mx-auto mb-3 opacity-25" style={{ color: "var(--muted-foreground)" }} />
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            {stockList.length === 0 ? "No stock yet — confirm a GRN to populate inventory." : "No results."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {byBrand.map(([brand, brandData]) => {
            const isOpen = searchActive || expandedBrand === brand;
            return (
              <div key={brand}>
                <button
                  className="w-full flex items-center justify-between px-1 py-2 mb-2"
                  onClick={() => !searchActive && setExpandedBrand(isOpen ? null : brand)}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: brandData.hasLow ? "var(--snm-error, #ffb4ab)" : "var(--snm-success, #4ade80)" }}
                    />
                    <p className="text-[13px] font-bold uppercase tracking-wider text-foreground">{brand}</p>
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      {brandData.skus.length} SKU{brandData.skus.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                      {brandData.totalCartons.toLocaleString()} ctn
                    </p>
                    <p className="text-[12px] font-semibold text-foreground">MVR {fmtMvr(brandData.totalValue)}</p>
                    {!searchActive && (
                      <ChevronDown
                        className="h-3.5 w-3.5 transition-transform duration-200"
                        style={{ color: "var(--muted-foreground)", transform: isOpen ? "rotate(180deg)" : "none" }}
                      />
                    )}
                  </div>
                </button>
                {isOpen && (
                  <div className="space-y-2">
                    {brandData.skus.map((row) => (
                      <SkuCard key={row.sku.id} row={row} searchActive={searchActive} />
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

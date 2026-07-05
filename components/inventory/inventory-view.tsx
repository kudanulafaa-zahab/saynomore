"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Search, AlertTriangle, Package, ChevronDown, MapPin, Layers, TrendingDown, RefreshCw, PackageX, ArrowUpDown, ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { listBatchStock, listReorderSuggestions, type BatchStock, type ReorderSuggestion } from "@/lib/queries/inventory";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { listGodowns, type GodownRow } from "@/lib/queries/masters";

type SortMode = "urgency" | "overstock" | "value" | "az";

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
  isOverstock: boolean;
  alert: ReorderSuggestion | null;
}

interface BrandGroup {
  skus: SkuStock[];
  totalCartons: number;
  totalValue: number;
  hasLow: boolean;
  hasCritical: boolean;
}

/* ── Sub-components ── */

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}
    >
      <p className="label-caps text-[12px] mb-2" style={{ color: "var(--muted-foreground)" }}>{label}</p>
      <p className="text-[26px] font-semibold tracking-tight leading-none snm-num" style={{ color: accent ?? "var(--foreground)" }}>{value}</p>
      <p className="text-[12px] mt-1.5" style={{ color: "var(--muted-foreground)" }}>{sub}</p>
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
      className="flex items-center justify-between px-3 py-3 rounded-xl"
      style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {idx === 0 && (
          <span
            className="text-[12px] font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0"
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
        <span className="text-[13px] font-semibold text-foreground snm-num">{qty}</span>
        <span className="text-[12px] ml-1.5 snm-num" style={{ color: "var(--muted-foreground)" }}>
          MVR {batch.landed_per_piece_mvr.toFixed(2)}/pc
        </span>
      </div>
    </div>
  );
}

function DirBadge({ alert }: { alert: ReorderSuggestion | null }) {
  if (!alert || alert.status === "ok") return null;
  const isCritical = alert.status === "critical";
  const isOverstock = alert.status === "overstock";
  const color = isCritical ? "var(--snm-error)" : isOverstock ? "var(--muted-foreground)" : "var(--snm-warning)";
  const dirText = isOverstock
    ? `${alert.dir}d stock`
    : alert.dir != null ? `${alert.dir}d left` : "No sales data";
  return (
    <span
      className="text-[12px] font-bold px-2 py-0.5 rounded-full shrink-0"
      style={{
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      {isCritical ? "⚠ " : ""}{dirText}
    </span>
  );
}

function SkuCard({ row, searchActive }: { row: SkuStock; searchActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { sku, totalPieces, totalValue, byGodown, fifoLandedPerPiece, isLow, isOverstock, alert } = row;
  const pcsPerCtn       = sku.pcs_per_pack * sku.packs_per_carton;
  const totalCtns       = toCtns(totalPieces, pcsPerCtn);
  const landedPerPack   = fifoLandedPerPiece * sku.pcs_per_pack;
  const landedPerCarton = landedPerPack * sku.packs_per_carton;
  const isCritical      = alert?.status === "critical";

  const sortedGodowns = [...byGodown].sort((a, b) => b.pieces - a.pieces);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--glass-1)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: "var(--glass-shadow), var(--glass-inner)",
        border: isCritical
          ? "1px solid color-mix(in srgb, var(--snm-error) 35%, transparent)"
          : isLow
          ? "1px solid color-mix(in srgb, var(--snm-warning) 30%, transparent)"
          : isOverstock
          ? "1px solid color-mix(in srgb, var(--muted-foreground) 25%, transparent)"
          : "0.5px solid var(--glass-border-lo)",
      }}
    >
      {/* ── Top: SKU name + total qty ── */}
      <div className="px-4 pt-4 pb-3 flex items-start gap-3">
        <div
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ background: isCritical ? "var(--snm-error)" : isLow ? "var(--snm-warning)" : isOverstock ? "var(--muted-foreground)" : "var(--snm-success)" }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-semibold text-foreground leading-snug">
              {searchActive && <span style={{ color: "var(--muted-foreground)" }}>{sku.brand_name} · </span>}
              {sku.model_name}
              {sku.variant_display
                ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {sku.variant_display}</span>
                : null}
            </p>
            <DirBadge alert={alert} />
          </div>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            {sku.internal_code} · {sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn
          </p>
        </div>
        <div className="text-right shrink-0 ml-2">
          <p
            className="text-[22px] font-bold leading-none tracking-tight snm-num"
            style={{ color: isLow ? "var(--snm-error)" : "var(--foreground)" }}
          >
            {totalCtns}
            <span className="text-[13px] font-medium ml-1" style={{ color: "var(--muted-foreground)" }}>ctn</span>
          </p>
          <p className="text-[12px] mt-1 snm-num" style={{ color: "var(--muted-foreground)" }}>MVR {fmtMvr(totalValue)}</p>
        </div>
      </div>

      {/* ── Godown breakdown — always visible, no tap needed ── */}
      {sortedGodowns.length > 0 && (
        <div
          className="mx-4 mb-3 rounded-xl overflow-hidden"
          style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)" }}
        >
          {sortedGodowns.map(({ godown, pieces }, i) => {
            const ctns  = toCtns(pieces, pcsPerCtn);
            const packs = remPacks(pieces, sku.pcs_per_pack, pcsPerCtn);
            return (
              <div
                key={godown.id}
                className="flex items-center justify-between px-3 py-2.5"
                style={{
                  borderTop: i > 0 ? "1px solid color-mix(in srgb, var(--foreground) 5%, transparent)" : undefined,
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="h-3 w-3 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                  <p className="text-[13px] font-medium text-foreground truncate">{godown.name}</p>
                </div>
                <p className="text-[13px] font-semibold text-foreground ml-4 shrink-0 snm-num">
                  {ctns > 0 && <>{ctns} <span className="font-normal text-[12px]" style={{ color: "var(--muted-foreground)" }}>ctn</span></>}
                  {packs > 0 && <><span className="mx-1 text-[12px]" style={{ color: "var(--muted-foreground)" }}>+</span>{packs} <span className="font-normal text-[12px]" style={{ color: "var(--muted-foreground)" }}>pk</span></>}
                  {ctns === 0 && packs === 0 && <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>{pieces} pcs</span>}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Expand button for FIFO batch detail ── */}
      <button
        className="w-full min-h-[44px] flex items-center justify-center gap-1.5 pb-3"
        style={{ touchAction: "manipulation" }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[12px] font-medium" style={{ color: "var(--muted-foreground)" }}>
          {expanded ? "Hide" : "FIFO batches & landed cost"}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 transition-transform duration-200"
          style={{ color: "var(--muted-foreground)", transform: expanded ? "rotate(180deg)" : "none" }}
        />
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
                <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
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

          {(isCritical || isLow) && (
            <div
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
              style={{
                background: `color-mix(in srgb, ${isCritical ? "var(--snm-error)" : "var(--snm-warning)"} 10%, transparent)`,
                border: `1px solid color-mix(in srgb, ${isCritical ? "var(--snm-error)" : "var(--snm-warning)"} 20%, transparent)`,
              }}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: isCritical ? "var(--snm-error)" : "var(--snm-warning)" }} />
              <div>
                <p className="text-[12px] font-semibold" style={{ color: isCritical ? "var(--snm-error)" : "var(--snm-warning)" }}>
                  {isCritical ? "Critical — reorder now" : "Low stock — reorder soon"}
                </p>
                {alert?.dir != null && (
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    ~{alert.dir} days left · avg {alert.daily_avg_pieces.toFixed(1)} pcs/day
                    {alert.suggested_cartons > 0 && ` · suggest ordering ${alert.suggested_cartons} ctn`}
                  </p>
                )}
                {alert?.dir == null && (
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    Only {totalCtns} carton{totalCtns !== 1 ? "s" : ""} left — no recent sales to calculate DIR
                  </p>
                )}
              </div>
            </div>
          )}

          {isOverstock && !isCritical && !isLow && (
            <div
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
              style={{
                background: "color-mix(in srgb, var(--muted-foreground) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--muted-foreground) 18%, transparent)",
              }}
            >
              <PackageX className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--muted-foreground)" }} />
              <div>
                <p className="text-[12px] font-semibold text-foreground">
                  Overstocked — {alert?.dir} days of stock on hand
                </p>
                <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Selling slower than restocked · consider a promotion to move it
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main ── */

export function InventoryView() {
  const searchParams = useSearchParams();
  const [skus, setSkus]         = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns]   = useState<GodownRow[]>([]);
  const [batches, setBatches]   = useState<BatchStock[]>([]);
  const [alerts, setAlerts]     = useState<ReorderSuggestion[]>([]);
  const [loading, setLoading]   = useState(true);
  const [q, setQ]               = useState("");
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>(
    searchParams.get("filter") === "overstock" ? "overstock" : "urgency",
  );

  useEffect(() => {
    Promise.all([listSkusFlat(), listGodowns(), listBatchStock(), listReorderSuggestions()])
      .then(([s, g, b, a]) => { setSkus(s); setGodowns(g); setBatches(b); setAlerts(a); })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const alertMap = useMemo(() => {
    const m = new Map<string, ReorderSuggestion>();
    for (const a of alerts) m.set(a.sku_id, a);
    return m;
  }, [alerts]);

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
        const alert              = alertMap.get(sku.id) ?? null;
        // isLow: use DIR if we have sales history, else fall back to < 5 cartons
        const isLow              = alert
          ? alert.status === "critical" || alert.status === "low"
          : toCtns(totalPieces, pcsPerCtn) < 5;
        const isOverstock         = alert?.status === "overstock";

        return { sku, totalPieces, totalValue, byGodown, fifoLandedPerPiece, isLow, isOverstock, alert };
      })
      .filter((r) => r.sku.is_active && r.totalPieces > 0);
  }, [skus, batches, godowns, alertMap]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = stockList;
    if (term) {
      list = list.filter((r) =>
        [r.sku.brand_name, r.sku.model_name, r.sku.variant_display ?? "", r.sku.internal_code ?? ""]
          .join(" ").toLowerCase().includes(term),
      );
    }
    if (sortMode === "overstock") list = list.filter((r) => r.isOverstock);
    return list;
  }, [stockList, q, sortMode]);

  const byBrand = useMemo(() => {
    const map = new Map<string, BrandGroup>();
    for (const row of filtered) {
      const brand  = row.sku.brand_name;
      const entry  = map.get(brand) ?? { skus: [], totalCartons: 0, totalValue: 0, hasLow: false, hasCritical: false };
      const pcsPerCtn = row.sku.pcs_per_pack * row.sku.packs_per_carton;
      entry.skus.push(row);
      entry.totalCartons += toCtns(row.totalPieces, pcsPerCtn);
      entry.totalValue   += row.totalValue;
      entry.hasLow        = entry.hasLow || row.isLow;
      entry.hasCritical   = entry.hasCritical || (row.alert?.status === "critical");
      map.set(brand, entry);
    }
    // Sort each brand's SKUs by the chosen mode
    for (const [, g] of map) {
      g.skus.sort((a, b) => {
        if (sortMode === "az") return a.sku.model_name.localeCompare(b.sku.model_name);
        if (sortMode === "value") return b.totalValue - a.totalValue;
        if (sortMode === "overstock") return (b.alert?.dir ?? 0) - (a.alert?.dir ?? 0);
        // urgency (default): critical first, then low, then overstock, then ok
        const order = { critical: 0, low: 1, overstock: 2, ok: 3 };
        const aLevel = a.alert?.status ?? (a.isLow ? "low" : "ok");
        const bLevel = b.alert?.status ?? (b.isLow ? "low" : "ok");
        if (aLevel !== bLevel) return order[aLevel as keyof typeof order] - order[bLevel as keyof typeof order];
        return b.totalValue - a.totalValue;
      });
    }
    // Sort brands to match: urgency mode surfaces critical/low brands first,
    // other modes just sort by total value (az mode keeps brand alpha order).
    return Array.from(map.entries()).sort(([brandA, a], [brandB, b]) => {
      if (sortMode === "az") return brandA.localeCompare(brandB);
      if (sortMode === "value" || sortMode === "overstock") return b.totalValue - a.totalValue;
      if (a.hasCritical !== b.hasCritical) return a.hasCritical ? -1 : 1;
      if (a.hasLow !== b.hasLow) return a.hasLow ? -1 : 1;
      return b.totalValue - a.totalValue;
    });
  }, [filtered, sortMode]);

  const totalValue      = stockList.reduce((s, r) => s + r.totalValue, 0);
  const totalCartons    = stockList.reduce((s, r) => s + toCtns(r.totalPieces, r.sku.pcs_per_pack * r.sku.packs_per_carton), 0);
  const lowStockCount   = stockList.filter((r) => r.isLow).length;
  const criticalCount   = stockList.filter((r) => r.alert?.status === "critical").length;
  const overstockCount  = stockList.filter((r) => r.isOverstock).length;
  const activeBatches   = batches.filter((b) => b.qty_pieces_remaining > 0).length;
  const searchActive    = q.trim() !== "";

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {/* Header */}
        <div className="space-y-2 mb-4">
          <div className="h-2.5 w-24 rounded-full" style={{ background: "var(--muted)" }} />
          <div className="h-8 w-36 rounded-xl" style={{ background: "var(--muted)" }} />
        </div>
        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl p-4 space-y-2" style={{ background: "var(--glass-1)" }}>
              <div className="h-2 w-12 rounded-full" style={{ background: "var(--muted)" }} />
              <div className="h-7 w-16 rounded-lg" style={{ background: "var(--muted)" }} />
            </div>
          ))}
        </div>
        {/* Search bar */}
        <div className="h-12 rounded-2xl" style={{ background: "var(--muted)" }} />
        {/* 4 SKU card skeletons */}
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl p-4 flex items-start gap-3" style={{ background: "var(--glass-1)" }}>
            <div className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: "var(--muted)" }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-40 rounded-full" style={{ background: "var(--muted)" }} />
              <div className="h-2.5 w-24 rounded-full" style={{ background: "var(--muted)" }} />
            </div>
            <div className="text-right space-y-1 shrink-0">
              <div className="h-6 w-14 rounded-lg" style={{ background: "var(--muted)" }} />
              <div className="h-2.5 w-12 rounded-full" style={{ background: "var(--muted)" }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-28 lg:pb-10">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Catalogue</p>
          <h1 className="ios-page-title">Inventory</h1>
        </div>
        {godowns.length > 1 && (
          <Link
            href="/stock-ops?tab=transfer"
            className="h-10 px-4 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 transition active:scale-95 shrink-0"
            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
          >
            <ArrowLeftRight className="h-4 w-4" />
            Transfer
          </Link>
        )}
      </div>

      {/* ── Critical alert banner — only shown when urgent ── */}
      {criticalCount > 0 && (
        <div
          className="rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{
            background: "color-mix(in srgb, var(--snm-error) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--snm-error) 28%, transparent)",
          }}
        >
          <TrendingDown className="h-5 w-5 shrink-0" style={{ color: "var(--snm-error)" }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--snm-error)" }}>
              {criticalCount} SKU{criticalCount !== 1 ? "s" : ""} critically low — less than 7 days remaining
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Reorder immediately to avoid stock-out
            </p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="SKUs in Stock" value={String(stockList.length)} sub={`${activeBatches} active batch${activeBatches !== 1 ? "es" : ""}`} />
        <StatCard label="Total Cartons" value={totalCartons.toLocaleString()} sub="across all SKUs" />
        <StatCard label="Inventory Value" value={`MVR ${fmtMvr(totalValue)}`} sub="at landed cost" />
        <StatCard
          label="Reorder Alerts"
          value={String(lowStockCount)}
          sub={criticalCount > 0 ? `${criticalCount} critical · ${lowStockCount - criticalCount} low` : lowStockCount > 0 ? "SKUs below 14 days" : "All OK"}
          accent={criticalCount > 0 ? "var(--snm-error)" : lowStockCount > 0 ? "var(--snm-warning)" : "var(--snm-success)"}
        />
        <div className="col-span-2">
          <StatCard
            label="Overstocked"
            value={String(overstockCount)}
            sub={overstockCount > 0 ? "More than 90 days of stock — consider a promotion" : "Nothing overstocked"}
            accent={overstockCount > 0 ? "var(--muted-foreground)" : "var(--snm-success)"}
          />
        </div>
      </div>

      {/* Search + sort */}
      <div className="space-y-2">
        <div
          className="flex items-center gap-2.5 px-4 rounded-2xl"
          style={{
            background: "var(--glass-1)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "var(--glass-shadow), var(--glass-inner)",
            height: 46,
            border: "0.5px solid var(--glass-border-lo)",
          }}
        >
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search brand, SKU, code…"
            aria-label="Search inventory"
            className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          {([
            { mode: "urgency", label: "Urgency" },
            { mode: "overstock", label: "Overstock" },
            { mode: "value", label: "Value" },
            { mode: "az", label: "A–Z" },
          ] as { mode: SortMode; label: string }[]).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-full transition active:opacity-70"
              style={{
                background: sortMode === mode ? "var(--foreground)" : "var(--glass-1)",
                color: sortMode === mode ? "var(--background)" : "var(--muted-foreground)",
                border: sortMode === mode ? "none" : "0.5px solid var(--glass-border-lo)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Stock list */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl p-12 flex flex-col items-center text-center gap-3" style={{ background: "var(--glass-1)" }}>
          <div className="h-12 w-12 rounded-2xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
            <Package className="h-6 w-6" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
          </div>
          <div className="space-y-1">
            <p className="text-[15px] font-semibold text-foreground">
              {stockList.length === 0 ? "No stock yet" : "No results"}
            </p>
            <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              {stockList.length === 0
                ? "Confirm a shipment GRN to populate your inventory."
                : "Try a different search term."}
            </p>
          </div>
          {stockList.length === 0 && (
            <a
              href="/shipments"
              className="mt-1 h-11 px-6 rounded-full text-sm font-semibold flex items-center justify-center active:opacity-70"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              Go to Shipments
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {byBrand.map(([brand, brandData]) => {
            const isOpen = searchActive || expandedBrand === brand;
            return (
              <div key={brand}>
                <button
                  className="w-full flex items-center justify-between px-1 py-2 mb-2 active:opacity-70"
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${brand}`}
                  aria-expanded={isOpen}
                  onClick={() => !searchActive && setExpandedBrand(isOpen ? null : brand)}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: brandData.hasCritical ? "var(--snm-error)" : brandData.hasLow ? "var(--snm-warning)" : "var(--snm-success)" }}
                    />
                    <p className="text-[13px] font-bold uppercase tracking-wider text-foreground">{brand}</p>
                    <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
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


"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, AlertTriangle, TrendingUp, ChevronRight, Package } from "lucide-react";
import { listStockLevels, listBatchStock, type BatchStock } from "@/lib/queries/inventory";
import { listSkusFlat, type SkuFullRow, type UnitUom } from "@/lib/queries/products";
import { listGodowns, type GodownRow } from "@/lib/queries/masters";

const CARD = {
  background: "rgba(18,19,23,0.70)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
} as const;

const CARD_L2 = {
  background: "rgba(28,27,27,0.85)",
  backdropFilter: "blur(30px)",
  WebkitBackdropFilter: "blur(30px)",
} as const;

function containerLabel(uom: UnitUom): string {
  if (uom === "ml") return "bottle";
  if (uom === "g") return "pouch";
  return "pack";
}

function formatQty(pieces: number, pcsPerPack: number, packsPerCarton: number, uom: UnitUom): string {
  const pcsPerCarton = pcsPerPack * packsPerCarton;
  const ctns = pcsPerCarton > 0 ? Math.floor(pieces / pcsPerCarton) : 0;
  const rem = pcsPerCarton > 0 ? pieces % pcsPerCarton : pieces;
  const loose = pcsPerPack > 0 ? Math.floor(rem / pcsPerPack) : 0;
  const label = containerLabel(uom);
  const parts: string[] = [];
  if (ctns > 0) parts.push(`${ctns} ctn`);
  if (loose > 0) parts.push(`${loose} ${label}`);
  if (parts.length === 0) parts.push("0 ctn");
  return parts.join(" + ");
}

interface SkuRollup {
  sku: SkuFullRow;
  totalPieces: number;
  byGodown: { godown: GodownRow; pieces: number }[];
  batches: BatchStock[];
  dailyVelocity: number; // estimated pieces/day (placeholder from batch count)
}

export function InventoryView() {
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [batches, setBatches] = useState<BatchStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"FIFO" | "LIFO">("FIFO");

  async function load() {
    setLoading(true);
    try {
      const [s, g, b, levels] = await Promise.all([
        listSkusFlat(),
        listGodowns(),
        listBatchStock(),
        listStockLevels(),
      ]);
      setSkus(s);
      setGodowns(g);
      setBatches(b);
      void levels;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const rollups = useMemo<SkuRollup[]>(() => {
    return skus
      .map((sku) => {
        const skuBatches = batches.filter((b) => b.sku_id === sku.id);
        const byGodownMap = new Map<string, number>();
        for (const b of skuBatches) {
          byGodownMap.set(b.godown_id, (byGodownMap.get(b.godown_id) ?? 0) + b.qty_pieces_remaining);
        }
        const byGodown = Array.from(byGodownMap.entries())
          .map(([gid, pieces]) => {
            const g = godowns.find((x) => x.id === gid);
            return g ? { godown: g, pieces } : null;
          })
          .filter((x): x is { godown: GodownRow; pieces: number } => x !== null);
        const totalPieces = byGodown.reduce((acc, x) => acc + x.pieces, 0);
        return { sku, totalPieces, byGodown, batches: skuBatches, dailyVelocity: 0 };
      })
      .filter((r) => r.sku.is_active);
  }, [skus, batches, godowns]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rollups;
    return rollups.filter((row) =>
      [row.sku.brand_name, row.sku.model_name, row.sku.variant_display, row.sku.internal_code]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [rollups, q]);

  // Hero metric calculations
  const totalUnits = rollups.reduce((acc, r) => acc + r.totalPieces, 0);
  const activeBatches = batches.filter((b) => b.qty_pieces_remaining > 0).length;
  const LOW_STOCK_THRESHOLD = 50;
  const lowStockBatches = batches.filter((b) => b.qty_pieces_remaining > 0 && b.qty_pieces_remaining < LOW_STOCK_THRESHOLD);
  const lowStockCount = lowStockBatches.length;

  // For the batch visualization — pick the first SKU with batches or show demo
  const vizRollup = filtered.find((r) => r.batches.length > 0) ?? filtered[0];
  const vizBatches = vizRollup
    ? [...vizRollup.batches]
        .filter((b) => b.qty_pieces_remaining >= 0)
        .sort((a, b) =>
          view === "FIFO"
            ? a.received_at.localeCompare(b.received_at)
            : b.received_at.localeCompare(a.received_at),
        )
        .slice(0, 5)
    : [];

  // Max qty for bar scaling
  const maxQty = vizBatches.reduce((m, b) => Math.max(m, b.qty_pieces_remaining), 1);

  // Sort all batches for the table
  const tableBatches = [...batches]
    .filter((b) => b.qty_pieces_remaining > 0)
    .sort((a, b) =>
      view === "FIFO"
        ? a.received_at.localeCompare(b.received_at)
        : b.received_at.localeCompare(a.received_at),
    )
    .slice(0, 20);

  if (loading) {
    return (
      <div
        className="rounded-2xl p-12 flex flex-col items-center"
        style={{ ...CARD, color: "#8e9192" }}
      >
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading stock…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="label-caps text-[10px] mb-1" style={{ color: "#8e9192" }}>Operations</p>
          <h1 className="text-[28px] font-semibold tracking-tight text-white leading-tight">Inventory</h1>
        </div>
      </div>

      {/* ── Search ── */}
      <div
        className="flex items-center gap-3 rounded-2xl px-4 h-12"
        style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "#8e9192" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search brand, SKU, code…"
          className="flex-1 bg-transparent text-sm text-white placeholder:text-[#8e9192] outline-none"
          inputMode="search"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
        />
      </div>

      {/* ── Hero Metrics ── */}
      <div className="grid grid-cols-3 gap-3">
        {/* Global Stock */}
        <div className="rounded-xl p-4" style={CARD}>
          <p className="label-caps text-[10px] mb-2" style={{ color: "#8e9192" }}>GLOBAL STOCK</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[28px] font-light tracking-tight text-white leading-none">
              {totalUnits >= 1000 ? `${(totalUnits / 1000).toFixed(1)}K` : totalUnits.toLocaleString()}
            </span>
          </div>
          <p className="text-[10px] mt-1" style={{ color: "#8e9192" }}>Units</p>
          <div className="mt-3 h-1 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full bg-white" style={{ width: "75%" }} />
          </div>
        </div>

        {/* Active Batches */}
        <div className="rounded-xl p-4" style={CARD}>
          <p className="label-caps text-[10px] mb-2" style={{ color: "#8e9192" }}>ACTIVE BATCHES</p>
          <span className="text-[28px] font-light tracking-tight text-white leading-none">{activeBatches}</span>
          <p className="text-[10px] mt-1" style={{ color: "#8e9192" }}>In Warehouse</p>
          {lowStockCount > 0 ? (
            <div className="mt-3 flex items-center gap-1" style={{ color: "#ffb4ab" }}>
              <AlertTriangle className="h-3 w-3" />
              <span className="text-[10px]">{lowStockCount} Low Stock</span>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-1" style={{ color: "#4ade80" }}>
              <span className="text-[10px]">All levels OK</span>
            </div>
          )}
        </div>

        {/* Daily Velocity */}
        <div className="rounded-xl p-4" style={CARD}>
          <p className="label-caps text-[10px] mb-2" style={{ color: "#8e9192" }}>DAILY VELOCITY</p>
          <span className="text-[28px] font-light tracking-tight text-white leading-none">—</span>
          <p className="text-[10px] mt-1" style={{ color: "#8e9192" }}>Units/Day</p>
          <div className="mt-3 flex items-center gap-1" style={{ color: "#b5b4ba" }}>
            <TrendingUp className="h-3 w-3" />
            <span className="text-[10px]">From sales data</span>
          </div>
        </div>
      </div>

      {/* ── Main Bento: Visualization + Side Alerts ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">

        {/* Batch Visualization — 3 cols */}
        <div className="md:col-span-3 rounded-xl p-5" style={{ ...CARD, minHeight: 320 }}>
          <div className="flex justify-between items-start mb-5">
            <div>
              <h2 className="text-[18px] font-semibold text-white leading-tight">Inventory Visualization</h2>
              {vizRollup ? (
                <p className="text-[11px] mt-0.5" style={{ color: "#8e9192" }}>
                  {vizRollup.sku.internal_code} • {vizRollup.sku.brand_name} {vizRollup.sku.variant_display}
                </p>
              ) : (
                <p className="text-[11px] mt-0.5" style={{ color: "#8e9192" }}>No SKUs with stock yet</p>
              )}
            </div>
            <div className="flex gap-1.5">
              {(["FIFO", "LIFO"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                  style={
                    view === v
                      ? { ...CARD_L2, color: "#ffffff", border: "1px solid rgba(255,255,255,0.08)" }
                      : { background: "transparent", color: "#8e9192" }
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {vizBatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3" style={{ color: "#8e9192" }}>
              <Package className="h-8 w-8 opacity-30" />
              <p className="text-sm">No stock yet — confirm a shipment GRN to populate batches.</p>
            </div>
          ) : (
            <>
              {/* Bar chart */}
              <div className="relative pt-10">
                <div className="flex gap-2 h-40 items-end">
                  {vizBatches.map((batch, i) => {
                    const heightPct = Math.max(8, (batch.qty_pieces_remaining / maxQty) * 100);
                    const isFirst = i === 0;
                    const isStagnant = batch.qty_pieces_remaining / (vizBatches[0]?.qty_pieces_remaining || 1) > 1.5 && !isFirst;
                    return (
                      <div key={batch.batch_id} className="flex-1 relative flex flex-col items-center">
                        {isFirst && (
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: "#ffffff", color: "#2f3131" }}
                            >
                              DEDUCTING
                            </span>
                          </div>
                        )}
                        {isStagnant && (
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: "rgba(199,198,203,0.15)", color: "#c7c6cb", border: "1px solid rgba(199,198,203,0.2)" }}
                            >
                              LOW VELOCITY
                            </span>
                          </div>
                        )}
                        <div
                          className="w-full rounded-t-lg"
                          style={{
                            height: `${heightPct}%`,
                            background: isFirst
                              ? "rgba(255,255,255,0.25)"
                              : isStagnant
                              ? "rgba(199,198,203,0.10)"
                              : "rgba(255,255,255,0.10)",
                            borderBottom: isFirst
                              ? "2px solid rgba(255,255,255,0.50)"
                              : "2px solid rgba(255,255,255,0.12)",
                          }}
                        />
                        <div className="mt-2 text-center">
                          <p className="text-[10px] font-bold" style={{ color: isFirst ? "#ffffff" : "#8e9192" }}>
                            {batch.batch_id.slice(-6).toUpperCase()}
                          </p>
                          <p className="text-[9px]" style={{ color: "#8e9192" }}>
                            {batch.qty_pieces_remaining.toLocaleString()} pcs
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Last transaction summary */}
              <div
                className="mt-5 p-4 rounded-xl flex items-center justify-between"
                style={CARD_L2}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-9 w-9 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "rgba(255,255,255,0.08)" }}
                  >
                    <Package className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-white">Active Batch: {vizBatches[0]?.batch_id.slice(-6).toUpperCase() ?? "—"}</p>
                    <p className="text-[11px]" style={{ color: "#8e9192" }}>
                      {view} priority — {vizBatches[0]?.qty_pieces_remaining.toLocaleString() ?? 0} pcs remaining
                    </p>
                  </div>
                </div>
                <button
                  className="text-[11px] font-bold text-white underline underline-offset-4 opacity-70 hover:opacity-100 transition"
                  onClick={() => {}}
                >
                  VIEW LEDGER
                </button>
              </div>
            </>
          )}
        </div>

        {/* Side Alerts Column — 1 col */}
        <div className="space-y-3">
          {/* Critical low stock */}
          {lowStockCount > 0 ? (
            <div
              className="rounded-xl p-4"
              style={{ ...CARD, borderLeft: "4px solid #ffb4ab" }}
            >
              <div className="flex items-start justify-between mb-3">
                <AlertTriangle className="h-4 w-4" style={{ color: "#ffb4ab" }} />
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={{ color: "#ffb4ab", background: "rgba(255,180,171,0.12)" }}
                >
                  CRITICAL
                </span>
              </div>
              <h3 className="text-[13px] font-bold text-white mb-1">Low Stock Alert</h3>
              <p className="text-[11px] mb-3" style={{ color: "#8e9192" }}>
                {lowStockCount} batch{lowStockCount !== 1 ? "es" : ""} below {LOW_STOCK_THRESHOLD} units. Reorder required.
              </p>
              <button
                className="w-full py-2 rounded-lg text-[11px] font-bold transition"
                style={{ background: "#ffffff", color: "#2f3131" }}
              >
                REORDER NOW
              </button>
            </div>
          ) : (
            <div
              className="rounded-xl p-4"
              style={{ ...CARD, borderLeft: "4px solid rgba(74,222,128,0.50)" }}
            >
              <div className="flex items-start justify-between mb-3">
                <span style={{ color: "#4ade80", fontSize: 16 }}>✓</span>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={{ color: "#4ade80", background: "rgba(74,222,128,0.10)" }}
                >
                  HEALTHY
                </span>
              </div>
              <h3 className="text-[13px] font-bold text-white mb-1">Stock Levels OK</h3>
              <p className="text-[11px]" style={{ color: "#8e9192" }}>All active batches above minimum threshold.</p>
            </div>
          )}

          {/* Stagnant batch alert */}
          <div
            className="rounded-xl p-4"
            style={{ ...CARD, borderLeft: "4px solid rgba(199,198,203,0.40)" }}
          >
            <div className="flex items-start justify-between mb-3">
              <Package className="h-4 w-4" style={{ color: "#c7c6cb" }} />
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded"
                style={{ color: "#c7c6cb", background: "rgba(199,198,203,0.10)" }}
              >
                EXCESS
              </span>
            </div>
            <h3 className="text-[13px] font-bold text-white mb-1">Velocity Check</h3>
            <p className="text-[11px]" style={{ color: "#8e9192" }}>
              Stagnant batches may need markdown or transfer.
            </p>
          </div>

          {/* Activity log */}
          <div className="rounded-xl p-4" style={CARD}>
            <p className="label-caps text-[10px] mb-3" style={{ color: "#8e9192" }}>LOG ACTIVITY</p>
            {tableBatches.slice(0, 3).map((b, i) => {
              const sku = skus.find((s) => s.id === b.sku_id);
              return (
                <div key={b.batch_id} className="flex gap-2.5 mb-3 last:mb-0">
                  <div
                    className="w-1 rounded-full shrink-0"
                    style={{ height: 32, background: i === 0 ? "#ffffff" : "rgba(255,180,171,0.40)" }}
                  />
                  <div>
                    <p className="text-[11px] font-bold text-white">
                      {i === 0 ? "BATCH ACTIVE" : "STOCK UPDATE"}
                    </p>
                    <p className="text-[10px]" style={{ color: "#8e9192" }}>
                      {b.batch_id.slice(-6).toUpperCase()} • {b.qty_pieces_remaining.toLocaleString()} pcs
                      {sku ? ` · ${sku.brand_name}` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
            {tableBatches.length === 0 && (
              <p className="text-[11px]" style={{ color: "#8e9192" }}>No activity yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── All Active Batches Table ── */}
      <div className="rounded-xl overflow-hidden" style={CARD}>
        <div
          className="px-5 py-4 flex justify-between items-center"
          style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          <h2 className="text-[18px] font-semibold text-white">All Active Batches</h2>
          <p className="text-[11px]" style={{ color: "#8e9192" }}>Sorted: {view} arrival</p>
        </div>

        {tableBatches.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="h-8 w-8 mx-auto mb-3 opacity-20 text-white" />
            <p className="text-sm" style={{ color: "#8e9192" }}>No active batches yet.</p>
            <p className="text-xs mt-1" style={{ color: "#8e9192" }}>Stock appears here after a confirmed GRN.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ color: "#8e9192" }}>
                  <th className="px-5 py-4 text-[10px] font-medium uppercase tracking-widest">Batch ID</th>
                  <th className="px-5 py-4 text-[10px] font-medium uppercase tracking-widest">SKU</th>
                  <th className="px-5 py-4 text-[10px] font-medium uppercase tracking-widest">Received</th>
                  <th className="px-5 py-4 text-[10px] font-medium uppercase tracking-widest text-right">Current Stock</th>
                  <th className="px-5 py-4 text-[10px] font-medium uppercase tracking-widest">Velocity</th>
                  <th className="px-5 py-4 text-[10px] font-medium uppercase tracking-widest text-right">Landed/pc</th>
                  <th className="px-5 py-4" />
                </tr>
              </thead>
              <tbody>
                {tableBatches.map((batch, i) => {
                  const sku = skus.find((s) => s.id === batch.sku_id);
                  const isFirst = i === 0;
                  const isLow = batch.qty_pieces_remaining < LOW_STOCK_THRESHOLD;
                  const velocityLabel = isLow ? "Low" : isFirst ? "High" : "Med";
                  const velocityColor = isLow ? "#ffb4ab" : isFirst ? "#ffffff" : "#8e9192";
                  const velocityWidth = isLow ? "8%" : isFirst ? "80%" : "40%";

                  return (
                    <tr
                      key={batch.batch_id}
                      className="group cursor-pointer transition-colors"
                      style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td className="px-5 py-5">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              background: isFirst ? "#ffffff" : isLow ? "#ffb4ab" : "#8e9192",
                              animation: isFirst ? "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" : undefined,
                            }}
                          />
                          <span className="text-[13px] font-bold text-white">
                            {batch.batch_id.slice(-8).toUpperCase()}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-5">
                        <span className="text-[13px]" style={{ color: "#c4c7c8" }}>
                          {sku ? `${sku.brand_name} · ${sku.variant_display}` : batch.sku_id}
                        </span>
                      </td>
                      <td className="px-5 py-5">
                        <span className="text-[13px]" style={{ color: "#8e9192" }}>
                          {new Date(batch.received_at).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </td>
                      <td className="px-5 py-5 text-right">
                        <span className="text-[13px] font-bold" style={{ color: isLow ? "#ffb4ab" : "#ffffff" }}>
                          {batch.qty_pieces_remaining.toLocaleString()}
                        </span>
                        <span className="text-[11px] ml-1" style={{ color: "#8e9192" }}>pcs</span>
                      </td>
                      <td className="px-5 py-5">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-12 h-1.5 rounded-full overflow-hidden"
                            style={{ background: "rgba(255,255,255,0.08)" }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{ width: velocityWidth, background: velocityColor }}
                            />
                          </div>
                          <span className="text-[10px]" style={{ color: velocityColor }}>{velocityLabel}</span>
                        </div>
                      </td>
                      <td className="px-5 py-5 text-right">
                        <span className="text-[13px]" style={{ color: "#8e9192" }}>
                          {batch.landed_per_piece_mvr.toFixed(2)} MVR
                        </span>
                      </td>
                      <td className="px-5 py-5 text-right">
                        <ChevronRight
                          className="h-4 w-4 transition-colors group-hover:text-white"
                          style={{ color: "#8e9192" }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

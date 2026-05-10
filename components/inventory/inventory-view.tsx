"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, AlertTriangle, Package, ChevronDown } from "lucide-react";
import { listBatchStock, type BatchStock } from "@/lib/queries/inventory";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { listGodowns, type GodownRow } from "@/lib/queries/masters";

const CARD: React.CSSProperties = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function toCartons(pieces: number, pcsPerCarton: number) {
  return pcsPerCarton > 0 ? Math.floor(pieces / pcsPerCarton) : 0;
}
function remainderPacks(pieces: number, pcsPerPack: number, pcsPerCarton: number) {
  const rem = pcsPerCarton > 0 ? pieces % pcsPerCarton : pieces;
  return pcsPerPack > 0 ? Math.floor(rem / pcsPerPack) : 0;
}
function remainderPieces(pieces: number, pcsPerPack: number) {
  return pcsPerPack > 0 ? pieces % pcsPerPack : pieces;
}

/* ── Types ───────────────────────────────────────────────────────────────── */

interface SkuStock {
  sku: SkuFullRow;
  totalPieces: number;
  byGodown: {
    godown: GodownRow;
    pieces: number;
    batches: BatchStock[];
  }[];
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function InventoryView() {
  const [skus, setSkus]       = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [batches, setBatches] = useState<BatchStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([listSkusFlat(), listGodowns(), listBatchStock()])
      .then(([s, g, b]) => { setSkus(s); setGodowns(g); setBatches(b); })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  /* ── Roll up batches → per-SKU, per-godown ─────────────────────────────── */
  const stockList = useMemo<SkuStock[]>(() => {
    return skus
      .map((sku) => {
        const skuBatches = batches.filter((b) => b.sku_id === sku.id && b.qty_pieces_remaining > 0);
        const godownMap = new Map<string, { pieces: number; batches: BatchStock[] }>();
        for (const b of skuBatches) {
          const entry = godownMap.get(b.godown_id) ?? { pieces: 0, batches: [] };
          entry.pieces += b.qty_pieces_remaining;
          entry.batches.push(b);
          godownMap.set(b.godown_id, entry);
        }
        const byGodown = Array.from(godownMap.entries())
          .map(([gid, entry]) => {
            const godown = godowns.find((g) => g.id === gid);
            return godown ? { godown, ...entry } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        const totalPieces = byGodown.reduce((a, x) => a + x.pieces, 0);
        return { sku, totalPieces, byGodown };
      })
      .filter((r) => r.sku.is_active && r.totalPieces > 0);
  }, [skus, batches, godowns]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return stockList;
    return stockList.filter((r) =>
      [r.sku.brand_name, r.sku.model_name, r.sku.variant_display, r.sku.internal_code ?? ""]
        .join(" ").toLowerCase().includes(term),
    );
  }, [stockList, q]);

  /* ── Summary stats ──────────────────────────────────────────────────────── */
  const totalSkusInStock = stockList.length;
  const lowStockSkus     = stockList.filter((r) => {
    const pcsPerCarton = r.sku.pcs_per_pack * r.sku.packs_per_carton;
    return toCartons(r.totalPieces, pcsPerCarton) < 5;
  });

  if (loading) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--background)", minHeight: "100vh", padding: "0 0 120px 0" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>Operations</p>
        <h1 style={{ color: "var(--foreground)", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>Inventory</h1>
      </div>

      {/* ── Summary stats ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
        <div style={{ ...CARD, borderRadius: 14, padding: "16px 18px" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>SKUs in Stock</p>
          <p style={{ color: "var(--foreground)", fontSize: 28, fontWeight: 300, letterSpacing: "-0.02em" }}>{totalSkusInStock}</p>
        </div>
        <div style={{ ...CARD, borderRadius: 14, padding: "16px 18px" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Active Batches</p>
          <p style={{ color: "var(--foreground)", fontSize: 28, fontWeight: 300, letterSpacing: "-0.02em" }}>{batches.filter((b) => b.qty_pieces_remaining > 0).length}</p>
        </div>
        <div style={{ ...CARD, borderRadius: 14, padding: "16px 18px" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Low Stock</p>
          <p style={{ color: lowStockSkus.length > 0 ? "#ffb4ab" : "#4ade80", fontSize: 28, fontWeight: 300, letterSpacing: "-0.02em" }}>{lowStockSkus.length}</p>
          <p style={{ color: "var(--muted-foreground)", fontSize: 10, marginTop: 2 }}>{lowStockSkus.length > 0 ? "< 5 cartons" : "All OK"}</p>
        </div>
      </div>

      {/* ── Search ── */}
      <div style={{ ...CARD, borderRadius: 14, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", height: 46, marginBottom: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
        <Search style={{ width: 16, height: 16, color: "var(--muted-foreground)", flexShrink: 0 }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search brand, SKU, code…"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 14, color: "var(--foreground)" }}
        />
      </div>

      {/* ── Stock list ── */}
      {filtered.length === 0 ? (
        <div style={{ ...CARD, borderRadius: 16, padding: "48px 24px", textAlign: "center" }}>
          <Package style={{ width: 32, height: 32, color: "var(--muted-foreground)", margin: "0 auto 12px", opacity: 0.3 }} />
          <p style={{ color: "var(--muted-foreground)", fontSize: 14 }}>
            {stockList.length === 0 ? "No stock yet — confirm a shipment GRN to populate inventory." : "No results."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((row) => {
            const pcsPerCarton = row.sku.pcs_per_pack * row.sku.packs_per_carton;
            const ctns   = toCartons(row.totalPieces, pcsPerCarton);
            const packs  = remainderPacks(row.totalPieces, row.sku.pcs_per_pack, pcsPerCarton);
            const pieces = remainderPieces(row.totalPieces, row.sku.pcs_per_pack) + packs * row.sku.pcs_per_pack;
            const isExpanded = expanded === row.sku.id;
            const isLow = ctns < 5;

            // Landed cost — from oldest batch (FIFO) if multiple
            const fifoLanded = row.byGodown
              .flatMap((g) => g.batches)
              .sort((a, b) => a.received_at.localeCompare(b.received_at))[0]?.landed_per_piece_mvr ?? 0;
            const landedPerPack   = fifoLanded * row.sku.pcs_per_pack;
            const landedPerCarton = landedPerPack * row.sku.packs_per_carton;

            return (
              <div key={row.sku.id} style={{ ...CARD, borderRadius: 14, overflow: "hidden", border: isLow ? "1px solid rgba(255,180,171,0.2)" : "1px solid transparent" }}>

                {/* ── Row header ── */}
                <div
                  style={{ padding: "16px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
                  onClick={() => setExpanded(isExpanded ? null : row.sku.id)}
                >
                  {/* Low stock dot */}
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: isLow ? "#ffb4ab" : "#4ade80", flexShrink: 0 }} />

                  {/* Name */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: "var(--foreground)", fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {row.sku.brand_name} · {row.sku.model_name} · {row.sku.variant_display}
                    </p>
                    <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 2 }}>
                      {row.sku.internal_code} · {row.sku.pcs_per_pack}/pk × {row.sku.packs_per_carton}/ctn
                      {row.byGodown.length > 0 && ` · ${row.byGodown.map((g) => g.godown.name).join(", ")}`}
                    </p>
                  </div>

                  {/* Stock summary — cartons first */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{ color: isLow ? "#ffb4ab" : "var(--foreground)", fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>
                      {ctns} <span style={{ fontSize: 12, fontWeight: 500 }}>ctn</span>
                      {packs > 0 && <span style={{ fontSize: 13, color: "var(--muted-foreground)", marginLeft: 6 }}>+ {packs} pk</span>}
                    </p>
                    <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 1 }}>{row.totalPieces.toLocaleString()} pcs total</p>
                  </div>

                  <ChevronDown style={{ width: 16, height: 16, color: "var(--muted-foreground)", flexShrink: 0, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </div>

                {/* ── Expanded detail ── */}
                {isExpanded && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "16px 18px" }}>

                    {/* Landed cost at all 3 levels */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
                      {[
                        { label: "Landed / piece", value: `MVR ${fifoLanded.toFixed(3)}` },
                        { label: "Landed / pack", value: `MVR ${landedPerPack.toFixed(2)}` },
                        { label: "Landed / carton", value: `MVR ${landedPerCarton.toFixed(0)}`, highlight: true },
                      ].map((c) => (
                        <div key={c.label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 12px" }}>
                          <p style={{ color: "var(--muted-foreground)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{c.label}</p>
                          <p style={{ color: c.highlight ? "#4ade80" : "var(--foreground)", fontSize: 15, fontWeight: 700 }}>{c.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Per-godown breakdown */}
                    <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>By Warehouse</p>
                    {row.byGodown.map(({ godown, pieces: gPieces, batches: gBatches }) => {
                      const gCtns  = toCartons(gPieces, pcsPerCarton);
                      const gPacks = remainderPacks(gPieces, row.sku.pcs_per_pack, pcsPerCarton);
                      return (
                        <div key={godown.id} style={{ marginBottom: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                            <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>{godown.name}</p>
                            <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>
                              {gCtns} ctn{gPacks > 0 ? ` + ${gPacks} pk` : ""}
                              <span style={{ color: "var(--muted-foreground)", fontWeight: 400, marginLeft: 6 }}>({gPieces.toLocaleString()} pcs)</span>
                            </p>
                          </div>

                          {/* Batch rows */}
                          {gBatches
                            .sort((a, b) => a.received_at.localeCompare(b.received_at))
                            .map((batch, bi) => {
                              const bCtns  = toCartons(batch.qty_pieces_remaining, pcsPerCarton);
                              const bPacks = remainderPacks(batch.qty_pieces_remaining, row.sku.pcs_per_pack, pcsPerCarton);
                              return (
                                <div key={batch.batch_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 4 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    {bi === 0 && (
                                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", background: "rgba(255,255,255,0.1)", color: "var(--foreground)", borderRadius: 4, padding: "2px 6px" }}>FIFO</span>
                                    )}
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
                                      Batch {batch.batch_id.slice(-6).toUpperCase()} · {new Date(batch.received_at).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                                    </span>
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    <span style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>
                                      {bCtns} ctn{bPacks > 0 ? ` + ${bPacks} pk` : ""}
                                    </span>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 11, marginLeft: 6 }}>
                                      · MVR {batch.landed_per_piece_mvr.toFixed(2)}/pc
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      );
                    })}

                    {/* Low stock warning */}
                    {isLow && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "rgba(255,180,171,0.08)", borderRadius: 10, marginTop: 4, border: "1px solid rgba(255,180,171,0.15)" }}>
                        <AlertTriangle style={{ width: 14, height: 14, color: "#ffb4ab", flexShrink: 0 }} />
                        <p style={{ color: "#ffb4ab", fontSize: 12 }}>Low stock — only {ctns} carton{ctns !== 1 ? "s" : ""} remaining. Consider reordering.</p>
                      </div>
                    )}
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

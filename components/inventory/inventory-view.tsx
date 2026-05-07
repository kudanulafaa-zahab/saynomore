"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, Boxes, Layers, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listStockLevels, listBatchStock, type BatchStock } from "@/lib/queries/inventory";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { listGodowns, type GodownRow } from "@/lib/queries/masters";

interface SkuRollup {
  sku: SkuFullRow;
  totalPieces: number;
  byGodown: { godown: GodownRow; pieces: number }[];
  batches: BatchStock[];
}

export function InventoryView() {
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [batches, setBatches] = useState<BatchStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [godownFilter, setGodownFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

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
      // Combine batches + levels (we already have levels via batches.sum)
      setBatches(b);
      // levels left available if needed
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
        return { sku, totalPieces, byGodown, batches: skuBatches };
      })
      .filter((r) => r.sku.is_active);
  }, [skus, batches, godowns]);

  const filtered = useMemo(() => {
    let r = rollups;
    if (godownFilter !== "all") {
      r = r.filter((row) => row.byGodown.some((g) => g.godown.id === godownFilter));
    }
    const term = q.trim().toLowerCase();
    if (term) {
      r = r.filter((row) =>
        [row.sku.brand_name, row.sku.model_name, row.sku.variant_display, row.sku.internal_code]
          .join(" ")
          .toLowerCase()
          .includes(term),
      );
    }
    // Sort: out-of-stock at bottom, then by name
    return r.sort((a, b) => {
      if (a.totalPieces === 0 && b.totalPieces > 0) return 1;
      if (a.totalPieces > 0 && b.totalPieces === 0) return -1;
      return a.sku.brand_name.localeCompare(b.sku.brand_name);
    });
  }, [rollups, q, godownFilter]);

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading stock…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Operations</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Inventory</h1>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by brand, model, code…"
            className="pl-9 h-11"
          />
        </div>
        <Select value={godownFilter} onValueChange={(v) => v && setGodownFilter(v)}>
          <SelectTrigger className="w-[140px] h-11">
            <SelectValue>
              {godownFilter === "all" ? "All godowns" : godowns.find((g) => g.id === godownFilter)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All godowns</SelectItem>
            {godowns.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <Boxes className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-medium text-foreground">No stock yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Stock appears here automatically when you confirm a Shipment GRN.
          </p>
        </div>
      ) : (
        <div className="glass divide-y divide-border overflow-hidden">
          {filtered.map((row) => {
            const isOpen = expanded === row.sku.id;
            const visibleByGodown = godownFilter === "all"
              ? row.byGodown
              : row.byGodown.filter((g) => g.godown.id === godownFilter);
            const visibleTotal = visibleByGodown.reduce((acc, x) => acc + x.pieces, 0);
            const packs = row.sku.pcs_per_pack > 0 ? Math.floor(visibleTotal / row.sku.pcs_per_pack) : 0;
            const cartons = row.sku.pcs_per_carton > 0 ? Math.floor(visibleTotal / row.sku.pcs_per_carton) : 0;
            return (
              <div key={row.sku.id}>
                <button
                  onClick={() => setExpanded(isOpen ? null : row.sku.id)}
                  className="w-full p-4 flex items-center justify-between gap-3 hover:bg-accent/30 transition"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1 text-left">
                    <div
                      className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                        visibleTotal === 0
                          ? "bg-muted text-muted-foreground"
                          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                      }`}
                    >
                      <Boxes className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {row.sku.brand_name} › {row.sku.model_name} › {row.sku.variant_display}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {row.sku.pcs_per_pack}/pk × {row.sku.packs_per_carton}/ctn
                        {visibleByGodown.length > 1 && <> · across {visibleByGodown.length} godowns</>}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-lg font-semibold ${visibleTotal === 0 ? "text-muted-foreground" : "text-foreground"}`}>
                      {visibleTotal.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {cartons} ctn · {packs} pk
                    </p>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} />
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-background/30 px-4 py-3 space-y-3">
                    {/* Godown breakdown */}
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">By godown</p>
                      {visibleByGodown.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No stock in any godown.</p>
                      ) : (
                        visibleByGodown.map((bg) => (
                          <div key={bg.godown.id} className="flex justify-between py-1 text-xs">
                            <span className="text-foreground">{bg.godown.name}</span>
                            <span className="text-muted-foreground">{bg.pieces.toLocaleString()} pcs</span>
                          </div>
                        ))
                      )}
                    </div>

                    {/* FIFO batches */}
                    <div className="border-t border-border pt-2">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1">
                        <Layers className="h-3 w-3" /> Batches (FIFO oldest first)
                      </p>
                      {row.batches.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No batches.</p>
                      ) : (
                        row.batches
                          .filter((b) => godownFilter === "all" || b.godown_id === godownFilter)
                          .sort((a, b) => a.received_at.localeCompare(b.received_at))
                          .map((b) => {
                            const g = godowns.find((x) => x.id === b.godown_id);
                            return (
                              <div key={b.batch_id} className="grid grid-cols-3 gap-2 py-1 text-[11px]">
                                <span className="text-muted-foreground">
                                  {new Date(b.received_at).toLocaleDateString()}
                                </span>
                                <span className="text-muted-foreground truncate">{g?.name ?? "—"}</span>
                                <span className="text-right text-foreground">
                                  {b.qty_pieces_remaining.toLocaleString()} pcs
                                  <span className="text-muted-foreground"> @ {b.landed_per_piece_mvr.toFixed(2)} MVR</span>
                                </span>
                              </div>
                            );
                          })
                      )}
                    </div>
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

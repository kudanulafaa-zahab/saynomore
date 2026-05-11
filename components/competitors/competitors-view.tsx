"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Plus, Search, Store, Pencil, Trash2, AlertTriangle, ChevronDown, ChevronUp, Tag,
} from "lucide-react";
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

const CARD = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
} as const;

const CARD_L2 = {
  background: "var(--glass-2)",
  backdropFilter: "blur(30px)",
  WebkitBackdropFilter: "blur(30px)",
} as const;

const BASIS_LABEL: Record<PriceBasis, string> = {
  per_pack: "Per pack",
  per_piece: "Per piece",
  per_100ml: "Per 100ml",
  per_100g: "Per 100g",
  per_carton: "Per carton",
};

function GlassInput({ label, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      {label && <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <input
        {...props}
        className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-[#444748] transition"
        style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
      />
    </div>
  );
}

function GlassSelect({ label, value, onChange, children }: { label?: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none appearance-none"
        style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
      >
        {children}
      </select>
    </div>
  );
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
  // Margin simulator state
  const [simSku, setSimSku] = useState<SkuFullRow | null>(null);
  const [simPrice, setSimPrice] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const [c, p, s] = await Promise.all([listCompetitors(), listCompetitorPrices(), listSkusFlat()]);
      setCompetitors(c);
      setPrices(p);
      setSkus(s);
      // Default simulator to first active SKU with a selling price
      const first = s.find((sk) => sk.is_active && sk.selling_price_per_pack_mvr != null);
      if (first) {
        setSimSku(first);
        setSimPrice(first.selling_price_per_pack_mvr ?? 0);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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

  // Margin simulator calculations
  const landedCost = simSku?.landed_per_piece_mvr != null
    ? simSku.landed_per_piece_mvr * (simSku.pcs_per_pack || 1)
    : 0;
  const grossMarginMvr = simPrice - landedCost;
  const grossMarginPct = landedCost > 0 ? (grossMarginMvr / simPrice) * 100 : 0;
  const efficiency = landedCost > 0 && simPrice > 0
    ? Math.min(100, Math.max(0, Math.round(((simPrice - landedCost) / simPrice) * 100)))
    : 0;

  // Top competitor price for selected SKU
  const topCompPrice = simSku
    ? prices
        .filter((p) => p.variant_id === simSku.variant_id)
        .sort((a, b) => Number(b.price_mvr) - Number(a.price_mvr))[0]
    : null;

  // Per-piece comparison: group all competitor prices by variant, normalize to per-piece
  const perPieceComparison = useMemo(() => {
    // Collect variant IDs that have competitor prices
    const variantIds = Array.from(new Set(prices.map((p) => p.variant_id)));
    return variantIds.map((vid) => {
      const sku = skus.find((s) => s.variant_id === vid);
      const variantPrices = prices.filter((p) => p.variant_id === vid);
      const ourPcsPerPack = sku?.pcs_per_pack ?? 1;
      const ourPcsPerCarton = ourPcsPerPack * (sku?.packs_per_carton ?? 1);

      const normalized = variantPrices.map((p) => {
        const competitor = competitors.find((c) => c.id === p.competitor_id);
        let pricePiece: number | null = null;
        if (p.price_basis === "per_piece") {
          pricePiece = Number(p.price_mvr);
        } else if (p.price_basis === "per_pack") {
          const pcs = p.their_pcs_per_pack ?? ourPcsPerPack;
          pricePiece = Number(p.price_mvr) / pcs;
        } else if (p.price_basis === "per_carton") {
          pricePiece = Number(p.price_mvr) / ourPcsPerCarton;
        }
        // per_100ml / per_100g — cannot normalize to pieces
        return { price: p, competitor, pricePiece, observedDate: p.observed_date };
      }).sort((a, b) => {
        if (a.pricePiece === null) return 1;
        if (b.pricePiece === null) return -1;
        return a.pricePiece - b.pricePiece;
      });

      return { vid, sku, normalized };
    }).filter((v) => v.sku != null);
  }, [prices, skus, competitors]);

  if (loading) {
    return (
      <div className="rounded-2xl p-12 flex flex-col items-center" style={{ ...CARD, color: "var(--muted-foreground)" }}>
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="label-caps text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>Intelligence</p>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Pricing Strategy</h1>
        </div>
        <button
          onClick={() => setCompetitorDialog({ open: true })}
          className="flex items-center gap-2 h-11 px-5 rounded-full text-sm font-bold transition active:scale-95"
          style={{ background: "#ffffff", color: "#2f3131" }}
        >
          <Plus className="h-4 w-4" />
          Add Competitor
        </button>
      </div>

      {/* ── SKU Selector ── */}
      {skus.length > 0 && (
        <div>
          <p className="label-caps text-[10px] mb-1.5" style={{ color: "var(--muted-foreground)" }}>
            SKU: {simSku?.internal_code ?? "—"} · {simSku ? `${simSku.brand_name} ${simSku.variant_display}` : "Select a product below"}
          </p>
          <select
            value={simSku?.id ?? ""}
            onChange={(e) => {
              const s = skus.find((sk) => sk.id === e.target.value);
              if (s) { setSimSku(s); setSimPrice(s.selling_price_per_pack_mvr ?? 0); }
            }}
            className="h-11 rounded-xl px-4 text-sm text-foreground outline-none appearance-none w-full md:w-auto"
            style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
          >
            {skus.filter((s) => s.is_active).map((s) => (
              <option key={s.id} value={s.id}>{s.brand_name} · {s.variant_display}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Metric Bento Row ── */}
      {simSku && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl p-5" style={CARD}>
            <div className="flex items-center justify-between mb-2">
              <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>LANDED COST</p>
              <Tag className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
            </div>
            <p className="text-[32px] font-light tracking-tight text-foreground leading-none">
              {landedCost > 0 ? landedCost.toFixed(2) : "—"}
            </p>
            <p className="text-[11px] mt-2" style={{ color: "var(--muted-foreground)" }}>MVR per pack (landed)</p>
          </div>

          <div className="rounded-xl p-5" style={CARD}>
            <div className="flex items-center justify-between mb-2">
              <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>TOP COMPETITOR</p>
              <Store className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
            </div>
            <p className="text-[32px] font-light tracking-tight text-foreground leading-none">
              {topCompPrice ? Number(topCompPrice.price_mvr).toFixed(2) : "—"}
            </p>
            {topCompPrice && landedCost > 0 && (
              <p className="text-[11px] mt-2" style={{ color: Number(topCompPrice.price_mvr) > simPrice ? "#4ade80" : "#ffb4ab" }}>
                Delta: {(simPrice - Number(topCompPrice.price_mvr)).toFixed(2)} MVR
              </p>
            )}
            {!topCompPrice && (
              <p className="text-[11px] mt-2" style={{ color: "var(--muted-foreground)" }}>No prices logged yet</p>
            )}
          </div>

          <div className="rounded-xl p-5" style={CARD}>
            <div className="flex items-center justify-between mb-2">
              <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>CURRENT MARGIN</p>
              <Tag className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
            </div>
            <p className="text-[32px] font-light tracking-tight text-foreground leading-none">
              {landedCost > 0 ? `${grossMarginPct.toFixed(1)}%` : "—"}
            </p>
            <p className="text-[11px] mt-2" style={{ color: "var(--muted-foreground)" }}>
              Active price: {simPrice > 0 ? `${simPrice.toFixed(2)} MVR` : "—"}
            </p>
          </div>
        </div>
      )}

      {/* ── Margin Simulator ── */}
      {simSku && (
        <div className="rounded-xl overflow-hidden" style={CARD}>
          <div
            className="px-5 py-4 flex items-center justify-between"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}
          >
            <h2 className="text-[18px] font-semibold text-foreground">Margin Simulator</h2>
            <span
              className="text-[10px] font-bold px-3 py-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.08)", color: "var(--foreground)" }}
            >
              REAL-TIME
            </span>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="space-y-6">
              <div>
                <p className="label-caps text-[10px] mb-3" style={{ color: "var(--muted-foreground)" }}>TARGET SELLING PRICE (MVR)</p>
                <div
                  className="flex items-center justify-between rounded-xl px-5 py-4"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <button
                    onClick={() => setSimPrice(Math.max(0, simPrice - 5))}
                    className="text-[22px] font-light transition hover:opacity-70"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    −
                  </button>
                  <span className="text-[32px] font-light tracking-tight text-foreground">{simPrice.toFixed(2)}</span>
                  <button
                    onClick={() => setSimPrice(simPrice + 5)}
                    className="text-[22px] font-light transition hover:opacity-70 text-foreground"
                  >
                    +
                  </button>
                </div>
                <input
                  type="range"
                  min={landedCost}
                  max={Math.max(simPrice * 2, landedCost * 3)}
                  step={1}
                  value={simPrice}
                  onChange={(e) => setSimPrice(Number(e.target.value))}
                  className="w-full mt-3 accent-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="label-caps text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>GROSS MARGIN (MVR)</p>
                  <p
                    className="text-[22px] font-semibold"
                    style={{ color: grossMarginMvr >= 0 ? "#ffffff" : "#ffb4ab" }}
                  >
                    {grossMarginMvr >= 0 ? "+" : ""}{grossMarginMvr.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="label-caps text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>GROSS MARGIN (%)</p>
                  <p
                    className="text-[22px] font-semibold"
                    style={{ color: grossMarginPct >= 20 ? "#4ade80" : grossMarginPct >= 5 ? "#fb923c" : "#ffb4ab" }}
                  >
                    {grossMarginPct.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between space-y-5">
              <div>
                <div className="flex justify-between text-[12px] mb-2">
                  <span style={{ color: "var(--muted-foreground)" }}>Breakeven</span>
                  <span className="text-white font-medium">{landedCost.toFixed(2)} MVR</span>
                </div>
                <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div
                    className="h-full rounded-full bg-white transition-all"
                    style={{ width: `${Math.min(100, efficiency)}%`, boxShadow: "0 0 12px rgba(255,255,255,0.35)" }}
                  />
                </div>
                <div className="flex justify-between text-[11px] mt-2" style={{ color: "var(--muted-foreground)" }}>
                  <span>0%</span>
                  <span>Price Efficiency: {efficiency}%</span>
                </div>
              </div>
              <button
                onClick={async () => {
                  if (!simSku) return;
                  toast.success(`Selling price set to ${simPrice.toFixed(2)} MVR — update in Products page to save.`);
                }}
                className="w-full h-12 rounded-xl text-sm font-bold uppercase tracking-widest transition active:scale-95"
                style={{ background: "#ffffff", color: "#2f3131" }}
              >
                Set Selling Price
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Per-Piece Comparison ── */}
      {perPieceComparison.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={CARD}>
          <div
            className="px-5 py-4"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}
          >
            <h2 className="text-[18px] font-semibold text-foreground">Per-Piece Price Comparison</h2>
            <p className="text-[11px] mt-1" style={{ color: "var(--muted-foreground)" }}>
              All competitor prices normalized to MVR per piece · sorted cheapest first
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
            {perPieceComparison.map(({ vid, sku, normalized }) => {
              if (!sku) return null;
              const ourCost = sku.landed_per_piece_mvr;
              return (
                <div key={vid} className="p-5">
                  {/* Variant header */}
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[14px] font-semibold text-foreground">
                        {sku.brand_name} · {sku.model_name} · {sku.variant_display}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                        {sku.pcs_per_pack} pcs/pk · {sku.packs_per_carton} pk/ctn
                        {ourCost != null && (
                          <> · Our landed: <span className="text-foreground font-medium">MVR {Number(ourCost).toFixed(2)}/pc</span></>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Competitor rows */}
                  <div className="space-y-2">
                    {normalized.map(({ price, competitor, pricePiece, observedDate }) => {
                      const delta = ourCost != null && pricePiece != null ? pricePiece - Number(ourCost) : null;
                      const deltaColor = delta === null ? "var(--muted-foreground)" : delta > 0 ? "#4ade80" : "#ffb4ab";
                      return (
                        <div
                          key={price.id}
                          className="flex items-center justify-between rounded-xl px-4 py-3"
                          style={{ background: "rgba(255,255,255,0.04)" }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                              style={{ background: "rgba(255,255,255,0.07)" }}
                            >
                              <Store className="h-3.5 w-3.5 text-white" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-foreground truncate">
                                {competitor?.name ?? "Unknown"}
                              </p>
                              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                                {BASIS_LABEL[price.price_basis]} · {new Date(observedDate).toLocaleDateString("en-MV", { day: "numeric", month: "short" })}
                                {price.their_pcs_per_pack && <> · {price.their_pcs_per_pack} pcs/pk</>}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-4">
                            {pricePiece != null ? (
                              <>
                                <p className="text-[15px] font-semibold text-foreground">
                                  MVR {pricePiece.toFixed(2)}
                                </p>
                                {delta !== null && (
                                  <p className="text-[11px] font-medium" style={{ color: deltaColor }}>
                                    {delta > 0 ? "+" : ""}{delta.toFixed(2)} vs us
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                                {Number(price.price_mvr).toFixed(2)} ({BASIS_LABEL[price.price_basis]})
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Our selling price bar if available */}
                  {ourCost != null && sku.selling_price_per_piece_mvr != null && (
                    <div
                      className="flex items-center justify-between rounded-xl px-4 py-3 mt-2"
                      style={{ background: "rgba(99,102,241,0.10)", border: "1px solid rgba(99,102,241,0.20)" }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: "rgba(99,102,241,0.20)" }}
                        >
                          <Tag className="h-3.5 w-3.5" style={{ color: "#818cf8" }} />
                        </div>
                        <div>
                          <p className="text-[13px] font-medium" style={{ color: "#c7d2fe" }}>Our Selling Price</p>
                          <p className="text-[11px]" style={{ color: "rgba(199,210,254,0.6)" }}>at target margin</p>
                        </div>
                      </div>
                      <p className="text-[15px] font-semibold" style={{ color: "#c7d2fe" }}>
                        MVR {Number(sku.selling_price_per_piece_mvr).toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Search ── */}
      <div
        className="flex items-center gap-3 rounded-2xl px-4 h-12"
        style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search competitors…"
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
      </div>

      {/* ── Competitor List ── */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl p-10 flex flex-col items-center text-center space-y-3" style={CARD}>
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.08)" }}>
            <Store className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-semibold text-white">No competitors yet</h3>
          <p className="text-sm max-w-sm" style={{ color: "var(--muted-foreground)" }}>
            Add competitors and log their prices to compare against your margins.
          </p>
          <button onClick={() => setCompetitorDialog({ open: true })} className="mt-2 h-11 px-6 rounded-full text-sm font-bold" style={{ background: "#ffffff", color: "#2f3131" }}>
            Add first competitor
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((comp) => {
            const compPrices = pricesByComp.get(comp.id) ?? [];
            const isExpanded = expanded.has(comp.id);
            return (
              <div key={comp.id} className="rounded-2xl overflow-hidden" style={CARD}>
                <div className="p-4 flex items-center justify-between gap-3">
                  <button
                    onClick={() => toggleExpanded(comp.id)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: "rgba(255,255,255,0.08)" }}
                    >
                      <Store className="h-4 w-4 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-white">{comp.name}</p>
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                        {compPrices.length} price{compPrices.length !== 1 ? "s" : ""} logged
                        {comp.notes && <> · {comp.notes}</>}
                      </p>
                    </div>
                    {isExpanded
                      ? <ChevronUp className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                      : <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />}
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setPriceDialog({ open: true, competitorId: comp.id })}
                      className="h-8 px-3 rounded-lg text-[11px] font-bold transition"
                      style={{ background: "rgba(255,255,255,0.08)", color: "var(--foreground)" }}
                    >
                      + Price
                    </button>
                    <button
                      onClick={() => setCompetitorDialog({ open: true, editing: comp })}
                      className="h-8 w-8 rounded-lg flex items-center justify-center transition"
                      style={{ background: "rgba(255,255,255,0.06)", color: "#8e9192" }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteCompDialog(comp)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center transition"
                      style={{ background: "rgba(255,180,171,0.08)", color: "#ffb4ab" }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    {compPrices.length === 0 ? (
                      <div className="px-4 py-4 text-center">
                        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>No prices logged yet.</p>
                        <button onClick={() => setPriceDialog({ open: true, competitorId: comp.id })} className="text-[11px] text-white opacity-60 hover:opacity-100 mt-1">Log first price</button>
                      </div>
                    ) : (
                      compPrices.map((p) => {
                        const sku = skus.find((s) => s.variant_id === p.variant_id);
                        return (
                          <div
                            key={p.id}
                            className="px-4 py-3 flex items-start justify-between gap-3 transition"
                            style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] text-white truncate">
                                {sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "Unknown variant"}
                              </p>
                              <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                                <span className="text-white font-medium">{Number(p.price_mvr).toLocaleString(undefined, { maximumFractionDigits: 2 })} MVR</span>
                                {" "}{BASIS_LABEL[p.price_basis]}
                                {p.their_pcs_per_pack && <> · {p.their_pcs_per_pack} pcs/pk</>}
                                {" · "}{new Date(p.observed_date).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                              </p>
                              {p.notes && <p className="text-[11px] mt-0.5 italic" style={{ color: "var(--muted-foreground)" }}>{p.notes}</p>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => setPriceDialog({ open: true, editing: p, competitorId: p.competitor_id })}
                                className="h-7 w-7 rounded-lg flex items-center justify-center transition"
                                style={{ background: "rgba(255,255,255,0.06)", color: "#8e9192" }}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setDeletePriceDialog(p)}
                                className="h-7 w-7 rounded-lg flex items-center justify-center transition"
                                style={{ background: "rgba(255,180,171,0.08)", color: "#ffb4ab" }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Competitor Add/Edit Modal ── */}
      {competitorDialog.open && (
        <CompetitorModal
          editing={competitorDialog.editing}
          onClose={() => setCompetitorDialog({ open: false })}
          onDone={() => { setCompetitorDialog({ open: false }); load(); }}
        />
      )}

      {/* ── Price Add/Edit Modal ── */}
      {priceDialog.open && (
        <PriceModal
          editing={priceDialog.editing}
          competitorId={priceDialog.competitorId}
          competitors={competitors}
          skus={skus}
          onClose={() => setPriceDialog({ open: false })}
          onDone={() => { setPriceDialog({ open: false }); load(); }}
        />
      )}

      {/* ── Delete Competitor Modal ── */}
      {deleteCompDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.60)" }}>
          <div className="w-full max-w-sm rounded-3xl p-6 space-y-4" style={CARD_L2}>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,180,171,0.15)", color: "#ffb4ab" }}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-white">Delete competitor?</p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{deleteCompDialog.name}</p>
              </div>
            </div>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>All logged prices will be removed. Cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteCompDialog(null)} className="flex-1 h-12 rounded-xl text-sm font-semibold" style={{ background: "rgba(255,255,255,0.06)", color: "var(--foreground)" }}>Cancel</button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try { await deleteCompetitor(deleteCompDialog.id); toast.success("Removed"); setDeleteCompDialog(null); load(); }
                  catch (e) { toast.error((e as Error).message); }
                  finally { setDeleting(false); }
                }}
                className="flex-1 h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
                style={{ background: "rgba(255,180,171,0.20)", color: "#ffb4ab", border: "1px solid rgba(255,180,171,0.20)" }}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Price Modal ── */}
      {deletePriceDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.60)" }}>
          <div className="w-full max-w-sm rounded-3xl p-6 space-y-4" style={CARD_L2}>
            <p className="text-[15px] font-bold text-white">Remove price entry?</p>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>This price record will be permanently deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeletePriceDialog(null)} className="flex-1 h-12 rounded-xl text-sm font-semibold" style={{ background: "rgba(255,255,255,0.06)", color: "var(--foreground)" }}>Cancel</button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try { await deleteCompetitorPrice(deletePriceDialog.id); toast.success("Removed"); setDeletePriceDialog(null); load(); }
                  catch (e) { toast.error((e as Error).message); }
                  finally { setDeleting(false); }
                }}
                className="flex-1 h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
                style={{ background: "rgba(255,180,171,0.20)", color: "#ffb4ab", border: "1px solid rgba(255,180,171,0.20)" }}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Competitor Modal ──────────────────────────────────────────────────────────

function CompetitorModal({ editing, onClose, onDone }: { editing?: CompetitorRow; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const CARD_L2 = { background: "var(--glass-2)", backdropFilter: "blur(30px)", WebkitBackdropFilter: "blur(30px)" } as const;
  const CARD = { background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } as const;

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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.60)" }}>
      <div className="w-full max-w-md rounded-3xl p-6 space-y-4" style={CARD_L2}>
        <p className="text-[16px] font-bold text-white">{editing ? "Edit Competitor" : "Add Competitor"}</p>
        <div className="space-y-1.5">
          <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>NAME *</p>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Novelty" className="w-full h-11 rounded-xl px-4 text-sm text-white outline-none placeholder:text-[#444748]" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }} />
        </div>
        <div className="space-y-1.5">
          <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>NOTES</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" rows={2} className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none placeholder:text-[#444748] resize-none" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }} />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl text-sm font-semibold" style={{ background: "rgba(255,255,255,0.06)", color: "var(--foreground)" }}>Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40" style={{ background: "#ffffff", color: "#2f3131" }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : editing ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Price Modal ───────────────────────────────────────────────────────────────

function PriceModal({
  editing, competitorId, competitors, skus, onClose, onDone,
}: {
  editing?: CompetitorPriceRow;
  competitorId?: string;
  competitors: CompetitorRow[];
  skus: SkuFullRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const CARD_L2 = { background: "var(--glass-2)", backdropFilter: "blur(30px)", WebkitBackdropFilter: "blur(30px)" } as const;
  const CARD = { background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } as const;

  const [selectedCompId, setSelectedCompId] = useState(competitorId ?? editing?.competitor_id ?? "");
  const [variantId, setVariantId] = useState(editing?.variant_id ?? "");
  const [skuSearch, setSkuSearch] = useState("");
  const [priceMvr, setPriceMvr] = useState(editing ? String(editing.price_mvr) : "");
  const [priceBasis, setPriceBasis] = useState<PriceBasis>(editing?.price_basis ?? "per_pack");
  const [theirPcsPerPack, setTheirPcsPerPack] = useState(editing?.their_pcs_per_pack ? String(editing.their_pcs_per_pack) : "");
  const [observedDate, setObservedDate] = useState(editing?.observed_date ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const uniqueVariants = useMemo(() => {
    const seen = new Set<string>();
    return skus.filter((s) => { if (seen.has(s.variant_id)) return false; seen.add(s.variant_id); return true; });
  }, [skus]);

  const filteredVariants = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    if (!term) return uniqueVariants.slice(0, 30);
    return uniqueVariants.filter((s) => [s.brand_name, s.model_name, s.variant_display].join(" ").toLowerCase().includes(term)).slice(0, 30);
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.60)" }}>
      <div className="w-full max-w-md rounded-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" style={CARD_L2}>
        <p className="text-[16px] font-bold text-white">{editing ? "Edit Price" : "Log Competitor Price"}</p>

        {/* Competitor */}
        <div className="space-y-1.5">
          <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>COMPETITOR *</p>
          <select value={selectedCompId} onChange={(e) => setSelectedCompId(e.target.value)} className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none appearance-none" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}>
            <option value="">Pick competitor</option>
            {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Product (variant) */}
        <div>
          <p className="label-caps text-[10px] mb-1.5" style={{ color: "var(--muted-foreground)" }}>PRODUCT *</p>
          {!variantId ? (
            <>
              <input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} placeholder="Search brand, model…" className="w-full h-11 rounded-xl px-4 text-sm text-white outline-none placeholder:text-[#444748] mb-2" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }} />
              <div className="rounded-xl overflow-hidden max-h-[200px] overflow-y-auto" style={CARD}>
                {filteredVariants.map((s) => (
                  <button key={s.variant_id} onClick={() => setVariantId(s.variant_id)} className="w-full text-left px-4 py-3 text-sm text-white transition" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }} onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <p className="font-medium">{s.brand_name} › {s.model_name} › {s.variant_display}</p>
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn</p>
                  </button>
                ))}
                {filteredVariants.length === 0 && <p className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>No matches</p>}
              </div>
            </>
          ) : selectedSku ? (
            <div className="rounded-xl p-3 flex justify-between items-start" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}>
              <div>
                <p className="text-[13px] text-white">{selectedSku.brand_name} › {selectedSku.model_name} › {selectedSku.variant_display}</p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{selectedSku.pcs_per_pack}/pk × {selectedSku.packs_per_carton}/ctn</p>
              </div>
              <button onClick={() => setVariantId("")} className="text-[11px] text-white opacity-60 hover:opacity-100">Change</button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>THEIR PRICE (MVR) *</p>
            <input type="number" step="0.01" min="0" value={priceMvr} onChange={(e) => setPriceMvr(e.target.value)} className="w-full h-11 rounded-xl px-4 text-sm text-white outline-none" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }} />
          </div>
          <div className="space-y-1.5">
            <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>PRICE BASIS *</p>
            <select value={priceBasis} onChange={(e) => setPriceBasis(e.target.value as PriceBasis)} className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none appearance-none" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}>
              {(Object.keys(BASIS_LABEL) as PriceBasis[]).map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>THEIR PCS/PACK</p>
            <input type="number" min="1" value={theirPcsPerPack} onChange={(e) => setTheirPcsPerPack(e.target.value)} placeholder="Optional" className="w-full h-11 rounded-xl px-4 text-sm text-white outline-none placeholder:text-[#444748]" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }} />
          </div>
          <div className="space-y-1.5">
            <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>DATE OBSERVED *</p>
            <input type="date" value={observedDate} onChange={(e) => setObservedDate(e.target.value)} className="w-full h-11 rounded-xl px-4 text-sm text-white outline-none" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }} />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>NOTES</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Promotion price, seen at Novelty Maafannu" rows={2} className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none placeholder:text-[#444748] resize-none" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }} />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl text-sm font-semibold" style={{ background: "rgba(255,255,255,0.06)", color: "var(--foreground)" }}>Cancel</button>
          <button onClick={save} disabled={saving || !selectedCompId || !variantId || !priceMvr} className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40" style={{ background: "#ffffff", color: "#2f3131" }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : editing ? "Save" : "Log Price"}
          </button>
        </div>
      </div>
    </div>
  );
}

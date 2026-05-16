"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Plus, Search, Store, Pencil, Trash2, AlertTriangle,
  ChevronDown, ChevronUp, Tag, TrendingUp, CheckCircle2, Settings,
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
import { listSkusFlat, updateSku, type SkuFullRow } from "@/lib/queries/products";

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
  per_pack:   "Per pack",
  per_piece:  "Per piece",
  per_100ml:  "Per 100ml",
  per_100g:   "Per 100g",
  per_carton: "Per carton",
};

function fmt2(n: number) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function CompetitorsView() {
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([]);
  const [prices, setPrices]           = useState<CompetitorPriceRow[]>([]);
  const [skus, setSkus]               = useState<SkuFullRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [q, setQ]                     = useState("");
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());
  const [deleting, setDeleting]       = useState(false);

  // Dialogs
  const [competitorDialog, setCompetitorDialog] = useState<{ open: boolean; editing?: CompetitorRow }>({ open: false });
  const [priceDialog, setPriceDialog]           = useState<{ open: boolean; editing?: CompetitorPriceRow; competitorId?: string }>({ open: false });
  const [deleteCompDialog, setDeleteCompDialog] = useState<CompetitorRow | null>(null);
  const [deletePriceDialog, setDeletePriceDialog] = useState<CompetitorPriceRow | null>(null);

  // Simulator
  const [simSku, setSimSku]         = useState<SkuFullRow | null>(null);
  const [simPrice, setSimPrice]     = useState(0); // per PACK price
  const [simMode, setSimMode]       = useState<"pack" | "piece" | "carton">("pack");
  const [simEditing, setSimEditing] = useState(false);
  const [simTyped, setSimTyped]     = useState("");
  const [saving, setSaving]         = useState(false);
  const [saveMode, setSaveMode]     = useState<"margin" | "fixed">("margin"); // save as margin% or fixed price
  const [alertThreshold, setAlertThreshold] = useState(10); // % above cheapest competitor to warn
  const [showAlertSettings, setShowAlertSettings] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [c, p, s] = await Promise.all([listCompetitors(), listCompetitorPrices(), listSkusFlat()]);
      setCompetitors(c);
      setPrices(p);
      setSkus(s);
      const first = s.find((sk) => sk.is_active && sk.landed_per_piece_mvr != null);
      if (first) {
        setSimSku(first);
        setSimPrice(first.selling_price_per_pack_mvr ?? (first.landed_per_piece_mvr! * first.pcs_per_pack * 1.3));
      }
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // ── Sim calculations ──────────────────────────────────────────────────────
  const landedPerPiece  = simSku?.landed_per_piece_mvr ?? 0;
  const pcsPerPack      = simSku?.pcs_per_pack ?? 1;
  const packsPerCarton  = simSku?.packs_per_carton ?? 1;
  const landedPerPack   = landedPerPiece * pcsPerPack;
  const landedPerCarton = landedPerPiece * pcsPerPack * packsPerCarton;

  // Canonical: simPrice is always per pack internally
  const packPrice   = simPrice;
  const piecePrice  = simPrice / pcsPerPack;
  const cartonPrice = simPrice * packsPerCarton;

  const grossMarginMvr = packPrice - landedPerPack;
  const grossMarginPct = landedPerPack > 0 ? (grossMarginMvr / packPrice) * 100 : 0;
  const impliedMarginPct = landedPerPack > 0 && packPrice > landedPerPack
    ? Math.round(((packPrice - landedPerPack) / packPrice) * 1000) / 10
    : 0;

  // The displayed "sim input" changes unit labels based on mode
  const simDisplayPrice = simMode === "piece" ? piecePrice : simMode === "carton" ? cartonPrice : packPrice;
  function setSimDisplayPrice(v: number) {
    if (simMode === "piece")   setSimPrice(v * pcsPerPack);
    else if (simMode === "carton") setSimPrice(v / packsPerCarton);
    else setSimPrice(v);
  }

  const simLabel = simMode === "piece" ? "Per piece" : simMode === "carton" ? "Per carton" : "Per pack";

  // Top competitor for selected SKU — find cheapest competitor on a per-piece basis
  const topCompEntry = useMemo(() => {
    if (!simSku) return null;
    const relevant = prices.filter((p) => p.variant_id === simSku.variant_id);
    if (!relevant.length) return null;
    const normalized = relevant.map((p) => {
      const comp = competitors.find((c) => c.id === p.competitor_id);
      let perPiece: number | null = null;
      if (p.price_basis === "per_piece")   perPiece = Number(p.price_mvr);
      else if (p.price_basis === "per_pack")  perPiece = Number(p.price_mvr) / (p.their_pcs_per_pack ?? pcsPerPack);
      else if (p.price_basis === "per_carton") perPiece = Number(p.price_mvr) / (pcsPerPack * packsPerCarton);
      return { p, comp, perPiece };
    }).filter((x) => x.perPiece != null).sort((a, b) => a.perPiece! - b.perPiece!);
    return normalized[0] ?? null;
  }, [simSku, prices, competitors, pcsPerPack, packsPerCarton]);

  const topCompPerPiece   = topCompEntry?.perPiece ?? null;
  const topCompPerPack    = topCompPerPiece != null ? topCompPerPiece * pcsPerPack : null;
  const topCompPerCarton  = topCompPerPiece != null ? topCompPerPiece * pcsPerPack * packsPerCarton : null;

  // Per-piece comparison table (all variants with competitor prices)
  const perPieceComparison = useMemo(() => {
    const variantIds = Array.from(new Set(prices.map((p) => p.variant_id)));
    return variantIds.map((vid) => {
      const sku = skus.find((s) => s.variant_id === vid);
      if (!sku) return null;
      const ourPcsPerPack   = sku.pcs_per_pack ?? 1;
      const ourPcsPerCarton = ourPcsPerPack * (sku.packs_per_carton ?? 1);
      const variantPrices = prices.filter((p) => p.variant_id === vid);
      const normalized = variantPrices.map((p) => {
        const competitor = competitors.find((c) => c.id === p.competitor_id);
        let pricePiece: number | null = null;
        if (p.price_basis === "per_piece")   pricePiece = Number(p.price_mvr);
        else if (p.price_basis === "per_pack")  pricePiece = Number(p.price_mvr) / (p.their_pcs_per_pack ?? ourPcsPerPack);
        else if (p.price_basis === "per_carton") pricePiece = Number(p.price_mvr) / ourPcsPerCarton;
        return { price: p, competitor, pricePiece };
      }).sort((a, b) => {
        if (a.pricePiece == null) return 1;
        if (b.pricePiece == null) return -1;
        return a.pricePiece - b.pricePiece;
      });
      return { vid, sku, normalized };
    }).filter(Boolean) as { vid: string; sku: SkuFullRow; normalized: { price: CompetitorPriceRow; competitor: CompetitorRow | undefined; pricePiece: number | null }[] }[];
  }, [prices, skus, competitors]);

  const pricesByComp = useMemo(() => {
    const map = new Map<string, CompetitorPriceRow[]>();
    for (const p of prices) { const arr = map.get(p.competitor_id) ?? []; arr.push(p); map.set(p.competitor_id, arr); }
    return map;
  }, [prices]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return competitors;
    return competitors.filter((c) => c.name.toLowerCase().includes(term));
  }, [competitors, q]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function handleSetPrice() {
    if (!simSku || !landedPerPack || packPrice <= landedPerPack) return;
    setSaving(true);
    try {
      if (saveMode === "fixed") {
        await updateSku(simSku.id, { fixed_selling_price_mvr: piecePrice, target_margin_pct: null });
        toast.success(`Fixed price saved — MVR ${fmt2(piecePrice)}/pc · MVR ${fmt2(packPrice)}/pk · MVR ${fmt2(cartonPrice)}/ctn`);
      } else {
        await updateSku(simSku.id, { target_margin_pct: impliedMarginPct, fixed_selling_price_mvr: null });
        toast.success(`Margin saved — ${impliedMarginPct}% → MVR ${fmt2(piecePrice)}/pc · MVR ${fmt2(packPrice)}/pk · MVR ${fmt2(cartonPrice)}/ctn`);
      }
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  const isPriceChanged = simSku
    && Math.abs(packPrice - (simSku.selling_price_per_pack_mvr ?? 0)) > 0.01;

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
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Pricing</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPriceDialog({ open: true })}
            className="flex items-center gap-2 h-11 px-4 rounded-full text-sm font-bold transition active:scale-95"
            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "1px solid var(--glass-border-lo)" }}
          >
            <Tag className="h-4 w-4" />
            Log Price
          </button>
          <button
            onClick={() => setCompetitorDialog({ open: true })}
            className="flex items-center gap-2 h-11 px-5 rounded-full text-sm font-bold transition active:scale-95"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Plus className="h-4 w-4" />
            Add Competitor
          </button>
        </div>
      </div>

      {/* ── SKU Selector ── */}
      {skus.length > 0 && (
        <div>
          <p className="label-caps text-[10px] mb-1.5" style={{ color: "var(--muted-foreground)" }}>Analysing</p>
          <div className="relative">
            <select
              value={simSku?.id ?? ""}
              onChange={(e) => {
                const s = skus.find((sk) => sk.id === e.target.value);
                if (s) {
                  setSimSku(s);
                  setSimPrice(s.selling_price_per_pack_mvr ?? (s.landed_per_piece_mvr ?? 0) * s.pcs_per_pack * 1.3);
                }
              }}
              className="h-12 rounded-xl pl-4 pr-10 text-sm font-medium text-foreground outline-none appearance-none w-full cursor-pointer"
              style={{ ...CARD, border: "1px solid var(--glass-border)" }}
            >
              {skus.filter((s) => s.is_active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.brand_name} · {s.model_name} · {s.variant_display} ({s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn)
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
          </div>
        </div>
      )}

      {/* ── Metric Bento Row ── */}
      {simSku && (
        <div className="grid grid-cols-3 gap-3">
          {/* Landed Cost */}
          <div className="rounded-xl p-4" style={CARD}>
            <p className="label-caps text-[10px] mb-2" style={{ color: "var(--muted-foreground)" }}>LANDED COST</p>
            {landedPerPiece > 0 ? (
              <div className="space-y-1">
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  pc <span className="text-foreground font-semibold">MVR {fmt2(landedPerPiece)}</span>
                </p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  pk <span className="text-foreground font-semibold">MVR {fmt2(landedPerPack)}</span>
                </p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  ctn <span className="text-foreground font-semibold">MVR {fmt2(landedPerCarton)}</span>
                </p>
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>No shipment yet</p>
            )}
          </div>

          {/* Cheapest Competitor */}
          <div className="rounded-xl p-4" style={CARD}>
            <p className="label-caps text-[10px] mb-2" style={{ color: "var(--muted-foreground)" }}>CHEAPEST COMPETITOR</p>
            {topCompEntry && topCompPerPiece != null ? (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold truncate" style={{ color: "var(--foreground)" }}>{topCompEntry.comp?.name}</p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  pc <span className="text-foreground font-semibold">MVR {fmt2(topCompPerPiece)}</span>
                </p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  pk <span className="text-foreground font-semibold">MVR {fmt2(topCompPerPack!)}</span>
                </p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  ctn <span className="text-foreground font-semibold">MVR {fmt2(topCompPerCarton!)}</span>
                </p>
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>No prices logged yet</p>
            )}
          </div>

          {/* Our Current Price */}
          <div className="rounded-xl p-4" style={CARD}>
            <p className="label-caps text-[10px] mb-2" style={{ color: "var(--muted-foreground)" }}>OUR SELLING PRICE</p>
            {simSku.selling_price_per_piece_mvr != null ? (
              <div className="space-y-1">
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  pc <span className="text-foreground font-semibold">MVR {fmt2(Number(simSku.selling_price_per_piece_mvr))}</span>
                </p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  pk <span className="text-foreground font-semibold">MVR {fmt2(Number(simSku.selling_price_per_pack_mvr))}</span>
                </p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  ctn <span className="text-foreground font-semibold">MVR {fmt2(Number(simSku.selling_price_per_carton_mvr))}</span>
                </p>
                {simSku.target_margin_pct != null && (
                  <p className="text-[10px]" style={{ color: "var(--snm-success)" }}>{simSku.target_margin_pct}% margin</p>
                )}
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>Not set yet</p>
            )}
          </div>
        </div>
      )}

      {/* ── Margin Simulator ── */}
      {simSku && landedPerPiece > 0 && (
        <div className="rounded-xl overflow-hidden" style={CARD}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--glass-border-lo)" }}>
            <h2 className="text-[17px] font-semibold text-foreground">Margin Simulator</h2>
            {/* Unit toggle */}
            <div className="flex rounded-lg overflow-hidden" style={{ background: "var(--glass-bg-1)" }}>
              {(["piece", "pack", "carton"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setSimMode(m)}
                  className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition"
                  style={{
                    background: simMode === m ? "var(--foreground)" : "transparent",
                    color: simMode === m ? "var(--background)" : "var(--muted-foreground)",
                  }}
                >
                  {m === "piece" ? "Pc" : m === "pack" ? "Pk" : "Ctn"}
                </button>
              ))}
            </div>
          </div>

          <div className="p-5 space-y-5">
            {/* Price input — tap to type */}
            <div>
              <p className="label-caps text-[10px] mb-2" style={{ color: "var(--muted-foreground)" }}>
                SELLING PRICE — {simLabel.toUpperCase()} · tap number to type
              </p>
              <div className="rounded-xl px-5 py-4 text-center" style={{ background: "var(--glass-bg-1)", border: "1px solid var(--glass-border-lo)" }}>
                {simEditing ? (
                  <input
                    autoFocus
                    type="number"
                    inputMode="decimal"
                    value={simTyped}
                    onChange={(e) => setSimTyped(e.target.value)}
                    onBlur={() => {
                      const v = parseFloat(simTyped);
                      if (!isNaN(v) && v > 0) setSimDisplayPrice(v);
                      setSimEditing(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const v = parseFloat(simTyped);
                        if (!isNaN(v) && v > 0) setSimDisplayPrice(v);
                        setSimEditing(false);
                      }
                      if (e.key === "Escape") setSimEditing(false);
                    }}
                    className="text-[40px] font-light tracking-tight text-foreground text-center bg-transparent outline-none border-none w-full"
                  />
                ) : (
                  <button
                    onClick={() => { setSimTyped(String(simDisplayPrice)); setSimEditing(true); }}
                    className="text-[40px] font-light tracking-tight text-foreground hover:opacity-70 transition w-full"
                  >
                    {fmt2(simDisplayPrice)}
                  </button>
                )}
                <p className="text-[13px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>MVR</p>
              </div>

              {/* Slider */}
              <input
                type="range"
                min={simMode === "carton" ? landedPerCarton : simMode === "piece" ? landedPerPiece : landedPerPack}
                max={simMode === "carton" ? landedPerCarton / 0.05 : simMode === "piece" ? landedPerPiece / 0.05 : landedPerPack / 0.05}
                step={simMode === "carton" ? 1 : 0.01}
                value={Math.min(simDisplayPrice, simMode === "carton" ? landedPerCarton / 0.05 : simMode === "piece" ? landedPerPiece / 0.05 : landedPerPack / 0.05)}
                onChange={(e) => setSimDisplayPrice(Number(e.target.value))}
                className="w-full mt-3 accent-white"
              />

              {/* Margin nudge preset buttons */}
              <div className="flex gap-2 mt-3">
                {[5, 10, 15, 20, 30, 40, 50].map((pct) => {
                  const landed = simMode === "carton" ? landedPerCarton : simMode === "piece" ? landedPerPiece : landedPerPack;
                  const targetPrice = landed / (1 - pct / 100);
                  const currentMargin = landed > 0 ? ((simDisplayPrice - landed) / simDisplayPrice) * 100 : 0;
                  const isActive = Math.abs(currentMargin - pct) < 0.5;
                  return (
                    <button
                      key={pct}
                      onClick={() => setSimDisplayPrice(Math.round(targetPrice * 100) / 100)}
                      className="flex-1 h-8 rounded-lg text-[11px] font-semibold transition active:scale-95"
                      style={{
                        background: isActive ? "var(--foreground)" : "color-mix(in srgb, var(--foreground) 8%, transparent)",
                        color: isActive ? "var(--background)" : "var(--muted-foreground)",
                      }}
                    >
                      {pct}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* All three price levels — with both margin % AND markup % */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Per piece",  value: piecePrice,  landed: landedPerPiece },
                { label: "Per pack",   value: packPrice,   landed: landedPerPack  },
                { label: "Per carton", value: cartonPrice, landed: landedPerCarton },
              ].map(({ label, value, landed }) => {
                const margin = landed > 0 ? ((value - landed) / value) * 100 : 0;
                const markup = landed > 0 ? ((value - landed) / landed) * 100 : 0;
                const color = margin >= 20 ? "var(--snm-success)" : margin >= 5 ? "var(--snm-warning)" : "var(--snm-error)";
                return (
                  <div key={label} className="rounded-xl p-3 text-center space-y-1" style={{ background: "var(--glass-bg-1)" }}>
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{label}</p>
                    <p className="text-[15px] font-semibold text-foreground">MVR {fmt2(value)}</p>
                    <p className="text-[11px] font-bold" style={{ color }}>{margin.toFixed(1)}% margin</p>
                    <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{markup >= 1000 ? `${(markup/1000).toFixed(1)}k` : markup.toFixed(0)}% markup</p>
                  </div>
                );
              })}
            </div>

            {/* Competitor gap row */}
            {topCompPerPiece != null && (() => {
              const delta = piecePrice - topCompPerPiece;
              const pctAbove = topCompPerPiece > 0 ? (delta / topCompPerPiece) * 100 : 0;
              const isAlert = delta > 0 && pctAbove > alertThreshold;
              const col = delta <= 0 ? "var(--snm-success)" : isAlert ? "var(--snm-error)" : "var(--snm-warning)";
              return (
                <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: isAlert ? "color-mix(in srgb, var(--snm-error) 8%, transparent)" : "var(--glass-bg-1)", border: `1px solid ${isAlert ? "color-mix(in srgb, var(--snm-error) 25%, transparent)" : "var(--glass-border-lo)"}` }}>
                  <div>
                    <p className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                      vs <span className="text-foreground">{topCompEntry?.comp?.name}</span> (cheapest)
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                      Alert if &gt;{alertThreshold}% above competitor
                      <button onClick={() => setShowAlertSettings(!showAlertSettings)} className="ml-2 inline-flex items-center" style={{ color: "var(--snm-brand)" }}>
                        <Settings className="h-3 w-3" />
                      </button>
                    </p>
                    {showAlertSettings && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Alert at</span>
                        {[5, 10, 15, 20, 25].map((t) => (
                          <button key={t} onClick={() => { setAlertThreshold(t); setShowAlertSettings(false); }}
                            className="px-2 py-0.5 rounded text-[11px] font-semibold"
                            style={{ background: alertThreshold === t ? "var(--snm-brand)" : "color-mix(in srgb, var(--foreground) 8%, transparent)", color: alertThreshold === t ? "#fff" : "var(--muted-foreground)" }}>
                            {t}%
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-bold" style={{ color: col }}>
                      {delta <= 0 ? "▼ " : "▲ "}{Math.abs(delta).toFixed(2)} MVR/pc
                    </p>
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      {delta <= 0 ? "You're cheaper" : isAlert ? `${pctAbove.toFixed(0)}% above — review price` : "Competitor cheaper"}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Save mode toggle + save button */}
            <div className="space-y-2">
              {/* Toggle: save as margin % or fixed price */}
              <div className="flex rounded-xl overflow-hidden" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}>
                <button
                  onClick={() => setSaveMode("margin")}
                  className="flex-1 h-9 text-[12px] font-semibold transition"
                  style={{ background: saveMode === "margin" ? "var(--foreground)" : "transparent", color: saveMode === "margin" ? "var(--background)" : "var(--muted-foreground)" }}
                >
                  Save as margin % ({impliedMarginPct}%)
                </button>
                <button
                  onClick={() => setSaveMode("fixed")}
                  className="flex-1 h-9 text-[12px] font-semibold transition"
                  style={{ background: saveMode === "fixed" ? "var(--foreground)" : "transparent", color: saveMode === "fixed" ? "var(--background)" : "var(--muted-foreground)" }}
                >
                  Save as fixed price (MVR {fmt2(piecePrice)}/pc)
                </button>
              </div>
              <p className="text-[10px] px-1" style={{ color: "var(--muted-foreground)" }}>
                {saveMode === "margin"
                  ? "Price auto-updates with each new shipment as landed cost changes."
                  : "Price stays fixed regardless of landed cost changes."}
              </p>

              {/* Save button */}
              <button
                onClick={handleSetPrice}
                disabled={saving || !landedPerPack || packPrice <= landedPerPack}
                className="w-full h-12 rounded-xl text-sm font-bold uppercase tracking-widest transition active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: isPriceChanged ? "var(--foreground)" : "var(--glass-bg-2)", color: isPriceChanged ? "var(--background)" : "var(--muted-foreground)" }}
              >
                {saving
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : isPriceChanged
                    ? <><TrendingUp className="h-4 w-4" /> Save Selling Price</>
                    : <><CheckCircle2 className="h-4 w-4" /> Price Up to Date</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Per-Piece Comparison Table ── */}
      {perPieceComparison.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={CARD}>
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--glass-border-lo)" }}>
            <h2 className="text-[17px] font-semibold text-foreground">Price Comparison</h2>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>All prices normalised to per piece · sorted cheapest first</p>
          </div>
          <div className="divide-y divide-border">
            {perPieceComparison.map(({ vid, sku, normalized }) => {
              const ourCost = sku.landed_per_piece_mvr;
              return (
                <div key={vid} className="p-5">
                  <div className="mb-3">
                    <p className="text-[14px] font-semibold text-foreground">{sku.brand_name} · {sku.model_name} · {sku.variant_display}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                      {sku.pcs_per_pack} pcs/pk · {sku.packs_per_carton} pk/ctn
                      {ourCost != null && <> · Landed MVR {fmt2(Number(ourCost))}/pc</>}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {normalized.map(({ price, competitor, pricePiece }) => {
                      const delta = ourCost != null && pricePiece != null ? pricePiece - Number(ourCost) : null;
                      const deltaColor = delta == null ? "var(--muted-foreground)" : delta > 0 ? "var(--snm-success)" : "var(--snm-error)";
                      return (
                        <div key={price.id} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "var(--glass-bg-1)" }}>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--glass-bg-2)" }}>
                              <Store className="h-3.5 w-3.5 text-foreground" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-foreground truncate">{competitor?.name ?? "Unknown"}</p>
                              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                                {BASIS_LABEL[price.price_basis]} · {new Date(price.observed_date).toLocaleDateString("en-MV", { day: "numeric", month: "short" })}
                                {price.their_pcs_per_pack ? <> · {price.their_pcs_per_pack} pcs/pk</> : null}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-4">
                            {pricePiece != null ? (
                              <>
                                <p className="text-[14px] font-semibold text-foreground">MVR {fmt2(pricePiece)}<span className="text-[10px] text-foreground/40">/pc</span></p>
                                {delta != null && (
                                  <p className="text-[11px] font-medium" style={{ color: deltaColor }}>
                                    {delta > 0 ? "+" : ""}{fmt2(delta)} vs landed
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                                {fmt2(Number(price.price_mvr))} ({BASIS_LABEL[price.price_basis]})
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {sku.selling_price_per_piece_mvr != null && (
                      <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-brand) 20%, transparent)" }}>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--snm-brand) 20%, transparent)" }}>
                            <Tag className="h-3.5 w-3.5" style={{ color: "var(--snm-brand)" }} />
                          </div>
                          <div>
                            <p className="text-[13px] font-medium" style={{ color: "var(--snm-brand)" }}>Our Selling Price</p>
                            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{sku.target_margin_pct}% margin</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[14px] font-semibold" style={{ color: "var(--snm-brand)" }}>MVR {fmt2(Number(sku.selling_price_per_piece_mvr))}<span className="text-[10px] opacity-60">/pc</span></p>
                          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>MVR {fmt2(Number(sku.selling_price_per_carton_mvr))}/ctn</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Competitors section ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] font-semibold text-foreground">Competitors ({competitors.length})</p>
          <button
            onClick={() => setCompetitorDialog({ open: true })}
            className="h-8 px-3 rounded-lg text-[11px] font-bold transition"
            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}
          >
            + Add
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-3 rounded-xl px-4 h-11 mb-3" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search competitors…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl p-10 flex flex-col items-center text-center space-y-3" style={CARD}>
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
              <Store className="h-6 w-6 text-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground">No competitors yet</h3>
            <p className="text-sm max-w-sm" style={{ color: "var(--muted-foreground)" }}>
              Add competitors to start tracking their prices.
            </p>
            <button onClick={() => setCompetitorDialog({ open: true })} className="mt-2 h-11 px-6 rounded-full text-sm font-bold" style={{ background: "var(--foreground)", color: "var(--background)" }}>
              Add first competitor
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((comp) => {
              const compPrices = pricesByComp.get(comp.id) ?? [];
              const isExpanded = expanded.has(comp.id);
              return (
                <div key={comp.id} className="rounded-2xl overflow-hidden" style={CARD}>
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <button onClick={() => toggleExpanded(comp.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                      <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--glass-bg-2)" }}>
                        <Store className="h-4 w-4 text-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-semibold text-foreground">{comp.name}</p>
                        <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                          {compPrices.length} price{compPrices.length !== 1 ? "s" : ""} logged
                          {comp.notes ? ` · ${comp.notes}` : ""}
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
                        style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}
                      >
                        + Price
                      </button>
                      <button onClick={() => setCompetitorDialog({ open: true, editing: comp })} className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setDeleteCompDialog(comp)} className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--snm-error) 8%, transparent)", color: "var(--snm-error)" }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop: "1px solid var(--glass-border-lo)" }}>
                      {compPrices.length === 0 ? (
                        <div className="px-4 py-4 text-center">
                          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>No prices logged yet.</p>
                          <button onClick={() => setPriceDialog({ open: true, competitorId: comp.id })} className="text-[11px] text-foreground opacity-60 hover:opacity-100 mt-1">Log first price</button>
                        </div>
                      ) : (
                        compPrices.map((p) => {
                          const sku = skus.find((s) => s.variant_id === p.variant_id);
                          return (
                            <div
                              key={p.id}
                              className="px-4 py-3 flex items-start justify-between gap-3"
                              style={{ borderBottom: "1px solid var(--glass-border-lo)" }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--glass-bg-1)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] text-foreground truncate">
                                  {sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "Unknown"}
                                </p>
                                <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                                  <span className="text-foreground font-medium">MVR {fmt2(Number(p.price_mvr))}</span>
                                  {" "}{BASIS_LABEL[p.price_basis]}
                                  {p.their_pcs_per_pack ? ` · ${p.their_pcs_per_pack} pcs/pk` : ""}
                                  {" · "}{new Date(p.observed_date).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                                </p>
                                {p.notes && <p className="text-[11px] mt-0.5 italic" style={{ color: "var(--muted-foreground)" }}>{p.notes}</p>}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button onClick={() => setPriceDialog({ open: true, editing: p, competitorId: p.competitor_id })} className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}>
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button onClick={() => setDeletePriceDialog(p)} className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--snm-error) 8%, transparent)", color: "var(--snm-error)" }}>
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
      </div>

      {/* ── Modals ── */}
      {competitorDialog.open && (
        <CompetitorModal
          editing={competitorDialog.editing}
          onClose={() => setCompetitorDialog({ open: false })}
          onDone={() => { setCompetitorDialog({ open: false }); load(); }}
        />
      )}
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
      {deleteCompDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.60)" }}>
          <div className="w-full max-w-sm rounded-3xl p-6 space-y-4" style={CARD_L2}>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--snm-error) 15%, transparent)", color: "var(--snm-error)" }}><AlertTriangle className="h-5 w-5" /></div>
              <div>
                <p className="text-[15px] font-bold text-foreground">Delete competitor?</p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{deleteCompDialog.name}</p>
              </div>
            </div>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>All logged prices will also be removed.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteCompDialog(null)} className="flex-1 h-12 rounded-xl text-sm font-semibold" style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try { await deleteCompetitor(deleteCompDialog.id); toast.success("Removed"); setDeleteCompDialog(null); load(); }
                  catch (e) { toast.error((e as Error).message); }
                  finally { setDeleting(false); }
                }}
                className="flex-1 h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
                style={{ background: "var(--snm-error)", color: "var(--background)" }}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {deletePriceDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.60)" }}>
          <div className="w-full max-w-sm rounded-3xl p-6 space-y-4" style={CARD_L2}>
            <p className="text-[15px] font-bold text-foreground">Remove price entry?</p>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>This price record will be permanently deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeletePriceDialog(null)} className="flex-1 h-12 rounded-xl text-sm font-semibold" style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try { await deleteCompetitorPrice(deletePriceDialog.id); toast.success("Removed"); setDeletePriceDialog(null); load(); }
                  catch (e) { toast.error((e as Error).message); }
                  finally { setDeleting(false); }
                }}
                className="flex-1 h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
                style={{ background: "var(--snm-error)", color: "var(--background)" }}
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
  const CARD = { background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } as const;
  const CARD_L2 = { background: "var(--glass-2)", backdropFilter: "blur(30px)", WebkitBackdropFilter: "blur(30px)" } as const;

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
        <p className="text-[16px] font-bold text-foreground">{editing ? "Edit Competitor" : "Add Competitor"}</p>
        <div className="space-y-1.5">
          <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>NAME *</p>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Novelty" className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
        </div>
        <div className="space-y-1.5">
          <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>NOTES</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" rows={2} className="w-full rounded-xl px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground resize-none" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl text-sm font-semibold" style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40" style={{ background: "var(--foreground)", color: "var(--background)" }}>
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
  const CARD = { background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } as const;
  const CARD_L2 = { background: "var(--glass-2)", backdropFilter: "blur(30px)", WebkitBackdropFilter: "blur(30px)" } as const;

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

  // Live per-piece calculation preview
  const perPiecePreview = useMemo(() => {
    const price = parseFloat(priceMvr);
    if (!price || !selectedSku) return null;
    const ourPcs = selectedSku.pcs_per_pack;
    const ourCtn = ourPcs * selectedSku.packs_per_carton;
    if (priceBasis === "per_piece")   return price;
    if (priceBasis === "per_pack")    return price / (parseInt(theirPcsPerPack) || ourPcs);
    if (priceBasis === "per_carton")  return price / ourCtn;
    return null;
  }, [priceMvr, priceBasis, theirPcsPerPack, selectedSku]);

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
        <p className="text-[16px] font-bold text-foreground">{editing ? "Edit Price" : "Log Competitor Price"}</p>

        {/* Competitor selector — show all, or allow adding inline */}
        <div className="space-y-1.5">
          <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>COMPETITOR *</p>
          {competitors.length > 0 ? (
            <select value={selectedCompId} onChange={(e) => setSelectedCompId(e.target.value)} className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none appearance-none" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
              <option value="">Pick competitor</option>
              {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Add a competitor first using the "Add Competitor" button.</p>
          )}
        </div>

        {/* Product */}
        <div>
          <p className="label-caps text-[10px] mb-1.5" style={{ color: "var(--muted-foreground)" }}>PRODUCT *</p>
          {!variantId ? (
            <>
              <input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} placeholder="Search brand, model…" className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground mb-2" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
              <div className="rounded-xl overflow-hidden max-h-[180px] overflow-y-auto" style={CARD}>
                {filteredVariants.map((s) => (
                  <button key={s.variant_id} onClick={() => setVariantId(s.variant_id)} className="w-full text-left px-4 py-3 text-sm text-foreground" style={{ borderBottom: "1px solid var(--glass-border-lo)" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--glass-bg-1)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <p className="font-medium">{s.brand_name} · {s.model_name} · {s.variant_display}</p>
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn</p>
                  </button>
                ))}
                {filteredVariants.length === 0 && <p className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>No matches</p>}
              </div>
            </>
          ) : selectedSku ? (
            <div className="rounded-xl p-3 flex justify-between items-start" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
              <div>
                <p className="text-[13px] text-foreground">{selectedSku.brand_name} · {selectedSku.model_name} · {selectedSku.variant_display}</p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{selectedSku.pcs_per_pack}/pk × {selectedSku.packs_per_carton}/ctn</p>
              </div>
              <button onClick={() => { setVariantId(""); setSkuSearch(""); }} className="text-[11px] text-foreground opacity-60 hover:opacity-100">Change</button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>THEIR PRICE (MVR) *</p>
            <input type="number" step="0.01" min="0" value={priceMvr} onChange={(e) => setPriceMvr(e.target.value)} className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
          </div>
          <div className="space-y-1.5">
            <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>PRICE BASIS *</p>
            <select value={priceBasis} onChange={(e) => setPriceBasis(e.target.value as PriceBasis)} className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none appearance-none" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
              {(Object.keys(BASIS_LABEL) as PriceBasis[]).map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
            </select>
          </div>
        </div>

        {/* Live per-piece preview */}
        {perPiecePreview != null && (
          <div className="rounded-xl px-4 py-3 text-center" style={{ background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-brand) 20%, transparent)" }}>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              = <span className="font-bold text-[14px]" style={{ color: "var(--snm-brand)" }}>MVR {fmt2(perPiecePreview)}</span> per piece
            </p>
          </div>
        )}

        {(priceBasis === "per_pack" || priceBasis === "per_piece") && (
          <div className="space-y-1.5">
            <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>THEIR PCS/PACK {priceBasis === "per_pack" ? "(if different from ours)" : ""}</p>
            <input type="number" min="1" value={theirPcsPerPack} onChange={(e) => setTheirPcsPerPack(e.target.value)} placeholder="Optional" className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
          </div>
        )}

        <div className="space-y-1.5">
          <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>DATE OBSERVED *</p>
          <input type="date" value={observedDate} onChange={(e) => setObservedDate(e.target.value)} className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
        </div>

        <div className="space-y-1.5">
          <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>NOTES</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Promo price seen at Novelty Maafannu" rows={2} className="w-full rounded-xl px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground resize-none" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl text-sm font-semibold" style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button onClick={save} disabled={saving || !selectedCompId || !variantId || !priceMvr} className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40" style={{ background: "var(--foreground)", color: "var(--background)" }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : editing ? "Save" : "Log Price"}
          </button>
        </div>
      </div>
    </div>
  );
}

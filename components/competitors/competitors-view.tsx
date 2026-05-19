"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Plus, Search, Store, Pencil, Trash2, AlertTriangle,
  ChevronDown, ChevronUp, Tag, TrendingUp, CheckCircle2,
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
function fmtInt(n: number) { return Math.ceil(n).toLocaleString(undefined, { maximumFractionDigits: 0 }); }

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
  const [saveMode, setSaveMode]     = useState<"margin" | "fixed">("margin");
  const [alertThreshold, setAlertThreshold] = useState(10);

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

  async function handleSetPrice(mode: "margin" | "fixed") {
    if (!simSku || !landedPerPack || packPrice <= landedPerPack) return;
    setSaveMode(mode);
    setSaving(true);
    try {
      if (mode === "fixed") {
        await updateSku(simSku.id, { fixed_selling_price_mvr: piecePrice, target_margin_pct: null });
        toast.success(`Fixed price saved — MVR ${fmt2(piecePrice)}/pc`);
      } else {
        await updateSku(simSku.id, { target_margin_pct: impliedMarginPct, fixed_selling_price_mvr: null });
        toast.success(`${impliedMarginPct}% margin saved — MVR ${fmt2(piecePrice)}/pc`);
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
    <div className="space-y-5 pb-28 lg:pb-10">

      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="label-caps text-[11px] mb-1" style={{ color: "var(--muted-foreground)" }}>Intelligence</p>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Pricing</h1>
        </div>
        <button
          onClick={() => setCompetitorDialog({ open: true })}
          className="flex items-center gap-2 h-11 px-5 rounded-full text-sm font-bold transition active:scale-[0.97]"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          <Plus className="h-4 w-4" />
          Add Competitor
        </button>
      </div>

      {/* ── SKU Selector ── */}
      {skus.length > 0 && (
        <div>
          <p className="label-caps text-[11px] mb-1.5" style={{ color: "var(--muted-foreground)" }}>Analysing</p>
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

      {/* ── Metric Bento Row — stacked on mobile, 3-col on sm+ (NNG 16px rule: no 11px crammed text) ── */}
      {simSku && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Landed Cost */}
          <div className="rounded-xl p-4" style={CARD}>
            <p className="label-caps text-[11px] mb-3" style={{ color: "var(--muted-foreground)" }}>LANDED COST</p>
            {landedPerPiece > 0 ? (
              <div className="space-y-2.5">
                <div>
                  <p className="text-[10px] font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per piece</p>
                  <p className="text-[20px] font-bold leading-none text-foreground">{fmt2(landedPerPiece)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per pack</p>
                  <p className="text-[20px] font-bold leading-none text-foreground">{fmt2(landedPerPack)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per carton</p>
                  <p className="text-[20px] font-bold leading-none text-foreground">{fmt2(landedPerCarton)}</p>
                </div>
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>No shipment yet</p>
            )}
          </div>

          {/* Cheapest Competitor */}
          <div className="rounded-xl p-4" style={CARD}>
            <p className="label-caps text-[11px] mb-3" style={{ color: "var(--muted-foreground)" }}>CHEAPEST</p>
            {topCompEntry && topCompPerPiece != null ? (
              <div>
                <p className="text-[11px] font-semibold mb-2.5 truncate" style={{ color: "var(--snm-warning)" }}>{topCompEntry.comp?.name}</p>
                <div className="space-y-2.5">
                  <div>
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per piece</p>
                    <p className="text-[20px] font-bold leading-none text-foreground">{fmt2(topCompPerPiece)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per pack</p>
                    <p className="text-[20px] font-bold leading-none text-foreground">{fmt2(topCompPerPack!)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per carton</p>
                    <p className="text-[20px] font-bold leading-none text-foreground">{fmt2(topCompPerCarton!)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>No prices logged yet</p>
            )}
          </div>

          {/* Our Current Price */}
          <div className="rounded-xl p-4" style={{ ...CARD, border: "1px solid color-mix(in srgb, var(--snm-brand) 25%, transparent)" }}>
            <p className="label-caps text-[11px] mb-3" style={{ color: "var(--muted-foreground)" }}>OUR PRICE</p>
            {simSku.selling_price_per_piece_mvr != null ? (
              <div>
                <div className="space-y-2.5">
                  <div>
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per piece</p>
                    <p className="text-[20px] font-bold leading-none text-foreground">{fmt2(Number(simSku.selling_price_per_piece_mvr))}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per pack</p>
                    <p className="text-[20px] font-bold leading-none text-foreground">{fmt2(Number(simSku.selling_price_per_pack_mvr))}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per carton</p>
                    <p className="text-[20px] font-bold leading-none text-foreground">{fmt2(Number(simSku.selling_price_per_carton_mvr))}</p>
                  </div>
                </div>
                {simSku.target_margin_pct != null && (
                  <p className="text-[12px] font-bold mt-2.5" style={{ color: "var(--snm-success)" }}>{simSku.target_margin_pct}% margin</p>
                )}
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>Not set yet</p>
            )}
          </div>
        </div>
      )}

      {/* ── Margin Simulator ── */}
      {simSku && landedPerPiece > 0 && (
        <div className="rounded-xl overflow-hidden" style={CARD}>

          {/* Header — title only, no toggle here */}
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--glass-border-lo)" }}>
            <h2 className="text-[17px] font-semibold text-foreground">Margin Simulator</h2>
          </div>

          <div className="p-5 space-y-5">

            {/* ── Competitive gap status ── */}
            {topCompPerPiece != null && (() => {
              const delta = piecePrice - topCompPerPiece;
              const pctAbove = topCompPerPiece > 0 ? (delta / topCompPerPiece) * 100 : 0;
              const isAlert = delta > 0 && pctAbove > alertThreshold;
              const col = delta <= 0 ? "var(--snm-success)" : isAlert ? "var(--snm-error)" : "var(--snm-warning)";
              const bg = delta <= 0
                ? "color-mix(in srgb, var(--snm-success) 10%, transparent)"
                : isAlert
                  ? "color-mix(in srgb, var(--snm-error) 10%, transparent)"
                  : "color-mix(in srgb, var(--snm-warning) 10%, transparent)";
              const border = delta <= 0
                ? "color-mix(in srgb, var(--snm-success) 30%, transparent)"
                : isAlert
                  ? "color-mix(in srgb, var(--snm-error) 30%, transparent)"
                  : "color-mix(in srgb, var(--snm-warning) 30%, transparent)";
              return (
                <div className="rounded-2xl px-5 py-4" style={{ background: bg, border: `1px solid ${border}` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: col }}>
                        {delta <= 0 ? "You're cheaper" : isAlert ? "Review price" : "Slightly above"}
                      </p>
                      <p className="text-[13px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                        vs <span className="font-semibold" style={{ color: "var(--foreground)" }}>{topCompEntry?.comp?.name}</span> · cheapest
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[26px] font-bold leading-none" style={{ color: col }}>
                        {delta <= 0 ? "▼" : "▲"}&thinsp;{Math.abs(delta).toFixed(2)}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>MVR/pc · {Math.abs(pctAbove).toFixed(0)}%</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Price display + unit toggle directly above it ── */}
            <div>
              {/* Unit toggle sits directly above the number it controls */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                  Selling price
                </p>
                <div className="flex rounded-xl overflow-hidden" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", padding: "2px" }}>
                  {(["piece", "pack", "carton"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setSimMode(m)}
                      className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-lg transition"
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

              {/* Price display card — pencil button triggers edit, rest of card is non-interactive */}
              <div
                className="rounded-2xl px-5 pt-5 pb-4 text-center relative"
                style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "1px solid var(--glass-border-lo)" }}
              >
                {/* Pencil button — tap to manually enter a price in the current display unit */}
                {!simEditing && (
                  <button
                    onClick={() => { setSimTyped(String(Math.round(simDisplayPrice))); setSimEditing(true); }}
                    className="absolute top-3 right-3 h-7 w-7 rounded-lg flex items-center justify-center transition active:scale-90"
                    style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
                    aria-label="Edit price"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--muted-foreground)" }}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                )}
                {simEditing ? (
                  <input
                    autoFocus
                    type="number"
                    inputMode="numeric"
                    value={simTyped}
                    onChange={(e) => setSimTyped(e.target.value)}
                    onBlur={() => {
                      const v = parseFloat(simTyped);
                      // setSimDisplayPrice converts from current display unit back to per-pack
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
                    className="text-[52px] font-light tracking-tight text-foreground text-center bg-transparent outline-none border-none w-full"
                  />
                ) : (
                  <p className="text-[52px] font-light tracking-tight text-foreground leading-none">
                    {fmtInt(simDisplayPrice)}
                  </p>
                )}
                <p className="text-[13px] mt-1 font-medium" style={{ color: "var(--muted-foreground)" }}>MVR {simLabel}</p>
              </div>

              {/* Margin slider — always calculated in per-pack terms to avoid tiny-number precision loss */}
              {(() => {
                // Margin is always (packPrice - landedPerPack) / packPrice regardless of display mode
                const currentMargin = landedPerPack > 0 ? Math.round(((packPrice - landedPerPack) / packPrice) * 100) : 0;
                const sliderVal = Math.max(1, Math.min(99, currentMargin));
                const fillPct = ((sliderVal - 1) / 98) * 100;
                return (
                  <div className="mt-3 rounded-2xl px-5 py-4"
                    style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "1px solid var(--glass-border-lo)" }}>
                    <style>{`
                      .snm-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 9999px; outline: none; cursor: pointer; background: transparent; }
                      .snm-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 32px; height: 32px; border-radius: 50%; background: #FF4000; box-shadow: 0 2px 16px rgba(255,64,0,0.5); cursor: grab; border: 3px solid rgba(255,255,255,0.75); margin-top: -13px; }
                      .snm-slider::-moz-range-thumb { width: 32px; height: 32px; border-radius: 50%; background: #FF4000; box-shadow: 0 2px 16px rgba(255,64,0,0.5); cursor: grab; border: 3px solid rgba(255,255,255,0.75); }
                      .snm-slider::-webkit-slider-runnable-track { height: 6px; border-radius: 9999px; }
                      .snm-slider::-moz-range-track { height: 6px; border-radius: 9999px; background: rgba(128,128,128,0.2); }
                      .snm-slider:active::-webkit-slider-thumb { cursor: grabbing; }
                      .snm-slider:active::-moz-range-thumb { cursor: grabbing; }
                    `}</style>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Margin</p>
                      <div className="flex items-baseline gap-0.5">
                        <p className="text-[32px] font-bold leading-none" style={{ color: "var(--snm-brand)" }}>{sliderVal}</p>
                        <p className="text-[18px] font-semibold leading-none" style={{ color: "var(--muted-foreground)" }}>%</p>
                      </div>
                    </div>
                    <div className="relative">
                      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full overflow-hidden pointer-events-none"
                        style={{ background: "color-mix(in srgb, var(--foreground) 12%, transparent)" }}>
                        <div className="h-full rounded-full"
                          style={{ width: `${fillPct}%`, background: "var(--snm-brand)" }} />
                      </div>
                      <input
                        type="range"
                        min={1} max={99} step={1}
                        value={sliderVal}
                        onChange={(e) => {
                          const pct = parseInt(e.target.value);
                          // Math.round (not ceil) so slider moves freely in both directions
                          if (landedPerPack > 0) setSimPrice(Math.round(landedPerPack / (1 - pct / 100)));
                        }}
                        className="snm-slider relative"
                        style={{ touchAction: "none" }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <p className="text-[10px] font-medium" style={{ color: "var(--muted-foreground)" }}>1%</p>
                      <p className="text-[10px] font-medium" style={{ color: "var(--muted-foreground)" }}>99%</p>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Three price levels — larger numbers, clear hierarchy ── */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Per piece",  value: piecePrice,  landed: landedPerPiece },
                { label: "Per pack",   value: packPrice,   landed: landedPerPack  },
                { label: "Per carton", value: cartonPrice, landed: landedPerCarton },
              ].map(({ label, value, landed }) => {
                const margin = landed > 0 ? ((value - landed) / value) * 100 : 0;
                const markup = landed > 0 ? ((value - landed) / landed) * 100 : 0;
                const col = margin >= 20 ? "var(--snm-success)" : margin >= 5 ? "var(--snm-warning)" : "var(--snm-error)";
                const isActive = (simMode === "piece" && label === "Per piece") || (simMode === "pack" && label === "Per pack") || (simMode === "carton" && label === "Per carton");
                return (
                  <div key={label} className="rounded-xl p-3 text-center space-y-1.5"
                    style={{
                      background: isActive ? "color-mix(in srgb, var(--snm-brand) 10%, transparent)" : "color-mix(in srgb, var(--foreground) 5%, transparent)",
                      border: isActive ? "1px solid color-mix(in srgb, var(--snm-brand) 30%, transparent)" : "1px solid var(--glass-border-lo)",
                    }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{label}</p>
                    <p className="text-[18px] font-bold leading-none text-foreground">MVR {fmtInt(value)}</p>
                    <p className="text-[11px] font-bold" style={{ color: col }}>{Math.round(margin)}%</p>
                    <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{markup >= 1000 ? `${(markup/1000).toFixed(1)}k` : Math.round(markup)}% mkup</p>
                  </div>
                );
              })}
            </div>

            {/* ── Alert threshold — moved out of competitive gap, its own quiet row ── */}
            {topCompPerPiece != null && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <p className="text-[11px] shrink-0" style={{ color: "var(--muted-foreground)" }}>Alert when above competitor by</p>
                {[5, 10, 15, 20, 25].map((t) => (
                  <button key={t} onClick={() => setAlertThreshold(t)}
                    className="h-7 px-3 rounded-lg text-[11px] font-semibold transition active:scale-95 shrink-0"
                    style={{
                      background: alertThreshold === t ? "var(--snm-brand)" : "color-mix(in srgb, var(--foreground) 10%, transparent)",
                      color: alertThreshold === t ? "#fff" : "var(--muted-foreground)",
                    }}>
                    {t}%
                  </button>
                ))}
              </div>
            )}

            {/* ── Save — brand orange when changed, clearly the primary action ── */}
            <div className="space-y-2 pt-1">
              <button
                onClick={() => handleSetPrice("margin")}
                disabled={saving || !landedPerPack || packPrice <= landedPerPack}
                className="w-full h-14 rounded-2xl text-[15px] font-bold transition active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-2"
                style={{
                  background: isPriceChanged ? "var(--snm-brand)" : "color-mix(in srgb, var(--foreground) 8%, transparent)",
                  color: isPriceChanged ? "#fff" : "var(--muted-foreground)",
                  touchAction: "manipulation",
                  boxShadow: isPriceChanged ? "0 4px 20px color-mix(in srgb, var(--snm-brand) 40%, transparent)" : "none",
                }}
              >
                {saving && saveMode === "margin"
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : isPriceChanged
                    ? <><TrendingUp className="h-4 w-4" /> Save at {impliedMarginPct}% margin</>
                    : <><CheckCircle2 className="h-4 w-4" /> Price Up to Date</>}
              </button>
              <p className="text-[11px] text-center" style={{ color: "var(--muted-foreground)" }}>
                Auto-updates when landed cost changes each shipment.
              </p>

              {/* Fixed price — styled as a real button, not plain grey text */}
              {isPriceChanged && (
                <button
                  onClick={() => handleSetPrice("fixed")}
                  disabled={saving || !landedPerPack || packPrice <= landedPerPack}
                  className="w-full h-11 rounded-2xl text-[13px] font-semibold transition active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-1.5"
                  style={{
                    background: "color-mix(in srgb, var(--foreground) 8%, transparent)",
                    color: "var(--foreground)",
                    border: "1px solid var(--glass-border-lo)",
                    touchAction: "manipulation",
                  }}
                >
                  {saving && saveMode === "fixed"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <>Or lock as fixed price · MVR {fmtInt(piecePrice)}/pc</>}
                </button>
              )}
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
                    {/* Our price — brand orange identity, not error colour (NNG: colour semantics) */}
                    {sku.selling_price_per_piece_mvr != null && (() => {
                      const ourPc = Number(sku.selling_price_per_piece_mvr);
                      const marginLabel = sku.fixed_selling_price_mvr != null
                        ? `Fixed · ${sku.actual_margin_pct != null ? `${sku.actual_margin_pct}% actual margin` : "no landed cost yet"}`
                        : sku.target_margin_pct != null
                          ? `${sku.target_margin_pct}% margin`
                          : "saved";
                      return (
                        <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-brand) 30%, transparent)" }}>
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--snm-brand)" }}>
                              <Tag className="h-3.5 w-3.5" style={{ color: "#ffffff" }} />
                            </div>
                            <div>
                              <p className="text-[13px] font-semibold" style={{ color: "var(--snm-brand)" }}>Our Selling Price</p>
                              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{marginLabel}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[14px] font-semibold" style={{ color: "var(--snm-brand)" }}>MVR {fmt2(ourPc)}<span className="text-[10px] opacity-60">/pc</span></p>
                            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>MVR {fmt2(Number(sku.selling_price_per_carton_mvr))}/ctn</p>
                          </div>
                        </div>
                      );
                    })()}
                    {/* Simulated price — only shown for the selected SKU when simulator differs */}
                    {simSku?.id === sku.id && isPriceChanged && (
                      <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", border: "1px dashed color-mix(in srgb, var(--snm-warning) 35%, transparent)" }}>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--snm-warning) 20%, transparent)" }}>
                            <TrendingUp className="h-3.5 w-3.5" style={{ color: "var(--snm-warning)" }} />
                          </div>
                          <div>
                            <p className="text-[13px] font-medium" style={{ color: "var(--snm-warning)" }}>Simulated Price</p>
                            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{impliedMarginPct}% margin · not saved yet</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[14px] font-semibold" style={{ color: "var(--snm-warning)" }}>MVR {fmt2(piecePrice)}<span className="text-[10px] opacity-60">/pc</span></p>
                          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>MVR {fmt2(cartonPrice)}/ctn</p>
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

      {/* ── Log Price FAB — thumb zone, bottom-right (Luke Wroblewski: 75% thumb use) ── */}
      <button
        onClick={() => setPriceDialog({ open: true })}
        className="fixed bottom-24 right-4 lg:bottom-6 lg:right-6 z-30 flex items-center gap-2 h-14 px-5 rounded-full shadow-lg transition active:scale-[0.95]"
        style={{ background: "var(--snm-brand)", color: "#ffffff", touchAction: "manipulation", boxShadow: "0 4px 24px color-mix(in srgb, var(--snm-brand) 40%, transparent)" }}
        aria-label="Log competitor price"
      >
        <Tag className="h-4 w-4 shrink-0" />
        <span className="text-[14px] font-bold">Log Price</span>
      </button>

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
          <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>NAME *</p>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Novelty" className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
        </div>
        <div className="space-y-1.5">
          <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>NOTES</p>
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
          <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>COMPETITOR *</p>
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
          <p className="label-caps text-[11px] mb-1.5" style={{ color: "var(--muted-foreground)" }}>PRODUCT *</p>
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
            <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>THEIR PRICE (MVR) *</p>
            <input type="number" step="0.01" min="0" value={priceMvr} onChange={(e) => setPriceMvr(e.target.value)} className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
          </div>
          <div className="space-y-1.5">
            <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>PRICE BASIS *</p>
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
            <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>THEIR PCS/PACK {priceBasis === "per_pack" ? "(if different from ours)" : ""}</p>
            <input type="number" min="1" value={theirPcsPerPack} onChange={(e) => setTheirPcsPerPack(e.target.value)} placeholder="Optional" className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
          </div>
        )}

        <div className="space-y-1.5">
          <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>DATE OBSERVED *</p>
          <input type="date" value={observedDate} onChange={(e) => setObservedDate(e.target.value)} className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
        </div>

        <div className="space-y-1.5">
          <p className="label-caps text-[11px]" style={{ color: "var(--muted-foreground)" }}>NOTES</p>
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

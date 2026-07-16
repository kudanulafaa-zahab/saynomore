"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PromoAdvisor } from "./promo-advisor";
import { CampaignsCard } from "./campaigns-card";
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
  listCompetitorPriceGaps,
  type CompetitorRow,
  type CompetitorPriceRow,
  type PriceBasis,
  type CompetitorPriceGap,
} from "@/lib/queries/competitors";
import { withOfflineFallback } from "@/lib/offline-write";
import { Sheet } from "@/components/ui/sheet";
import { listSkusFlat, updateSku, getCurrentUserRole, compareSkusForDisplay, type SkuFullRow } from "@/lib/queries/products";
import { SkuIdentity } from "@/components/ui/sku-identity";
import { supabase } from "@/lib/supabase";
import { SkeletonRows } from "@/components/layout/page-skeleton";
import { haptic } from "@/lib/haptics";

// Liquid Glass content surface (2026-07-15) — matches .glass-panel's recipe
// (fill + specular inset highlight + border) without needing 21 JSX call
// sites converted to className. No backdrop-filter here by design: content
// cards use translucency over the wallpaper, blur is chrome-only.
const CARD = {
  background: "linear-gradient(180deg, var(--glass-fill-top), var(--glass-fill-bottom))",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.65))",
  boxShadow: "inset 0 1px 1px var(--glass-specular), var(--glass-shadow)",
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
  const [canWrite, setCanWrite]     = useState(false);
  const [priceGaps, setPriceGaps]   = useState<CompetitorPriceGap[]>([]);
  const [gapsExpanded, setGapsExpanded] = useState(false);

  useEffect(() => {
    getCurrentUserRole().then((r) => setCanWrite(r !== "viewer")).catch(() => {});
  }, []);

  // Price list coverage for selected SKU — one entry per tier
  type TierCoverage = { tier: string; price_per_piece_mvr: number | null; price_per_pack_mvr: number | null; price_per_carton_mvr: number | null; source: string };
  const [tierCoverage, setTierCoverage] = useState<TierCoverage[]>([]);

  async function load() {
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

  // Products priced above the cheapest logged competitor by more than the
  // alert threshold — same threshold the per-SKU simulator uses below.
  useEffect(() => {
    listCompetitorPriceGaps(alertThreshold)
      .then(setPriceGaps)
      .catch(() => setPriceGaps([]));
  }, [alertThreshold]);

  // Fetch active price list entries for all 4 tiers for the selected SKU
  useEffect(() => {
    if (!simSku) { setTierCoverage([]); return; }
    const tiers = ["retail", "wholesale", "vip", "promo"] as const;
    Promise.all(
      tiers.map(async (tier) => {
        const { data } = await supabase.rpc("get_tier_price_for_sku", { p_sku_id: simSku.id, p_tier: tier });
        const row = data?.[0];
        return {
          tier,
          price_per_piece_mvr:  row?.price_per_piece_mvr  ?? null,
          price_per_pack_mvr:   row?.price_per_pack_mvr   ?? null,
          price_per_carton_mvr: row?.price_per_carton_mvr ?? null,
          source: row?.source ?? "none",
        } as TierCoverage;
      })
    ).then(setTierCoverage).catch(() => setTierCoverage([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simSku?.id]);

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
      else if (p.price_basis === "per_carton") perPiece = Number(p.price_mvr) / (p.their_pcs_per_pack ?? (pcsPerPack * packsPerCarton));
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
        else if (p.price_basis === "per_carton") pricePiece = Number(p.price_mvr) / (p.their_pcs_per_pack ?? ourPcsPerCarton);
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
      // v_skus resolves piece/pack/carton price independently per tier — a
      // leftover fixed_price_per_pack/carton_mvr from an old volume-break
      // override beats both fixed_selling_price_mvr and target_margin_pct
      // at that tier, so it must be cleared here or the new price/margin
      // silently loses to a stale override the next time the SKU loads.
      const cleared = { fixed_selling_price_mvr: null, fixed_price_per_pack_mvr: null, fixed_price_per_carton_mvr: null, target_margin_pct: null };
      if (mode === "fixed") {
        await updateSku(simSku.id, { ...cleared, fixed_selling_price_mvr: piecePrice });
        toast.success(`Fixed price saved — MVR ${fmt2(piecePrice)}/pc`);
      } else {
        await updateSku(simSku.id, { ...cleared, target_margin_pct: impliedMarginPct });
        toast.success(`${impliedMarginPct}% margin saved — MVR ${fmt2(piecePrice)}/pc`);
      }
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  const isPriceChanged = simSku
    && Math.abs(packPrice - (simSku.selling_price_per_pack_mvr ?? 0)) > 0.01;

  if (loading) {
    return <SkeletonRows rows={6} />;
  }

  return (
    <div className="space-y-5 pb-28 lg:pb-10">

      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Intelligence</p>
          <h1 className="ios-page-title">Pricing</h1>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompetitorDialog({ open: true })}
              className="flex items-center gap-1.5 h-11 px-4 rounded-full text-sm font-bold transition active:scale-[0.97]"
              style={{ background: "var(--muted)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
            >
              <Plus className="h-4 w-4" />
              Competitor
            </button>
            <button
              onClick={() => setPriceDialog({ open: true })}
              className="flex items-center gap-1.5 h-11 px-4 rounded-full text-sm font-bold transition active:scale-[0.97]"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              <Tag className="h-4 w-4" />
              Log Price
            </button>
          </div>
        )}
      </div>

      {/* Slow movers with margin headroom — see promo-advisor.tsx */}
      <PromoAdvisor />

      {/* Log/track campaigns right where the advisor suggests them */}
      <CampaignsCard />

      {/* ── Priced above competitors — all SKUs at a glance, worst gap first ── */}
      {priceGaps.length > 0 && (
        <div className="rounded-2xl p-4" style={CARD}>
          <div className="flex items-start gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--snm-warning)" }} />
            <div>
              <p className="ios-subhead font-bold text-foreground">
                {priceGaps.length} product{priceGaps.length !== 1 ? "s" : ""} dearer than the competition
              </p>
              <p className="ios-footnote mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                Customers may buy elsewhere. Tap one to see the gap and how low you can go while staying profitable.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            {(gapsExpanded ? priceGaps : priceGaps.slice(0, 3)).map((g) => (
              <button
                key={g.sku_id}
                onClick={() => {
                  const s = skus.find((sk) => sk.id === g.sku_id);
                  if (s) { setSimSku(s); setSimPrice(s.selling_price_per_pack_mvr ?? (s.landed_per_piece_mvr ?? 0) * s.pcs_per_pack * 1.3); }
                }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition active:opacity-70"
                style={{ background: "color-mix(in srgb, var(--snm-warning) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 20%, transparent)" }}
              >
                <div className="min-w-0">
                  <p className="ios-subhead font-semibold text-foreground truncate">
                    {g.brand_name} · {g.model_name}{g.variant_display ? ` · ${g.variant_display}` : ""}
                  </p>
                  <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    Ours {fmt2(g.our_price_mvr)} vs {g.cheapest_competitor_name} {fmt2(g.cheapest_competitor_mvr)}
                  </p>
                </div>
                <span className="ios-subhead font-bold shrink-0 snm-num" style={{ color: "var(--snm-warning)" }}>
                  +{g.gap_pct.toFixed(0)}%
                </span>
              </button>
            ))}
          </div>
          {priceGaps.length > 3 && (
            <button
              onClick={() => setGapsExpanded((v) => !v)}
              className="w-full mt-2 flex items-center justify-center gap-1 rounded-xl py-2 ios-subhead font-semibold transition active:opacity-70"
              style={{ background: "var(--muted)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
            >
              {gapsExpanded
                ? <>Show less <ChevronUp className="h-3.5 w-3.5" /></>
                : <>Show {priceGaps.length - 3} more <ChevronDown className="h-3.5 w-3.5" /></>}
            </button>
          )}
        </div>
      )}

      {/* ── SKU Selector ── */}
      {skus.length > 0 && (
        <div>
          <p className="label-caps text-[12px] mb-1.5" style={{ color: "var(--muted-foreground)" }}>Analysing</p>
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
              className="h-12 rounded-xl pl-4 pr-10 ios-subhead font-medium text-foreground outline-none appearance-none w-full cursor-pointer"
              style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
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
            <p className="label-caps text-[12px] mb-3" style={{ color: "var(--muted-foreground)" }}>LANDED COST</p>
            {landedPerPiece > 0 ? (
              <div className="space-y-2.5">
                <div>
                  <p className="ios-subhead font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per piece</p>
                  <p className="text-[20px] font-bold leading-none text-foreground snm-num">{fmt2(landedPerPiece)}</p>
                </div>
                <div>
                  <p className="ios-subhead font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per pack</p>
                  <p className="text-[20px] font-bold leading-none text-foreground snm-num">{fmt2(landedPerPack)}</p>
                </div>
                <div>
                  <p className="ios-subhead font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per carton</p>
                  <p className="text-[20px] font-bold leading-none text-foreground snm-num">{fmt2(landedPerCarton)}</p>
                </div>
              </div>
            ) : (
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>No shipment yet</p>
            )}
          </div>

          {/* Cheapest Competitor */}
          <div className="rounded-xl p-4" style={CARD}>
            <p className="label-caps text-[12px] mb-3" style={{ color: "var(--muted-foreground)" }}>CHEAPEST</p>
            {topCompEntry && topCompPerPiece != null ? (
              <div>
                <p className="ios-subhead font-semibold mb-2.5 truncate" style={{ color: "var(--snm-warning)" }}>{topCompEntry.comp?.name}</p>
                <div className="space-y-2.5">
                  <div>
                    <p className="ios-subhead font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per piece</p>
                    <p className="text-[20px] font-bold leading-none text-foreground snm-num">{fmt2(topCompPerPiece)}</p>
                  </div>
                  <div>
                    <p className="ios-subhead font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per pack</p>
                    <p className="text-[20px] font-bold leading-none text-foreground snm-num">{fmt2(topCompPerPack!)}</p>
                  </div>
                  <div>
                    <p className="ios-subhead font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per carton</p>
                    <p className="text-[20px] font-bold leading-none text-foreground snm-num">{fmt2(topCompPerCarton!)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>No prices logged yet</p>
            )}
          </div>

          {/* Our Current Price */}
          <div className="rounded-xl p-4" style={{ ...CARD, border: "1px solid color-mix(in srgb, var(--snm-brand) 25%, transparent)" }}>
            <p className="label-caps text-[12px] mb-3" style={{ color: "var(--muted-foreground)" }}>OUR PRICE</p>
            {simSku.selling_price_per_piece_mvr != null ? (
              <div>
                <div className="space-y-2.5">
                  <div>
                    <p className="ios-subhead font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per piece</p>
                    <p className="text-[20px] font-bold leading-none text-foreground snm-num">{fmt2(Number(simSku.selling_price_per_piece_mvr))}</p>
                  </div>
                  <div>
                    <p className="ios-subhead font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per pack</p>
                    <p className="text-[20px] font-bold leading-none text-foreground snm-num">{fmt2(Number(simSku.selling_price_per_pack_mvr))}</p>
                  </div>
                  <div>
                    <p className="ios-subhead font-medium mb-0.5" style={{ color: "var(--muted-foreground)" }}>Per carton</p>
                    <p className="text-[20px] font-bold leading-none text-foreground snm-num">{fmt2(Number(simSku.selling_price_per_carton_mvr))}</p>
                  </div>
                </div>
                {simSku.target_margin_pct != null && (
                  <p className="ios-subhead font-bold mt-2.5" style={{ color: "var(--snm-success)" }}>{simSku.target_margin_pct}% margin</p>
                )}
              </div>
            ) : (
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Not set yet</p>
            )}
          </div>
        </div>
      )}

      {/* ── Margin Simulator ── */}
      {simSku && landedPerPiece > 0 && (
        <div className="rounded-xl overflow-hidden" style={CARD}>

          {/* Header — title only, no toggle here */}
          <div className="px-5 py-4" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
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
              // What margin Ali would KEEP if he matched the cheapest competitor
              // per piece — real recommendation, from landed cost already in scope.
              const marginIfMatched = topCompPerPiece > landedPerPiece && topCompPerPiece > 0
                ? ((topCompPerPiece - landedPerPiece) / topCompPerPiece) * 100
                : null;
              const compName = topCompEntry?.comp?.name ?? "the cheapest competitor";
              const advice = delta <= 0
                ? `You're the cheapest here — hold this price and protect the margin.`
                : marginIfMatched != null && marginIfMatched >= 5
                  ? `Match ${compName} and you'd still keep ${marginIfMatched.toFixed(0)}% margin. Undercutting could win the sale.`
                  : marginIfMatched != null
                    ? `Matching ${compName} drops you to ${marginIfMatched.toFixed(0)}% margin — thin. Compete on service, not price.`
                    : `Matching ${compName} would sell below your cost — don't chase this one on price.`;
              return (
                <div className="rounded-2xl px-5 py-4" style={{ background: bg, border: `1px solid ${border}` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: col }}>
                        {delta <= 0 ? "You're cheaper" : isAlert ? "Priced too high" : "Slightly above"}
                      </p>
                      <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                        vs <span className="font-semibold" style={{ color: "var(--foreground)" }}>{topCompEntry?.comp?.name}</span> · cheapest logged
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[26px] font-bold leading-none" style={{ color: col }}>
                        {delta <= 0 ? "▼" : "▲"}&thinsp;{Math.abs(delta).toFixed(2)}
                      </p>
                      <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>MVR/pc · {Math.abs(pctAbove).toFixed(0)}%</p>
                    </div>
                  </div>
                  {/* The recommendation — the whole point of the panel */}
                  <p className="ios-subhead mt-3 pt-3" style={{ color: "var(--foreground)", borderTop: `1px solid ${border}` }}>
                    {advice}
                  </p>
                </div>
              );
            })()}

            {/* ── Price display + unit toggle directly above it ── */}
            <div>
              {/* Unit toggle sits directly above the number it controls */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                  Selling price
                </p>
                <div className="flex rounded-xl overflow-hidden" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", padding: "2px" }}>
                  {(["piece", "pack", "carton"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setSimMode(m)}
                      className="px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider rounded-lg transition"
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

              {/* Price display card — the whole card is tappable to type a price
                  directly (not just a tiny corner pencil, which was easy to miss
                  entirely and read as "only the slider works"). The unit label
                  under the number always names exactly what you're setting
                  (Per piece/pack/carton), so switching Pc/Pk/Ctn above and typing
                  a number here can never be ambiguous about which price it sets. */}
              {simEditing ? (
                <div
                  className="rounded-2xl px-5 pt-5 pb-4 text-center relative"
                  style={{ background: "color-mix(in srgb, var(--glass-accent) 8%, transparent)", border: "1.5px solid var(--glass-accent)" }}
                >
                  <input
                    autoFocus
                    type="number"
                    inputMode="decimal"
                    value={simTyped}
                    onChange={(e) => setSimTyped(e.target.value)}
                    onFocus={(e) => e.target.select()}
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
                  <p className="ios-subhead mt-1 font-semibold" style={{ color: "var(--glass-accent)" }}>
                    Enter MVR {simLabel.toLowerCase()} · Enter to save
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => { setSimTyped(String(Math.round(simDisplayPrice))); setSimEditing(true); }}
                  className="w-full rounded-2xl px-5 pt-5 pb-4 text-center relative transition active:scale-[0.98]"
                  style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}
                  aria-label={`Edit ${simLabel.toLowerCase()} price, currently ${fmtInt(simDisplayPrice)} MVR`}
                >
                  <span
                    className="absolute top-3 right-3 h-7 w-7 rounded-lg flex items-center justify-center"
                    style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--muted-foreground)" }}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </span>
                  <p className="text-[52px] font-light tracking-tight text-foreground leading-none">
                    {fmtInt(simDisplayPrice)}
                  </p>
                  <p className="ios-subhead mt-1 font-medium" style={{ color: "var(--muted-foreground)" }}>
                    MVR {simLabel} · tap to type a price
                  </p>
                </button>
              )}

              {/* Margin slider — always calculated in per-pack terms to avoid tiny-number precision loss */}
              {(() => {
                // Margin is always (packPrice - landedPerPack) / packPrice regardless of display mode
                const currentMargin = landedPerPack > 0 ? Math.round(((packPrice - landedPerPack) / packPrice) * 100) : 0;
                const sliderVal = Math.max(1, Math.min(99, currentMargin));
                const fillPct = ((sliderVal - 1) / 98) * 100;
                return (
                  <div className="mt-3 rounded-2xl px-5 py-4"
                    style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}>
                    <style>{`
                      .snm-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 9999px; outline: none; cursor: pointer; background: transparent; }
                      .snm-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 32px; height: 32px; border-radius: 50%; background: var(--snm-brand); box-shadow: 0 2px 16px var(--snm-brand-muted); cursor: grab; border: 3px solid rgba(255,255,255,0.75); margin-top: -13px; }
                      .snm-slider::-moz-range-thumb { width: 32px; height: 32px; border-radius: 50%; background: var(--snm-brand); box-shadow: 0 2px 16px var(--snm-brand-muted); cursor: grab; border: 3px solid rgba(255,255,255,0.75); }
                      .snm-slider::-webkit-slider-runnable-track { height: 6px; border-radius: 9999px; }
                      .snm-slider::-moz-range-track { height: 6px; border-radius: 9999px; background: rgba(128,128,128,0.2); }
                      .snm-slider:active::-webkit-slider-thumb { cursor: grabbing; }
                      .snm-slider:active::-moz-range-thumb { cursor: grabbing; }
                    `}</style>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Margin</p>
                      <div className="flex items-baseline gap-0.5">
                        <p className="text-[32px] font-bold leading-none" style={{ color: "var(--snm-brand-text)" }}>{sliderVal}</p>
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
                      <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>1%</p>
                      <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>99%</p>
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
                      border: isActive ? "1px solid color-mix(in srgb, var(--snm-brand) 30%, transparent)" : "0.5px solid var(--glass-border-lo)",
                    }}>
                    <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{label}</p>
                    <p className="text-[18px] font-bold leading-none text-foreground">MVR {fmtInt(value)}</p>
                    <p className="ios-subhead font-bold" style={{ color: col }}>{Math.round(margin)}%</p>
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{markup >= 1000 ? `${(markup/1000).toFixed(1)}k` : Math.round(markup)}% mkup</p>
                  </div>
                );
              })}
            </div>

            {/* ── Alert threshold — moved out of competitive gap, its own quiet row ── */}
            {topCompPerPiece != null && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <p className="ios-subhead shrink-0" style={{ color: "var(--muted-foreground)" }}>Alert when above competitor by</p>
                {[5, 10, 15, 20, 25].map((t) => (
                  <button key={t} onClick={() => setAlertThreshold(t)}
                    className="h-7 px-3 rounded-lg ios-subhead font-semibold transition active:scale-95 shrink-0"
                    style={{
                      background: alertThreshold === t ? "var(--snm-brand)" : "color-mix(in srgb, var(--foreground) 10%, transparent)",
                      color: alertThreshold === t ? "var(--snm-brand-on)" : "var(--muted-foreground)",
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
                  color: isPriceChanged ? "var(--snm-brand-on)" : "var(--muted-foreground)",
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
              <p className="ios-subhead text-center" style={{ color: "var(--muted-foreground)" }}>
                Auto-updates when landed cost changes each shipment.
              </p>

              {/* Fixed price — styled as a real button, not plain grey text */}
              {isPriceChanged && (
                <button
                  onClick={() => handleSetPrice("fixed")}
                  disabled={saving || !landedPerPack || packPrice <= landedPerPack}
                  className="w-full h-11 rounded-2xl ios-subhead font-semibold transition active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-1.5"
                  style={{
                    background: "color-mix(in srgb, var(--foreground) 8%, transparent)",
                    color: "var(--foreground)",
                    border: "0.5px solid var(--glass-border-lo)",
                    touchAction: "manipulation",
                  }}
                >
                  {saving && saveMode === "fixed"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <>Or lock as fixed price · MVR {fmtInt(piecePrice)}/pc</>}
                </button>
              )}
            </div>

            {/* ── Price List Coverage ──
                 Shows the active price list price for each customer tier.
                 Source = "price_list" → fixed MVR from a Price List (shown in green).
                 Source = "sku_default" → falls back to the SKU base price (shown muted).
                 Source = "none" → no price set at all (shown as warning).
                 Tapping the row deep-links to /pricelists so Ali can fix gaps instantly.
            ── */}
            {tierCoverage.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                    Customer Tier Prices
                  </p>
                  <a href="/pricelists" className="ios-subhead font-semibold" style={{ color: "var(--snm-brand-text)" }}>
                    Manage →
                  </a>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--glass-border-lo)" }}>
                  {tierCoverage.map((tc, i) => {
                    const hasListPrice = tc.source === "price_list";
                    const hasAnyPrice  = tc.source !== "none" && tc.price_per_piece_mvr != null;
                    const tierLabel = tc.tier.charAt(0).toUpperCase() + tc.tier.slice(1);
                    const tierColor = tc.tier === "vip" ? "var(--snm-brand)"
                      : tc.tier === "wholesale" ? "var(--snm-warning)"
                      : tc.tier === "promo" ? "var(--snm-promo)"
                      : "var(--muted-foreground)";
                    return (
                      <div key={tc.tier}
                        className="flex items-center justify-between px-4 py-3 gap-3"
                        style={{
                          borderBottom: i < tierCoverage.length - 1 ? "0.5px solid var(--glass-border-lo)" : "none",
                          background: "color-mix(in srgb, var(--foreground) 3%, transparent)",
                        }}>
                        {/* Tier label + source badge */}
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="ios-subhead font-semibold" style={{ color: tierColor }}>{tierLabel}</p>
                          {hasListPrice && (
                            <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
                              style={{ background: "color-mix(in srgb, var(--snm-success) 15%, transparent)", color: "var(--snm-success)" }}>
                              List
                            </span>
                          )}
                          {!hasListPrice && hasAnyPrice && (
                            <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
                              style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--muted-foreground)" }}>
                              SKU default
                            </span>
                          )}
                          {!hasAnyPrice && (
                            <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
                              style={{ background: "color-mix(in srgb, var(--snm-warning) 15%, transparent)", color: "var(--snm-warning)" }}>
                              Not set
                            </span>
                          )}
                        </div>
                        {/* Prices — per piece / pack / carton */}
                        {hasAnyPrice ? (
                          <div className="flex items-center gap-3 text-right shrink-0">
                            <div>
                              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Pc</p>
                              <p className="text-[14px] font-semibold text-foreground snm-num">{fmt2(tc.price_per_piece_mvr!)}</p>
                            </div>
                            <div>
                              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Pk</p>
                              <p className="text-[14px] font-semibold text-foreground snm-num">{fmt2(tc.price_per_pack_mvr!)}</p>
                            </div>
                            <div>
                              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Ctn</p>
                              <p className="text-[14px] font-semibold text-foreground snm-num">{fmt2(tc.price_per_carton_mvr!)}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="ios-subhead shrink-0" style={{ color: "var(--muted-foreground)" }}>No price — tap Manage</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── Per-Piece Comparison Table ── */}
      {perPieceComparison.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={CARD}>
          <div className="px-5 py-4" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
            <h2 className="text-[17px] font-semibold text-foreground">Price Comparison</h2>
            <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>All prices normalised to per piece · sorted cheapest first</p>
          </div>
          <div className="divide-y divide-border">
            {perPieceComparison.map(({ vid, sku, normalized }) => {
              const ourCost = sku.landed_per_piece_mvr;
              return (
                <div key={vid} className="p-5">
                  <div className="mb-3">
                    <p className="text-[14px] font-semibold text-foreground">{sku.brand_name} · {sku.model_name} · {sku.variant_display}</p>
                    <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
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
                              <p className="ios-subhead font-medium text-foreground truncate">{competitor?.name ?? "Unknown"}</p>
                              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                                {BASIS_LABEL[price.price_basis]} · {new Date(price.observed_date).toLocaleDateString("en-MV", { day: "numeric", month: "short" })}
                                {price.their_pcs_per_pack ? <> · {price.their_pcs_per_pack} pcs/{price.price_basis === "per_carton" ? "ctn" : "pk"}</> : null}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-4">
                            <div className="text-right">
                              {pricePiece != null ? (
                                <>
                                  <p className="text-[14px] font-semibold text-foreground">MVR {fmt2(pricePiece)}<span className="ios-subhead text-foreground/40">/pc</span></p>
                                  {delta != null && (
                                    <p className="ios-subhead font-medium" style={{ color: deltaColor }}>
                                      {delta > 0 ? "+" : ""}{fmt2(delta)} vs landed
                                    </p>
                                  )}
                                </>
                              ) : (
                                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                                  {fmt2(Number(price.price_mvr))} ({BASIS_LABEL[price.price_basis]})
                                </p>
                              )}
                            </div>
                            {/* Edit / delete this competitor price — was only reachable
                                from the Competitors list; add it here where prices
                                are actually reviewed. */}
                            {canWrite && (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setPriceDialog({ open: true, editing: price, competitorId: price.competitor_id })}
                                  aria-label="Edit price"
                                  className="h-8 w-8 rounded-lg flex items-center justify-center"
                                  style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => setDeletePriceDialog(price)}
                                  aria-label="Delete price"
                                  className="h-8 w-8 rounded-lg flex items-center justify-center"
                                  style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)" }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
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
                        <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}>
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--snm-brand)" }}>
                              <Tag className="h-3.5 w-3.5" style={{ color: "var(--snm-brand-on)" }} />
                            </div>
                            <div>
                              <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>Our Selling Price</p>
                              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{marginLabel}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[14px] font-semibold" style={{ color: "var(--snm-brand-text)" }}>MVR {fmt2(ourPc)}<span className="ios-subhead opacity-60">/pc</span></p>
                            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>MVR {fmt2(Number(sku.selling_price_per_carton_mvr))}/ctn</p>
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
                            <p className="ios-subhead font-medium" style={{ color: "var(--snm-warning)" }}>Simulated Price</p>
                            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{impliedMarginPct}% margin · not saved yet</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[14px] font-semibold" style={{ color: "var(--snm-warning)" }}>MVR {fmt2(piecePrice)}<span className="ios-subhead opacity-60">/pc</span></p>
                          <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>MVR {fmt2(cartonPrice)}/ctn</p>
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
          <p className="ios-subhead font-semibold text-foreground">Competitors ({competitors.length})</p>
          {canWrite && (
            <button
              onClick={() => setCompetitorDialog({ open: true })}
              className="h-8 px-3 rounded-lg ios-subhead font-bold transition"
              style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}
            >
              + Add
            </button>
          )}
        </div>

        {/* Search */}
        <div className="flex items-center gap-3 rounded-xl px-4 h-11 mb-3" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search competitors…"
            className="flex-1 bg-transparent ios-subhead text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl p-10 flex flex-col items-center text-center space-y-3" style={CARD}>
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
              <Store className="h-6 w-6 text-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground">No competitors yet</h3>
            <p className="ios-subhead max-w-sm" style={{ color: "var(--muted-foreground)" }}>
              Add competitors to start tracking their prices.
            </p>
            {canWrite && (
              <button onClick={() => setCompetitorDialog({ open: true })} className="mt-2 h-11 px-6 rounded-full ios-subhead font-bold" style={{ background: "var(--foreground)", color: "var(--background)" }}>
                Add first competitor
              </button>
            )}
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
                        <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                          {compPrices.length} price{compPrices.length !== 1 ? "s" : ""} logged
                          {comp.notes ? ` · ${comp.notes}` : ""}
                        </p>
                      </div>
                      {isExpanded
                        ? <ChevronUp className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                        : <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />}
                    </button>
                    {canWrite && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => setPriceDialog({ open: true, competitorId: comp.id })}
                          className="h-8 px-3 rounded-lg ios-subhead font-bold transition"
                          style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}
                        >
                          + Price
                        </button>
                        <button onClick={() => setCompetitorDialog({ open: true, editing: comp })} className="h-11 w-11 -m-1.5 flex items-center justify-center">
                          <span className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </span>
                        </button>
                        <button onClick={() => setDeleteCompDialog(comp)} className="h-11 w-11 -m-1.5 flex items-center justify-center">
                          <span className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--snm-error) 8%, transparent)", color: "var(--snm-error)" }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                      {compPrices.length === 0 ? (
                        <div className="px-4 py-4 text-center">
                          <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>No prices logged yet.</p>
                          {canWrite && (
                            <button onClick={() => setPriceDialog({ open: true, competitorId: comp.id })} className="ios-subhead text-foreground opacity-60 active:opacity-100 mt-1">Log first price</button>
                          )}
                        </div>
                      ) : (
                        compPrices.map((p) => {
                          const sku = skus.find((s) => s.variant_id === p.variant_id);
                          return (
                            <div
                              key={p.id}
                              className="px-4 py-3 flex items-start justify-between gap-3"
                              style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="ios-subhead text-foreground truncate">
                                  {sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "Unknown"}
                                </p>
                                <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                                  <span className="text-foreground font-medium">MVR {fmt2(Number(p.price_mvr))}</span>
                                  {" "}{BASIS_LABEL[p.price_basis]}
                                  {p.their_pcs_per_pack ? ` · ${p.their_pcs_per_pack} pcs/${p.price_basis === "per_carton" ? "ctn" : "pk"}` : ""}
                                  {" · "}{new Date(p.observed_date).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                                </p>
                                {p.notes && <p className="ios-subhead mt-0.5 italic" style={{ color: "var(--muted-foreground)" }}>{p.notes}</p>}
                              </div>
                              {canWrite && (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button onClick={() => setPriceDialog({ open: true, editing: p, competitorId: p.competitor_id })} className="h-11 w-11 -m-2 flex items-center justify-center">
                                    <span className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}>
                                      <Pencil className="h-3 w-3" />
                                    </span>
                                  </button>
                                  <button onClick={() => setDeletePriceDialog(p)} className="h-11 w-11 -m-2 flex items-center justify-center">
                                    <span className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--snm-error) 8%, transparent)", color: "var(--snm-error)" }}>
                                      <Trash2 className="h-3 w-3" />
                                    </span>
                                  </button>
                                </div>
                              )}
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
        <Sheet open onClose={() => setDeleteCompDialog(null)} maxWidth="max-w-sm">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--snm-error) 15%, transparent)", color: "var(--snm-error)" }}><AlertTriangle className="h-5 w-5" /></div>
              <div>
                <p className="text-[15px] font-bold text-foreground">Delete competitor?</p>
                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{deleteCompDialog.name}</p>
              </div>
            </div>
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>All logged prices will also be removed.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteCompDialog(null)} className="flex-1 h-12 rounded-xl ios-subhead font-semibold" style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const { queued } = await withOfflineFallback(
                      () => deleteCompetitor(deleteCompDialog.id),
                      { table: "competitors", action: "delete", payload: {}, match: { id: deleteCompDialog.id } },
                    );
                    haptic("success");
                    toast.success(queued ? "Saved offline — will sync when connected" : "Removed");
                    if (!queued) { setDeleteCompDialog(null); load(); }
                  }
                  catch (e) { haptic("error"); toast.error((e as Error).message); }
                  finally { setDeleting(false); }
                }}
                className="flex-1 h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
                style={{ background: "var(--snm-error)", color: "var(--background)" }}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Delete"}
              </button>
            </div>
        </Sheet>
      )}
      {deletePriceDialog && (
        <Sheet open onClose={() => setDeletePriceDialog(null)} maxWidth="max-w-sm">
            <p className="text-[15px] font-bold text-foreground">Remove price entry?</p>
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>This price record will be permanently deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeletePriceDialog(null)} className="flex-1 h-12 rounded-xl ios-subhead font-semibold" style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const { queued } = await withOfflineFallback(
                      () => deleteCompetitorPrice(deletePriceDialog.id),
                      { table: "competitor_prices", action: "delete", payload: {}, match: { id: deletePriceDialog.id } },
                    );
                    haptic("success");
                    toast.success(queued ? "Saved offline — will sync when connected" : "Removed");
                    if (!queued) { setDeletePriceDialog(null); load(); }
                  }
                  catch (e) { haptic("error"); toast.error((e as Error).message); }
                  finally { setDeleting(false); }
                }}
                className="flex-1 h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
                style={{ background: "var(--snm-error)", color: "var(--background)" }}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Delete"}
              </button>
            </div>
        </Sheet>
      )}
    </div>
  );
}

// ── Competitor Modal ──────────────────────────────────────────────────────────

function CompetitorModal({ editing, onClose, onDone }: { editing?: CompetitorRow; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const CARD = { background: "var(--glass-1)", boxShadow: "var(--glass-shadow), var(--glass-inner)" } as const;

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const payload = { name: name.trim(), notes: notes.trim() || null };
    try {
      const { queued } = await withOfflineFallback<void>(
        async () => { if (editing) await updateCompetitor(editing.id, payload); else await createCompetitor(payload.name, payload.notes); },
        editing
          ? { table: "competitors", action: "update", payload, match: { id: editing.id } }
          : { table: "competitors", action: "insert", payload },
      );
      toast.success(queued ? "Saved offline — will sync when connected" : editing ? "Updated" : "Competitor added");
      if (!queued) onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[16px] font-bold text-foreground">{editing ? "Edit Competitor" : "Add Competitor"}</p>
      <div className="space-y-1.5">
        <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>NAME *</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Novelty" className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none placeholder:text-muted-foreground" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }} />
      </div>
      <div className="space-y-1.5">
        <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>NOTES</p>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" rows={2} className="w-full rounded-xl px-4 py-3 ios-subhead text-foreground outline-none placeholder:text-muted-foreground resize-none" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }} />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onClose} className="flex-1 h-12 rounded-xl ios-subhead font-semibold" style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
        <button onClick={save} disabled={saving || !name.trim()} className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40" style={{ background: "var(--foreground)", color: "var(--background)" }}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : editing ? "Save" : "Add"}
        </button>
      </div>
    </Sheet>
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
  const CARD = { background: "var(--glass-1)", boxShadow: "var(--glass-shadow), var(--glass-inner)" } as const;

  const [selectedCompId, setSelectedCompId] = useState(competitorId ?? editing?.competitor_id ?? "");
  const [variantId, setVariantId] = useState(editing?.variant_id ?? "");
  const [skuSearch, setSkuSearch] = useState("");
  const [priceMvr, setPriceMvr] = useState(editing ? String(editing.price_mvr) : "");
  const [priceBasis, setPriceBasis] = useState<PriceBasis>(editing?.price_basis ?? "per_pack");
  const [theirPcsPerPack, setTheirPcsPerPack] = useState(editing?.their_pcs_per_pack ? String(editing.their_pcs_per_pack) : "");
  // Was this field auto-filled by us (safe to keep overwriting as the
  // product/basis changes) or has Ali typed his own number (never touch it
  // again)? Starts true only when there's nothing already saved to protect.
  const [pcsAutoFilled, setPcsAutoFilled] = useState(!editing?.their_pcs_per_pack);
  const [observedDate, setObservedDate] = useState(editing?.observed_date ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const uniqueVariants = useMemo(() => {
    const seen = new Set<string>();
    const deduped = skus.filter((s) => { if (seen.has(s.variant_id)) return false; seen.add(s.variant_id); return true; });
    // Explicit sort (not just relying on listSkusFlat's own order) — brand →
    // model → natural size order (NB, S, M, L, XL, XXL, …), the same
    // comparator every other product list in the app uses, so the picker
    // below is guaranteed to group and expand in that hierarchy regardless
    // of how `skus` was sourced.
    return [...deduped].sort(compareSkusForDisplay);
  }, [skus]);

  const filteredVariants = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    if (!term) return uniqueVariants;
    return uniqueVariants.filter((s) => [s.brand_name, s.model_name, s.variant_display].join(" ").toLowerCase().includes(term));
  }, [uniqueVariants, skuSearch]);

  // Brand -> Model grouping, same shape as the New Sale wizard's product grid
  // (components/sales/sales-list.tsx). A flat list of every variant read as a
  // wall of near-identical rows once a brand spans several model lines (e.g.
  // Mamypoko: Royal Soft, Royal Soft Boy/Girl, Skin Comfort, Xtra Kering) and
  // forced a cramped scroll-inside-scroll box to hold it. Brand stays a fixed
  // section label (never collapses); each model underneath is independently
  // collapsible, collapsed by default. Typing still force-expands every model
  // so a search match is never hidden behind a closed accordion.
  const brandModelGroups = useMemo(() => {
    const brands = new Map<string, { brandId: string; brandName: string; models: Map<string, { modelId: string; modelName: string; variants: SkuFullRow[] }> }>();
    for (const s of filteredVariants) {
      let brand = brands.get(s.brand_id);
      if (!brand) { brand = { brandId: s.brand_id, brandName: s.brand_name, models: new Map() }; brands.set(s.brand_id, brand); }
      let model = brand.models.get(s.model_id);
      if (!model) { model = { modelId: s.model_id, modelName: s.model_name, variants: [] }; brand.models.set(s.model_id, model); }
      model.variants.push(s);
    }
    return [...brands.values()].map((b) => ({ ...b, models: [...b.models.values()] }));
  }, [filteredVariants]);

  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  function toggleModel(modelId: string) {
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId); else next.add(modelId);
      return next;
    });
  }

  const selectedSku = skus.find((s) => s.variant_id === variantId);

  // The pieces field always needs to hold a real number the moment it's
  // relevant (per_pack or per_carton basis) — leaving it blank invited a
  // silent "assume it matches ours" fallback that nobody could see, and
  // typing an untested value into an empty box produced nonsense (e.g. 256
  // pieces in a diaper pack → a 28,000% gap). Pre-fill with our own pack/
  // carton size so the number driving the conversion is always visible and
  // correct-by-default; Ali only edits it when the competitor's really
  // differs. Keeps re-deriving the default as the product/basis changes,
  // but only while still auto-filled — stops the moment Ali types his own.
  useEffect(() => {
    if (!selectedSku || !pcsAutoFilled) return;
    if (priceBasis === "per_pack")   setTheirPcsPerPack(String(selectedSku.pcs_per_pack));
    else if (priceBasis === "per_carton") setTheirPcsPerPack(String(selectedSku.pcs_per_carton));
  }, [selectedSku, priceBasis, pcsAutoFilled]);

  // Live per-piece calculation preview. their_pcs_per_pack is the whole point
  // of this field: a competitor's pack/carton can hold a different piece
  // count than ours (their 44/pk vs our 56/pk), so a raw pack-to-pack or
  // carton-to-carton price comparison is meaningless — everything must land
  // on a per-piece basis first, using THEIR piece count (pre-filled with
  // ours, editable), before it can be compared to our own price. Mirrors
  // get_competitor_price_gaps exactly (supabase/migrations) so this preview
  // and the Price Gaps dashboard never disagree.
  const perPiecePreview = useMemo(() => {
    const price = parseFloat(priceMvr);
    if (!price || !selectedSku) return null;
    const theirPcs = parseInt(theirPcsPerPack);
    if (priceBasis === "per_piece")   return price;
    if (priceBasis === "per_pack")    return price / (theirPcs || selectedSku.pcs_per_pack);
    if (priceBasis === "per_carton")  return price / (theirPcs || selectedSku.pcs_per_carton);
    return null;
  }, [priceMvr, priceBasis, theirPcsPerPack, selectedSku]);

  // What this means for OUR price, in OUR own units — the auto-calculation
  // Ali actually asked for. Their per-piece price times our pack/carton size
  // gives "what we'd charge per pack/carton to match them exactly", so a
  // competitor's odd pack size never has to be mentally converted by hand.
  // Never writes anywhere — purely a read-only comparison in this sheet;
  // Ali still sets his own prices via the Margin Simulator (never auto-
  // overwritten, per the fixed-price rule).
  const ourComparison = useMemo(() => {
    if (perPiecePreview == null || !selectedSku || selectedSku.selling_price_per_piece_mvr == null) return null;
    const ourPerPiece = selectedSku.selling_price_per_piece_mvr;
    const diff = ourPerPiece - perPiecePreview;
    const diffPct = (diff / perPiecePreview) * 100;
    return {
      ourPerPiece,
      diff,
      diffPct,
      matchPackPrice: perPiecePreview * selectedSku.pcs_per_pack,
      matchCartonPrice: perPiecePreview * selectedSku.pcs_per_pack * selectedSku.packs_per_carton,
    };
  }, [perPiecePreview, selectedSku]);

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
      const { queued } = await withOfflineFallback<void>(
        async () => { if (editing) await updateCompetitorPrice(editing.id, payload); else await createCompetitorPrice(payload); },
        editing
          ? { table: "competitor_prices", action: "update", payload, match: { id: editing.id } }
          : { table: "competitor_prices", action: "insert", payload },
      );
      toast.success(queued ? "Saved offline — will sync when connected" : editing ? "Price updated" : "Price logged");
      if (!queued) onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  // Native bottom sheet — fixed-height panel (never scrolls itself), pinned
  // header + footer, and ONE inner scroll region. This form has a scrollable
  // product picker plus many fields, so — same as the other sheets in this
  // app — it must be docked to the screen edges with its own scroll area,
  // not a free-floating, content-sized card (which drags with the finger
  // instead of scrolling, and reads as a webpage, not a native sheet).
  return (
    <Sheet
      open
      onClose={onClose}
      variant="docked"
      heightDvh={88}
      header={<p className="text-[16px] font-bold text-foreground pb-3">{editing ? "Edit Price" : "Log Competitor Price"}</p>}
      footer={
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl ios-subhead font-semibold" style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>Cancel</button>
          <button onClick={save} disabled={saving || !selectedCompId || !variantId || !priceMvr} className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40" style={{ background: "var(--foreground)", color: "var(--background)" }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : editing ? "Save" : "Log Price"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
          {/* Competitor selector — show all, or allow adding inline */}
          <div className="space-y-1.5">
            <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>COMPETITOR *</p>
            {competitors.length > 0 ? (
              <select value={selectedCompId} onChange={(e) => setSelectedCompId(e.target.value)} className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none appearance-none" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                <option value="">Pick competitor</option>
                {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Add a competitor first using the &ldquo;Add Competitor&rdquo; button.</p>
            )}
          </div>

          {/* Product */}
          <div>
            <p className="label-caps text-[12px] mb-1.5" style={{ color: "var(--muted-foreground)" }}>PRODUCT *</p>
            {!variantId ? (
              <>
                <input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} placeholder="Search brand, model…" className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none placeholder:text-muted-foreground mb-2" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }} />
                <div className="space-y-3">
                  {brandModelGroups.map(({ brandId, brandName, models }) => (
                    <div key={brandId}>
                      {/* Brand — fixed section label, never collapses */}
                      <p className="label-caps text-[12px] px-1 pb-1.5" style={{ color: "var(--muted-foreground)" }}>{brandName}</p>
                      <div className="space-y-2">
                        {models.map(({ modelId, modelName, variants }) => {
                          // Collapsed by default; typing force-expands so a
                          // search match is never hidden behind a closed row.
                          const expanded = skuSearch.trim() !== "" || expandedModels.has(modelId);
                          return (
                            <div key={modelId} className="rounded-xl overflow-hidden" style={CARD}>
                              <button
                                type="button"
                                onClick={() => toggleModel(modelId)}
                                aria-expanded={expanded}
                                className="w-full flex items-center gap-1.5 px-4 py-3 text-left active:opacity-70"
                              >
                                <ChevronDown
                                  className="h-3.5 w-3.5 shrink-0 transition-transform"
                                  style={{ color: "var(--muted-foreground)", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
                                />
                                <p className="ios-subhead font-semibold flex-1" style={{ color: "var(--foreground)" }}>{modelName}</p>
                                <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                                  {variants.length} size{variants.length !== 1 ? "s" : ""}
                                </p>
                              </button>
                              {expanded && variants.map((s) => (
                                <button
                                  key={s.variant_id}
                                  onClick={() => setVariantId(s.variant_id)}
                                  className="w-full text-left px-4 py-3 active:opacity-70"
                                  style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}
                                >
                                  <SkuIdentity
                                    brandName={s.brand_name} modelName={s.model_name} variantDisplay={s.variant_display}
                                    pcsPerPack={s.pcs_per_pack} packsPerCarton={s.packs_per_carton}
                                  />
                                </button>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {brandModelGroups.length === 0 && (
                    <p className="px-1 py-3 ios-subhead" style={{ color: "var(--muted-foreground)" }}>No matches</p>
                  )}
                </div>
              </>
            ) : selectedSku ? (
              <div className="rounded-xl p-3 flex justify-between items-start gap-3" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                <SkuIdentity
                  brandName={selectedSku.brand_name} modelName={selectedSku.model_name} variantDisplay={selectedSku.variant_display}
                  pcsPerPack={selectedSku.pcs_per_pack} packsPerCarton={selectedSku.packs_per_carton}
                  size="card"
                />
                <button onClick={() => { setVariantId(""); setSkuSearch(""); }} className="ios-subhead text-foreground opacity-60 active:opacity-100 shrink-0">Change</button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>THEIR PRICE (MVR) *</p>
              <input type="number" step="0.01" min="0" value={priceMvr} onChange={(e) => setPriceMvr(e.target.value)} onFocus={(e) => e.target.select()} className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }} />
            </div>
            <div className="space-y-1.5">
              <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>PRICE BASIS *</p>
              <select value={priceBasis} onChange={(e) => setPriceBasis(e.target.value as PriceBasis)} className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none appearance-none" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                {(Object.keys(BASIS_LABEL) as PriceBasis[]).map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
              </select>
            </div>
          </div>

          {/* The piece count that actually drives the conversion below — shown
              and filled in BEFORE the preview, not after, so cause comes
              before effect. Only relevant when their price is for a pack or
              a carton; a per-piece price needs no conversion at all. */}
          {(priceBasis === "per_pack" || priceBasis === "per_carton") && (
            <div className="space-y-1.5">
              <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                THEIR PIECES PER {priceBasis === "per_pack" ? "PACK" : "CARTON"}
              </p>
              <input
                type="number" min="1" value={theirPcsPerPack}
                onChange={(e) => { setTheirPcsPerPack(e.target.value); setPcsAutoFilled(false); }}
                onFocus={(e) => e.target.select()}
                className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none"
                style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
              />
              <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                Pre-filled with ours — change it only if their {priceBasis === "per_pack" ? "pack" : "carton"} holds a different count.
              </p>
            </div>
          )}

          {/* Live per-piece preview, plus what it means for our own price */}
          {perPiecePreview != null && (
            <div className="rounded-xl px-4 py-3 space-y-2" style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}>
              <p className="ios-subhead text-center" style={{ color: "var(--muted-foreground)" }}>
                Their price = <span className="font-bold text-[14px]" style={{ color: "var(--foreground)" }}>MVR {fmt2(perPiecePreview)}</span> per piece
              </p>
              {ourComparison ? (
                <>
                  <div className="flex items-center justify-between pt-2" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                    <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>Your price</p>
                    <p className="ios-subhead font-bold snm-num" style={{ color: "var(--foreground)" }}>MVR {fmt2(ourComparison.ourPerPiece)}/pc</p>
                  </div>
                  <p
                    className="ios-footnote font-semibold text-center"
                    style={{ color: ourComparison.diff > 0.005 ? "var(--snm-warning)" : ourComparison.diff < -0.005 ? "var(--snm-success)" : "var(--muted-foreground)" }}
                  >
                    {ourComparison.diff > 0.005
                      ? `You're MVR ${fmt2(ourComparison.diff)} (${ourComparison.diffPct.toFixed(1)}%) more per piece`
                      : ourComparison.diff < -0.005
                      ? `You're MVR ${fmt2(Math.abs(ourComparison.diff))} (${Math.abs(ourComparison.diffPct).toFixed(1)}%) cheaper per piece`
                      : "Same price per piece"}
                  </p>
                  <div className="flex items-center justify-between pt-2" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                    <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>To match, in your pack size</p>
                    <p className="ios-subhead font-bold snm-num" style={{ color: "var(--foreground)" }}>MVR {fmt2(ourComparison.matchPackPrice)}/pack</p>
                  </div>
                </>
              ) : (
                <p className="ios-footnote text-center" style={{ color: "var(--muted-foreground)" }}>No selling price set for this product yet — can&apos;t compare</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>DATE OBSERVED *</p>
            <input type="date" value={observedDate} onChange={(e) => setObservedDate(e.target.value)} className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }} />
          </div>

          <div className="space-y-1.5">
            <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>NOTES</p>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Promo price seen at Novelty Maafannu" rows={2} className="w-full rounded-xl px-4 py-3 ios-subhead text-foreground outline-none placeholder:text-muted-foreground resize-none" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }} />
          </div>
      </div>
    </Sheet>
  );
}

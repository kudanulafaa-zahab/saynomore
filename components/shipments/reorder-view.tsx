"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, ClipboardList, AlertTriangle, TrendingDown, PackageCheck, Ship, Check,
  Plus, ChevronDown, Search,
} from "lucide-react";
import {
  listReorderSuggestions, type ReorderSuggestion,
} from "@/lib/queries/inventory";
import {
  listSkusFlat, getCurrentUserRole, compareSkusForDisplay, type SkuFullRow,
} from "@/lib/queries/products";
import {
  createDraftPoFromSuggestions, CONTAINER_CAPACITY_CBM, type DraftPoLine,
} from "@/lib/queries/shipments";
import { SkeletonRows } from "@/components/layout/page-skeleton";
import { BodyPortal } from "@/components/ui/body-portal";
import { haptic } from "@/lib/haptics";

const CARD: React.CSSProperties = {
  background: "linear-gradient(180deg, var(--glass-fill-top), var(--glass-fill-bottom))",
  backdropFilter: "blur(calc(14px * var(--frost-b))) saturate(var(--glass-saturate))",
  WebkitBackdropFilter: "blur(calc(14px * var(--frost-b))) saturate(var(--glass-saturate))",
  boxShadow: "inset 0 1px 1px var(--glass-specular), var(--glass-shadow)",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.65))",
};

const STATUS: Record<ReorderSuggestion["status"], { label: string; color: string }> = {
  out:       { label: "Out of stock", color: "var(--snm-error)" },
  critical:  { label: "Order now",   color: "var(--snm-error)" },
  low:       { label: "Order soon",  color: "var(--snm-warning)" },
  ok:        { label: "Healthy",     color: "var(--snm-success)" },
  overstock: { label: "Overstocked", color: "var(--muted-foreground)" },
};

export function ReorderView() {
  const router = useRouter();
  const [rows, setRows]       = useState<ReorderSuggestion[]>([]);
  const [skus, setSkus]       = useState<SkuFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  // Per-SKU chosen order quantity (cartons). Seeded from the suggestion.
  const [qty, setQty] = useState<Record<string, number>>({});
  // Which SKUs are ticked to include in the draft PO.
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    getCurrentUserRole().then((r) => setCanWrite(r !== "viewer" && r !== null)).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [sug, sk] = await Promise.all([listReorderSuggestions(), listSkusFlat()]);
      setRows(sug);
      setSkus(sk);
      // Pre-tick and pre-fill everything that needs ordering (critical + low).
      const q: Record<string, number> = {};
      const p = new Set<string>();
      for (const r of sug) {
        q[r.sku_id] = r.suggested_cartons;
        if (r.suggested_cartons > 0 && (r.status === "out" || r.status === "critical" || r.status === "low")) p.add(r.sku_id);
      }
      setQty(q);
      setPicked(p);
    } catch (e) {
      toast.error("Failed to load: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const cbmFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of skus) m.set(s.id, Number(s.cbm_per_carton));
    return m;
  }, [skus]);

  // Pack configuration per SKU — surfaced on each row because two SKUs can share
  // a size but pack differently (e.g. 30/pk vs 60/pk), which changes what a
  // carton means.
  const packFor = useMemo(() => {
    const m = new Map<string, { pk: number; ppc: number }>();
    for (const s of skus) m.set(s.id, { pk: Number(s.pcs_per_pack), ppc: Number(s.packs_per_carton) });
    return m;
  }, [skus]);

  // Sales are counted and shown in the unit the product actually sells in —
  // cartons/packs, never loose pieces (diapers are always sold by pack/carton).
  const cartonsSold = (r: ReorderSuggestion) => (r.pcs_per_carton > 0 ? r.sold_90d / r.pcs_per_carton : r.sold_90d);
  const soldLabel = (r: ReorderSuggestion): string => {
    if (r.sold_90d <= 0) return "";
    const ppc = r.pcs_per_carton || 0;
    const pk = packFor.get(r.sku_id)?.pk ?? 0;
    if (ppc > 0 && r.sold_90d >= ppc) return `${Math.round(r.sold_90d / ppc)} ctn`;
    if (pk > 0) return `${Math.max(1, Math.round(r.sold_90d / pk))} pk`;
    return `${r.sold_90d} pcs`;
  };

  // "What sells" signal for ordering decisions — classify each SKU against the
  // whole catalogue by real 90-day sales (in CARTONS), so an out-of-stock top
  // seller is obvious (restock heavily) vs a slow mover (don't). Quartile-based,
  // relative to this business's own range.
  const mover = useMemo(() => {
    const sold = rows.map(cartonsSold).filter((v) => v > 0).sort((a, b) => a - b);
    const pct = (p: number) => (sold.length ? sold[Math.min(sold.length - 1, Math.floor(sold.length * p))] : 0);
    const hi = pct(0.75), lo = pct(0.25);
    return (r: ReorderSuggestion): { label: string; strong: boolean } => {
      const c = cartonsSold(r);
      if (c <= 0) return { label: "No recent sales", strong: false };
      if (c >= hi) return { label: "Top seller", strong: true };
      if (c <= lo) return { label: "Slow mover", strong: false };
      return { label: "Steady seller", strong: false };
    };
  }, [rows]);

  // ── Browse the FULL catalogue ────────────────────────────────────────────
  // Container imports are consolidated, not just replenished: freight is charged
  // per container/CBM, so shipping only the urgent items means paying to move a
  // half-empty box. Every serious purchasing module lets you add ANY product to
  // a PO — the suggestions are a starting point, not the whole order.
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseQ, setBrowseQ]       = useState("");
  const [browseSort, setBrowseSort] = useState<"cat" | "low" | "high">("cat");
  const [reviewOpen, setReviewOpen] = useState(false);

  const suggestionById = useMemo(() => {
    const m = new Map<string, ReorderSuggestion>();
    for (const r of rows) m.set(r.sku_id, r);
    return m;
  }, [rows]);

  const stockCtnFor = useCallback((skuId: string) => {
    const r = suggestionById.get(skuId);
    return r ? Number(r.stock_cartons) : 0;
  }, [suggestionById]);

  // Grouped by product — a detergent never sits between two diaper SKUs.
  const browseGroups = useMemo(() => {
    const term = browseQ.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active).filter((s) =>
      !term || [s.brand_name, s.model_name, s.variant_display ?? "", s.internal_code ?? ""]
        .join(" ").toLowerCase().includes(term));
    const map = new Map<string, SkuFullRow[]>();
    for (const s of active) {
      const k = `${s.brand_name}|${s.model_name}`;
      const a = map.get(k) ?? []; a.push(s); map.set(k, a);
    }
    const groups = Array.from(map.values()).map((list) => {
      const sorted = [...list].sort((a, b) =>
        browseSort === "low"  ? stockCtnFor(a.id) - stockCtnFor(b.id) || compareSkusForDisplay(a, b) :
        browseSort === "high" ? stockCtnFor(b.id) - stockCtnFor(a.id) || compareSkusForDisplay(a, b) :
        compareSkusForDisplay(a, b));
      return { key: `${sorted[0].brand_name}|${sorted[0].model_name}`, brand: sorted[0].brand_name, model: sorted[0].model_name, skus: sorted };
    });
    // Sorting reorders the SECTIONS, never the SKUs across the catalogue.
    const groupStock = (g: { skus: SkuFullRow[] }) => g.skus.reduce((a, s) => a + stockCtnFor(s.id), 0);
    groups.sort((a, b) =>
      browseSort === "low"  ? groupStock(a) - groupStock(b) :
      browseSort === "high" ? groupStock(b) - groupStock(a) :
      compareSkusForDisplay(a.skus[0], b.skus[0]));
    return groups;
  }, [skus, browseQ, browseSort, stockCtnFor]);

  // Split into what to act on vs the rest.
  const toOrder   = rows.filter((r) => r.status === "out" || r.status === "critical" || r.status === "low");
  const overstock = rows.filter((r) => r.status === "overstock");
  const healthy   = rows.filter((r) => r.status === "ok");

  const pickedLines: DraftPoLine[] = [...picked]
    .map((id) => ({ sku_id: id, qty_cartons: qty[id] ?? 0, cbm_per_carton: cbmFor.get(id) ?? 0 }))
    .filter((l) => l.qty_cartons > 0);

  const pickedCbm = pickedLines.reduce((a, l) => a + l.qty_cartons * (l.cbm_per_carton || 0), 0);

  async function createDraft() {
    if (pickedLines.length === 0) { toast.error("Tick at least one product to order"); return; }
    setCreating(true);
    try {
      const shipment = await createDraftPoFromSuggestions(pickedLines);
      haptic("success");
      toast.success("Draft PO created — add supplier prices to finish");
      router.push(`/shipments/${shipment.id}`);
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function setQ(id: string, v: number) {
    setQty((prev) => ({ ...prev, [id]: Math.max(0, v) }));
  }

  if (loading) return <SkeletonRows rows={7} />;

  const nameOf = (r: ReorderSuggestion) =>
    `${r.brand_name} · ${r.model_name}${r.variant_display ? ` · ${r.variant_display}` : ""}`;

  return (
    <div className="pb-40 lg:pb-10 space-y-4">
      {/* Empty state */}
      {rows.length === 0 && (
        <div className="rounded-2xl px-8 py-16 flex flex-col items-center text-center" style={CARD}>
          <ClipboardList className="h-8 w-8 mb-3 opacity-20" style={{ color: "var(--muted-foreground)" }} />
          <p className="ios-subhead font-medium text-foreground">Nothing to reorder yet</p>
          <p className="ios-subhead mt-1" style={{ color: "var(--muted-foreground)" }}>
            Once you have sales history, we&apos;ll suggest what to order and how much.
          </p>
        </div>
      )}

      {/* ── To order ── */}
      {toOrder.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <AlertTriangle className="h-4 w-4" style={{ color: "var(--snm-warning)" }} />
            <p className="ios-subhead font-semibold text-foreground">Suggested orders</p>
            <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
              · ranked by urgency &amp; sales value
            </span>
          </div>
          <div className="rounded-2xl overflow-hidden" style={CARD}>
            {toOrder.map((r) => {
              const on = picked.has(r.sku_id);
              const st = STATUS[r.status];
              return (
                <div key={r.sku_id} className="px-4 py-3.5" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                  <div className="flex items-start gap-3">
                    {/* Tick — 44x44 tap target (Apple HIG minimum); visual chip
                        stays a compact 24x24 checkbox centered inside it. */}
                    <button
                      onClick={() => canWrite && toggle(r.sku_id)}
                      disabled={!canWrite}
                      className="h-11 w-11 -m-2.5 flex items-center justify-center shrink-0 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span
                        className="h-6 w-6 rounded-md flex items-center justify-center"
                        style={{
                          background: on ? "var(--snm-brand)" : "transparent",
                          border: on ? "none" : "1.5px solid var(--glass-border)",
                        }}
                      >
                        {on && <Check className="h-3.5 w-3.5" style={{ color: "var(--snm-brand-on)" }} />}
                      </span>
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-foreground leading-snug">{nameOf(r)}</p>
                      {/* Lead with the decision, not the math: the day the order
                          must be placed (learned from this SKU's real shipment
                          lead times) — red when that day is already here. */}
                      {r.order_by_date != null && (
                        <p className="snm-num ios-subhead font-semibold mt-0.5"
                          style={{ color: new Date(r.order_by_date) <= new Date() ? "var(--snm-error)" : "var(--foreground)" }}>
                          Order by {new Date(r.order_by_date).toLocaleDateString("en-MV", { day: "numeric", month: "short" })}
                          {r.lead_days != null
                            ? ` · ${r.supplier_name ?? "supplier"} takes ~${Math.round(r.lead_days)}d`
                            : ""}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="snm-num ios-subhead font-medium" style={{ color: st.color }}>
                          {r.dir != null ? `${Math.round(r.dir)}d left` : "no sales data"} · {st.label}
                        </span>
                        <span className="snm-num ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                          {r.stock_cartons} ctn in stock
                          {(() => { const p = packFor.get(r.sku_id); return p ? ` · ${p.pk}/pk × ${p.ppc}/ctn` : ""; })()}
                        </span>
                        {/* What sells — the ordering decision signal. Sold-in-90-days
                            is the real evidence; the mover tag is the glance. Both
                            neutral (info, not money → no hue); "Top seller" leans on
                            weight, not colour. */}
                        {(() => {
                          const m = mover(r);
                          return (
                            <span className="ios-footnote px-1.5 py-0.5 rounded-md"
                              style={{ color: m.strong ? "var(--foreground)" : "var(--muted-foreground)", fontWeight: m.strong ? 700 : 500, background: "var(--glass-bg-2)" }}>
                              {m.label}{r.sold_90d > 0 ? ` · ${soldLabel(r)} sold/90d` : ""}
                            </span>
                          );
                        })()}
                        {r.trend !== "steady" && (
                          <span className="ios-footnote font-medium px-1.5 py-0.5 rounded-md"
                            style={{ color: "var(--muted-foreground)", background: "var(--glass-bg-2)" }}>
                            {r.trend === "rising" ? "▲ picking up" : "▼ slowing"}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Suggested qty stepper — 44x44 tap targets on +/-, visual
                        chip stays a compact 28px swatch centered inside. */}
                    <div className="shrink-0 text-right">
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => canWrite && setQ(r.sku_id, (qty[r.sku_id] ?? 0) - 1)}
                          disabled={!canWrite}
                          className="h-11 w-11 -m-2 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed">
                          <span className="h-7 w-7 rounded-lg text-[15px] font-bold flex items-center justify-center"
                            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>−</span>
                        </button>
                        <input
                          type="number" inputMode="numeric"
                          value={qty[r.sku_id] ?? 0}
                          onChange={(e) => setQ(r.sku_id, parseInt(e.target.value || "0", 10))}
                          onFocus={(e) => e.target.select()}
                          disabled={!canWrite}
                          className="snm-num w-12 h-11 text-center text-[14px] font-bold text-foreground rounded-lg outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", MozAppearance: "textfield" } as React.CSSProperties}
                        />
                        <button onClick={() => canWrite && setQ(r.sku_id, (qty[r.sku_id] ?? 0) + 1)}
                          disabled={!canWrite}
                          className="h-11 w-11 -m-2 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed">
                          <span className="h-7 w-7 rounded-lg text-[15px] font-bold flex items-center justify-center"
                            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>+</span>
                        </button>
                      </div>
                      <p className="ios-subhead mt-1" style={{ color: "var(--muted-foreground)" }}>cartons</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Add other products — the full catalogue, grouped by product ──
             Container freight is charged per CBM, so a PO is consolidated, not
             just replenished: you top up with non-urgent lines to fill the box.
             Collapsed by default so the screen stays exception-first. */}
      <div>
        <button
          onClick={() => setBrowseOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-1 py-2"
        >
          <Plus className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
          <p className="ios-subhead font-semibold text-foreground">Add other products</p>
          <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>· top up the container</span>
          <ChevronDown
            className="h-4 w-4 ml-auto transition-transform"
            style={{ color: "var(--muted-foreground)", transform: browseOpen ? "rotate(180deg)" : "none" }}
          />
        </button>

        {browseOpen && (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <div className="flex items-center gap-2 px-3 rounded-xl flex-1 min-w-0"
                style={{ background: "var(--glass-bg-1)", height: 40, border: "0.5px solid var(--glass-border-lo)" }}>
                <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                <input
                  value={browseQ} onChange={(e) => setBrowseQ(e.target.value)}
                  placeholder="Search product…"
                  className="flex-1 min-w-0 bg-transparent border-none outline-none ios-subhead text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex gap-0.5 shrink-0" style={{ background: "var(--glass-bg-1)", borderRadius: 11, padding: 3 }}>
                {([["cat", "A–Z"], ["low", "Low stock"], ["high", "Most stock"]] as const).map(([s, label]) => (
                  <button key={s} onClick={() => setBrowseSort(s)}
                    className="rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold transition"
                    style={{ background: browseSort === s ? "var(--foreground)" : "transparent",
                             color: browseSort === s ? "var(--background)" : "var(--muted-foreground)" }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {browseGroups.length === 0 ? (
              <p className="ios-subhead px-1 py-3" style={{ color: "var(--muted-foreground)" }}>No products match.</p>
            ) : browseGroups.map((g) => (
              <div key={g.key}>
                <div className="flex items-center gap-2 px-1 py-1.5" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                  <p className="text-[11px] font-bold uppercase tracking-wide truncate" style={{ color: "var(--muted-foreground)" }}>
                    {g.brand} · {g.model}
                  </p>
                </div>
                <div className="rounded-2xl overflow-hidden mt-1" style={CARD}>
                  {g.skus.map((s) => {
                    const on = picked.has(s.id);
                    const ctn = stockCtnFor(s.id);
                    return (
                      <div key={s.id} className="px-4 py-2.5 flex items-center gap-3" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                        <button
                          onClick={() => { if (!canWrite) return; if (!on && !(qty[s.id] > 0)) setQ(s.id, 1); toggle(s.id); }}
                          disabled={!canWrite}
                          className="h-11 w-11 -m-2.5 flex items-center justify-center shrink-0 disabled:opacity-40"
                        >
                          <span className="h-6 w-6 rounded-md flex items-center justify-center"
                            style={{ background: on ? "var(--snm-brand)" : "transparent", border: on ? "none" : "1.5px solid var(--glass-border)" }}>
                            {on && <Check className="h-3.5 w-3.5" style={{ color: "var(--snm-brand-on)" }} />}
                          </span>
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold text-foreground truncate">{s.variant_display ?? s.internal_code}</p>
                          <p className="snm-num ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                            {s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn · {ctn} ctn in stock
                          </p>
                        </div>
                        {on && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button onClick={() => setQ(s.id, (qty[s.id] ?? 0) - 1)} className="h-11 w-9 -m-1 flex items-center justify-center">
                              <span className="h-7 w-7 rounded-lg text-[15px] font-bold flex items-center justify-center"
                                style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>−</span>
                            </button>
                            <input
                              type="number" inputMode="numeric" value={qty[s.id] ?? 0}
                              onChange={(e) => setQ(s.id, parseInt(e.target.value || "0", 10))}
                              onFocus={(e) => e.target.select()}
                              className="snm-num w-11 h-10 text-center text-[14px] font-bold text-foreground rounded-lg outline-none"
                              style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", MozAppearance: "textfield" } as React.CSSProperties}
                            />
                            <button onClick={() => setQ(s.id, (qty[s.id] ?? 0) + 1)} className="h-11 w-9 -m-1 flex items-center justify-center">
                              <span className="h-7 w-7 rounded-lg text-[15px] font-bold flex items-center justify-center"
                                style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>+</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Overstock ── */}
      {overstock.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <TrendingDown className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
            <p className="ios-subhead font-semibold text-foreground">Overstocked — don&apos;t reorder</p>
          </div>
          <div className="rounded-2xl overflow-hidden" style={CARD}>
            {overstock.map((r) => (
              <div key={r.sku_id} className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                <div className="min-w-0">
                  <p className="ios-subhead font-medium text-foreground truncate">{nameOf(r)}</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                    {r.dir != null ? `~${Math.round(r.dir)} days of stock` : ""} · {r.stock_cartons} ctn · slow — consider a promo
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Healthy (collapsed count) ── */}
      {healthy.length > 0 && (
        <div className="rounded-2xl px-4 py-3 flex items-center gap-2.5" style={CARD}>
          <PackageCheck className="h-4 w-4 shrink-0" style={{ color: "var(--snm-success)" }} />
          <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
            <span className="font-semibold text-foreground">{healthy.length}</span> other SKU{healthy.length !== 1 ? "s" : ""} at healthy stock — no action needed.
          </p>
        </div>
      )}

      {/* ── Floating action bar — sits ABOVE the tab bar as its own pill so its
             (white in dark / black in light) CTA never bleeds through the glass
             tab bar. Outer is transparent + non-interactive so it doesn't block
             taps on the list; the inner pill floats 12px above the 64px tab bar
             (which itself sits max(14px, safe-area) up). Desktop has no floating
             tab bar, so the padding resets there. ── */}
      {canWrite && toOrder.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-60 z-30 px-4 pointer-events-none lg:!pb-4"
          style={{
            paddingBottom: "calc(max(14px, env(safe-area-inset-bottom, 0px)) + 76px)",
          }}>
          <div className="max-w-4xl mx-auto flex items-center gap-3 rounded-2xl px-4 py-2.5 pointer-events-auto"
            style={{
              background: "color-mix(in srgb, var(--background) 88%, transparent)",
              backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)",
              border: "0.5px solid var(--glass-border-lo)",
              boxShadow: "var(--glass-shadow-lg)",
            }}>
            <p className="ios-subhead flex-1" style={{ color: "var(--muted-foreground)" }}>
              <span className="font-semibold text-foreground">{pickedLines.length}</span> product{pickedLines.length !== 1 ? "s" : ""} ·{" "}
              <span className="font-semibold text-foreground">{pickedLines.reduce((a, l) => a + l.qty_cartons, 0)}</span> cartons
            </p>
            <button
              onClick={() => setReviewOpen(true)}
              disabled={creating || pickedLines.length === 0}
              className="h-12 px-5 rounded-xl text-sm font-bold flex items-center gap-2 transition active:scale-95 disabled:opacity-40"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ship className="h-4 w-4" />}
              Review order
            </button>
          </div>
        </div>
      )}

      {/* ── Review before creating the PO ──────────────────────────────────
             Not an "Are you sure?" nag — creating a draft is reversible, and
             confirmation dialogs on routine reversible actions just train you to
             tap through them. This is a REVIEW step: it prevents the accidental
             tap (the bar sits in the thumb zone with lines pre-ticked) AND shows
             what you're actually committing to, including the CBM/container fill
             that decides whether the order is worth shipping yet. */}
      {reviewOpen && (
        <BodyPortal>
          <div className="fixed inset-0 z-[200] snm-scrim-in" style={{ background: "var(--scrim-bg)" }} onClick={() => setReviewOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-[201] snm-sheet-in" style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}>
            <div className="mx-2 mb-2 rounded-3xl overflow-hidden flex flex-col"
              style={{ background: "var(--background)", boxShadow: "var(--glass-shadow-lg)", border: "0.5px solid var(--glass-border-lo)", maxHeight: "82dvh" }}>
              <div className="shrink-0 px-5 pt-3">
                <div className="w-9 h-[3px] rounded-full mx-auto mb-3" style={{ background: "var(--muted-foreground)", opacity: 0.3 }} />
                <h2 className="text-[17px] font-semibold text-foreground">Review this order</h2>
                <p className="ios-subhead mb-3" style={{ color: "var(--muted-foreground)" }}>
                  Creates a draft PO — you still add supplier prices before it&apos;s real.
                </p>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5">
                <div className="rounded-2xl overflow-hidden" style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
                  {pickedLines.map((l) => {
                    const s = skus.find((x) => x.id === l.sku_id);
                    return (
                      <div key={l.sku_id} className="flex items-center justify-between gap-3 px-4 py-2.5"
                        style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                        <p className="ios-subhead text-foreground truncate">
                          {s ? `${s.brand_name} · ${s.model_name} · ${s.variant_display ?? ""}` : l.sku_id}
                        </p>
                        <p className="snm-num ios-subhead font-semibold text-foreground shrink-0">{l.qty_cartons} ctn</p>
                      </div>
                    );
                  })}
                </div>

                {/* Container fill — the number that says "ship now, or add more?" */}
                <div className="rounded-2xl px-4 py-3 mt-3" style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
                  <div className="flex items-center justify-between">
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Total</p>
                    <p className="snm-num ios-subhead font-semibold text-foreground">
                      {pickedLines.length} product{pickedLines.length !== 1 ? "s" : ""} · {pickedLines.reduce((a, l) => a + l.qty_cartons, 0)} ctn
                    </p>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Volume</p>
                    <p className="snm-num ios-subhead font-semibold text-foreground">{pickedCbm.toFixed(2)} CBM</p>
                  </div>
                  {pickedCbm > 0 && (
                    <p className="ios-footnote mt-2" style={{ color: "var(--muted-foreground)" }}>
                      ≈ {Math.round((pickedCbm / CONTAINER_CAPACITY_CBM["20ft"]) * 100)}% of a 20ft ·{" "}
                      {Math.round((pickedCbm / CONTAINER_CAPACITY_CBM["40hq"]) * 100)}% of a 40ft HQ container
                    </p>
                  )}
                </div>
              </div>

              <div className="shrink-0 flex gap-2.5 px-5 pt-3 pb-3">
                <button onClick={() => setReviewOpen(false)}
                  className="flex-1 h-12 rounded-2xl ios-subhead font-semibold"
                  style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}>
                  Back
                </button>
                <button onClick={() => { setReviewOpen(false); createDraft(); }} disabled={creating}
                  className="flex-1 h-12 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                  style={{ background: "var(--foreground)", color: "var(--background)" }}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ship className="h-4 w-4" />}
                  Create draft PO
                </button>
              </div>
            </div>
          </div>
        </BodyPortal>
      )}
    </div>
  );
}

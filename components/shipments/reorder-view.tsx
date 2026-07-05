"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, ClipboardList, AlertTriangle, TrendingDown, PackageCheck, Ship, Check,
} from "lucide-react";
import {
  listReorderSuggestions, type ReorderSuggestion,
} from "@/lib/queries/inventory";
import {
  listSkusFlat, getCurrentUserRole, type SkuFullRow,
} from "@/lib/queries/products";
import {
  createDraftPoFromSuggestions, type DraftPoLine,
} from "@/lib/queries/shipments";
import { SkeletonRows } from "@/components/layout/page-skeleton";
import { haptic } from "@/lib/haptics";

const CARD: React.CSSProperties = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: "var(--glass-shadow), var(--glass-inner)",
  border: "0.5px solid var(--glass-border-lo)",
};

const STATUS: Record<ReorderSuggestion["status"], { label: string; color: string }> = {
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
        if (r.suggested_cartons > 0 && (r.status === "critical" || r.status === "low")) p.add(r.sku_id);
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

  // Split into what to act on vs the rest.
  const toOrder   = rows.filter((r) => r.status === "critical" || r.status === "low");
  const overstock = rows.filter((r) => r.status === "overstock");
  const healthy   = rows.filter((r) => r.status === "ok");

  const pickedLines: DraftPoLine[] = [...picked]
    .map((id) => ({ sku_id: id, qty_cartons: qty[id] ?? 0, cbm_per_carton: cbmFor.get(id) ?? 0 }))
    .filter((l) => l.qty_cartons > 0);

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
                        {on && <Check className="h-3.5 w-3.5" style={{ color: "#fff" }} />}
                      </span>
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-foreground leading-snug">{nameOf(r)}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="snm-num ios-subhead font-medium" style={{ color: st.color }}>
                          {r.dir != null ? `${Math.round(r.dir)}d left` : "no sales data"} · {st.label}
                        </span>
                        <span className="snm-num ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                          {r.stock_cartons} ctn in stock · ~{r.daily_avg_pieces.toFixed(0)} pcs/day
                        </span>
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

      {/* ── Sticky action bar ── */}
      {canWrite && toOrder.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-60 z-30 px-4 pt-3"
          style={{
            paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
            background: "color-mix(in srgb, var(--background) 85%, transparent)",
            backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            borderTop: "0.5px solid var(--glass-border-lo)",
          }}>
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <p className="ios-subhead flex-1" style={{ color: "var(--muted-foreground)" }}>
              <span className="font-semibold text-foreground">{pickedLines.length}</span> product{pickedLines.length !== 1 ? "s" : ""} ·{" "}
              <span className="font-semibold text-foreground">{pickedLines.reduce((a, l) => a + l.qty_cartons, 0)}</span> cartons
            </p>
            <button
              onClick={createDraft}
              disabled={creating || pickedLines.length === 0}
              className="h-12 px-5 rounded-xl text-sm font-bold flex items-center gap-2 transition active:scale-95 disabled:opacity-40"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ship className="h-4 w-4" />}
              Create draft PO
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Search, MapPin, ArrowRight, ClipboardCheck, ArrowLeftRight,
  Check, AlertTriangle, Loader2, History, PackageX,
} from "lucide-react";
import { listSkusFlat, compareSkusForDisplay, getCurrentUserRole, type SkuFullRow } from "@/lib/queries/products";
import { listGodowns, type GodownRow } from "@/lib/queries/masters";
import {
  listStockLevels, type StockLevel,
  recordStockTransfer, recordVerification,
  getStockCountSummary, listStockCountSessions, listStockCountVariance,
  type StockCountSummary, type StockCountSession, type StockCountVariance,
  writeOffStock, type WriteOffReason,
  listRecentWriteoffs, type WriteoffRow,
} from "@/lib/queries/inventory";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { haptic } from "@/lib/haptics";
import { toPieces, type SaleUom } from "@/lib/queries/sales";

/* ── qty helpers (pieces → carton/pack, matches inventory-view) ── */
function toCtns(pcs: number, pcsPerCtn: number) {
  return pcsPerCtn > 0 ? Math.floor(pcs / pcsPerCtn) : 0;
}
function remPacks(pcs: number, pcsPerPack: number, pcsPerCtn: number) {
  const rem = pcsPerCtn > 0 ? pcs % pcsPerCtn : pcs;
  return pcsPerPack > 0 ? Math.floor(rem / pcsPerPack) : 0;
}
function fmtQty(pcs: number, pcsPerPack: number, pcsPerCtn: number) {
  const ctns = toCtns(pcs, pcsPerCtn);
  const packs = remPacks(pcs, pcsPerPack, pcsPerCtn);
  if (ctns > 0 && packs > 0) return `${ctns} ctn + ${packs} pk`;
  if (ctns > 0) return `${ctns} ctn`;
  if (packs > 0) return `${packs} pk`;
  return `${pcs} pcs`;
}
function skuLabel(s: SkuFullRow) {
  return [s.brand_name, s.model_name, s.variant_display].filter(Boolean).join(" · ");
}

// Default to the largest real unit for this product — a diaper carton or
// detergent case, not loose pieces. Falls back down the chain for products
// with no carton tier (packs_per_carton <= 1) or sold as single pieces.
function defaultUnitFor(sku: SkuFullRow): SaleUom {
  if (sku.packs_per_carton > 1) return "carton";
  if (sku.pcs_per_pack > 1) return "pack";
  return "piece";
}

const UOM_LABEL: Record<SaleUom, string> = { carton: "ctn", pack: "pk", piece: "pcs" };

/** Compact segmented Carton/Pack/Piece switch — hides tiers that don't apply
 * to this SKU (e.g. no Carton option if packs_per_carton is 1). */
function UnitToggle({ sku, value, onChange }: { sku: SkuFullRow; value: SaleUom; onChange: (u: SaleUom) => void }) {
  const options: SaleUom[] = [
    ...(sku.packs_per_carton > 1 ? (["carton"] as const) : []),
    ...(sku.pcs_per_pack > 1 ? (["pack"] as const) : []),
    "piece",
  ];
  if (options.length <= 1) return null;
  return (
    <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: "0.5px solid var(--glass-border-lo)" }}>
      {options.map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          className="px-2.5 h-8 ios-subhead font-semibold transition"
          style={{
            background: value === u ? "var(--foreground)" : "transparent",
            color: value === u ? "var(--background)" : "var(--muted-foreground)",
          }}
        >
          {UOM_LABEL[u]}
        </button>
      ))}
    </div>
  );
}

type Tab = "verify" | "transfer" | "writeoff";

/* ════════════════════════════════════════════════════════════════════════ */

export function StockOpsView() {
  const searchParams = useSearchParams();
  // Deep link support: /stock-ops?tab=transfer lands directly on the
  // Transfer tab (used by shortcut links from Inventory/Godowns), while
  // plain /stock-ops still defaults to Verify Count.
  const initialTab: Tab = searchParams.get("tab") === "transfer" ? "transfer"
    : searchParams.get("tab") === "writeoff" ? "writeoff" : "verify";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [levels, setLevels] = useState<StockLevel[]>([]);
  const [loading, setLoading] = useState(true);
  // Stock Ops is all writes — transfers, counts, write-offs. A viewer is
  // read-only, and the database rejects all three, so showing the forms would
  // only hand them buttons that fail. The history panels below stay visible:
  // seeing what was moved, counted and written off is exactly what a viewer
  // is for.
  const [role, setRole] = useState<string | null>(null);
  const canWrite = role !== "viewer" && role !== null;

  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);

  async function reloadLevels() {
    setLevels(await listStockLevels());
  }

  useEffect(() => {
    // Guard against a fast tab-switch away before this resolves — see the
    // same fix in inventory-view.tsx for the full "Load failed" story.
    let cancelled = false;
    Promise.all([listSkusFlat(), listGodowns(), listStockLevels()])
      .then(([s, g, l]) => { if (!cancelled) { setSkus(s); setGodowns(g); setLevels(l); } })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const skuMap = useMemo(() => {
    const m = new Map<string, SkuFullRow>();
    for (const s of skus) m.set(s.id, s);
    return m;
  }, [skus]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse pb-28">
        <div className="h-8 w-40 rounded-xl" style={{ background: "var(--muted)" }} />
        <div className="h-11 rounded-2xl" style={{ background: "var(--muted)" }} />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-2xl" style={{ background: "var(--glass-1)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-28 lg:pb-10">
      <div>
        <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Warehouse</p>
        <h1 className="ios-page-title">Stock Ops</h1>
      </div>

      {/* Tab switch */}
      <div
        className="flex p-1 rounded-2xl"
        style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}
      >
        {([
          { id: "verify", label: "Verify Count", icon: ClipboardCheck },
          { id: "transfer", label: "Transfer", icon: ArrowLeftRight },
          { id: "writeoff", label: "Write-off", icon: PackageX },
        ] as { id: Tab; label: string; icon: typeof Check }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-xl text-[13px] font-semibold transition active:opacity-70"
            style={{
              background: tab === id ? "var(--foreground)" : "transparent",
              color: tab === id ? "var(--background)" : "var(--muted-foreground)",
            }}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {!canWrite && role !== null && (
        <div className="rounded-2xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}>
          <ClipboardCheck className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--muted-foreground)" }} />
          <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
            You have <b>view-only access</b>. You can see stock, counts and write-offs
            here, but not record them.
          </p>
        </div>
      )}

      {tab === "verify" ? (
        <VerifyTab skus={skus} godowns={godowns} levels={levels} onDone={reloadLevels} canWrite={canWrite} />
      ) : tab === "transfer" ? (
        <TransferTab godowns={godowns} levels={levels} skuMap={skuMap} onDone={reloadLevels} canWrite={canWrite} />
      ) : (
        <WriteOffTab godowns={godowns} levels={levels} skuMap={skuMap} onDone={reloadLevels} canWrite={canWrite} />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
/* VERIFY — pre-filled count sheet. The verifier only edits WRONG rows.       */
/* ════════════════════════════════════════════════════════════════════════ */

function VerifyTab({
  skus, godowns, levels, onDone, canWrite,
}: {
  skus: SkuFullRow[]; godowns: GodownRow[]; levels: StockLevel[]; onDone: () => Promise<void>;
  canWrite: boolean;
}) {
  const [godownId, setGodownId] = useState<string>(
    godowns.find((g) => g.is_default)?.id ?? godowns[0]?.id ?? "",
  );
  const [q, setQ] = useState("");
  // counted[sku_id] = what the physical counter typed, in cartons + loose
  // packs — matches how stock is actually counted on a shelf (whole cartons,
  // plus any opened/loose packs), not raw pieces. Undefined = untouched →
  // assumed correct. A blank string in either field means "0" for that unit,
  // not "untouched" — only both-blank counts as untouched for that SKU.
  const [counted, setCounted] = useState<Record<string, { ctn: string; pk: string }>>({});
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Did the counter go through the whole sheet, or just fix a couple of items?
  // Only the counter knows, and only they can say — assuming it would record
  // verification that never happened. This is the denominator that makes
  // record accuracy measurable at all (migration 0108).
  const [checkedEverything, setCheckedEverything] = useState(false);

  // The full count sheet: EVERY active product, pre-filled with the system
  // count for this godown (0 if the system thinks it's empty here). Showing
  // the whole shelf — not just in-stock items — is what makes a physical
  // verification actually work: you can count something UP from 0 (found
  // stock the system didn't know about), not only down. Untouched rows stay
  // as-is on submit, so a long list costs nothing. Search is word-based so it
  // shrugs off the " · " separators and partial terms (e.g. "xtra kering nb",
  // "nbs", or the code all find the same SKU). A surplus is valued by the
  // record_verification RPC at the SKU's last known landed cost, so found
  // stock never breaks the money trail.
  const rows = useMemo(() => {
    const qtyBySku = new Map(
      levels.filter((l) => l.godown_id === godownId).map((l) => [l.sku_id, l.qty_pieces]),
    );
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (s: SkuFullRow) => {
      if (words.length === 0) return true;
      const hay = `${skuLabel(s)} ${s.internal_code ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    return skus
      .filter((s) => s.is_active && matches(s))
      .map((s) => ({ sku: s, expected: qtyBySku.get(s.id) ?? 0 }))
      .sort((a, b) => {
        // In-stock first (the rows you're most likely counting), then the
        // empties — each group in the normal catalogue order.
        const ai = a.expected > 0 ? 0 : 1, bi = b.expected > 0 ? 0 : 1;
        if (ai !== bi) return ai - bi;
        return compareSkusForDisplay(a.sku, b.sku);
      });
  }, [levels, godownId, skus, q]);

  // Reset edits when godown changes.
  useEffect(() => { setCounted({}); }, [godownId]);

  const edits = useMemo(() => {
    const out: { sku: SkuFullRow; expected: number; countedVal: number; delta: number }[] = [];
    for (const r of rows) {
      const raw = counted[r.sku.id];
      if (raw === undefined || (raw.ctn === "" && raw.pk === "")) continue;
      const ctn = Math.max(0, Math.floor(Number(raw.ctn) || 0));
      const pk  = Math.max(0, Math.floor(Number(raw.pk)  || 0));
      const n = ctn * r.sku.pcs_per_pack * r.sku.packs_per_carton + pk * r.sku.pcs_per_pack;
      if (!Number.isFinite(n)) continue;
      const delta = n - r.expected;
      if (delta !== 0) out.push({ sku: r.sku, expected: r.expected, countedVal: n, delta });
    }
    return out;
  }, [rows, counted]);

  async function submit() {
    if (edits.length === 0) {
      toast.error("No differences to record — every count matches the system.");
      return;
    }
    setSaving(true);
    try {
      await recordVerification(
        godownId,
        edits.map((e) => ({ sku_id: e.sku.id, counted_pieces: e.countedVal, reason: "Physical count" })),
        null,
        // Scope = everything shown on the sheet, but only if they say so.
        checkedEverything ? rows.length : undefined,
      );
      await onDone();
      setCounted({});
      setCheckedEverything(false);
      haptic("success");
      const short = edits.filter((e) => e.delta < 0).length;
      const over = edits.filter((e) => e.delta > 0).length;
      toast.success(
        checkedEverything
          ? `Count saved — ${rows.length} items checked, ${edits.length} corrected (${short} short, ${over} extra).`
          : `Correction saved — ${edits.length} item${edits.length !== 1 ? "s" : ""} fixed (${short} short, ${over} extra).`,
      );
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Godown selector */}
      <GodownPicker godowns={godowns} value={godownId} onChange={setGodownId} label="Counting warehouse" />

      {/* Instruction — the whole friction philosophy in one line */}
      <div
        className="rounded-2xl px-4 py-3 flex items-start gap-2.5"
        style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}
      >
        <ClipboardCheck className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--muted-foreground)" }} />
        <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
          Each item shows what the system expects. <b>Only change the ones that are wrong</b> — untouched items stay as-is.
        </p>
      </div>

      {/* Search */}
      <div
        className="flex items-center gap-2.5 px-4 rounded-2xl"
        style={{ background: "var(--glass-1)", height: 46, border: "0.5px solid var(--glass-border-lo)" }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find an item…"
          aria-label="Search items"
          className="flex-1 bg-transparent border-none outline-none ios-subhead text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Count sheet */}
      {rows.length === 0 ? (
        <EmptyState text={q.trim() ? "No products match your search." : "No active products yet — add one in Products first."} />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const pcsPerCtn = r.sku.pcs_per_pack * r.sku.packs_per_carton;
            const hasCtnTier = r.sku.packs_per_carton > 1;
            const hasPkTier  = r.sku.pcs_per_pack > 1;
            // The system count expressed as the ctn/pk split shown in the fields.
            const expCtn = hasCtnTier ? toCtns(r.expected, pcsPerCtn) : 0;
            const expPk  = hasCtnTier
              ? remPacks(r.expected, r.sku.pcs_per_pack, pcsPerCtn)
              : (hasPkTier ? Math.floor(r.expected / r.sku.pcs_per_pack) : r.expected);
            const raw = counted[r.sku.id];
            const touched = raw !== undefined && (raw.ctn !== "" || raw.pk !== "");
            const ctnVal = raw ? Math.max(0, Math.floor(Number(raw.ctn) || 0)) : 0;
            const pkVal  = raw ? Math.max(0, Math.floor(Number(raw.pk)  || 0)) : 0;
            const n = touched ? ctnVal * pcsPerCtn + pkVal * r.sku.pcs_per_pack : r.expected;
            const delta = touched ? n - r.expected : 0;
            // Out of stock in this godown: no delta yet, but the row still
            // wants to stand out. Give it the same warning rim as the
            // dashboard's "out of stock" Needs-Attention card (--snm-error at
            // 35%). Once counted, the delta border below takes over.
            const isOut = r.expected === 0;
            // On first touch of a row, seed the OTHER field with its expected value
            // rather than blank — otherwise editing one field silently reads the
            // untouched field as 0 (e.g. changing cartons alone would drop the
            // system's loose packs, wrongly reporting a shortfall).
            function setField(field: "ctn" | "pk", value: string) {
              setCounted((c) => {
                const prev = c[r.sku.id];
                const base = prev ?? { ctn: hasCtnTier ? String(expCtn) : "", pk: String(expPk) };
                return {
                  ...c,
                  [r.sku.id]: {
                    ctn: field === "ctn" ? value : base.ctn,
                    pk:  field === "pk"  ? value : base.pk,
                  },
                };
              });
            }
            const fieldBg = touched
              ? `color-mix(in srgb, ${delta < 0 ? "var(--snm-error)" : delta > 0 ? "var(--snm-warning)" : "var(--foreground)"} 10%, transparent)`
              : "color-mix(in srgb, var(--foreground) 5%, transparent)";
            return (
              <div
                key={r.sku.id}
                className="rounded-2xl px-4 py-3"
                style={{
                  background: "var(--glass-1)",
                  boxShadow: "var(--glass-shadow), var(--glass-inner)",
                  border: delta !== 0
                    ? `1px solid color-mix(in srgb, ${delta < 0 ? "var(--snm-error)" : "var(--snm-warning)"} 35%, transparent)`
                    : isOut
                      ? "1px solid color-mix(in srgb, var(--snm-error) 35%, transparent)"
                      : "0.5px solid var(--glass-border-lo)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-foreground leading-snug truncate">{skuLabel(r.sku)}</p>
                    <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                      {r.sku.internal_code} · {r.sku.pcs_per_pack}/pk × {r.sku.packs_per_carton}/ctn · <span className="snm-num" style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>system: {fmtQty(r.expected, r.sku.pcs_per_pack, pcsPerCtn)}</span>
                    </p>
                  </div>
                  {/* Count entry — cartons + loose packs, matching how stock
                      is physically counted on a shelf. Falls back to a
                      single field for products with no carton/pack tier. */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasCtnTier && (
                      <div className="flex flex-col items-center">
                        <input
                          type="number" inputMode="numeric"
                          aria-label={`Counted cartons for ${skuLabel(r.sku)}`}
                          placeholder={String(toCtns(r.expected, pcsPerCtn))}
                          value={raw?.ctn ?? ""}
                          onChange={(e) => setField("ctn", e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="w-14 h-12 rounded-xl text-center text-[16px] font-semibold text-foreground outline-none"
                          style={{ background: fieldBg, border: "1px solid var(--glass-border-lo)" }}
                        />
                        <span className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>ctn</span>
                      </div>
                    )}
                    {hasPkTier && (
                      <div className="flex flex-col items-center">
                        <input
                          type="number" inputMode="numeric"
                          aria-label={`Counted ${hasCtnTier ? "loose packs" : "packs"} for ${skuLabel(r.sku)}`}
                          placeholder={String(hasCtnTier ? remPacks(r.expected, r.sku.pcs_per_pack, pcsPerCtn) : Math.floor(r.expected / r.sku.pcs_per_pack))}
                          value={raw?.pk ?? ""}
                          onChange={(e) => setField("pk", e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="w-14 h-12 rounded-xl text-center text-[16px] font-semibold text-foreground outline-none"
                          style={{ background: fieldBg, border: "1px solid var(--glass-border-lo)" }}
                        />
                        <span className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>pk</span>
                      </div>
                    )}
                    {!hasCtnTier && !hasPkTier && (
                      <div className="flex flex-col items-center">
                        <input
                          type="number" inputMode="numeric"
                          aria-label={`Counted pieces for ${skuLabel(r.sku)}`}
                          placeholder={String(r.expected)}
                          value={raw?.pk ?? ""}
                          onChange={(e) => setField("pk", e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="w-16 h-12 rounded-xl text-center text-[16px] font-semibold text-foreground outline-none"
                          style={{ background: fieldBg, border: "1px solid var(--glass-border-lo)" }}
                        />
                        <span className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>pcs</span>
                      </div>
                    )}
                  </div>
                </div>
                {delta !== 0 && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <AlertTriangle className="h-3 w-3" style={{ color: delta < 0 ? "var(--snm-error)" : "var(--snm-warning)" }} />
                    <p className="snm-num ios-subhead font-semibold" style={{ color: delta < 0 ? "var(--snm-error)" : "var(--snm-warning)" }}>
                      {delta < 0 ? `${fmtQty(-delta, r.sku.pcs_per_pack, pcsPerCtn)} short` : `${fmtQty(delta, r.sku.pcs_per_pack, pcsPerCtn)} extra`} — will adjust to {fmtQty(n, r.sku.pcs_per_pack, pcsPerCtn)}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* History toggle */}
      <button
        onClick={() => setShowHistory((s) => !s)}
        className="w-full flex items-center justify-center gap-1.5 min-h-[44px] ios-subhead font-medium active:opacity-70"
        style={{ color: "var(--muted-foreground)" }}
      >
        <History className="h-3.5 w-3.5" />
        {showHistory ? "Hide count results" : "Count results"}
      </button>
      {showHistory && <VerificationHistory />}

      {/* Sticky submit bar — only shows when there are changes */}
      {edits.length > 0 && (
        <div
          className="fixed left-0 right-0 z-30 px-4"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 76px)" }}
        >
          <div className="max-w-2xl mx-auto space-y-2">
            {/* Asked, never assumed. Ticking this is what turns a correction
                into a measurable count — it records that all {rows.length}
                items on the sheet were actually looked at, including the ones
                that were already right. */}
            <button
              onClick={() => setCheckedEverything((v) => !v)}
              className="w-full flex items-center gap-2.5 rounded-2xl px-4 py-3 text-left"
              style={{
                background: "var(--glass-1)",
                border: checkedEverything
                  ? "1px solid color-mix(in srgb, var(--snm-success) 45%, transparent)"
                  : "0.5px solid var(--glass-border-lo)",
                boxShadow: "var(--glass-shadow), var(--glass-inner)",
              }}
            >
              <span className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center"
                style={{
                  background: checkedEverything ? "var(--snm-success)" : "transparent",
                  border: checkedEverything ? "none" : "1.5px solid var(--muted-foreground)",
                }}>
                {checkedEverything && <Check className="h-3.5 w-3.5" style={{ color: "var(--background)" }} />}
              </span>
              <span className="min-w-0">
                <span className="block ios-subhead font-semibold text-foreground">
                  I checked every item ({rows.length})
                </span>
                <span className="block ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                  {checkedEverything
                    ? "Counts as a full count — your record accuracy gets measured"
                    : "Leave unticked if you only fixed specific items"}
                </span>
              </span>
            </button>

            <button
              onClick={submit}
              disabled={saving || !canWrite}
              className="w-full h-13 rounded-2xl flex items-center justify-center gap-2 text-[15px] font-semibold active:opacity-80 disabled:opacity-60"
              style={{ background: "var(--foreground)", color: "var(--background)", height: 52, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}
            >
              {saving ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Check className="h-4.5 w-4.5" />}
              {checkedEverything
                ? `Save count — ${rows.length} checked, ${edits.length} corrected`
                : `Save correction${edits.length !== 1 ? "s" : ""} — ${edits.length} item${edits.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
/* TRANSFER — move stock godown → godown                                      */
/* ════════════════════════════════════════════════════════════════════════ */

function TransferTab({
  godowns, levels, skuMap, onDone, canWrite,
}: {
  godowns: GodownRow[]; levels: StockLevel[];
  skuMap: Map<string, SkuFullRow>; onDone: () => Promise<void>;
  canWrite: boolean;
}) {
  const [fromId, setFromId] = useState<string>(godowns.find((g) => g.is_default)?.id ?? godowns[0]?.id ?? "");
  const [toId, setToId] = useState<string>(godowns.find((g) => !g.is_default)?.id ?? godowns[1]?.id ?? "");
  const [skuId, setSkuId] = useState<string>("");
  const [q, setQ] = useState("");
  const [qty, setQty] = useState("");
  // Unit the qty field is entered in — defaults per-SKU (carton for
  // multi-pack-per-carton products like diapers, pack for single-carton
  // products, piece only as a last resort) when a SKU is picked.
  const [unit, setUnit] = useState<SaleUom>("piece");
  const [saving, setSaving] = useState(false);

  // SKUs available in the source godown, with their available qty.
  const available = useMemo(() => {
    const inFrom = levels.filter((l) => l.godown_id === fromId && l.qty_pieces > 0);
    const list = inFrom
      .map((l) => { const s = skuMap.get(l.sku_id); return s ? { sku: s, avail: l.qty_pieces } : null; })
      .filter((x): x is { sku: SkuFullRow; avail: number } => x !== null);
    const term = q.trim().toLowerCase();
    const filtered = term
      ? list.filter((r) => skuLabel(r.sku).toLowerCase().includes(term) || (r.sku.internal_code ?? "").toLowerCase().includes(term))
      : list;
    return filtered.sort((a, b) => compareSkusForDisplay(a.sku, b.sku));
  }, [levels, fromId, skuMap, q]);

  const selected = skuId ? skuMap.get(skuId) : undefined;
  const availForSelected = skuId ? (levels.find((l) => l.godown_id === fromId && l.sku_id === skuId)?.qty_pieces ?? 0) : 0;
  // qty is entered in `unit` (carton/pack/piece) — converted to pieces here,
  // the only unit the database and RPC ever see.
  const qtyEnteredNum = Math.max(0, Math.floor(Number(qty) || 0));
  const qtyNum = selected ? toPieces(unit, qtyEnteredNum, selected.pcs_per_pack, selected.packs_per_carton) : 0;
  const overAvailable = qtyNum > availForSelected;
  const sameGodown = fromId === toId;
  const canSubmit = !!skuId && qtyEnteredNum > 0 && !overAvailable && !sameGodown && !saving;

  function pickSku(id: string) {
    // Tapping the already-selected item deselects it — previously there was
    // no way to back out of a pick short of switching godowns.
    if (id === skuId) { setSkuId(""); setQty(""); return; }
    setSkuId(id);
    setQty("");
    const sku = skuMap.get(id);
    if (sku) setUnit(defaultUnitFor(sku));
  }

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await recordStockTransfer({ sku_id: skuId, from_godown_id: fromId, to_godown_id: toId, qty_pieces: qtyNum });
      await onDone();
      setSkuId(""); setQty(""); setQ("");
      haptic("success");
      toast.success("Stock transferred.");
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* From → To */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <GodownPicker godowns={godowns} value={fromId} onChange={(v) => { setFromId(v); setSkuId(""); }} label="From" />
        <div className="flex items-center justify-center h-12">
          <ArrowRight className="h-5 w-5" style={{ color: "var(--muted-foreground)" }} />
        </div>
        <GodownPicker godowns={godowns} value={toId} onChange={setToId} label="To" />
      </div>
      {sameGodown && (
        <p className="ios-subhead px-1" style={{ color: "var(--snm-error)" }}>
          Pick two different warehouses.
        </p>
      )}

      {/* SKU picker */}
      <div
        className="flex items-center gap-2.5 px-4 rounded-2xl"
        style={{ background: "var(--glass-1)", height: 46, border: "0.5px solid var(--glass-border-lo)" }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find item to move…"
          aria-label="Search items to transfer"
          className="flex-1 bg-transparent border-none outline-none ios-subhead text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Qty + submit — shown immediately once an item is picked, right
          below the search bar. Previously this rendered AFTER the scrollable
          SKU list (which can be 30+ items), so picking an item near the top
          left the qty field scrolled off-screen below the entire list —
          it looked like there was no way to enter a quantity at all. */}
      {selected && (() => {
        const pcsPerCtn = selected.pcs_per_pack * selected.packs_per_carton;
        return (
        <div
          className="rounded-2xl p-4 space-y-3"
          style={{ background: "var(--glass-1)", border: "1px solid color-mix(in srgb, var(--snm-brand) 35%, transparent)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="ios-subhead font-semibold text-foreground truncate">{skuLabel(selected)}</p>
              <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                {selected.pcs_per_pack}/pk × {selected.packs_per_carton}/ctn
              </p>
            </div>
            <p className="snm-num ios-subhead shrink-0" style={{ color: "var(--muted-foreground)" }}>
              {fmtQty(availForSelected, selected.pcs_per_pack, pcsPerCtn)} avail
            </p>
          </div>
          <div className="flex items-center justify-between">
            <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>Qty to move</p>
            <UnitToggle sku={selected} value={unit} onChange={(u) => setUnit(u)} />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder={`${UOM_LABEL[unit]} to move`}
              aria-label={`${unit === "carton" ? "Cartons" : unit === "pack" ? "Packs" : "Pieces"} to transfer`}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="flex-1 h-12 rounded-xl px-4 text-[16px] font-semibold text-foreground outline-none"
              style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: `1px solid ${overAvailable ? "color-mix(in srgb, var(--snm-error) 45%, transparent)" : "var(--glass-border-lo)"}` }}
            />
            <button
              onClick={() => {
                // Fill "everything available" in the CURRENT unit when it divides
                // evenly (the normal case — stock arrives in whole cartons/packs),
                // so the field keeps showing cartons, not a raw piece count. Only
                // drop to pieces if there's an odd remainder that can't be expressed
                // in the chosen unit.
                const per = unit === "carton" ? pcsPerCtn : unit === "pack" ? selected.pcs_per_pack : 1;
                if (per > 0 && availForSelected % per === 0) {
                  setQty(String(availForSelected / per));
                } else {
                  setUnit("piece");
                  setQty(String(availForSelected));
                }
              }}
              className="h-12 px-4 rounded-xl ios-subhead font-semibold active:opacity-70"
              style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--foreground)" }}
            >
              All
            </button>
          </div>
          {/* No piece echo: the field above already states the trade unit,
              and diapers are never counted in pieces on screen. */}
          {overAvailable && (
            <p className="ios-subhead" style={{ color: "var(--snm-error)" }}>
              Only {fmtQty(availForSelected, selected.pcs_per_pack, pcsPerCtn)} available to move.
            </p>
          )}
          <button
            onClick={submit}
            disabled={!canSubmit || !canWrite}
            className="w-full h-13 rounded-2xl flex items-center justify-center gap-2 text-[15px] font-semibold active:opacity-80 disabled:opacity-50"
            style={{ background: "var(--foreground)", color: "var(--background)", height: 52 }}
          >
            {saving ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <ArrowLeftRight className="h-4.5 w-4.5" />}
            Move stock
          </button>
        </div>
        );
      })()}

      {available.length === 0 ? (
        <EmptyState text="No stock in the source warehouse." />
      ) : (
        <div className="space-y-2 max-h-[46vh] overflow-y-auto overscroll-contain">
          {available.map((r) => {
            const pcsPerCtn = r.sku.pcs_per_pack * r.sku.packs_per_carton;
            const active = skuId === r.sku.id;
            return (
              <button
                key={r.sku.id}
                onClick={() => pickSku(r.sku.id)}
                className="w-full text-left rounded-2xl px-4 py-3 flex items-center gap-3 active:opacity-70"
                style={{
                  background: "var(--glass-1)",
                  border: active
                    ? "1px solid color-mix(in srgb, var(--snm-brand) 45%, transparent)"
                    : "0.5px solid var(--glass-border-lo)",
                }}
              >
                <div
                  className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
                  style={{ border: active ? "none" : "1.5px solid var(--glass-border-lo)", background: active ? "var(--snm-brand)" : "transparent" }}
                >
                  {active && <Check className="h-3 w-3" style={{ color: "var(--snm-brand-on)" }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-foreground truncate">{skuLabel(r.sku)}</p>
                  <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    {/* Same brand/model/size can exist as two different SKUs with
                        different pack configs (e.g. Xtra Kering XXXL 34/pk vs
                        44/pk) — without this they're visually identical and
                        impossible to tell apart when picking one to move. */}
                    {r.sku.pcs_per_pack}/pk × {r.sku.packs_per_carton}/ctn · {fmtQty(r.avail, r.sku.pcs_per_pack, pcsPerCtn)} available
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Write-off (damaged / expired / lost) — reason-coded shrinkage              */
/* ════════════════════════════════════════════════════════════════════════ */

function WriteOffTab({
  godowns, levels, skuMap, onDone, canWrite,
}: {
  godowns: GodownRow[]; levels: StockLevel[];
  skuMap: Map<string, SkuFullRow>; onDone: () => Promise<void>;
  canWrite: boolean;
}) {
  const [godownId, setGodownId] = useState<string>(godowns.find((g) => g.is_default)?.id ?? godowns[0]?.id ?? "");
  const [skuId, setSkuId] = useState<string>("");
  const [q, setQ] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<SaleUom>("piece");
  const [reason, setReason] = useState<WriteOffReason>("damaged");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<WriteoffRow[]>([]);

  function loadHistory() { listRecentWriteoffs(30).then(setHistory).catch(() => {}); }
  useEffect(() => { loadHistory(); }, []);

  const available = useMemo(() => {
    const inG = levels.filter((l) => l.godown_id === godownId && l.qty_pieces > 0);
    const list = inG
      .map((l) => { const s = skuMap.get(l.sku_id); return s ? { sku: s, avail: l.qty_pieces } : null; })
      .filter((x): x is { sku: SkuFullRow; avail: number } => x !== null);
    const term = q.trim().toLowerCase();
    const filtered = term
      ? list.filter((r) => skuLabel(r.sku).toLowerCase().includes(term) || (r.sku.internal_code ?? "").toLowerCase().includes(term))
      : list;
    return filtered.sort((a, b) => compareSkusForDisplay(a.sku, b.sku));
  }, [levels, godownId, skuMap, q]);

  const selected = skuId ? skuMap.get(skuId) : undefined;
  const availForSelected = skuId ? (levels.find((l) => l.godown_id === godownId && l.sku_id === skuId)?.qty_pieces ?? 0) : 0;
  const qtyEnteredNum = Math.max(0, Math.floor(Number(qty) || 0));
  const qtyNum = selected ? toPieces(unit, qtyEnteredNum, selected.pcs_per_pack, selected.packs_per_carton) : 0;
  const overAvailable = qtyNum > availForSelected;
  const canSubmit = !!skuId && qtyEnteredNum > 0 && !overAvailable && !saving;

  function pickSku(id: string) {
    if (id === skuId) { setSkuId(""); setQty(""); return; }
    setSkuId(id); setQty("");
    const sku = skuMap.get(id); if (sku) setUnit(defaultUnitFor(sku));
  }

  async function submit() {
    if (!canSubmit || !selected) return;
    setSaving(true);
    try {
      const loss = await writeOffStock({ sku_id: skuId, godown_id: godownId, qty_pieces: qtyNum, reason, notes });
      await onDone();
      loadHistory();
      setSkuId(""); setQty(""); setQ(""); setNotes(""); setConfirming(false);
      haptic("success");
      toast.success(`Written off — MVR ${loss.toLocaleString(undefined, { maximumFractionDigits: 2 })} recorded as a loss.`);
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const reasons: { v: WriteOffReason; l: string }[] = [
    { v: "damaged", l: "Damaged" },
    { v: "expired", l: "Expired" },
    { v: "lost", l: "Lost / missing" },
    { v: "other", l: "Other" },
  ];

  return (
    <div className="space-y-3">
      <GodownPicker godowns={godowns} value={godownId} onChange={(v) => { setGodownId(v); setSkuId(""); }} label="Warehouse" />
      <p className="ios-footnote px-1" style={{ color: "var(--muted-foreground)" }}>
        Removes unsellable stock and records its landed cost as a loss in your P&amp;L. Admin/manager only.
      </p>

      <div
        className="flex items-center gap-2.5 px-4 rounded-2xl"
        style={{ background: "var(--glass-1)", height: 46, border: "0.5px solid var(--glass-border-lo)" }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find the damaged item…"
          aria-label="Search items to write off"
          className="flex-1 bg-transparent border-none outline-none ios-subhead text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {selected && (() => {
        const pcsPerCtn = selected.pcs_per_pack * selected.packs_per_carton;
        return (
          <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--glass-1)", border: "1px solid color-mix(in srgb, var(--snm-error) 35%, transparent)" }}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="ios-subhead font-semibold text-foreground truncate">{skuLabel(selected)}</p>
                <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>{selected.pcs_per_pack}/pk × {selected.packs_per_carton}/ctn</p>
              </div>
              <p className="snm-num ios-subhead shrink-0" style={{ color: "var(--muted-foreground)" }}>
                {fmtQty(availForSelected, selected.pcs_per_pack, pcsPerCtn)} on hand
              </p>
            </div>

            {/* Reason code — reason-coded shrinkage is the standard */}
            <div className="flex flex-wrap gap-1.5">
              {reasons.map((r) => (
                <button key={r.v} onClick={() => setReason(r.v)}
                  className="px-3 py-1.5 rounded-full ios-subhead font-semibold transition"
                  style={{ background: reason === r.v ? "var(--foreground)" : "var(--glass-bg-2)", color: reason === r.v ? "var(--background)" : "var(--muted-foreground)", border: reason === r.v ? "none" : "0.5px solid var(--glass-border-lo)" }}>
                  {r.l}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>Qty to write off</p>
              <UnitToggle sku={selected} value={unit} onChange={(u) => setUnit(u)} />
            </div>
            <input
              type="number" inputMode="numeric"
              placeholder={`How many ${unit === "carton" ? "cartons" : unit === "pack" ? "packs" : "pieces"}?`}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="w-full h-12 rounded-xl px-4 text-[16px] font-semibold text-foreground outline-none"
              style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: `1px solid ${overAvailable ? "color-mix(in srgb, var(--snm-error) 45%, transparent)" : "var(--glass-border-lo)"}` }}
            />
            {/* No piece echo — see the note in the transfer panel above. */}
            {overAvailable && (
              <p className="ios-subhead" style={{ color: "var(--snm-error)" }}>Only {fmtQty(availForSelected, selected.pcs_per_pack, pcsPerCtn)} on hand here.</p>
            )}

            <input
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Note (optional) — e.g. torn in transit"
              className="w-full h-11 rounded-xl px-3 ios-subhead text-foreground outline-none"
              style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}
            />

            <button
              onClick={() => setConfirming(true)}
              disabled={!canSubmit || !canWrite}
              className="w-full rounded-2xl flex items-center justify-center gap-2 text-[15px] font-semibold active:opacity-80 disabled:opacity-50"
              style={{ background: "var(--snm-error)", color: "#fff", height: 52 }}
            >
              <PackageX className="h-4.5 w-4.5" /> Write off stock
            </button>
          </div>
        );
      })()}

      {/* Recent write-offs — makes the P&L "Damaged & write-offs" loss
          explainable: what, how much, why, when. Quantities in packs/cartons. */}
      {history.length > 0 && (
        <div className="pt-2">
          <p className="label-caps text-[12px] mb-2 px-1" style={{ color: "var(--muted-foreground)" }}>Recent write-offs</p>
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)" }}>
            {history.map((w, i) => {
              const ppc = w.pcs_per_carton || 0;
              const qtyLabel = ppc > 0 && w.qty_pieces >= ppc
                ? `${Math.round(w.qty_pieces / ppc)} ctn`
                : w.pcs_per_pack > 0 ? `${Math.max(1, Math.round(w.qty_pieces / w.pcs_per_pack))} pk` : `${w.qty_pieces} pcs`;
              const rawReason = (w.reason ?? "").trim();
              const reasonWord = rawReason.split(":")[0] || "written off";
              const note = rawReason.includes(":") ? rawReason.slice(rawReason.indexOf(":") + 1).trim() : "";
              return (
                <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{ borderTop: i > 0 ? "0.5px solid var(--glass-border-lo)" : undefined }}>
                  <div className="min-w-0">
                    <p className="ios-subhead font-semibold text-foreground truncate">
                      {[w.brand_name, w.model_name, w.variant_display].filter(Boolean).join(" · ")}
                    </p>
                    <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                      {qtyLabel} · {reasonWord}{note ? ` — ${note}` : ""} · {new Date(w.created_at).toLocaleDateString("en-MV", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <p className="snm-num ios-subhead font-semibold shrink-0" style={{ color: "var(--snm-error)" }}>
                    −MVR {Number(w.cost_mvr).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {available.length === 0 ? (
        <EmptyState text="No stock in this warehouse to write off." />
      ) : (
        <div className="space-y-2 max-h-[42vh] overflow-y-auto overscroll-contain">
          {available.map((r) => {
            const pcsPerCtn = r.sku.pcs_per_pack * r.sku.packs_per_carton;
            const active = skuId === r.sku.id;
            return (
              <button
                key={r.sku.id}
                onClick={() => pickSku(r.sku.id)}
                className="w-full text-left rounded-2xl px-4 py-3 flex items-center gap-3 active:opacity-70"
                style={{ background: "var(--glass-1)", border: active ? "1px solid color-mix(in srgb, var(--snm-error) 45%, transparent)" : "0.5px solid var(--glass-border-lo)" }}
              >
                <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center" style={{ border: active ? "none" : "1.5px solid var(--glass-border-lo)", background: active ? "var(--snm-error)" : "transparent" }}>
                  {active && <Check className="h-3 w-3" style={{ color: "#fff" }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-foreground truncate">{skuLabel(r.sku)}</p>
                  <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    {r.sku.pcs_per_pack}/pk × {r.sku.packs_per_carton}/ctn · {fmtQty(r.avail, r.sku.pcs_per_pack, pcsPerCtn)} on hand
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={submit}
        loading={saving}
        title="Write off this stock?"
        message={selected ? `${qtyEnteredNum} ${UOM_LABEL[unit].toLowerCase()} of ${skuLabel(selected)} (${reason}) will be removed and its cost booked as a loss in your P&L. This can't be undone here.` : ""}
        confirmLabel="Write off"
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Shared bits                                                                */
/* ════════════════════════════════════════════════════════════════════════ */

function GodownPicker({
  godowns, value, onChange, label,
}: {
  godowns: GodownRow[]; value: string; onChange: (v: string) => void; label: string;
}) {
  return (
    <div>
      <p className="label-caps text-[12px] mb-1.5" style={{ color: "var(--muted-foreground)" }}>{label}</p>
      <div className="relative">
        <MapPin className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="w-full h-12 rounded-2xl pl-10 pr-4 text-[14px] font-semibold text-foreground appearance-none outline-none"
          style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)" }}
        >
          {godowns.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl p-10 flex flex-col items-center text-center gap-2" style={{ background: "var(--glass-1)" }}>
      <MapPin className="h-6 w-6" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
      <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{text}</p>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
/* COUNT RESULTS — what the counting actually told us.                        */
/*                                                                            */
/* The old panel listed date, godown, items counted, net pieces. Three things  */
/* were missing, and they are the reasons you count at all:                    */
/*   · the variance in MONEY — "net -152 pcs" is not a number anyone can act on */
/*   · ABSOLUTE variance next to net, because netting is how error hides: one   */
/*     session had -152 on one SKU and +126 on another, so the net read like a  */
/*     tidy -26 while BOTH records were wrong                                   */
/*   · accuracy — lines right / lines counted — the standard cycle-count KPI,   */
/*     and the one number that says whether the stock records can be trusted    */
/* Plus the question a per-session list can never answer: which products keep   */
/* drifting. A SKU wrong count after count is a process problem, not a counting */
/* problem.                                                                     */
/* ════════════════════════════════════════════════════════════════════════ */

function fmtMoney(n: number) {
  return Number(n).toLocaleString("en-MV", { maximumFractionDigits: 0 });
}

function VerificationHistory() {
  const [summary, setSummary]   = useState<StockCountSummary | null>(null);
  const [sessions, setSessions] = useState<StockCountSession[] | null>(null);
  const [variance, setVariance] = useState<StockCountVariance[]>([]);
  const [view, setView]         = useState<"products" | "counts">("products");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getStockCountSummary(), listStockCountSessions(), listStockCountVariance()])
      .then(([sum, sess, va]) => {
        if (cancelled) return;
        setSummary(sum); setSessions(sess); setVariance(va);
      })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  if (sessions === null || summary === null) {
    return <div className="h-12 rounded-2xl animate-pulse" style={{ background: "var(--glass-1)" }} />;
  }
  if (sessions.length === 0) {
    return <EmptyState text="No counts recorded yet." />;
  }

  const acc = summary.accuracy_pct;
  const accColor = acc == null ? "var(--muted-foreground)"
    : acc >= 95 ? "var(--snm-success)"
    : acc >= 80 ? "var(--snm-warning)"
    : "var(--snm-error)";

  return (
    <div className="space-y-3">
      {/* Headline.
          Accuracy is shown ONLY when it is real. The count sheet submits just
          the rows that were CHANGED, so a session that corrects one item
          stores one line, and that line is by definition wrong — computing
          accuracy from it forces a permanent 0%, which is what shipped in
          0107 and told Ali his records were perfectly wrong while measuring
          nothing. Until a session records how many items were actually
          checked, this says so plainly instead of inventing a number. The
          money figures below are exact either way — they come from real
          differences valued at landed cost. */}
      <div className="rounded-2xl p-4" style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)" }}>
        {acc != null ? (
          <>
            <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>
              Stock record accuracy
            </p>
            <p className="snm-num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: accColor }}>
              {acc}%
            </p>
            <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              {summary.items_checked - summary.lines_adjusted} of {summary.items_checked} checked item
              {summary.items_checked !== 1 ? "s" : ""} matched the books · {summary.full_counts} full count
              {summary.full_counts !== 1 ? "s" : ""}
            </p>
          </>
        ) : (
          <>
            <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>
              Stock corrections
            </p>
            <p className="snm-num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--foreground)" }}>
              {summary.lines_adjusted}
            </p>
            <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              across {summary.sessions} session{summary.sessions !== 1 ? "s" : ""} — each one fixed a
              specific item rather than counting the whole warehouse
            </p>
          </>
        )}

        <div className="grid grid-cols-2 gap-3 mt-4 pt-4" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
          <div>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
              Net effect
            </p>
            <p className="snm-num ios-subhead font-semibold mt-0.5"
              style={{ color: summary.net_value_mvr < 0 ? "var(--snm-error)" : "var(--snm-success)" }}>
              {summary.net_value_mvr < 0 ? "\u2212" : "+"}MVR {fmtMoney(Math.abs(summary.net_value_mvr))}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
              Total error
            </p>
            <p className="snm-num ios-subhead font-semibold mt-0.5 text-foreground">
              MVR {fmtMoney(summary.abs_value_mvr)}
            </p>
          </div>
        </div>
        {summary.abs_value_mvr > Math.abs(summary.net_value_mvr) * 1.5 && (
          <p className="ios-footnote mt-2.5" style={{ color: "var(--muted-foreground)", lineHeight: 1.45 }}>
            Losses and gains partly cancel out. The books were wrong by MVR{" "}
            {fmtMoney(summary.abs_value_mvr)} in total, even though the net comes to MVR{" "}
            {fmtMoney(Math.abs(summary.net_value_mvr))}.
          </p>
        )}
        {acc == null && (
          <p className="ios-footnote mt-2.5" style={{ color: "var(--muted-foreground)", lineHeight: 1.45 }}>
            How accurate your stock records are can&rsquo;t be worked out from these —
            only the items you corrected were recorded, so there is nothing to compare
            them against. Tick <b>&ldquo;I checked every item&rdquo;</b> on your next count
            and it starts being measured.
          </p>
        )}
      </div>

      {/* Toggle */}
      <div className="flex gap-1" style={{ background: "var(--glass-bg-1)", borderRadius: 12, padding: 4 }}>
        {([["products", "By product"], ["counts", "Each count"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)}
            className="flex-1 rounded-[9px] py-2 text-[12.5px] font-semibold transition"
            style={{ background: view === v ? "var(--foreground)" : "transparent",
                     color: view === v ? "var(--background)" : "var(--muted-foreground)" }}>
            {label}
          </button>
        ))}
      </div>

      {view === "products" ? (
        variance.length === 0 ? (
          <EmptyState text="Every counted item matched the books." />
        ) : (
          <div className="space-y-2">
            {variance.map((r) => {
              const repeat = r.times_wrong > 1;
              return (
                <div key={r.sku_id} className="rounded-2xl px-4 py-3"
                  style={{
                    background: "var(--glass-1)",
                    border: repeat
                      ? "1px solid color-mix(in srgb, var(--snm-error) 35%, transparent)"
                      : "0.5px solid var(--glass-border-lo)",
                  }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="ios-subhead font-semibold text-foreground truncate">
                        {r.brand_name} · {r.model_name}
                        <span className="font-normal" style={{ color: "var(--muted-foreground)" }}>
                          {" "}· {r.variant_display ?? "—"}
                        </span>
                      </p>
                      <p className="ios-footnote mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                        Wrong {r.times_wrong} of {r.times_counted} count{r.times_counted !== 1 ? "s" : ""}
                        {repeat ? " · keeps drifting" : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="snm-num ios-subhead font-semibold"
                        style={{ color: r.net_value_mvr < 0 ? "var(--snm-error)" : "var(--snm-success)" }}>
                        {r.net_value_mvr < 0 ? "−" : "+"}MVR {fmtMoney(Math.abs(r.net_value_mvr))}
                      </p>
                      <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
                        MVR {fmtMoney(r.abs_value_mvr)} error
                      </p>
                    </div>
                  </div>
                  {repeat && (
                    <p className="ios-footnote mt-2" style={{ color: "var(--snm-error)" }}>
                      Wrong every time it&apos;s counted — worth checking how it&apos;s picked and recorded,
                      not just recounting it.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const clean = s.lines_discrepant === 0;
            const date = new Date(s.verified_at).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "2-digit" });
            return (
              <div key={s.session_id} className="rounded-2xl px-4 py-3 flex items-center justify-between"
                style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)" }}>
                <div className="min-w-0">
                  <p className="ios-subhead font-semibold text-foreground">{s.godown_name}</p>
                  <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                    {date} · {s.lines_total} item{s.lines_total !== 1 ? "s" : ""} · {s.counted_by}
                  </p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  {clean ? (
                    <span className="ios-subhead font-semibold" style={{ color: "var(--snm-success)" }}>All matched</span>
                  ) : (
                    <>
                      <p className="snm-num ios-subhead font-semibold"
                        style={{ color: s.net_value_mvr < 0 ? "var(--snm-error)" : "var(--snm-success)" }}>
                        {s.net_value_mvr < 0 ? "−" : "+"}MVR {fmtMoney(Math.abs(s.net_value_mvr))}
                      </p>
                      <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                        {s.lines_discrepant} of {s.lines_total} corrected
                      </p>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

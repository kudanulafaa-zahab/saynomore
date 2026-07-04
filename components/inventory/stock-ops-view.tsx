"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Search, MapPin, ArrowRight, ClipboardCheck, ArrowLeftRight,
  Check, AlertTriangle, Loader2, History,
} from "lucide-react";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { listGodowns, type GodownRow } from "@/lib/queries/masters";
import {
  listStockLevels, type StockLevel,
  recordStockTransfer, recordVerification,
  listVerificationHistory, type VerificationSession,
} from "@/lib/queries/inventory";

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

type Tab = "verify" | "transfer";

/* ════════════════════════════════════════════════════════════════════════ */

export function StockOpsView() {
  const [tab, setTab] = useState<Tab>("verify");
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [levels, setLevels] = useState<StockLevel[]>([]);
  const [loading, setLoading] = useState(true);

  async function reloadLevels() {
    setLevels(await listStockLevels());
  }

  useEffect(() => {
    Promise.all([listSkusFlat(), listGodowns(), listStockLevels()])
      .then(([s, g, l]) => { setSkus(s); setGodowns(g); setLevels(l); })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
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
        ] as { id: Tab; label: string; icon: typeof Check }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl text-[14px] font-semibold transition active:opacity-70"
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

      {tab === "verify" ? (
        <VerifyTab skus={skus} godowns={godowns} levels={levels} onDone={reloadLevels} />
      ) : (
        <TransferTab skus={skus} godowns={godowns} levels={levels} skuMap={skuMap} onDone={reloadLevels} />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
/* VERIFY — pre-filled count sheet. The verifier only edits WRONG rows.       */
/* ════════════════════════════════════════════════════════════════════════ */

function VerifyTab({
  skus, godowns, levels, onDone,
}: {
  skus: SkuFullRow[]; godowns: GodownRow[]; levels: StockLevel[]; onDone: () => Promise<void>;
}) {
  const [godownId, setGodownId] = useState<string>(
    godowns.find((g) => g.is_default)?.id ?? godowns[0]?.id ?? "",
  );
  const [q, setQ] = useState("");
  // counted[sku_id] = string the user typed (undefined = untouched → assumed correct)
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Every SKU that has stock in this godown, pre-filled with system count.
  const rows = useMemo(() => {
    const inGodown = levels.filter((l) => l.godown_id === godownId && l.qty_pieces > 0);
    const list = inGodown
      .map((l) => {
        const sku = skus.find((s) => s.id === l.sku_id);
        return sku ? { sku, expected: l.qty_pieces } : null;
      })
      .filter((x): x is { sku: SkuFullRow; expected: number } => x !== null);
    const term = q.trim().toLowerCase();
    const filtered = term
      ? list.filter((r) => skuLabel(r.sku).toLowerCase().includes(term) || (r.sku.internal_code ?? "").toLowerCase().includes(term))
      : list;
    return filtered.sort((a, b) => skuLabel(a.sku).localeCompare(skuLabel(b.sku)));
  }, [levels, godownId, skus, q]);

  // Reset edits when godown changes.
  useEffect(() => { setCounted({}); }, [godownId]);

  const edits = useMemo(() => {
    const out: { sku: SkuFullRow; expected: number; countedVal: number; delta: number }[] = [];
    for (const r of rows) {
      const raw = counted[r.sku.id];
      if (raw === undefined || raw === "") continue;
      const n = Math.max(0, Math.floor(Number(raw)));
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
      );
      await onDone();
      setCounted({});
      const short = edits.filter((e) => e.delta < 0).length;
      const over = edits.filter((e) => e.delta > 0).length;
      toast.success(`Count saved — ${edits.length} corrected (${short} short, ${over} extra).`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const godown = godowns.find((g) => g.id === godownId);

  return (
    <div className="space-y-3">
      {/* Godown selector */}
      <GodownPicker godowns={godowns} value={godownId} onChange={setGodownId} label="Counting warehouse" />

      {/* Instruction — the whole friction philosophy in one line */}
      <div
        className="rounded-2xl px-4 py-3 flex items-start gap-2.5"
        style={{ background: "color-mix(in srgb, var(--snm-brand) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-brand) 20%, transparent)" }}
      >
        <ClipboardCheck className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--snm-brand)" }} />
        <p className="text-[13px]" style={{ color: "var(--foreground)" }}>
          Each item shows what the system expects. <b>Only change the ones that are wrong</b> — untouched items stay as-is.
        </p>
      </div>

      {/* Search */}
      <div
        className="flex items-center gap-2.5 px-4 rounded-2xl"
        style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", height: 46, border: "0.5px solid var(--glass-border-lo)" }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find an item…"
          aria-label="Search items"
          className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Count sheet */}
      {rows.length === 0 ? (
        <EmptyState text={`No stock recorded in ${godown?.name ?? "this warehouse"} yet.`} />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const pcsPerCtn = r.sku.pcs_per_pack * r.sku.packs_per_carton;
            const raw = counted[r.sku.id];
            const touched = raw !== undefined && raw !== "";
            const n = touched ? Math.max(0, Math.floor(Number(raw))) : r.expected;
            const delta = touched ? n - r.expected : 0;
            return (
              <div
                key={r.sku.id}
                className="rounded-2xl px-4 py-3"
                style={{
                  background: "var(--glass-1)",
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                  boxShadow: "var(--glass-shadow), var(--glass-inner)",
                  border: delta !== 0
                    ? `1px solid color-mix(in srgb, ${delta < 0 ? "var(--snm-error)" : "var(--snm-warning)"} 35%, transparent)`
                    : "0.5px solid var(--glass-border-lo)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-foreground leading-snug truncate">{skuLabel(r.sku)}</p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                      {r.sku.internal_code} · system: {fmtQty(r.expected, r.sku.pcs_per_pack, pcsPerCtn)} ({r.expected} pcs)
                    </p>
                  </div>
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label={`Counted pieces for ${skuLabel(r.sku)}`}
                    placeholder={String(r.expected)}
                    value={raw ?? ""}
                    onChange={(e) => setCounted((c) => ({ ...c, [r.sku.id]: e.target.value }))}
                    className="w-24 h-12 rounded-xl text-center text-[16px] font-semibold text-foreground outline-none"
                    style={{
                      background: touched
                        ? `color-mix(in srgb, ${delta < 0 ? "var(--snm-error)" : delta > 0 ? "var(--snm-warning)" : "var(--foreground)"} 10%, transparent)`
                        : "color-mix(in srgb, var(--foreground) 5%, transparent)",
                      border: "1px solid var(--glass-border-lo)",
                    }}
                  />
                </div>
                {delta !== 0 && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <AlertTriangle className="h-3 w-3" style={{ color: delta < 0 ? "var(--snm-error)" : "var(--snm-warning)" }} />
                    <p className="text-[12px] font-semibold" style={{ color: delta < 0 ? "var(--snm-error)" : "var(--snm-warning)" }}>
                      {delta < 0 ? `${-delta} pcs short` : `${delta} pcs extra`} — will adjust to {n} pcs
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
        className="w-full flex items-center justify-center gap-1.5 min-h-[44px] text-[13px] font-medium active:opacity-70"
        style={{ color: "var(--muted-foreground)" }}
      >
        <History className="h-3.5 w-3.5" />
        {showHistory ? "Hide past counts" : "Past counts"}
      </button>
      {showHistory && <VerificationHistory />}

      {/* Sticky submit bar — only shows when there are changes */}
      {edits.length > 0 && (
        <div
          className="fixed left-0 right-0 z-30 px-4"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 76px)" }}
        >
          <div className="max-w-2xl mx-auto">
            <button
              onClick={submit}
              disabled={saving}
              className="w-full h-13 rounded-2xl flex items-center justify-center gap-2 text-[15px] font-semibold active:opacity-80 disabled:opacity-60"
              style={{ background: "var(--foreground)", color: "var(--background)", height: 52, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}
            >
              {saving ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Check className="h-4.5 w-4.5" />}
              Save count — {edits.length} correction{edits.length !== 1 ? "s" : ""}
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
  skus, godowns, levels, skuMap, onDone,
}: {
  skus: SkuFullRow[]; godowns: GodownRow[]; levels: StockLevel[];
  skuMap: Map<string, SkuFullRow>; onDone: () => Promise<void>;
}) {
  const [fromId, setFromId] = useState<string>(godowns.find((g) => g.is_default)?.id ?? godowns[0]?.id ?? "");
  const [toId, setToId] = useState<string>(godowns.find((g) => !g.is_default)?.id ?? godowns[1]?.id ?? "");
  const [skuId, setSkuId] = useState<string>("");
  const [q, setQ] = useState("");
  const [qty, setQty] = useState("");
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
    return filtered.sort((a, b) => skuLabel(a.sku).localeCompare(skuLabel(b.sku)));
  }, [levels, fromId, skuMap, q]);

  const selected = skuId ? skuMap.get(skuId) : undefined;
  const availForSelected = skuId ? (levels.find((l) => l.godown_id === fromId && l.sku_id === skuId)?.qty_pieces ?? 0) : 0;
  const qtyNum = Math.max(0, Math.floor(Number(qty) || 0));
  const overAvailable = qtyNum > availForSelected;
  const sameGodown = fromId === toId;
  const canSubmit = !!skuId && qtyNum > 0 && !overAvailable && !sameGodown && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await recordStockTransfer({ sku_id: skuId, from_godown_id: fromId, to_godown_id: toId, qty_pieces: qtyNum });
      await onDone();
      setSkuId(""); setQty(""); setQ("");
      toast.success("Stock transferred.");
    } catch (e) {
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
        <p className="text-[12px] px-1" style={{ color: "var(--snm-error)" }}>
          Pick two different warehouses.
        </p>
      )}

      {/* SKU picker */}
      <div
        className="flex items-center gap-2.5 px-4 rounded-2xl"
        style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", height: 46, border: "0.5px solid var(--glass-border-lo)" }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find item to move…"
          aria-label="Search items to transfer"
          className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

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
                onClick={() => { setSkuId(r.sku.id); setQty(""); }}
                className="w-full text-left rounded-2xl px-4 py-3 flex items-center gap-3 active:opacity-70"
                style={{
                  background: "var(--glass-1)",
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                  border: active
                    ? "1px solid color-mix(in srgb, var(--snm-brand) 45%, transparent)"
                    : "0.5px solid var(--glass-border-lo)",
                }}
              >
                <div
                  className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
                  style={{ border: active ? "none" : "1.5px solid var(--glass-border-lo)", background: active ? "var(--snm-brand)" : "transparent" }}
                >
                  {active && <Check className="h-3 w-3" style={{ color: "#fff" }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-foreground truncate">{skuLabel(r.sku)}</p>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    {fmtQty(r.avail, r.sku.pcs_per_pack, pcsPerCtn)} available · {r.avail} pcs
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Qty + submit — shown once an item is picked */}
      {selected && (
        <div
          className="rounded-2xl p-4 space-y-3"
          style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "0.5px solid var(--glass-border-lo)" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-foreground">{skuLabel(selected)}</p>
            <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>{availForSelected} pcs avail</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Pieces to move"
              aria-label="Pieces to transfer"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="flex-1 h-12 rounded-xl px-4 text-[16px] font-semibold text-foreground outline-none"
              style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: `1px solid ${overAvailable ? "color-mix(in srgb, var(--snm-error) 45%, transparent)" : "var(--glass-border-lo)"}` }}
            />
            <button
              onClick={() => setQty(String(availForSelected))}
              className="h-12 px-4 rounded-xl text-[13px] font-semibold active:opacity-70"
              style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--foreground)" }}
            >
              All
            </button>
          </div>
          {overAvailable && (
            <p className="text-[12px]" style={{ color: "var(--snm-error)" }}>
              Only {availForSelected} pcs available to move.
            </p>
          )}
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="w-full h-13 rounded-2xl flex items-center justify-center gap-2 text-[15px] font-semibold active:opacity-80 disabled:opacity-50"
            style={{ background: "var(--foreground)", color: "var(--background)", height: 52 }}
          >
            {saving ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <ArrowLeftRight className="h-4.5 w-4.5" />}
            Move stock
          </button>
        </div>
      )}
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
          style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "0.5px solid var(--glass-border-lo)" }}
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
      <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>{text}</p>
    </div>
  );
}

function VerificationHistory() {
  const [sessions, setSessions] = useState<VerificationSession[] | null>(null);
  useEffect(() => {
    listVerificationHistory().then(setSessions).catch((e) => toast.error((e as Error).message));
  }, []);
  if (sessions === null) {
    return <div className="h-12 rounded-2xl animate-pulse" style={{ background: "var(--glass-1)" }} />;
  }
  if (sessions.length === 0) {
    return <EmptyState text="No verifications recorded yet." />;
  }
  return (
    <div className="space-y-2">
      {sessions.map((s) => {
        const clean = s.lines_discrepant === 0;
        const date = new Date(s.verified_at).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "2-digit" });
        return (
          <div
            key={s.session_id}
            className="rounded-2xl px-4 py-3 flex items-center justify-between"
            style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)" }}
          >
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">{s.godown_name}</p>
              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                {date} · {s.lines_total} item{s.lines_total !== 1 ? "s" : ""} counted
              </p>
            </div>
            <div className="text-right shrink-0 ml-3">
              {clean ? (
                <span className="text-[12px] font-semibold" style={{ color: "var(--snm-success)" }}>All matched</span>
              ) : (
                <>
                  <p className="text-[13px] font-semibold" style={{ color: s.net_delta_pieces < 0 ? "var(--snm-error)" : "var(--snm-warning)" }}>
                    {s.net_delta_pieces > 0 ? "+" : ""}{s.net_delta_pieces} pcs
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>{s.lines_discrepant} corrected</p>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

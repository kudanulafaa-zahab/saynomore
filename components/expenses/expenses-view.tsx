"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Megaphone, MousePointerClick, Music2, Receipt,
  Warehouse, Truck, Zap, Plus, Trash2, Pencil, X,
} from "lucide-react";
import {
  listMarketingSpend,
  createMarketingSpend,
  updateMarketingSpend,
  deleteMarketingSpend,
  type MarketingSpendRow,
  type SpendChannel,
} from "@/lib/queries/expenses";
import { listSkusFlat, getCurrentUserRole, type SkuFullRow } from "@/lib/queries/products";

const CHANNEL_LABEL: Record<SpendChannel, string> = {
  meta_boost: "Meta Boost",
  google:     "Google Ads",
  tiktok_ad:  "TikTok Ads",
  other:      "Other",
};

const CHANNEL_ICON: Record<SpendChannel, React.ElementType> = {
  meta_boost: Megaphone,
  google:     MousePointerClick,
  tiktok_ad:  Music2,
  other:      Receipt,
};

const CATEGORY_ROWS = [
  { key: "meta_boost" as SpendChannel, icon: Megaphone,        label: "Social Media Ads",  meta: "Variable • Per campaign" },
  { key: "google"     as SpendChannel, icon: MousePointerClick, label: "Google Ads",         meta: "Variable • Per click"    },
  { key: "tiktok_ad"  as SpendChannel, icon: Music2,            label: "TikTok Ads",         meta: "Variable • Per campaign" },
  { key: "other"      as SpendChannel, icon: Receipt,           label: "Other Expenses",     meta: "Miscellaneous"           },
];

function fmt(n: number) {
  return n.toLocaleString("en-MV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtShort(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toFixed(0);
}

export function ExpensesView() {
  const [rows, setRows] = useState<MarketingSpendRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSheet, setShowSheet] = useState(false);
  const [editingRow, setEditingRow] = useState<MarketingSpendRow | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<MarketingSpendRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [quickAmount, setQuickAmount] = useState("");
  const [quickChannel, setQuickChannel] = useState<SpendChannel>("other");
  const [loggingQuick, setLoggingQuick] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    getCurrentUserRole().then((r) => setCanWrite(r !== "viewer")).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([listMarketingSpend(), listSkusFlat()]);
      setRows(r);
      setSkus(s);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const totalMvr = useMemo(() => rows.reduce((a, r) => a + Number(r.amount_mvr), 0), [rows]);

  const channelTotals = useMemo(() =>
    (Object.keys(CHANNEL_LABEL) as SpendChannel[]).map((ch) => ({
      ch,
      total: rows.filter((r) => r.channel === ch).reduce((a, r) => a + Number(r.amount_mvr), 0),
    })).sort((a, b) => b.total - a.total),
  [rows]);

  async function handleQuickLog() {
    const amt = parseFloat(quickAmount);
    if (!amt || amt <= 0) { toast.error("Enter an amount"); return; }
    setLoggingQuick(true);
    try {
      await createMarketingSpend({
        channel: quickChannel,
        amount_mvr: amt,
        campaign_name: null,
        start_date: new Date().toISOString().slice(0, 10),
        end_date: null,
        notes: null,
        sku_ids: [],
      });
      toast.success("Expense logged");
      setQuickAmount("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoggingQuick(false);
    }
  }

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center rounded-2xl">
        <Loader2 className="h-6 w-6 animate-spin mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="label-caps text-[11px] mb-1" style={{ color: "var(--muted-foreground)" }}>Finance</p>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Expenses</h1>
        </div>
        {canWrite && (
          <button
            onClick={() => { setEditingRow(undefined); setShowSheet(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Plus className="h-4 w-4" /> Log Expense
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass p-4 rounded-2xl space-y-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Total Spend</p>
          <p className="text-xl font-semibold text-foreground snm-num">MVR {fmtShort(totalMvr)}</p>
          <p className="text-xs text-muted-foreground">all time</p>
        </div>
        <div className="glass p-4 rounded-2xl space-y-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Campaigns</p>
          <p className="text-xl font-semibold text-foreground snm-num">{rows.length}</p>
          <p className="text-xs text-muted-foreground">logged</p>
        </div>
        <div className="glass p-4 rounded-2xl space-y-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Top Channel</p>
          <p className="text-base font-semibold text-foreground truncate">
            {channelTotals[0]?.total > 0 ? CHANNEL_LABEL[channelTotals[0].ch] : "—"}
          </p>
          <p className="text-xs text-muted-foreground snm-num">
            {channelTotals[0]?.total > 0 ? `MVR ${fmtShort(channelTotals[0].total)}` : "no data"}
          </p>
        </div>
        <div className="glass p-4 rounded-2xl space-y-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">This Month</p>
          <p className="text-xl font-semibold text-foreground snm-num">
            {(() => {
              const m = new Date().toISOString().slice(0, 7);
              const tot = rows.filter((r) => r.start_date.startsWith(m)).reduce((a, r) => a + Number(r.amount_mvr), 0);
              return tot > 0 ? `MVR ${fmtShort(tot)}` : "—";
            })()}
          </p>
          <p className="text-xs text-muted-foreground">{new Date().toLocaleString("en-MV", { month: "long" })}</p>
        </div>
      </div>

      {/* Quick log bar */}
      <div className="glass p-3 rounded-2xl flex items-center gap-2 flex-wrap sm:flex-nowrap">
        <div className="relative flex-1 min-w-[120px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">MVR</span>
          <input
            type="number"
            placeholder="0.00"
            value={quickAmount}
            onChange={(e) => setQuickAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleQuickLog()}
            className="w-full h-11 pl-12 pr-3 rounded-xl text-sm bg-secondary text-foreground border border-border outline-none"
          />
        </div>
        <select
          value={quickChannel}
          onChange={(e) => setQuickChannel(e.target.value as SpendChannel)}
          className="h-11 px-3 rounded-xl text-sm bg-secondary text-foreground border border-border outline-none"
        >
          {(Object.keys(CHANNEL_LABEL) as SpendChannel[]).map((c) => (
            <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
          ))}
        </select>
        <button
          onClick={handleQuickLog}
          disabled={loggingQuick || !quickAmount}
          className="h-11 px-5 rounded-xl text-sm font-semibold shrink-0 disabled:opacity-50"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          {loggingQuick ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log"}
        </button>
      </div>

      {/* Channel breakdown + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Channel breakdown */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">By Channel</h2>
          <div className="space-y-2">
            {CATEGORY_ROWS.map(({ key, icon: Icon, label, meta }) => {
              const total = rows.filter((r) => r.channel === key).reduce((a, r) => a + Number(r.amount_mvr), 0);
              const pct = totalMvr > 0 ? Math.round((total / totalMvr) * 100) : 0;
              return (
                <div key={key} className="glass p-4 rounded-2xl flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{meta}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-semibold text-foreground snm-num">
                      {total > 0 ? `MVR ${fmtShort(total)}` : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{pct > 0 ? `${pct}% of total` : "No data"}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Recent Activity</h2>
          <div className="glass rounded-2xl overflow-hidden">
            {rows.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm text-muted-foreground">No expenses logged yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Use the bar above to log your first expense.</p>
              </div>
            ) : (
              rows.slice(0, 10).map((r, i) => {
                const Icon = CHANNEL_ICON[r.channel];
                return (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between px-4 py-3 hover:bg-accent/20 transition`}
                    style={i > 0 ? { borderTop: "0.5px solid var(--glass-border-lo)" } : undefined}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">
                          {r.campaign_name ?? CHANNEL_LABEL[r.channel]}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.start_date).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="snm-num text-sm font-medium text-foreground">
                        MVR {fmt(Number(r.amount_mvr))}
                      </p>
                      {canWrite && (
                        <>
                          <button
                            onClick={() => { setEditingRow(r); setShowSheet(true); }}
                            className="snm-pressable flex items-center justify-center rounded-lg"
                            style={{ width: 36, height: 36, background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(r)}
                            className="snm-pressable flex items-center justify-center rounded-lg"
                            style={{ width: 36, height: 36, background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)" }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Log / Edit Sheet */}
      {showSheet && (
        <SpendSheet
          editing={editingRow}
          skus={skus}
          onClose={() => { setShowSheet(false); setEditingRow(undefined); }}
          onDone={() => { setShowSheet(false); setEditingRow(undefined); load(); }}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center px-4">
          <div className="glass-modal rounded-2xl p-6 w-full max-w-sm space-y-4">
            <p className="text-base font-semibold text-foreground">Delete expense?</p>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground font-medium">
                {deleteTarget.campaign_name ?? CHANNEL_LABEL[deleteTarget.channel]}
              </span>{" "}
              will be permanently removed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 h-11 rounded-xl text-sm text-muted-foreground bg-secondary"
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await deleteMarketingSpend(deleteTarget.id);
                    toast.success("Deleted");
                    setDeleteTarget(null);
                    load();
                  } catch (e) { toast.error((e as Error).message); }
                  finally { setDeleting(false); }
                }}
                className="flex-1 h-11 rounded-xl text-sm font-semibold disabled:opacity-50 transition"
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

// ── Spend Sheet ──────────────────────────────────────────────────────────────

function SpendSheet({ editing, skus, onClose, onDone }: {
  editing?: MarketingSpendRow;
  skus: SkuFullRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [channel, setChannel] = useState<SpendChannel>(editing?.channel ?? "meta_boost");
  const [amountMvr, setAmountMvr] = useState(editing ? String(editing.amount_mvr) : "");
  const [campaignName, setCampaignName] = useState(editing?.campaign_name ?? "");
  const [startDate, setStartDate] = useState(editing?.start_date ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(editing?.end_date ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [selectedSkuIds, setSelectedSkuIds] = useState<string[]>(editing?.sku_ids ?? []);
  const [skuSearch, setSkuSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const filteredSkus = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    if (!term) return skus.filter((s) => s.is_active).slice(0, 30);
    return skus.filter((s) => s.is_active &&
      [s.brand_name, s.model_name, s.variant_display].join(" ").toLowerCase().includes(term),
    ).slice(0, 30);
  }, [skus, skuSearch]);

  function toggleSku(id: string) {
    setSelectedSkuIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function save() {
    if (!amountMvr || parseFloat(amountMvr) <= 0) { toast.error("Enter an amount"); return; }
    if (endDate && endDate < startDate) { toast.error("End date must be on or after start date"); return; }
    setSaving(true);
    try {
      const payload = {
        channel,
        amount_mvr: parseFloat(amountMvr),
        campaign_name: campaignName.trim() || null,
        start_date: startDate,
        end_date: endDate || null,
        notes: notes.trim() || null,
        sku_ids: selectedSkuIds,
      };
      if (editing) await updateMarketingSpend(editing.id, payload);
      else await createMarketingSpend(payload);
      toast.success(editing ? "Updated" : "Expense logged");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  const field = "w-full h-11 px-3 rounded-xl text-sm bg-secondary text-foreground border border-border outline-none";
  const label = "block text-xs uppercase tracking-widest text-muted-foreground mb-1.5";

  return (
    <div className="fixed inset-0 bg-black/75 z-60 flex items-end backdrop-blur-sm">
      <div
        className="glass-modal rounded-t-3xl w-full overflow-y-auto"
        style={{
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 mb-1" />

        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-foreground">
              {editing ? "Edit Expense" : "Log Expense"}
            </h2>
            <button onClick={onClose} className="h-8 w-8 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={label}>Channel *</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value as SpendChannel)} className={field + " cursor-pointer"}>
                {(Object.keys(CHANNEL_LABEL) as SpendChannel[]).map((c) => (
                  <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Amount (MVR) *</label>
              <input
                type="number" step="0.01" min="0"
                value={amountMvr} onChange={(e) => setAmountMvr(e.target.value)}
                placeholder="0.00" className={field}
              />
            </div>
          </div>

          <div className="mb-3">
            <label className={label}>Campaign Name</label>
            <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. Eid Sale — Aiko" className={field} />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={label}>Start Date *</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={field} />
            </div>
          </div>

          {/* SKU Picker */}
          <div className="mb-3">
            <label className={label}>Linked SKUs <span className="normal-case tracking-normal text-muted-foreground/60">(optional)</span></label>
            {selectedSkuIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedSkuIds.map((sid) => {
                  const s = skus.find((sk) => sk.id === sid);
                  return s ? (
                    <span key={sid} className="inline-flex items-center gap-1 bg-secondary text-foreground text-xs rounded-lg px-2 py-1">
                      {s.brand_name} {s.variant_display}
                      <button onClick={() => toggleSku(sid)} className="text-muted-foreground hover:text-foreground ml-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ) : null;
                })}
              </div>
            )}
            <input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} placeholder="Search SKUs to link…" className={field + " mb-1.5"} />
            <div className="bg-secondary/50 rounded-xl max-h-40 overflow-y-auto border border-border">
              {filteredSkus.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-2">No matches</p>
              ) : filteredSkus.map((s, i) => (
                <button
                  key={s.id} onClick={() => toggleSku(s.id)}
                  className={`w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent/20 transition ${i > 0 ? "border-t border-border" : ""} ${selectedSkuIds.includes(s.id) ? "bg-accent/10" : ""}`}
                >
                  {s.brand_name} › {s.model_name} › {s.variant_display}
                  {selectedSkuIds.includes(s.id) && <span className="ml-2 text-xs text-muted-foreground">✓</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-5">
            <label className={label}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" rows={2}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-secondary text-foreground border border-border outline-none resize-none" />
          </div>

          <div className="flex gap-3 pb-[env(safe-area-inset-bottom,16px)] pt-2">
            <button onClick={onClose} className="flex-1 h-12 rounded-xl text-sm text-muted-foreground bg-secondary">
              Cancel
            </button>
            <button
              onClick={save} disabled={saving || !amountMvr}
              className="flex-[2] h-12 rounded-xl text-sm font-semibold disabled:opacity-50 transition"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : editing ? "Save Changes" : "Log Expense"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

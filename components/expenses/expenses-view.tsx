"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  listMarketingSpend,
  createMarketingSpend,
  updateMarketingSpend,
  deleteMarketingSpend,
  type MarketingSpendRow,
  type SpendChannel,
} from "@/lib/queries/expenses";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";

const CARD = {
  background: "rgba(18,19,23,0.70)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
};
const CARD_L2 = {
  background: "rgba(28,27,27,0.85)",
  backdropFilter: "blur(30px)",
  WebkitBackdropFilter: "blur(30px)",
  boxShadow: "0 40px 60px -15px rgba(0,0,0,0.5)",
};

const CHANNEL_LABEL: Record<SpendChannel, string> = {
  meta_boost: "Meta Boost",
  google: "Google Ads",
  tiktok_ad: "TikTok Ads",
  other: "Other",
};

const CHANNEL_ICON: Record<SpendChannel, string> = {
  meta_boost: "campaign",
  google: "ads_click",
  tiktok_ad: "music_video",
  other: "receipt_long",
};

const EXPENSE_CATEGORIES = [
  { key: "warehouse", icon: "warehouse", label: "Warehouse Rent", type: "Fixed • Monthly" },
  { key: "ads", icon: "campaign", label: "Social Media Ads", type: "Variable • Daily" },
  { key: "logistics", icon: "local_shipping", label: "Delivery & Fuel", type: "Variable • Real-time" },
  { key: "utilities", icon: "bolt", label: "Utilities", type: "Fixed • Monthly" },
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
  const [showLogSheet, setShowLogSheet] = useState(false);
  const [editingRow, setEditingRow] = useState<MarketingSpendRow | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<MarketingSpendRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Quick log bar state
  const [quickAmount, setQuickAmount] = useState("");
  const [quickCategory, setQuickCategory] = useState<SpendChannel>("other");
  const [loggingQuick, setLoggingQuick] = useState(false);

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

  // Channel breakdown for categories section
  const channelTotals = useMemo(() => {
    return (Object.keys(CHANNEL_LABEL) as SpendChannel[]).map((ch) => ({
      ch,
      total: rows.filter((r) => r.channel === ch).reduce((a, r) => a + Number(r.amount_mvr), 0),
    })).sort((a, b) => b.total - a.total);
  }, [rows]);

  // Bar chart data — last 6 months mock heights (real data would come from grouped query)
  const BAR_HEIGHTS = [40, 60, 55, 75, 65, 90];
  const BAR_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];

  async function handleQuickLog() {
    const amt = parseFloat(quickAmount);
    if (!amt || amt <= 0) { toast.error("Enter an amount"); return; }
    setLoggingQuick(true);
    try {
      await createMarketingSpend({
        channel: quickCategory,
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
      <div style={{ ...CARD, borderRadius: 16 }} className="p-12 flex flex-col items-center">
        <Loader2 className="h-6 w-6 animate-spin mb-3" style={{ color: "#8e9192" }} />
        <p style={{ color: "#8e9192", fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ background: "#000000", minHeight: "100vh", padding: "0 0 120px 0" }}>
      {/* Header */}
      <section style={{ marginBottom: 32 }}>
        <p style={{ color: "#8e9192", fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>
          Financial Oversight
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ color: "#ffffff", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: "34px" }}>
            Operational Costs
          </h1>
          <button
            onClick={() => { setEditingRow(undefined); setShowLogSheet(true); }}
            style={{
              background: "#ffffff",
              color: "#2f3131",
              border: "none",
              borderRadius: 999,
              padding: "10px 22px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            + Log Expense
          </button>
        </div>
      </section>

      {/* Bento grid — burn rate chart + quick metrics */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        {/* Monthly Burn Card — spans 2 cols */}
        <div style={{ ...CARD, borderRadius: 16, padding: 24, gridColumn: "span 2", position: "relative", overflow: "hidden", height: 320 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
            <div>
              <p style={{ color: "#8e9192", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                Monthly Burn Rate
              </p>
              <p style={{ color: "#ffffff", fontSize: 32, fontWeight: 300, letterSpacing: "-0.03em", lineHeight: "40px" }}>
                MVR {fmt(totalMvr)}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.05)", borderRadius: 999, padding: "4px 12px" }}>
              <span style={{ color: "#ffb4ab", fontSize: 11, fontWeight: 500 }}>↑ +4.2%</span>
            </div>
          </div>

          {/* Bar chart */}
          <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 192, display: "flex", alignItems: "flex-end", padding: "0 24px 24px", gap: 8 }}>
            {BAR_HEIGHTS.map((h, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ position: "relative", width: "100%" }}>
                  {i === BAR_HEIGHTS.length - 1 && (
                    <div style={{ position: "absolute", top: -28, left: "50%", transform: "translateX(-50%)", color: "#ffffff", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
                      CUR
                    </div>
                  )}
                  <div style={{
                    width: "100%",
                    borderRadius: "4px 4px 0 0",
                    height: `${h * 1.3}px`,
                    background: i === BAR_HEIGHTS.length - 1 ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.05)",
                    transition: "background 0.2s",
                  }} />
                </div>
                <span style={{ color: "#8e9192", fontSize: 10 }}>{BAR_MONTHS[i]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick metrics column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...CARD, borderRadius: 16, padding: 24, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <p style={{ color: "#8e9192", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Total Campaigns
            </p>
            <div>
              <p style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>{rows.length}</p>
              <p style={{ color: "#8e9192", fontSize: 14 }}>all time</p>
            </div>
          </div>
          <div style={{ ...CARD, borderRadius: 16, padding: 24, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <p style={{ color: "#8e9192", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Top Channel
            </p>
            <div>
              <p style={{ color: "#ffffff", fontSize: 16, fontWeight: 600 }}>
                {channelTotals[0] ? CHANNEL_LABEL[channelTotals[0].ch] : "—"}
              </p>
              <div style={{ width: "100%", background: "rgba(255,255,255,0.05)", height: 2, borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: "65%", background: "#ffffff", borderRadius: 999 }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Entry Bar */}
      <section style={{ ...CARD_L2, borderRadius: 16, padding: 16, display: "flex", alignItems: "center", gap: 12, marginBottom: 32, border: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#8e9192", fontSize: 18, fontWeight: 300, pointerEvents: "none" }}>
            MVR
          </span>
          <input
            type="number"
            placeholder="0.00"
            value={quickAmount}
            onChange={(e) => setQuickAmount(e.target.value)}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.05)",
              border: "none",
              borderRadius: 10,
              paddingLeft: 52,
              paddingRight: 16,
              paddingTop: 12,
              paddingBottom: 12,
              color: "#ffffff",
              fontSize: 22,
              fontWeight: 300,
              letterSpacing: "-0.03em",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <select
            value={quickCategory}
            onChange={(e) => setQuickCategory(e.target.value as SpendChannel)}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.05)",
              border: "none",
              borderRadius: 10,
              padding: "12px 16px",
              color: "#c7c6cb",
              fontSize: 14,
              outline: "none",
              appearance: "none",
            }}
          >
            {(Object.keys(CHANNEL_LABEL) as SpendChannel[]).map((c) => (
              <option key={c} value={c} style={{ background: "#1c1b1b" }}>{CHANNEL_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleQuickLog}
          disabled={loggingQuick || !quickAmount}
          style={{
            background: "#ffffff",
            color: "#2f3131",
            border: "none",
            borderRadius: 999,
            padding: "12px 28px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: loggingQuick || !quickAmount ? "not-allowed" : "pointer",
            opacity: loggingQuick || !quickAmount ? 0.5 : 1,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {loggingQuick ? "Logging…" : "LOG EXPENSE"}
        </button>
      </section>

      {/* Categories + Recent Activity */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48 }}>
        {/* Categories */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Categories</h2>
            <button
              style={{ color: "#8e9192", fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", background: "none", border: "none", cursor: "pointer" }}
              onClick={() => { setEditingRow(undefined); setShowLogSheet(true); }}
            >
              VIEW ALL
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {EXPENSE_CATEGORIES.map((cat) => {
              const catRows = rows.filter((r) => r.channel === "other" || CHANNEL_ICON[r.channel] === cat.icon);
              const catTotal = catRows.reduce((a, r) => a + Number(r.amount_mvr), 0);
              const pct = totalMvr > 0 ? Math.round((catTotal / totalMvr) * 100) : 0;
              return (
                <div
                  key={cat.key}
                  style={{ ...CARD, borderRadius: 16, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span className="material-symbols-outlined" style={{ color: "#ffffff", fontSize: 22 }}>{cat.icon}</span>
                    </div>
                    <div>
                      <p style={{ color: "#e5e2e1", fontSize: 16, fontWeight: 400, marginBottom: 2 }}>{cat.label}</p>
                      <p style={{ color: "#8e9192", fontSize: 12, fontWeight: 500, letterSpacing: "0.05em" }}>{cat.type}</p>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
                      {catTotal > 0 ? `MVR ${fmtShort(catTotal)}` : "—"}
                    </p>
                    <p style={{ color: "#8e9192", fontSize: 12, fontWeight: 500 }}>{pct > 0 ? `${pct}% of total` : "No data"}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Recent Activity</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...CARD, border: "none", borderRadius: 999, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <span className="material-symbols-outlined" style={{ color: "#c4c7c8", fontSize: 18 }}>filter_list</span>
              </button>
            </div>
          </div>
          <div style={{ ...CARD, borderRadius: 16, overflow: "hidden" }}>
            {rows.length === 0 ? (
              <div style={{ padding: "40px 24px", textAlign: "center" }}>
                <p style={{ color: "#8e9192", fontSize: 14 }}>No expenses logged yet.</p>
                <p style={{ color: "#8e9192", fontSize: 12, marginTop: 4 }}>Use the bar above to log your first expense.</p>
              </div>
            ) : (
              rows.slice(0, 8).map((r, i) => (
                <div
                  key={r.id}
                  style={{
                    padding: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
                    cursor: "pointer",
                  }}
                  onClick={() => { setEditingRow(r); setShowLogSheet(true); }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 999, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span className="material-symbols-outlined" style={{ color: "#c4c7c8", fontSize: 16 }}>{CHANNEL_ICON[r.channel]}</span>
                    </div>
                    <div>
                      <p style={{ color: "#e5e2e1", fontSize: 14, fontWeight: 400, marginBottom: 2 }}>
                        {r.campaign_name ?? CHANNEL_LABEL[r.channel]}
                      </p>
                      <p style={{ color: "#8e9192", fontSize: 12 }}>
                        {new Date(r.start_date).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <p style={{ color: "#ffffff", fontSize: 16, fontWeight: 400, fontFeatureSettings: '"tnum"' }}>
                      −MVR {fmt(Number(r.amount_mvr))}
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6 }}
                    >
                      <span className="material-symbols-outlined" style={{ color: "#8e9192", fontSize: 16 }}>delete</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Log / Edit Sheet */}
      {showLogSheet && (
        <SpendSheet
          editing={editingRow}
          skus={skus}
          onClose={() => { setShowLogSheet(false); setEditingRow(undefined); }}
          onDone={() => { setShowLogSheet(false); setEditingRow(undefined); load(); }}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ ...CARD_L2, borderRadius: 20, padding: 28, width: 340, maxWidth: "90vw" }}>
            <p style={{ color: "#ffffff", fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Delete expense?</p>
            <p style={{ color: "#8e9192", fontSize: 14, marginBottom: 24 }}>
              <strong style={{ color: "#c7c6cb" }}>{deleteTarget.campaign_name ?? CHANNEL_LABEL[deleteTarget.channel]}</strong> will be permanently removed.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={{ flex: 1, background: "rgba(255,255,255,0.05)", color: "#c7c6cb", border: "none", borderRadius: 999, padding: "12px", fontSize: 14, cursor: "pointer" }}
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
                style={{ flex: 1, background: "rgba(255,180,171,0.15)", color: "#ffb4ab", border: "none", borderRadius: 999, padding: "12px", fontSize: 14, cursor: "pointer" }}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Spend Sheet ──────────────────────────────────────────────────────────────

function SpendSheet({
  editing, skus, onClose, onDone,
}: {
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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "rgba(255,255,255,0.05)",
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    color: "#ffffff",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    color: "#8e9192",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 6,
    display: "block",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "flex-end" }}>
      <div
        style={{
          ...CARD_L2,
          borderRadius: "20px 20px 0 0",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 28,
        }}
      >
        {/* Handle */}
        <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.12)", borderRadius: 999, margin: "0 auto 24px" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {editing ? "Edit Expense" : "Log Expense"}
          </h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "none", borderRadius: 999, width: 36, height: 36, cursor: "pointer", color: "#8e9192", fontSize: 20 }}>
            ×
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Channel *</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as SpendChannel)}
              style={{ ...inputStyle, appearance: "none" }}
            >
              {(Object.keys(CHANNEL_LABEL) as SpendChannel[]).map((c) => (
                <option key={c} value={c} style={{ background: "#1c1b1b" }}>{CHANNEL_LABEL[c]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Amount (MVR) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amountMvr}
              onChange={(e) => setAmountMvr(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
              autoFocus={!editing}
            />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Campaign Name</label>
          <input
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="e.g. Eid Sale — Aiko"
            style={inputStyle}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Start Date *</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
          </div>
        </div>

        {/* SKU Picker */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Linked SKUs <span style={{ color: "#444748", textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
          {selectedSkuIds.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {selectedSkuIds.map((sid) => {
                const s = skus.find((sk) => sk.id === sid);
                return s ? (
                  <span key={sid} style={{ background: "rgba(255,255,255,0.1)", color: "#ffffff", borderRadius: 6, padding: "3px 10px", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                    {s.brand_name} {s.variant_display}
                    <button onClick={() => toggleSku(sid)} style={{ background: "none", border: "none", color: "#8e9192", cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                ) : null;
              })}
            </div>
          )}
          <input
            value={skuSearch}
            onChange={(e) => setSkuSearch(e.target.value)}
            placeholder="Search SKUs to link…"
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, maxHeight: 160, overflowY: "auto" }}>
            {filteredSkus.length === 0 ? (
              <p style={{ color: "#8e9192", fontSize: 12, padding: "10px 14px" }}>No matches</p>
            ) : filteredSkus.map((s, i) => (
              <button
                key={s.id}
                onClick={() => toggleSku(s.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  fontSize: 13,
                  background: selectedSkuIds.includes(s.id) ? "rgba(255,255,255,0.08)" : "transparent",
                  border: "none",
                  borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  color: "#e5e2e1",
                  cursor: "pointer",
                }}
              >
                {s.brand_name} › {s.model_name} › {s.variant_display}
                {selectedSkuIds.includes(s.id) && <span style={{ color: "#ffffff", marginLeft: 8, fontSize: 11 }}>✓</span>}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 28 }}>
          <label style={labelStyle}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
            rows={2}
            style={{ ...inputStyle, resize: "none" }}
          />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, background: "rgba(255,255,255,0.05)", color: "#c7c6cb", border: "none", borderRadius: 999, padding: "14px", fontSize: 14, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !amountMvr}
            style={{
              flex: 2,
              background: "#ffffff",
              color: "#2f3131",
              border: "none",
              borderRadius: 999,
              padding: "14px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: saving || !amountMvr ? "not-allowed" : "pointer",
              opacity: saving || !amountMvr ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : editing ? "SAVE CHANGES" : "LOG EXPENSE"}
          </button>
        </div>
      </div>
    </div>
  );
}

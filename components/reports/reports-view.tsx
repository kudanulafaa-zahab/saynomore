"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, TrendingUp, TrendingDown, Package,
  Clock, BarChart3, Search, Megaphone, X,
} from "lucide-react";
import { getReportsData, type ReportRow } from "@/lib/queries/reports";
import { listMarketingSpend, type MarketingSpendRow } from "@/lib/queries/expenses";
import { type UnitUom } from "@/lib/queries/products";

// ── Date helpers ─────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function containerLabel(uom: UnitUom) {
  if (uom === "ml") return "bottle";
  if (uom === "g") return "pouch";
  return "pack";
}

function formatStock(pieces: number, pcsPerPack: number, packsPerCarton: number, uom: UnitUom) {
  const pcsPerCarton = pcsPerPack * packsPerCarton;
  const ctns = pcsPerCarton > 0 ? Math.floor(pieces / pcsPerCarton) : 0;
  const rem = pcsPerCarton > 0 ? pieces % pcsPerCarton : pieces;
  const loose = pcsPerPack > 0 ? Math.floor(rem / pcsPerPack) : 0;
  const label = containerLabel(uom);
  const parts: string[] = [];
  if (ctns > 0) parts.push(`${ctns} ctn`);
  if (loose > 0) parts.push(`${loose} ${label}`);
  return parts.length > 0 ? parts.join(" + ") : "0";
}

function marginColor(pct: number | null): React.CSSProperties {
  if (pct === null) return { color: "var(--muted-foreground)" };
  if (pct >= 30) return { color: "var(--snm-success)" };
  if (pct >= 15) return { color: "var(--snm-warning)" };
  return { color: "var(--snm-error)" };
}

function daysColor(days: number | null): React.CSSProperties {
  if (days === null) return { color: "var(--muted-foreground)" };
  if (days > 30) return { color: "var(--snm-success)" };
  if (days > 14) return { color: "var(--snm-warning)" };
  return { color: "var(--snm-error)" };
}

const PRESETS = [
  { label: "Last 7 days",  from: () => daysAgo(7),  to: today },
  { label: "Last 30 days", from: () => daysAgo(30), to: today },
  { label: "Last 90 days", from: () => daysAgo(90), to: today },
];

const CHANNEL_LABELS: Record<string, string> = {
  meta_boost: "Meta Boost",
  google: "Google Ads",
  tiktok_ad: "TikTok Ads",
  other: "Other",
};

type SortKey = "revenue" | "qty" | "margin" | "days" | "stock";

export function ReportsView() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [spend, setSpend] = useState<MarketingSpendRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [tab, setTab] = useState<"bestsellers" | "margins" | "stock">("bestsellers");

  async function load(f = from, t = to) {
    setLoading(true);
    try {
      const [reportRows, spendRows] = await Promise.all([
        getReportsData(f, t),
        listMarketingSpend(),
      ]);
      setRows(reportRows);
      // filter spend rows that overlap with the selected period
      setSpend(spendRows.filter((s) => {
        const start = s.start_date;
        const end = s.end_date ?? today();
        return start <= t && end >= f;
      }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let r = rows;
    if (term) {
      r = r.filter((x) =>
        [x.brand_name, x.model_name, x.variant_display, x.internal_code]
          .join(" ").toLowerCase().includes(term),
      );
    }
    return [...r].sort((a, b) => {
      if (sortKey === "revenue") return b.total_revenue_mvr - a.total_revenue_mvr;
      if (sortKey === "qty")     return b.total_qty_pieces - a.total_qty_pieces;
      if (sortKey === "margin")  return (b.gross_margin_pct ?? -999) - (a.gross_margin_pct ?? -999);
      if (sortKey === "days")    return (b.days_of_stock ?? 99999) - (a.days_of_stock ?? 99999);
      if (sortKey === "stock")   return b.stock_pieces - a.stock_pieces;
      return 0;
    });
  }, [rows, q, sortKey]);

  // Summary cards
  const totals = useMemo(() => ({
    revenue: rows.reduce((s, r) => s + r.total_revenue_mvr, 0),
    skusSold: rows.filter((r) => r.total_qty_pieces > 0).length,
    lowStock: rows.filter((r) => r.days_of_stock !== null && r.days_of_stock < 14).length,
    avgMargin: (() => {
      const withMargin = rows.filter((r) => r.gross_margin_pct !== null);
      if (!withMargin.length) return null;
      return withMargin.reduce((s, r) => s + (r.gross_margin_pct ?? 0), 0) / withMargin.length;
    })(),
    totalSpend: spend.reduce((s, r) => s + r.amount_mvr, 0),
  }), [rows, spend]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Analytics</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Reports</h1>
      </div>

      {/* Date range + presets */}
      <div className="glass p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { const f = p.from(); const t = p.to(); setFrom(f); setTo(t); load(f, t); }}
              className={`text-[12px] font-medium px-3 rounded-lg border transition active:scale-95`}
              style={{
                minHeight: 36,
                background: from === p.from() && to === p.to() ? "var(--foreground)" : "transparent",
                color: from === p.from() && to === p.to() ? "var(--background)" : "var(--muted-foreground)",
                borderColor: from === p.from() && to === p.to() ? "var(--foreground)" : "var(--glass-border-lo)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-11 px-3 text-sm rounded-xl border text-foreground"
            style={{ background: "var(--glass-bg-1)", borderColor: "var(--glass-border-lo)" }}
          />
          <span className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-11 px-3 text-sm rounded-xl border text-foreground"
            style={{ background: "var(--glass-bg-1)", borderColor: "var(--glass-border-lo)" }}
          />
          <button
            onClick={() => load()}
            disabled={loading}
            className="h-11 px-5 rounded-xl text-[13px] font-semibold transition active:scale-95 disabled:opacity-40"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
          </button>
        </div>
      </div>

      {/* Summary cards — horizontal scroll on mobile, auto grid on sm+ */}
      <div className="flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 lg:grid-cols-5 sm:overflow-visible">
        <SummaryCard
          label="Total Revenue"
          value={`MVR ${totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          icon={TrendingUp}
          tokenColor="var(--snm-success)"
        />
        <SummaryCard
          label="SKUs Sold"
          value={String(totals.skusSold)}
          icon={Package}
          tokenColor="var(--snm-brand)"
        />
        <SummaryCard
          label="Avg Margin"
          value={totals.avgMargin !== null ? `${totals.avgMargin.toFixed(1)}%` : "—"}
          icon={BarChart3}
          tokenColor="#3B82F6"
        />
        <SummaryCard
          label="Low Stock SKUs"
          value={String(totals.lowStock)}
          icon={Clock}
          tokenColor={totals.lowStock > 0 ? "var(--snm-error)" : "var(--muted-foreground)"}
        />
        <SummaryCard
          label="Mktg Spend"
          value={totals.totalSpend > 0 ? `MVR ${totals.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
          icon={Megaphone}
          tokenColor="var(--snm-warning)"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: "var(--glass-bg-2)", border: "1px solid var(--glass-border-lo)" }}>
        {([
          { key: "bestsellers", label: "Best Sellers" },
          { key: "margins",     label: "Margins" },
          { key: "stock",       label: "Days of Stock" },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 rounded-lg text-[13px] font-medium transition active:scale-95"
            style={{
              minHeight: 40,
              background: tab === t.key ? "var(--background)" : "transparent",
              color: tab === t.key ? "var(--foreground)" : "var(--muted-foreground)",
              boxShadow: tab === t.key ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by brand, model, variant…"
          className="w-full h-11 pl-9 pr-10 rounded-xl text-sm text-foreground outline-none"
          style={{ background: "var(--glass-bg-1)", border: "1px solid var(--glass-border-lo)" }}
        />
        {q && (
          <button
            onClick={() => setQ("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
            style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="glass p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mb-3" />
          <p className="text-sm">Loading…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass p-10 text-center">
          <p className="text-muted-foreground text-sm">No data for this period.</p>
        </div>
      ) : tab === "bestsellers" ? (
        <BestSellersTable rows={filtered} onSort={setSortKey} sortKey={sortKey} />
      ) : tab === "margins" ? (
        <MarginsTable rows={filtered} onSort={setSortKey} sortKey={sortKey} />
      ) : (
        <StockTable
          rows={filtered}
          onSort={setSortKey}
          sortKey={sortKey}
          periodDays={Math.max(Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000), 1)}
        />
      )}

      {/* Marketing spend breakdown */}
      {!loading && spend.length > 0 && (
        <MarketingSpendSection spend={spend} />
      )}
    </div>
  );
}

// ── Summary card ─────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon: Icon, tokenColor }: {
  label: string; value: string; icon: typeof TrendingUp; tokenColor: string;
}) {
  return (
    <div className="glass p-4 space-y-2 shrink-0 sm:shrink" style={{ minWidth: 140 }}>
      <div
        className="h-8 w-8 rounded-lg flex items-center justify-center"
        style={{
          background: `color-mix(in srgb, ${tokenColor} 12%, transparent)`,
          color: tokenColor,
        }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-lg font-semibold text-foreground">{value}</p>
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
  );
}

// ── Sort header helper ───────────────────────────────────────────────────

function SortTh({ label, sortKey, active, onSort }: {
  label: string; sortKey: SortKey; active: SortKey; onSort: (k: SortKey) => void;
}) {
  return (
    <th
      className={`px-3 py-2 text-right text-[11px] uppercase tracking-widest cursor-pointer select-none transition ${
        active === sortKey ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={() => onSort(sortKey)}
    >
      {label} {active === sortKey ? "↓" : ""}
    </th>
  );
}

// ── Best Sellers table ───────────────────────────────────────────────────

function BestSellersTable({ rows, sortKey, onSort }: {
  rows: ReportRow[]; sortKey: SortKey; onSort: (k: SortKey) => void;
}) {
  return (
    <div className="glass overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/50">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-widest text-muted-foreground">Product</th>
              <SortTh label="Revenue (MVR)" sortKey="revenue" active={sortKey} onSort={onSort} />
              <SortTh label="Qty Sold (pcs)" sortKey="qty" active={sortKey} onSort={onSort} />
              <th className="px-3 py-2 text-right text-[11px] uppercase tracking-widest text-muted-foreground">Avg Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={r.sku_id} className="hover:bg-accent/20 transition">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono w-5 text-center ${i < 3 ? "text-primary font-bold" : "text-muted-foreground"}`}>
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-foreground text-sm">{r.brand_name} › {r.model_name} › {r.variant_display}</p>
                      <p className="text-[11px] text-muted-foreground">{r.internal_code}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-right">
                  <span className="text-foreground font-medium">
                    {r.total_revenue_mvr > 0
                      ? r.total_revenue_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })
                      : <span className="text-muted-foreground">—</span>}
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground">
                  {r.total_qty_pieces > 0 ? r.total_qty_pieces.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground">
                  {r.avg_unit_price_mvr > 0 ? r.avg_unit_price_mvr.toFixed(2) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Margins table ────────────────────────────────────────────────────────

function MarginsTable({ rows, sortKey, onSort }: {
  rows: ReportRow[]; sortKey: SortKey; onSort: (k: SortKey) => void;
}) {
  return (
    <div className="glass overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/50">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-widest text-muted-foreground">Product</th>
              <th className="px-3 py-2 text-right text-[11px] uppercase tracking-widest text-muted-foreground">Landed/pc</th>
              <th className="px-3 py-2 text-right text-[11px] uppercase tracking-widest text-muted-foreground">Sell/pc</th>
              <SortTh label="Margin %" sortKey="margin" active={sortKey} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.sku_id} className="hover:bg-accent/20 transition">
                <td className="px-3 py-3">
                  <p className="text-foreground text-sm">{r.brand_name} › {r.model_name} › {r.variant_display}</p>
                  <p className="text-[11px] text-muted-foreground">{r.internal_code}</p>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground">
                  {r.landed_per_piece_mvr > 0 ? r.landed_per_piece_mvr.toFixed(3) : "—"}
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground">
                  {r.avg_unit_price_mvr > 0 ? r.avg_unit_price_mvr.toFixed(3) : "—"}
                </td>
                <td className="px-3 py-3 text-right">
                  {r.gross_margin_pct !== null ? (
                    <span className="font-semibold" style={marginColor(r.gross_margin_pct)}>
                      {r.gross_margin_pct}%
                      {r.gross_margin_pct >= 30
                        ? <TrendingUp className="inline h-3 w-3 ml-1" />
                        : r.gross_margin_pct < 15
                        ? <TrendingDown className="inline h-3 w-3 ml-1" />
                        : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No sales</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-border bg-secondary/30">
        <p className="text-[11px] text-muted-foreground">
          Green ≥ 30% · Amber 15–29% · Red &lt; 15% · Sell price based on actual invoiced sales in period
        </p>
      </div>
    </div>
  );
}

// ── Marketing Spend section ──────────────────────────────────────────────

function MarketingSpendSection({ spend }: { spend: MarketingSpendRow[] }) {
  const byChannel = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of spend) {
      map[s.channel] = (map[s.channel] ?? 0) + s.amount_mvr;
    }
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .map(([channel, total]) => ({ channel, total }));
  }, [spend]);

  const grandTotal = spend.reduce((s, r) => s + r.amount_mvr, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">Marketing Spend</h2>
      </div>

      {/* Channel breakdown bar */}
      <div className="glass p-4 space-y-3">
        {byChannel.map(({ channel, total }) => {
          const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
          return (
            <div key={channel} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-foreground">{CHANNEL_LABELS[channel] ?? channel}</span>
                <span className="text-muted-foreground font-medium">
                  MVR {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  <span className="text-xs ml-1">({pct.toFixed(0)}%)</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--glass-bg-2)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: "var(--snm-warning)" }}
                />
              </div>
            </div>
          );
        })}
        <div className="pt-2 border-t border-border flex justify-between text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold text-foreground">
            MVR {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>

      {/* Spend log */}
      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/50">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] uppercase tracking-widest text-muted-foreground">Campaign</th>
                <th className="px-3 py-2 text-left text-[11px] uppercase tracking-widest text-muted-foreground">Channel</th>
                <th className="px-3 py-2 text-left text-[11px] uppercase tracking-widest text-muted-foreground">Period</th>
                <th className="px-3 py-2 text-right text-[11px] uppercase tracking-widest text-muted-foreground">Amount (MVR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {spend.map((s) => (
                <tr key={s.id} className="hover:bg-accent/20 transition">
                  <td className="px-3 py-3">
                    <p className="text-foreground">{s.campaign_name ?? "—"}</p>
                    {s.notes && <p className="text-[11px] text-muted-foreground">{s.notes}</p>}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {CHANNEL_LABELS[s.channel] ?? s.channel}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground text-xs">
                    {s.start_date}{s.end_date ? ` → ${s.end_date}` : ""}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-foreground">
                    {s.amount_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Days of Stock table ──────────────────────────────────────────────────

function StockTable({ rows, sortKey, onSort, periodDays }: {
  rows: ReportRow[]; sortKey: SortKey; onSort: (k: SortKey) => void; periodDays: number;
}) {
  return (
    <div className="glass overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/50">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] uppercase tracking-widest text-muted-foreground">Product</th>
              <SortTh label="Stock" sortKey="stock" active={sortKey} onSort={onSort} />
              <th className="px-3 py-2 text-right text-[11px] uppercase tracking-widest text-muted-foreground">Daily Avg</th>
              <SortTh label="Days Left" sortKey="days" active={sortKey} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const days = Math.max(periodDays, 1);
              const dailyAvg = r.total_qty_pieces > 0
                ? (r.total_qty_pieces / days).toFixed(1)
                : null;
              return (
                <tr key={r.sku_id} className="hover:bg-accent/20 transition">
                  <td className="px-3 py-3">
                    <p className="text-foreground text-sm">{r.brand_name} › {r.model_name} › {r.variant_display}</p>
                    <p className="text-[11px] text-muted-foreground">{r.internal_code}</p>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <p className="text-foreground text-sm">
                      {formatStock(r.stock_pieces, r.pcs_per_pack, r.packs_per_carton, "pcs")}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{r.stock_pieces.toLocaleString()} pcs</p>
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground text-sm">
                    {dailyAvg ? `${dailyAvg} pcs/day` : "—"}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {r.days_of_stock !== null ? (
                      <span className="font-semibold" style={daysColor(r.days_of_stock)}>
                        {r.days_of_stock} days
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">No sales data</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-border bg-secondary/30">
        <p className="text-[11px] text-muted-foreground">
          Green &gt; 30 days · Amber 14–30 days · Red &lt; 14 days · Based on sales velocity in selected period
        </p>
      </div>
    </div>
  );
}

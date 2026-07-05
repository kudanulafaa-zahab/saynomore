"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, TrendingUp, TrendingDown, Package,
  Clock, BarChart3, Search, Megaphone, X, Download,
} from "lucide-react";
import { getReportsData, getContributionMargin, getAbcAnalysis, type ReportRow, type ContributionRow, type AbcRow } from "@/lib/queries/reports";
import { listMarketingSpend, type MarketingSpendRow } from "@/lib/queries/expenses";
import { formatQtyInTradeUnits, costPerTradeUnit, type TradeUnitConfig } from "@/lib/trade-units";

// ── Date helpers ─────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Builds the trade-unit config for a report row (works for any of the 3 report row shapes, which all share these fields). */
function tradeCfg(r: { pcs_per_pack: number; packs_per_carton: number; unit_uom: ReportRow["unit_uom"]; sellable_units: ReportRow["sellable_units"] }): TradeUnitConfig {
  return { pcsPerPack: r.pcs_per_pack, packsPerCarton: r.packs_per_carton, unitUom: r.unit_uom, sellableUnits: r.sellable_units };
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
  const [tab, setTab] = useState<"bestsellers" | "margins" | "stock" | "contribution" | "abc">("bestsellers");
  const [customRange, setCustomRange] = useState(false);
  const [contrib, setContrib] = useState<ContributionRow[]>([]);
  const [abc, setAbc] = useState<AbcRow[]>([]);

  async function load(f = from, t = to) {
    setLoading(true);
    try {
      const [reportRows, spendRows, contribRows, abcRows] = await Promise.all([
        getReportsData(f, t),
        listMarketingSpend(),
        getContributionMargin(f, t),
        getAbcAnalysis(f, t),
      ]);
      setRows(reportRows);
      setContrib(contribRows);
      setAbc(abcRows);
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

  const contribFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let r = contrib;
    if (term) {
      r = r.filter((x) =>
        [x.brand_name, x.model_name, x.variant_display, x.internal_code]
          .join(" ").toLowerCase().includes(term),
      );
    }
    return r; // already ordered by contribution_mvr desc from the RPC
  }, [contrib, q]);

  const abcFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let r = abc;
    if (term) {
      r = r.filter((x) =>
        [x.brand_name, x.model_name, x.variant_display, x.internal_code]
          .join(" ").toLowerCase().includes(term),
      );
    }
    return r; // already ranked by revenue desc from the RPC
  }, [abc, q]);

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
    // Full committed amount for any campaign overlapping the selected period
    // (matches what you actually paid/committed — e.g. Meta Ads Manager totals).
    totalSpend: spend.reduce((s, r) => s + r.amount_mvr, 0),
    // Accrual-matched: same day-overlap proration as get_pnl(), so this figure
    // always agrees with Financials for the identical date range.
    periodSpend: spend.reduce((s, r) => {
      const start = r.start_date;
      const end = r.end_date ?? today();
      const overlapStart = start > from ? start : from;
      const overlapEnd = end < to ? end : to;
      const overlapDays = Math.max(0, (new Date(overlapEnd).getTime() - new Date(overlapStart).getTime()) / 86400000 + 1);
      const totalDays = Math.max(1, (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1);
      return s + r.amount_mvr * (overlapDays / totalDays);
    }, 0),
  }), [rows, spend, from, to]);

  function exportCsv() {
    let csv = "";
    const dateRange = `${from} to ${to}`;

    if (tab === "bestsellers" || tab === "margins") {
      const headers = ["SKU Code", "Brand", "Model", "Variant", "Qty Sold", "Qty Sold (pcs)", "Revenue (MVR)", "Landed Cost (MVR)", "Margin %"];
      csv = [headers, ...filtered.map((r) => [
        r.internal_code,
        r.brand_name,
        r.model_name,
        r.variant_display,
        formatQtyInTradeUnits(r.total_qty_pieces, tradeCfg(r)),
        r.total_qty_pieces,
        r.total_revenue_mvr.toFixed(2),
        r.total_landed_cost_mvr.toFixed(2),
        r.gross_margin_pct != null ? r.gross_margin_pct.toFixed(1) + "%" : "",
      ])].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    } else if (tab === "contribution") {
      const headers = ["SKU Code", "Brand", "Model", "Variant", "Qty Sold", "Qty Sold (pcs)", "Revenue (MVR)", "Landed Cost (MVR)", "Marketing (MVR)", "Contribution (MVR)", "Contribution %"];
      csv = [headers, ...contribFiltered.map((r) => [
        r.internal_code,
        r.brand_name,
        r.model_name,
        r.variant_display,
        formatQtyInTradeUnits(r.total_qty_pieces, tradeCfg(r)),
        r.total_qty_pieces,
        r.total_revenue_mvr.toFixed(2),
        r.total_landed_cost_mvr.toFixed(2),
        r.marketing_spend_mvr.toFixed(2),
        r.contribution_mvr.toFixed(2),
        r.contribution_margin_pct != null ? r.contribution_margin_pct.toFixed(1) + "%" : "",
      ])].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    } else if (tab === "abc") {
      const headers = ["Rank", "Class", "SKU Code", "Brand", "Model", "Variant", "Qty Sold", "Qty Sold (pcs)", "Revenue (MVR)", "Revenue Share %", "Cumulative %"];
      csv = [headers, ...abcFiltered.map((r) => [
        r.rank,
        r.abc_class,
        r.internal_code,
        r.brand_name,
        r.model_name,
        r.variant_display,
        formatQtyInTradeUnits(r.total_qty_pieces, tradeCfg(r)),
        r.total_qty_pieces,
        r.total_revenue_mvr.toFixed(2),
        r.revenue_share_pct.toFixed(2) + "%",
        r.cumulative_pct.toFixed(2) + "%",
      ])].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    } else if (tab === "stock") {
      const headers = ["SKU Code", "Brand", "Model", "Variant", "Stock", "Stock (pcs)", "Days of Stock"];
      csv = [headers, ...filtered.map((r) => [
        r.internal_code,
        r.brand_name,
        r.model_name,
        r.variant_display,
        formatQtyInTradeUnits(r.stock_pieces, tradeCfg(r)),
        r.stock_pieces,
        r.days_of_stock != null ? r.days_of_stock.toFixed(0) : "—",
      ])].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `saynomore-report-${tab}-${dateRange}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Analytics</p>
          <h1 className="ios-page-title">Reports</h1>
        </div>
        <button
          onClick={exportCsv}
          disabled={tab === "contribution" ? contribFiltered.length === 0 : tab === "abc" ? abcFiltered.length === 0 : filtered.length === 0}
          className="flex items-center gap-2 h-10 px-4 rounded-2xl text-[13px] font-semibold shrink-0 transition active:scale-95 disabled:opacity-40"
          style={{ background: "var(--foreground)", color: "var(--background)", marginTop: 4 }}
        >
          <Download className="h-4 w-4" />
          CSV
        </button>
      </div>

      {/* Date range — preset chips + custom toggle */}
      <div className="space-y-3">
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
          {PRESETS.map((p) => {
            const pf = p.from(); const pt = p.to();
            const active = from === pf && to === pt && !customRange;
            return (
              <button
                key={p.label}
                onClick={() => { setCustomRange(false); setFrom(pf); setTo(pt); load(pf, pt); }}
                className="shrink-0 h-11 px-4 rounded-full text-[13px] font-semibold transition active:scale-95"
                style={{
                  background: active ? "var(--foreground)" : "var(--glass-1)",
                  color:      active ? "var(--background)" : "var(--muted-foreground)",
                  border:     active ? "none" : "0.5px solid var(--glass-border-lo)",
                  touchAction: "manipulation",
                }}
              >
                {p.label}
              </button>
            );
          })}
          <button
            onClick={() => setCustomRange(true)}
            className="shrink-0 h-11 px-4 rounded-full text-[13px] font-semibold transition active:scale-95"
            style={{
              background: customRange ? "var(--foreground)" : "var(--glass-1)",
              color:      customRange ? "var(--background)" : "var(--muted-foreground)",
              border:     customRange ? "none" : "0.5px solid var(--glass-border-lo)",
              touchAction: "manipulation",
            }}
          >
            Custom
          </button>
        </div>
        {customRange && (
          <div className="flex items-center gap-2 flex-wrap p-3 rounded-2xl" style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)" }}>
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
        )}
      </div>

      {/* Summary cards — Revenue hero full-width, then 2×2 grid */}
      <div className="space-y-3">
        {/* Hero: Total Revenue — full width */}
        <SummaryCard
          label="Total Revenue"
          value={`MVR ${totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          icon={TrendingUp}
          tokenColor="var(--snm-success)"
          hero
        />
        {/* 2×2 grid for remaining 4 metrics */}
        <div className="grid grid-cols-2 gap-3">
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
            tokenColor="var(--snm-info)"
          />
          <SummaryCard
            label="Low Stock SKUs"
            value={String(totals.lowStock)}
            icon={Clock}
            tokenColor={totals.lowStock > 0 ? "var(--snm-error)" : "var(--muted-foreground)"}
          />
          <SummaryCard
            label="Total Campaign Spend"
            value={totals.totalSpend > 0 ? `MVR ${totals.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
            sublabel={totals.totalSpend > 0 ? `MVR ${totals.periodSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })} this period` : undefined}
            icon={Megaphone}
            tokenColor="var(--snm-warning)"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)" }}>
        {([
          { key: "bestsellers",  label: "Best Sellers" },
          { key: "margins",      label: "Margins" },
          { key: "contribution", label: "Contribution" },
          { key: "abc",          label: "ABC" },
          { key: "stock",        label: "Days of Stock" },
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
          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}
        />
        {q && (
          <button
            onClick={() => setQ("")}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center active:opacity-60"
          >
            <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}>
              <X className="h-3 w-3" />
            </span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="snm-card p-12 flex flex-col items-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mb-3" />
          <p className="text-sm">Loading…</p>
        </div>
      ) : tab === "contribution" ? (
        contribFiltered.length === 0 ? (
          <div className="snm-card p-10 text-center">
            <p className="text-muted-foreground text-sm">No sales in this period.</p>
          </div>
        ) : (
          <ContributionTable rows={contribFiltered} />
        )
      ) : tab === "abc" ? (
        abcFiltered.length === 0 ? (
          <div className="snm-card p-10 text-center">
            <p className="text-muted-foreground text-sm">No sales in this period.</p>
          </div>
        ) : (
          <AbcTable rows={abcFiltered} />
        )
      ) : filtered.length === 0 ? (
        <div className="snm-card p-10 text-center">
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

function SummaryCard({ label, value, sublabel, icon: Icon, tokenColor, hero }: {
  label: string; value: string; sublabel?: string; icon: typeof TrendingUp; tokenColor: string; hero?: boolean;
}) {
  if (hero) {
    return (
      <div className="glass p-5 flex items-center justify-between gap-4 rounded-2xl">
        <div className="space-y-1">
          <p className="text-[12px] uppercase tracking-widest text-muted-foreground">{label}</p>
          <p className="snm-num text-[32px] font-bold tracking-tight leading-none text-foreground">{value}</p>
          {sublabel && <p className="text-[12px] text-muted-foreground">{sublabel}</p>}
        </div>
        <div
          className="h-12 w-12 rounded-2xl flex items-center justify-center shrink-0"
          style={{
            background: `color-mix(in srgb, ${tokenColor} 14%, transparent)`,
            color: tokenColor,
          }}
        >
          <Icon className="h-6 w-6" />
        </div>
      </div>
    );
  }
  return (
    <div className="glass p-4 space-y-2 rounded-2xl">
      <div
        className="h-8 w-8 rounded-lg flex items-center justify-center"
        style={{
          background: `color-mix(in srgb, ${tokenColor} 12%, transparent)`,
          color: tokenColor,
        }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <p className="snm-num text-[22px] font-bold tracking-tight leading-none text-foreground">{value}</p>
      <p className="text-[12px] uppercase tracking-widest text-muted-foreground leading-tight">{label}</p>
      {sublabel && <p className="text-[11px] text-muted-foreground leading-tight -mt-1">{sublabel}</p>}
    </div>
  );
}

// ── Sort header helper ───────────────────────────────────────────────────

function SortTh({ label, sortKey, active, onSort }: {
  label: string; sortKey: SortKey; active: SortKey; onSort: (k: SortKey) => void;
}) {
  return (
    <th
      className={`px-3 py-2 text-right text-[12px] uppercase tracking-widest cursor-pointer select-none transition ${
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
              <th className="px-3 py-2 text-left text-[12px] uppercase tracking-widest text-muted-foreground">Product</th>
              <SortTh label="Revenue (MVR)" sortKey="revenue" active={sortKey} onSort={onSort} />
              <SortTh label="Qty Sold" sortKey="qty" active={sortKey} onSort={onSort} />
              <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Avg Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => {
              const cfg = tradeCfg(r);
              const avgPrice = costPerTradeUnit(r.avg_unit_price_mvr, cfg);
              return (
              <tr key={r.sku_id} className="hover:bg-accent/20 transition">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono w-5 text-center ${i < 3 ? "text-primary font-bold" : "text-muted-foreground"}`}>
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-foreground text-sm">{r.brand_name} › {r.model_name} › {r.variant_display}</p>
                      <p className="text-[12px] text-muted-foreground">{r.internal_code}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-right snm-num">
                  <span className="text-foreground font-medium">
                    {r.total_revenue_mvr > 0
                      ? r.total_revenue_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })
                      : <span className="text-muted-foreground">—</span>}
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground snm-num">
                  {r.total_qty_pieces > 0 ? formatQtyInTradeUnits(r.total_qty_pieces, cfg) : "—"}
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground snm-num">
                  {r.avg_unit_price_mvr > 0 ? `${avgPrice.value.toFixed(2)}/${avgPrice.unitLabel}` : "—"}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Contribution margin table ─────────────────────────────────────────────
// True profit per SKU: revenue − landed cost − allocated marketing spend.

function ContributionTable({ rows }: { rows: ContributionRow[] }) {
  return (
    <div className="glass overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/50">
            <tr>
              <th className="px-3 py-2 text-left text-[12px] uppercase tracking-widest text-muted-foreground">Product</th>
              <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Revenue</th>
              <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Landed</th>
              <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Marketing</th>
              <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Contribution</th>
              <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Contr. %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const fmt0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
              return (
                <tr key={r.sku_id} className="hover:bg-accent/20 transition">
                  <td className="px-3 py-3">
                    <p className="text-foreground text-sm">{r.brand_name} › {r.model_name} › {r.variant_display}</p>
                    <p className="text-[12px] text-muted-foreground">{r.internal_code}</p>
                  </td>
                  <td className="px-3 py-3 text-right text-foreground font-medium snm-num">{fmt0(r.total_revenue_mvr)}</td>
                  <td className="px-3 py-3 text-right text-muted-foreground snm-num">{fmt0(r.total_landed_cost_mvr)}</td>
                  <td className="px-3 py-3 text-right snm-num" style={{ color: r.marketing_spend_mvr > 0 ? "var(--snm-warning)" : "var(--muted-foreground)" }}>
                    {r.marketing_spend_mvr > 0 ? fmt0(r.marketing_spend_mvr) : "—"}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold snm-num" style={{ color: r.contribution_mvr >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                    {fmt0(r.contribution_mvr)}
                  </td>
                  <td className="px-3 py-3 text-right font-bold snm-num" style={marginColor(r.contribution_margin_pct)}>
                    {r.contribution_margin_pct != null ? r.contribution_margin_pct.toFixed(1) + "%" : "—"}
                    {r.has_estimated_cost && (
                      <span
                        className="ml-1 text-[12px] font-medium align-middle"
                        style={{ color: "var(--muted-foreground)" }}
                        title="Some sales in this period were made before per-sale cost tracking started — their cost is estimated from today's price, not what it actually cost then."
                      >
                        ~est
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ABC analysis table ────────────────────────────────────────────────────
// Revenue-based Pareto classification (fmcg-import-expert doctrine):
//   A = top 80% of cumulative revenue · B = next 15% · C = bottom 5%.
// Classification + cumulative share are computed in Postgres (get_abc_analysis).

function abcClassStyle(cls: "A" | "B" | "C"): React.CSSProperties {
  if (cls === "A") return { background: "color-mix(in srgb, var(--snm-success) 16%, transparent)", color: "var(--snm-success)" };
  if (cls === "B") return { background: "color-mix(in srgb, var(--snm-warning) 16%, transparent)", color: "var(--snm-warning)" };
  return { background: "color-mix(in srgb, var(--snm-error) 16%, transparent)", color: "var(--snm-error)" };
}

function AbcTable({ rows }: { rows: AbcRow[] }) {
  const counts = useMemo(() => ({
    A: rows.filter((r) => r.abc_class === "A").length,
    B: rows.filter((r) => r.abc_class === "B").length,
    C: rows.filter((r) => r.abc_class === "C").length,
  }), [rows]);

  return (
    <div className="space-y-3">
      {/* Class summary chips */}
      <div className="grid grid-cols-3 gap-3">
        {(["A", "B", "C"] as const).map((cls) => (
          <div key={cls} className="glass p-3 rounded-2xl flex items-center gap-3">
            <span className="h-9 w-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0" style={abcClassStyle(cls)}>
              {cls}
            </span>
            <div>
              <p className="snm-num text-[20px] font-bold leading-none text-foreground">{counts[cls]}</p>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground mt-1">SKUs</p>
            </div>
          </div>
        ))}
      </div>

      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/50">
              <tr>
                <th className="px-3 py-2 text-left text-[12px] uppercase tracking-widest text-muted-foreground">Product</th>
                <th className="px-3 py-2 text-center text-[12px] uppercase tracking-widest text-muted-foreground">Class</th>
                <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Revenue</th>
                <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Share</th>
                <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Cumulative</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.sku_id} className="hover:bg-accent/20 transition">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono w-5 text-center text-muted-foreground">{r.rank}</span>
                      <div>
                        <p className="text-foreground text-sm">{r.brand_name} › {r.model_name} › {r.variant_display}</p>
                        <p className="text-[12px] text-muted-foreground">{r.internal_code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold" style={abcClassStyle(r.abc_class)}>
                      {r.abc_class}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right text-foreground font-medium snm-num">
                    {r.total_revenue_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground snm-num">{r.revenue_share_pct.toFixed(1)}%</td>
                  <td className="px-3 py-3 text-right text-muted-foreground snm-num">{r.cumulative_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-border bg-secondary/30">
          <p className="text-[12px] text-muted-foreground">
            A = top 80% of revenue (tight control) · B = next 15% · C = bottom 5% (bulk-buy) · ranked by revenue in period
          </p>
        </div>
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
              <th className="px-3 py-2 text-left text-[12px] uppercase tracking-widest text-muted-foreground">Product</th>
              <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Landed</th>
              <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Sell</th>
              <SortTh label="Margin %" sortKey="margin" active={sortKey} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const cfg = tradeCfg(r);
              const landed = costPerTradeUnit(r.landed_per_piece_mvr, cfg);
              const sell = costPerTradeUnit(r.avg_unit_price_mvr, cfg);
              return (
              <tr key={r.sku_id} className="hover:bg-accent/20 transition">
                <td className="px-3 py-3">
                  <p className="text-foreground text-sm">{r.brand_name} › {r.model_name} › {r.variant_display}</p>
                  <p className="text-[12px] text-muted-foreground">{r.internal_code}</p>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground snm-num">
                  {r.landed_per_piece_mvr > 0 ? `${landed.value.toFixed(2)}/${landed.unitLabel}` : "—"}
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground snm-num">
                  {r.avg_unit_price_mvr > 0 ? `${sell.value.toFixed(2)}/${sell.unitLabel}` : "—"}
                </td>
                <td className="px-3 py-3 text-right snm-num">
                  {r.gross_margin_pct !== null ? (
                    <span className="font-semibold" style={marginColor(r.gross_margin_pct)}>
                      {r.gross_margin_pct}%
                      {r.gross_margin_pct >= 30
                        ? <TrendingUp className="inline h-3 w-3 ml-1" />
                        : r.gross_margin_pct < 15
                        ? <TrendingDown className="inline h-3 w-3 ml-1" />
                        : null}
                      {r.has_estimated_cost && (
                        <span
                          className="ml-1 text-[12px] font-medium align-middle"
                          style={{ color: "var(--muted-foreground)" }}
                          title="Some sales in this period were made before per-sale cost tracking started — their cost is estimated from today's price, not what it actually cost then."
                        >
                          ~est
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No sales</span>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-border bg-secondary/30">
        <p className="text-[12px] text-muted-foreground">
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
                <span className="text-muted-foreground font-medium snm-num">
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
                <th className="px-3 py-2 text-left text-[12px] uppercase tracking-widest text-muted-foreground">Campaign</th>
                <th className="px-3 py-2 text-left text-[12px] uppercase tracking-widest text-muted-foreground">Channel</th>
                <th className="px-3 py-2 text-left text-[12px] uppercase tracking-widest text-muted-foreground">Period</th>
                <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Amount (MVR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {spend.map((s) => (
                <tr key={s.id} className="hover:bg-accent/20 transition">
                  <td className="px-3 py-3">
                    <p className="text-foreground">{s.campaign_name ?? "—"}</p>
                    {s.notes && <p className="text-[12px] text-muted-foreground">{s.notes}</p>}
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
              <th className="px-3 py-2 text-left text-[12px] uppercase tracking-widest text-muted-foreground">Product</th>
              <SortTh label="Stock" sortKey="stock" active={sortKey} onSort={onSort} />
              <th className="px-3 py-2 text-right text-[12px] uppercase tracking-widest text-muted-foreground">Daily Avg</th>
              <SortTh label="Days Left" sortKey="days" active={sortKey} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const days = Math.max(periodDays, 1);
              const cfg = tradeCfg(r);
              const dailyAvgPieces = r.total_qty_pieces > 0 ? r.total_qty_pieces / days : 0;
              return (
                <tr key={r.sku_id} className="hover:bg-accent/20 transition">
                  <td className="px-3 py-3">
                    <p className="text-foreground text-sm">{r.brand_name} › {r.model_name} › {r.variant_display}</p>
                    <p className="text-[12px] text-muted-foreground">{r.internal_code}</p>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <p className="text-foreground text-sm">
                      {formatQtyInTradeUnits(r.stock_pieces, cfg)}
                    </p>
                    <p className="text-[12px] text-muted-foreground">{r.stock_pieces.toLocaleString()} pcs</p>
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground text-sm">
                    {dailyAvgPieces > 0 ? `${formatQtyInTradeUnits(Math.round(dailyAvgPieces), cfg)}/day` : "—"}
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
        <p className="text-[12px] text-muted-foreground">
          Green &gt; 30 days · Amber 14–30 days · Red &lt; 14 days · Based on sales velocity in selected period
        </p>
      </div>
    </div>
  );
}

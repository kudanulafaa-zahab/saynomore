"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { mvtPlainDay, mvtToday } from "@/lib/mvt-date";
import {
  Loader2, Trash2, X, ChevronRight, Check, RefreshCw,
} from "lucide-react";
import {
  listMarketingSpend,
  createMarketingSpend,
  updateMarketingSpend,
  listExpenseCategories,
  listBusinessExpenses,
  createBusinessExpense,
  deleteBusinessExpense,
  listRecurringExpenses,
  createRecurringExpense,
  endRecurringExpense,
  type MarketingSpendRow,
  type SpendChannel,
  type ExpenseCategoryRow,
  type BusinessExpenseRow,
  type RecurringExpenseRow,
} from "@/lib/queries/expenses";
import { getCurrentUserRole, type SkuFullRow } from "@/lib/queries/products";
import { SelectionMark } from "@/components/ui/selection-mark";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { withOfflineFallback } from "@/lib/offline-write";
import { SkeletonRows } from "@/components/layout/page-skeleton";
import { haptic } from "@/lib/haptics";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { BodyPortal } from "@/components/ui/body-portal";
import { useOnMount } from "@/lib/use-on-mount";

const CHANNEL_LABEL: Record<SpendChannel, string> = {
  meta_boost: "Meta Boost",
  google:     "Google Ads",
  tiktok_ad:  "TikTok Ads",
  other:      "Other",
};

function fmt(n: number) {
  return n.toLocaleString("en-MV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtShort(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toFixed(0);
}

export function ExpensesView() {
  const [rows, setRows] = useState<MarketingSpendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteBizTarget, setDeleteBizTarget] = useState<BusinessExpenseRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const today = mvtToday();
  const [quickAmount, setQuickAmount] = useState("");
  const [quickDate, setQuickDate] = useState(today);
  const [loggingQuick, setLoggingQuick] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [quickAmountError, setQuickAmountError] = useState(false);
  const [quickCategoryError, setQuickCategoryError] = useState(false);

  // Standing monthly costs (0167). Defaults to OFF so the quick bar behaves
  // exactly as it always has for a one-off cost; rent and salaries are the
  // reason it exists, and the empty-state below is what points at it.
  const [repeatMonthly, setRepeatMonthly] = useState(false);
  const [recurring, setRecurring] = useState<RecurringExpenseRow[]>([]);
  const [endTarget, setEndTarget] = useState<RecurringExpenseRow | null>(null);
  const [ending, setEnding] = useState(false);

  // General business expenses (rent, salaries, …) — these feed the P&L's
  // Operating Expenses line. Marketing campaigns stay their own thing.
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const [bizRows, setBizRows]       = useState<BusinessExpenseRow[]>([]);
  const [quickCategoryId, setQuickCategoryId] = useState<string>("");
  const [quickOther, setQuickOther] = useState("");        // free-text when category = Other
  const [quickOtherError, setQuickOtherError] = useState(false);

  // Is the chosen quick-log category the generic "Other" bucket? If so we need
  // the user to name the expense (otherwise a pile of "Other" rows is useless).
  const quickIsOther = categories.find((c) => c.id === quickCategoryId)?.name?.toLowerCase() === "other";

  useEffect(() => {
    getCurrentUserRole().then((r) => setCanWrite(r !== "viewer")).catch(() => {});
  }, []);

  async function load() {
    try {
      const [r, cats, biz, rec] = await Promise.all([
        listMarketingSpend(), listExpenseCategories(), listBusinessExpenses(),
        listRecurringExpenses(),
      ]);
      setRows(r);
      setCategories(cats);
      setBizRows(biz);
      setRecurring(rec);
      setQuickCategoryId((prev) => prev || cats[0]?.id || "");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useOnMount(load);

  const totalMvr = useMemo(() => rows.reduce((a, r) => a + Number(r.amount_mvr), 0), [rows]);

  const bizThisMonth = useMemo(() => {
    const m = new Date().toISOString().slice(0, 7);
    return bizRows.filter((r) => r.expense_date.startsWith(m)).reduce((a, r) => a + Number(r.amount_mvr), 0);
  }, [bizRows]);

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  async function handleEndRecurring() {
    if (!endTarget) return;
    setEnding(true);
    try {
      // ends_on is the LAST month it applies — this month. Next month's
      // generation skips it; every month already filled in is untouched.
      await endRecurringExpense(endTarget.id, today);
      haptic("success");
      toast.success("Stopped — earlier months are unchanged");
      setEndTarget(null);
      load();
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setEnding(false);
    }
  }

  async function handleQuickLog() {
    const amt = parseFloat(quickAmount);
    const amountBad = !amt || amt <= 0;
    const categoryBad = !quickCategoryId;
    const otherBad = quickIsOther && !quickOther.trim();
    setQuickAmountError(amountBad);
    setQuickCategoryError(categoryBad);
    setQuickOtherError(otherBad);
    if (amountBad) { toast.error("Enter an amount"); return; }
    if (categoryBad) { toast.error("Pick a category"); return; }
    if (otherBad) { toast.error("Say what this 'Other' expense is"); return; }
    setLoggingQuick(true);

    // EVERY MONTH takes a different door: it writes a TEMPLATE, and Postgres
    // generates the actual expense rows from it (0167). Deliberately not sent
    // through withOfflineFallback — the offline queue replays a plain table
    // insert, and this insert fires a trigger that back-fills every month since
    // the start date. Queuing it would mean the months appear at an
    // unpredictable later time, which is not a good trade for a cost you set
    // once. One-off expenses keep the offline path they have always had.
    if (repeatMonthly) {
      const desc = quickIsOther ? quickOther.trim() : null;
      try {
        await createRecurringExpense({
          category_id: quickCategoryId,
          amount_mvr: amt,
          starts_on: quickDate || today,
          description: desc,
        });
        haptic("success");
        toast.success("Recurring expense saved — every month is posted for you");
        setQuickAmount("");
        setQuickDate(today);
        setQuickOther("");
        setQuickOtherError(false);
        setRepeatMonthly(false);
        load();
      } catch (e) {
        haptic("error");
        toast.error((e as Error).message);
      } finally {
        setLoggingQuick(false);
      }
      return;
    }

    const payload = {
      category_id: quickCategoryId,
      amount_mvr: amt,
      // Date defaults to today but is editable so a cost can be back-dated or
      // corrected — it drives which month the P&L books the expense in.
      expense_date: quickDate || today,
      // For "Other", the typed label IS the description so the row is meaningful.
      description: quickIsOther ? quickOther.trim() : null,
    };
    try {
      const { queued } = await withOfflineFallback(
        () => createBusinessExpense(payload),
        { table: "business_expenses", action: "insert", payload },
      );
      haptic("success");
      toast.success(queued ? "Saved offline — will sync when connected" : "Expense logged");
      setQuickAmount("");
      setQuickDate(today);
      setQuickOther("");
      setQuickOtherError(false);
      if (!queued) load();
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setLoggingQuick(false);
    }
  }

  async function handleDeleteBiz() {
    if (!deleteBizTarget) return;
    setDeleting(true);
    try {
      await deleteBusinessExpense(deleteBizTarget.id);
      haptic("success");
      toast.success("Expense removed");
      setDeleteBizTarget(null);
      load();
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <SkeletonRows rows={6} />;
  }

  return (
    <div className="space-y-6 pb-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Finance</p>
          <h1 className="ios-page-title">Expenses</h1>
        </div>
      </div>

      {/* Summary — this page is the money-out ledger. Campaign THINKING
          (promo advisor, competitor prices, logging campaigns) lives in
          Market; spend still totals here because it is an expense. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass p-4 rounded-2xl space-y-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">This Month</p>
          <p className="text-xl font-semibold text-foreground snm-num">
            {bizThisMonth > 0 ? `MVR ${fmtShort(bizThisMonth)}` : "—"}
          </p>
          <p className="ios-subhead text-muted-foreground">rent, salaries, running costs</p>
        </div>
        <Link href="/competitors" className="glass p-4 rounded-2xl space-y-1 block active:scale-[0.98] transition">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Marketing</p>
          <p className="text-xl font-semibold text-foreground snm-num">MVR {fmtShort(totalMvr)}</p>
          <p className="ios-subhead" style={{ color: "var(--snm-brand-text)" }}>{rows.length} campaign{rows.length === 1 ? "" : "s"} · manage in Market ›</p>
        </Link>
      </div>

      {/* Quick log bar — general business expenses (feeds the P&L's
          Operating Expenses line). Marketing campaigns use Log Campaign. */}
      <div className="glass p-3 rounded-2xl">
        <p className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">
          Quick log — business expense
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-[120px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 ios-subhead text-muted-foreground pointer-events-none">MVR</span>
            <input
              type="number" inputMode="decimal" min="0"
              placeholder="0.00"
              value={quickAmount}
              onChange={(e) => { setQuickAmount(e.target.value); if (parseFloat(e.target.value) > 0) setQuickAmountError(false); }}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => e.key === "Enter" && handleQuickLog()}
              className="w-full h-11 pl-12 pr-3 rounded-xl ios-subhead bg-secondary text-foreground outline-none"
              style={{ border: quickAmountError ? "1.5px solid var(--snm-error)" : "1px solid var(--border)" }}
            />
          </div>
          <select
            value={quickCategoryId}
            onChange={(e) => { setQuickCategoryId(e.target.value); if (e.target.value) setQuickCategoryError(false); }}
            className="h-11 px-3 rounded-xl ios-subhead bg-secondary text-foreground outline-none"
            style={{ border: quickCategoryError ? "1.5px solid var(--snm-error)" : "1px solid var(--border)" }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {/* Does this expense recur? THE reason business_expenses held one row for
            months: rent and salaries are the same every month, and the app was
            asking for them again every month. Both pills carry real
            --foreground text on --glass-bg-1 — an unselected pill here is a
            CHOICE, not a hint, so it is never muted-on-transparent. */}
        <div className="flex items-center gap-2 mt-2" role="group" aria-label="Does this expense recur?">
          {([
            { on: false, label: "One time" },
            { on: true,  label: "Every month" },
          ] as const).map((opt) => {
            const active = repeatMonthly === opt.on;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => setRepeatMonthly(opt.on)}
                aria-pressed={active}
                className="flex-1 h-11 rounded-xl ios-subhead font-semibold flex items-center justify-center gap-1.5 snm-pressable"
                style={{
                  background: active ? "var(--foreground)" : "var(--glass-bg-1)",
                  color:      active ? "var(--background)" : "var(--foreground)",
                  border:     active ? "none" : "1px solid var(--glass-border-lo)",
                }}
              >
                {active && <Check className="h-4 w-4 shrink-0" />}
                {opt.label}
              </button>
            );
          })}
        </div>

        {repeatMonthly && (
          <p className="ios-footnote mt-2 px-1" style={{ color: "var(--foreground)", opacity: 0.75 }}>
            Set it once. Every month from the date below is posted automatically,
            including months already past, so earlier Net Profit is corrected too.
          </p>
        )}

        {/* Date + Log — date defaults to today, capped at today so a cost can
            be back-dated or corrected but not accidentally booked in the future. */}
        <div className="flex items-center gap-2 mt-2">
          <input
            type="date" value={quickDate} max={today}
            onChange={(e) => setQuickDate(e.target.value)}
            aria-label={repeatMonthly ? "First month this cost applies" : "Expense date"}
            className="flex-1 min-w-0 h-11 px-3 rounded-xl ios-subhead bg-secondary text-foreground outline-none"
            style={{ border: "1px solid var(--border)" }}
          />
          <button
            onClick={handleQuickLog}
            disabled={loggingQuick || !quickAmount || (quickIsOther && !quickOther.trim())}
            className="h-11 px-5 rounded-xl ios-subhead font-semibold shrink-0 disabled:opacity-50"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {loggingQuick ? <Loader2 className="h-4 w-4 animate-spin" /> : repeatMonthly ? "Save" : "Log"}
          </button>
        </div>

        {/* "Other" needs a name — only shown when the Other category is chosen,
            so a generic "Other" row is never left unexplained in the P&L. */}
        {quickIsOther && (
          <input
            value={quickOther}
            onChange={(e) => { setQuickOther(e.target.value); if (e.target.value.trim()) setQuickOtherError(false); }}
            onKeyDown={(e) => e.key === "Enter" && handleQuickLog()}
            placeholder="What is this expense? e.g. Printer repair"
            autoFocus
            className="w-full h-11 px-3 mt-2 rounded-xl ios-subhead bg-secondary text-foreground outline-none"
            style={{ border: quickOtherError ? "1.5px solid var(--snm-error)" : "1px solid var(--border)" }}
          />
        )}
      </div>

      {/* ── Your monthly costs ────────────────────────────────────────────────
          The standing costs the P&L needs to be true. When there are none this
          is the empty state that explains WHY it matters in money terms —
          silent-when-healthy does not apply here, because the absence of this
          data is itself the problem (the P&L reported MVR 13,790 profit with
          zero running costs behind it). Once costs exist it becomes a plain
          list and stops lecturing. */}
      {recurring.length > 0 ? (
        <div className="mt-6">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Recurring Expenses</h2>
            <p className="ios-subhead font-semibold snm-num" style={{ color: "var(--foreground)" }}>
              MVR {fmt(recurring.reduce((a, r) => a + Number(r.amount_mvr), 0))}<span className="ios-footnote font-normal" style={{ opacity: 0.7 }}> a month</span>
            </p>
          </div>
          <div className="glass rounded-2xl overflow-hidden">
            {recurring.map((r, i) => (
              <div
                key={r.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderTop: i === 0 ? "none" : "0.5px solid var(--glass-border-lo)" }}
              >
                <RefreshCw className="h-4 w-4 shrink-0" style={{ color: "var(--foreground)", opacity: 0.55 }} />
                <div className="min-w-0 flex-1">
                  <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
                    {catName(r.category_id)}
                  </p>
                  <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                    {r.description ? `${r.description} · ` : ""}
                    Every month{r.starts_on ? ` since ${mvtPlainDay(r.starts_on)}` : ""}
                  </p>
                </div>
                <p className="ios-subhead font-semibold snm-num shrink-0" style={{ color: "var(--foreground)" }}>
                  MVR {fmt(Number(r.amount_mvr))}
                </p>
                {canWrite && (
                  <button
                    onClick={() => setEndTarget(r)}
                    aria-label={`Stop recurring ${catName(r.category_id)}`}
                    className="w-11 h-11 -mr-2 flex items-center justify-center shrink-0 active:opacity-60"
                  >
                    <X className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="ios-footnote mt-2 px-1" style={{ color: "var(--foreground)", opacity: 0.7 }}>
            Posted automatically each month. To correct a single month, edit that
            month&apos;s expense in the list below — your edit is never overwritten.
          </p>
        </div>
      ) : canWrite ? (
        <div className="mt-6 glass rounded-2xl p-4">
          <p className="ios-subhead font-semibold mb-1" style={{ color: "var(--foreground)" }}>
            No recurring operating expenses set up
          </p>
          <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.8 }}>
            Rent, salaries, fuel and phone recur every month, so the app can post
            them for you. Until they are recorded, Net Profit on Financials is
            overstated — it has no operating expenses deducted.
          </p>
          <p className="ios-footnote mt-2" style={{ color: "var(--foreground)", opacity: 0.8 }}>
            Add one above with <strong>Every month</strong> chosen.
          </p>
        </div>
      ) : null}

      {/* Business expenses — recent */}
      {bizRows.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Business Expenses</h2>
          <div className="glass rounded-2xl overflow-hidden">
            {bizRows.slice(0, 10).map((r, i) => (
              <div
                key={r.id}
                className="flex items-center justify-between px-4 py-3"
                style={i > 0 ? { borderTop: "0.5px solid var(--glass-border-lo)" } : undefined}
              >
                <div className="min-w-0">
                  <p className="ios-subhead font-medium text-foreground">{catName(r.category_id)}</p>
                  <p className="ios-subhead text-muted-foreground">
                    {mvtPlainDay(r.expense_date)}
                    {r.description ? ` · ${r.description}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p className="ios-subhead font-semibold text-foreground snm-num">MVR {fmt(Number(r.amount_mvr))}</p>
                  {canWrite && (
                    <button
                      onClick={() => setDeleteBizTarget(r)}
                      aria-label="Delete expense"
                      className="h-11 w-11 -m-1.5 flex items-center justify-center"
                    >
                      <span className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)" }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Business-expense delete confirm — never delete without asking */}
      <ConfirmSheet
        open={deleteBizTarget !== null}
        onClose={() => setDeleteBizTarget(null)}
        onConfirm={handleDeleteBiz}
        loading={deleting}
        title="Delete expense?"
        message={
          deleteBizTarget
            ? `${catName(deleteBizTarget.category_id)} · MVR ${fmt(Number(deleteBizTarget.amount_mvr))} will be permanently removed.`
            : ""
        }
        confirmLabel="Delete"
      />

      {/* Stopping a monthly cost is NOT deleting it. The months it has already
          filled in were really paid, so they stay — removing them would rewrite
          finished months and change past profit. It simply stops from next
          month. Said in those words, because "delete" would imply otherwise. */}
      <ConfirmSheet
        open={endTarget !== null}
        onClose={() => setEndTarget(null)}
        onConfirm={handleEndRecurring}
        loading={ending}
        title="Stop this recurring expense?"
        message={
          endTarget
            ? `${catName(endTarget.category_id)} · MVR ${fmt(Number(endTarget.amount_mvr))} a month will stop from next month. Expenses already posted stay as they are.`
            : ""
        }
        confirmLabel="Stop"
      />
    </div>
  );
}

// ── Spend Sheet ──────────────────────────────────────────────────────────────

export function SpendSheet({ editing, skus, onClose, onDone }: {
  editing?: MarketingSpendRow;
  skus: SkuFullRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  useBodyScrollLock(true);
  const [channel, setChannel] = useState<SpendChannel>(editing?.channel ?? "meta_boost");
  const [amountMvr, setAmountMvr] = useState(editing ? String(editing.amount_mvr) : "");
  const [campaignName, setCampaignName] = useState(editing?.campaign_name ?? "");
  const [startDate, setStartDate] = useState(editing?.start_date ?? mvtToday());
  const [endDate, setEndDate] = useState(editing?.end_date ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [selectedSkuIds, setSelectedSkuIds] = useState<string[]>(editing?.sku_ids ?? []);
  const [skuSearch, setSkuSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // Campaigns run for a RANGE, not hand-picked SKUs. Group active SKUs into
  // Brand → Product line (model), so the user attaches "All Mamypoko" or a
  // whole line in one tap; on save it fans out to the underlying SKU ids so the
  // per-SKU attribution math (spend ÷ units sold) still works underneath.
  const activeSkus = useMemo(() => skus.filter((s) => s.is_active), [skus]);

  const groups = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    const match = (s: SkuFullRow) =>
      !term || [s.brand_name, s.model_name, s.variant_display].join(" ").toLowerCase().includes(term);
    // Brand → { name, skuIds, models: Model → { name, skuIds, skus[] } }
    const brands = new Map<string, { name: string; skuIds: string[]; models: Map<string, { name: string; skuIds: string[]; skus: SkuFullRow[] }> }>();
    for (const s of activeSkus) {
      if (!match(s)) continue;
      let b = brands.get(s.brand_id);
      if (!b) { b = { name: s.brand_name, skuIds: [], models: new Map() }; brands.set(s.brand_id, b); }
      b.skuIds.push(s.id);
      let m = b.models.get(s.model_id);
      if (!m) { m = { name: s.model_name, skuIds: [], skus: [] }; b.models.set(s.model_id, m); }
      m.skuIds.push(s.id);
      m.skus.push(s);
    }
    return [...brands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [activeSkus, skuSearch]);

  const selectedSet = useMemo(() => new Set(selectedSkuIds), [selectedSkuIds]);
  // How many of a group's SKUs are selected: "none" | "some" | "all".
  const coverage = (ids: string[]): "none" | "some" | "all" => {
    const n = ids.filter((id) => selectedSet.has(id)).length;
    return n === 0 ? "none" : n === ids.length ? "all" : "some";
  };
  // Tap a range: if fully selected → clear it, else select all its SKUs.
  function toggleRange(ids: string[]) {
    setSelectedSkuIds((prev) => {
      const cov = ids.every((id) => prev.includes(id)) ? "all" : "partial";
      if (cov === "all") return prev.filter((id) => !ids.includes(id));
      const set = new Set(prev); ids.forEach((id) => set.add(id));
      return [...set];
    });
  }
  function toggleSku(id: string) {
    setSelectedSkuIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);

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
      haptic("success");
      toast.success(editing ? "Updated" : "Expense logged");
      onDone();
    } catch (e) { haptic("error"); toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  const field = "w-full h-11 px-3 rounded-xl text-sm bg-secondary text-foreground border border-border outline-none";
  const label = "block text-xs uppercase tracking-widest text-muted-foreground mb-1.5";

  // Native bottom sheet — same structure as the app's other sheets: a
  // fixed-height panel (does NOT scroll itself), pinned header + footer, and
  // ONE inner scroll region. Tapping the dimmed backdrop closes it and no drag
  // reaches the page behind, so it feels docked/native, not like a webpage.
  return (
    <BodyPortal>
    <div
      className="fixed inset-0 z-60 flex items-end snm-scrim-in"
      style={{ background: "var(--scrim-bg)", touchAction: "none" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
        style={{
          background: "var(--background)",
          borderTop: "0.5px solid var(--glass-border-lo)",
          boxShadow: "var(--glass-shadow-lg)",
          height: "88dvh",
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
          touchAction: "none",
        }}
      >
        {/* Fixed header — grabber + title stay pinned */}
        <div className="shrink-0 px-5 pt-3">
          <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              {editing ? "Edit Expense" : "Log Expense"}
            </h2>
            <button onClick={onClose} className="h-11 w-11 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body — the ONLY scroll region. touchAction: pan-y so a
            drag here scrolls vertically only — never pans/drags the sheet
            itself sideways (the panel + backdrop block all panning above). */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pb-4" style={{ touchAction: "pan-y" }}>
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
                onFocus={(e) => e.target.select()}
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

          {/* Promote which products? Attach the campaign to a whole brand or a
              product line in one tap — it fans out to SKUs on save. */}
          <div className="mb-3">
            <label className={label}>Promote which products? <span className="normal-case tracking-normal text-muted-foreground/60">(optional)</span></label>
            <p className="ios-footnote text-muted-foreground mb-2 -mt-0.5">Pick a whole brand or a product line — expand to fine-tune single SKUs.</p>
            {selectedSkuIds.length > 0 && (
              <p className="ios-footnote font-semibold mb-2" style={{ color: "var(--snm-brand-text)" }}>
                {selectedSkuIds.length} SKU{selectedSkuIds.length > 1 ? "s" : ""} attached
              </p>
            )}
            <input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} placeholder="Search brand, line, product…" className={field + " mb-1.5"} />
            <div className="bg-secondary/50 rounded-xl max-h-56 overflow-y-auto border border-border">
              {groups.length === 0 ? (
                <p className="ios-subhead text-muted-foreground px-3 py-2">No matches</p>
              ) : groups.map((b, bi) => {
                const cov = coverage(b.skuIds);
                // Only the tapped brand expands — searching already narrows
                // WHICH brands/lines show (see `groups` above), so forcing every
                // matched brand open on each keystroke caused the whole list to
                // suddenly jump/resize as you typed. Tap a chevron to drill in.
                const open = expandedBrand === b.name;
                return (
                  <div key={b.name} className={bi > 0 ? "border-t border-border" : ""}>
                    {/* Brand row */}
                    <div className="flex items-center">
                      <button
                        onClick={() => toggleRange(b.skuIds)}
                        className="flex-1 min-w-0 flex items-center gap-2 text-left px-3 py-2.5 ios-subhead font-semibold text-foreground"
                      >
                        <SelectionMark state={cov} size={17} />
                        <span className="truncate min-w-0">{b.name}</span>
                        <span className="ios-footnote font-normal text-muted-foreground shrink-0">
                          {cov === "all" ? "all" : cov === "some" ? `${b.skuIds.filter((id) => selectedSet.has(id)).length}/${b.skuIds.length}` : `${b.skuIds.length} SKUs`}
                        </span>
                      </button>
                      <button onClick={() => setExpandedBrand(open ? null : b.name)} className="h-11 w-10 flex items-center justify-center text-muted-foreground shrink-0">
                        <ChevronRight className="h-4 w-4 transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} />
                      </button>
                    </div>
                    {/* Product lines + SKUs */}
                    {open && [...b.models.values()].sort((a, c) => a.name.localeCompare(c.name)).map((m) => {
                      const mcov = coverage(m.skuIds);
                      return (
                        <div key={m.name} className="border-t border-border/60">
                          <button
                            onClick={() => toggleRange(m.skuIds)}
                            className="w-full flex items-center gap-2 text-left pl-8 pr-3 py-2 ios-subhead text-foreground"
                          >
                            <SelectionMark state={mcov} size={15} />
                            <span className="truncate">{m.name}</span>
                            <span className="ios-footnote text-muted-foreground">
                              {mcov === "all" ? "all" : mcov === "some" ? `${m.skuIds.filter((id) => selectedSet.has(id)).length}/${m.skuIds.length}` : `${m.skuIds.length}`}
                            </span>
                          </button>
                          {m.skus.map((s) => (
                            <button
                              key={s.id} onClick={() => toggleSku(s.id)}
                              className="w-full flex items-center gap-2 text-left pl-14 pr-3 py-1.5 ios-footnote text-muted-foreground"
                            >
                              <SelectionMark state={selectedSet.has(s.id) ? "all" : "none"} size={13} />
                              <span className="truncate">{s.variant_display}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className={label}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" rows={2}
              className="w-full px-3 py-2.5 rounded-xl ios-subhead bg-secondary text-foreground border border-border outline-none resize-none" />
          </div>
        </div>

        {/* Fixed footer — pinned, lifts above the keyboard */}
        <div
          className="shrink-0 flex gap-3 px-5 pt-3"
          style={{
            borderTop: "0.5px solid var(--glass-border-lo)",
            paddingBottom: "max(env(safe-area-inset-bottom, 16px), var(--kb-inset))",
          }}
        >
          <button onClick={onClose} className="flex-1 h-12 rounded-xl ios-subhead text-muted-foreground bg-secondary">
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
    </BodyPortal>
  );
}

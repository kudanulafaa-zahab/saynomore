"use client";

import { SearchField } from "@/components/ui/search-field";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, ShoppingCart, CheckCircle2, Clock, Truck, Package, XCircle, ChevronRight, Users, List, ChevronDown, Phone, MessageCircle } from "lucide-react";

import { listOrdersPage, countOrders, listOrderCustomersPage, ORDER_PAGE_SIZE, type SalesOrderRow, type OrderStatus, type OrderCursor, type OrderPageFilters, type OrderCustomerGroup, type CustomerCursor } from "@/lib/queries/sales";
import { listCustomers, listGodowns, type CustomerRow, type GodownRow } from "@/lib/queries/masters";
import { listSkusFlat, getCurrentUserRole, type SkuFullRow } from "@/lib/queries/products";
import { listStockLevels, type StockLevel } from "@/lib/queries/inventory";
import { useRefreshHandler } from "@/lib/use-pull-to-refresh";
import { SwipeActions, type SwipeAction } from "@/components/ui/swipe-actions";
import { mvtDayKey, mvtInstant, mvtToday, mvtYesterday } from "@/lib/mvt-date";
import { CARD } from "@/lib/surfaces";
import { NewSaleSheet } from "./new-sale-sheet";
import { mvr, mvrUpTo } from "@/lib/money";

// ── Styling constants ─────────────────────────────────────────────────────────



// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft", confirmed: "Confirmed", picked: "Picked",
  out_for_delivery: "Out for Delivery", delivered: "Delivered", cancelled: "Cancelled",
};

const STATUS_COLOR: Record<OrderStatus, { bg: string; text: string }> = {
  draft:            { bg: "var(--muted)",                   text: "var(--muted-foreground)" },
  confirmed:        { bg: "color-mix(in srgb, var(--snm-info) 12%, transparent)",  text: "var(--snm-info)"  },
  picked:           { bg: "color-mix(in srgb, var(--snm-warning) 15%, transparent)",  text: "var(--snm-warning)"      },
  out_for_delivery: { bg: "color-mix(in srgb, var(--snm-warning) 10%, transparent)",  text: "var(--snm-warning)"      },
  delivered:        { bg: "color-mix(in srgb, var(--snm-success) 15%, transparent)",  text: "var(--snm-success)"      },
  cancelled:        { bg: "color-mix(in srgb, var(--snm-error) 10%, transparent)",    text: "var(--snm-error)"        },
};

const STATUS_ICON: Record<OrderStatus, typeof Clock> = {
  draft: Clock, confirmed: CheckCircle2, picked: Package,
  out_for_delivery: Truck, delivered: CheckCircle2, cancelled: XCircle,
};







// ── Order row (memoized — search re-renders SalesList on every keystroke,
// but a row only needs to re-render if its own order/customer changed) ──────

const OrderRow = memo(function OrderRow({ order: o }: { order: SalesOrderRow }) {
  // Identity comes with the order (0181), never from a separately cached
  // customer list. That lookup could not tell "no customer" apart from
  // "customer not loaded yet", so a brand-new customer's order was shown
  // as a walk-in and the name only appeared once the cache caught up.
  const custName = o.customer_name ?? null;
  const Icon = STATUS_ICON[o.status];
  const colors = STATUS_COLOR[o.status];
  const total = o.order_total_mvr ?? 0;

  // Three lines, in the order you actually read them: WHO, WHAT, then the
  // reference. The order number used to share line one with the customer
  // name and truncated it to a couple of characters — but you never scan
  // this list for "SO-2026-080", you scan it for a person. Name now owns
  // the top line at Body size (17pt, Apple's floor for the primary label);
  // the reference drops to Footnote underneath.
  const owed = o.balance_mvr ?? 0;
  const isOwed = o.status !== "cancelled" && o.status !== "draft" && owed > 0.005;

  // Swipe left for the two things actually done from this list: ring the
  // customer, or message them. Deliberately no money action here — recording
  // a payment needs the amount and method, which is a sheet, not a swipe.
  const phone = o.customer_phone?.replace(/[^\d+]/g, "") ?? "";
  const swipeActions: SwipeAction[] = phone
    ? [
        {
          label: "Call",
          icon: <Phone className="h-4 w-4" />,
          background: "var(--snm-info)",
          onSelect: () => { window.location.href = `tel:${phone}`; },
        },
        {
          label: "WhatsApp",
          icon: <MessageCircle className="h-4 w-4" />,
          background: "var(--snm-success)",
          onSelect: () => {
            const digits = phone.replace(/\D/g, "");
            // Maldives numbers are stored locally (7 digits); wa.me needs the
            // country code or it silently opens an empty chat.
            const intl = digits.length <= 7 ? `960${digits}` : digits;
            const msg = isOwed
              ? `Hello${custName ? ` ${custName}` : ""}, about order ${o.order_number} — MVR ${mvrUpTo(owed, 2)} is still outstanding.`
              : `Hello${custName ? ` ${custName}` : ""}, about your order ${o.order_number}.`;
            window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
          },
        },
      ]
    : [];

  return (
    <SwipeActions actions={swipeActions}>
    <Link href={`/sales/${o.id}`}
      className="flex items-start gap-3 p-4 rounded-2xl snm-pressable active:opacity-80"
      style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
    >
      {/* Neutral tile — the pill below already states status in color;
          painting it twice per row was the "light green everywhere" wash
          Ali flagged. One row, one colored element. */}
      <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        {/* WHO — and what it cost. Tabular figures so the money column
            stays aligned down the list instead of jittering per row. */}
        <div className="flex items-baseline gap-2">
          <p className="text-[17px] font-semibold text-foreground truncate flex-1 min-w-0" style={{ letterSpacing: "-0.012em" }}>
            {custName ?? "Walk-in"}
          </p>
          {total > 0 && (
            <p className="text-[16px] font-bold text-foreground snm-num shrink-0">
              {total >= 10000 ? `${(total / 1000).toFixed(1)}K` : mvr(total)}
              <span className="text-[11px] font-semibold ml-0.5" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
          )}
        </div>

        {/* WHAT — built in Postgres so pack/carton maths never happens here.
            Two lines max: a mixed carton lists its full scent split. */}
        {o.items_summary && (
          <p
            className="text-[15px] mt-0.5"
            style={{
              color: "var(--foreground)",
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {o.items_summary}
          </p>
        )}

        {/* Reference line — never competes with the two above. */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <span className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>{o.order_number}</span>
          <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>·</span>
          <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>{o.channel}</span>
          <span className="text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 shrink-0" style={{ background: colors.bg, color: colors.text }}>
            {STATUS_LABEL[o.status]}
          </span>
          {/* Money still outstanding is the one thing worth a second colour. */}
          {isOwed && (
            <span className="text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 shrink-0 snm-num"
              style={{ background: "color-mix(in srgb, var(--snm-error) 15%, transparent)", color: "var(--snm-error)" }}>
              Owes {mvr(owed)}
            </span>
          )}
        </div>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 mt-2" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
    </Link>
    </SwipeActions>
  );
});

// ── SalesList ─────────────────────────────────────────────────────────────────

/** "Today" / "Yesterday" / "24 Jul" — the heading the order list groups under,
 *  so the newest-first sort is visible instead of looking arbitrary. */
function dayLabel(iso: string): string {
  // Malé days, not the device's. This used to compare local midnights, so an
  // order placed at 00:30 in Malé headed a "Yesterday" group on a phone set to
  // UTC while every total beside it came from Postgres on the Maldives day.
  const day = mvtDayKey(iso);
  if (day === mvtToday()) return "Today";
  if (day === mvtYesterday()) return "Yesterday";
  const sameYear = day.slice(0, 4) === mvtToday().slice(0, 4);
  return mvtInstant(iso, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// Monotonic key source for cart lines. Replaces Date.now() in the repeat-order
// builder: a counter can't collide inside the same millisecond, and it's pure
// (Date.now() is not, which the React Compiler flags).

export function SalesList() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  // ?filter=unpaid → show every order still owing money, matching the
  // dashboard "Unpaid" tile and the Finance "Owed" panel exactly. Both read
  // get_receivables_aging(): any active order (not draft/cancelled) whose
  // payment isn't settled — whether it's confirmed, on the road, or already
  // delivered. It is NOT delivered-only; a confirmed bank-transfer order the
  // customer hasn't paid is money Ali is still owed and wants to chase.
  const unpaidMode   = searchParams.get("filter") === "unpaid";

  const [rows, setRows] = useState<SalesOrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [newDialog, setNewDialog] = useState(false);
  const [groupBy, setGroupBy] = useState<"orders" | "customers">("orders");
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    getCurrentUserRole().then((r) => {
      setCanWrite(r !== "viewer");
    }).catch(() => {});
  }, []);

  // ── Paging state ─────────────────────────────────────────────────────────
  // Orders arrive one page at a time, newest first, filtered and searched in
  // Postgres. See listOrdersPage() for why it's a keyset cursor rather than
  // page numbers. `rows` therefore holds only what's been scrolled to — never
  // the whole ledger.
  const [cursor, setCursor]         = useState<OrderCursor | null>(null);
  const [hasMore, setHasMore]       = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [matchCount, setMatchCount] = useState(0);

  // Grouped-by-customer view — rolled up in Postgres for the same reason.
  const [custGroups, setCustGroups]   = useState<OrderCustomerGroup[]>([]);
  const [custCursor, setCustCursor]   = useState<CustomerCursor | null>(null);
  const [custHasMore, setCustHasMore] = useState(false);
  // Orders for whichever customer groups are expanded, fetched on demand.
  const [groupOrders, setGroupOrders] = useState<Map<string, SalesOrderRow[]>>(new Map());

  // Debounced search — one query per pause in typing, not per keystroke.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filters: OrderPageFilters = useMemo(
    () => ({ status: statusFilter, search: debouncedQ, unpaid: unpaidMode }),
    [statusFilter, debouncedQ, unpaidMode],
  );

  /** Catalogue data — customers, SKUs, godowns, stock. All bounded lists that
   *  the New Sale wizard needs in full, so they stay a single load. */
  async function loadSupporting() {
    const [c, sk, g, lvl] = await Promise.all([
      listCustomers(), listSkusFlat(), listGodowns(), listStockLevels(),
    ]);
    setCustomers(c); setSkus(sk); setGodowns(g); setStockLevels(lvl);
  }

  useEffect(() => {
    loadSupporting().catch((e) => toast.error((e as Error).message));
  }, []);

  /** First page for the current filters. Also runs on refresh after a save,
   *  which is why it swaps rows in place rather than clearing them first —
   *  no skeleton flash on an existing list. */
  const loadFirstPage = useCallback(async () => {
    try {
      if (groupBy === "orders") {
        const [page, count] = await Promise.all([
          listOrdersPage(filters, null),
          countOrders(filters),
        ]);
        setRows(page.rows);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setMatchCount(count);
      } else {
        const [page, count] = await Promise.all([
          listOrderCustomersPage(filters, null),
          countOrders(filters),
        ]);
        setCustGroups(page.rows);
        setCustCursor(page.nextCursor);
        setCustHasMore(page.hasMore);
        setMatchCount(count);
        setGroupOrders(new Map());
        setExpandedCustomers(new Set());
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [filters, groupBy]);

  // Refetch whenever the filter set or the view changes. The cursor resets
  // implicitly because loadFirstPage always starts from null.
  useEffect(() => {
    let cancelled = false;
    loadFirstPage().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadFirstPage]);

  /** Refresh after a mutation — keeps the current filters and view. */
  const load = loadFirstPage;

  // Pull down at the top of the list to reload it. loadFirstPage swaps rows in
  // place, so there is no skeleton flash behind the spinner.
  useRefreshHandler(loadFirstPage);

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      if (groupBy === "orders") {
        if (!cursor) return;
        const page = await listOrdersPage(filters, cursor);
        setRows((prev) => [...prev, ...page.rows]);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } else {
        if (!custCursor) return;
        const page = await listOrderCustomersPage(filters, custCursor);
        setCustGroups((prev) => [...prev, ...page.rows]);
        setCustCursor(page.nextCursor);
        setCustHasMore(page.hasMore);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  // Auto-load as the sentinel scrolls into view — the next page is already
  // arriving by the time the last row is on screen, so it reads as one
  // continuous list. The button below it stays as the visible, tappable
  // fallback (and the only control that works with reduced motion / when the
  // observer never fires).
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    const more = groupBy === "orders" ? hasMore : custHasMore;
    if (!el || !more || loadingMore) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
      { rootMargin: "400px" },   // start fetching before it's actually visible
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, hasMore, custHasMore, loadingMore, cursor, custCursor, filters]);

  // No customerById map any more, deliberately. Order identity travels with the
  // order (0181); a second lookup table aged separately from the list it
  // described and produced "Walk-in" for real customers. `customers` is still
  // loaded because the New Sale picker needs the full rows.

  /** True when anything is narrowing the list — used to tell "no sales yet"
   *  apart from "no matches". */
  const filtersActive = statusFilter !== "all" || debouncedQ !== "" || unpaidMode;

  // Server already filtered, searched and ordered these.
  const visibleOrders = rows;

  /** Expand/collapse a customer group, fetching that customer's orders the
   *  first time it opens (one small query, not the whole ledger up front). */
  async function toggleCustomer(key: string, customerId: string | null) {
    const isOpen = expandedCustomers.has(key);
    setExpandedCustomers((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(key); else next.add(key);
      return next;
    });
    if (isOpen || groupOrders.has(key)) return;
    try {
      const page = await listOrdersPage(
        { ...filters, customerId: customerId ?? undefined },
        null,
        100,
      );
      // Walk-in orders have no customer_id, so the server can't filter to
      // them — narrow client-side for that one bucket.
      const rowsForKey = customerId ? page.rows : page.rows.filter((o) => !o.customer_id);
      setGroupOrders((prev) => new Map(prev).set(key, rowsForKey));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-2.5 w-20 rounded-full" style={{ background: "var(--muted)" }} />
          <div className="h-8 w-24 rounded-xl" style={{ background: "var(--muted)" }} />
        </div>
        <div className="h-11 w-28 rounded-2xl" style={{ background: "var(--muted)" }} />
      </div>
      {/* Search bar */}
      <div className="h-12 rounded-2xl" style={{ background: "var(--muted)" }} />
      {/* Filter chips */}
      <div className="flex gap-2">
        {[64, 40, 72, 56, 80, 64].map((w, i) => (
          <div key={i} className="h-11 rounded-full shrink-0" style={{ width: w, background: "var(--muted)" }} />
        ))}
      </div>
      {/* Order cards */}
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-3 p-4 rounded-2xl" style={{ background: "var(--glass-1)" }}>
            <div className="h-10 w-10 rounded-xl shrink-0" style={{ background: "var(--muted)" }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-32 rounded-full" style={{ background: "var(--muted)" }} />
              <div className="h-2.5 w-20 rounded-full" style={{ background: "var(--muted)" }} />
            </div>
            <div className="h-6 w-16 rounded-lg" style={{ background: "var(--muted)" }} />
          </div>
          <div className="h-11 w-11 rounded-xl shrink-0" style={{ background: "var(--muted)" }} />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[12px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Operations</p>
          <h1 className="ios-page-title">Sales</h1>
        </div>
        {canWrite && (
          <button
            onClick={() => setNewDialog(true)}
            className="flex items-center gap-2 h-11 px-5 rounded-2xl text-sm font-semibold transition active:scale-95"
            style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}
          >
            <Plus className="h-4 w-4" /> New Sale
          </button>
        )}
      </div>

      {/* Unpaid filter banner — shown when arriving from dashboard */}
      {unpaidMode && (
        <div
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
          style={{
            background: "color-mix(in srgb, var(--snm-error) 8%, var(--glass-1))",
            border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)",
            boxShadow: "var(--glass-shadow), var(--glass-inner)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--snm-error)" }} />
            <p className="ios-subhead font-semibold text-foreground">
              Showing {matchCount} order{matchCount !== 1 ? "s" : ""} awaiting payment
            </p>
          </div>
          <button
            onClick={() => router.push("/sales")}
            className="ios-subhead font-medium shrink-0"
            style={{ color: "var(--muted-foreground)" }}
          >
            Clear ✕
          </button>
        </div>
      )}

      <SearchField value={q} onChange={setQ} label="Search orders" placeholder="Search order, customer…" />

      {/* Status filter chips */}
      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {([
          { key: "all" as const, label: "All" },
          ...( Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => ({ key: s as "all" | OrderStatus, label: STATUS_LABEL[s] })),
        ]).map(({ key, label }) => {
          const active = statusFilter === key;
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className="shrink-0 h-11 px-4 rounded-full text-[14px] font-semibold transition active:scale-95"
              style={{
                background: active ? "var(--glass-accent)" : "var(--glass-1)",
                color:      active ? "var(--snm-brand-on)" : "var(--muted-foreground)",
                border:     active ? "none" : "0.5px solid var(--glass-border-lo)",
                touchAction: "manipulation",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* View toggle — Orders (flat) vs Customers (grouped) */}
      <div className="flex rounded-xl overflow-hidden" style={{ ...CARD }}>
        {([
          { val: "orders",    icon: List,  label: "Orders"    },
          { val: "customers", icon: Users, label: "Customers" },
        ] as const).map(({ val, icon: Icon, label }) => (
          <button key={val} onClick={() => setGroupBy(val)}
            className="flex-1 flex items-center justify-center gap-2 h-10 text-[14px] font-semibold transition"
            style={groupBy === val
              ? { background: "var(--glass-accent)", color: "var(--snm-brand-on)" }
              : { background: "transparent", color: "var(--muted-foreground)" }}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {matchCount === 0 ? (
        <div className="rounded-2xl p-10 flex flex-col items-center text-center space-y-3" style={CARD}>
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
            <ShoppingCart className="h-6 w-6 text-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">{filtersActive ? "No matches" : "No sales yet"}</h3>
          <p className="ios-subhead max-w-sm" style={{ color: "var(--muted-foreground)" }}>
            {unpaidMode ? "Every order has been paid. Nothing outstanding." : !filtersActive ? "Record a sale when a customer messages you on WhatsApp, Viber, or other channels." : "Try a different filter."}
          </p>
          {!filtersActive && (
            <button onClick={() => setNewDialog(true)} className="mt-2 h-11 px-6 rounded-2xl ios-subhead font-semibold"
              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
              Record first sale
            </button>
          )}
        </div>

      ) : groupBy === "orders" ? (
        /* ── Order list, newest first, under day headings ──────────────────
           The list is sorted by order date (newest first) — status is NOT a
           sort key, so a confirmed order sits above an older delivered one.
           That's the standard for an order log, but with no date on the rows
           the ordering looked arbitrary. Day headings make the sort visible. */
        <div className="space-y-1.5">
          {/* Make the paging visible. The list loads 30 at a time and pulls
              more only as you scroll, but with a small order book that is
              invisible — everything fits in a page or two, so it looks like
              the whole ledger downloaded (Ali asked exactly this). Saying
              "showing 30 of 53" states the bound outright. */}
          {hasMore && (
            <p className="ios-footnote px-1 pb-0.5" style={{ color: "var(--muted-foreground)" }}>
              Showing {rows.length} of {matchCount} · more load as you scroll
            </p>
          )}
          {visibleOrders.map((o, i) => {
            const day = dayLabel(o.created_at);
            const showHeading = i === 0 || dayLabel(visibleOrders[i - 1].created_at) !== day;
            return (
              <div key={o.id} className={showHeading && i > 0 ? "pt-3" : undefined}>
                {showHeading && (
                  <p className="text-[11px] font-bold uppercase tracking-wide px-1 pb-1.5"
                    style={{ color: "var(--muted-foreground)" }}>
                    {day}
                  </p>
                )}
                <OrderRow order={o} />
              </div>
            );
          })}
          {/* Sentinel: the next page starts loading 400px before this is on
              screen, so scrolling feels continuous. */}
          {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full h-12 rounded-2xl ios-subhead font-semibold transition active:scale-[0.99] flex items-center justify-center gap-2"
              style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}
            >
              {loadingMore
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
                : `Load more (${Math.max(0, matchCount - rows.length)} more)`}
            </button>
          )}
          {!hasMore && rows.length >= ORDER_PAGE_SIZE && (
            <p className="ios-footnote text-center pt-2" style={{ color: "var(--muted-foreground)" }}>
              All {matchCount} orders shown
            </p>
          )}
        </div>

      ) : (
        /* ── Grouped by customer ── */
        <div className="space-y-2">
          {custGroups.map((g) => {
            const key = g.customer_id ?? "__walkin__";
            const isOpen = expandedCustomers.has(key);
            const toggle = () => toggleCustomer(key, g.customer_id);
            const name = g.name ?? "Walk-in";
            const initials = name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
            // Counts come from Postgres — they cover ALL of this customer's
            // matching orders, not just the ones downloaded so far.
            const active    = g.active_count;
            const delivered = g.delivered_count;
            const orders    = groupOrders.get(key) ?? [];

            return (
              <div key={key} className="rounded-2xl overflow-hidden" style={CARD}>
                {/* Customer header row — always visible */}
                <button onClick={toggle} aria-expanded={isOpen}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left snm-pressable">
                  <div className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                    style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}>
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-foreground">{name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                        {g.orders_count} order{g.orders_count !== 1 ? "s" : ""}
                      </span>
                      {active > 0 && (
                        <span className="ios-subhead font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: "color-mix(in srgb, var(--snm-warning) 15%, transparent)", color: "var(--snm-warning)" }}>
                          {active} active
                        </span>
                      )}
                      {g.island && (
                        <span className="ios-subhead" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>{g.island}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 mr-1">
                    <p className="ios-subhead font-semibold text-foreground">{delivered} done</p>
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>of {g.orders_count}</p>
                  </div>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 transition-transform"
                    style={{ color: "var(--muted-foreground)", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>

                {/* Expanded order rows */}
                {isOpen && (
                  <div style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                    {!groupOrders.has(key) && (
                      <div className="flex items-center justify-center gap-2 px-4 py-4 ios-subhead"
                        style={{ color: "var(--muted-foreground)" }}>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading orders…
                      </div>
                    )}
                    {orders.map((o) => {
                      const Icon = STATUS_ICON[o.status];
                      const colors = STATUS_COLOR[o.status];
                      // Plain tappable row — Void/Delete live on the order
                      // detail screen, one tap away via this link.
                      return (
                        <Link key={o.id} href={`/sales/${o.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-3 snm-pressable"
                          style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <p className="ios-subhead font-semibold text-foreground">{o.order_number}</p>
                              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                                {mvtInstant(o.created_at)} · via {o.channel}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[12px] uppercase tracking-widest font-semibold rounded-lg px-2 py-1" style={{ background: colors.bg, color: colors.text }}>
                              {STATUS_LABEL[o.status]}
                            </span>
                            <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)" }} />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {custHasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
          {custHasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full h-12 rounded-2xl ios-subhead font-semibold transition active:scale-[0.99] flex items-center justify-center gap-2"
              style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}
            >
              {loadingMore
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
                : "Load more customers"}
            </button>
          )}
        </div>
      )}

      {newDialog && canWrite && (
        <NewSaleSheet
          customers={customers} skus={skus} godowns={godowns}
          stockLevels={stockLevels}
          onClose={() => setNewDialog(false)}
          onCreated={(id) => { setNewDialog(false); load(); if (id !== "reload") router.push(`/sales/${id}`); }}
          onCustomerCreated={(c) => setCustomers((prev) => [c, ...prev])}
          // Stock received from inside the sale: reload the levels this
          // component owns, or the product stays greyed out on screen while
          // being in stock in the database.
          onStockChanged={async () => setStockLevels(await listStockLevels())}
        />
      )}

    </div>
  );
}

// ── NewSaleSheet ──────────────────────────────────────────────────────────────


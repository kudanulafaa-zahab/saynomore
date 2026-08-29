"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Search, Pencil, Trash2, Phone, Mail, MapPin, X, MessageCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  listCustomers, deleteCustomer,
  type CustomerRow, type CustomerChannel, type PriceTier,
} from "@/lib/queries/masters";
import { getCurrentUserRole } from "@/lib/queries/products";
import { CustomerForm } from "@/components/masters/customer-form";
import { SkeletonRows } from "@/components/layout/page-skeleton";
import {
  getCustomerInsights, getStrandedCustomers,
  type CustomerInsight, type StrandedCustomer,
} from "@/lib/queries/customer-insights";
import { switchDrafts } from "@/lib/wa";
import { haptic } from "@/lib/haptics";
import { useOnMount } from "@/lib/use-on-mount";
import { MessageButton } from "@/components/customers/message-button";
import { count, mvr, mvrUpTo } from "@/lib/money";

const CHANNELS: { value: CustomerChannel; label: string }[] = [
  { value: "whatsapp",  label: "WhatsApp" },
  { value: "viber",     label: "Viber" },
  { value: "messenger", label: "Messenger" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok",    label: "TikTok" },
  { value: "facebook",  label: "Facebook" },
  { value: "phone",     label: "Phone" },
  { value: "walkin",    label: "Walk-in" },
  { value: "other",     label: "Other" },
];

const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.value, c.label]));

// Non-hierarchical peer categories — dedicated --snm-tag-* palette, never the
// semantic tokens (a price tier isn't "primary action"/"attention"/"good money").
const TIERS: { value: PriceTier; label: string; color: string }[] = [
  { value: "retail",    label: "Retail",    color: "var(--muted-foreground)" },
  { value: "wholesale", label: "Wholesale", color: "var(--snm-tag-slate)" },
  { value: "vip",       label: "VIP",       color: "var(--snm-tag-violet)" },
  { value: "promo",     label: "Promo",     color: "var(--snm-tag-sage)" },
];
const TIER_MAP = Object.fromEntries(TIERS.map((t) => [t.value, t]));

function channelIcon(ch: string | null) {
  if (!ch) return "person";
  if (ch === "whatsapp") return "💬";
  if (ch === "viber") return "📱";
  return ch.charAt(0).toUpperCase();
}

function getInitials(name: string) {
  // Single first letter for everyone — consistent avatars. (Two-letter
  // initials for two-name customers but one for single names read as a bug.)
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function CustomersManager() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; editing?: CustomerRow }>({ open: false });
  const [role, setRole] = useState<string | null>(null);
  const [confirmCustomer, setConfirmCustomer] = useState<{ id: string; name: string } | null>(null);
  // Value ranking (0099). Ranked by PROFIT, not revenue — margins vary by SKU,
  // so equal spend is not equal worth. Loaded alongside the directory.
  const [insights, setInsights] = useState<CustomerInsight[]>([]);
  const [stranded, setStranded] = useState<StrandedCustomer[]>([]);
  const strandedIds = useMemo(() => new Set(stranded.map((s) => s.customer_id)), [stranded]);
  // Opens on the lens named in ?lens= so the dashboard's "See all" lands where
  // it promised. Without this the link dropped you on A–Z and you had to know
  // to press "At risk" — which is the same "the app knows but does not tell
  // you" problem the dashboard section was built to fix.
  const lensParam = useSearchParams().get("lens");
  const [segment, setSegment] = useState<"az" | "top" | "risk" | "owes">(
    lensParam === "risk" || lensParam === "owes" || lensParam === "top" ? lensParam : "az",
  );

  async function load() {
    try { setRows(await listCustomers()); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }
  useOnMount(load);
  useEffect(() => { getCustomerInsights().then(setInsights).catch(() => {}); }, []);
  useEffect(() => { getStrandedCustomers().then(setStranded).catch(() => {}); }, []);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);
  const canWrite = role !== "viewer" && role !== null;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.name, r.company ?? "", r.phone ?? "", r.email ?? "", r.island ?? ""]
        .join(" ").toLowerCase().includes(term),
    );
  }, [rows, q]);

  const insightById = useMemo(() => {
    const m = new Map<string, CustomerInsight>();
    for (const i of insights) m.set(i.customer_id, i);
    return m;
  }, [insights]);

  // Segments are LENSES over the same directory — never a second list.
  // A-Z keeps the Contacts-style grouping; the value segments rank the whole
  // set and so render flat (ranking only reads correctly across everyone).
  const ranked = useMemo(() => {
    if (segment === "az") return [];
    const withData = filtered
      .map((c) => ({ c, i: insightById.get(c.id) }))
      .filter((x): x is { c: CustomerRow; i: CustomerInsight } => !!x.i);
    if (segment === "top")  return [...withData].sort((a, b) => Number(b.i.profit_mvr) - Number(a.i.profit_mvr));
    // At risk is ordered EXACTLY the way the dashboard orders it: people who
    // have actually RUN OUT first, then those merely later than their usual
    // rhythm, and within each block by LIFETIME VALUE — the most worthwhile
    // conversation first (`getRanOutCustomersServer` says the same in the same
    // words). The dashboard shows the top three of the ran-out group and
    // "See all" lands here, so the two must agree on membership AND order;
    // otherwise the link promises "the rest of these six" and hands back a
    // list whose first three are different people, which reads as a bug.
    // Days-since is the tiebreak, not the key — sorting by it put a one-off
    // MVR 90 customer above the best account in the business.
    // Anyone shown in the STRANDED block above is left out here, so nobody
    // appears twice in one work list. Stranded outranks overdue: an overdue
    // customer can still be sold the thing they want, a stranded one cannot,
    // so the two need different sentences and the harder case comes first.
    if (segment === "risk") return withData.filter((x) => x.i.at_risk && !strandedIds.has(x.c.id))
      .sort((a, b) => {
        const rank = (r: string | null) => (r === "ran_out" ? 0 : 1);
        const byReason = rank(a.i.risk_reason) - rank(b.i.risk_reason);
        if (byReason !== 0) return byReason;
        const byValue = Number(b.i.revenue_mvr ?? 0) - Number(a.i.revenue_mvr ?? 0);
        if (byValue !== 0) return byValue;
        return (b.i.days_since_last ?? 0) - (a.i.days_since_last ?? 0);
      });
    return withData.filter((x) => Number(x.i.outstanding_mvr) > 0)
      .sort((a, b) => Number(b.i.outstanding_mvr) - Number(a.i.outstanding_mvr));
  }, [segment, filtered, insightById, strandedIds]);

  // Stranded rows respect the search box like every other lens does, so typing
  // a name narrows the whole work list and not half of it.
  const visibleIds = useMemo(() => new Set(filtered.map((c) => c.id)), [filtered]);
  const strandedRows = useMemo(
    () => stranded.filter((s) => visibleIds.has(s.customer_id)),
    [stranded, visibleIds],
  );

  // Counted as WORK, not as people: a customer stranded in two categories is
  // two different conversations, and the badge is a to-do count.
  const riskCount = useMemo(
    () => insights.filter((i) => i.at_risk && !strandedIds.has(i.customer_id)).length + stranded.length,
    [insights, stranded, strandedIds],
  );
  const owesCount = useMemo(() => insights.filter((i) => Number(i.outstanding_mvr) > 0).length, [insights]);

  // Group alphabetically by first letter (iOS Contacts pattern) with sticky
  // headers, so the directory stays scannable at 100+ customers. Names sort
  // case-insensitively; anything not starting A–Z falls under "#".
  const grouped = useMemo(() => {
    const map = new Map<string, CustomerRow[]>();
    const sorted = [...filtered].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (const c of sorted) {
      const ch = (c.name.trim()[0] ?? "#").toUpperCase();
      const key = /[A-Z]/.test(ch) ? ch : "#";
      (map.get(key) ?? map.set(key, []).get(key)!).push(c);
    }
    return [...map.entries()]; // insertion order = sorted order
  }, [filtered]);

  // ── iOS-style A–Z index rail: tap a letter, or drag down it, to jump to a
  // section — so a long directory doesn't mean scrolling all the way down. ──
  const AZ_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat("#");
  const presentLetters = useMemo(() => new Set(grouped.map(([l]) => l)), [grouped]);
  const showRail = !q.trim() && grouped.length > 1;
  const secId = (l: string) => `cust-sec-${l === "#" ? "hash" : l}`;
  // A letter with nobody under it still takes you somewhere — the next section
  // down the alphabet, or the last one above it if you are past the end. This
  // is what iOS Contacts does, and it is why the rail no longer has to SAY
  // which letters are empty: a tap can never be a dead tap.
  const nearestLetter = (l: string): string | null => {
    const i = AZ_LETTERS.indexOf(l);
    if (i < 0) return null;
    for (let n = i; n < AZ_LETTERS.length; n++) if (presentLetters.has(AZ_LETTERS[n])) return AZ_LETTERS[n];
    for (let n = i - 1; n >= 0; n--) if (presentLetters.has(AZ_LETTERS[n])) return AZ_LETTERS[n];
    return null;
  };
  const jumpToLetter = (l: string, smooth = true) => {
    const target = nearestLetter(l);
    if (!target) return;
    document.getElementById(secId(target))?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  };
  // Active scrub state drives the magnified letter bubble + the enlarged
  // letter under the finger; lastHaptic gates the tap so it only fires once
  // per letter change (not on every touchmove frame).
  const [scrub, setScrub] = useState<{ letter: string; y: number } | null>(null);
  const lastHaptic = useRef<string | null>(null);
  const railTouch = (e: ReactTouchEvent<HTMLDivElement>) => {
    const t = e.touches[0]; if (!t) return;
    const holder = (document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null)?.closest?.("[data-letter]") as HTMLElement | null;
    const l = holder?.getAttribute("data-letter");
    // The bubble shows the letter under the FINGER, not where the list landed —
    // scrubbing should feel like running down the alphabet, not like the
    // alphabet skipping under you.
    if (l) {
      e.preventDefault();
      setScrub({ letter: l, y: t.clientY });
      if (lastHaptic.current !== l) { lastHaptic.current = l; haptic("light"); }
      jumpToLetter(l, false);
    }
  };
  const railEnd = () => { setScrub(null); lastHaptic.current = null; };
  const railTap = (l: string, ev: ReactMouseEvent) => {
    jumpToLetter(l); haptic("light");
    setScrub({ letter: l, y: ev.clientY });
    window.setTimeout(() => setScrub((s) => (s?.letter === l ? null : s)), 520);
  };

  // Stats
  const topChannel = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((r) => { if (r.channel) counts[r.channel] = (counts[r.channel] ?? 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? CHANNEL_LABEL[top[0]] ?? top[0] : "—";
  }, [rows]);

  if (loading) {
    return <SkeletonRows rows={7} />;
  }

  return (
    <div className="space-y-6" style={{ paddingRight: showRail ? 30 : undefined }}>

      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="ios-page-title">Customer Directory</h1>
          <p className="ios-subhead mt-1 text-muted-foreground">
            Your shops and customers, with contact details and price tiers.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setDialog({ open: true })}
            className="flex items-center gap-2 h-11 px-5 rounded-2xl text-sm font-semibold transition active:scale-95 shrink-0"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Customer</span>
            <span className="sm:hidden">Add</span>
          </button>
        )}
      </div>

      {/* Search */}
      <div
        className="flex items-center rounded-2xl px-4 gap-3"
        style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", height: 52 }}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, phone, island…"
          aria-label="Search customers"
          className="flex-1 bg-transparent border-none outline-none ios-subhead text-foreground placeholder:text-muted-foreground"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 active:opacity-60"
            style={{ color: "var(--muted-foreground)" }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Stats bento */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", minHeight: 140 }}
        >
          <p className="label-caps text-[12px] text-muted-foreground">Active Clients</p>
          <div className="flex items-baseline gap-2">
            <span className="snm-num text-4xl font-semibold text-foreground">{count(rows.length)}</span>
          </div>
        </div>
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", minHeight: 140 }}
        >
          <p className="label-caps text-[12px] text-muted-foreground">Avg. Lifetime Value</p>
          <div className="flex items-baseline gap-2">
            <span className="snm-num text-3xl font-light tracking-tight text-foreground">—</span>
            <span className="ios-subhead text-muted-foreground">MVR</span>
          </div>
        </div>
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", minHeight: 140 }}
        >
          <p className="label-caps text-[12px] text-muted-foreground">Top Channel</p>
          <div className="flex items-center gap-3 mt-2">
            <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--glass-bg-2)" }}>
              <MessageCircle className="h-4 w-4 text-foreground" />
            </div>
            <span className="text-lg font-semibold text-foreground">{topChannel}</span>
          </div>
        </div>
      </div>

      {/* Segments — lenses over the same directory. A-Z is the Contacts
          view; the value lenses rank everyone, so they render flat. */}
      <div className="flex gap-1" style={{ background: "var(--glass-bg-1)", borderRadius: 12, padding: 4 }}>
        {([
          ["az", "A–Z"],
          ["top", "Top customers"],
          ["risk", riskCount ? `At risk · ${riskCount}` : "At risk"],
          ["owes", owesCount ? `Owes · ${owesCount}` : "Owes"],
        ] as const).map(([v, label]) => (
          <button key={v} onClick={() => setSegment(v)}
            className="flex-1 rounded-[9px] py-2 text-[12px] font-semibold transition"
            style={{ background: segment === v ? "var(--foreground)" : "transparent",
                     color: segment === v ? "var(--background)" : "var(--muted-foreground)" }}>
            {label}
          </button>
        ))}
      </div>

      {/* AT RISK is not a value lens — it is a work list.
          It used to render like "Top customers": ranked flat, headline figure
          = profit, no reason and no action. So the dashboard's "See all"
          landed you somewhere that could not answer the only question you came
          with — WHO has run out, and how do I reach them. Ali, 2026-08-12:
          "absolutely useless since I can't see who's at risk of running out or
          who ran out already."
          It now mirrors the dashboard card exactly: the reason in words, how
          long it has been, how long what they bought should have lasted, and
          the same three-draft Message button. */}
      {segment === "risk" && ranked.length === 0 && strandedRows.length === 0 && (
        <p className="ios-subhead px-1 py-6 text-center" style={{ color: "var(--muted-foreground)" }}>
          Nobody is overdue to order.
        </p>
      )}

      {/* STRANDED — first, because it is the only block with a deadline.
          These customers have bought nothing but ranges we have stopped
          buying. Everyone else in this lens is late on something we can still
          sell them; these people have nothing to come back FOR, and when the
          stock they hold runs out there is no reason in their history to
          return. They do not announce it — they simply stop.
          The swap is chosen in Postgres and is only ever something in stock,
          so this block never offers what cannot be sent. */}
      {segment === "risk" && strandedRows.length > 0 && (
        <div className="space-y-2">
          <p className="label-caps text-[12px] px-1 pt-2 pb-1.5" style={{ color: "var(--muted-foreground)" }}>
            Nothing left for them to reorder
          </p>
          {strandedRows.map((s) => (
            <div key={`${s.customer_id}-${s.category}`}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
              <Link href={`/customers/${s.customer_id}`} className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
                  {s.name}
                </p>
                {/* --foreground at 0.7, never muted: this is the reason he is
                    looking at the row, not a decorative caption. */}
                <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                  Was buying {s.dropped_model}{s.dropped_size ? ` ${s.dropped_size}` : ""}
                  {s.days_since_last != null ? ` · last ordered ${s.days_since_last} days ago` : ""}
                </p>
                {s.swap_label ? (
                  <p className="ios-footnote mt-0.5" style={{ color: "var(--snm-success)" }}>
                    Offer {s.swap_label}{s.dropped_size ? ` in ${s.dropped_size}` : ""}
                    {s.swap_packs_avail != null ? ` · ${s.swap_packs_avail} packs in stock` : ""}
                  </p>
                ) : (
                  // Not a failure to hide — it is the finding. There is nothing
                  // in their size we can send, which is a buying decision.
                  <p className="ios-footnote mt-0.5" style={{ color: "var(--snm-warning)" }}>
                    Nothing in {s.dropped_size ?? "their size"} to offer — needs stock
                  </p>
                )}
              </Link>
              {s.swap_label && (
                <MessageButton
                  name={s.name}
                  phone={s.phone}
                  label="Offer"
                  drafts={switchDrafts(s.name, s.swap_label, s.dropped_size)}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {segment === "risk" && ranked.length > 0 && (
        <div className="space-y-2">
          {ranked.map(({ c, i }, idx) => {
            const ranOut = i.risk_reason === "ran_out";
            const prev = idx > 0 ? ranked[idx - 1].i.risk_reason : null;
            const startsBlock = idx === 0 || prev !== i.risk_reason;
            return (
              <div key={c.id}>
                {startsBlock && (
                  <p className="label-caps text-[12px] px-1 pt-2 pb-1.5" style={{ color: "var(--muted-foreground)" }}>
                    {ranOut ? "Probably out of stock at home" : "Later than they usually order"}
                  </p>
                )}
                <div className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
                  <Link href={`/customers/${c.id}`} className="min-w-0 flex-1">
                    <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>{c.name}</p>
                    {/* --foreground at 0.7, never muted: this is the reason he
                        is looking at the row, not a decorative caption. */}
                    <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                      {i.days_since_last != null ? `Last ordered ${i.days_since_last} days ago` : "No recent order"}
                      {ranOut
                        ? (i.expected_supply_days != null ? ` · bought about ${i.expected_supply_days} days' worth` : "")
                        : (i.usual_gap_days != null ? ` · usually every ${i.usual_gap_days} days` : "")}
                    </p>
                  </Link>
                  <MessageButton name={c.name} phone={c.phone} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Value lenses — ranked flat list, profit first */}
      {segment !== "az" && segment !== "risk" && (
        ranked.length === 0 ? (
          <p className="ios-subhead px-1 py-6 text-center" style={{ color: "var(--muted-foreground)" }}>
            {segment === "owes" ? "Nobody owes you money." : "No sales history yet."}
          </p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
            {ranked.map(({ c, i }, idx) => (
              <Link key={c.id} href={`/customers/${c.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
                style={{ borderTop: idx > 0 ? "0.5px solid var(--glass-border-lo)" : undefined }}>
                <div className="min-w-0">
                  <p className="ios-subhead font-semibold text-foreground truncate">{c.name}</p>
                  <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
                    {i.orders_count} order{i.orders_count !== 1 ? "s" : ""}
                    {i.days_since_last != null ? ` · last ${i.days_since_last === 0 ? "today" : `${i.days_since_last}d ago`}` : ""}
                    {i.usual_gap_days != null ? ` · usually every ${i.usual_gap_days}d` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {segment === "owes" ? (
                    <p className="snm-num ios-subhead font-semibold" style={{ color: "var(--snm-error)" }}>
                      MVR {mvr(Number(i.outstanding_mvr))}
                    </p>
                  ) : (
                    <>
                      <p className="snm-num ios-subhead font-semibold text-foreground">
                        +MVR {mvr(Number(i.profit_mvr))}
                      </p>
                      <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>profit</p>
                    </>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )
      )}

      {/* Customer list */}
      {segment === "az" && (filtered.length === 0 ? (
        <div
          className="rounded-3xl p-12 text-center space-y-4"
          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}
        >
          <p className="text-base font-semibold text-foreground">
            {rows.length === 0 ? "No customers yet" : "No matches"}
          </p>
          <p className="ios-subhead text-muted-foreground">
            {rows.length === 0
              ? "Add your first customer to get started."
              : "Try a different search term."}
          </p>
          {rows.length === 0 && canWrite && (
            <button
              onClick={() => setDialog({ open: true })}
              className="px-5 py-2.5 rounded-full ios-subhead font-semibold"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              Add first customer
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([letter, group]) => (
            <div key={letter} id={secId(letter)} className="space-y-3" style={{ scrollMarginTop: "calc(64px + env(safe-area-inset-top, 0px))" }}>
              {/* Sticky A–Z section header — offset by the fixed topbar height */}
              <div
                className="sticky z-10 flex items-center gap-3 px-1 py-1"
                style={{ top: "calc(52px + env(safe-area-inset-top, 0px))" }}
              >
                <span className="label-caps text-[13px] font-bold" style={{ color: "var(--muted-foreground)" }}>{letter}</span>
                <span className="flex-1 h-px" style={{ background: "var(--glass-border-lo)" }} />
                <span className="ios-caption1" style={{ color: "var(--muted-foreground)" }}>{group.length}</span>
              </div>
              {group.map((c) => (
            <div
              key={c.id}
              className="snm-pressable rounded-3xl p-5 cursor-pointer"
              style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}
            >
              <div className="flex items-center justify-between gap-4">
                {/* Avatar + name — opens the customer's history & value */}
                <Link href={`/customers/${c.id}`} className="flex items-center gap-4 min-w-0 flex-1">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-sm font-bold"
                    style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}
                  >
                    {getInitials(c.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-foreground">{c.name}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {/* Price tier badge */}
                      {(() => {
                        const t = TIER_MAP[c.price_tier ?? "retail"];
                        return (
                          <span
                            className="ios-subhead font-bold px-2 py-0.5 rounded-full"
                            style={{ background: `color-mix(in srgb, ${t.color} 15%, transparent)`, color: t.color }}
                          >
                            {t.label}
                          </span>
                        );
                      })()}
                      {c.channel && (
                        <span
                          className="ios-subhead font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                        >
                          {channelIcon(c.channel)} {CHANNEL_LABEL[c.channel] ?? c.channel}
                        </span>
                      )}
                      {c.phone && (
                        <span
                          className="snm-num ios-subhead font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                        >
                          <Phone className="h-2.5 w-2.5" /> {c.phone}
                        </span>
                      )}
                      {c.island && (
                        <span
                          className="ios-subhead font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                        >
                          <MapPin className="h-2.5 w-2.5" /> {c.island}
                        </span>
                      )}
                    </div>
                    {/* Their value at a glance — so the directory answers
                        "is this a good customer?" without a tap. Quiet when
                        there's no history yet. */}
                    {(() => {
                      const i = insightById.get(c.id);
                      if (!i) return null;
                      return (
                        <p className="ios-footnote snm-num mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                          {i.orders_count} order{i.orders_count !== 1 ? "s" : ""} · +MVR{" "}
                          {mvr(Number(i.profit_mvr))} profit
                          {i.days_since_last != null ? ` · last ${i.days_since_last === 0 ? "today" : `${i.days_since_last}d ago`}` : ""}
                          {i.at_risk ? (i.risk_reason === "ran_out" ? " · probably run out" : " · overdue to order") : ""}
                        </p>
                      );
                    })()}
                  </div>
                </Link>

                {/* Actions */}
                {canWrite && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setDialog({ open: true, editing: c })}
                      aria-label={`Edit ${c.name}`}
                      className="snm-pressable flex items-center justify-center rounded-xl"
                      style={{ width: 44, height: 44, background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirmCustomer({ id: c.id, name: c.name })}
                      aria-label={`Delete ${c.name}`}
                      className="snm-pressable flex items-center justify-center rounded-xl"
                      style={{ width: 44, height: 44, background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)" }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Extra row */}
              {(c.company || c.email) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                  {c.company && (
                    <p className="ios-subhead text-muted-foreground">{c.company}</p>
                  )}
                  {c.email && (
                    <p className="ios-subhead flex items-center gap-1 text-muted-foreground">
                      <Mail className="h-3 w-3" /> {c.email}
                    </p>
                  )}
                </div>
              )}
            </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      <CustomerDialog
        open={dialog.open}
        editing={dialog.editing}
        customers={rows}
        onOpenChange={(o) => setDialog({ open: o })}
        onSaved={load}
      />

      <ConfirmSheet
        open={confirmCustomer !== null}
        onClose={() => setConfirmCustomer(null)}
        title="Delete customer?"
        message={confirmCustomer ? `"${confirmCustomer.name}" will be permanently deleted.` : ""}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmCustomer) return;
          try { await deleteCustomer(confirmCustomer.id); haptic("success"); toast.success("Deleted"); setConfirmCustomer(null); load(); }
          catch (e) { haptic("error"); toast.error((e as Error).message); }
        }}
      />

      {/* iOS A–Z index rail — mobile only. A slim glass track of letters on
          the right; tap a letter or drag down it to jump. A magnified bubble
          shows the current letter while scrubbing, the active letter enlarges,
          and each change gives a light haptic. The list is right-padded so
          cards never slide under it. */}
      {showRail && (
        <>
          {/* Magnified letter bubble — appears beside the finger while scrubbing */}
          {scrub && (
            <div
              className="fixed z-40 lg:hidden pointer-events-none flex items-center justify-center snm-scrim-in"
              style={{
                right: 62,
                top: Math.min(Math.max(scrub.y, 96), (typeof window !== "undefined" ? window.innerHeight : 800) - 96),
                transform: "translateY(-50%)",
                width: 68, height: 68, borderRadius: 22,
                background: "var(--glass-bg-2)",
                backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)",
                border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow-lg)",
                fontSize: 32, fontWeight: 700, color: "var(--foreground)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {scrub.letter}
            </div>
          )}

          <div
            className="fixed top-1/2 -translate-y-1/2 z-30 lg:hidden flex flex-col items-center"
            style={{
              right: "max(6px, env(safe-area-inset-right, 0px))",
              padding: "8px 5px", borderRadius: 999,
              background: scrub ? "var(--glass-bg-2)" : "color-mix(in srgb, var(--foreground) 4%, transparent)",
              border: "0.5px solid var(--glass-border-lo)",
              backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)",
              boxShadow: scrub ? "var(--glass-shadow)" : "none",
              transition: "background .2s ease, box-shadow .2s ease",
              touchAction: "none", userSelect: "none", WebkitUserSelect: "none",
            }}
            onTouchStart={railTouch}
            onTouchMove={railTouch}
            onTouchEnd={railEnd}
            onTouchCancel={railEnd}
            aria-hidden="true"
          >
            {/* EVERY LETTER IS LEGIBLE. Letters with nobody under them used to
                render muted at opacity 0.3 — which composites to 1.53:1 in
                light and 1.77:1 in dark, against a 4.5:1 floor. Twenty-five of
                the twenty-seven letters failed, and the defect only surfaced
                the day a second letter group existed in the audit database,
                because the rail hides below two groups.
                The fix is not a darker grey. "Empty" was being signalled by
                making text unreadable, and the signal is not worth having:
                iOS Contacts shows the whole alphabet in one tint and snaps a
                tap on an empty letter to the nearest section, which is what
                nearestLetter() now does. One colour, no dead taps. */}
            {AZ_LETTERS.map((l) => {
              const active = scrub?.letter === l;
              return (
                <button
                  key={l}
                  data-letter={l}
                  tabIndex={-1}
                  onClick={(ev) => railTap(l, ev)}
                  className="flex items-center justify-center"
                  style={{
                    width: 22, height: 19, lineHeight: 1,
                    fontSize: active ? 15 : 11.5,
                    fontWeight: active ? 800 : 600,
                    color: active ? "var(--foreground)" : "var(--snm-brand-text)",
                    background: "transparent", border: "none", padding: 0,
                    transition: "font-size .12s ease, color .12s ease",
                  }}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function CustomerDialog({
  open, editing, customers, onOpenChange, onSaved,
}: {
  open: boolean;
  editing?: CustomerRow;
  customers: CustomerRow[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent selfManaged className="sm:max-w-lg">
        <DialogHeader className="px-5 pt-2 pb-3 shrink-0">
          <DialogTitle>{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update customer details." : "Register a new contact."}
          </DialogDescription>
        </DialogHeader>
        <CustomerForm
          key={`${editing?.id ?? "new"}-${open}`}
          editing={editing}
          existing={customers}
          onPickExisting={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
          onSaved={() => { onOpenChange(false); onSaved(); }}
        />
      </DialogContent>
    </Dialog>
  );
}


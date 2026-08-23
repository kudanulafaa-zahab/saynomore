"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMorningBriefing, type MorningBriefing as Briefing } from "@/lib/queries/intelligence";
import { mvr } from "@/lib/money";

const fmt = mvr;

/** The daily briefing — yesterday's business in one readable paragraph plus
 *  the watch list. A dashboard should brief you, not just show tiles. */
export function MorningBriefing() {
  const [b, setB] = useState<Briefing | null>(null);

  useEffect(() => {
    getMorningBriefing().then(setB).catch(() => {/* card simply doesn't render */});
  }, []);

  if (!b) return null;

  const quiet = b.yesterday_orders === 0 && b.yesterday_collected === 0;
  // Each watch item leads with the money at stake and ends with the action —
  // Ali should know what it costs him and what to do, not just a count.
  const watch: { text: string; href: string; tone: string }[] = [];

  // Out of stock on something that sells LEADS the list. Nothing else here
  // costs money as fast: the demand is proven, the shelf is empty, and every
  // day it stays empty is revenue that simply does not happen. The audit of
  // 2026-08-06 found four such products worth MVR 6,741 a month — while the
  // briefing was reporting slow movers and price checks instead.
  if ((b.stockout_count ?? 0) > 0) {
    const names = (b.stockouts ?? []).map((s) => s.product).join(", ");
    const more = (b.stockout_count ?? 0) - (b.stockouts ?? []).length;
    watch.push({
      text: `Out of stock: ${names}${more > 0 ? ` +${more} more` : ""}`
          + `${b.stockout_mvr_month > 0 ? ` — about MVR ${fmt(b.stockout_mvr_month)} a month of sales you can't fill` : ""}`
          + `. Reorder.`,
      href: "/reorder", tone: "var(--snm-error)",
    });
  }
  // The one that still has time on it — separate line, calmer tone, because
  // "running out" and "already out" are different decisions.
  if ((b.running_out_count ?? 0) > 0) {
    const r = (b.running_out ?? [])[0];
    const more = (b.running_out_count ?? 0) - 1;
    if (r) watch.push({
      text: `${r.product} runs out in ${r.days_left} day${r.days_left === 1 ? "" : "s"}`
          + ` (${r.packs_left} pack${r.packs_left === 1 ? "" : "s"} left)`
          + `${more > 0 ? ` — and ${more} other${more === 1 ? "" : "s"} within the week` : ""}`,
      href: "/reorder", tone: "var(--snm-warning)",
    });
  }

  if (b.overdue_count > 0) watch.push({
    text: `Chase MVR ${fmt(b.overdue_mvr)} owed by ${b.overdue_count} customer${b.overdue_count === 1 ? "" : "s"} — past 30 days, collect before it turns to bad debt`,
    href: "/financials?tab=owed", tone: "var(--snm-error)",
  });
  // The other direction, and it sits next to the line above on purpose: a
  // customer who paid more than the order ended up being worth is owed money
  // back. It happens when a paid order shrinks — a line edited down, or a
  // return. Until 0161 nothing said so: the order read "paid" and the aging
  // report drops negative balances, so the only trace was a number inside a
  // view. A credit nobody chases is a customer who paid twice and was never
  // told. Deliberately NOT netted off the overdue figure above.
  if ((b.credits_count ?? 0) > 0) {
    const names = (b.credits_top ?? []).map((c) => c.name).join(", ");
    const more = (b.credits_count ?? 0) - (b.credits_top ?? []).length;
    watch.push({
      text: `You owe MVR ${fmt(b.credits_mvr)} back — ${names}${more > 0 ? ` +${more} more` : ""}`
          + ` paid more than the order ended up being worth. Refund it or hold it against their next order.`,
      href: "/financials?tab=owed", tone: "var(--snm-warning)",
    });
  }
  if (b.expiring_value_mvr > 0) watch.push({
    text: `MVR ${fmt(b.expiring_value_mvr)} of stock expires within 60 days — move it now or write it off`,
    href: "/inventory", tone: "var(--snm-warning)",
  });
  // A zero expiry warning is only good news if there is expiry data behind it.
  // With none recorded, "nothing expiring" is silence, not safety — and
  // expired stock is a total write-off, so say so plainly.
  else if ((b.batches_without_expiry ?? 0) > 0) watch.push({
    text: `No expiry date on MVR ${fmt(b.stock_value_without_expiry_mvr)} of stock (${b.batches_without_expiry} batch${b.batches_without_expiry === 1 ? "" : "es"}) — until these are entered the app cannot warn you before it goes off`,
    href: "/inventory", tone: "var(--snm-warning)",
  });
  // NO CUSTOMER LINES HERE. They used to be, one sentence each, and they
  // duplicated the "Probably out of stock at home" card sitting directly above
  // this briefing on the same screen — same people, same two facts, worse
  // action. Ali, 2026-08-12: *"In dashboard you're also duplicating the same
  // stuff for which you gave the better option to message. Below it is a list
  // of same people."*
  //
  // The card wins on every count: it names the same customers, gives the same
  // two facts, and offers a Message button with three drafts. This offered
  // "Worth a call (9409259)" — a raw phone number you cannot tap, in a briefing
  // that is meant to be scanned. Two components doing one job is how the unit
  // noun ended up with four copies; the follow-up job now has ONE owner.
  //
  // The softer `rhythm` group is not lost — `getRanOutCustomersServer` counts
  // them and the card points at them, and the At risk lens lists them under
  // "Later than they usually order" (§13i).
  //
  // `b.overdue_customers` is still returned by get_morning_briefing and is
  // deliberately not read here. Leaving the RPC alone keeps this a pure UI
  // change; the payload is small and other callers may want it.
  // Price checks. The urgent case leads: a shipment just landed at a new cost,
  // so the margin has moved and the reprice decision is live — that's when a
  // rival's price needs to be current, not when a timer happens to expire.
  if ((b.price_checks_cost_changed ?? 0) > 0) watch.push({
    text: `${b.price_checks_cost_changed} product${b.price_checks_cost_changed === 1 ? "" : "s"} landed at a new cost — check what rivals charge before you reprice`,
    href: "/competitors?tab=competitors", tone: "var(--snm-warning)",
  });
  else if ((b.price_checks_due ?? 0) > 0) watch.push({
    text: `${b.price_checks_due} rival price${b.price_checks_due === 1 ? " is" : "s are"} due a check — best-sellers every 30 days`,
    href: "/competitors?tab=competitors", tone: "var(--muted-foreground)",
  });
  // Cash stuck in stock that isn't moving. Money leads and the worst two are
  // named — the old line was "20 slow movers", a count that fired on two
  // thirds of the catalogue because it counted over-bought best sellers as
  // slow (migration 0150). Xtra Kering M, the top seller in the business, was
  // top of that list. An alert on 20 of 31 products is an alert nobody reads.
  if ((b.stuck_stock_count ?? 0) > 0) {
    const names = (b.stuck_stock_top ?? []).map((s) => s.product).join(", ");
    const more = (b.stuck_stock_count ?? 0) - (b.stuck_stock_top ?? []).length;
    watch.push({
      text: `MVR ${fmt(b.stuck_stock_mvr)} stuck in stock that isn't selling`
          + `${names ? `: ${names}${more > 0 ? ` +${more} more` : ""}` : ""}`
          + ` — clear it with a promo`,
      href: "/competitors", tone: "var(--snm-warning)",
    });
  }

  // Four scannable stats instead of a run-on sentence — number over label,
  // so the whole of yesterday reads at a glance. The money figures drop the
  // repeated "MVR " prefix (the label 'MVR sold' / 'MVR collected' carries the
  // unit) so long values like 1,184 never truncate on a phone.
  const stats: { value: string; label: string; num?: boolean }[] = [
    { value: fmt(b.yesterday_revenue),   label: "MVR sold",      num: true },
    { value: `${b.yesterday_orders}`,    label: b.yesterday_orders === 1 ? "Order" : "Orders" },
    { value: `${b.yesterday_delivered}`, label: "Delivered" },
    { value: fmt(b.yesterday_collected), label: "MVR collected", num: true },
  ];

  return (
    <div className="glass-panel p-5 mb-4">
      <p className="label-caps mb-3" style={{ color: "var(--muted-foreground)" }}>Yesterday</p>

      {quiet ? (
        <p className="ios-body" style={{ color: "var(--muted-foreground)" }}>No sales recorded.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2.5">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <p className={`text-[19px] font-semibold leading-tight text-foreground truncate${s.num ? " snm-num" : ""}`}>
                {s.value}
              </p>
              <p className="ios-caption1 mt-0.5 leading-tight" style={{ color: "var(--muted-foreground)" }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {watch.length > 0 && (
        <div className="mt-4 pt-4 space-y-2.5" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
          {watch.map((w) => (
            <Link key={w.text} href={w.href} className="flex items-start gap-2.5 ios-subhead font-medium">
              <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-[7px]" style={{ background: w.tone }} />
              <span style={{ color: "var(--foreground)" }}>{w.text}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

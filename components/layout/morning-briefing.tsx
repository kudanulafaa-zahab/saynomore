"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMorningBriefing, type MorningBriefing as Briefing } from "@/lib/queries/intelligence";

function fmt(n: number) {
  return Number(n).toLocaleString("en-MV", { maximumFractionDigits: 0 });
}

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
  if (b.overdue_count > 0) watch.push({
    text: `Chase MVR ${fmt(b.overdue_mvr)} owed by ${b.overdue_count} customer${b.overdue_count === 1 ? "" : "s"} — past 30 days, collect before it turns to bad debt`,
    href: "/financials?tab=owed", tone: "var(--snm-error)",
  });
  if (b.expiring_value_mvr > 0) watch.push({
    text: `MVR ${fmt(b.expiring_value_mvr)} of stock expires within 60 days — move it now or write it off`,
    href: "/inventory", tone: "var(--snm-warning)",
  });
  if (b.slow_movers > 0) watch.push({
    text: `${b.slow_movers} slow mover${b.slow_movers === 1 ? "" : "s"} tying up cash — a promo could turn ${b.slow_movers === 1 ? "it" : "them"} back into money`,
    href: "/competitors", tone: "var(--snm-warning)",
  });

  return (
    <div className="snm-card p-5 mb-4">
      <p className="label-caps mb-2" style={{ color: "var(--muted-foreground)" }}>Yesterday</p>
      <p className="ios-body" style={{ color: "var(--foreground)" }}>
        {quiet ? (
          <>No sales recorded.</>
        ) : (
          <>
            Sold <b className="snm-num">MVR {fmt(b.yesterday_revenue)}</b> across{" "}
            <b>{b.yesterday_orders}</b> order{b.yesterday_orders === 1 ? "" : "s"},{" "}
            delivered <b>{b.yesterday_delivered}</b>, collected{" "}
            <b className="snm-num">MVR {fmt(b.yesterday_collected)}</b>.
          </>
        )}
      </p>
      {watch.length > 0 && (
        <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
          {watch.map((w) => (
            <Link key={w.text} href={w.href} className="flex items-center gap-2 ios-subhead font-medium">
              <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: w.tone }} />
              <span style={{ color: "var(--foreground)" }}>{w.text}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

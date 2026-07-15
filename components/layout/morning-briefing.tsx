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

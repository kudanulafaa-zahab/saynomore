"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ShieldCheck, Phone, Undo2 } from "lucide-react";
import { mvr } from "@/lib/money";
import {
  getReceivablesAging, getCustomerCredits,
  type ReceivableRow, type CustomerCreditRow,
} from "@/lib/queries/intelligence";

const fmt = mvr;

const BUCKET_STYLE: Record<ReceivableRow["bucket"], { label: string; color: string }> = {
  overdue: { label: "Over 60 days", color: "var(--snm-error)" },
  watch:   { label: "31–60 days",   color: "var(--snm-warning)" },
  current: { label: "Under 30 days", color: "var(--snm-success)" },
};

/** Receivables aging — who owes money and for how long, worst first.
 *  Unpaid trade credit is what actually sinks distributors; this makes it
 *  impossible to not know. All math in Postgres (get_receivables_aging). */
export function ReceivablesView() {
  const [rows, setRows] = useState<ReceivableRow[] | null>(null);
  const [credits, setCredits] = useState<CustomerCreditRow[]>([]);

  useEffect(() => {
    // Guard against a fast tab-switch away before this resolves — see the
    // same fix in inventory-view.tsx for the full "Load failed" story.
    let cancelled = false;
    getReceivablesAging()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); });
    // Money owed the other way. Loaded separately and never merged into the
    // aging rows above (0161) — netting a credit against real debt would
    // understate what is actually out there.
    getCustomerCredits()
      .then((c) => { if (!cancelled) setCredits(c); })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  if (rows === null) {
    return (
      <div className="glass-panel p-5">
        <div className="snm-skel h-2.5 w-40 rounded-full mb-3" />
        <div className="snm-skel h-9 rounded-xl" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        <div className="glass-panel p-4 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0" style={{ color: "var(--snm-success)" }} />
          <div>
            <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
              Nobody owes you anything
            </p>
            <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
              Every non-draft order is fully paid.
            </p>
          </div>
        </div>
        {/* "Nobody owes you" is about money coming IN. It must not swallow
            money that has to go back OUT. */}
        <CreditsBlock credits={credits} />
      </div>
    );
  }

  const total = rows.reduce((s, r) => s + Number(r.outstanding_mvr), 0);
  const atRisk = rows.filter((r) => r.bucket !== "current")
    .reduce((s, r) => s + Number(r.outstanding_mvr), 0);

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="glass-panel p-5">
        <p className="label-caps mb-1" style={{ color: "var(--muted-foreground)" }}>Owed to you</p>
        <p className="currency-display snm-num" style={{ color: "var(--foreground)" }}>
          MVR {fmt(total)}
        </p>
        {atRisk > 0 && (
          <p className="ios-subhead mt-1 font-semibold" style={{ color: "var(--snm-warning)" }}>
            MVR {fmt(atRisk)} of it is more than 30 days old
          </p>
        )}
      </div>

      {/* Per-customer rows, worst first (RPC orders by age then amount) */}
      <div className="space-y-2">
        {rows.map((r) => {
          const b = BUCKET_STYLE[r.bucket];
          return (
            <div key={r.customer_id ?? "walkin"} className="glass-panel p-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
                  {r.customer_name}
                </p>
                <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
                  {r.orders_count} unpaid order{r.orders_count === 1 ? "" : "s"} ·{" "}
                  <span style={{ color: b.color, fontWeight: 600 }}>
                    oldest {r.oldest_days}d
                  </span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="ios-headline font-bold snm-num" style={{ color: "var(--foreground)" }}>
                  MVR {fmt(Number(r.outstanding_mvr))}
                </p>
                <p className="ios-caption1 font-semibold" style={{ color: b.color }}>{b.label}</p>
              </div>
              {r.phone && (
                <a
                  href={`tel:${r.phone}`}
                  className="snm-pressable w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}
                  aria-label={`Call ${r.customer_name}`}
                >
                  <Phone className="h-4 w-4" style={{ color: "var(--foreground)" }} />
                </a>
              )}
            </div>
          );
        })}
      </div>

      <CreditsBlock credits={credits} />
    </div>
  );
}

/** Money owed BACK to customers — one row per order, worst first.
 *
 *  It happens when a paid order shrinks: a line edited down, or a return.
 *  Before migration 0161 the order simply read "paid" and this money had no
 *  screen at all, because the aging report drops any balance that isn't
 *  positive. A credit nobody acts on is a customer who paid twice and was
 *  never told.
 *
 *  Orange, not green: money that has to go back out is attention, not good
 *  money. Not red either — it is an obligation, not a loss. */
function CreditsBlock({ credits }: { credits: CustomerCreditRow[] }) {
  if (credits.length === 0) return null;

  const total = credits.reduce((s, c) => s + Number(c.credit_mvr), 0);

  return (
    <div className="space-y-2 pt-1">
      <div className="glass-panel p-5">
        <p className="label-caps mb-1" style={{ color: "var(--muted-foreground)" }}>You owe back</p>
        <p className="currency-display snm-num" style={{ color: "var(--snm-warning)" }}>
          MVR {fmt(total)}
        </p>
        <p className="ios-footnote mt-1" style={{ color: "var(--foreground)", opacity: 0.8 }}>
          {credits.length === 1 ? "One customer has" : `${credits.length} customers have`} paid more than
          the order ended up being worth. Refund it, or hold it against their next order.
        </p>
      </div>

      {credits.map((c) => (
        <div key={c.order_id} className="glass-panel p-4 flex items-center gap-3">
          <Undo2 className="h-4 w-4 shrink-0" style={{ color: "var(--snm-warning)" }} />
          <Link href={`/sales/${c.order_id}`} className="snm-pressable min-w-0 flex-1">
            <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
              {c.customer_name}
            </p>
            <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
              {c.order_number} · {c.days_since}d ago
            </p>
          </Link>
          <div className="text-right shrink-0">
            <p className="ios-headline font-bold snm-num" style={{ color: "var(--snm-warning)" }}>
              MVR {fmt(Number(c.credit_mvr))}
            </p>
            <p className="ios-caption1 font-semibold" style={{ color: "var(--muted-foreground)" }}>to refund</p>
          </div>
          {c.phone && (
            <a
              href={`tel:${c.phone}`}
              className="snm-pressable w-11 h-11 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}
              aria-label={`Call ${c.customer_name}`}
            >
              <Phone className="h-4 w-4" style={{ color: "var(--foreground)" }} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Phone } from "lucide-react";
import { getReceivablesAging, type ReceivableRow } from "@/lib/queries/intelligence";

function fmt(n: number) {
  return n.toLocaleString("en-MV", { maximumFractionDigits: 0 });
}

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

  useEffect(() => {
    getReceivablesAging()
      .then(setRows)
      .catch((e) => toast.error((e as Error).message));
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
    </div>
  );
}

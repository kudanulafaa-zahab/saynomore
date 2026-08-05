"use client";

// The "what you are about to lose" panel inside a destructive confirmation.
//
// Every delete sheet in this app used to name the record and stop there:
// "SH-2026-011 — all inventory batches, stock movements, and linked sales
// orders will be permanently deleted." Accurate, and useless: it gives you
// no way to tell a 40-piece test shipment apart from the one carrying 20,254
// pieces and 70 real customer orders. The figures here come from Postgres
// (get_shipment_void_impact / get_sales_order_delete_impact), never from
// arithmetic in the browser.

import { AlertTriangle } from "lucide-react";

export interface ImpactRow {
  label: string;
  value: string;
  /** Renders in red — reserve it for the line that represents lost money. */
  money?: boolean;
}

export function ImpactLedger({ rows, loading }: { rows: ImpactRow[]; loading?: boolean }) {
  if (loading) {
    return (
      <div
        className="rounded-2xl px-3 py-3 text-[13px]"
        style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", color: "var(--muted-foreground)" }}
      >
        Checking what this would affect…
      </div>
    );
  }
  if (rows.length === 0) return null;

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{ border: "0.5px solid color-mix(in srgb, var(--snm-error) 22%, transparent)" }}
    >
      {rows.map((r, i) => (
        <div
          key={r.label}
          className="flex items-baseline justify-between px-3.5 py-2.5"
          style={{
            background: "color-mix(in srgb, var(--snm-error) 6%, transparent)",
            borderTop: i === 0 ? undefined : "0.5px solid color-mix(in srgb, var(--snm-error) 16%, transparent)",
          }}
        >
          <span className="text-[13.5px]" style={{ color: "var(--muted-foreground)" }}>{r.label}</span>
          <span
            className="snm-num text-[14px] font-semibold"
            style={{ color: r.money ? "var(--snm-error)" : "var(--foreground)" }}
          >
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Shown instead of the confirm button when the action would be refused by
 *  the database anyway. Telling someone up front beats letting them commit
 *  to a press-and-hold and then handing them an error toast. */
export function ImpactBlocked({ reason }: { reason: string }) {
  return (
    <div
      className="flex gap-2.5 rounded-2xl px-3.5 py-3"
      style={{
        background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)",
        border: "0.5px solid color-mix(in srgb, var(--snm-warning) 26%, transparent)",
      }}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--snm-warning)" }} />
      <p className="text-[13.5px] leading-snug" style={{ color: "var(--foreground)" }}>{reason}</p>
    </div>
  );
}

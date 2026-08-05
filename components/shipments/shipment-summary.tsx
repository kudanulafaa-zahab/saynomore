"use client";

// "How many cases of diapers per brand per model? How many of detergent?"
//
// The line list answers that only if you scroll and add up by hand. This is
// the same shipment rolled up the way it is bought: category, then brand, then
// model, counted in CARTONS. No piece counts anywhere — nobody in this trade
// orders diapers in pieces, and the totals that matter are cases.
//
// Ordered and received are shown as one number until they differ, at which
// point the shortfall becomes the loudest thing on the row. Before a GRN they
// are always equal, so showing two identical columns would be noise.

import { useMemo } from "react";
import { Package } from "lucide-react";
import type { ShipmentSummaryRow } from "@/lib/queries/shipments";

const int = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export function ShipmentSummary({
  rows, confirmed,
}: {
  rows: ShipmentSummaryRow[];
  /** After GRN confirmation, landed cost is real rather than an estimate. */
  confirmed: boolean;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, ShipmentSummaryRow[]>();
    for (const r of rows) {
      if (!m.has(r.category_name)) m.set(r.category_name, []);
      m.get(r.category_name)!.push(r);
    }
    return [...m.entries()];
  }, [rows]);

  const grand = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          ordered: a.ordered + r.cartons_ordered,
          received: a.received + r.cartons_received,
          cbm: a.cbm + r.cbm_total,
          landed: a.landed + r.landed_total_mvr,
        }),
        { ordered: 0, received: 0, cbm: 0, landed: 0 },
      ),
    [rows],
  );

  if (rows.length === 0) {
    return (
      <p className="ios-subhead py-6 text-center" style={{ color: "var(--muted-foreground)" }}>
        Nothing on this shipment yet.
      </p>
    );
  }

  const short = grand.received < grand.ordered - 0.001;

  return (
    <div className="space-y-4">
      {/* Headline: the whole container in one line */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <div>
          <p className="snm-num text-[28px] font-bold leading-none" style={{ color: "var(--foreground)" }}>
            {int(grand.received)}
          </p>
          <p className="text-[12px] mt-1" style={{ color: "var(--muted-foreground)" }}>
            cartons {short ? "received" : "in total"}
          </p>
        </div>
        {short && (
          <div>
            <p className="snm-num text-[20px] font-bold leading-none" style={{ color: "var(--snm-warning)" }}>
              −{int(grand.ordered - grand.received)}
            </p>
            <p className="text-[12px] mt-1" style={{ color: "var(--muted-foreground)" }}>short of order</p>
          </div>
        )}
        <div>
          <p className="snm-num text-[20px] font-semibold leading-none" style={{ color: "var(--foreground)" }}>
            {grand.cbm.toFixed(2)}
          </p>
          <p className="text-[12px] mt-1" style={{ color: "var(--muted-foreground)" }}>CBM</p>
        </div>
        {grand.landed > 0 && (
          <div>
            <p className="snm-num text-[20px] font-semibold leading-none" style={{ color: "var(--foreground)" }}>
              {money(grand.landed)}
            </p>
            <p className="text-[12px] mt-1" style={{ color: "var(--muted-foreground)" }}>
              MVR landed{confirmed ? "" : " (est.)"}
            </p>
          </div>
        )}
      </div>

      {groups.map(([category, catRows]) => {
        const catCartons = catRows.reduce((a, r) => a + r.cartons_received, 0);
        return (
          <div key={category} className="space-y-1.5">
            <div className="flex items-baseline justify-between px-0.5">
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                {category}
              </p>
              <p className="snm-num text-[12px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
                {int(catCartons)} ctn
              </p>
            </div>

            {catRows.map((r) => {
              const rowShort = r.cartons_received < r.cartons_ordered - 0.001;
              return (
                <div
                  key={`${r.brand_name}-${r.model_name}`}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
                  >
                    <Package className="h-3.5 w-3.5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium truncate" style={{ color: "var(--foreground)" }}>
                      {r.brand_name} {r.model_name}
                    </p>
                    <p className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
                      {r.sku_count} size{r.sku_count === 1 ? "" : "s"}
                      {r.loose_packs > 0 && ` · ${int(r.loose_packs)} loose pack${r.loose_packs === 1 ? "" : "s"}`}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="snm-num text-[17px] font-bold" style={{ color: "var(--foreground)" }}>
                      {int(r.cartons_received)}
                      <span className="ml-1 text-[11px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
                        ctn
                      </span>
                    </p>
                    {rowShort && (
                      <p className="snm-num text-[11.5px] font-semibold" style={{ color: "var(--snm-warning)" }}>
                        {int(r.cartons_ordered)} ordered
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

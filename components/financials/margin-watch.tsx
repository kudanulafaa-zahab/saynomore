"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, TrendingDown, Tag, PackageX, ChevronRight } from "lucide-react";
import Link from "next/link";
import {
  getPricingHealth,
  applyTargetPrices,
  type PricingHealthRow,
} from "@/lib/queries/pricing";
import { getCurrentUserRole } from "@/lib/queries/products";

function fmt(n: number) {
  return n.toLocaleString("en-MV", { maximumFractionDigits: 0 });
}

// The one price a drifted SKU should move to — prefer the smallest UOM in use.
function suggestionLabel(r: PricingHealthRow): string | null {
  if (r.margin_piece_pct != null && r.suggested_piece_mvr != null)
    return `${fmt(r.suggested_piece_mvr)}/pc`;
  if (r.margin_pack_pct != null && r.suggested_pack_mvr != null)
    return `${fmt(r.suggested_pack_mvr)}/pack`;
  if (r.margin_carton_pct != null && r.suggested_carton_mvr != null)
    return `${fmt(r.suggested_carton_mvr)}/ctn`;
  return null;
}

/** Margin Watch — surfaces every SKU whose selling price no longer earns its
 *  target margin against the LATEST landed cost (typically after a GRN lands
 *  at a new cost), plus stock that can't be priced at all. One tap repairs a
 *  drifted price to target. All math lives in Postgres (get_pricing_health). */
export function MarginWatch() {
  const [rows, setRows] = useState<PricingHealthRow[] | null>(null);
  const [canFix, setCanFix] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);

  useEffect(() => {
    // Guard against a fast tab-switch away before this resolves — see the
    // same fix in inventory-view.tsx for the full "Load failed" story.
    let cancelled = false;
    Promise.all([getPricingHealth(), getCurrentUserRole()])
      .then(([r, role]) => {
        if (cancelled) return;
        setRows(r);
        setCanFix(role === "admin" || role === "manager");
      })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  async function fix(row: PricingHealthRow) {
    setFixing(row.sku_id);
    try {
      await applyTargetPrices(row.sku_id);
      toast.success(`${row.internal_code} repriced to ${row.target_margin_pct}% margin`);
      setRows(await getPricingHealth());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFixing(null);
    }
  }

  // Loading: quiet skeleton row, never a spinner block
  if (rows === null) {
    return (
      <div className="glass-panel p-5 mb-5">
        <div className="snm-skel h-2.5 w-36 rounded-full mb-3" />
        <div className="snm-skel h-9 rounded-xl" />
      </div>
    );
  }

  // Healthy: one calm line, not an empty box
  if (rows.length === 0) {
    return (
      <div className="glass-panel p-4 mb-5 flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 shrink-0" style={{ color: "var(--snm-success)" }} />
        <div>
          <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
            All margins on target
          </p>
          <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
            Every selling price still earns its target margin at the latest landed cost.
          </p>
        </div>
      </div>
    );
  }

  const drifted = rows.filter((r) => r.status === "below_target");
  const unpriced = rows.filter((r) => r.status === "no_price");
  const uncosted = rows.filter((r) => r.status === "no_cost");
  const valueAtRisk = rows.reduce((s, r) => s + Number(r.stock_value_mvr || 0), 0);

  return (
    <div className="glass-panel p-5 mb-5">
      <div className="flex items-center justify-between mb-1">
        <p className="label-caps" style={{ color: "var(--muted-foreground)" }}>Margin watch</p>
        <span
          className="ios-caption1 font-semibold px-2 py-0.5 rounded-full"
          style={{
            background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)",
            color: "var(--snm-warning)",
          }}
        >
          MVR {fmt(valueAtRisk)} affected
        </span>
      </div>
      <p className="ios-footnote mb-4" style={{ color: "var(--muted-foreground)" }}>
        {drifted.length > 0 && `${drifted.length} price${drifted.length === 1 ? "" : "s"} slipped below your target after the latest shipment cost more — you're leaving margin on the table. Tap to reprice to target. `}
        {unpriced.length > 0 && `${unpriced.length} product${unpriced.length === 1 ? " is" : "s are"} in stock with no selling price — you can't sell ${unpriced.length === 1 ? "it" : "them"} until priced. `}
        {uncosted.length > 0 && `${uncosted.length} ${uncosted.length === 1 ? "has" : "have"} no landed cost yet — margin can't be trusted until the GRN is costed.`}
      </p>

      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.sku_id}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5"
            style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background:
                  r.status === "below_target"
                    ? "color-mix(in srgb, var(--snm-warning) 14%, transparent)"
                    : "color-mix(in srgb, var(--snm-error) 12%, transparent)",
                color: r.status === "below_target" ? "var(--snm-warning)" : "var(--snm-error)",
              }}
            >
              {r.status === "below_target" ? (
                <TrendingDown className="h-4 w-4" />
              ) : r.status === "no_price" ? (
                <Tag className="h-4 w-4" />
              ) : (
                <PackageX className="h-4 w-4" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
                {r.full_path}
              </p>
              <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
                {r.status === "below_target" && r.worst_margin_pct != null && (
                  <>
                    {"Earning only "}
                    <span style={{ color: "var(--snm-warning)", fontWeight: 600 }}>
                      {r.worst_margin_pct}%
                    </span>
                    {" where you set "}{r.target_margin_pct}%{" · MVR "}{fmt(Number(r.stock_value_mvr))} in stock at this price
                  </>
                )}
                {r.status === "no_price" && (
                  <>No selling price set · {r.stock_pieces} pcs in stock</>
                )}
                {r.status === "no_cost" && (
                  <>No landed cost on record · {r.stock_pieces} pcs in stock</>
                )}
              </p>
            </div>

            {r.status === "below_target" && canFix ? (
              <button
                onClick={() => fix(r)}
                disabled={fixing === r.sku_id}
                className="snm-pressable shrink-0 rounded-full px-3 py-1.5 ios-footnote font-semibold"
                style={{
                  background: "var(--foreground)",
                  color: "var(--background)",
                  opacity: fixing === r.sku_id ? 0.5 : 1,
                }}
              >
                {fixing === r.sku_id
                  ? "Fixing…"
                  : suggestionLabel(r)
                    ? `Set ${suggestionLabel(r)}`
                    : "Fix price"}
              </button>
            ) : (
              // no_price / no_cost (or viewer role): resolve in Products
              <Link
                href="/products"
                className="shrink-0 flex items-center gap-0.5 ios-footnote font-semibold"
                style={{ color: "var(--snm-brand-text)" }}
              >
                Open
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

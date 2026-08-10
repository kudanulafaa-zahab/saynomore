"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Phone, MapPin, AlertTriangle, ChevronRight } from "lucide-react";
import {
  getCustomerInsights, getCustomerProducts, getCustomerOrders,
  type CustomerInsight, type CustomerProduct, type CustomerOrder,
} from "@/lib/queries/customer-insights";
import { SkeletonRows } from "@/components/layout/page-skeleton";
import { mvtInstant, mvtPlainDay } from "@/lib/mvt-date";

const CARD: React.CSSProperties = {
  background: "linear-gradient(180deg, var(--glass-fill-top), var(--glass-fill-bottom))",
  backdropFilter: "var(--glass-blur-content)",
  WebkitBackdropFilter: "var(--glass-blur-content)",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.65))",
  boxShadow: "inset 0 1px 1px var(--glass-specular), var(--glass-shadow)",
};

function fmt(n: number) {
  return n.toLocaleString("en-MV", { maximumFractionDigits: 0 });
}
/** Quantities in the unit the product sells in — never loose pieces. */
function qtyLabel(p: CustomerProduct) {
  if (p.pcs_per_carton > 0 && p.qty_pieces >= p.pcs_per_carton) {
    return `${Math.round(p.qty_pieces / p.pcs_per_carton)} ctn`;
  }
  if (p.pcs_per_pack > 0) return `${Math.max(1, Math.round(p.qty_pieces / p.pcs_per_pack))} pk`;
  // Was `${qty_pieces} pcs`. Only reachable if a SKU has no pack config at
  // all; even then, say it in the trade unit (Ali, 2026-08-06).
  return p.qty_pieces > 0 ? "< 1 pk" : "0";
}

const STATUS_COLOR: Record<string, string> = {
  delivered: "var(--snm-success)",
  cancelled: "var(--snm-error)",
  out_for_delivery: "var(--snm-warning)",
};

export function CustomerDetail({ id }: { id: string }) {
  const [insight, setInsight]   = useState<CustomerInsight | null>(null);
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [orders, setOrders]     = useState<CustomerOrder[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<"orders" | "products">("orders");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCustomerInsights(), getCustomerProducts(id), getCustomerOrders(id)])
      .then(([ins, prods, ords]) => {
        if (cancelled) return;
        setInsight(ins.find((c) => c.customer_id === id) ?? null);
        setProducts(prods);
        setOrders(ords);
      })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <SkeletonRows rows={6} />;

  // Products grouped by product line — a detergent never sits between two
  // diaper SKUs (standing rule).
  const groups = new Map<string, CustomerProduct[]>();
  for (const p of products) {
    const k = `${p.brand_name}|${p.model_name}`;
    const a = groups.get(k) ?? []; a.push(p); groups.set(k, a);
  }

  return (
    <div className="space-y-4 pb-28 lg:pb-10">
      <Link href="/customers" className="inline-flex items-center gap-1.5 ios-subhead" style={{ color: "var(--muted-foreground)" }}>
        <ArrowLeft className="h-4 w-4" /> Customers
      </Link>

      {/* Identity */}
      <div>
        <h1 className="ios-page-title">{insight?.name ?? "Customer"}</h1>
        <div className="flex flex-wrap gap-2 mt-2">
          {insight?.phone && (
            <a href={`tel:${insight.phone}`} className="ios-subhead font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5"
              style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>
              <Phone className="h-3 w-3" /> {insight.phone}
            </a>
          )}
          {insight?.island && (
            <span className="ios-subhead font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5"
              style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}>
              <MapPin className="h-3 w-3" /> {insight.island}
            </span>
          )}
        </div>
      </div>

      {insight && (
        <>
          {/* What they're worth — profit leads, money first */}
          <div className="rounded-2xl p-5" style={CARD}>
            <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Profit from this customer</p>
            <p className="snm-num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--foreground)" }}>
              MVR {fmt(Number(insight.profit_mvr))}
            </p>
            <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              on MVR {fmt(Number(insight.revenue_mvr))} of sales · {insight.revenue_share_pct}% of all sales
            </p>

            <div className="grid grid-cols-3 gap-3 mt-4 pt-4" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
              {[
                { l: "Orders", v: String(insight.orders_count) },
                { l: "Avg order", v: `MVR ${fmt(Number(insight.avg_order_mvr))}` },
                { l: "Last order", v: insight.days_since_last === 0 ? "Today" : `${insight.days_since_last}d ago` },
              ].map((s) => (
                <div key={s.l}>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>{s.l}</p>
                  <p className="snm-num ios-subhead font-semibold text-foreground mt-0.5">{s.v}</p>
                </div>
              ))}
            </div>

            {insight.usual_gap_days != null && (
              <p className="ios-subhead mt-3" style={{ color: "var(--muted-foreground)" }}>
                Usually orders about every {insight.usual_gap_days} days.
              </p>
            )}
          </div>

          {/* Only what's actionable — quiet when healthy */}
          {insight.at_risk && (
            <div className="rounded-2xl p-4 flex items-start gap-3"
              style={{ ...CARD, border: "1px solid color-mix(in srgb, var(--snm-warning) 30%, transparent)" }}>
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--snm-warning)" }} />
              {/* Two rules, two sentences. A one-time buyer has no "usual"
                  gap — saying "usually every null days" is how this read
                  before 0151, and it's also the wrong idea: what they bought
                  simply ran out. */}
              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                {insight.risk_reason === "ran_out" ? (
                  <>
                    <span className="font-semibold" style={{ color: "var(--snm-warning)" }}>Probably run out.</span>{" "}
                    What they bought {insight.days_since_last} days ago should have lasted about{" "}
                    {insight.expected_supply_days} days. Worth a message.
                  </>
                ) : (
                  <>
                    <span className="font-semibold" style={{ color: "var(--snm-warning)" }}>Overdue to order.</span>{" "}
                    Usually every {insight.usual_gap_days} days — it&apos;s been {insight.days_since_last}. Worth a message.
                  </>
                )}
              </p>
            </div>
          )}
          {Number(insight.outstanding_mvr) > 0 && (
            <Link href="/financials?tab=owed" className="rounded-2xl p-4 flex items-center justify-between gap-3"
              style={{ ...CARD, border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)" }}>
              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                <span className="font-semibold" style={{ color: "var(--snm-error)" }}>Owes MVR {fmt(Number(insight.outstanding_mvr))}</span> — see Owed
              </p>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
            </Link>
          )}
        </>
      )}

      {/* Orders / What they buy */}
      <div className="flex gap-1" style={{ background: "var(--glass-bg-1)", borderRadius: 12, padding: 4 }}>
        {([["orders", `Order history · ${orders.length}`], ["products", "What they buy"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)}
            className="flex-1 rounded-[9px] py-2 text-[12.5px] font-semibold transition"
            style={{ background: tab === v ? "var(--foreground)" : "transparent",
                     color: tab === v ? "var(--background)" : "var(--muted-foreground)" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "orders" ? (
        orders.length === 0 ? (
          <p className="ios-subhead px-1 py-6 text-center" style={{ color: "var(--muted-foreground)" }}>No orders yet.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={CARD}>
            {orders.map((o, i) => (
              <Link key={o.order_id} href={`/sales/${o.order_id}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
                style={{ borderTop: i > 0 ? "0.5px solid var(--glass-border-lo)" : undefined }}>
                <div className="min-w-0">
                  <p className="ios-subhead font-semibold text-foreground truncate">
                    {o.order_number}
                    <span className="font-normal ml-2" style={{ color: STATUS_COLOR[o.status] ?? "var(--muted-foreground)" }}>
                      {o.status.replace(/_/g, " ")}
                    </span>
                  </p>
                  <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                    {mvtInstant(o.created_at, { day: "numeric", month: "short", year: "numeric" })} · {o.items} item{o.items !== 1 ? "s" : ""}
                    {Number(o.balance_mvr) > 0.005 ? " · unpaid" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="snm-num ios-subhead font-semibold text-foreground">MVR {fmt(Number(o.total_mvr))}</p>
                  <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
                </div>
              </Link>
            ))}
          </div>
        )
      ) : (
        products.length === 0 ? (
          <p className="ios-subhead px-1 py-6 text-center" style={{ color: "var(--muted-foreground)" }}>Nothing bought yet.</p>
        ) : (
          <div className="space-y-2">
            {Array.from(groups.entries()).map(([k, list]) => (
              <div key={k}>
                <p className="text-[11px] font-bold uppercase tracking-wide px-1 pb-1.5" style={{ color: "var(--muted-foreground)" }}>
                  {list[0].brand_name} · {list[0].model_name}
                </p>
                <div className="rounded-2xl overflow-hidden" style={CARD}>
                  {list.map((p, i) => (
                    <div key={p.sku_id} className="flex items-center justify-between gap-3 px-4 py-2.5"
                      style={{ borderTop: i > 0 ? "0.5px solid var(--glass-border-lo)" : undefined }}>
                      <div className="min-w-0">
                        <p className="ios-subhead font-semibold text-foreground truncate">{p.variant_display ?? "—"}</p>
                        <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
                          {qtyLabel(p)} bought{p.last_bought ? ` · last ${mvtPlainDay(p.last_bought, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="snm-num ios-subhead font-semibold text-foreground">MVR {fmt(Number(p.revenue_mvr))}</p>
                        <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
                          +MVR {fmt(Number(p.profit_mvr))} profit
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

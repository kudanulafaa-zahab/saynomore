"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ChevronDown, CheckCircle2 } from "lucide-react";
import {
  listMyDeliveries,
  listOrderLines,
  updateOrder,
  type SalesOrderRow,
  type SalesOrderLineRow,
} from "@/lib/queries/sales";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { listCustomers, listGodowns, type CustomerRow, type GodownRow } from "@/lib/queries/masters";
import { supabase } from "@/lib/supabase";

const CARD = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
};

interface OrderWithLines {
  order: SalesOrderRow;
  lines: SalesOrderLineRow[];
  customer?: CustomerRow;
  godown?: GodownRow;
}

const STATUS_COLOR: Record<string, string> = {
  pending:   "var(--snm-warning)",
  dispatched:"var(--muted-foreground)",
  delivered: "var(--snm-success)",
  cancelled: "var(--snm-error)",
};

export function DispatchView() {
  const [items, setItems] = useState<OrderWithLines[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelivery, setConfirmDelivery] = useState<SalesOrderRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in");
      const [orders, customers, godowns, skusFlat] = await Promise.all([
        listMyDeliveries(userData.user.id),
        listCustomers(),
        listGodowns(),
        listSkusFlat(),
      ]);
      setSkus(skusFlat);
      const enriched: OrderWithLines[] = [];
      for (const o of orders) {
        const lines = await listOrderLines(o.id);
        enriched.push({
          order: o,
          lines,
          customer: customers.find((c) => c.id === o.customer_id),
          godown: godowns.find((g) => g.id === o.source_godown_id),
        });
      }
      setItems(enriched);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pending = items.filter((i) => i.order.status === "out_for_delivery");
  const completed = items.filter((i) => i.order.status === "delivered");

  async function markDelivered() {
    if (!confirmDelivery) return;
    setSaving(true);
    try {
      await updateOrder(confirmDelivery.id, {
        status: "delivered",
      });
      toast.success("Marked as delivered");
      setConfirmDelivery(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ background: "var(--background)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--background)", minHeight: "100vh", padding: "0 0 120px 0" }}>

      {/* Header + stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12, marginBottom: 12 }}>
        <div style={{ gridColumn: "span 8", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>
            Logistics Sync
          </p>
          <h1 style={{ color: "var(--foreground)", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>Dispatch Board</h1>
          <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginTop: 4 }}>Real-time delivery management</p>
        </div>
        <div style={{ gridColumn: "span 4", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
          {pending.length > 0 && (
            <div style={{ background: "var(--glass-bg-2)", backdropFilter: "var(--glass-blur)", borderRadius: 999, padding: "8px 18px", display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--glass-border-lo)" }}>
              <div style={{ width: 8, height: 8, borderRadius: 999, background: "var(--snm-warning)" }} />
              <span style={{ color: "var(--foreground)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>
                URGENT: {String(pending.length).padStart(2, "0")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Stats bento — horizontal scroll on mobile, 3-col on sm+ */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div style={{ ...CARD, borderRadius: 16, padding: "16px 20px" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Active</p>
          <p style={{ color: "var(--foreground)", fontSize: 28, fontWeight: 300, letterSpacing: "-0.03em" }}>{pending.length}</p>
        </div>
        <div style={{ ...CARD, borderRadius: 16, padding: "16px 20px" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Done Today</p>
          <p style={{ color: "var(--snm-success)", fontSize: 28, fontWeight: 300, letterSpacing: "-0.03em" }}>{completed.length}</p>
        </div>
        <div style={{ ...CARD, borderRadius: 16, padding: "16px 20px" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Rate</p>
          <p style={{ color: "var(--foreground)", fontSize: 28, fontWeight: 300, letterSpacing: "-0.03em" }}>
            {(pending.length + completed.length) > 0
              ? `${Math.round((completed.length / (completed.length + pending.length)) * 100)}%`
              : "—"}
          </p>
        </div>
      </div>

      {/* Active deliveries */}
      <div style={{ ...CARD, borderRadius: 16, padding: 24, marginBottom: 12 }}>
        <h2 style={{ color: "var(--foreground)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 20 }}>Active Deliveries</h2>
        {pending.length === 0 ? (
          <p style={{ color: "var(--muted-foreground)", fontSize: 14, textAlign: "center", padding: "24px 0" }}>No active deliveries assigned to you.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((item) => {
              const isExpanded = expanded === item.order.id;
              const totalMvr = item.lines.reduce((a, l) => a + Number(l.line_total_mvr), 0);
              return (
                <div key={item.order.id} style={{ background: "var(--glass-bg-1)", borderRadius: 12, overflow: "hidden" }}>
                  <div
                    style={{ padding: "18px 20px", minHeight: 64, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", borderLeft: "3px solid var(--snm-warning)" }}
                    onClick={() => setExpanded(isExpanded ? null : item.order.id)}
                  >
                    <div>
                      <p style={{ color: "var(--foreground)", fontSize: 15, fontWeight: 600 }}>{item.customer ? item.customer.name : "Walk-in"}</p>
                      <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 2 }}>
                        {item.order.order_number} · {item.godown?.name ?? "—"}
                      </p>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 16 }}>
                      <div>
                        <p style={{ color: "var(--foreground)", fontSize: 15, fontWeight: 700 }}>MVR {totalMvr.toFixed(0)}</p>
                        <p style={{ color: "var(--snm-warning)", fontSize: 11, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Out for delivery</p>
                      </div>
                      <ChevronDown style={{ color: "var(--muted-foreground)", width: 18, height: 18, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: "0 20px 16px", borderTop: "1px solid var(--glass-border-lo)" }}>
                      {item.lines.map((line) => {
                        const sku = skus.find((s) => s.id === line.sku_id);
                        return (
                          <div key={line.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--glass-border-lo)" }}>
                            <p style={{ color: "var(--foreground)", fontSize: 14 }}>{sku ? `${sku.brand_name} ${sku.variant_display}` : line.sku_id}</p>
                            <p style={{ color: "var(--foreground)", fontSize: 14 }}>{line.qty_pieces} pcs</p>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => setConfirmDelivery(item.order)}
                        style={{ marginTop: 14, width: "100%", background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 14, padding: "14px", fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", cursor: "pointer", minHeight: 52 }}
                      >
                        Mark as Delivered
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Completed */}
      {completed.length > 0 && (
        <div style={{ ...CARD, borderRadius: 16, padding: 24 }}>
          <h2 style={{ color: "var(--foreground)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 20 }}>Completed</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {completed.map((item) => (
              <div key={item.order.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "var(--glass-bg-1)", borderRadius: 10, opacity: 0.7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <CheckCircle2 style={{ color: "var(--snm-success)", width: 18, height: 18 }} />
                  <div>
                    <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 500 }}>{item.order.order_number}</p>
                    <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{item.customer?.name ?? "Walk-in"}</p>
                  </div>
                </div>
                <span style={{ color: "var(--snm-success)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>DELIVERED</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm delivery modal */}
      {confirmDelivery && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "flex-end" }}>
          <div style={{ background: "var(--glass-2)", backdropFilter: "blur(30px)", borderRadius: "20px 20px 0 0", width: "100%", padding: 28 }}>
            <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.12)", borderRadius: 999, margin: "0 auto 24px" }} />
            <h2 style={{ color: "var(--foreground)", fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Confirm Delivery</h2>
            <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>{confirmDelivery.order_number}</p>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setConfirmDelivery(null)} style={{ flex: 1, background: "var(--glass-bg-1)", color: "var(--muted-foreground)", border: "1px solid var(--glass-border-lo)", borderRadius: 14, padding: 0, height: 52, fontSize: 14, cursor: "pointer" }}>Cancel</button>
              <button
                onClick={markDelivered}
                disabled={saving}
                style={{ flex: 2, background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 14, padding: 0, height: 52, fontSize: 14, fontWeight: 700, letterSpacing: "0.03em", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.5 : 1 }}
              >
                {saving ? "Saving…" : "Confirm Delivered"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

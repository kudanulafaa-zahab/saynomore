"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ChevronDown, CheckCircle2, UserCheck } from "lucide-react";
import {
  listMyDeliveries,
  listAllDispatchOrders,
  listOrderLines,
  updateOrder,
  type SalesOrderRow,
  type SalesOrderLineRow,
} from "@/lib/queries/sales";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import {
  listCustomers, listGodowns, listUsers,
  type CustomerRow, type GodownRow, type UserProfileRow,
} from "@/lib/queries/masters";
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

export function DispatchView() {
  const [items, setItems]             = useState<OrderWithLines[]>([]);
  const [skus, setSkus]               = useState<SkuFullRow[]>([]);
  const [users, setUsers]             = useState<UserProfileRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<"admin" | "manager" | "staff" | null>(null);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState<string | null>(null);
  const [confirmDelivery, setConfirmDelivery] = useState<SalesOrderRow | null>(null);
  const [saving, setSaving]           = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const isAdmin = currentRole === "admin" || currentRole === "manager";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in");
      setCurrentUserId(userData.user.id);

      // Get current user's role from user_profiles
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();

      const role = (profile?.role ?? "staff") as "admin" | "manager" | "staff";
      setCurrentRole(role);
      const admin = role === "admin" || role === "manager";

      const [orders, customers, godowns, skusFlat, allUsers] = await Promise.all([
        admin ? listAllDispatchOrders() : listMyDeliveries(userData.user.id),
        listCustomers(),
        listGodowns(),
        listSkusFlat(),
        admin ? listUsers().catch(() => [] as UserProfileRow[]) : Promise.resolve([] as UserProfileRow[]),
      ]);

      setSkus(skusFlat);
      setUsers(allUsers);

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

  const active    = items.filter((i) => ["confirmed", "picked", "out_for_delivery"].includes(i.order.status));
  const completed = items.filter((i) => i.order.status === "delivered");

  async function markDelivered() {
    if (!confirmDelivery) return;
    setSaving(true);
    try {
      await updateOrder(confirmDelivery.id, { status: "delivered", delivered_at: new Date().toISOString() });
      toast.success("Marked as delivered");
      setConfirmDelivery(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function assignDriver(orderId: string, driverId: string) {
    setAssigningId(orderId);
    try {
      await updateOrder(orderId, {
        assigned_driver_id: driverId || null,
        status: driverId ? "out_for_delivery" : "confirmed",
      });
      toast.success(driverId ? "Driver assigned — order dispatched" : "Driver unassigned");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAssigningId(null);
    }
  }

  function driverName(driverId: string | null): string {
    if (!driverId) return "Unassigned";
    const u = users.find((u) => u.id === driverId);
    return u?.full_name ?? "Unknown";
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

      {/* Header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12, marginBottom: 12 }}>
        <div style={{ gridColumn: "span 8", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>
            Logistics Sync
          </p>
          <h1 style={{ color: "var(--foreground)", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>Dispatch Board</h1>
          <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginTop: 4 }}>
            {isAdmin ? "Assign drivers · track all deliveries" : "Your assigned deliveries"}
          </p>
        </div>
        <div style={{ gridColumn: "span 4", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
          {active.length > 0 && (
            <div style={{ background: "var(--glass-bg-2)", backdropFilter: "var(--glass-blur)", borderRadius: 999, padding: "8px 18px", display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--glass-border-lo)" }}>
              <div style={{ width: 8, height: 8, borderRadius: 999, background: "var(--snm-warning)" }} />
              <span style={{ color: "var(--foreground)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>
                {String(active.length).padStart(2, "0")} ACTIVE
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div style={{ ...CARD, borderRadius: 16, padding: "16px 20px" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Active</p>
          <p style={{ color: "var(--foreground)", fontSize: 28, fontWeight: 300, letterSpacing: "-0.03em" }}>{active.length}</p>
        </div>
        <div style={{ ...CARD, borderRadius: 16, padding: "16px 20px" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Done Today</p>
          <p style={{ color: "var(--snm-success)", fontSize: 28, fontWeight: 300, letterSpacing: "-0.03em" }}>{completed.length}</p>
        </div>
        <div style={{ ...CARD, borderRadius: 16, padding: "16px 20px" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Rate</p>
          <p style={{ color: "var(--foreground)", fontSize: 28, fontWeight: 300, letterSpacing: "-0.03em" }}>
            {(active.length + completed.length) > 0
              ? `${Math.round((completed.length / (active.length + completed.length)) * 100)}%`
              : "—"}
          </p>
        </div>
      </div>

      {/* Active deliveries */}
      <div style={{ ...CARD, borderRadius: 16, padding: 24, marginBottom: 12 }}>
        <h2 style={{ color: "var(--foreground)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 20 }}>
          {isAdmin ? "Active Orders" : "My Deliveries"}
        </h2>

        {active.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 14 }}>
              {isAdmin ? "No confirmed or active orders." : "No deliveries assigned to you."}
            </p>
            {!isAdmin && (
              <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 6, opacity: 0.7 }}>
                Ask your admin to assign orders to you.
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {active.map((item) => {
              const isExpanded = expanded === item.order.id;
              const totalMvr = item.lines.reduce((a, l) => a + Number(l.line_total_mvr), 0);
              const statusColor = item.order.status === "confirmed" ? "var(--snm-brand)"
                : item.order.status === "picked" ? "var(--snm-warning)"
                : "var(--snm-warning)";
              const statusLabel = item.order.status === "confirmed" ? "Confirmed — awaiting dispatch"
                : item.order.status === "picked" ? "Picked"
                : "Out for delivery";

              return (
                <div key={item.order.id} style={{ background: "var(--glass-bg-1)", borderRadius: 12, overflow: "hidden" }}>
                  <div
                    style={{ padding: "18px 20px", minHeight: 64, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", borderLeft: `3px solid ${statusColor}` }}
                    onClick={() => setExpanded(isExpanded ? null : item.order.id)}
                  >
                    <div>
                      <p style={{ color: "var(--foreground)", fontSize: 15, fontWeight: 600 }}>{item.customer ? item.customer.name : "Walk-in"}</p>
                      <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 2 }}>
                        {item.order.order_number} · {item.godown?.name ?? "—"}
                      </p>
                      {isAdmin && (
                        <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 2 }}>
                          Driver: <span style={{ color: item.order.assigned_driver_id ? "var(--foreground)" : "var(--snm-warning)", fontWeight: 500 }}>
                            {driverName(item.order.assigned_driver_id)}
                          </span>
                        </p>
                      )}
                    </div>
                    <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 16 }}>
                      <div>
                        <p style={{ color: "var(--foreground)", fontSize: 15, fontWeight: 700 }}>MVR {totalMvr.toFixed(0)}</p>
                        <p style={{ color: statusColor, fontSize: 11, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>{statusLabel}</p>
                      </div>
                      <ChevronDown style={{ color: "var(--muted-foreground)", width: 18, height: 18, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: "0 20px 16px", borderTop: "1px solid var(--glass-border-lo)" }}>

                      {/* Item list */}
                      {item.lines.map((line) => {
                        const sku = skus.find((s) => s.id === line.sku_id);
                        return (
                          <div key={line.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--glass-border-lo)" }}>
                            <p style={{ color: "var(--foreground)", fontSize: 14 }}>{sku ? `${sku.brand_name} ${sku.variant_display}` : line.sku_id}</p>
                            <p style={{ color: "var(--foreground)", fontSize: 14 }}>
                              {line.qty} {line.uom}
                            </p>
                          </div>
                        );
                      })}

                      {/* Delivery address */}
                      {(item.order.delivery_address || item.order.delivery_island) && (
                        <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 10 }}>
                          {[item.order.delivery_island, item.order.delivery_address].filter(Boolean).join(", ")}
                        </p>
                      )}

                      {/* Admin: driver assignment dropdown */}
                      {isAdmin && (
                        <div style={{ marginTop: 14 }}>
                          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                            Assign Driver
                          </p>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <select
                              defaultValue={item.order.assigned_driver_id ?? ""}
                              onChange={(e) => assignDriver(item.order.id, e.target.value)}
                              disabled={assigningId === item.order.id}
                              style={{
                                flex: 1, height: 40, borderRadius: 10, padding: "0 12px",
                                background: "var(--glass-bg-1)", color: "var(--foreground)",
                                border: "1px solid var(--glass-border-lo)", fontSize: 14, outline: "none",
                              }}
                            >
                              <option value="">— Unassigned —</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.full_name ?? u.email ?? u.id.slice(0, 8)}
                                  {u.role === "staff" ? " (driver)" : ""}
                                </option>
                              ))}
                            </select>
                            {assigningId === item.order.id && <Loader2 style={{ width: 16, height: 16, color: "var(--muted-foreground)" }} className="animate-spin" />}
                            <UserCheck style={{ width: 18, height: 18, color: item.order.assigned_driver_id ? "var(--snm-success)" : "var(--muted-foreground)" }} />
                          </div>
                        </div>
                      )}

                      {/* Mark delivered button */}
                      {(item.order.status === "out_for_delivery" || (!isAdmin && item.order.status === "picked")) && (
                        <button
                          onClick={() => setConfirmDelivery(item.order)}
                          style={{ marginTop: 14, width: "100%", background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 14, padding: "14px", fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", cursor: "pointer", minHeight: 52 }}
                        >
                          Mark as Delivered
                        </button>
                      )}
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
                    <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
                      {item.customer?.name ?? "Walk-in"}
                      {isAdmin && item.order.assigned_driver_id && ` · ${driverName(item.order.assigned_driver_id)}`}
                    </p>
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
          <div style={{ background: "var(--glass-2)", backdropFilter: "blur(30px)", borderRadius: "20px 20px 0 0", width: "100%", padding: 28, paddingBottom: "max(28px, env(safe-area-inset-bottom, 28px))" }}>
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

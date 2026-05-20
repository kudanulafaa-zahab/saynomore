"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, ChevronDown, CheckCircle2, UserCheck, MapPin, Package,
  Truck, ClipboardList,
} from "lucide-react";
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

/* ── Types ──────────────────────────────────────────────────────────────── */

interface OrderWithLines {
  order: SalesOrderRow;
  lines: SalesOrderLineRow[];
  customer?: CustomerRow;
  godown?: GodownRow;
}

/* ── Skeleton ────────────────────────────────────────────────────────────── */

function DispatchSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-3 w-24 rounded-full" style={{ background: "var(--muted)" }} />
        <div className="h-8 w-40 rounded-xl" style={{ background: "var(--muted)" }} />
      </div>
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        {[0,1,2].map((i) => (
          <div key={i} className="rounded-2xl p-4 space-y-2" style={{ background: "var(--glass-1)" }}>
            <div className="h-2.5 w-12 rounded-full" style={{ background: "var(--muted)" }} />
            <div className="h-8 w-8 rounded-lg" style={{ background: "var(--muted)" }} />
          </div>
        ))}
      </div>
      {/* Order cards */}
      {[0,1,2].map((i) => (
        <div key={i} className="rounded-2xl p-4 space-y-3" style={{ background: "var(--glass-1)" }}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl shrink-0" style={{ background: "var(--muted)" }} />
            <div className="space-y-1.5 flex-1">
              <div className="h-3.5 w-32 rounded-full" style={{ background: "var(--muted)" }} />
              <div className="h-2.5 w-20 rounded-full" style={{ background: "var(--muted)" }} />
            </div>
            <div className="h-3 w-16 rounded-full" style={{ background: "var(--muted)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */

export function DispatchView() {
  const [items, setItems]                 = useState<OrderWithLines[]>([]);
  const [skus, setSkus]                   = useState<SkuFullRow[]>([]);
  const [users, setUsers]                 = useState<UserProfileRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentRole, setCurrentRole]     = useState<"admin" | "manager" | "staff" | null>(null);
  const [loading, setLoading]             = useState(true);
  const [expanded, setExpanded]           = useState<string | null>(null);
  const [confirmDelivery, setConfirmDelivery] = useState<SalesOrderRow | null>(null);
  const [saving, setSaving]               = useState(false);
  const [assigningId, setAssigningId]     = useState<string | null>(null);

  const isAdmin = currentRole === "admin" || currentRole === "manager";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in");
      setCurrentUserId(userData.user.id);

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

  if (loading) return <DispatchSkeleton />;

  return (
    <div className="space-y-4 pb-28">

      {/* ── Header ── */}
      <div>
        <p className="label-caps text-[11px] mb-1" style={{ color: "var(--muted-foreground)" }}>
          Logistics Sync
        </p>
        <h1 className="text-[28px] font-bold tracking-tight text-foreground leading-tight">
          Dispatch Board
        </h1>
        <p className="text-[14px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          {isAdmin ? "Assign drivers · track all deliveries" : "Your assigned deliveries"}
        </p>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active",     value: active.length,    color: active.length > 0 ? "var(--snm-warning)" : "var(--foreground)" },
          { label: "Done Today", value: completed.length, color: completed.length > 0 ? "var(--snm-success)" : "var(--foreground)" },
          {
            label: "Rate",
            value: (active.length + completed.length) > 0
              ? `${Math.round((completed.length / (active.length + completed.length)) * 100)}%`
              : "—",
            color: "var(--foreground)",
          },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-2xl p-4"
            style={{ background: "var(--glass-1)", backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)" }}
          >
            <p className="label-caps text-[10px] mb-2" style={{ color: "var(--muted-foreground)" }}>{label}</p>
            <p className="text-[26px] font-bold tracking-tight leading-none" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Active orders ── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--glass-1)", backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)" }}
      >
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-foreground">
            {isAdmin ? "Active Orders" : "My Deliveries"}
          </h2>
          {active.length > 0 && (
            <span
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold"
              style={{ background: "color-mix(in srgb, var(--snm-warning) 15%, transparent)", color: "var(--snm-warning)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--snm-warning)" }} />
              {String(active.length).padStart(2, "0")} active
            </span>
          )}
        </div>

        {active.length === 0 ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center text-center px-6 py-10 space-y-3">
            <div
              className="h-14 w-14 rounded-2xl flex items-center justify-center"
              style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}
            >
              <ClipboardList className="h-6 w-6" style={{ color: "var(--muted-foreground)" }} />
            </div>
            <p className="text-[15px] font-semibold text-foreground">
              {isAdmin ? "No active orders" : "No deliveries assigned"}
            </p>
            <p className="text-[13px] max-w-[240px]" style={{ color: "var(--muted-foreground)" }}>
              {isAdmin
                ? "Confirmed orders will appear here. Go to Sales to confirm a draft."
                : "Ask your admin to assign orders to you."}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--glass-border-lo)" }}>
            {active.map((item) => {
              const isExpanded  = expanded === item.order.id;
              const totalMvr    = item.lines.reduce((a, l) => a + Number(l.line_total_mvr), 0);
              const statusColor =
                item.order.status === "confirmed"        ? "var(--snm-brand)"
                : item.order.status === "out_for_delivery" ? "var(--snm-warning)"
                : "var(--snm-info)";
              const statusLabel =
                item.order.status === "confirmed"        ? "Awaiting dispatch"
                : item.order.status === "picked"          ? "Picked"
                : "Out for delivery";

              return (
                <div key={item.order.id}>
                  {/* ── Order row — tap to expand ── */}
                  <button
                    className="w-full text-left px-4 py-4 flex items-center gap-3 active:opacity-75 transition-opacity"
                    style={{ borderLeft: `3px solid ${statusColor}` }}
                    onClick={() => setExpanded(isExpanded ? null : item.order.id)}
                    aria-expanded={isExpanded}
                  >
                    {/* Status icon container */}
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `color-mix(in srgb, ${statusColor} 15%, transparent)` }}
                    >
                      <Truck className="h-4 w-4" style={{ color: statusColor }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-foreground">
                        {item.customer?.name ?? "Walk-in"}
                      </p>
                      <p className="text-[12px] mt-0.5 truncate" style={{ color: "var(--muted-foreground)" }}>
                        {item.order.order_number}
                        {item.godown?.name && <> · {item.godown.name}</>}
                        {isAdmin && (
                          <> · <span style={{ color: item.order.assigned_driver_id ? "var(--foreground)" : "var(--snm-warning)", fontWeight: 500 }}>
                            {driverName(item.order.assigned_driver_id)}
                          </span></>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-[14px] font-bold text-foreground">MVR {totalMvr.toFixed(0)}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: statusColor }}>{statusLabel}</p>
                      </div>
                      <ChevronDown
                        className="h-4 w-4 transition-transform duration-200"
                        style={{ color: "var(--muted-foreground)", transform: isExpanded ? "rotate(180deg)" : "none" }}
                      />
                    </div>
                  </button>

                  {/* ── Expanded detail ── */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>

                      {/* Item list */}
                      <div className="pt-3 space-y-0">
                        {item.lines.map((line, i) => {
                          const sku = skus.find((s) => s.id === line.sku_id);
                          return (
                            <div
                              key={line.id}
                              className="flex items-center justify-between py-2.5"
                              style={{ borderBottom: i < item.lines.length - 1 ? "0.5px solid var(--glass-border-lo)" : undefined }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Package className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                                <p className="text-[13px] text-foreground truncate">
                                  {sku ? `${sku.brand_name} ${sku.model_name}${sku.variant_display ? ` ${sku.variant_display}` : ""}` : line.sku_id}
                                </p>
                              </div>
                              <p className="text-[13px] font-semibold text-foreground shrink-0 ml-3">
                                {line.qty} <span className="font-normal text-[11px]" style={{ color: "var(--muted-foreground)" }}>{line.uom}</span>
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      {/* Delivery address */}
                      {(item.order.delivery_address || item.order.delivery_island) && (
                        <div className="flex items-start gap-2 pt-1">
                          <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--muted-foreground)" }} />
                          <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                            {[item.order.delivery_island, item.order.delivery_address].filter(Boolean).join(", ")}
                          </p>
                        </div>
                      )}

                      {/* Admin: driver assignment */}
                      {isAdmin && (
                        <div className="space-y-1.5 pt-1">
                          <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>Assign Driver</p>
                          <div className="flex items-center gap-2">
                            <select
                              defaultValue={item.order.assigned_driver_id ?? ""}
                              onChange={(e) => assignDriver(item.order.id, e.target.value)}
                              disabled={assigningId === item.order.id}
                              className="flex-1 h-11 rounded-xl px-3 text-[14px] text-foreground outline-none appearance-none"
                              style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)" }}
                            >
                              <option value="">— Unassigned —</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.full_name ?? u.email ?? u.id.slice(0, 8)}
                                  {u.role === "staff" ? " (driver)" : ""}
                                </option>
                              ))}
                            </select>
                            {assigningId === item.order.id
                              ? <Loader2 className="h-4 w-4 animate-spin shrink-0" style={{ color: "var(--muted-foreground)" }} />
                              : <UserCheck className="h-4 w-4 shrink-0" style={{ color: item.order.assigned_driver_id ? "var(--snm-success)" : "var(--muted-foreground)" }} />
                            }
                          </div>
                        </div>
                      )}

                      {/* Mark delivered CTA */}
                      {(item.order.status === "out_for_delivery" || (!isAdmin && item.order.status === "picked")) && (
                        <button
                          onClick={() => setConfirmDelivery(item.order)}
                          className="w-full h-[52px] rounded-2xl text-[14px] font-bold tracking-wide transition active:scale-[0.97]"
                          style={{ background: "var(--snm-success)", color: "#ffffff" }}
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

      {/* ── Completed ── */}
      {completed.length > 0 && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--glass-1)", backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)" }}
        >
          <div className="px-4 pt-4 pb-3">
            <h2 className="text-[17px] font-bold text-foreground">Completed Today</h2>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--glass-border-lo)" }}>
            {completed.map((item) => (
              <div key={item.order.id} className="flex items-center gap-3 px-4 py-3.5" style={{ opacity: 0.75 }}>
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "color-mix(in srgb, var(--snm-success) 15%, transparent)" }}
                >
                  <CheckCircle2 className="h-4 w-4" style={{ color: "var(--snm-success)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-foreground">{item.order.order_number}</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    {item.customer?.name ?? "Walk-in"}
                    {isAdmin && item.order.assigned_driver_id && ` · ${driverName(item.order.assigned_driver_id)}`}
                  </p>
                </div>
                <span className="label-caps text-[10px] font-bold" style={{ color: "var(--snm-success)" }}>Delivered</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Confirm delivery sheet ── */}
      {confirmDelivery && (
        <>
          <div
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
            onClick={() => setConfirmDelivery(null)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-[28px]"
            style={{
              background: "var(--glass-bg-2)",
              backdropFilter: "var(--glass-blur-lg)",
              WebkitBackdropFilter: "var(--glass-blur-lg)",
              border: "0.5px solid var(--glass-border-lo)",
              paddingBottom: "max(28px, env(safe-area-inset-bottom, 28px))",
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-9 h-[3px] rounded-full" style={{ background: "var(--muted-foreground)", opacity: 0.3 }} />
            </div>

            <div className="px-6 pt-2 pb-6 space-y-5">
              <div>
                <h2 className="text-[22px] font-bold text-foreground">Confirm Delivery?</h2>
                <p className="text-[14px] mt-1" style={{ color: "var(--muted-foreground)" }}>
                  {confirmDelivery.order_number}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelivery(null)}
                  className="flex-1 h-[52px] rounded-2xl text-[14px] font-semibold active:scale-[0.97] transition"
                  style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)", border: "0.5px solid var(--glass-border-lo)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={markDelivered}
                  disabled={saving}
                  className="flex-[2] h-[52px] rounded-2xl text-[14px] font-bold active:scale-[0.97] transition"
                  style={{ background: "var(--snm-success)", color: "#ffffff", opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? "Saving…" : "Confirm Delivered"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

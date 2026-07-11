"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, ChevronDown, CheckCircle2, UserCheck, MapPin, Package,
  Truck, ClipboardList, AlertTriangle, Bell, Warehouse,
} from "lucide-react";
import { subscribeToPush, isPushSubscribed, notify, notifyDelivered } from "@/lib/push";
import {
  listMyDeliveries,
  listAllDispatchOrders,
  listOrderLinesForOrders,
  updateOrder,
  type SalesOrderRow,
  type SalesOrderLineRow,
} from "@/lib/queries/sales";
import { withOfflineFallback } from "@/lib/offline-write";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import {
  listCustomers, listGodowns, listUsers,
  type CustomerRow, type GodownRow, type UserProfileRow,
} from "@/lib/queries/masters";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";

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
  const [currentRole, setCurrentRole]     = useState<"admin" | "manager" | "staff" | "viewer" | null>(null);
  const [loading, setLoading]             = useState(true);
  const [expanded, setExpanded]           = useState<string | null>(null);
  const [confirmDelivery, setConfirmDelivery] = useState<SalesOrderRow | null>(null);
  const [saving, setSaving]               = useState(false);
  const [assigningId, setAssigningId]     = useState<string | null>(null);
  const [pushEnabled, setPushEnabled]     = useState<boolean | null>(null);

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

      const role = (profile?.role ?? "staff") as "admin" | "manager" | "staff" | "viewer";
      setCurrentRole(role);
      const admin = role === "admin" || role === "manager";

      const [orders, customers, godowns, skusFlat, allUsers] = await Promise.all([
        admin ? listAllDispatchOrders() : listMyDeliveries(userData.user.id),
        listCustomers(),
        listGodowns(),
        listSkusFlat(),
        admin
          ? listUsers().catch((e) => {
              // Don't fail the whole dispatch load over this — but don't go
              // silent either. A swallowed error here used to look like "no
              // drivers exist" with zero explanation (managers hit a 403
              // from an admin-only check that has since been widened to
              // admin-or-manager; keep the toast so any future regression
              // is visible instead of silently empty).
              toast.error("Couldn't load drivers: " + (e as Error).message);
              return [] as UserProfileRow[];
            })
          : Promise.resolve([] as UserProfileRow[]),
      ]);

      setSkus(skusFlat);
      setUsers(allUsers);

      const customerById = new Map(customers.map((c) => [c.id, c]));
      const godownById = new Map(godowns.map((g) => [g.id, g]));
      const linesByOrder = await listOrderLinesForOrders(orders.map((o) => o.id));
      const enriched: OrderWithLines[] = orders.map((o) => ({
        order: o,
        lines: linesByOrder.get(o.id) ?? [],
        customer: customerById.get(o.customer_id ?? ""),
        godown: godownById.get(o.source_godown_id ?? ""),
      }));
      setItems(enriched);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    isPushSubscribed().then(setPushEnabled);
  }, []);

  async function enablePush() {
    const result = await subscribeToPush();
    setPushEnabled(result.ok);
    if (result.ok) toast.success("Notifications enabled");
    else toast.error(result.reason ?? "Could not enable notifications");
  }

  const active    = items.filter((i) => ["confirmed", "picked", "out_for_delivery"].includes(i.order.status));
  const completed = items.filter((i) => i.order.status === "delivered");
  const withIssues = active.filter((i) => i.order.notes?.trim());

  async function markDelivered() {
    if (!confirmDelivery) return;
    setSaving(true);
    const patch = { status: "delivered" as const, delivered_at: new Date().toISOString() };
    try {
      const { queued } = await withOfflineFallback(
        () => updateOrder(confirmDelivery.id, patch),
        { table: "sales_orders", action: "update", payload: patch, match: { id: confirmDelivery.id } },
      );
      haptic("success");
      toast.success(queued ? "Saved offline — will sync when connected" : "Marked as delivered");

      // Office-side completion — notify all admins/managers + the driver who
      // was assigned to it. Same fan-out the driver's own flow uses. Skip when
      // queued offline (not real until it syncs).
      if (!queued) {
        const item = items.find((i) => i.order.id === confirmDelivery.id);
        notifyDelivered(
          {
            title: "Delivery completed",
            body: `${item?.customer?.name ?? "Walk-in"} · ${confirmDelivery.order_number}`.trim(),
            url: "/dispatch",
          },
          item?.order.assigned_driver_id,
        );
      }

      setConfirmDelivery(null);
      load();
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resolveIssue(orderId: string) {
    const patch = { notes: null } as Record<string, unknown>;
    try {
      const { queued } = await withOfflineFallback(
        () => updateOrder(orderId, patch),
        { table: "sales_orders", action: "update", payload: patch, match: { id: orderId } },
      );
      haptic("success");
      toast.success(queued ? "Saved offline — will sync when connected" : "Issue resolved");
      load();
    } catch (e) { haptic("error"); toast.error((e as Error).message); }
  }

  async function assignDriver(orderId: string, driverId: string) {
    setAssigningId(orderId);
    const status = driverId ? "out_for_delivery" as const : "confirmed" as const;
    const patch = { assigned_driver_id: driverId || null, status };
    try {
      const { queued } = await withOfflineFallback(
        () => updateOrder(orderId, patch),
        { table: "sales_orders", action: "update", payload: patch, match: { id: orderId } },
      );
      toast.success(queued
        ? "Saved offline — will sync when connected"
        : driverId ? "Driver assigned — order dispatched" : "Driver unassigned");

      // Push to the assigned driver. Skip when queued offline — the order isn't
      // really dispatched until the update syncs.
      if (driverId && !queued) {
        const item = items.find((i) => i.order.id === orderId);
        const customerName = item?.customer?.name ?? "a customer";
        notify(driverId, {
          title: "New Delivery Assigned",
          body: `You have a new delivery for ${customerName}.`,
          url: "/dispatch",
        });
      }

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>
            Logistics Sync
          </p>
          <h1 className="ios-page-title">
            Dispatch Board
          </h1>
          <p className="text-[14px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            {isAdmin ? "Assign drivers · track all deliveries" : "Your assigned deliveries"}
          </p>
        </div>
        {!isAdmin && pushEnabled === false && (
          <button
            onClick={enablePush}
            className="mt-1 flex items-center gap-1.5 px-3 py-2 rounded-xl ios-subhead font-semibold shrink-0 transition active:scale-95"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Bell className="h-3.5 w-3.5" />
            Notifications
          </button>
        )}
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active",     value: active.length,    color: active.length > 0 ? "var(--snm-warning)" : "var(--foreground)" },
          { label: "Issues",     value: withIssues.length, color: withIssues.length > 0 ? "var(--snm-error)" : "var(--foreground)" },
          { label: "Done Today", value: completed.length, color: completed.length > 0 ? "var(--snm-success)" : "var(--foreground)" },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-2xl p-4"
            style={{ background: "var(--glass-1)", backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}
          >
            <p className="label-caps text-[12px] mb-2" style={{ color: "var(--muted-foreground)" }}>{label}</p>
            <p className="text-[26px] font-bold tracking-tight leading-none" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Active orders ── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--glass-1)", backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}
      >
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-foreground">
            {isAdmin ? "Active Orders" : "My Deliveries"}
          </h2>
          {active.length > 0 && (
            <span
              className="flex items-center gap-1.5 px-3 py-1 rounded-full ios-subhead font-bold"
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
            <p className="ios-subhead max-w-[240px]" style={{ color: "var(--muted-foreground)" }}>
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

              const hasIssue = !!item.order.notes?.trim();
              const rowBorderColor = hasIssue ? "var(--snm-error)" : statusColor;

              return (
                <div key={item.order.id}>
                  {/* ── Order row — tap to expand ── */}
                  <button
                    className="w-full text-left px-4 py-4 flex items-center gap-3 snm-pressable"
                    style={{ borderLeft: `3px solid ${rowBorderColor}` }}
                    onClick={() => setExpanded(isExpanded ? null : item.order.id)}
                    aria-expanded={isExpanded}
                  >
                    {/* Status / issue icon */}
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: hasIssue
                        ? "color-mix(in srgb, var(--snm-error) 15%, transparent)"
                        : `color-mix(in srgb, ${statusColor} 15%, transparent)` }}
                    >
                      {hasIssue
                        ? <AlertTriangle className="h-4 w-4" style={{ color: "var(--snm-error)" }} />
                        : <Truck className="h-4 w-4" style={{ color: statusColor }} />
                      }
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-semibold text-foreground">
                          {item.customer?.name ?? "Walk-in"}
                        </p>
                        {hasIssue && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                            style={{ background: "color-mix(in srgb, var(--snm-error) 15%, transparent)", color: "var(--snm-error)" }}>
                            ISSUE
                          </span>
                        )}
                      </div>
                      <p className="ios-subhead mt-0.5 truncate" style={{ color: "var(--muted-foreground)" }}>
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
                        <p className="text-[14px] font-bold text-foreground snm-num">MVR {totalMvr.toFixed(0)}</p>
                        <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: rowBorderColor }}>{statusLabel}</p>
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

                      {/* Pickup godown — big and first, before the item list,
                          since this is where the driver needs to go first. */}
                      {item.godown?.name && (
                        <div className="flex items-center gap-2.5 pt-3 px-3 py-2.5 rounded-xl"
                          style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}>
                          <Warehouse className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                          <p className="text-[14px] font-bold" style={{ color: "var(--foreground)" }}>
                            Pick up from <span>{item.godown.name}</span>
                          </p>
                        </div>
                      )}

                      {/* Item list */}
                      <div className="pt-1 space-y-0">
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
                                <p className="ios-subhead text-foreground truncate">
                                  {sku ? `${sku.brand_name} ${sku.model_name}${sku.variant_display ? ` ${sku.variant_display}` : ""}` : line.sku_id}
                                </p>
                              </div>
                              <p className="ios-subhead font-semibold text-foreground shrink-0 ml-3">
                                {line.qty} <span className="font-normal ios-subhead" style={{ color: "var(--muted-foreground)" }}>{line.uom}</span>
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      {/* Delivery address */}
                      {(item.order.delivery_address_line1 || item.order.delivery_address_line2 || item.order.delivery_island) && (
                        <div className="flex items-start gap-2 pt-1">
                          <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--muted-foreground)" }} />
                          <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                            {[item.order.delivery_island, item.order.delivery_address_line1, item.order.delivery_address_line2].filter(Boolean).join(", ")}
                          </p>
                        </div>
                      )}

                      {/* Issue note — shown to admin when driver has reported a problem */}
                      {hasIssue && isAdmin && (
                        <div className="rounded-xl p-3 space-y-2"
                          style={{
                            background: "color-mix(in srgb, var(--snm-error) 8%, transparent)",
                            border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)",
                          }}>
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--snm-error)" }} />
                            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--snm-error)" }}>Driver reported an issue</p>
                          </div>
                          <p className="ios-subhead leading-snug" style={{ color: "var(--foreground)" }}>
                            {item.order.notes}
                          </p>
                          <button
                            onClick={() => resolveIssue(item.order.id)}
                            className="ios-subhead font-bold h-8 px-3 rounded-lg transition active:scale-95"
                            style={{ background: "var(--foreground)", color: "var(--background)" }}
                          >
                            Mark resolved
                          </button>
                        </div>
                      )}

                      {/* Admin: driver assignment */}
                      {isAdmin && (
                        <div className="space-y-1.5 pt-1">
                          <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>Assign Driver</p>
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
                          style={{ background: "var(--snm-success)", color: "var(--snm-on-fill)" }}
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
          style={{ background: "var(--glass-1)", backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}
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
                  <p className="ios-subhead font-semibold text-foreground">{item.order.order_number}</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                    {item.customer?.name ?? "Walk-in"}
                    {isAdmin && item.order.assigned_driver_id && ` · ${driverName(item.order.assigned_driver_id)}`}
                  </p>
                </div>
                <span className="label-caps text-[12px] font-bold" style={{ color: "var(--snm-success)" }}>Delivered</span>
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
            style={{ background: "var(--scrim-bg)", backdropFilter: "var(--scrim-blur)", WebkitBackdropFilter: "var(--scrim-blur)" }}
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
                  style={{ background: "var(--snm-success)", color: "var(--snm-on-fill)", opacity: saving ? 0.6 : 1 }}
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

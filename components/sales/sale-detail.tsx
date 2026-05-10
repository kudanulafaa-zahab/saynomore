"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Trash2, User, Truck, CheckCircle2, Banknote, Smartphone, Landmark } from "lucide-react";
import {
  getOrder,
  listOrderLines,
  updateOrder,
  deleteOrder,
  createOrderLine,
  updateOrderLine,
  deleteOrderLine,
  toPieces,
  type SalesOrderRow,
  type SalesOrderLineRow,
  type OrderStatus,
  type PaymentStatus,
  type SaleUom,
} from "@/lib/queries/sales";
import { listSkusFlat, getCurrentUserRole, type SkuFullRow } from "@/lib/queries/products";
import { listCustomers, listGodowns, type CustomerRow, type GodownRow } from "@/lib/queries/masters";
import { listStockLevels, type StockLevel } from "@/lib/queries/inventory";
import { supabase } from "@/lib/supabase";

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

const STEPS: { status: OrderStatus; label: string; Icon: React.ElementType }[] = [
  { status: "confirmed",        label: "Confirmed",   Icon: CheckCircle2 },
  { status: "out_for_delivery", label: "Dispatched",  Icon: Truck },
  { status: "delivered",        label: "Delivered",   Icon: CheckCircle2 },
];

interface DriverOption { id: string; full_name: string; }

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function stepIndex(status: OrderStatus): number {
  const map: Record<string, number> = { draft: 0, confirmed: 0, picked: 0, out_for_delivery: 1, delivered: 2, cancelled: -1 };
  return map[status] ?? 0;
}

function fmt(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); }

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Main component                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

export function SaleDetail({ id }: { id: string }) {
  const router = useRouter();

  const [order, setOrder]           = useState<SalesOrderRow | null>(null);
  const [lines, setLines]           = useState<SalesOrderLineRow[]>([]);
  const [skus, setSkus]             = useState<SkuFullRow[]>([]);
  const [customers, setCustomers]   = useState<CustomerRow[]>([]);
  const [godowns, setGodowns]       = useState<GodownRow[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [drivers, setDrivers]       = useState<DriverOption[]>([]);
  const [role, setRole]             = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);

  // action states
  const [dispatching, setDispatching] = useState(false);
  const [completing, setCompleting]   = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [depositing, setDepositing]   = useState(false);

  // local driver / cash state for action panels
  const [selectedDriver, setSelectedDriver] = useState("");
  const [cashCollected, setCashCollected]   = useState("");

  // inline dialogs (sheet-style bottom panels)
  const [panel, setPanel] = useState<"dispatch" | "deliver" | "deposit" | "delete" | "deleteLine" | "addLine" | null>(null);
  const [pendingDeleteLine, setPendingDeleteLine] = useState<SalesOrderLineRow | null>(null);
  const [editingLine, setEditingLine]             = useState<SalesOrderLineRow | undefined>(undefined);
  const [deletingLine, setDeletingLine]           = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, ls, sk, c, g, lvl, dr] = await Promise.all([
        getOrder(id),
        listOrderLines(id),
        listSkusFlat(),
        listCustomers(),
        listGodowns(),
        listStockLevels(),
        supabase
          .from("user_profiles")
          .select("id, full_name")
          .in("role", ["staff", "admin", "manager"])
          .order("full_name"),
      ]);
      setOrder(o);
      setLines(ls);
      setSkus(sk);
      setCustomers(c);
      setGodowns(g);
      setStockLevels(lvl);
      setDrivers((dr.data ?? []) as DriverOption[]);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);

  const isAdmin   = role === "admin";
  const customer  = customers.find((c) => c.id === order?.customer_id);
  const totals    = useMemo(() => ({
    mvr:   lines.reduce((a, l) => a + Number(l.line_total_mvr), 0),
    count: lines.length,
  }), [lines]);

  const isConfirmed  = order?.status === "confirmed" || order?.status === "picked" || order?.status === "draft";
  const isDispatched = order?.status === "out_for_delivery";
  const isDelivered  = order?.status === "delivered";
  const isCancelled  = order?.status === "cancelled";
  const isCOD        = order?.payment_method === "cod";

  /* ── Actions ───────────────────────────────────────────────────────────── */

  async function patch(field: string, value: number | string | boolean | null) {
    if (!order) return;
    try {
      await updateOrder(order.id, { [field]: value } as Record<string, unknown>);
      setOrder({ ...order, [field]: value } as SalesOrderRow);
    } catch (e) { toast.error((e as Error).message); }
  }

  async function handleDispatch() {
    if (!order || !selectedDriver) return;
    setDispatching(true);
    try {
      await updateOrder(order.id, {
        assigned_driver_id: selectedDriver,
        status: "out_for_delivery",
      } as Record<string, unknown>);
      toast.success("Order dispatched to driver");
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDispatching(false); }
  }

  async function handleDeliver() {
    if (!order) return;
    setCompleting(true);
    try {
      const cash = parseFloat(cashCollected);
      await updateOrder(order.id, {
        status: "delivered",
        delivered_at: new Date().toISOString(),
        ...(isNaN(cash) ? {} : { cash_collected_mvr: cash }),
      } as Record<string, unknown>);
      toast.success("Order marked as delivered");
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setCompleting(false); }
  }

  async function handleDeposit() {
    if (!order) return;
    setDepositing(true);
    try {
      await updateOrder(order.id, {
        payment_status: "deposited",
        cash_deposited_at: new Date().toISOString(),
      } as Record<string, unknown>);
      toast.success("Cash marked as deposited");
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDepositing(false); }
  }

  async function handleMarkPaid() {
    if (!order) return;
    try {
      await updateOrder(order.id, { payment_status: "paid" } as Record<string, unknown>);
      toast.success("Payment received");
      load();
    } catch (e) { toast.error((e as Error).message); }
  }

  async function handleDeleteOrder() {
    if (!order) return;
    setDeleting(true);
    try {
      await deleteOrder(order.id);
      toast.success("Order deleted");
      router.push("/sales");
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeleting(false); }
  }

  async function handleDeleteLine() {
    if (!pendingDeleteLine) return;
    setDeletingLine(true);
    try {
      await deleteOrderLine(pendingDeleteLine.id);
      toast.success("Item removed");
      setPendingDeleteLine(null);
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeletingLine(false); }
  }

  /* ── Render ────────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ background: "var(--background)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }
  if (!order) {
    return (
      <div style={{ background: "var(--background)", minHeight: "100vh", padding: 24 }}>
        <p style={{ color: "var(--muted-foreground)" }}>Order not found.</p>
        <Link href="/sales" style={{ color: "var(--foreground)", fontSize: 14, marginTop: 12, display: "block" }}>← Back to sales</Link>
      </div>
    );
  }

  const currentStep = stepIndex(order.status);

  return (
    <div style={{ background: "var(--background)", minHeight: "100vh", padding: "0 0 140px 0" }}>

      {/* ── Top nav ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/sales" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)", textDecoration: "none" }}>
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>Sales Order</p>
          <h1 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {customer?.name ?? "Walk-in"}
            <span style={{ color: "var(--muted-foreground)", fontSize: 13, fontWeight: 400, marginLeft: 8 }}>{order.order_number}</span>
          </h1>
        </div>
        {isAdmin && !isDelivered && (
          <button
            onClick={() => setPanel("delete")}
            style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,59,48,0.10)", border: "none", color: "#ff3b30", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <Trash2 style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>

      {/* ── Progress stepper ─────────────────────────────────────────────── */}
      {!isCancelled && (
        <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: "20px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
          {STEPS.map((step, i) => {
            const done    = currentStep > i;
            const active  = currentStep === i;
            return (
              <div key={step.status} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", zIndex: 1 }}>
                {/* connector line */}
                {i < STEPS.length - 1 && (
                  <div style={{ position: "absolute", top: 18, left: "50%", right: "-50%", height: 2, background: done ? "var(--foreground)" : "rgba(255,255,255,0.08)", zIndex: 0, transition: "background 0.3s" }} />
                )}
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: done ? "var(--foreground)" : active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
                  border: active ? "2px solid var(--foreground)" : "2px solid transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.3s", position: "relative", zIndex: 1,
                }}>
                  <step.Icon style={{
                    width: 16, height: 16,
                    color: done ? "var(--background)" : active ? "var(--foreground)" : "var(--muted-foreground)",
                  }} />
                </div>
                <p style={{ color: active ? "var(--foreground)" : done ? "var(--muted-foreground)" : "var(--muted-foreground)", fontSize: 10, fontWeight: active ? 700 : 400, marginTop: 6, letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "center" }}>
                  {step.label}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {isCancelled && (
        <div style={{ background: "rgba(255,59,48,0.08)", borderRadius: 12, padding: "12px 16px", marginBottom: 12, border: "1px solid rgba(255,59,48,0.2)" }}>
          <p style={{ color: "#ff3b30", fontSize: 13, fontWeight: 600 }}>Order cancelled</p>
        </div>
      )}

      {/* ── Customer card ─────────────────────────────────────────────────── */}
      {customer && (
        <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: "16px 20px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <User style={{ color: "var(--muted-foreground)", width: 20, height: 20 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 600 }}>{customer.name}</p>
            <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
              {[customer.phone, customer.island, order.channel].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      )}

      {/* ── STAGE: Confirmed — ready to dispatch ─────────────────────────── */}
      {isConfirmed && (
        <>
          {/* Payment method badge */}
          <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: 20, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "14px 16px", background: isCOD ? "rgba(251,146,60,0.08)" : "rgba(96,165,250,0.08)", borderRadius: 12, border: `1px solid ${isCOD ? "rgba(251,146,60,0.2)" : "rgba(96,165,250,0.2)"}` }}>
              {isCOD
                ? <Banknote style={{ color: "#fb923c", width: 22, height: 22, flexShrink: 0 }} />
                : <Smartphone style={{ color: "#60a5fa", width: 22, height: 22, flexShrink: 0 }} />}
              <div>
                <p style={{ color: isCOD ? "#fb923c" : "#60a5fa", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {isCOD ? "Cash on Delivery" : "Bank Transfer"}
                </p>
                <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 2 }}>
                  {isCOD ? "Driver collects MVR " + fmt(totals.mvr) + " on delivery" : "Customer will send payment slip"}
                </p>
              </div>
            </div>

            <LineList lines={lines} skus={skus} editable={false} />
            {totals.count > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ color: "var(--muted-foreground)", fontSize: 14 }}>Order Total</span>
                <span style={{ color: "var(--foreground)", fontSize: 18, fontWeight: 700 }}>MVR {fmt(totals.mvr)}</span>
              </div>
            )}
          </div>
          <button
            onClick={() => { setSelectedDriver(order.assigned_driver_id ?? ""); setPanel("dispatch"); }}
            style={{ width: "100%", background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 999, padding: "16px", fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", marginBottom: 12 }}
          >
            Assign Driver & Dispatch →
          </button>
        </>
      )}

      {/* ── STAGE: Out for delivery ──────────────────────────────────────── */}
      {isDispatched && (
        <>
          <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: 20, marginBottom: 12 }}>
            {/* Driver badge */}
            {order.assigned_driver_id && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "12px 14px", background: "rgba(74,222,128,0.08)", borderRadius: 12, border: "1px solid rgba(74,222,128,0.15)" }}>
                <Truck style={{ color: "#4ade80", width: 20, height: 20, flexShrink: 0 }} />
                <div>
                  <p style={{ color: "#4ade80", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Out for Delivery</p>
                  <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 600 }}>
                    {drivers.find((d) => d.id === order.assigned_driver_id)?.full_name ?? "Driver"}
                  </p>
                </div>
              </div>
            )}

            {/* COD reminder */}
            {isCOD && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "10px 14px", background: "rgba(251,146,60,0.08)", borderRadius: 10 }}>
                <Banknote style={{ color: "#fb923c", width: 18, height: 18, flexShrink: 0 }} />
                <p style={{ color: "#fb923c", fontSize: 12, fontWeight: 600 }}>COD — driver must collect MVR {fmt(totals.mvr)}</p>
              </div>
            )}

            <LineList lines={lines} skus={skus} editable={false} />
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ color: "var(--muted-foreground)", fontSize: 14 }}>Order Total</span>
              <span style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 700 }}>MVR {fmt(totals.mvr)}</span>
            </div>
          </div>
          <button
            onClick={() => { setCashCollected(isCOD ? String(totals.mvr.toFixed(0)) : ""); setPanel("deliver"); }}
            style={{ width: "100%", background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 999, padding: "16px", fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", marginBottom: 12 }}
          >
            Mark as Delivered →
          </button>
        </>
      )}

      {/* ── STAGE: Delivered ─────────────────────────────────────────────── */}
      {isDelivered && (
        <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: 20, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <CheckCircle2 style={{ color: "#4ade80", width: 22, height: 22 }} />
            <p style={{ color: "#4ade80", fontSize: 16, fontWeight: 700 }}>Delivered</p>
          </div>

          {/* Financial summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 16 }}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Order Total</p>
              <p style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 700 }}>MVR {fmt(totals.mvr)}</p>
            </div>
            {order.cash_collected_mvr != null && (
              <div style={{ background: "rgba(74,222,128,0.06)", borderRadius: 12, padding: 16 }}>
                <p style={{ color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Cash Collected</p>
                <p style={{ color: "#4ade80", fontSize: 20, fontWeight: 700 }}>MVR {fmt(order.cash_collected_mvr)}</p>
              </div>
            )}
          </div>

          {/* Payment action — context-aware */}
          {isCOD ? (
            order.payment_status !== "deposited" ? (
              <button
                onClick={() => setPanel("deposit")}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 999, padding: "16px", fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", marginBottom: 16 }}
              >
                <Landmark style={{ width: 18, height: 18 }} />
                Mark Cash Deposited to Bank
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", background: "rgba(74,222,128,0.08)", borderRadius: 12, marginBottom: 16, border: "1px solid rgba(74,222,128,0.15)" }}>
                <CheckCircle2 style={{ color: "#4ade80", width: 18, height: 18 }} />
                <p style={{ color: "#4ade80", fontSize: 13, fontWeight: 600 }}>Cash deposited to bank</p>
                {order.cash_deposited_at && (
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginLeft: "auto" }}>
                    {new Date(order.cash_deposited_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            )
          ) : (
            order.payment_status !== "paid" ? (
              <button
                onClick={handleMarkPaid}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 999, padding: "16px", fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", marginBottom: 16 }}
              >
                <Smartphone style={{ width: 18, height: 18 }} />
                Mark Payment Received
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", background: "rgba(74,222,128,0.08)", borderRadius: 12, marginBottom: 16, border: "1px solid rgba(74,222,128,0.15)" }}>
                <CheckCircle2 style={{ color: "#4ade80", width: 18, height: 18 }} />
                <p style={{ color: "#4ade80", fontSize: 13, fontWeight: 600 }}>Bank transfer received</p>
              </div>
            )
          )}

          <LineList lines={lines} skus={skus} editable={false} />
        </div>
      )}

      {/* ── Modals / bottom sheets ─────────────────────────────────────── */}

      {/* Dispatch */}
      <Sheet open={panel === "dispatch"} onClose={() => setPanel(null)}>
        <h2 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Assign Driver</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 20 }}>
          Pick a driver. The order will move to their dispatch board immediately.
        </p>
        <div style={{ marginBottom: 20 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 8 }}>Driver *</p>
          <select
            value={selectedDriver}
            onChange={(e) => setSelectedDriver(e.target.value)}
            style={{ width: "100%", background: "rgba(255,255,255,0.06)", color: "var(--foreground)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px", fontSize: 14, outline: "none", cursor: "pointer" }}
          >
            <option value="">Select driver…</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </div>
        <SheetActions>
          <button onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          <button onClick={handleDispatch} disabled={!selectedDriver || dispatching} style={{ ...primaryBtn, opacity: !selectedDriver || dispatching ? 0.5 : 1, cursor: !selectedDriver || dispatching ? "not-allowed" : "pointer" }}>
            {dispatching ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Dispatch Now"}
          </button>
        </SheetActions>
      </Sheet>

      {/* Deliver */}
      <Sheet open={panel === "deliver"} onClose={() => setPanel(null)}>
        <h2 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Delivery Confirmed?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 20 }}>
          Order value: <strong style={{ color: "var(--foreground)" }}>MVR {fmt(totals.mvr)}</strong>
        </p>
        {isCOD && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 8 }}>Cash collected by driver (MVR) *</p>
            <input
              type="number"
              inputMode="decimal"
              placeholder={String(totals.mvr.toFixed(0))}
              value={cashCollected}
              onChange={(e) => setCashCollected(e.target.value)}
              style={{ width: "100%", background: "rgba(255,255,255,0.06)", color: "var(--foreground)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px", fontSize: 22, fontWeight: 600, outline: "none", boxSizing: "border-box" }}
            />
          </div>
        )}
        <SheetActions>
          <button onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          <button onClick={handleDeliver} disabled={completing} style={{ ...primaryBtn, opacity: completing ? 0.5 : 1 }}>
            {completing ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Confirm Delivered"}
          </button>
        </SheetActions>
      </Sheet>

      {/* Deposit cash */}
      <Sheet open={panel === "deposit"} onClose={() => setPanel(null)}>
        <h2 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Mark Cash Deposited?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>
          Confirm you have deposited the cash collected for <strong style={{ color: "var(--foreground)" }}>{order.order_number}</strong> into the bank.
          {order.cash_collected_mvr != null && (
            <span style={{ display: "block", color: "var(--foreground)", fontSize: 22, fontWeight: 700, marginTop: 8 }}>MVR {fmt(order.cash_collected_mvr)}</span>
          )}
        </p>
        <SheetActions>
          <button onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          <button onClick={handleDeposit} disabled={depositing} style={{ ...primaryBtn, opacity: depositing ? 0.5 : 1 }}>
            {depositing ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Deposited ✓"}
          </button>
        </SheetActions>
      </Sheet>

      {/* Delete order */}
      <Sheet open={panel === "delete"} onClose={() => setPanel(null)}>
        <h2 style={{ color: "#ff3b30", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Delete Order?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>
          <strong style={{ color: "var(--foreground)" }}>{order.order_number}</strong> and all its items will be permanently deleted. This cannot be undone.
        </p>
        <SheetActions>
          <button onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          <button onClick={handleDeleteOrder} disabled={deleting} style={{ ...primaryBtn, background: "#ff3b30" }}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Delete"}
          </button>
        </SheetActions>
      </Sheet>

      {/* Delete line */}
      <Sheet open={panel === "deleteLine"} onClose={() => { setPendingDeleteLine(null); setPanel(null); }}>
        <h2 style={{ color: "#ff3b30", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Remove item?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>
          {pendingDeleteLine && (() => {
            const sku = skus.find((s) => s.id === pendingDeleteLine.sku_id);
            return sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "This item";
          })()} will be removed from the order.
        </p>
        <SheetActions>
          <button onClick={() => { setPendingDeleteLine(null); setPanel(null); }} style={ghostBtn}>Cancel</button>
          <button onClick={handleDeleteLine} disabled={deletingLine} style={{ ...primaryBtn, background: "#ff3b30" }}>
            {deletingLine ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Remove"}
          </button>
        </SheetActions>
      </Sheet>

      {/* Add / edit line */}
      {panel === "addLine" && (
        <LineDialog
          editing={editingLine}
          orderId={id}
          skus={skus}
          stockLevels={stockLevels}
          sourceGodownId={order.source_godown_id}
          onClose={() => { setEditingLine(undefined); setPanel(null); }}
          onSaved={() => { setEditingLine(undefined); setPanel(null); load(); }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Shared sub-components                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

const ghostBtn: React.CSSProperties = {
  flex: 1, background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)",
  border: "none", borderRadius: 999, padding: "14px", fontSize: 14, cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  flex: 2, background: "var(--foreground)", color: "var(--background)",
  border: "none", borderRadius: 999, padding: "14px", fontSize: 13,
  fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
};

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 60, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", borderRadius: "20px 20px 0 0", width: "100%", padding: "28px 24px 40px", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 999, margin: "0 auto 24px" }} />
        {children}
      </div>
    </div>
  );
}

function SheetActions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 12 }}>{children}</div>;
}

function LineList({
  lines, skus, editable, onEdit, onDelete, style: extraStyle,
}: {
  lines: SalesOrderLineRow[];
  skus: SkuFullRow[];
  editable: boolean;
  onEdit?: (l: SalesOrderLineRow) => void;
  onDelete?: (l: SalesOrderLineRow) => void;
  style?: React.CSSProperties;
}) {
  if (lines.length === 0) {
    return <p style={{ color: "var(--muted-foreground)", fontSize: 13, textAlign: "center", padding: "20px 0", ...extraStyle }}>No items yet.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...extraStyle }}>
      {lines.map((l) => {
        const sku = skus.find((s) => s.id === l.sku_id);
        return (
          <div key={l.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {sku ? `${sku.brand_name} › ${sku.variant_display}` : l.sku_id}
              </p>
              <p style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
                {l.qty} {l.uom} · MVR {Number(l.unit_price_mvr).toLocaleString()}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>
                MVR {Number(l.line_total_mvr).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              {editable && onEdit && onDelete && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => onEdit(l)} style={{ background: "none", border: "none", color: "var(--muted-foreground)", fontSize: 11, cursor: "pointer", padding: "4px 6px" }}>Edit</button>
                  <button onClick={() => onDelete(l)} style={{ background: "none", border: "none", color: "#ff3b30", fontSize: 11, cursor: "pointer", padding: "4px 6px" }}>✕</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Line dialog (add / edit)                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function LineDialog({
  editing, orderId, skus, stockLevels, sourceGodownId, onClose, onSaved,
}: {
  editing?: SalesOrderLineRow;
  orderId: string;
  skus: SkuFullRow[];
  stockLevels: StockLevel[];
  sourceGodownId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [skuId, setSkuId]         = useState(editing?.sku_id ?? "");
  const [search, setSearch]       = useState("");
  const [uom, setUom]             = useState<SaleUom>(editing?.uom ?? "pack");
  const [qty, setQty]             = useState(editing ? String(editing.qty) : "");
  const [unitPrice, setUnitPrice] = useState(editing ? String(editing.unit_price_mvr) : "");
  const [saving, setSaving]       = useState(false);

  const sku = skus.find((s) => s.id === skuId);

  useEffect(() => {
    if (!skuId || editing) return;
    const s = skus.find((x) => x.id === skuId);
    if (!s) return;
    const p = uom === "piece" ? s.selling_price_per_piece_mvr : uom === "pack" ? s.selling_price_per_pack_mvr : s.selling_price_per_carton_mvr;
    if (p != null) setUnitPrice(p.toFixed(2));
    else setUnitPrice("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuId, uom]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    if (!term) return active.slice(0, 50);
    return active.filter((s) =>
      [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""].join(" ").toLowerCase().includes(term),
    ).slice(0, 50);
  }, [skus, search]);

  const stockHere = sku && sourceGodownId
    ? stockLevels.find((l) => l.sku_id === sku.id && l.godown_id === sourceGodownId)?.qty_pieces ?? 0
    : null;

  const qtyPieces = useMemo(() => {
    if (!sku || !qty) return 0;
    const n = parseFloat(qty);
    if (isNaN(n) || n <= 0) return 0;
    return toPieces(uom, n, sku.pcs_per_pack, sku.packs_per_carton);
  }, [sku, qty, uom]);

  const lineTotal = useMemo(() => {
    const q = parseFloat(qty); const p = parseFloat(unitPrice);
    if (isNaN(q) || isNaN(p)) return 0;
    return q * p;
  }, [qty, unitPrice]);

  const insufficient = stockHere !== null && qtyPieces > stockHere;

  async function save() {
    if (!skuId || !qty || !unitPrice || qtyPieces <= 0 || !sku) return;
    const payload = { order_id: orderId, sku_id: skuId, uom, qty: parseFloat(qty), qty_pieces: qtyPieces, unit_price_mvr: parseFloat(unitPrice), line_total_mvr: lineTotal };
    setSaving(true);
    try {
      if (editing) await updateOrderLine(editing.id, payload);
      else await createOrderLine(payload);
      toast.success(editing ? "Item updated" : "Item added");
      onSaved();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)", color: "var(--foreground)",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
    padding: "10px 12px", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 60, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", borderRadius: "20px 20px 0 0", width: "100%", padding: "28px 24px 40px", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 999, margin: "0 auto 24px" }} />
        <h2 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, marginBottom: 20 }}>{editing ? "Edit item" : "Add item"}</h2>

        {/* Product picker */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 8 }}>Product *</p>
          {!skuId ? (
            <>
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search brand, product, variant…"
                style={inputStyle}
              />
              <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", maxHeight: 220, overflowY: "auto", marginTop: 8, background: "rgba(0,0,0,0.3)" }}>
                {filtered.length === 0 ? (
                  <p style={{ color: "var(--muted-foreground)", fontSize: 13, padding: "12px" }}>No matches</p>
                ) : filtered.map((s) => {
                  const stock = sourceGodownId
                    ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === sourceGodownId)?.qty_pieces ?? 0
                    : null;
                  return (
                    <button key={s.id} onClick={() => setSkuId(s.id)} style={{ width: "100%", textAlign: "left", padding: "10px 14px", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 500 }}>{s.brand_name} › {s.model_name} › {s.variant_display}</p>
                        <p style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn</p>
                      </div>
                      {stock !== null && (
                        <span style={{ color: stock > 0 ? "#4ade80" : "#ff3b30", fontSize: 11, flexShrink: 0, marginLeft: 12 }}>{stock} pcs</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : sku ? (
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>{sku.brand_name} › {sku.model_name} › {sku.variant_display}</p>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn</p>
                </div>
                <button onClick={() => setSkuId("")} style={{ background: "none", border: "none", color: "var(--muted-foreground)", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>Change</button>
              </div>
              {stockHere !== null && (
                <p style={{ color: stockHere === 0 ? "#ff3b30" : "var(--muted-foreground)", fontSize: 11, marginTop: 6 }}>
                  In warehouse: <strong style={{ color: "var(--foreground)" }}>{stockHere.toLocaleString()} pcs</strong>
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* Qty / UoM / Price */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Sell by *</p>
            <select value={uom} onChange={(e) => setUom(e.target.value as SaleUom)} style={inputStyle}>
              <option value="carton">Carton</option>
              <option value="pack">Pack</option>
              <option value="piece">Piece</option>
            </select>
          </div>
          <div>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Qty *</p>
            <input type="number" inputMode={uom === "piece" ? "numeric" : "decimal"} step={uom === "piece" ? "1" : "0.5"} min="1" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>
              Price (MVR) *{" "}
              {sku && (uom === "piece" ? sku.selling_price_per_piece_mvr : uom === "pack" ? sku.selling_price_per_pack_mvr : sku.selling_price_per_carton_mvr) != null && (
                <span style={{ color: "#4ade80", fontSize: 9, letterSpacing: "0.06em" }}>AUTO</span>
              )}
            </p>
            <input type="number" inputMode="decimal" step="0.01" min="0" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} style={inputStyle} />
          </div>
        </div>

        {/* Summary */}
        {sku && qtyPieces > 0 && (
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Pieces</span>
              <span style={{ color: "var(--foreground)", fontSize: 12 }}>{qtyPieces.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Line total</span>
              <span style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 700 }}>MVR {lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        )}

        {insufficient && (
          <div style={{ background: "rgba(255,59,48,0.1)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, border: "1px solid rgba(255,59,48,0.25)" }}>
            <p style={{ color: "#ff3b30", fontSize: 12 }}>⚠ Not enough stock — only {stockHere} pcs available.</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={save} disabled={saving || !skuId || !qty || !unitPrice || qtyPieces <= 0 || insufficient} style={{ ...primaryBtn, opacity: saving || !skuId || !qty || !unitPrice || qtyPieces <= 0 || insufficient ? 0.5 : 1, cursor: saving || !skuId || !qty || !unitPrice || qtyPieces <= 0 || insufficient ? "not-allowed" : "pointer" }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : editing ? "Save" : "Add item"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Trash2, User, Truck, CheckCircle2, Banknote, Smartphone, Landmark, Printer, AlertTriangle } from "lucide-react";
import {
  getOrder,
  listOrderLines,
  updateOrder,
  deleteOrder,
  createOrderLine,
  updateOrderLine,
  deleteOrderLine,
  toPieces,
  getTierPricesForSkus,
  type SalesOrderRow,
  type SalesOrderLineRow,
  type OrderStatus,
  type PaymentStatus,
  type SaleUom,
  type TierPrice,
} from "@/lib/queries/sales";
import { withOfflineFallback } from "@/lib/offline-write";
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

  // payment reference (bank transfer)
  const [refInput, setRefInput]       = useState("");
  const [editingRef, setEditingRef]   = useState(false);
  const [savingRef, setSavingRef]     = useState(false);

  // delivery address inline editing
  const [editingAddress,   setEditingAddress]   = useState(false);
  const [addrLine1,        setAddrLine1]        = useState("");
  const [addrLine2,        setAddrLine2]        = useState("");
  const [addrIsland,       setAddrIsland]       = useState("");
  const [savingAddress,    setSavingAddress]    = useState(false);

  // inline dialogs (sheet-style bottom panels)
  const [panel, setPanel] = useState<"dispatch" | "deliver" | "deposit" | "delete" | "deleteLine" | "addLine" | "printLabels" | null>(null);
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
  const canWrite  = role !== "viewer" && role !== null;
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

  async function savePaymentRef() {
    if (!order) return;
    setSavingRef(true);
    try {
      await updateOrder(order.id, { payment_proof_url: refInput.trim() || null });
      setOrder({ ...order, payment_proof_url: refInput.trim() || null });
      setEditingRef(false);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSavingRef(false); }
  }

  async function handleDispatch() {
    if (!order || !selectedDriver) return;
    setDispatching(true);
    const p = { assigned_driver_id: selectedDriver, status: "out_for_delivery" } as Record<string, unknown>;
    try {
      const { queued } = await withOfflineFallback(
        () => updateOrder(order.id, p),
        { table: "sales_orders", action: "update", payload: p, match: { id: order.id } },
      );
      toast.success(queued ? "Saved offline — will sync when connected" : "Order dispatched to driver");
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDispatching(false); }
  }

  async function handleDeliver() {
    if (!order) return;
    setCompleting(true);
    const cash = parseFloat(cashCollected);
    const p = {
      status: "delivered",
      delivered_at: new Date().toISOString(),
      ...(isNaN(cash) ? {} : { cash_collected_mvr: cash }),
    } as Record<string, unknown>;
    try {
      const { queued } = await withOfflineFallback(
        () => updateOrder(order.id, p),
        { table: "sales_orders", action: "update", payload: p, match: { id: order.id } },
      );
      toast.success(queued ? "Saved offline — will sync when connected" : "Order marked as delivered");
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setCompleting(false); }
  }

  async function handleDeposit() {
    if (!order) return;
    setDepositing(true);
    const p = { payment_status: "deposited", cash_deposited_at: new Date().toISOString() } as Record<string, unknown>;
    try {
      const { queued } = await withOfflineFallback(
        () => updateOrder(order.id, p),
        { table: "sales_orders", action: "update", payload: p, match: { id: order.id } },
      );
      toast.success(queued ? "Saved offline — will sync when connected" : "Cash marked as deposited");
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDepositing(false); }
  }

  async function handleMarkPaid() {
    if (!order) return;
    const p = { payment_status: "paid" } as Record<string, unknown>;
    try {
      const { queued } = await withOfflineFallback(
        () => updateOrder(order.id, p),
        { table: "sales_orders", action: "update", payload: p, match: { id: order.id } },
      );
      toast.success(queued ? "Saved offline — will sync when connected" : "Payment received");
      load();
    } catch (e) { toast.error((e as Error).message); }
  }

  function startEditAddress() {
    if (!order) return;
    setAddrLine1(order.delivery_address_line1 ?? "");
    setAddrLine2(order.delivery_address_line2 ?? "");
    setAddrIsland(order.delivery_island ?? "");
    setEditingAddress(true);
  }

  async function saveAddress() {
    if (!order) return;
    setSavingAddress(true);
    const p = {
      delivery_address_line1: addrLine1.trim() || null,
      delivery_address_line2: addrLine2.trim() || null,
      delivery_island: addrIsland.trim() || null,
    } as Record<string, unknown>;
    try {
      const { queued } = await withOfflineFallback(
        () => updateOrder(order.id, p),
        { table: "sales_orders", action: "update", payload: p, match: { id: order.id } },
      );
      toast.success(queued ? "Saved offline — will sync when connected" : "Address saved");
      setEditingAddress(false);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSavingAddress(false); }
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
        <Link href="/sales" className="snm-pressable" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 12, background: "var(--glass-bg-1)", color: "var(--muted-foreground)", textDecoration: "none" }}>
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>Sales Order</p>
          <h1 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {customer?.name ?? "Walk-in"}
            <span style={{ color: "var(--muted-foreground)", fontSize: 13, fontWeight: 400, marginLeft: 8 }}>{order.order_number}</span>
          </h1>
        </div>
        {canWrite && (
          <button
            onClick={() => setPanel("delete")}
            className="snm-pressable"
            style={{ width: 44, height: 44, borderRadius: 12, background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", border: "none", color: "var(--snm-error)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <Trash2 style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>

      {/* ── Progress stepper ─────────────────────────────────────────────── */}
      {!isCancelled && (
        <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: "20px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
          {STEPS.map((step, i) => {
            const done    = currentStep > i;
            const active  = currentStep === i;
            return (
              <div key={step.status} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", zIndex: 1 }}>
                {/* connector line */}
                {i < STEPS.length - 1 && (
                  <div style={{ position: "absolute", top: 18, left: "50%", right: "-50%", height: 2, background: done ? "var(--foreground)" : "var(--glass-border-lo)", zIndex: 0, transition: "background 0.3s" }} />
                )}
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: done ? "var(--foreground)" : active ? "var(--glass-bg-2)" : "var(--glass-bg-1)",
                  border: active ? "2px solid var(--foreground)" : "2px solid transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.3s", position: "relative", zIndex: 1,
                }}>
                  <step.Icon style={{
                    width: 16, height: 16,
                    color: done ? "var(--background)" : active ? "var(--foreground)" : "var(--muted-foreground)",
                  }} />
                </div>
                <p style={{ color: active ? "var(--foreground)" : done ? "var(--muted-foreground)" : "var(--muted-foreground)", fontSize: 11, fontWeight: active ? 700 : 400, marginTop: 6, letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "center" }}>
                  {step.label}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {isCancelled && (
        <div style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", borderRadius: 12, padding: "12px 16px", marginBottom: 12, border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)" }}>
          <p style={{ color: "var(--snm-error)", fontSize: 13, fontWeight: 600 }}>Order cancelled</p>
        </div>
      )}

      {/* ── Customer card ─────────────────────────────────────────────────── */}
      {customer && (
        <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: "16px 20px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--glass-bg-1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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

      {/* ── DELIVERY ADDRESS card ─────────────────────────────────────────── */}
      {(isConfirmed || isDispatched) && canWrite && (
        <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: "16px 20px", marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: editingAddress ? 14 : 0 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase" }}>Delivery Address</p>
            {!editingAddress && (
              <button
                onClick={startEditAddress}
                style={{ fontSize: 11, fontWeight: 600, color: "var(--snm-brand)", background: "transparent", border: "none", cursor: "pointer", padding: "2px 0" }}
              >
                {(order?.delivery_address_line1 || order?.delivery_island) ? "Edit" : "+ Add Address"}
              </button>
            )}
          </div>

          {!editingAddress && (order?.delivery_address_line1 || order?.delivery_address_line2 || order?.delivery_island) && (
            <div style={{ marginTop: 6 }}>
              {order?.delivery_address_line1 && <p style={{ color: "var(--foreground)", fontSize: 13, lineHeight: 1.5 }}>{order.delivery_address_line1}</p>}
              {order?.delivery_address_line2 && <p style={{ color: "var(--foreground)", fontSize: 13, lineHeight: 1.5 }}>{order.delivery_address_line2}</p>}
              {order?.delivery_island && <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{order.delivery_island}</p>}
            </div>
          )}

          {!editingAddress && !order?.delivery_address_line1 && !order?.delivery_island && (
            <p style={{ color: "var(--muted-foreground)", fontSize: 13, marginTop: 4 }}>No address added yet</p>
          )}

          {editingAddress && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 5 }}>House / Building</p>
                <input
                  value={addrLine1}
                  onChange={(e) => setAddrLine1(e.target.value)}
                  placeholder="e.g. H. EKKALAGE"
                  style={{ width: "100%", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 8, padding: "10px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 5 }}>Street / Road</p>
                <input
                  value={addrLine2}
                  onChange={(e) => setAddrLine2(e.target.value)}
                  placeholder="e.g. MADUGADHOSHU MAGU"
                  style={{ width: "100%", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 8, padding: "10px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 5 }}>Island</p>
                <input
                  value={addrIsland}
                  onChange={(e) => setAddrIsland(e.target.value)}
                  placeholder="e.g. MALE"
                  style={{ width: "100%", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 8, padding: "10px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                <button
                  onClick={() => setEditingAddress(false)}
                  style={{ background: "transparent", border: "0.5px solid var(--glass-border-lo)", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "var(--muted-foreground)", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveAddress}
                  disabled={savingAddress}
                  style={{ background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 12, fontWeight: 700, cursor: savingAddress ? "not-allowed" : "pointer", opacity: savingAddress ? 0.6 : 1 }}
                >
                  {savingAddress ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── STAGE: Confirmed — ready to dispatch ─────────────────────────── */}
      {isConfirmed && (
        <>
          {/* Payment method badge */}
          <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "14px 16px", background: isCOD ? "color-mix(in srgb, var(--snm-warning) 10%, transparent)" : "color-mix(in srgb, var(--snm-brand) 10%, transparent)", borderRadius: 12, border: `1px solid ${isCOD ? "color-mix(in srgb, var(--snm-warning) 25%, transparent)" : "color-mix(in srgb, var(--snm-brand) 25%, transparent)"}` }}>
              {isCOD
                ? <Banknote style={{ color: "var(--snm-warning)", width: 22, height: 22, flexShrink: 0 }} />
                : <Smartphone style={{ color: "var(--snm-brand)", width: 22, height: 22, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ color: isCOD ? "var(--snm-warning)" : "var(--snm-brand)", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {isCOD ? "Cash on Delivery" : "Bank Transfer"}
                </p>
                <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 2 }}>
                  {isCOD ? "Driver collects MVR " + fmt(totals.mvr) + " on delivery" : "Customer will send payment slip"}
                </p>
                {!isCOD && (
                  <div style={{ marginTop: 8 }}>
                    {editingRef ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          autoFocus
                          value={refInput}
                          onChange={(e) => setRefInput(e.target.value)}
                          placeholder="e.g. TRF-20240511-0042"
                          style={{ flex: 1, background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: "var(--foreground)", outline: "none" }}
                          onKeyDown={(e) => { if (e.key === "Enter") savePaymentRef(); if (e.key === "Escape") setEditingRef(false); }}
                        />
                        <button
                          onClick={savePaymentRef}
                          disabled={savingRef}
                          style={{ background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          {savingRef ? "…" : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingRef(false)}
                          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 10px", fontSize: 11, color: "var(--muted-foreground)", cursor: "pointer" }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { if (!canWrite) return; setRefInput(order.payment_proof_url ?? ""); setEditingRef(true); }}
                        style={{ background: "var(--glass-bg-1)", border: "1px dashed var(--glass-border)", borderRadius: 8, padding: "5px 10px", fontSize: 11, color: order.payment_proof_url ? "var(--snm-brand)" : "var(--muted-foreground)", cursor: canWrite ? "pointer" : "default", display: "flex", alignItems: "center", gap: 6 }}
                      >
                        <Smartphone style={{ width: 12, height: 12 }} />
                        {order.payment_proof_url ? order.payment_proof_url : canWrite ? "Tap to add transfer reference" : "—"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <LineList lines={lines} skus={skus} editable={false} />
            {totals.count > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, marginTop: 8, borderTop: "0.5px solid var(--glass-border-lo)" }}>
                <span style={{ color: "var(--muted-foreground)", fontSize: 14 }}>Order Total</span>
                <span className="snm-num" style={{ color: "var(--foreground)", fontSize: 18, fontWeight: 700 }}>MVR {fmt(totals.mvr)}</span>
              </div>
            )}
          </div>
          {canWrite && (
            <button
              onClick={() => { setSelectedDriver(order.assigned_driver_id ?? ""); setPanel("dispatch"); }}
              style={{ width: "100%", background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 999, padding: "16px", fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", marginBottom: 10 }}
            >
              Assign Driver & Dispatch →
            </button>
          )}
          <button
            onClick={() => setPanel("printLabels")}
            style={{ width: "100%", background: "transparent", color: "var(--muted-foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 999, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            <Printer style={{ width: 16, height: 16 }} />
            Print Labels
          </button>
        </>
      )}

      {/* ── STAGE: Out for delivery ──────────────────────────────────────── */}
      {isDispatched && (
        <>
          <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
            {/* Driver badge */}
            {order.assigned_driver_id && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "12px 14px", background: "color-mix(in srgb, var(--snm-success) 10%, transparent)", borderRadius: 12, border: "1px solid color-mix(in srgb, var(--snm-success) 18%, transparent)" }}>
                <Truck style={{ color: "var(--snm-success)", width: 20, height: 20, flexShrink: 0 }} />
                <div>
                  <p style={{ color: "var(--snm-success)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Out for Delivery</p>
                  <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 600 }}>
                    {drivers.find((d) => d.id === order.assigned_driver_id)?.full_name ?? "Driver"}
                  </p>
                </div>
              </div>
            )}

            {/* COD reminder */}
            {isCOD && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "10px 14px", background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", borderRadius: 10 }}>
                <Banknote style={{ color: "var(--snm-warning)", width: 18, height: 18, flexShrink: 0 }} />
                <p style={{ color: "var(--snm-warning)", fontSize: 12, fontWeight: 600 }}>COD — driver must collect MVR {fmt(totals.mvr)}</p>
              </div>
            )}

            {/* Driver issue note */}
            {order.notes && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--snm-error) 20%, transparent)" }}>
                <AlertTriangle style={{ color: "var(--snm-error)", width: 16, height: 16, flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p style={{ color: "var(--snm-error)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Driver issue report</p>
                  <p style={{ color: "var(--foreground)", fontSize: 13 }}>{order.notes}</p>
                </div>
              </div>
            )}

            <LineList lines={lines} skus={skus} editable={false} />
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, marginTop: 8, borderTop: "0.5px solid var(--glass-border-lo)" }}>
              <span style={{ color: "var(--muted-foreground)", fontSize: 14 }}>Order Total</span>
              <span style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 700 }}>MVR {fmt(totals.mvr)}</span>
            </div>
          </div>
          {canWrite && (
            <button
              onClick={() => { setCashCollected(isCOD ? String(totals.mvr.toFixed(0)) : ""); setPanel("deliver"); }}
              style={{ width: "100%", background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 999, padding: "16px", fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", marginBottom: 10 }}
            >
              Mark as Delivered →
            </button>
          )}
          <button
            onClick={() => setPanel("printLabels")}
            style={{ width: "100%", background: "transparent", color: "var(--muted-foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 999, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            <Printer style={{ width: 16, height: 16 }} />
            Print Labels
          </button>
        </>
      )}

      {/* ── STAGE: Delivered ─────────────────────────────────────────────── */}
      {isDelivered && (
        <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <CheckCircle2 style={{ color: "var(--snm-success)", width: 22, height: 22 }} />
            <p style={{ color: "var(--snm-success)", fontSize: 16, fontWeight: 700 }}>Delivered</p>
          </div>

          {/* Financial summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ background: "var(--glass-bg-1)", borderRadius: 12, padding: 16 }}>
              <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Order Total</p>
              <p className="snm-num" style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 700 }}>MVR {fmt(totals.mvr)}</p>
            </div>
            {order.cash_collected_mvr != null && (
              <div style={{ background: "color-mix(in srgb, var(--snm-success) 8%, transparent)", borderRadius: 12, padding: 16 }}>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Cash Collected</p>
                <p className="snm-num" style={{ color: "var(--snm-success)", fontSize: 20, fontWeight: 700 }}>MVR {fmt(order.cash_collected_mvr)}</p>
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
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", background: "color-mix(in srgb, var(--snm-success) 10%, transparent)", borderRadius: 12, marginBottom: 16, border: "1px solid color-mix(in srgb, var(--snm-success) 18%, transparent)" }}>
                <CheckCircle2 style={{ color: "var(--snm-success)", width: 18, height: 18 }} />
                <p style={{ color: "var(--snm-success)", fontSize: 13, fontWeight: 600 }}>Cash deposited to bank</p>
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
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", background: "color-mix(in srgb, var(--snm-success) 10%, transparent)", borderRadius: 12, marginBottom: 16, border: "1px solid color-mix(in srgb, var(--snm-success) 18%, transparent)" }}>
                <CheckCircle2 style={{ color: "var(--snm-success)", width: 18, height: 18 }} />
                <p style={{ color: "var(--snm-success)", fontSize: 13, fontWeight: 600 }}>Bank transfer received</p>
              </div>
            )
          )}

          {/* Driver issue note — shown on delivered orders as audit trail */}
          {order.notes && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, padding: "12px 14px", background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--snm-warning) 20%, transparent)" }}>
              <AlertTriangle style={{ color: "var(--snm-warning)", width: 16, height: 16, flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ color: "var(--snm-warning)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Driver note</p>
                <p style={{ color: "var(--foreground)", fontSize: 13 }}>{order.notes}</p>
              </div>
            </div>
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
            style={{ width: "100%", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 10, padding: "12px", fontSize: 14, outline: "none", cursor: "pointer" }}
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
              style={{ width: "100%", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 10, padding: "12px", fontSize: 22, fontWeight: 600, outline: "none", boxSizing: "border-box" }}
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
        <h2 style={{ color: "var(--snm-error)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Delete Order?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>
          <strong style={{ color: "var(--foreground)" }}>{order.order_number}</strong> and all its items will be permanently deleted. This cannot be undone.
        </p>
        <SheetActions>
          <button onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          <button onClick={handleDeleteOrder} disabled={deleting} style={{ ...primaryBtn, background: "var(--snm-error)" }}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Delete"}
          </button>
        </SheetActions>
      </Sheet>

      {/* Delete line */}
      <Sheet open={panel === "deleteLine"} onClose={() => { setPendingDeleteLine(null); setPanel(null); }}>
        <h2 style={{ color: "var(--snm-error)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Remove item?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>
          {pendingDeleteLine && (() => {
            const sku = skus.find((s) => s.id === pendingDeleteLine.sku_id);
            return sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : "This item";
          })()} will be removed from the order.
        </p>
        <SheetActions>
          <button onClick={() => { setPendingDeleteLine(null); setPanel(null); }} style={ghostBtn}>Cancel</button>
          <button onClick={handleDeleteLine} disabled={deletingLine} style={{ ...primaryBtn, background: "var(--snm-error)" }}>
            {deletingLine ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Remove"}
          </button>
        </SheetActions>
      </Sheet>

      {/* Print labels */}
      <Sheet open={panel === "printLabels"} onClose={() => setPanel(null)}>
        <h2 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, marginBottom: 6 }}>Print Labels</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 13, marginBottom: 20 }}>
          Tap a product below to open its label preview and print.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {lines.map((l) => {
            const sku = skus.find((s) => s.id === l.sku_id);
            return (
              <a
                key={l.id}
                href={`/sales/${id}/label/${l.id}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "var(--glass-bg-1)", borderRadius: 12, textDecoration: "none", border: "0.5px solid var(--glass-border-lo)" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {sku ? `${sku.model_name} · ${sku.variant_display}` : "Product"}
                  </p>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 2 }}>
                    {l.qty} {l.uom} · {sku?.pcs_per_pack ?? "?"} pcs/pack
                  </p>
                </div>
                <Printer style={{ width: 18, height: 18, color: "var(--muted-foreground)", flexShrink: 0, marginLeft: 12 }} />
              </a>
            );
          })}
        </div>
      </Sheet>

      {/* Add / edit line */}
      {panel === "addLine" && (
        <LineDialog
          editing={editingLine}
          orderId={id}
          skus={skus}
          stockLevels={stockLevels}
          sourceGodownId={order.source_godown_id}
          customerTier={customer?.price_tier ?? "retail"}
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
  flex: 1, background: "var(--glass-bg-1)", color: "var(--muted-foreground)",
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 60, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", borderRadius: "20px 20px 0 0", width: "100%", padding: "28px 24px max(40px, env(safe-area-inset-bottom, 40px))", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ width: 40, height: 4, background: "var(--glass-border)", borderRadius: 999, margin: "0 auto 24px" }} />
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
          <div key={l.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--glass-bg-1)", borderRadius: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {sku ? `${sku.brand_name} › ${sku.variant_display}` : l.sku_id}
              </p>
              <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
                {l.qty} {l.uom} · MVR {Number(l.unit_price_mvr).toLocaleString()}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span className="snm-num" style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>
                MVR {Number(l.line_total_mvr).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              {editable && onEdit && onDelete && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => onEdit(l)} style={{ background: "none", border: "none", color: "var(--muted-foreground)", fontSize: 11, cursor: "pointer", padding: "4px 6px" }}>Edit</button>
                  <button onClick={() => onDelete(l)} style={{ background: "none", border: "none", color: "var(--snm-error)", fontSize: 11, cursor: "pointer", padding: "4px 6px" }}>✕</button>
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
  editing, orderId, skus, stockLevels, sourceGodownId, customerTier, onClose, onSaved,
}: {
  editing?: SalesOrderLineRow;
  orderId: string;
  skus: SkuFullRow[];
  stockLevels: StockLevel[];
  sourceGodownId: string | null;
  customerTier: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [skuId, setSkuId]         = useState(editing?.sku_id ?? "");
  const [search, setSearch]       = useState("");
  const [uom, setUom]             = useState<SaleUom>(editing?.uom ?? "pack");
  const [qty, setQty]             = useState(editing ? String(editing.qty) : "");
  const [unitPrice, setUnitPrice] = useState(editing ? String(editing.unit_price_mvr) : "");
  const [priceOverride, setPriceOverride] = useState(!!editing);
  const [tierPriceMap, setTierPriceMap]   = useState<Map<string, TierPrice>>(new Map());
  const [saving, setSaving]       = useState(false);

  // Load tier prices for all active SKUs once (one RPC call)
  useEffect(() => {
    const allIds = skus.filter((s) => s.is_active).map((s) => s.id);
    if (allIds.length === 0) return;
    getTierPricesForSkus(allIds, customerTier)
      .then(setTierPriceMap)
      .catch(() => {/* fallback to sku defaults silently */});
  }, [skus, customerTier]);

  const sku = skus.find((s) => s.id === skuId);

  const autoPrice = useMemo(() => {
    if (!skuId) return null;
    const tierPx = tierPriceMap.get(skuId);
    if (tierPx) {
      return uom === "piece" ? Number(tierPx.price_per_piece_mvr)
        : uom === "pack" ? Number(tierPx.price_per_pack_mvr)
        : Number(tierPx.price_per_carton_mvr);
    }
    // Fallback to SKU default
    const s = skus.find((x) => x.id === skuId);
    if (!s) return null;
    return uom === "piece" ? s.selling_price_per_piece_mvr
      : uom === "pack" ? s.selling_price_per_pack_mvr
      : s.selling_price_per_carton_mvr;
  }, [skuId, uom, skus, tierPriceMap]);

  const autoSource = useMemo(() => {
    if (!skuId) return null;
    const tierPx = tierPriceMap.get(skuId);
    return tierPx?.source ?? "sku_default";
  }, [skuId, tierPriceMap]);

  useEffect(() => {
    if (editing) return;
    if (autoPrice != null) {
      setUnitPrice(autoPrice.toFixed(2));
      setPriceOverride(false);
    } else {
      setUnitPrice("");
      setPriceOverride(true);
    }
  }, [autoPrice, editing]);

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
    background: "var(--glass-bg-1)", color: "var(--foreground)",
    border: "0.5px solid var(--glass-border-lo)", borderRadius: 10,
    padding: "10px 12px", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 60, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", borderRadius: "20px 20px 0 0", width: "100%", padding: "28px 24px max(40px, env(safe-area-inset-bottom, 40px))", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div style={{ width: 40, height: 4, background: "var(--glass-border)", borderRadius: 999, margin: "0 auto 24px" }} />
        <h2 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, marginBottom: 20 }}>{editing ? "Edit item" : "Add item"}</h2>

        {/* Product picker */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 8 }}>Product *</p>
          {!skuId ? (
            <>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search brand, product, variant…"
                style={inputStyle}
              />
              <div style={{ borderRadius: 10, border: "0.5px solid var(--glass-border-lo)", maxHeight: 220, overflowY: "auto", marginTop: 8, background: "var(--glass-bg-2)" }}>
                {filtered.length === 0 ? (
                  <p style={{ color: "var(--muted-foreground)", fontSize: 13, padding: "12px" }}>No matches</p>
                ) : filtered.map((s) => {
                  const stock = sourceGodownId
                    ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === sourceGodownId)?.qty_pieces ?? 0
                    : null;
                  return (
                    <button key={s.id} onClick={() => setSkuId(s.id)} style={{ width: "100%", textAlign: "left", padding: "10px 14px", background: "transparent", border: "none", borderBottom: "0.5px solid var(--glass-border-lo)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 500 }}>{s.brand_name} › {s.model_name} › {s.variant_display}</p>
                        <p style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn</p>
                      </div>
                      {stock !== null && (
                        <span style={{ color: stock > 0 ? "var(--snm-success)" : "var(--snm-error)", fontSize: 11, flexShrink: 0, marginLeft: 12 }}>{stock} pcs</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : sku ? (
            <div style={{ background: "var(--glass-bg-1)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <p style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>{sku.brand_name} › {sku.model_name} › {sku.variant_display}</p>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn</p>
                </div>
                <button onClick={() => setSkuId("")} style={{ background: "none", border: "none", color: "var(--muted-foreground)", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>Change</button>
              </div>
              {stockHere !== null && (
                <p style={{ color: stockHere === 0 ? "var(--snm-error)" : "var(--muted-foreground)", fontSize: 11, marginTop: 6 }}>
                  In warehouse: <strong style={{ color: "var(--foreground)" }}>{stockHere.toLocaleString()} pcs</strong>
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* UOM selector — 3 big tap targets, carton first */}
        {skuId && sku && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Selling unit *</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {([
                { value: "carton" as SaleUom, label: "Carton", sub: `${sku.pcs_per_pack * sku.packs_per_carton} pcs` },
                { value: "pack"   as SaleUom, label: "Pack",   sub: `${sku.pcs_per_pack} pcs` },
                { value: "piece"  as SaleUom, label: "Piece",  sub: "1 pc" },
              ] as { value: SaleUom; label: string; sub: string }[]).map((opt) => {
                const active = uom === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setUom(opt.value)}
                    style={{
                      background: active ? "var(--foreground)" : "var(--glass-bg-1)",
                      color: active ? "var(--background)" : "var(--muted-foreground)",
                      border: active ? "none" : "0.5px solid var(--glass-border-lo)",
                      borderRadius: 12, padding: "12px 8px", cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                      transition: "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{opt.label}</span>
                    <span style={{ fontSize: 11, opacity: active ? 0.7 : 0.6 }}>{opt.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Qty + Price — side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Qty *</p>
            <input
              autoFocus={!!skuId}
              type="number" inputMode={uom === "piece" ? "numeric" : "decimal"}
              step={uom === "piece" ? "1" : "0.5"} min="1"
              value={qty} onChange={(e) => setQty(e.target.value)}
              style={{ ...inputStyle, fontSize: 22, fontWeight: 600, textAlign: "center" }}
            />
          </div>
          <div>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>
              Price / {uom} (MVR) *
            </p>
            {!priceOverride && autoPrice != null ? (
              <div
                style={{ ...inputStyle, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", cursor: "pointer", gap: 2 }}
                onClick={() => setPriceOverride(true)}
              >
                <span style={{ color: "var(--foreground)", fontWeight: 700, fontSize: 18 }}>{autoPrice.toFixed(2)}</span>
                <span style={{
                  background: autoSource === "price_list"
                    ? "color-mix(in srgb, var(--snm-brand) 18%, transparent)"
                    : "color-mix(in srgb, var(--snm-success) 18%, transparent)",
                  color: autoSource === "price_list" ? "var(--snm-brand)" : "var(--snm-success)",
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", padding: "2px 5px", borderRadius: 4,
                }}>
                  {autoSource === "price_list" ? customerTier.toUpperCase() : "DEFAULT"} · tap to edit
                </span>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input
                  autoFocus={priceOverride && !editing}
                  type="number" inputMode="decimal" step="0.01" min="0"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  style={{ ...inputStyle, fontSize: 20, fontWeight: 600 }}
                />
                {autoPrice != null && (
                  <button
                    type="button"
                    onClick={() => { setUnitPrice(autoPrice.toFixed(2)); setPriceOverride(false); }}
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--snm-success)", fontSize: 11, cursor: "pointer", fontWeight: 700 }}
                  >Reset</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Summary */}
        {sku && qtyPieces > 0 && (
          <div style={{ background: "var(--glass-bg-1)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            {/* Effective per-pack rate — shows the discount when selling by carton */}
            {uom === "carton" && (() => {
              const tierPx = tierPriceMap.get(skuId);
              const cartonPrice = parseFloat(unitPrice);
              const packPrice   = tierPx ? Number(tierPx.price_per_pack_mvr)
                : sku.selling_price_per_pack_mvr ?? null;
              const effectivePerPack = !isNaN(cartonPrice) && sku.packs_per_carton > 0
                ? cartonPrice / sku.packs_per_carton : null;
              const saving = packPrice && effectivePerPack
                ? packPrice - effectivePerPack : null;
              return effectivePerPack != null ? (
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, paddingBottom: 6, borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                  <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Effective / pack</span>
                  <span style={{ fontSize: 12 }}>
                    <span style={{ color: "var(--foreground)", fontWeight: 600 }}>MVR {effectivePerPack.toFixed(2)}</span>
                    {saving != null && saving > 0.005 && (
                      <span style={{ color: "var(--snm-success)", marginLeft: 6, fontSize: 11 }}>
                        (MVR {saving.toFixed(2)} off vs pack rate)
                      </span>
                    )}
                    {saving != null && saving <= 0.005 && (
                      <span style={{ color: "var(--snm-warning)", marginLeft: 6, fontSize: 11 }}>
                        ⚠ No carton discount set
                      </span>
                    )}
                  </span>
                </div>
              ) : null;
            })()}
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

        {/* No price list warning */}
        {sku && autoSource === "sku_default" && (
          <div style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
            <p style={{ color: "var(--snm-warning)", fontSize: 12, fontWeight: 600 }}>⚠ No price list set for {customerTier} tier</p>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 2 }}>Using SKU default price. Carton and pack have no volume discount. Go to Settings → Price Lists to set tier prices.</p>
          </div>
        )}

        {insufficient && (
          <div style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, border: "1px solid color-mix(in srgb, var(--snm-error) 28%, transparent)" }}>
            <p style={{ color: "var(--snm-error)", fontSize: 12 }}>⚠ Not enough stock — only {stockHere} pcs available.</p>
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

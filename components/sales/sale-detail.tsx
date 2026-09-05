"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Trash2, User, Truck, CheckCircle2, Banknote, Smartphone, Landmark, Printer, AlertTriangle, Plus, RotateCcw, Warehouse, Undo2 } from "lucide-react";
import {
  getOrder,
  listOrderLines,
  updateOrder,
  deleteOrder,
  deleteSalesOrder,
  createOrderLine,
  updateOrderLine,
  removeOrderLine,
  postSale,
  toPieces,
  getTierPricesForSkus,
  listOrderPayments,
  getOrderBalance,
  recordOrderPayment,
  deleteOrderPayment,
  voidOrder,
  editOrderLine,
  getOrderAudit,
  getSalesOrderDeleteImpact,
  recordCodCollection,
  codCollectionArgs,
  parseVoidReason,
  parseVoidReversedCount,
  type SalesOrderDeleteImpact,
  type SalesOrderRow,
  type SalesOrderLineRow,
  type OrderStatus,
  type PaymentStatus,
  type SaleUom,
  type TierPrice,
  type OrderPaymentRow,
  type OrderBalanceRow,
  type PaymentMethod,
  type OrderAuditRow,
} from "@/lib/queries/sales";
import { withOfflineFallback } from "@/lib/offline-write";
import { haptic } from "@/lib/haptics";
import { listSkusFlat, getCurrentUserRole, type SkuFullRow } from "@/lib/queries/products";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { BodyPortal } from "@/components/ui/body-portal";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { formatQtyInTradeUnits, sellableTiers, sellUnitLabel, type TradeUnitConfig, type UnitUom } from "@/lib/trade-units";
import { ImpactLedger, ImpactBlocked, type ImpactRow } from "@/components/ui/impact-ledger";
import { recordCustomerReturn, type ReturnReason, type ReturnSettlement } from "@/lib/queries/inventory";
import { listCustomers, listGodowns, type CustomerRow, type GodownRow } from "@/lib/queries/masters";
import { listStockLevels, type StockLevel } from "@/lib/queries/inventory";
import { supabase } from "@/lib/supabase";
import { SkuIdentity } from "@/components/ui/sku-identity";
import { notifyAdmins } from "@/lib/push";
import { mvtInstant } from "@/lib/mvt-date";
import { mvr, mvrUpTo } from "@/lib/money";

/** Keeps the chosen selling unit on a tier the SKU is actually sold in.
 *  Switching from a diaper (pack + carton) to a carton-only Sosoft must not
 *  leave "Pack" selected — `sellable_units` is the rule on both screens. */
function pickUom(sku: SkuFullRow, current: SaleUom): SaleUom {
  const tiers = sellableTiers(sku.sellable_units);
  if (tiers.includes(current)) return current;
  return tiers.includes("pack") ? "pack" : tiers[0];
}

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

const fmt = mvr;

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
  const [posting, setPosting]         = useState(false);

  // What deleting this order would cost, straight from Postgres (0133).
  // Fetched when the sheet is opened rather than in an effect: the sheet only
  // opens on a tap, so there is nothing to synchronise.
  const [delImpact, setDelImpact] = useState<SalesOrderDeleteImpact | null>(null);
  const [delImpactFailed, setDelImpactFailed] = useState(false);
  const delImpactLoading = delImpact === null && !delImpactFailed;

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

  // payment ledger (partial payments)
  const [payments, setPayments]         = useState<OrderPaymentRow[]>([]);
  // Document history — who voided/edited this order, when and why.
  const [audit, setAudit]               = useState<OrderAuditRow[]>([]);
  const [balance, setBalance]           = useState<OrderBalanceRow | null>(null);
  const [payAmount, setPayAmount]       = useState("");
  const [payMethod, setPayMethod]       = useState<PaymentMethod>("transfer");
  const [payRef, setPayRef]             = useState("");
  const [recordingPay, setRecordingPay] = useState(false);
  const [pendingDeletePayment, setPendingDeletePayment] = useState<OrderPaymentRow | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);

  // inline dialogs (sheet-style bottom panels)
  const [panel, setPanel] = useState<"dispatch" | "deliver" | "deposit" | "delete" | "void" | "deleteLine" | "addLine" | "printLabels" | "recordPayment" | "deletePayment" | "return" | null>(null);
  // Customer return — reverses the sale properly (goods back at the original
  // landed cost, revenue reversed, then refund OR less owed, chosen per return).
  const [retSkuId, setRetSkuId]         = useState("");
  const [retQty, setRetQty]             = useState("");
  const [retUnit, setRetUnit]           = useState<"carton" | "pack" | "piece">("pack");
  const [retReason, setRetReason]       = useState<ReturnReason>("unwanted");
  const [retSettle, setRetSettle]       = useState<ReturnSettlement>("credit");
  const [retRestock, setRetRestock]     = useState(true);
  const [retNotes, setRetNotes]         = useState("");
  const [retSaving, setRetSaving]       = useState(false);
  const [pendingDeleteLine, setPendingDeleteLine] = useState<SalesOrderLineRow | null>(null);
  const [editingLine, setEditingLine]             = useState<SalesOrderLineRow | undefined>(undefined);
  const [deletingLine, setDeletingLine]           = useState(false);
  const [voidReason, setVoidReason]               = useState("");
  const [voiding, setVoiding]                     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, ls, sk, c, g, lvl, dr, pays, bal, aud] = await Promise.all([
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
        listOrderPayments(id),
        getOrderBalance(id),
        getOrderAudit(id),
      ]);
      setOrder(o);
      setLines(ls);
      setSkus(sk);
      setCustomers(c);
      setGodowns(g);
      setStockLevels(lvl);
      setDrivers((dr.data ?? []) as DriverOption[]);
      setPayments(pays);
      setBalance(bal);
      setAudit(aud);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);

  const isAdminOrManager = role === "admin" || role === "manager";
  const canWrite  = role !== "viewer" && role !== null;
  const customer  = customers.find((c) => c.id === order?.customer_id);
  const sourceGodown = godowns.find((g) => g.id === order?.source_godown_id);
  const totals    = useMemo(() => ({
    mvr:   lines.reduce((a, l) => a + Number(l.line_total_mvr), 0),
    count: lines.length,
  }), [lines]);

  // True drafts have no stock posted yet (rare in practice — the create flow
  // auto-posts immediately via postSale(), but a network error mid-flight can
  // leave an order+lines created with post_sale() never having run — SO-2026-076
  // was exactly this, discovered 2026-08-04: it reached "delivered" with zero
  // stock_movements because isConfirmed used to lump 'draft' in with
  // 'confirmed'/'picked', so this screen showed the normal dispatch-ready UI
  // for a draft order and let it be walked all the way to delivered without
  // stock ever being deducted or cost ever being recorded). A draft must NEVER
  // be treated as confirmed — it needs its own explicit "confirm & post" action
  // (below) so staff can complete it safely, or delete it.
  const isTrueDraft  = order?.status === "draft";
  const isConfirmed  = order?.status === "confirmed" || order?.status === "picked";
  const isDispatched = order?.status === "out_for_delivery";
  const isDelivered  = order?.status === "delivered";
  // Stock is deducted when the order is CONFIRMED, so from that point the
  // goods physically exist outside the godown and can come back.
  const stockHasLeft = order != null
    && !["draft", "cancelled"].includes(order.status);
  const isCancelled  = order?.status === "cancelled";
  const isCOD        = order?.payment_method === "cod";
  // Lines can only be safely edited (via editOrderLine, which re-runs FIFO)
  // while the order is confirmed/picked — once dispatched, the driver already
  // has the physical goods, and once delivered, the sale is settled.
  const linesEditable = (order?.status === "confirmed" || order?.status === "picked") && isAdminOrManager;

  /* ── Actions ───────────────────────────────────────────────────────────── */

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

  // Confirms a stuck true draft — deducts FIFO stock and snapshots cost via
  // the same post_sale() RPC the New Sale dialog calls automatically. Needed
  // as an explicit action because that automatic call can fail to complete
  // (e.g. a network error after the order+lines were already created), which
  // used to leave the order stuck as an invisible draft with no safe way to
  // finish it — see the isTrueDraft comment above.
  async function handlePostSale() {
    if (!order) return;
    setPosting(true);
    try {
      await postSale(order.id);
      haptic("success");
      toast.success("Sale confirmed — stock deducted");
      load();
    } catch (e) { haptic("error"); toast.error((e as Error).message); }
    finally { setPosting(false); }
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
      haptic("success");
      toast.success(queued ? "Saved offline — will sync when connected" : "Order dispatched to driver");
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDispatching(false); }
  }

  async function handleDeliver() {
    if (!order) return;
    const cash = parseFloat(cashCollected);
    // COD: the cash figure is the whole point of the confirmation — the
    // field said "required" but silently dropped empty/invalid input,
    // producing phantom full-shortfall days in COD reconciliation.
    if (isCOD) {
      if (isNaN(cash)) { toast.error("Enter the cash amount the driver collected"); return; }
      if (cash < 0)    { toast.error("Cash collected can't be negative"); return; }
    }
    setCompleting(true);
    // With cash, one RPC books it into the payments ledger and marks the order
    // delivered together (migration 0136) — writing cash_collected_mvr alone is
    // what left an order reading "OWES 776" while its own detail screen said
    // the money was banked. Without cash it stays a plain status update.
    const codArgs = isNaN(cash)
      ? null
      : codCollectionArgs(order.id, cash, { markDelivered: true });
    const p = {
      status: "delivered",
      delivered_at: new Date().toISOString(),
    } as Record<string, unknown>;
    try {
      const { queued } = codArgs
        ? await withOfflineFallback(
            () => recordCodCollection(codArgs),
            {
              table: "sales_orders",
              action: "rpc",
              rpcName: "record_cod_collection",
              payload: codArgs as unknown as Record<string, unknown>,
            },
          )
        : await withOfflineFallback(
            () => updateOrder(order.id, p),
            { table: "sales_orders", action: "update", payload: p, match: { id: order.id } },
          );
      haptic("success");
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

  // Open the record-payment sheet, defaulting the amount to the outstanding
  // balance (the common case: customer clears what they owe).
  function openRecordPayment() {
    // Only ever prefill from the server-computed balance. Falling back to the
    // gross order total would ignore payments already made and any returned
    // goods, so one tap could over-collect; leaving it blank is the safe
    // failure, and the server-side overpayment guard is the backstop.
    const outstanding = balance?.balance_mvr;
    setPayAmount(outstanding != null && outstanding > 0 ? outstanding.toFixed(2).replace(/\.00$/, "") : "");
    setPayMethod(isCOD ? "cod" : "transfer");
    setPayRef("");
    setPanel("recordPayment");
  }

  async function handleRecordPayment() {
    if (!order) return;
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt === 0) { toast.error("Enter a payment amount"); return; }
    setRecordingPay(true);
    try {
      await recordOrderPayment({
        orderId: order.id,
        amountMvr: amt,
        method: payMethod,
        reference: payRef.trim() || null,
      });
      haptic("success");
      toast.success(amt < 0 ? "Refund recorded" : "Payment recorded");
      // Money events reach the office like delivery events do.
      notifyAdmins({
        title: amt < 0 ? "Refund recorded" : "Payment received",
        body: `MVR ${mvrUpTo(Math.abs(amt), 3)} ${payMethod} on ${order.order_number}`,
        url: `/sales`,
      }, "money");
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setRecordingPay(false); }
  }

  async function handleDeletePayment() {
    if (!pendingDeletePayment) return;
    setDeletingPayment(true);
    try {
      await deleteOrderPayment(pendingDeletePayment.id);
      toast.success("Payment removed");
      setPendingDeletePayment(null);
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeletingPayment(false); }
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

  // A true draft has never touched stock or money, so its delete stays a
  // plain tap. Anything past draft gets the hold and the ledger below.
  function openDeleteSheet() {
    setDelImpact(null);
    setDelImpactFailed(false);
    setPanel("delete");
    if (order && !isTrueDraft) {
      getSalesOrderDeleteImpact(order.id)
        .then(setDelImpact)
        .catch(() => setDelImpactFailed(true));
    }
  }

  const delImpactRows: ImpactRow[] = delImpact
    ? [
        { label: "Order value", value: `MVR ${fmt(delImpact.total_mvr)}`, money: true },
        ...(delImpact.pieces_restored > 0
          ? [{ label: "Stock returned to inventory", value: delImpact.stock_restored_summary ?? "—" }]
          : []),
        { label: "Product lines", value: `${delImpact.line_count}` },
      ]
    : [];

  async function handleDeleteOrder() {
    if (!order) return;
    setDeleting(true);
    try {
      // True drafts have no posted stock → fast RLS delete. Anything else
      // (active or already-cancelled) goes through the RPC, which reverses any
      // FIFO 'out' movements back to inventory before erasing the order.
      const restoresStock = !isTrueDraft && !isCancelled;
      if (isTrueDraft) await deleteOrder(order.id);
      else await deleteSalesOrder(order.id);
      toast.success(restoresStock ? "Order deleted — stock restored" : "Order deleted");
      notifyAdmins({
        title: "Order deleted",
        body: `${order.order_number} was deleted${restoresStock ? " — stock restored" : ""}`,
        url: "/sales",
      }, "money");
      router.push("/sales");
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeleting(false); }
  }

  async function handleVoidOrder() {
    if (!order) return;
    if (!voidReason.trim()) { toast.error("Enter a reason for voiding this order"); return; }
    setVoiding(true);
    try {
      await voidOrder(order.id, voidReason.trim());
      haptic("success");
      toast.success("Order voided — stock restored");
      notifyAdmins({
        title: "Order voided",
        body: `${order.order_number} voided — ${voidReason.trim()}`,
        url: "/sales",
      }, "money");
      router.push("/sales");
    } catch (e) { toast.error((e as Error).message); }
    finally { setVoiding(false); }
  }

  async function handleDeleteLine() {
    if (!pendingDeleteLine) return;
    setDeletingLine(true);
    try {
      // Lines are only removable while the order is confirmed or picked, and
      // by then post_sale has already deducted the stock — so this goes
      // through the RPC that reverses the movements. A plain table delete
      // here used to leave the goods deducted from inventory but absent from
      // the order (fixed in migration 0134).
      await removeOrderLine(pendingDeleteLine.id);
      toast.success("Item removed — stock returned");
      setPendingDeleteLine(null);
      setPanel(null);
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeletingLine(false); }
  }

  /* ── Render ────────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ background: "var(--background)", minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }
  if (!order) {
    return (
      <div style={{ background: "var(--background)", minHeight: "100dvh", padding: 24 }}>
        <p style={{ color: "var(--muted-foreground)" }}>Order not found.</p>
        <Link href="/sales" style={{ color: "var(--foreground)", fontSize: 14, marginTop: 12, display: "block" }}>← Back to sales</Link>
      </div>
    );
  }

  async function submitReturn() {
    const line = lines.find((l) => l.sku_id === retSkuId);
    const sku  = skus.find((s) => s.id === retSkuId);
    if (!line || !sku) { toast.error("Pick the product being returned"); return; }
    const n = Math.max(0, Math.floor(Number(retQty) || 0));
    if (n <= 0) { toast.error("Enter how many are coming back"); return; }
    const pieces = retUnit === "carton" ? n * sku.pcs_per_pack * sku.packs_per_carton
                 : retUnit === "pack"   ? n * sku.pcs_per_pack
                 : n;
    setRetSaving(true);
    try {
      const res = await recordCustomerReturn({
        order_id: id, sku_id: retSkuId, qty_pieces: pieces,
        reason: retReason, settlement: retSettle, restock: retRestock, notes: retNotes,
      });
      haptic("success");
      toast.success(
        res.settlement === "refund"
          ? `Return recorded — MVR ${mvrUpTo(Number(res.refund_mvr), 3)} to refund.`
          : res.settlement === "replace"
          ? "Return recorded — a replacement has gone out of stock. Nothing changes on the bill."
          : `Return recorded — MVR ${mvrUpTo(Number(res.refund_mvr), 3)} off what they owe.`,
      );
      setPanel(null); setRetSkuId(""); setRetQty(""); setRetNotes("");
      load();
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally { setRetSaving(false); }
  }

  const currentStep = stepIndex(order.status);

  return (
    <div style={{ padding: "0 0 140px 0" }}>

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
        {canWrite && isTrueDraft && (
          <button
            onClick={openDeleteSheet}
            className="snm-pressable"
            style={{ width: 44, height: 44, borderRadius: 12, background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", border: "none", color: "var(--snm-error)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <Trash2 style={{ width: 16, height: 16 }} />
          </button>
        )}
        {isAdminOrManager && !isTrueDraft && !isCancelled && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setVoidReason(""); setPanel("void"); }}
              className="snm-pressable ios-subhead"
              style={{ height: 44, padding: "0 14px", borderRadius: 12, background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)", border: "none", color: "var(--snm-warning)", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              Void
            </button>
            <button
              onClick={openDeleteSheet}
              aria-label="Delete order"
              className="snm-pressable"
              style={{ width: 44, height: 44, borderRadius: 12, background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", border: "none", color: "var(--snm-error)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <Trash2 style={{ width: 16, height: 16 }} />
            </button>
          </div>
        )}
        {isAdminOrManager && isCancelled && (
          <button
            onClick={openDeleteSheet}
            aria-label="Delete order"
            className="snm-pressable"
            style={{ width: 44, height: 44, borderRadius: 12, background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", border: "none", color: "var(--snm-error)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <Trash2 style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>

      {/* ── Progress stepper ─────────────────────────────────────────────── */}
      {!isCancelled && (
        <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: "20px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
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

      {isCancelled && (() => {
        // A voided document stays fully readable — that is the entire point of
        // voiding instead of deleting. Show WHY, WHO, WHEN and what it
        // reversed, not just a red strip. (Ali's screenshot: this screen used
        // to end here, with no items, no money and no reason.)
        const voidEntry  = audit.find((a) => (a.reason ?? "").toLowerCase().includes("voided"))
                        ?? audit[0];
        const why        = parseVoidReason(voidEntry?.reason);
        const reversed   = parseVoidReversedCount(voidEntry?.reason);
        return (
          <div style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", borderRadius: 12, padding: "14px 16px", marginBottom: 12, border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)" }}>
            <p style={{ color: "var(--snm-error)", fontSize: 13, fontWeight: 700 }}>Order cancelled</p>

            {why && (
              <p style={{ color: "var(--foreground)", fontSize: 14, marginTop: 6, lineHeight: 1.45 }}>
                {why}
              </p>
            )}

            {voidEntry && (
              <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 6 }}>
                By {voidEntry.changed_by_name} · {new Date(voidEntry.created_at).toLocaleString("en-MV", {
                  day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
                })}
              </p>
            )}

            <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 8, lineHeight: 1.45 }}>
              {reversed && reversed > 0
                ? `Stock was returned to inventory (${reversed} movement${reversed === 1 ? "" : "s"} reversed).`
                : "No stock had been taken, so nothing needed returning."}
              {" "}This order is not counted in sales or profit.
            </p>

            {!voidEntry && (
              <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 6 }}>
                No reason was recorded for this cancellation.
              </p>
            )}
          </div>
        );
      })()}

      {/* ── Customer card ─────────────────────────────────────────────────── */}
      {customer && (
        <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: "16px 20px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
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
        <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: "16px 20px", marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: editingAddress ? 14 : 0 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase" }}>Delivery Address</p>
            {!editingAddress && (
              <button
                onClick={startEditAddress}
                style={{ fontSize: 11, fontWeight: 600, color: "var(--snm-brand-text)", background: "transparent", border: "none", cursor: "pointer", padding: "2px 0" }}
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

      {/* ── STAGE: Cancelled — the voided document, still readable ────────
          Every other stage below renders the items and the money inside its
          own block, so a cancelled order fell through all of them and showed
          nothing at all. A voided order is kept precisely so it can still be
          read: what was ordered, for how much, and what was paid. Read-only —
          no edit, no dispatch, no payment actions. */}
      {isCancelled && (
        <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 12 }}>
            What was ordered
          </p>

          <LineList lines={lines} skus={skus} editable={false} />

          {totals.count > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 12, marginTop: 8, borderTop: "0.5px solid var(--glass-border-lo)" }}>
              <span style={{ color: "var(--muted-foreground)", fontSize: 14 }}>Order Total</span>
              <span className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 18, fontWeight: 700, textDecoration: "line-through" }}>
                MVR {fmt(totals.mvr)}
              </span>
            </div>
          )}

          {/* Money actually received against a cancelled order is a refund
              waiting to happen — surface it rather than hiding it. */}
          {payments.length > 0 && (
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" }}>
              <p style={{ color: "var(--snm-warning)", fontSize: 13, fontWeight: 700 }}>
                MVR {fmt(payments.reduce((a, p) => a + Number(p.amount_mvr), 0))} was paid on this order
              </p>
              <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
                The order was cancelled after payment — check whether this is owed back to the customer.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── STAGE: True draft — stock not yet deducted, needs confirming ──── */}
      {isTrueDraft && (
        <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <AlertTriangle style={{ color: "var(--snm-warning)", width: 20, height: 20 }} />
            <p style={{ color: "var(--snm-warning)", fontSize: 15, fontWeight: 700 }}>Not confirmed yet</p>
          </div>
          <p style={{ color: "var(--muted-foreground)", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
            This order was created but never confirmed — no stock has been deducted and it isn&apos;t counted as a real sale yet. Confirm it to deduct stock and record the sale, or delete it if it was a mistake.
          </p>
          <button
            onClick={handlePostSale}
            disabled={posting}
            className="snm-pressable"
            style={{ width: "100%", height: 48, borderRadius: 12, background: "var(--foreground)", color: "var(--background)", border: "none", fontSize: 14, fontWeight: 700, opacity: posting ? 0.6 : 1, cursor: "pointer" }}
          >
            {posting ? "Confirming…" : "Confirm Sale"}
          </button>
        </div>
      )}

      {/* ── STAGE: Confirmed — ready to dispatch ─────────────────────────── */}
      {isConfirmed && (
        <>
          {/* Pickup godown — shown before payment method since this is the
              "go get these items" stage, before the order ever leaves. */}
          {sourceGodown && (
            <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
              {/* Static information sits on a neutral surface — blue is reserved
                  for interactive elements (HIG: colour communicates affordance). */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "var(--muted)", borderRadius: 12, border: "0.5px solid var(--glass-border-lo)" }}>
                <Warehouse style={{ color: "var(--muted-foreground)", width: 22, height: 22, flexShrink: 0 }} />
                <div>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Pick up from</p>
                  <p style={{ color: "var(--foreground)", fontSize: 18, fontWeight: 700 }}>
                    {sourceGodown.name}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Payment method badge */}
          <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
            {/* COD keeps amber (cash must be collected — true status); bank
                transfer is plain information and sits on a neutral surface. */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "14px 16px", background: isCOD ? "color-mix(in srgb, var(--snm-warning) 10%, transparent)" : "var(--muted)", borderRadius: 12, border: isCOD ? "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" : "0.5px solid var(--glass-border-lo)" }}>
              {isCOD
                ? <Banknote style={{ color: "var(--snm-warning)", width: 22, height: 22, flexShrink: 0 }} />
                : <Smartphone style={{ color: "var(--muted-foreground)", width: 22, height: 22, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ color: isCOD ? "var(--snm-warning)" : "var(--muted-foreground)", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
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

            <LineList
              lines={lines}
              skus={skus}
              editable={linesEditable}
              godowns={godowns}
              orderGodownId={order.source_godown_id}
              onEdit={(l) => { setEditingLine(l); setPanel("addLine"); }}
            />
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

      {/* ── Money in ──────────────────────────────────────────────────────
          Shown from CONFIRMED onward, not only once delivered. Ali,
          2026-08-28: *"when a customer places an order and delivery is for
          example after 2 days I cannot enter paid. I have to follow
          confirmed-dispatched-delivered. Then only I can enter as paid."*

          PAYMENT AND DELIVERY ARE TWO DIFFERENT CLOCKS. A customer can pay on
          order, on delivery, or weeks after it; the goods move on their own
          schedule. Chaining one to the other left him marking an order
          delivered before he could record money already sitting in his
          account — a false delivery date, entered to get past a screen. Every
          report that reads delivered_at is then wrong, and the reason is
          invisible.

          THE ENGINE NEVER REQUIRED IT. record_order_payment refuses exactly
          two things: a draft (nothing confirmed to pay for) and a cancelled
          order (nothing owed). Everything else it accepts. The screen and the
          engine simply disagreed — the identical mistake, in this same file,
          that stranded him on SO-2026-117 with a return he could not record.

          COD is the one case that really is delivery-dependent, and it keeps
          its own flow inside the Delivered card above. */}
      {!isCOD && stockHasLeft && (
        <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
          <PaymentLedger
            balance={balance}
            payments={payments}
            orderTotal={totals.mvr}
            paymentStatus={order.payment_status}
            canWrite={canWrite}
            onRecord={openRecordPayment}
            onDeletePayment={(p) => { setPendingDeletePayment(p); setPanel("deletePayment"); }}
          />
        </div>
      )}

      {/* ── STAGE: Out for delivery ──────────────────────────────────────── */}
      {isDispatched && (
        <>
          <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
            {/* Pickup godown — big and first, since this is what the dispatch
                guy needs before he can pick anything up. */}
            {sourceGodown && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: "14px 16px", background: "var(--muted)", borderRadius: 12, border: "0.5px solid var(--glass-border-lo)" }}>
                <Warehouse style={{ color: "var(--muted-foreground)", width: 22, height: 22, flexShrink: 0 }} />
                <div>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Pick up from</p>
                  <p style={{ color: "var(--foreground)", fontSize: 18, fontWeight: 700 }}>
                    {sourceGodown.name}
                  </p>
                </div>
              </div>
            )}

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
              <span className="snm-num" style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 700 }}>MVR {fmt(totals.mvr)}</span>
            </div>
          </div>
          {canWrite && (
            <button
              onClick={() => {
                // Prefill what is actually still owed, to the cent — the old
                // `totals.mvr.toFixed(0)` used the gross total (ignoring any
                // payment already taken) and rounded MVR 776.50 down to 776.
                const due = balance?.balance_mvr;
                setCashCollected(isCOD && due != null && due > 0 ? String(due) : "");
                setPanel("deliver");
              }}
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

      {/* ── Goods coming back ────────────────────────────────────────────
          Shown from CONFIRMED onward, not only once delivered. Stock leaves the
          godown at confirmation (post_sale), so from that moment the goods are
          out and a return is the only correct way to bring them back or write
          them off. Gating this on `delivered` was an oversight and it stranded
          Ali on SO-2026-117: the pack was physically back in his hand and the
          app offered him nowhere to put it. record_customer_return has always
          accepted any order that is not draft or cancelled, so the engine and
          the screen simply disagreed.

          Voiding is NOT the alternative — that erases the whole sale, the money
          and the history with it. A return records what actually happened: it
          went out, it came back, and this is what it cost. */}
      {isAdminOrManager && lines.length > 0 && stockHasLeft && (
        <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
          <p style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Something come back?</p>
          <p style={{ color: "var(--foreground)", opacity: 0.75, fontSize: 13, marginBottom: 14 }}>
            Record what returned, whether it can be sold again, and how the customer is squared up —
            money back, less to pay, or another one sent.
          </p>
          <button
            onClick={() => {
              setRetSkuId(lines[0].sku_id); setRetQty("");
              // Same rule on the way IN as on change: the sheet opens on the
              // first line, so its unit has to match that line too.
              const firstSku = skus.find((x) => x.id === lines[0].sku_id);
              setRetUnit(lines[0].is_mixed_carton_fill ? "piece"
                : firstSku ? pickUom(firstSku, retUnit) : retUnit);
              setPanel("return");
            }}
            style={{ width: "100%", background: "transparent", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 999, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            <Undo2 style={{ width: 16, height: 16 }} />
            Record a return
          </button>
        </div>
      )}

      {/* ── STAGE: Delivered ─────────────────────────────────────────────── */}
      {isDelivered && (
        <div style={{ background: "var(--glass-1)", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <CheckCircle2 style={{ color: "var(--snm-success)", width: 22, height: 22 }} />
            <p style={{ color: "var(--snm-success)", fontSize: 16, fontWeight: 700 }}>Delivered</p>
          </div>

          {/* Financial summary */}
          <div className="grid grid-cols-2 gap-3 mb-5">
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

          {/* Payment action — COD only.
              The payment ledger used to live in this `else` branch, which is
              what made recording money depend on marking the order delivered.
              It is now its own section above, shown from CONFIRMED onward.
              Depositing collected cash genuinely IS delivery-dependent — a
              driver cannot bank money he has not collected — so that stays. */}
          {isCOD && (
            order.payment_status !== "deposited" ? (
              order.cash_collected_mvr == null ? (
                // No amount on record — can't deposit money nobody logged.
                // (SO-2026-072 got here with no cash figure at all, and the
                // dashboard/Finance Owed panel then had no way to know it was
                // ever settled. The delivery flows now require the amount
                // up front; this is the fallback for anything that still
                // slips through.)
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", borderRadius: 12, marginBottom: 16, border: "1px solid color-mix(in srgb, var(--snm-warning) 18%, transparent)" }}>
                  <Landmark style={{ color: "var(--snm-warning)", width: 18, height: 18 }} />
                  <p style={{ color: "var(--snm-warning)", fontSize: 13, fontWeight: 600 }}>No cash amount on record yet — record what was collected before depositing.</p>
                </div>
              ) : (
              <button
                onClick={() => setPanel("deposit")}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 999, padding: "16px", fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", marginBottom: 16 }}
              >
                <Landmark style={{ width: 18, height: 18 }} />
                Mark Cash Deposited to Bank
              </button>
              )
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", background: "color-mix(in srgb, var(--snm-success) 10%, transparent)", borderRadius: 12, marginBottom: 16, border: "1px solid color-mix(in srgb, var(--snm-success) 18%, transparent)" }}>
                <CheckCircle2 style={{ color: "var(--snm-success)", width: 18, height: 18 }} />
                <p style={{ color: "var(--snm-success)", fontSize: 13, fontWeight: 600 }}>Cash deposited to bank</p>
                {order.cash_deposited_at && (
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginLeft: "auto" }}>
                    {mvtInstant(order.cash_deposited_at, { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                )}
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
              onFocus={(e) => e.target.select()}
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

      {/* Record payment */}
      <Sheet open={panel === "recordPayment"} onClose={() => setPanel(null)}>
        <h2 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Record a Payment</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 20 }}>
          {balance && balance.balance_mvr > 0.005
            ? <>Outstanding on {order.order_number}: <strong style={{ color: "var(--foreground)" }}>MVR {fmt(balance.balance_mvr)}</strong></>
            : <>This order is fully paid. Any amount you add here counts as a credit.</>}
        </p>

        <div style={{ marginBottom: 16 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 8 }}>Amount received (MVR) *</p>
          <input
            type="number" inputMode="decimal" step="0.01"
            placeholder="0"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            onFocus={(e) => e.target.select()}
            style={{ width: "100%", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 10, padding: "12px", fontSize: 22, fontWeight: 600, outline: "none", boxSizing: "border-box" }}
          />
          {balance && balance.balance_mvr > 0.005 && (
            <button
              type="button"
              onClick={() => setPayAmount(balance.balance_mvr.toFixed(2).replace(/\.00$/, ""))}
              style={{ marginTop: 8, background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "var(--snm-brand-text)", fontWeight: 600, cursor: "pointer" }}
            >
              Pay full balance — MVR {fmt(balance.balance_mvr)}
            </button>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 8 }}>How was it paid?</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { value: "transfer" as PaymentMethod, label: "Transfer" },
              { value: "cash" as PaymentMethod, label: "Cash" },
              { value: "card" as PaymentMethod, label: "Card" },
            ]).map((opt) => {
              const active = payMethod === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setPayMethod(opt.value)}
                  style={{
                    background: active ? "var(--foreground)" : "var(--glass-bg-1)",
                    color: active ? "var(--background)" : "var(--muted-foreground)",
                    border: active ? "none" : "0.5px solid var(--glass-border-lo)",
                    borderRadius: 10, padding: "12px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 8 }}>Reference / note (optional)</p>
          <input
            value={payRef}
            onChange={(e) => setPayRef(e.target.value)}
            placeholder="e.g. transfer slip no., or 'first instalment'"
            style={{ width: "100%", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 10, padding: "12px", fontSize: 14, outline: "none", boxSizing: "border-box" }}
          />
        </div>

        <SheetActions>
          <button onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          <button onClick={handleRecordPayment} disabled={recordingPay} style={{ ...primaryBtn, opacity: recordingPay ? 0.5 : 1 }}>
            {recordingPay ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Record Payment"}
          </button>
        </SheetActions>
      </Sheet>

      {/* Delete payment */}
      <Sheet open={panel === "deletePayment"} onClose={() => { setPendingDeletePayment(null); setPanel(null); }}>
        <h2 style={{ color: "var(--snm-error)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Remove this payment?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>
          {pendingDeletePayment && (
            <>A payment of <strong style={{ color: "var(--foreground)" }}>MVR {fmt(Math.abs(pendingDeletePayment.amount_mvr))}</strong> will be removed from this order. The balance and paid status update automatically.</>
          )}
        </p>
        <SheetActions>
          <button onClick={() => { setPendingDeletePayment(null); setPanel(null); }} style={primaryBtn}>Keep it</button>
          <button onClick={handleDeletePayment} disabled={deletingPayment} style={dangerQuietBtn}>
            {deletingPayment ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Remove"}
          </button>
        </SheetActions>
      </Sheet>

      {/* Delete order.
          A true draft never posted stock and never took money, so deleting it
          costs nothing and stays a single tap. Everything else destroys a real
          record, so it shows what it is worth and asks for a press-and-hold. */}
      <Sheet open={panel === "delete"} onClose={() => setPanel(null)}>
        <h2 style={{ color: "var(--snm-error)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
          Delete {order.order_number}?
        </h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 16 }}>
          {isTrueDraft
            ? "This draft was never confirmed, so no stock or money is affected."
            : <>This erases the order from your records{!isCancelled ? ", and puts its stock back on the shelf" : ""}. It cannot be undone.</>}
        </p>

        {!isTrueDraft && (
          <div style={{ marginBottom: 16 }}>
            <ImpactLedger rows={delImpactRows} loading={delImpactLoading} />
          </div>
        )}

        {delImpact?.blocked_reason ? (
          <>
            <ImpactBlocked reason={delImpact.blocked_reason} />
            <button
              onClick={() => setPanel(null)}
              style={{ ...primaryBtn, width: "100%", marginTop: 12 }}
            >
              Back
            </button>
          </>
        ) : isTrueDraft ? (
          <SheetActions>
            <button onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
            <button onClick={handleDeleteOrder} disabled={deleting} style={{ ...primaryBtn, background: "var(--snm-error)" }}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Delete draft"}
            </button>
          </SheetActions>
        ) : (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <button onClick={() => setPanel(null)} style={{ ...primaryBtn, flex: 2 }}>Keep order</button>
            <HoldToConfirm
              className="flex-1"
              label="Hold to delete"
              busyLabel="Deleting…"
              busy={deleting}
              disabled={delImpactLoading}
              onConfirm={handleDeleteOrder}
            />
          </div>
        )}
      </Sheet>

      {/* Void order (confirmed/picked/dispatched/delivered — reverses stock) */}
      <Sheet open={panel === "void"} onClose={() => setPanel(null)}>
        <h2 style={{ color: "var(--snm-error)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Void Order?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 16 }}>
          <strong style={{ color: "var(--foreground)" }}>{order.order_number}</strong> will be cancelled and its stock restored to inventory. The order stays on record for audit history — it&apos;s marked cancelled, not erased.
        </p>
        <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Reason *</p>
        <textarea
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          placeholder="e.g. Customer cancelled, wrong order entered…"
          rows={3}
          style={{ width: "100%", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 20, resize: "none" }}
        />
        <SheetActions>
          <button onClick={() => setPanel(null)} style={primaryBtn}>Keep order</button>
          <button onClick={handleVoidOrder} disabled={voiding || !voidReason.trim()} style={{ ...dangerQuietBtn, opacity: voiding || !voidReason.trim() ? 0.4 : 1 }}>
            {voiding ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : "Void order"}
          </button>
        </SheetActions>
      </Sheet>

      {/* Delete line */}
      <Sheet open={panel === "deleteLine"} onClose={() => { setPendingDeleteLine(null); setPanel(null); }}>
        <h2 style={{ color: "var(--snm-error)", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Remove item?</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginBottom: 24 }}>
          <strong style={{ color: "var(--foreground)" }}>
            {pendingDeleteLine && (() => {
              const sku = skus.find((s) => s.id === pendingDeleteLine.sku_id);
              return sku ? `${sku.brand_name} ${sku.model_name} ${sku.variant_display}` : "This item";
            })()}
          </strong>{" "}
          comes off {order.order_number}
          {/* Was "{qty_pieces} pcs" — a raw piece count in the one place a
              mistake is irreversible. Quoted in the unit actually traded
              (Ali, 2026-08-06). */}
          {pendingDeleteLine?.qty_pieces
            ? (() => {
                const sku = skus.find((s) => s.id === pendingDeleteLine.sku_id);
                const cfg: TradeUnitConfig = {
                  pcsPerPack: sku?.pcs_per_pack ?? 1,
                  packsPerCarton: sku?.packs_per_carton ?? 1,
                  unitUom: sku?.unit_uom,
                  sellableUnits: sku?.sellable_units,
                };
                return <>, and its <strong style={{ color: "var(--foreground)" }}>{formatQtyInTradeUnits(pendingDeleteLine.qty_pieces, cfg)}</strong> go back into stock</>;
              })()
            : null}.
        </p>
        <SheetActions>
          <button onClick={() => { setPendingDeleteLine(null); setPanel(null); }} style={primaryBtn}>Keep it</button>
          <button onClick={handleDeleteLine} disabled={deletingLine} style={dangerQuietBtn}>
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

      {/* Record a return */}
      <Sheet open={panel === "return"} onClose={() => setPanel(null)}>
        <h2 style={{ color: "var(--foreground)", fontSize: 20, fontWeight: 600, marginBottom: 6 }}>Record a return</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: 13, marginBottom: 18 }}>
          Puts the goods back in stock at their original cost and reverses the sale in your P&amp;L.
        </p>

        {(() => {
          const sku = skus.find((s) => s.id === retSkuId);
          // Goods come back in the unit they went out in. The tier list used to
          // be hardcoded ctn/pk/pcs, so a carton-only Sosoft offered a "pk" and
          // every diaper offered "pcs".
          const retCfg: TradeUnitConfig = {
            pcsPerPack: sku?.pcs_per_pack ?? 1, packsPerCarton: sku?.packs_per_carton ?? 1,
            unitUom: sku?.unit_uom, sellableUnits: sku?.sellable_units,
          };
          // A RETURN mirrors what was actually transacted on that line, which is
          // not always what the product is SOLD in. Ali's rule "Sosoft only by
          // the carton" governs selling: a customer cannot buy three bottles.
          // A damaged bottle coming back out of a carton already sold is a
          // different event — the same carve-out CLAUDE.md already makes for
          // Stock Ops, where "a torn pack is real".
          //
          // Without this a mixed-carton line could not be returned AT ALL:
          // the line holds 4 bottles, the only unit offered was the carton,
          // and 6 > 4 so every attempt was refused.
          //
          // Nothing downstream needed changing — record_customer_return already
          // works in pieces, and returns write to sales_returns and
          // stock_movements, never to sales_order_lines, so the whole-carton
          // guard (0163) is not involved.
          const retLine = lines.find((l) => l.sku_id === retSkuId);
          const retTiers = retLine?.is_mixed_carton_fill
            ? (["piece"] as SaleUom[])
            : sellableTiers(sku?.sellable_units);
          const retWord = (u: SaleUom) => sellUnitLabel(u, retCfg);
          const pcsPerPack = sku?.pcs_per_pack ?? 1;
          const pcsPerCtn  = (sku?.pcs_per_pack ?? 1) * (sku?.packs_per_carton ?? 1);
          const n = Math.max(0, Math.floor(Number(retQty) || 0));
          const pieces = retUnit === "carton" ? n * pcsPerCtn : retUnit === "pack" ? n * pcsPerPack : n;
          const line = lines.find((l) => l.sku_id === retSkuId);
          const pricePc = line && line.qty_pieces > 0 ? Number(line.line_total_mvr) / line.qty_pieces : 0;
          const value = pieces * pricePc;
          // What has actually been taken from this customer. Refund is only a
          // real option above this line — see the settlement row below.
          const paidSoFar = payments.reduce((a, p) => a + Number(p.amount_mvr), 0);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Which product?</label>
                <select value={retSkuId} onChange={(e) => {
                    setRetSkuId(e.target.value); setRetQty("");
                    const next = skus.find((x) => x.id === e.target.value);
                    // A mixed-carton line comes back in bottles, whatever the
                    // product is sold in — otherwise the unit pill and the
                    // offered tier disagree and the sheet cannot be submitted.
                    const nextLine = lines.find((l) => l.sku_id === e.target.value);
                    if (nextLine?.is_mixed_carton_fill) setRetUnit("piece");
                    else if (next) setRetUnit(pickUom(next, retUnit));
                  }}
                  style={{ width: "100%", height: 46, borderRadius: 12, padding: "0 12px", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", fontSize: 14 }}>
                  {lines.map((l) => {
                    const s2 = skus.find((x) => x.id === l.sku_id);
                    return <option key={l.id} value={l.sku_id}>{s2 ? `${s2.model_name} · ${s2.variant_display}` : l.sku_id}</option>;
                  })}
                </select>
              </div>

              <div>
                <label style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>How many are coming back?</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" inputMode="numeric" value={retQty} onChange={(e) => setRetQty(e.target.value)}
                    placeholder={`How many ${retWord(retUnit)}s?`}
                    style={{ flex: 1, minWidth: 0, height: 46, borderRadius: 12, padding: "0 12px", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", fontSize: 15, fontWeight: 600 }} />
                  <div style={{ display: "flex", gap: 3, background: "var(--glass-bg-1)", borderRadius: 12, padding: 3 }}>
                    {retTiers.map((u) => (
                      <button key={u} onClick={() => setRetUnit(u)}
                        style={{ padding: "0 10px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                          background: retUnit === u ? "var(--foreground)" : "transparent",
                          color: retUnit === u ? "var(--background)" : "var(--muted-foreground)" }}>
                        {retWord(u)}
                      </button>
                    ))}
                  </div>
                </div>
                {value > 0 && (
                  <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 6 }}>
                    Worth MVR {fmt(value)} at the price they paid
                  </p>
                )}
              </div>

              <div>
                <label style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Why?</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {([["unwanted","Not wanted"],["wrong_item","Wrong item"],["defective","Faulty"],["other","Other"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => { setRetReason(v); if (v === "defective") setRetRestock(false); }}
                      style={{ padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 600,
                        background: retReason === v ? "var(--foreground)" : "var(--glass-bg-1)",
                        color: retReason === v ? "var(--background)" : "var(--muted-foreground)",
                        border: retReason === v ? "none" : "0.5px solid var(--glass-border-lo)" }}>{l}</button>
                  ))}
                </div>
              </div>

              {/* Three settlements, and they are genuinely different events —
                  not one idea with three labels. "Money back" is only offered
                  when money was actually taken: refunding someone who never
                  paid writes a negative payment against an unsettled bill and
                  leaves them owing the same amount with a phantom refund beside
                  it. The engine refuses it too (0182); this stops him getting
                  as far as the error. */}
              <div>
                <label style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Settle it how?</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {([["credit","Less to pay"],["refund","Money back"],["replace","Send another"]] as const).map(([v, l]) => {
                    const off = v === "refund" && paidSoFar <= 0;
                    return (
                      <button key={v} disabled={off}
                        onClick={() => setRetSettle(v)}
                        style={{ flex: 1, padding: "12px", borderRadius: 12, cursor: off ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600,
                          opacity: off ? 0.4 : 1,
                          background: retSettle === v ? "var(--foreground)" : "var(--glass-bg-1)",
                          color: retSettle === v ? "var(--background)" : "var(--muted-foreground)",
                          border: retSettle === v ? "none" : "0.5px solid var(--glass-border-lo)" }}>{l}</button>
                    );
                  })}
                </div>
                <p style={{ color: "var(--foreground)", opacity: 0.75, fontSize: 12, marginTop: 6 }}>
                  {retSettle === "credit"
                    ? "Comes off what they still owe on this order. No money changes hands."
                    : retSettle === "refund"
                    ? "You hand the money back — recorded as a refund."
                    : "They keep the order and you send the same product again. Nothing changes on the bill, and one more comes out of stock."}
                </p>
                {paidSoFar <= 0 && (
                  <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 4 }}>
                    Nothing has been paid on this order, so there is no money to hand back.
                  </p>
                )}
              </div>

              <button onClick={() => setRetRestock((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  background: retRestock ? "var(--snm-success)" : "transparent", border: retRestock ? "none" : "1.5px solid var(--glass-border-lo)" }}>
                  {retRestock && <CheckCircle2 style={{ width: 14, height: 14, color: "#fff" }} />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 600, display: "block" }}>Good to sell again</span>
                  <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
                    {retRestock ? "Goes back into stock" : "Stays out of stock — full cost is a loss"}
                  </span>
                </span>
              </button>

              <input value={retNotes} onChange={(e) => setRetNotes(e.target.value)} placeholder="Note (optional)"
                style={{ width: "100%", height: 44, borderRadius: 12, padding: "0 12px", background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)", fontSize: 14 }} />

              <button onClick={submitReturn} disabled={retSaving || !retSkuId || !(Number(retQty) > 0)}
                style={{ width: "100%", background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 999, padding: "16px", fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", opacity: retSaving || !retSkuId || !(Number(retQty) > 0) ? 0.5 : 1 }}>
                {retSaving ? "Saving…" : "Record return"}
              </button>
            </div>
          );
        })()}
      </Sheet>

      {/* Add / edit line */}
      {panel === "addLine" && (
        <LineDialog
          editing={editingLine}
          orderId={id}
          orderIsDraft={isTrueDraft}
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
// Destructive actions get the QUIET half of the row: outlined, red text,
// narrow — while the safe action takes primaryBtn's weight. This deliberately
// inverts the app's usual "the main action is the wide one" rule. When the
// main action destroys something, emphasis is a hazard: the thumb's resting
// choice should be the one that keeps your data.
const dangerQuietBtn: React.CSSProperties = {
  flex: 1, background: "transparent", color: "var(--snm-error)",
  border: "1px solid color-mix(in srgb, var(--snm-error) 38%, transparent)",
  borderRadius: 999, padding: "14px", fontSize: 14, fontWeight: 600, cursor: "pointer",
};

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useBodyScrollLock(open);
  if (!open) return null;
  return (
    <BodyPortal>
    <div style={{ position: "fixed", inset: 0, background: "var(--scrim-bg)", zIndex: 60, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--glass-2)", backdropFilter: "var(--glass-blur-lg)", WebkitBackdropFilter: "var(--glass-blur-lg)",
          borderRadius: "20px 20px 0 0", width: "100%",
          // Bottom padding must clear the floating tab bar's own footprint
          // (64px tall + its 14px/safe-area offset from the screen edge),
          // not just the safe-area inset — otherwise the sheet's last row
          // sits right where the tab bar renders and reads as "cut off"
          // (Ali, screenshot: Print Labels' last product hidden behind nav).
          padding: "28px 24px max(92px, calc(78px + env(safe-area-inset-bottom, 0px)), var(--kb-inset))",
          boxShadow: "var(--glass-shadow-lg), var(--glass-inner)", maxHeight: "85dvh", overflowY: "auto",
        }}
      >
        <div style={{ width: 40, height: 4, background: "var(--glass-border)", borderRadius: 999, margin: "0 auto 24px" }} />
        {children}
      </div>
    </div>
    </BodyPortal>
  );
}

function SheetActions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 12 }}>{children}</div>;
}

function LineList({
  lines, skus, editable, onEdit, onDelete, godowns, orderGodownId, style: extraStyle,
}: {
  lines: SalesOrderLineRow[];
  skus: SkuFullRow[];
  editable: boolean;
  onEdit?: (l: SalesOrderLineRow) => void;
  onDelete?: (l: SalesOrderLineRow) => void;
  /** Needed only to name a line's own godown when it differs from the order's. */
  godowns?: GodownRow[];
  orderGodownId?: string | null;
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
                {sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : l.sku_id}
              </p>
              <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 13 }}>
                {l.qty} {l.uom} · MVR {mvrUpTo(Number(l.unit_price_mvr), 3)}
              </p>
              {/* Silent for an ordinary line. Shown only when this one is
                  picked somewhere else, because that is the difference between
                  a driver loading the right van and the wrong one. */}
              {l.source_godown_id && l.source_godown_id !== orderGodownId && (
                <p style={{ color: "var(--snm-warning)", fontSize: 12, fontWeight: 700 }}>
                  Pick from {godowns?.find((g) => g.id === l.source_godown_id)?.name ?? "another godown"}
                </p>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
              <span className="snm-num" style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 600, marginRight: 4 }}>
                MVR {mvr(Number(l.line_total_mvr))}
              </span>
              {editable && (onEdit || onDelete) && (
                <div style={{ display: "flex" }}>
                  {onEdit && (
                    <button onClick={() => onEdit(l)} style={{ minWidth: 44, minHeight: 44, background: "none", border: "none", color: "var(--muted-foreground)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Edit
                    </button>
                  )}
                  {onDelete && (
                    <button onClick={() => onDelete(l)} style={{ minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--snm-error)", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
                      ✕
                    </button>
                  )}
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
/*  Payment ledger (partial payments)                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

const PAY_METHOD_LABEL: Record<string, string> = {
  cash: "Cash", transfer: "Transfer", cod: "COD", card: "Card", other: "Other",
};

function PaymentLedger({
  balance, payments, orderTotal, paymentStatus, canWrite, onRecord, onDeletePayment,
}: {
  balance: OrderBalanceRow | null;
  payments: OrderPaymentRow[];
  orderTotal: number;
  paymentStatus: PaymentStatus;
  canWrite: boolean;
  onRecord: () => void;
  onDeletePayment: (p: OrderPaymentRow) => void;
}) {
  const paid     = balance?.paid_mvr ?? 0;
  const returned = balance?.returned_mvr ?? 0;
  const bal      = balance?.balance_mvr ?? orderTotal;
  const credit   = bal < -0.005 ? -bal : 0;
  // Overpaid is its OWN state, and it has to be tested first. `bal <= 0.005`
  // is true for a negative balance too, so a customer owed MVR 2,800 used to
  // read "Paid in full" in green with a green "MVR 2,800 credit" beside it —
  // the app calling a debt a win. Green means good money (Seat 1); money that
  // has to go back out is attention, so it is orange, like cash to collect.
  const isCredit  = credit > 0 || paymentStatus === "credit";
  // SETTLED IS NOT PAID, and this is the line Ali photographed. SO-2026-117
  // was rejected at the door and never paid a rufiyaa, and the panel put a
  // green "Paid in full" directly above "Paid MVR 0 of MVR 207". Both states
  // leave nothing to collect; only one of them involved his money.
  //
  // Green is reserved for money earned, so this is deliberately NOT green —
  // a sale that came back is neither a win nor an alarm, it is information.
  const isSettled = !isCredit && paymentStatus === "settled";
  const isPaid    = !isCredit && !isSettled && (paymentStatus === "paid" || bal <= 0.005);
  const isPartial = !isPaid && !isCredit && !isSettled && paid > 0.005;

  const accent = isCredit ? "var(--snm-warning)"
               : isSettled ? "var(--muted-foreground)"
               : isPaid ? "var(--snm-success)"
               : isPartial ? "var(--snm-warning)"
               : "var(--muted-foreground)";
  const statusLabel = isCredit ? "Overpaid — money owed back"
                    : isSettled ? "Returned — nothing to pay"
                    : isPaid ? "Paid in full"
                    : isPartial ? "Partly paid"
                    : "Awaiting payment";

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Status + progress */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isCredit || isSettled
            ? <Undo2 style={{ color: accent, width: 18, height: 18 }} />
            : isPaid
            ? <CheckCircle2 style={{ color: accent, width: 18, height: 18 }} />
            : <Smartphone style={{ color: accent, width: 18, height: 18 }} />}
          <p style={{ color: accent, fontSize: 13, fontWeight: 700 }}>{statusLabel}</p>
        </div>
        {credit > 0 && (
          <p className="snm-num" style={{ color: accent, fontSize: 12, fontWeight: 700 }}>MVR {fmt(credit)} to refund</p>
        )}
      </div>

      {/* Paid / outstanding bar */}
      <div style={{ height: 8, borderRadius: 999, background: "var(--glass-bg-1)", overflow: "hidden", marginBottom: 10 }}>
        {/* The bar tracks what has been SETTLED, not only what was paid. A
            fully returned order used to show an empty bar under a green tick,
            because the money never arrived and the bar only knew about money. */}
        <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, orderTotal > 0 ? ((paid + returned) / orderTotal) * 100 : (isPaid || isSettled ? 100 : 0)))}%`, background: accent, transition: "width 0.3s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        {/* "Paid MVR 0 of MVR 207" under a headline saying the order is closed
            is the contradiction Ali photographed. When goods are what closed
            it, the line says so. */}
        <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
          {returned > 0.005 && paid <= 0.005 ? (
            <><strong style={{ color: "var(--foreground)" }}>MVR {fmt(returned)}</strong> returned of MVR {fmt(orderTotal)}</>
          ) : returned > 0.005 ? (
            <>Paid <strong style={{ color: "var(--foreground)" }}>MVR {fmt(paid)}</strong>, returned <strong style={{ color: "var(--foreground)" }}>MVR {fmt(returned)}</strong> of MVR {fmt(orderTotal)}</>
          ) : (
            <>Paid <strong style={{ color: "var(--foreground)" }}>MVR {fmt(paid)}</strong> of MVR {fmt(orderTotal)}</>
          )}
        </span>
        {/* An overpaid order has a NEGATIVE balance — "MVR -2,800 left" is not
            a sentence. It is stated as the refund above instead. Neither is
            "MVR 0 left" on an order that was returned; the headline said it. */}
        {!isPaid && !isCredit && !isSettled && (
          <span style={{ color: accent, fontSize: 12, fontWeight: 700 }}>MVR {fmt(bal)} left</span>
        )}
      </div>

      {/* Payment rows */}
      {payments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {payments.map((p) => {
            const refund = p.amount_mvr < 0;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--glass-bg-1)", borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="snm-num" style={{ color: refund ? "var(--snm-error)" : "var(--foreground)", fontSize: 13, fontWeight: 600 }}>
                    {refund ? "− " : ""}MVR {fmt(Math.abs(p.amount_mvr))}
                    <span style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
                      {refund ? "refund · " : ""}{PAY_METHOD_LABEL[p.method] ?? p.method}
                    </span>
                  </p>
                  <p style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 1 }}>
                    {mvtInstant(p.paid_at, { day: "numeric", month: "short", year: "numeric" })}{p.reference ? ` · ${p.reference}` : ""}
                  </p>
                </div>
                {canWrite && (
                  <button
                    onClick={() => onDeletePayment(p)}
                    aria-label="Remove payment"
                    style={{ background: "none", border: "none", color: "var(--muted-foreground)", cursor: "pointer", padding: "4px 6px", flexShrink: 0 }}
                  >
                    <Trash2 style={{ width: 14, height: 14 }} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      {canWrite && (
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onRecord}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: isPaid ? "transparent" : "var(--foreground)", color: isPaid ? "var(--muted-foreground)" : "var(--background)", border: isPaid ? "0.5px solid var(--glass-border-lo)" : "none", borderRadius: 999, padding: "14px", fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer" }}
          >
            {isPaid ? <RotateCcw style={{ width: 16, height: 16 }} /> : <Plus style={{ width: 16, height: 16 }} />}
            {isPaid ? "Adjust / Refund" : isPartial ? "Record Next Payment" : "Record Payment"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Line dialog (add / edit)                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function LineDialog({
  editing, orderId, orderIsDraft, skus, stockLevels, sourceGodownId, customerTier, onClose, onSaved,
}: {
  editing?: SalesOrderLineRow;
  orderId: string;
  /** True drafts have no stock posted yet, so a plain update is safe. Anything
   * past draft must go through editOrderLine(), which reverses and re-applies
   * FIFO stock so the line and stock_movements never drift apart. */
  orderIsDraft: boolean;
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
  const [belowCostConfirm, setBelowCostConfirm] = useState(false);
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

  // Suggestion only, never blocks the sale — flags when the typed price
  // undercuts this SKU's own target margin, even if the sale is still
  // profitable overall.
  const belowTargetMargin = useMemo(() => {
    if (!sku || sku.target_margin_pct == null || sku.landed_per_piece_mvr == null) return null;
    const price = parseFloat(unitPrice);
    if (isNaN(price) || price <= 0) return null;
    const unitsPerUom = uom === "carton" ? sku.pcs_per_pack * sku.packs_per_carton
      : uom === "pack" ? sku.pcs_per_pack : 1;
    const pricePerPiece = price / unitsPerUom;
    const margin = ((pricePerPiece - sku.landed_per_piece_mvr) / pricePerPiece) * 100;
    return margin < sku.target_margin_pct ? { margin, target: sku.target_margin_pct } : null;
  }, [sku, unitPrice, uom]);

  useEffect(() => {
    if (editing) return;
    if (autoPrice != null) {
      setUnitPrice(autoPrice.toFixed(0));
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

  // Losing money is a decision, never an accident — and this was the one door
  // without a lock. New Sale stops on a below-cost line and makes you tap a red
  // "Add at a loss"; this sheet, which is how a line gets added to an order that
  // already exists, had only the target-margin hint below — and 30 of 31 SKUs
  // have no target margin on file, so for almost every product it said nothing
  // at all and just saved. Cost is compared against the unit actually sold
  // (migration 0139's lesson), never a per-piece price nobody is charged.
  const belowCost = useMemo(() => {
    if (!sku || sku.landed_per_piece_mvr == null) return null;
    const price = parseFloat(unitPrice);
    const q = parseFloat(qty);
    if (isNaN(price) || price <= 0) return null;
    const perUom = uom === "carton" ? sku.pcs_per_pack * sku.packs_per_carton
      : uom === "pack" ? sku.pcs_per_pack : 1;
    const cost = sku.landed_per_piece_mvr * perUom;
    if (price >= cost) return null;
    const word = sellUnitLabel(uom, {
      pcsPerPack: sku.pcs_per_pack, packsPerCarton: sku.packs_per_carton,
      unitUom: sku.unit_uom, sellableUnits: sku.sellable_units,
    });
    const lossEach = cost - price;
    return { cost, price, lossEach, lossTotal: lossEach * (isNaN(q) ? 0 : q), qty: isNaN(q) ? 0 : q, word };
  }, [sku, unitPrice, qty, uom]);

  async function save(acceptLoss = false) {
    if (!skuId || !qty || !unitPrice || qtyPieces <= 0 || !sku) return;
    // The guard is bypassed by an explicit argument, not by reading state a
    // render later — the decision travels with the call that follows it.
    if (belowCost && !acceptLoss) { setBelowCostConfirm(true); return; }
    setSaving(true);
    try {
      if (editing) {
        if (orderIsDraft) {
          // No stock posted yet — a plain update is safe.
          const payload = { order_id: orderId, sku_id: skuId, uom, qty: parseFloat(qty), qty_pieces: qtyPieces, unit_price_mvr: parseFloat(unitPrice), line_total_mvr: lineTotal };
          await updateOrderLine(editing.id, payload);
        } else {
          // Stock already FIFO-deducted by post_sale() — must reverse and
          // re-apply via the safe RPC, never a direct table update.
          await editOrderLine(editing.id, qtyPieces, parseFloat(unitPrice));
        }
      } else {
        const payload = { order_id: orderId, sku_id: skuId, uom, qty: parseFloat(qty), qty_pieces: qtyPieces, unit_price_mvr: parseFloat(unitPrice), line_total_mvr: lineTotal };
        await createOrderLine(payload);
      }
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
    <BodyPortal>
    <div style={{ position: "fixed", inset: 0, background: "var(--scrim-bg)", zIndex: 60, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--glass-2)", backdropFilter: "var(--glass-blur-lg)", WebkitBackdropFilter: "var(--glass-blur-lg)", borderRadius: "20px 20px 0 0", width: "100%", padding: "28px 24px max(40px, env(safe-area-inset-bottom, 40px), var(--kb-inset))", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)", maxHeight: "90dvh", overflowY: "auto" }}
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
                    <button key={s.id} onClick={() => { setSkuId(s.id); setUom(pickUom(s, uom)); }} style={{ width: "100%", textAlign: "left", padding: "10px 14px", background: "transparent", border: "none", borderBottom: "0.5px solid var(--glass-border-lo)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <SkuIdentity
                        brandName={s.brand_name} modelName={s.model_name} variantDisplay={s.variant_display}
                        pcsPerPack={s.pcs_per_pack} packsPerCarton={s.packs_per_carton} unitUom={s.unit_uom as UnitUom}
                      />
                      {stock !== null && (
                        <span style={{ color: stock > 0 ? "var(--snm-success)" : "var(--snm-error)", fontSize: 13, flexShrink: 0 }}>{formatQtyInTradeUnits(stock, { pcsPerPack: s.pcs_per_pack, packsPerCarton: s.packs_per_carton, unitUom: s.unit_uom, sellableUnits: s.sellable_units })}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : sku ? (
            <div style={{ background: "var(--glass-bg-1)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <SkuIdentity
                  brandName={sku.brand_name} modelName={sku.model_name} variantDisplay={sku.variant_display}
                  pcsPerPack={sku.pcs_per_pack} packsPerCarton={sku.packs_per_carton} unitUom={sku.unit_uom as UnitUom}
                  size="card"
                />
                <button onClick={() => setSkuId("")} style={{ background: "none", border: "none", color: "var(--muted-foreground)", fontSize: 13, cursor: "pointer", flexShrink: 0 }}>Change</button>
              </div>
              {stockHere !== null && (
                <p style={{ color: stockHere === 0 ? "var(--snm-error)" : "var(--muted-foreground)", fontSize: 11, marginTop: 6 }}>
                  In warehouse: <strong style={{ color: "var(--foreground)" }}>{formatQtyInTradeUnits(stockHere, { pcsPerPack: sku.pcs_per_pack, packsPerCarton: sku.packs_per_carton, unitUom: sku.unit_uom, sellableUnits: sku.sellable_units })}</strong>
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* UOM selector — big tap targets, carton first */}
        {skuId && sku && (() => {
          const addCfg: TradeUnitConfig = {
            pcsPerPack: sku.pcs_per_pack, packsPerCarton: sku.packs_per_carton,
            unitUom: sku.unit_uom, sellableUnits: sku.sellable_units,
          };
          const addTiers = sellableTiers(sku.sellable_units);
          return (
          <div style={{ marginBottom: 16 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Selling unit *</p>
            {/* Only the tiers this SKU is actually sold in. This sheet used to
                hardcode all three — so a carton-only Sosoft could be added by
                the pack here while New Sale correctly refused, and every diaper
                offered a loose "Piece". Same guard, every door. */}
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${addTiers.length}, minmax(0, 1fr))` }}>
              {addTiers.map((u) => {
                const one = sellUnitLabel(u, addCfg);
                const opt = {
                  value: u,
                  label: u === "carton" ? "Carton" : one.charAt(0).toUpperCase() + one.slice(1),
                  sub: u === "carton"
                    ? `${sku.packs_per_carton} × ${sellUnitLabel("pack", addCfg)}`
                    : u === "pack"
                      ? (sku.pcs_per_pack > 1 ? `${sku.pcs_per_pack} per ${one}` : `1 ${one}`)
                      : `1 ${one}`,
                };
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
          );
        })()}

        {/* Qty + Price — side by side */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <div>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Qty *</p>
            <input
              autoFocus={!!skuId}
              type="number" inputMode={uom === "piece" ? "numeric" : "decimal"}
              step={uom === "piece" ? "1" : "0.5"} min="1"
              value={qty} onChange={(e) => setQty(e.target.value)}
              onFocus={(e) => e.target.select()}
              style={{ ...inputStyle, fontSize: 22, fontWeight: 600, textAlign: "center" }}
            />
          </div>
          <div>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>
              Price / {sku ? sellUnitLabel(uom, { pcsPerPack: sku.pcs_per_pack, packsPerCarton: sku.packs_per_carton, unitUom: sku.unit_uom, sellableUnits: sku.sellable_units }) : uom} (MVR) *
            </p>
            {!priceOverride && autoPrice != null ? (
              <div
                style={{ ...inputStyle, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", cursor: "pointer", gap: 2 }}
                onClick={() => setPriceOverride(true)}
              >
                <span style={{ color: "var(--foreground)", fontWeight: 700, fontSize: 18 }}>{autoPrice.toFixed(0)}</span>
                <span style={{
                  background: autoSource === "price_list"
                    ? "color-mix(in srgb, var(--snm-brand) 18%, transparent)"
                    : "color-mix(in srgb, var(--snm-success) 18%, transparent)",
                  color: autoSource === "price_list" ? "var(--snm-brand)" : "var(--snm-success)",
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 4,
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
                  onFocus={(e) => e.target.select()}
                  style={{ ...inputStyle, fontSize: 20, fontWeight: 600 }}
                />
                {autoPrice != null && (
                  <button
                    type="button"
                    onClick={() => { setUnitPrice(autoPrice.toFixed(0)); setPriceOverride(false); }}
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
                  <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Effective / {sellUnitLabel("pack", { pcsPerPack: sku.pcs_per_pack, packsPerCarton: sku.packs_per_carton, unitUom: sku.unit_uom, sellableUnits: sku.sellable_units })}</span>
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
              <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Quantity</span>
              <span style={{ color: "var(--foreground)", fontSize: 12 }}>{formatQtyInTradeUnits(qtyPieces, { pcsPerPack: sku.pcs_per_pack, packsPerCarton: sku.packs_per_carton, unitUom: sku.unit_uom, sellableUnits: sku.sellable_units })}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Line total</span>
              <span className="snm-num" style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 700 }}>MVR {mvrUpTo(lineTotal, 2)}</span>
            </div>
          </div>
        )}

        {/* Below-target-margin warning — suggestion only, owner still decides */}
        {belowTargetMargin && (
          <div style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
            <p style={{ color: "var(--snm-warning)", fontSize: 12, fontWeight: 600 }}>
              ⚠ Below target margin — {belowTargetMargin.margin.toFixed(1)}% vs {belowTargetMargin.target}% target
            </p>
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
            <p style={{ color: "var(--snm-error)", fontSize: 12 }}>⚠ Not enough stock — only {sku ? formatQtyInTradeUnits(stockHere ?? 0, { pcsPerPack: sku.pcs_per_pack, packsPerCarton: sku.packs_per_carton, unitUom: sku.unit_uom, sellableUnits: sku.sellable_units }) : `${stockHere ?? 0}`} available.</p>
          </div>
        )}

        {belowCost && (
          <div style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, border: "1px solid color-mix(in srgb, var(--snm-error) 28%, transparent)" }}>
            <p className="snm-num" style={{ color: "var(--snm-error)", fontSize: 12, fontWeight: 600 }}>
              ⚠ Below cost — this {belowCost.word} costs you MVR {belowCost.cost.toFixed(0)}
            </p>
            <p className="snm-num" style={{ color: "var(--muted-foreground)", fontSize: 11, marginTop: 2 }}>
              You lose MVR {belowCost.lossEach.toFixed(belowCost.lossEach >= 10 ? 0 : 2)} per {belowCost.word}
              {belowCost.qty > 1 ? ` — MVR ${belowCost.lossTotal.toFixed(0)} on this line` : ""}.
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => void save()} disabled={saving || !skuId || !qty || !unitPrice || qtyPieces <= 0 || insufficient} style={{ ...primaryBtn, opacity: saving || !skuId || !qty || !unitPrice || qtyPieces <= 0 || insufficient ? 0.5 : 1, cursor: saving || !skuId || !qty || !unitPrice || qtyPieces <= 0 || insufficient ? "not-allowed" : "pointer" }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" style={{ display: "inline" }} /> : editing ? "Save" : "Add item"}
          </button>
        </div>
      </div>

    </div>

    {belowCost && (
        <ConfirmSheet
          open={belowCostConfirm}
          title="This sells below cost"
          message={`${sku ? `${sku.brand_name} ${sku.variant_display}` : "This product"} costs you MVR ${belowCost.cost.toFixed(0)}/${belowCost.word} right now — at MVR ${belowCost.price.toFixed(0)} you lose about MVR ${belowCost.lossEach.toFixed(belowCost.lossEach >= 10 ? 0 : 2)} per ${belowCost.word}${belowCost.qty > 1 ? ` (MVR ${belowCost.lossTotal.toFixed(0)} on this line)` : ""}. Go back to adjust the price, or ${editing ? "save" : "add"} it anyway.`}
          confirmLabel={editing ? "Save at a loss" : "Add at a loss"}
          loading={saving}
          onConfirm={() => { setBelowCostConfirm(false); void save(true); }}
          onClose={() => setBelowCostConfirm(false)}
        />
    )}
    </BodyPortal>
  );
}

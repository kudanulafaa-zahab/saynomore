"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2,
  ArrowLeft,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getOrder,
  listOrderLines,
  updateOrder,
  deleteOrder,
  createOrderLine,
  updateOrderLine,
  deleteOrderLine,
  postSale,
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

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  picked: "Picked",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  pending: "Pending",
  partial: "Partial",
  paid: "Paid (transfer)",
  cod: "Cash on Delivery",
  deposited: "Deposited (cash → ATM)",
};

interface DriverOption {
  id: string;
  full_name: string;
}

export function SaleDetail({ id }: { id: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<SalesOrderRow | null>(null);
  const [lines, setLines] = useState<SalesOrderLineRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [deleteOrderDialog, setDeleteOrderDialog] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [deleteLineDialog, setDeleteLineDialog] = useState<SalesOrderLineRow | null>(null);
  const [deletingLine, setDeletingLine] = useState(false);
  const [lineDialog, setLineDialog] = useState<{ open: boolean; editing?: SalesOrderLineRow }>({ open: false });
  const [role, setRole] = useState<string | null>(null);

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
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);
  const isAdmin = role === "admin";

  const customer = customers.find((c) => c.id === order?.customer_id);
  const totals = useMemo(() => {
    const sum = lines.reduce((acc, l) => acc + Number(l.line_total_mvr), 0);
    return { mvr: sum, count: lines.length };
  }, [lines]);

  const posted = order && order.status !== "draft" && order.status !== "cancelled";

  async function patch(field: keyof SalesOrderRow, value: number | string | boolean | null) {
    if (!order) return;
    try {
      await updateOrder(order.id, { [field]: value } as Record<string, unknown>);
      setOrder({ ...order, [field]: value } as SalesOrderRow);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handlePostSale() {
    if (!order) return;
    if (!order.source_godown_id) {
      toast.error("Pick a source godown first");
      return;
    }
    if (lines.length === 0) {
      toast.error("Add at least one line");
      return;
    }
    setPosting(true);
    try {
      await postSale(order.id);
      toast.success("Confirmed — stock deducted");
      setConfirmDialog(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading order…</p>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="glass p-12 text-center text-muted-foreground">
        Order not found.
        <div className="mt-4">
          <Link href="/sales" className="text-primary text-sm hover:underline">Back to sales</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/sales" className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Sale</p>
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground truncate">
              {customer?.name ?? "—"}
              <span className="text-sm text-muted-foreground ml-2">{order.order_number}</span>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] uppercase tracking-wider rounded px-2 py-1 bg-secondary text-foreground">
            {STATUS_LABEL[order.status]}
          </span>
          {isAdmin && (
            <button
              onClick={() => setDeleteOrderDialog(true)}
              className="p-2 rounded-lg text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
              title="Delete (admin)"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Header card */}
      <div className="glass p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={order.status} onValueChange={(v) => v && patch("status", v as OrderStatus)}>
              <SelectTrigger><SelectValue>{STATUS_LABEL[order.status]}</SelectValue></SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Payment</Label>
            <Select value={order.payment_status} onValueChange={(v) => v && patch("payment_status", v as PaymentStatus)}>
              <SelectTrigger><SelectValue>{PAYMENT_LABEL[order.payment_status]}</SelectValue></SelectTrigger>
              <SelectContent>
                {(Object.keys(PAYMENT_LABEL) as PaymentStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{PAYMENT_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Source Godown *</Label>
            <Select
              value={order.source_godown_id ?? ""}
              onValueChange={(v) => v && patch("source_godown_id", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick godown">
                  {godowns.find((g) => g.id === order.source_godown_id)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {godowns.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}{g.is_default ? " (default)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Stock is deducted from this godown (FIFO).</p>
          </div>
          <div className="space-y-2">
            <Label>Assigned Driver</Label>
            <Select
              value={order.assigned_driver_id ?? ""}
              onValueChange={(v) => patch("assigned_driver_id", v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick driver">
                  {drivers.find((d) => d.id === order.assigned_driver_id)?.full_name ?? "—"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Delivery Island</Label>
            <Input
              value={order.delivery_island ?? ""}
              onChange={(e) => setOrder({ ...order, delivery_island: e.target.value })}
              onBlur={(e) => patch("delivery_island", e.target.value || null)}
              placeholder={customer?.island ?? "Optional"}
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={order.delivery_to_boat}
                onChange={(e) => patch("delivery_to_boat", e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Delivery to boat (resort/island)
            </Label>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Delivery Address</Label>
          <Textarea
            value={order.delivery_address ?? ""}
            onChange={(e) => setOrder({ ...order, delivery_address: e.target.value })}
            onBlur={(e) => patch("delivery_address", e.target.value || null)}
            className="min-h-[50px]"
            placeholder={customer?.address ?? "Optional"}
          />
        </div>

        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea
            value={order.notes ?? ""}
            onChange={(e) => setOrder({ ...order, notes: e.target.value })}
            onBlur={(e) => patch("notes", e.target.value || null)}
            className="min-h-[50px]"
          />
        </div>
      </div>

      {/* Lines */}
      <div className="glass p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium text-foreground">Items</h2>
            <p className="text-xs text-muted-foreground">{totals.count} line{totals.count === 1 ? "" : "s"} · {totals.mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR</p>
          </div>
          {!posted && (
            <Button onClick={() => setLineDialog({ open: true })} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Item
            </Button>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No items yet.</p>
        ) : (
          <div className="space-y-2">
            {lines.map((l) => {
              const sku = skus.find((s) => s.id === l.sku_id);
              return (
                <div key={l.id} className="glass-flat p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      {sku?.brand_name} › {sku?.model_name} › {sku?.variant_display}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {l.qty} {l.uom}
                      {l.uom !== "piece" && <> = {l.qty_pieces} pcs</>}
                      {" · "}
                      {Number(l.unit_price_mvr).toLocaleString()} MVR/{l.uom}
                      {" · "}
                      <span className="text-foreground">{Number(l.line_total_mvr).toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR</span>
                    </p>
                  </div>
                  {!posted && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => setLineDialog({ open: true, editing: l })} className="text-xs text-primary hover:opacity-80 px-2">Edit</button>
                      <button
                        onClick={() => setDeleteLineDialog(l)}
                        className="text-xs text-red-500 hover:opacity-80 px-2"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex justify-between border-t border-border pt-3 text-base">
              <span className="font-medium text-foreground">Total</span>
              <span className="font-semibold text-primary">
                {totals.mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Confirm action */}
      {!posted && (
        <div className="glass p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="space-y-1 flex-1">
              <h3 className="text-base font-medium text-foreground">Confirm sale</h3>
              <p className="text-xs text-muted-foreground">
                Deducts stock from the source godown using FIFO (oldest batch first).
                You can still update delivery status afterwards.
              </p>
            </div>
          </div>
          <Button
            onClick={() => setConfirmDialog(true)}
            disabled={lines.length === 0 || !order.source_godown_id}
            className="w-full sm:w-auto"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Confirm sale
          </Button>
        </div>
      )}

      {posted && (
        <div className="glass-flat p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-foreground">Sale confirmed and stock deducted.</p>
            <p className="text-xs text-muted-foreground">
              Update status above as the order moves through pick → out for delivery → delivered.
            </p>
          </div>
        </div>
      )}

      {/* Line dialog */}
      <LineDialog
        open={lineDialog.open}
        editing={lineDialog.editing}
        orderId={id}
        skus={skus}
        stockLevels={stockLevels}
        sourceGodownId={order.source_godown_id}
        onOpenChange={(o) => setLineDialog({ open: o })}
        onSaved={load}
      />

      {/* Confirm sale dialog */}
      <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Confirm sale</DialogTitle>
            </div>
            <DialogDescription>
              Stock will be deducted from {godowns.find((g) => g.id === order.source_godown_id)?.name ?? "the selected godown"} using FIFO.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-secondary/50 p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items</span>
              <span className="text-foreground">{totals.count}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total MVR</span>
              <span className="text-foreground font-medium">{totals.mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDialog(false)}>Cancel</Button>
            <Button onClick={handlePostSale} disabled={posting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete order dialog */}
      <Dialog open={deleteOrderDialog} onOpenChange={setDeleteOrderDialog}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Delete order?</DialogTitle>
            </div>
            <DialogDescription>
              <strong>{order.order_number}</strong> and all its line items will be permanently removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOrderDialog(false)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deletingOrder}
              onClick={async () => {
                setDeletingOrder(true);
                try {
                  await deleteOrder(order.id);
                  toast.success("Order deleted");
                  router.push("/sales");
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setDeletingOrder(false);
                }
              }}
            >
              {deletingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove line dialog */}
      <Dialog open={!!deleteLineDialog} onOpenChange={(o) => { if (!o) setDeleteLineDialog(null); }}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Remove item?</DialogTitle>
            </div>
            <DialogDescription>
              {deleteLineDialog && (() => {
                const sku = skus.find((s) => s.id === deleteLineDialog.sku_id);
                return sku
                  ? <><strong>{sku.brand_name} › {sku.model_name} › {sku.variant_display}</strong> will be removed from this order.</>
                  : "This item will be permanently removed.";
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteLineDialog(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deletingLine}
              onClick={async () => {
                if (!deleteLineDialog) return;
                setDeletingLine(true);
                try {
                  await deleteOrderLine(deleteLineDialog.id);
                  toast.success("Item removed");
                  setDeleteLineDialog(null);
                  load();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setDeletingLine(false);
                }
              }}
            >
              {deletingLine ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Line dialog ──────────────────────────────────────────────────────────

function LineDialog({
  open, editing, orderId, skus, stockLevels, sourceGodownId, onOpenChange, onSaved,
}: {
  open: boolean;
  editing?: SalesOrderLineRow;
  orderId: string;
  skus: SkuFullRow[];
  stockLevels: StockLevel[];
  sourceGodownId: string | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [skuId, setSkuId] = useState("");
  const [search, setSearch] = useState("");
  const [uom, setUom] = useState<SaleUom>("pack");
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const sku = skus.find((s) => s.id === skuId);

  useEffect(() => {
    if (open) {
      if (editing) {
        setSkuId(editing.sku_id);
        setUom(editing.uom);
        setQty(String(editing.qty));
        setUnitPrice(String(editing.unit_price_mvr));
      } else {
        setSkuId("");
        setUom("pack");
        setQty("");
        setUnitPrice("");
      }
      setSearch("");
    }
  }, [open, editing]);

  // For diapers default uom = pack; for everything else default = pack too,
  // but allow carton/piece in UI.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    if (!term) return active.slice(0, 50);
    return active.filter((s) =>
      [s.brand_name, s.model_name, s.variant_display, s.internal_code].join(" ").toLowerCase().includes(term),
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
    const q = parseFloat(qty);
    const p = parseFloat(unitPrice);
    if (isNaN(q) || isNaN(p)) return 0;
    return q * p;
  }, [qty, unitPrice]);

  const insufficient = stockHere !== null && qtyPieces > stockHere;

  async function save() {
    if (!skuId || !qty || !unitPrice || qtyPieces <= 0) return;
    if (!sku) return;
    const payload = {
      order_id: orderId,
      sku_id: skuId,
      uom,
      qty: parseFloat(qty),
      qty_pieces: qtyPieces,
      unit_price_mvr: parseFloat(unitPrice),
      line_total_mvr: lineTotal,
    };
    setSaving(true);
    try {
      if (editing) await updateOrderLine(editing.id, payload);
      else await createOrderLine(payload);
      toast.success(editing ? "Item updated" : "Item added");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit item" : "New item"}</DialogTitle>
          <DialogDescription>Sell by carton, pack, or piece. Stock auto-converts.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Product *</Label>
            {!skuId ? (
              <>
                <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" />
                <div className="rounded-xl border border-border max-h-[240px] overflow-y-auto bg-background/50">
                  {filtered.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-3 py-2">No matches</p>
                  ) : (
                    filtered.map((s) => {
                      const stock = sourceGodownId
                        ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === sourceGodownId)?.qty_pieces ?? 0
                        : null;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setSkuId(s.id)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent/30 transition border-b border-border last:border-0"
                        >
                          <div className="flex justify-between">
                            <p className="text-foreground">{s.brand_name} › {s.model_name} › {s.variant_display}</p>
                            {stock !== null && (
                              <span className={`text-[11px] ${stock > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-red-500"}`}>
                                {stock} pcs
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            ) : sku ? (
              <div className="rounded-xl border border-border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{sku.brand_name} › {sku.model_name} › {sku.variant_display}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn
                    </p>
                  </div>
                  <button onClick={() => setSkuId("")} className="text-xs text-primary hover:opacity-80 shrink-0">Change</button>
                </div>
                {stockHere !== null && (
                  <div className={`text-[11px] ${stockHere === 0 ? "text-red-500" : "text-muted-foreground"}`}>
                    Stock here: <strong className="text-foreground">{stockHere.toLocaleString()} pcs</strong>
                    {sku.pcs_per_pack > 0 && stockHere > 0 && (
                      <> · {Math.floor(stockHere / sku.pcs_per_pack)} pk</>
                    )}
                    {sku.pcs_per_carton > 0 && stockHere > 0 && (
                      <> · {Math.floor(stockHere / sku.pcs_per_carton)} ctn</>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2 col-span-1">
              <Label>UoM *</Label>
              <Select value={uom} onValueChange={(v) => v && setUom(v as SaleUom)}>
                <SelectTrigger><SelectValue>{uom}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="carton">Carton</SelectItem>
                  <SelectItem value="pack">Pack</SelectItem>
                  <SelectItem value="piece">Piece</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-1">
              <Label>Qty *</Label>
              <Input
                type="number"
                inputMode={uom === "piece" ? "numeric" : "decimal"}
                step={uom === "piece" ? "1" : "0.5"}
                min="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-2 col-span-1">
              <Label>Unit price (MVR) *</Label>
              <Input type="number" inputMode="decimal" step="0.01" min="0" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
          </div>

          {sku && qtyPieces > 0 && (
            <div className="rounded-xl bg-secondary/50 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pieces (auto)</span>
                <span className="text-foreground">{qtyPieces.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Line total</span>
                <span className="text-foreground font-medium">{lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} MVR</span>
              </div>
            </div>
          )}

          {insufficient && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
              Insufficient stock — only {stockHere} pcs available in this godown.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !skuId || !qty || !unitPrice || qtyPieces <= 0 || insufficient}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

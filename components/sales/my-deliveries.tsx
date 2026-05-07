"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Truck,
  CheckCircle2,
  Package,
  MapPin,
  Phone,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface OrderWithLines {
  order: SalesOrderRow;
  lines: SalesOrderLineRow[];
  customer?: CustomerRow;
  godown?: GodownRow;
}

export function MyDeliveries() {
  const [items, setItems] = useState<OrderWithLines[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cashDialog, setCashDialog] = useState<{ open: boolean; order?: SalesOrderRow }>({ open: false });

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

  async function setStatus(id: string, patch: Record<string, string | number | null>) {
    try {
      await updateOrder(id, patch);
      toast.success("Updated");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Today</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">My Deliveries</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {items.length === 0 ? "No deliveries assigned." : `${items.length} delivery${items.length === 1 ? "" : "s"} to handle.`}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <Truck className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-medium text-foreground">All caught up</h3>
          <p className="text-sm text-muted-foreground">
            New deliveries will appear here when an admin assigns them to you.
          </p>
        </div>
      ) : (
        items.map(({ order, lines, customer, godown }) => {
          const isOpen = expanded === order.id;
          const isCod = order.payment_status === "cod";
          const totalMvr = lines.reduce((acc, l) => acc + Number(l.line_total_mvr), 0);

          return (
            <div key={order.id} className="glass overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : order.id)}
                className="w-full p-4 flex items-center justify-between gap-3 hover:bg-accent/30 transition text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-base font-medium text-foreground">{customer?.name ?? "—"}</p>
                    {isCod && (
                      <span className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-300">
                        COD {totalMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {godown && (
                      <span className="inline-flex items-center gap-1">
                        <Package className="h-3 w-3" /> Pick from: <strong className="text-foreground">{godown.name}</strong>
                      </span>
                    )}
                    {(customer?.island || order.delivery_island) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {order.delivery_island || customer?.island}
                      </span>
                    )}
                    {customer?.phone && (
                      <a
                        href={`tel:${customer.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-primary hover:opacity-80"
                      >
                        <Phone className="h-3 w-3" /> {customer.phone}
                      </a>
                    )}
                  </div>
                </div>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} />
              </button>

              {isOpen && (
                <div className="border-t border-border bg-background/30 p-4 space-y-4">
                  {/* Items */}
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Items</p>
                    {lines.map((l) => {
                      const sku = skus.find((s) => s.id === l.sku_id);
                      return (
                        <div key={l.id} className="flex justify-between text-sm py-1">
                          <span className="text-foreground truncate">
                            {sku?.brand_name} › {sku?.model_name} › {sku?.variant_display}
                          </span>
                          <span className="text-muted-foreground shrink-0 ml-2">
                            {l.qty} {l.uom}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {order.delivery_address && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Address</p>
                      <p className="text-sm text-foreground">{order.delivery_address}</p>
                    </div>
                  )}

                  {/* Big action buttons */}
                  <div className="space-y-2">
                    {order.status === "confirmed" && (
                      <Button
                        onClick={() => setStatus(order.id, { status: "picked", picked_at: new Date().toISOString() })}
                        className="w-full h-12 text-base"
                      >
                        <Package className="h-5 w-5 mr-2" />
                        Picked from godown
                      </Button>
                    )}
                    {order.status === "picked" && (
                      <Button
                        onClick={() => setStatus(order.id, { status: "out_for_delivery" })}
                        className="w-full h-12 text-base bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        <Truck className="h-5 w-5 mr-2" />
                        Out for delivery
                      </Button>
                    )}
                    {order.status === "out_for_delivery" && (
                      <>
                        {isCod ? (
                          <Button
                            onClick={() => setCashDialog({ open: true, order })}
                            className="w-full h-12 text-base bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <CheckCircle2 className="h-5 w-5 mr-2" />
                            Delivered + Collect cash
                          </Button>
                        ) : (
                          <Button
                            onClick={() => setStatus(order.id, { status: "delivered", delivered_at: new Date().toISOString() })}
                            className="w-full h-12 text-base bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <CheckCircle2 className="h-5 w-5 mr-2" />
                            Delivered
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Cash collection dialog */}
      <CashCollectDialog
        open={cashDialog.open}
        order={cashDialog.order}
        onOpenChange={(o) => setCashDialog({ open: o })}
        onDone={() => { setCashDialog({ open: false }); load(); }}
      />
    </div>
  );
}

function CashCollectDialog({
  open, order, onOpenChange, onDone,
}: {
  open: boolean;
  order?: SalesOrderRow;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setAmount("");
  }, [open]);

  async function save() {
    if (!order || !amount) return;
    setSaving(true);
    try {
      await updateOrder(order.id, {
        status: "delivered",
        payment_status: "paid",
        cash_collected_mvr: parseFloat(amount),
      } as Record<string, unknown>);
      toast.success("Delivered. Don't forget to deposit the cash.");
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle>Cash collected</DialogTitle>
          <DialogDescription>How much cash did you collect?</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Amount (MVR)</Label>
          <Input
            autoFocus
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="h-12 text-lg"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !amount} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark delivered"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

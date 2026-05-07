"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Search,
  ShoppingCart,
  CheckCircle2,
  Clock,
  Truck,
  Package,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  listOrders,
  createOrder,
  nextOrderNumber,
  type SalesOrderRow,
  type OrderStatus,
  type OrderChannel,
} from "@/lib/queries/sales";
import { listCustomers, type CustomerRow } from "@/lib/queries/masters";

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  picked: "Picked",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  picked: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  out_for_delivery: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  delivered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  cancelled: "bg-red-500/15 text-red-600 dark:text-red-300",
};

const STATUS_ICON: Record<OrderStatus, typeof Clock> = {
  draft: Clock,
  confirmed: CheckCircle2,
  picked: Package,
  out_for_delivery: Truck,
  delivered: CheckCircle2,
  cancelled: XCircle,
};

const CHANNELS: { value: OrderChannel; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "viber", label: "Viber" },
  { value: "messenger", label: "Messenger" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "phone", label: "Phone" },
  { value: "walkin", label: "Walk-in" },
  { value: "other", label: "Other" },
];

export function SalesList() {
  const router = useRouter();
  const [rows, setRows] = useState<SalesOrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [newDialog, setNewDialog] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [o, c] = await Promise.all([listOrders(), listCustomers()]);
      setRows(o);
      setCustomers(c);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    const term = q.trim().toLowerCase();
    if (term) {
      r = r.filter((x) => {
        const cust = customers.find((c) => c.id === x.customer_id);
        return [x.order_number, cust?.name ?? "", cust?.phone ?? "", x.notes ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(term);
      });
    }
    return r;
  }, [rows, q, statusFilter, customers]);

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Operations</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Sales</h1>
        </div>
        <Button onClick={() => setNewDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New
        </Button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by order number, customer…"
            className="pl-9 h-11"
            inputMode="search"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-[140px] h-11">
            <SelectValue>{statusFilter === "all" ? "All" : STATUS_LABEL[statusFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <ShoppingCart className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-medium text-foreground">
            {rows.length === 0 ? "No sales yet" : "No matches"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {rows.length === 0
              ? "Record a sale when a customer messages you on WhatsApp/Viber/etc."
              : "Try a different filter."}
          </p>
          {rows.length === 0 && (
            <Button onClick={() => setNewDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Record first sale
            </Button>
          )}
        </div>
      ) : (
        <div className="glass divide-y divide-border overflow-hidden">
          {filtered.map((o) => {
            const Icon = STATUS_ICON[o.status];
            const cust = customers.find((c) => c.id === o.customer_id);
            return (
              <Link
                key={o.id}
                href={`/sales/${o.id}`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-accent/30 transition"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${STATUS_COLOR[o.status]}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-medium text-foreground">
                      {cust?.name ?? "—"}
                      <span className="text-xs text-muted-foreground ml-2">{o.order_number}</span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      via {o.channel}{cust?.island && <> · {cust.island}</>}
                    </p>
                  </div>
                </div>
                <span className={`text-[10px] uppercase tracking-wider rounded px-2 py-0.5 shrink-0 ${STATUS_COLOR[o.status]}`}>
                  {STATUS_LABEL[o.status]}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <NewOrderDialog
        open={newDialog}
        customers={customers}
        existing={rows}
        onOpenChange={setNewDialog}
        onCreated={(id) => {
          setNewDialog(false);
          router.push(`/sales/${id}`);
        }}
      />
    </div>
  );
}

function NewOrderDialog({
  open, customers, existing, onOpenChange, onCreated,
}: {
  open: boolean;
  customers: CustomerRow[];
  existing: SalesOrderRow[];
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [orderNumber, setOrderNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [channel, setChannel] = useState<OrderChannel>("whatsapp");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setOrderNumber(nextOrderNumber(existing));
      setCustomerId("");
      setCustomerSearch("");
      setChannel("whatsapp");
    }
  }, [open, existing]);

  // Recents-first: last 5 customers from this user
  const recentCustomers = useMemo(() => customers.slice(0, 5), [customers]);

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return [];
    return customers
      .filter((c) =>
        [c.name, c.phone ?? "", c.island ?? ""].join(" ").toLowerCase().includes(term),
      )
      .slice(0, 10);
  }, [customers, customerSearch]);

  const customer = customers.find((c) => c.id === customerId);

  async function save() {
    if (!orderNumber.trim()) return;
    setSaving(true);
    try {
      // Pick the customer's preferred channel if available
      const cust = customers.find((c) => c.id === customerId);
      const finalChannel = cust?.channel ?? channel;
      const created = await createOrder({
        order_number: orderNumber.trim(),
        customer_id: customerId || null,
        channel: finalChannel,
        status: "draft",
      });
      onCreated(created.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>New Sale</DialogTitle>
          <DialogDescription>Record a customer order. Add line items and confirm to deduct stock.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Customer *</Label>
            {!customerId ? (
              <>
                <Input
                  autoFocus
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Search name, phone, island…"
                />
                <div className="rounded-xl border border-border max-h-[200px] overflow-y-auto bg-background/50">
                  {(customerSearch.trim() ? filteredCustomers : recentCustomers).length === 0 ? (
                    <p className="text-xs text-muted-foreground px-3 py-2">
                      {customerSearch.trim() ? "No matches" : "No customers yet — add one in Customers first."}
                    </p>
                  ) : (
                    <>
                      {!customerSearch.trim() && recentCustomers.length > 0 && (
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground px-3 pt-2">Recents</p>
                      )}
                      {(customerSearch.trim() ? filteredCustomers : recentCustomers).map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setCustomerId(c.id)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent/30 transition border-b border-border last:border-0"
                        >
                          <p className="text-foreground">{c.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {[c.phone, c.island, c.channel].filter(Boolean).join(" · ")}
                          </p>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            ) : customer ? (
              <div className="rounded-xl border border-border p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-foreground">{customer.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {[customer.phone, customer.island, customer.channel].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button onClick={() => setCustomerId("")} className="text-xs text-primary hover:opacity-80">Change</button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Order # *</Label>
              <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => v && setChannel(v as OrderChannel)}>
                <SelectTrigger><SelectValue>{CHANNELS.find((c) => c.value === channel)?.label}</SelectValue></SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !orderNumber.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

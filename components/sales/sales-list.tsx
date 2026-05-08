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
  UserPlus,
  ChevronRight,
  Trash2,
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
  createOrderLine,
  postSale,
  toPieces,
  type SalesOrderRow,
  type OrderStatus,
  type OrderChannel,
  type SaleUom,
} from "@/lib/queries/sales";
import {
  listCustomers,
  createCustomer,
  listGodowns,
  type CustomerRow,
  type CustomerChannel,
  type CustomerInput,
  type GodownRow,
} from "@/lib/queries/masters";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { listStockLevels, type StockLevel } from "@/lib/queries/inventory";

// ── Constants ─────────────────────────────────────────────────────────────

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

const CUSTOMER_CHANNELS: { value: CustomerChannel; label: string }[] = CHANNELS as { value: CustomerChannel; label: string }[];

// ── Draft line item (before order exists in DB) ───────────────────────────

interface DraftLine {
  key: string; // temp ID
  sku: SkuFullRow;
  uom: SaleUom;
  qty: number;
  qty_pieces: number;
  unit_price_mvr: number;
  line_total_mvr: number;
}

// ── SalesList ─────────────────────────────────────────────────────────────

export function SalesList() {
  const router = useRouter();
  const [rows, setRows] = useState<SalesOrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [newDialog, setNewDialog] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [o, c, sk, g, lvl] = await Promise.all([
        listOrders(),
        listCustomers(),
        listSkusFlat(),
        listGodowns(),
        listStockLevels(),
      ]);
      setRows(o);
      setCustomers(c);
      setSkus(sk);
      setGodowns(g);
      setStockLevels(lvl);
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
          New Sale
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
              ? "Record a sale when a customer messages you on WhatsApp, Viber, Instagram, etc."
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
                      {cust?.name ?? "Walk-in"}
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

      <NewSaleDialog
        open={newDialog}
        customers={customers}
        skus={skus}
        godowns={godowns}
        stockLevels={stockLevels}
        existingOrders={rows}
        onOpenChange={(o) => {
          setNewDialog(o);
        }}
        onCreated={(id) => {
          setNewDialog(false);
          load(); // refresh list
          router.push(`/sales/${id}`);
        }}
        onCustomerCreated={(c) => setCustomers((prev) => [c, ...prev])}
      />
    </div>
  );
}

// ── NewSaleDialog — 3-step guided flow ────────────────────────────────────
// Step 1: Customer (select existing OR create new inline)
// Step 2: Add products with qty + price
// Step 3: Review summary & confirm

type Step = 1 | 2 | 3;

function NewSaleDialog({
  open,
  customers,
  skus,
  godowns,
  stockLevels,
  existingOrders,
  onOpenChange,
  onCreated,
  onCustomerCreated,
}: {
  open: boolean;
  customers: CustomerRow[];
  skus: SkuFullRow[];
  godowns: GodownRow[];
  stockLevels: StockLevel[];
  existingOrders: SalesOrderRow[];
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
  onCustomerCreated: (c: CustomerRow) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [orderNumber, setOrderNumber] = useState("");
  const [channel, setChannel] = useState<OrderChannel>("whatsapp");

  // Customer state
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustIsland, setNewCustIsland] = useState("");
  const [newCustChannel, setNewCustChannel] = useState<CustomerChannel>("whatsapp");
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Product / lines state
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [skuSearch, setSkuSearch] = useState("");
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [lineUom, setLineUom] = useState<SaleUom>("pack");
  const [lineQty, setLineQty] = useState("");
  const [linePrice, setLinePrice] = useState("");
  const [addingLine, setAddingLine] = useState(false);

  // Godown + submit
  const [godownId, setGodownId] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setStep(1);
      setOrderNumber(nextOrderNumber(existingOrders));
      setChannel("whatsapp");
      setCustomerId("");
      setCustomerSearch("");
      setShowNewCustomer(false);
      setNewCustName("");
      setNewCustPhone("");
      setNewCustIsland("");
      setNewCustChannel("whatsapp");
      setDraftLines([]);
      setSkuSearch("");
      setSelectedSkuId("");
      setLineUom("pack");
      setLineQty("");
      setLinePrice("");
      const defaultGodown = godowns.find((g) => g.is_default);
      setGodownId(defaultGodown?.id ?? godowns[0]?.id ?? "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const customer = customers.find((c) => c.id === customerId);
  const selectedSku = skus.find((s) => s.id === selectedSkuId);

  // Customer search results
  const recentCustomers = useMemo(() => customers.slice(0, 6), [customers]);
  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return [];
    return customers
      .filter((c) =>
        [c.name, c.phone ?? "", c.island ?? "", c.company ?? ""].join(" ").toLowerCase().includes(term),
      )
      .slice(0, 10);
  }, [customers, customerSearch]);

  // Product search results
  const filteredSkus = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    if (!term) return active.slice(0, 40);
    return active
      .filter((s) =>
        [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 40);
  }, [skus, skuSearch]);

  // Stock for selected sku in selected godown
  const stockHere = selectedSku && godownId
    ? stockLevels.find((l) => l.sku_id === selectedSku.id && l.godown_id === godownId)?.qty_pieces ?? 0
    : null;

  // Auto-fill price whenever SKU or UoM changes
  useEffect(() => {
    if (!selectedSku) return;
    const suggestedPrice =
      lineUom === "piece"   ? selectedSku.selling_price_per_piece_mvr :
      lineUom === "pack"    ? selectedSku.selling_price_per_pack_mvr :
      /* carton */            selectedSku.selling_price_per_carton_mvr;
    if (suggestedPrice != null) {
      setLinePrice(suggestedPrice.toFixed(2));
    } else {
      setLinePrice(""); // clear if no margin set so user must enter manually
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkuId, lineUom]);

  // Pieces for current line entry
  const lineQtyPieces = useMemo(() => {
    if (!selectedSku || !lineQty) return 0;
    const n = parseFloat(lineQty);
    if (isNaN(n) || n <= 0) return 0;
    return toPieces(lineUom, n, selectedSku.pcs_per_pack, selectedSku.packs_per_carton);
  }, [selectedSku, lineQty, lineUom]);

  const lineTotal = useMemo(() => {
    const q = parseFloat(lineQty);
    const p = parseFloat(linePrice);
    if (isNaN(q) || isNaN(p)) return 0;
    return q * p;
  }, [lineQty, linePrice]);

  const insufficient = stockHere !== null && lineQtyPieces > stockHere;

  const grandTotal = useMemo(
    () => draftLines.reduce((s, l) => s + l.line_total_mvr, 0),
    [draftLines],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleCreateCustomer() {
    if (!newCustName.trim()) return;
    setSavingCustomer(true);
    try {
      const input: CustomerInput = {
        name: newCustName.trim(),
        phone: newCustPhone.trim() || null,
        island: newCustIsland.trim() || null,
        channel: newCustChannel,
      };
      const created = await createCustomer(input);
      onCustomerCreated(created as CustomerRow);
      setCustomerId(created.id);
      setChannel(newCustChannel as OrderChannel);
      setShowNewCustomer(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingCustomer(false);
    }
  }

  function handleAddLine() {
    if (!selectedSku || !lineQty || !linePrice || lineQtyPieces <= 0) return;
    const newLine: DraftLine = {
      key: `${selectedSku.id}-${Date.now()}`,
      sku: selectedSku,
      uom: lineUom,
      qty: parseFloat(lineQty),
      qty_pieces: lineQtyPieces,
      unit_price_mvr: parseFloat(linePrice),
      line_total_mvr: lineTotal,
    };
    setDraftLines((prev) => [...prev, newLine]);
    // Reset line inputs
    setSelectedSkuId("");
    setSkuSearch("");
    setLineQty("");
    setLinePrice("");
    setLineUom("pack");
  }

  function handleRemoveLine(key: string) {
    setDraftLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function handleSubmit() {
    if (!orderNumber.trim() || draftLines.length === 0) return;
    setSaving(true);
    try {
      const cust = customers.find((c) => c.id === customerId);
      const finalChannel = cust?.channel ?? channel;
      // 1. Create the order header
      const created = await createOrder({
        order_number: orderNumber.trim(),
        customer_id: customerId || null,
        channel: finalChannel,
        status: "draft",
        source_godown_id: godownId || null,
      });
      // 2. Create all line items
      await Promise.all(
        draftLines.map((l) =>
          createOrderLine({
            order_id: created.id,
            sku_id: l.sku.id,
            uom: l.uom,
            qty: l.qty,
            qty_pieces: l.qty_pieces,
            unit_price_mvr: l.unit_price_mvr,
            line_total_mvr: l.line_total_mvr,
          }),
        ),
      );
      toast.success("Sale created — review and confirm below");
      onCreated(created.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ── Step labels ───────────────────────────────────────────────────────────

  const stepLabels: Record<Step, string> = {
    1: "Customer",
    2: "Products",
    3: "Review",
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>New Sale</DialogTitle>
          <DialogDescription>
            {step === 1 && "Who is buying? Select or create a customer."}
            {step === 2 && "What are they buying? Add products to this order."}
            {step === 3 && "Review and create the order."}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 py-1">
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 transition-colors ${
                step === s
                  ? "bg-primary text-primary-foreground"
                  : step > s
                  ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                  : "bg-secondary text-muted-foreground"
              }`}>
                {step > s ? "✓" : s}
              </div>
              <span className={`text-xs ${step === s ? "text-foreground" : "text-muted-foreground"}`}>
                {stepLabels[s]}
              </span>
              {s < 3 && <div className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">

          {/* ── STEP 1: Customer ─────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-3">
              {!customerId && !showNewCustomer && (
                <>
                  <div className="space-y-2">
                    <Label>Search existing customer</Label>
                    <Input
                      autoFocus
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Name, phone, island…"
                    />
                  </div>
                  <div className="rounded-xl border border-border max-h-[220px] overflow-y-auto bg-background/50">
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).length === 0 ? (
                      <p className="text-xs text-muted-foreground px-3 py-3">
                        {customerSearch.trim() ? "No matches found." : "No customers yet."}
                      </p>
                    ) : (
                      <>
                        {!customerSearch.trim() && (
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground px-3 pt-2 pb-1">Recent</p>
                        )}
                        {(customerSearch.trim() ? filteredCustomers : recentCustomers).map((c) => (
                          <button
                            key={c.id}
                            onClick={() => { setCustomerId(c.id); setChannel((c.channel as OrderChannel) ?? "whatsapp"); }}
                            className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent/30 transition border-b border-border last:border-0"
                          >
                            <p className="text-foreground font-medium">{c.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {[c.phone, c.island, c.channel].filter(Boolean).join(" · ")}
                            </p>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 border border-dashed border-border text-muted-foreground hover:text-foreground"
                      onClick={() => setShowNewCustomer(true)}
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      New customer
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 border border-dashed border-border text-muted-foreground hover:text-foreground"
                      onClick={() => { setCustomerId("walkin"); setStep(2); }}
                    >
                      Walk-in (no account)
                    </Button>
                  </div>
                </>
              )}

              {/* New customer mini-form */}
              {showNewCustomer && !customerId && (
                <div className="rounded-xl border border-border p-4 space-y-3 bg-background/40">
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-primary" />
                    New Customer
                  </p>
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input autoFocus value={newCustName} onChange={(e) => setNewCustName(e.target.value)} placeholder="Full name or company" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input value={newCustPhone} onChange={(e) => setNewCustPhone(e.target.value)} placeholder="+960…" inputMode="tel" />
                    </div>
                    <div className="space-y-2">
                      <Label>Island</Label>
                      <Input value={newCustIsland} onChange={(e) => setNewCustIsland(e.target.value)} placeholder="Malé, Hulhumalé…" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Preferred channel</Label>
                    <Select value={newCustChannel} onValueChange={(v) => v && setNewCustChannel(v as CustomerChannel)}>
                      <SelectTrigger><SelectValue>{CUSTOMER_CHANNELS.find((c) => c.value === newCustChannel)?.label}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {CUSTOMER_CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setShowNewCustomer(false)}>Back</Button>
                    <Button size="sm" className="flex-1" onClick={handleCreateCustomer} disabled={savingCustomer || !newCustName.trim()}>
                      {savingCustomer ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save & Select"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Selected customer chip */}
              {customerId && customerId !== "walkin" && customer && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{customer.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {[customer.phone, customer.island, customer.channel].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <button onClick={() => { setCustomerId(""); setCustomerSearch(""); }} className="text-xs text-primary hover:opacity-80">Change</button>
                </div>
              )}
              {customerId === "walkin" && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Walk-in customer</p>
                    <p className="text-[11px] text-muted-foreground">No customer account</p>
                  </div>
                  <button onClick={() => setCustomerId("")} className="text-xs text-primary hover:opacity-80">Change</button>
                </div>
              )}

              {/* Order number + channel */}
              {(customerId) && (
                <div className="grid grid-cols-2 gap-3 pt-1">
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
              )}
            </div>
          )}

          {/* ── STEP 2: Products ─────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Godown picker at top */}
              <div className="space-y-2">
                <Label>Ship from warehouse *</Label>
                <Select value={godownId} onValueChange={(v) => v && setGodownId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick warehouse">
                      {godowns.find((g) => g.id === godownId)?.name ?? "Select…"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {godowns.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}{g.is_default ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Stock is checked and deducted from this warehouse.</p>
              </div>

              {/* Product picker */}
              <div className="space-y-2">
                <Label>Add a product</Label>
                {!selectedSkuId ? (
                  <>
                    <Input
                      value={skuSearch}
                      onChange={(e) => setSkuSearch(e.target.value)}
                      placeholder="Search brand, product, variant…"
                      autoComplete="off"
                    />
                    <div className="rounded-xl border border-border max-h-[200px] overflow-y-auto bg-background/50">
                      {filteredSkus.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-3 py-2">No products found.</p>
                      ) : (
                        filteredSkus.map((s) => {
                          const stock = godownId
                            ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0
                            : null;
                          return (
                            <button
                              key={s.id}
                              onClick={() => setSelectedSkuId(s.id)}
                              className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent/30 transition border-b border-border last:border-0"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-foreground font-medium">{s.brand_name} › {s.model_name}</p>
                                {stock !== null && (
                                  <span className={`text-[11px] shrink-0 ${stock > 0 ? "text-emerald-500" : "text-red-500"}`}>
                                    {stock} pcs
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground">{s.variant_display} · {s.pcs_per_pack}/pk × {s.packs_per_carton}/ctn</p>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </>
                ) : selectedSku ? (
                  <div className="rounded-xl border border-border p-3 space-y-3 bg-background/30">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{selectedSku.brand_name} › {selectedSku.model_name}</p>
                        <p className="text-[11px] text-muted-foreground">{selectedSku.variant_display} · {selectedSku.pcs_per_pack}/pk × {selectedSku.packs_per_carton}/ctn</p>
                        {stockHere !== null && (
                          <p className={`text-[11px] mt-0.5 ${stockHere === 0 ? "text-red-500" : "text-emerald-500"}`}>
                            In stock: {stockHere.toLocaleString()} pcs
                            {selectedSku.pcs_per_pack > 0 && stockHere > 0 && <> · {Math.floor(stockHere / selectedSku.pcs_per_pack)} packs</>}
                          </p>
                        )}
                      </div>
                      <button onClick={() => { setSelectedSkuId(""); setLineQty(""); setLinePrice(""); }} className="text-xs text-primary hover:opacity-80">Change</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Sell by</Label>
                        <Select value={lineUom} onValueChange={(v) => v && setLineUom(v as SaleUom)}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue>{lineUom}</SelectValue></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="carton">Carton</SelectItem>
                            <SelectItem value="pack">Pack</SelectItem>
                            <SelectItem value="piece">Piece</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Qty *</Label>
                        <Input
                          className="h-9 text-sm"
                          type="number"
                          inputMode="decimal"
                          step={lineUom === "piece" ? "1" : "0.5"}
                          min="1"
                          value={lineQty}
                          onChange={(e) => setLineQty(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs flex items-center gap-1">
                          Price (MVR)
                          {selectedSku && (
                            lineUom === "piece"  ? selectedSku.selling_price_per_piece_mvr :
                            lineUom === "pack"   ? selectedSku.selling_price_per_pack_mvr :
                            selectedSku.selling_price_per_carton_mvr
                          ) != null
                            ? <span className="text-emerald-500 text-[9px] uppercase tracking-wide">auto</span>
                            : <span className="text-amber-500 text-[9px] uppercase tracking-wide">manual</span>
                          }
                        </Label>
                        <Input
                          className="h-9 text-sm"
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          value={linePrice}
                          onChange={(e) => setLinePrice(e.target.value)}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    {selectedSku && lineQtyPieces > 0 && (
                      <div className="text-[11px] text-muted-foreground flex justify-between">
                        <span>= {lineQtyPieces.toLocaleString()} pieces</span>
                        <span className="text-foreground font-medium">{lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} MVR</span>
                      </div>
                    )}
                    {insufficient && (
                      <p className="text-[11px] text-red-500">⚠ Only {stockHere} pcs in this warehouse</p>
                    )}
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={handleAddLine}
                      disabled={!lineQty || !linePrice || lineQtyPieces <= 0 || insufficient}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Add to order
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Current lines */}
              {draftLines.length > 0 && (
                <div className="space-y-2">
                  <Label>Order items ({draftLines.length})</Label>
                  <div className="rounded-xl border border-border overflow-hidden">
                    {draftLines.map((l) => (
                      <div key={l.key} className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border last:border-0 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground truncate">{l.sku.brand_name} › {l.sku.model_name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {l.qty} {l.uom} · {l.unit_price_mvr.toLocaleString()} MVR/{l.uom}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-foreground font-medium text-xs">{l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR</span>
                          <button onClick={() => handleRemoveLine(l.key)} className="text-muted-foreground/60 hover:text-red-500 transition">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-between px-3 py-2 bg-secondary/30 text-sm font-medium">
                      <span className="text-muted-foreground">Total</span>
                      <span className="text-primary">{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Review ───────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="rounded-xl border border-border p-4 space-y-3 bg-background/30">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="text-foreground font-medium">{customerId === "walkin" ? "Walk-in" : (customer?.name ?? "—")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Order #</span>
                  <span className="text-foreground">{orderNumber}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Channel</span>
                  <span className="text-foreground">{CHANNELS.find((c) => c.value === channel)?.label}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Warehouse</span>
                  <span className="text-foreground">{godowns.find((g) => g.id === godownId)?.name ?? "—"}</span>
                </div>
              </div>
              <div className="rounded-xl border border-border overflow-hidden">
                {draftLines.map((l) => (
                  <div key={l.key} className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border last:border-0 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate">{l.sku.brand_name} › {l.sku.model_name} › {l.sku.variant_display}</p>
                      <p className="text-[11px] text-muted-foreground">{l.qty} {l.uom} · {l.unit_price_mvr.toLocaleString()} MVR/{l.uom}</p>
                    </div>
                    <span className="text-foreground font-medium text-xs shrink-0">{l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR</span>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2 bg-secondary/30 text-sm font-semibold">
                  <span className="text-muted-foreground">Total</span>
                  <span className="text-primary">{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Stock will be deducted when you confirm the order on the next screen.
              </p>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <DialogFooter className="flex-row gap-2 pt-2 border-t border-border">
          {step === 1 && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!customerId || !orderNumber.trim()}
                onClick={() => setStep(2)}
              >
                Next: Products <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button
                className="flex-1"
                disabled={draftLines.length === 0}
                onClick={() => setStep(3)}
              >
                Review order <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button
                className="flex-1"
                disabled={saving || draftLines.length === 0}
                onClick={handleSubmit}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create Sale
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

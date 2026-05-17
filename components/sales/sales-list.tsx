"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, Plus, Search, ShoppingCart, CheckCircle2,
  Clock, Truck, Package, XCircle, UserPlus, ChevronRight, Trash2,
  Banknote, Smartphone, ArrowRight, X,
} from "lucide-react";
import {
  listOrders, createOrder, nextOrderNumber, createOrderLine, postSale,
  type SalesOrderRow, type OrderStatus, type OrderChannel, type SaleUom,
} from "@/lib/queries/sales";
import {
  listCustomers, createCustomer, listGodowns,
  type CustomerRow, type CustomerChannel, type CustomerInput, type GodownRow,
} from "@/lib/queries/masters";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { listStockLevels, type StockLevel } from "@/lib/queries/inventory";
import { toPieces } from "@/lib/queries/sales";

// ── Styling constants ─────────────────────────────────────────────────────────

const CARD = {
  background: "var(--glass-1)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
} as const;

const CARD_L2 = {
  background: "var(--glass-2)",
  backdropFilter: "blur(30px)",
  WebkitBackdropFilter: "blur(30px)",
} as const;

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft", confirmed: "Confirmed", picked: "Picked",
  out_for_delivery: "Out for Delivery", delivered: "Delivered", cancelled: "Cancelled",
};

const STATUS_COLOR: Record<OrderStatus, { bg: string; text: string }> = {
  draft:            { bg: "var(--muted)",                   text: "var(--muted-foreground)" },
  confirmed:        { bg: "color-mix(in srgb, var(--snm-brand) 10%, transparent)", text: "var(--snm-brand)" },
  picked:           { bg: "color-mix(in srgb, var(--snm-warning) 15%, transparent)",  text: "var(--snm-warning)"      },
  out_for_delivery: { bg: "color-mix(in srgb, var(--snm-warning) 10%, transparent)",  text: "var(--snm-warning)"      },
  delivered:        { bg: "color-mix(in srgb, var(--snm-success) 15%, transparent)",  text: "var(--snm-success)"      },
  cancelled:        { bg: "color-mix(in srgb, var(--snm-error) 10%, transparent)",    text: "var(--snm-error)"        },
};

const STATUS_ICON: Record<OrderStatus, typeof Clock> = {
  draft: Clock, confirmed: CheckCircle2, picked: Package,
  out_for_delivery: Truck, delivered: CheckCircle2, cancelled: XCircle,
};

const CHANNELS: { value: OrderChannel; label: string }[] = [
  { value: "whatsapp",  label: "WhatsApp"  },
  { value: "viber",     label: "Viber"     },
  { value: "messenger", label: "Messenger" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok",    label: "TikTok"    },
  { value: "facebook",  label: "Facebook"  },
  { value: "phone",     label: "Phone"     },
  { value: "walkin",    label: "Walk-in"   },
  { value: "other",     label: "Other"     },
];

const CUSTOMER_CHANNELS = CHANNELS as { value: CustomerChannel; label: string }[];

type PaymentMethod = "bank_transfer" | "cod";

interface DraftLine {
  key: string;
  sku: SkuFullRow;
  uom: SaleUom;
  qty: number;
  qty_pieces: number;
  unit_price_mvr: number;
  line_total_mvr: number;
}

// ── UOM intelligence ──────────────────────────────────────────────────────────
// Derives a human label for what a "pack" actually is for this SKU.
// The SaleUom value stays "pack" in the DB — only the display word changes.

function packLabel(sku: SkuFullRow): string {
  const fmt = String(sku.attributes?.format ?? "").toLowerCase();
  if (fmt === "bottle")  return "Bottle";
  if (fmt === "pouch")   return "Pouch";
  if (fmt === "sachet")  return "Sachet";
  if (fmt === "jar")     return "Jar";
  if (fmt === "can")     return "Can";
  if (fmt === "tube")    return "Tube";
  if (fmt === "box")     return "Box";
  // Fall back to unit_uom hint
  if (sku.unit_uom === "ml") return "Bottle";
  if (sku.unit_uom === "g")  return "Pouch";
  return "Pack";
}

// Default UOM for a SKU: liquids/powder sell by carton (master carton),
// diapers/unit goods sell by pack (single retail pack).
function defaultUom(sku: SkuFullRow): SaleUom {
  if (sku.unit_uom === "ml" || sku.unit_uom === "g") return "carton";
  return "pack";
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function GlassInput({ label, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <input
        {...props}
        className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground transition"
        style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}
      />
    </div>
  );
}

function GlassSelect({ label, value, onChange, children }: {
  label?: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none appearance-none"
        style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}
      >
        {children}
      </select>
    </div>
  );
}

// ── SalesList ─────────────────────────────────────────────────────────────────

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
        listOrders(), listCustomers(), listSkusFlat(), listGodowns(), listStockLevels(),
      ]);
      setRows(o); setCustomers(c); setSkus(sk); setGodowns(g); setStockLevels(lvl);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    const term = q.trim().toLowerCase();
    if (term) r = r.filter((x) => {
      const cust = customers.find((c) => c.id === x.customer_id);
      return [x.order_number, cust?.name ?? "", cust?.phone ?? ""].join(" ").toLowerCase().includes(term);
    });
    return r;
  }, [rows, q, statusFilter, customers]);

  if (loading) return (
    <div className="rounded-2xl p-12 flex flex-col items-center" style={{ ...CARD, color: "var(--muted-foreground)" }}>
      <Loader2 className="h-6 w-6 animate-spin mb-3" /><p className="text-sm">Loading…</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Operations</p>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Sales</h1>
        </div>
        <button
          onClick={() => setNewDialog(true)}
          className="flex items-center gap-2 h-11 px-5 rounded-2xl text-sm font-semibold transition active:scale-95"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          <Plus className="h-4 w-4" /> New Sale
        </button>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-3 rounded-2xl px-4 h-12" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" />
          {q && (
            <button onClick={() => setQ("")} className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-opacity hover:opacity-70"
              style={{ background: "color-mix(in srgb, var(--foreground) 12%, transparent)", color: "var(--muted-foreground)" }}>
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-12 rounded-2xl px-4 text-sm text-foreground outline-none appearance-none"
          style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
          <option value="all">All</option>
          {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl p-10 flex flex-col items-center text-center space-y-3" style={CARD}>
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
            <ShoppingCart className="h-6 w-6 text-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">{rows.length === 0 ? "No sales yet" : "No matches"}</h3>
          <p className="text-sm max-w-sm" style={{ color: "var(--muted-foreground)" }}>
            {rows.length === 0 ? "Record a sale when a customer messages you on WhatsApp, Viber, or other channels." : "Try a different filter."}
          </p>
          {rows.length === 0 && (
            <button onClick={() => setNewDialog(true)} className="mt-2 h-11 px-6 rounded-2xl text-sm font-semibold"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              Record first sale
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((o) => {
            const Icon = STATUS_ICON[o.status];
            const cust = customers.find((c) => c.id === o.customer_id);
            const colors = STATUS_COLOR[o.status];
            return (
              <Link key={o.id} href={`/sales/${o.id}`}
                className="flex items-center justify-between gap-3 p-4 rounded-2xl transition-opacity hover:opacity-90"
                style={CARD}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: colors.bg, color: colors.text }}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-foreground">
                      {cust?.name ?? "Walk-in"}
                      <span className="text-[11px] ml-2" style={{ color: "var(--muted-foreground)" }}>{o.order_number}</span>
                    </p>
                    <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>
                      via {o.channel}{cust?.island && <> · {cust.island}</>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] uppercase tracking-widest font-semibold rounded-lg px-2.5 py-1" style={{ background: colors.bg, color: colors.text }}>
                    {STATUS_LABEL[o.status]}
                  </span>
                  <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {newDialog && (
        <NewSaleSheet
          customers={customers} skus={skus} godowns={godowns}
          stockLevels={stockLevels} existingOrders={rows}
          onClose={() => setNewDialog(false)}
          onCreated={(id) => { setNewDialog(false); load(); router.push(`/sales/${id}`); }}
          onCustomerCreated={(c) => setCustomers((prev) => [c, ...prev])}
        />
      )}
    </div>
  );
}

// ── NewSaleSheet ──────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

function NewSaleSheet({
  customers, skus, godowns, stockLevels, existingOrders, onClose, onCreated, onCustomerCreated,
}: {
  customers: CustomerRow[]; skus: SkuFullRow[]; godowns: GodownRow[];
  stockLevels: StockLevel[]; existingOrders: SalesOrderRow[];
  onClose: () => void; onCreated: (id: string) => void;
  onCustomerCreated: (c: CustomerRow) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [orderNumber] = useState(nextOrderNumber(existingOrders));
  const [channel, setChannel] = useState<OrderChannel>("whatsapp");

  // Step 1 — customer
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustIsland, setNewCustIsland] = useState("");
  const [newCustChannel, setNewCustChannel] = useState<CustomerChannel>("whatsapp");
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Step 2 — products
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [skuSearch, setSkuSearch] = useState("");
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [lineUom, setLineUom] = useState<SaleUom>("pack");
  const [lineQty, setLineQty] = useState("");
  const [linePrice, setLinePrice] = useState("");
  const [godownId, setGodownId] = useState(() => (godowns.find((g) => g.is_default) ?? godowns[0])?.id ?? "");

  // Step 3 — payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [orderNotes, setOrderNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const customer = customers.find((c) => c.id === customerId);
  const selectedSku = skus.find((s) => s.id === selectedSkuId);

  // ── Recent customers from localStorage (IDEO: Recents first) ──
  // Store the last 3 used customer IDs so repeat orders need zero search.
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("snm_recent_customers") ?? "[]"); }
    catch { return []; }
  });
  function touchRecentCustomer(id: string) {
    const next = [id, ...recentIds.filter((x) => x !== id)].slice(0, 3);
    setRecentIds(next);
    try { localStorage.setItem("snm_recent_customers", JSON.stringify(next)); } catch { /* ignore */ }
  }
  const recentCustomers = useMemo(() => {
    const pinned = recentIds.map((id) => customers.find((c) => c.id === id)).filter(Boolean) as CustomerRow[];
    // Fill remaining slots from the head of the list so there's always something to show
    const rest = customers.filter((c) => !recentIds.includes(c.id)).slice(0, Math.max(0, 5 - pinned.length));
    return [...pinned, ...rest].slice(0, 5);
  }, [customers, recentIds]);
  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return [];
    return customers.filter((c) => [c.name, c.phone ?? "", c.island ?? ""].join(" ").toLowerCase().includes(term)).slice(0, 10);
  }, [customers, customerSearch]);

  const filteredSkus = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    if (!term) return active.slice(0, 40);
    return active.filter((s) => [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""].join(" ").toLowerCase().includes(term)).slice(0, 40);
  }, [skus, skuSearch]);

  const stockHere = selectedSku && godownId
    ? stockLevels.find((l) => l.sku_id === selectedSku.id && l.godown_id === godownId)?.qty_pieces ?? 0
    : null;

  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);

  function autoPrice(sku: typeof selectedSku, uom: SaleUom): string {
    if (!sku) return "";
    const p = uom === "piece" ? sku.selling_price_per_piece_mvr
      : uom === "pack" ? sku.selling_price_per_pack_mvr
      : sku.selling_price_per_carton_mvr;
    return p != null ? p.toFixed(2) : "";
  }

  // When a new SKU is selected: set smart default UOM, then auto-fill price
  useEffect(() => {
    if (!selectedSku) return;
    const smartUom = defaultUom(selectedSku);
    setLineUom(smartUom);
    setLinePrice(autoPrice(selectedSku, smartUom));
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkuId]);

  // When UOM changes (user picks a different one): re-fill price
  useEffect(() => {
    if (!selectedSku) return;
    setLinePrice(autoPrice(selectedSku, lineUom));
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineUom]);

  function handlePriceChange(raw: string) {
    if (raw === "") {
      // User cleared the field — restore auto price if available
      const ap = autoPrice(selectedSku, lineUom);
      if (ap) {
        setLinePrice(ap);
        setPriceManuallyEdited(false);
      } else {
        setLinePrice("");
        setPriceManuallyEdited(false);
      }
    } else {
      setLinePrice(raw);
      setPriceManuallyEdited(raw !== autoPrice(selectedSku, lineUom));
    }
  }

  const lineQtyPieces = useMemo(() => {
    if (!selectedSku || !lineQty) return 0;
    const n = parseFloat(lineQty);
    if (isNaN(n) || n <= 0) return 0;
    return toPieces(lineUom, n, selectedSku.pcs_per_pack, selectedSku.packs_per_carton);
  }, [selectedSku, lineQty, lineUom]);

  const lineTotal = useMemo(() => {
    const q = parseFloat(lineQty); const p = parseFloat(linePrice);
    if (isNaN(q) || isNaN(p)) return 0;
    return q * p;
  }, [lineQty, linePrice]);

  const insufficient = stockHere !== null && lineQtyPieces > stockHere;
  const grandTotal = useMemo(() => draftLines.reduce((s, l) => s + l.line_total_mvr, 0), [draftLines]);

  async function handleCreateCustomer() {
    if (!newCustName.trim()) return;
    setSavingCustomer(true);
    try {
      const input: CustomerInput = { name: newCustName.trim(), phone: newCustPhone.trim() || null, island: newCustIsland.trim() || null, channel: newCustChannel };
      const created = await createCustomer(input);
      onCustomerCreated(created as CustomerRow);
      setCustomerId(created.id);
      setChannel(newCustChannel as OrderChannel);
      setShowNewCustomer(false);
    } catch (err) { toast.error((err as Error).message); }
    finally { setSavingCustomer(false); }
  }

  function handleAddLine() {
    if (!selectedSku || !lineQty || !linePrice || lineQtyPieces <= 0) return;
    setDraftLines((prev) => [...prev, {
      key: `${selectedSku.id}-${Date.now()}`,
      sku: selectedSku, uom: lineUom, qty: parseFloat(lineQty),
      qty_pieces: lineQtyPieces, unit_price_mvr: parseFloat(linePrice), line_total_mvr: lineTotal,
    }]);
    setSelectedSkuId(""); setSkuSearch(""); setLineQty(""); setLinePrice(""); setLineUom("pack"); setPriceManuallyEdited(false);
  }

  // Create order + lines + immediately confirm (post_sale) in one shot
  async function handleSubmit() {
    if (draftLines.length === 0) return;
    setSaving(true);
    try {
      const cust = customers.find((c) => c.id === customerId);
      const created = await createOrder({
        order_number: orderNumber,
        customer_id: customerId && customerId !== "walkin" ? customerId : null,
        channel: cust?.channel ?? channel,
        status: "draft",
        source_godown_id: godownId || null,
        payment_method: paymentMethod,
        payment_status: paymentMethod === "cod" ? "pending" : "pending",
        notes: orderNotes.trim() || null,
      });
      await Promise.all(draftLines.map((l) => createOrderLine({
        order_id: created.id, sku_id: l.sku.id, uom: l.uom, qty: l.qty,
        qty_pieces: l.qty_pieces, unit_price_mvr: l.unit_price_mvr, line_total_mvr: l.line_total_mvr,
      })));
      // Confirm stock immediately
      await postSale(created.id);
      toast.success("Order placed — stock deducted");
      onCreated(created.id);
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  const stepLabels: Record<Step, string> = { 1: "Customer", 2: "Products", 3: "Confirm" };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--background)" }}>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 h-16 snm-topbar">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-foreground opacity-60 hover:opacity-100 transition text-xl">✕</button>
          <span className="text-[18px] font-bold text-foreground tracking-tight">New Sale</span>
        </div>
        <span className="text-[12px] font-mono" style={{ color: "var(--muted-foreground)" }}>{orderNumber}</span>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pt-20 pb-28 px-5 space-y-5">

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-all"
                style={step === s ? { background: "var(--foreground)", color: "var(--background)" }
                  : step > s ? { background: "color-mix(in srgb, var(--snm-success) 20%, transparent)", color: "var(--snm-success)" }
                  : { background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                {step > s ? "✓" : s}
              </div>
              <span className="text-[11px]" style={{ color: step === s ? "var(--foreground)" : "var(--muted-foreground)" }}>{stepLabels[s]}</span>
              {s < 3 && <div className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>

        {/* ── Step 1: Customer ── */}
        {step === 1 && (
          <div className="space-y-4">
            {!customerId && !showNewCustomer && (
              <>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-3 rounded-xl px-4 h-12" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
                    <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                    <input autoFocus value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Search name, phone…"
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" />
                    {customerSearch && (
                      <button onClick={() => setCustomerSearch("")}
                        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-opacity hover:opacity-70"
                        style={{ background: "color-mix(in srgb, var(--foreground) 12%, transparent)", color: "var(--muted-foreground)" }}>
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <button onClick={() => setShowNewCustomer(true)}
                    className="flex items-center gap-1.5 h-12 px-4 rounded-xl text-sm font-semibold transition"
                    style={{ ...CARD, border: "1px solid var(--glass-border-lo)", color: "var(--foreground)" }}>
                    <UserPlus className="h-4 w-4" /> New
                  </button>
                </div>

                <div>
                  {/* Pinned recent chips — 1-tap reselect for repeat orders */}
                  {!customerSearch.trim() && recentIds.length > 0 && (
                    <div className="flex gap-2 mb-3 flex-wrap">
                      {recentIds.map((id) => {
                        const rc = customers.find((c) => c.id === id);
                        if (!rc) return null;
                        return (
                          <button
                            key={id}
                            onClick={() => { setCustomerId(id); setChannel((rc.channel as OrderChannel) ?? "whatsapp"); touchRecentCustomer(id); }}
                            className="flex items-center gap-2 px-3 h-9 rounded-full text-[13px] font-semibold transition active:scale-95"
                            style={{
                              background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--snm-brand) 25%, transparent)",
                              color: "var(--snm-brand)",
                            }}
                          >
                            ★ {rc.name.split(" ")[0]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[11px] uppercase tracking-widest mb-3 font-medium" style={{ color: "var(--muted-foreground)" }}>
                    {customerSearch.trim() ? "Results" : "All Customers"}
                  </p>
                  <div className="space-y-1.5">
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).map((c) => {
                      const initials = c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                      return (
                        <button key={c.id}
                          onClick={() => { setCustomerId(c.id); setChannel((c.channel as OrderChannel) ?? "whatsapp"); touchRecentCustomer(c.id); }}
                          className="w-full flex items-center gap-3 px-4 h-14 rounded-xl text-left transition active:scale-[0.99]"
                          style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
                          <div className="h-9 w-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-semibold text-foreground truncate">{c.name}</p>
                            <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>{[c.island, c.channel].filter(Boolean).join(" · ")}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                        </button>
                      );
                    })}
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).length === 0 && (
                      <p className="text-sm py-4 text-center" style={{ color: "var(--muted-foreground)" }}>
                        {customerSearch.trim() ? "No matches." : "No customers yet."}
                      </p>
                    )}
                  </div>
                </div>

                <button onClick={() => setCustomerId("walkin")}
                  className="w-full h-12 rounded-xl text-sm font-semibold transition"
                  style={{ ...CARD, border: "1px solid var(--glass-border)", color: "var(--muted-foreground)" }}>
                  Walk-in / No account
                </button>
              </>
            )}

            {showNewCustomer && !customerId && (
              <div className="rounded-xl p-5 space-y-4" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
                <p className="text-[13px] font-bold text-foreground flex items-center gap-2"><UserPlus className="h-4 w-4" /> New Customer</p>
                <GlassInput label="Name *" value={newCustName} onChange={(e) => setNewCustName((e.target as HTMLInputElement).value)} placeholder="Full name or company" autoFocus />
                <div className="grid grid-cols-2 gap-3">
                  <GlassInput label="Phone" value={newCustPhone} onChange={(e) => setNewCustPhone((e.target as HTMLInputElement).value)} placeholder="+960…" inputMode="tel" />
                  <GlassInput label="Island" value={newCustIsland} onChange={(e) => setNewCustIsland((e.target as HTMLInputElement).value)} placeholder="Malé…" />
                </div>
                <GlassSelect label="Usually orders via" value={newCustChannel} onChange={(v) => setNewCustChannel(v as CustomerChannel)}>
                  {CUSTOMER_CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </GlassSelect>
                <div className="flex gap-2">
                  <button onClick={() => setShowNewCustomer(false)} className="flex-1 h-11 rounded-xl text-sm" style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}>Back</button>
                  <button onClick={handleCreateCustomer} disabled={savingCustomer || !newCustName.trim()}
                    className="flex-[2] h-11 rounded-xl text-sm font-bold transition disabled:opacity-40"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}>
                    {savingCustomer ? "Saving…" : "Save & Select"}
                  </button>
                </div>
              </div>
            )}

            {customerId && customerId !== "walkin" && customer && (
              <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: "var(--glass-bg-2)", border: "1px solid var(--glass-border)" }}>
                <div>
                  <p className="text-[14px] font-semibold text-foreground">{customer.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{[customer.phone, customer.island, customer.channel].filter(Boolean).join(" · ")}</p>
                </div>
                <button onClick={() => { setCustomerId(""); setCustomerSearch(""); }} className="text-[11px] text-foreground opacity-60 hover:opacity-100">Change</button>
              </div>
            )}
            {customerId === "walkin" && (
              <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: "var(--glass-bg-2)", border: "1px solid var(--glass-border)" }}>
                <div>
                  <p className="text-[14px] font-semibold text-foreground">Walk-in customer</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>No account</p>
                </div>
                <button onClick={() => setCustomerId("")} className="text-[11px] text-foreground opacity-60 hover:opacity-100">Change</button>
              </div>
            )}

            {customerId && (
              <GlassSelect label="Order received via" value={channel} onChange={(v) => setChannel(v as OrderChannel)}>
                {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </GlassSelect>
            )}
          </div>
        )}

        {/* ── Step 2: Products ── */}
        {step === 2 && (
          <div className="space-y-4">
            <GlassSelect label="Ship from warehouse" value={godownId} onChange={setGodownId}>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}{g.is_default ? " (default)" : ""}</option>)}
            </GlassSelect>

            {/* Product picker */}
            {!selectedSkuId ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-xl px-4 h-12" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
                  <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                  <input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)}
                    placeholder="Search brand, product, variant…"
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" autoComplete="off" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {filteredSkus.map((s) => {
                    const stock = godownId ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0 : null;
                    const pl = packLabel(s);
                    // Show price per default UOM on the card
                    const cardUom = defaultUom(s);
                    const cardPrice = cardUom === "carton" ? s.selling_price_per_carton_mvr : s.selling_price_per_pack_mvr;
                    const cardUomLabel = cardUom === "carton" ? "carton" : pl.toLowerCase();
                    const hasPrice = cardPrice != null;
                    const inCart = draftLines.filter((l) => l.sku.id === s.id).reduce((a, l) => a + l.qty, 0);

                    // Work & Co: quick-add adds 1 unit of the default UOM directly to cart.
                    // Tapping the card body still opens the detail editor for custom qty/price.
                    function handleQuickAdd(e: React.MouseEvent) {
                      e.stopPropagation();
                      if (!hasPrice || (stock != null && stock <= 0)) return;
                      const qty = 1;
                      const pcs = toPieces(cardUom, qty, s.pcs_per_pack, s.packs_per_carton);
                      setDraftLines((prev) => [...prev, {
                        key: `${s.id}-${Date.now()}`,
                        sku: s, uom: cardUom, qty,
                        qty_pieces: pcs,
                        unit_price_mvr: cardPrice!,
                        line_total_mvr: cardPrice!,
                      }]);
                      toast.success(`${s.brand_name} ${s.variant_display} added`);
                    }

                    return (
                      <div key={s.id} className="relative">
                        <button onClick={() => setSelectedSkuId(s.id)}
                          className="w-full rounded-xl p-4 text-left transition active:scale-[0.98]"
                          style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1 pr-8">
                              <p className="text-[13px] font-semibold text-foreground truncate">{s.brand_name} · {s.model_name}</p>
                              <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>{s.variant_display}</p>
                            </div>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
                              style={{ background: stock != null && stock > 0 ? "color-mix(in srgb, var(--snm-success) 12%, transparent)" : "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: stock != null && stock > 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                              {stock != null ? `${stock} pcs` : "—"}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-1">
                            <div className="flex items-baseline gap-1">
                              <span className="text-[20px] font-semibold" style={{ color: hasPrice ? "var(--foreground)" : "var(--muted-foreground)" }}>
                                {hasPrice ? cardPrice!.toFixed(2) : "No GRN"}
                              </span>
                              {hasPrice && <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>MVR / {cardUomLabel}</span>}
                            </div>
                            {inCart > 0 && (
                              <span className="text-[11px] font-bold" style={{ color: "var(--snm-brand)" }}>
                                ×{inCart} in cart
                              </span>
                            )}
                          </div>
                        </button>
                        {/* Quick-add button — Work & Co progressive disclosure:
                            tap + to add 1 unit instantly; tap card to customise */}
                        {hasPrice && stock !== 0 && (
                          <button
                            onClick={handleQuickAdd}
                            className="absolute bottom-3 right-3 h-8 w-8 rounded-full flex items-center justify-center transition active:scale-90"
                            style={{
                              background: "var(--foreground)",
                              color: "var(--background)",
                              fontSize: 18,
                              fontWeight: 700,
                              lineHeight: 1,
                            }}
                            aria-label={`Quick add ${s.brand_name} ${s.variant_display}`}
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {filteredSkus.length === 0 && <p className="text-sm col-span-2 py-4" style={{ color: "var(--muted-foreground)" }}>No products found.</p>}
                </div>
              </div>
            ) : selectedSku ? (
              <div className="rounded-xl p-4 space-y-4" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[14px] font-semibold text-foreground">{selectedSku.brand_name} · {selectedSku.model_name}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{selectedSku.variant_display}</p>
                    {stockHere !== null && (
                      <p className="text-[11px] mt-1 font-semibold" style={{ color: stockHere === 0 ? "var(--snm-error)" : "var(--snm-success)" }}>
                        {stockHere === 0 ? "Out of stock" : `${stockHere.toLocaleString()} pcs in warehouse`}
                      </p>
                    )}
                  </div>
                  <button onClick={() => { setSelectedSkuId(""); setLineQty(""); setLinePrice(""); setPriceManuallyEdited(false); }} className="text-[11px] text-foreground opacity-60 hover:opacity-100">Change</button>
                </div>

                {/* Context-aware cost + margin pill */}
                {selectedSku.landed_per_piece_mvr != null && (() => {
                  const landed = selectedSku.landed_per_piece_mvr!;
                  const costForUom = lineUom === "piece" ? landed
                    : lineUom === "pack" ? landed * selectedSku.pcs_per_pack
                    : landed * selectedSku.pcs_per_pack * selectedSku.packs_per_carton;
                  const uomLabel = lineUom === "piece" ? "pc" : lineUom === "pack" ? packLabel(selectedSku).toLowerCase() : "carton";
                  const priceVal = parseFloat(linePrice);
                  const margin = (!isNaN(priceVal) && priceVal > 0 && costForUom > 0)
                    ? ((priceVal - costForUom) / priceVal) * 100
                    : null;
                  return (
                    <div className="rounded-xl px-3 py-2.5 flex items-center justify-between gap-4"
                      style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)", border: "1px solid var(--glass-border-lo)" }}>
                      <div>
                        <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>
                          Cost / {uomLabel}
                        </p>
                        <p className="text-[13px] font-semibold text-foreground">
                          MVR {costForUom.toFixed(lineUom === "piece" ? 4 : 2)}
                        </p>
                      </div>
                      {margin !== null && (
                        <div className="text-right">
                          <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>Margin</p>
                          <p className="text-[17px] font-bold leading-none"
                            style={{ color: margin >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                            {margin.toFixed(1)}%
                          </p>
                          {margin < 0 && (
                            <p className="text-[9px] mt-0.5" style={{ color: "var(--snm-error)" }}>below cost</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* No-GRN warning — shown when there's no landed cost yet */}
                {selectedSku.landed_per_piece_mvr == null && (
                  <div className="rounded-xl px-3 py-2.5 flex items-center gap-3"
                    style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)" }}>
                    <span className="text-base">⚠️</span>
                    <div>
                      <p className="text-[12px] font-semibold" style={{ color: "var(--snm-warning)" }}>No confirmed shipment yet</p>
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Confirm a GRN for this product first — selling price will auto-fill from landed cost.</p>
                    </div>
                  </div>
                )}

                {(() => {
                  const pl = packLabel(selectedSku);
                  const uomLabel = lineUom === "carton" ? "Carton" : lineUom === "piece" ? "Piece" : pl;
                  const hasNoPrice = !linePrice && selectedSku.landed_per_piece_mvr != null;
                  return (
                    <div className="grid grid-cols-3 gap-2">
                      <GlassSelect label={`Sell by · ${lineUom === "pack" ? pl : lineUom === "carton" ? "Carton" : "Piece"}`} value={lineUom} onChange={(v) => setLineUom(v as SaleUom)}>
                        <option value="carton">Carton ({selectedSku.packs_per_carton} {pl}s)</option>
                        <option value="pack">{pl}</option>
                        <option value="piece">Piece ({selectedSku.pcs_per_pack}/{pl})</option>
                      </GlassSelect>
                      <GlassInput label={`Qty · ${uomLabel}s`} type="number" inputMode="decimal" min="1" value={lineQty} onChange={(e) => setLineQty((e.target as HTMLInputElement).value)} placeholder="0" autoFocus />
                      <div className="space-y-1.5">
                        <p className="text-[11px] uppercase tracking-widest font-medium flex items-center gap-1" style={{ color: "var(--muted-foreground)" }}>
                          MVR / {uomLabel}
                          {linePrice && !priceManuallyEdited
                            ? <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "color-mix(in srgb, var(--snm-success) 15%, transparent)", color: "var(--snm-success)" }}>AUTO</span>
                            : linePrice && priceManuallyEdited
                              ? <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "color-mix(in srgb, var(--snm-warning) 15%, transparent)", color: "var(--snm-warning)" }}>MANUAL</span>
                              : null}
                        </p>
                        <input type="number" inputMode="decimal" step="0.01" min="0" value={linePrice}
                          onChange={(e) => handlePriceChange((e.target as HTMLInputElement).value)}
                          placeholder={hasNoPrice ? "Enter price" : "0.00"}
                          className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none"
                          style={{ ...CARD, border: hasNoPrice ? "1px solid color-mix(in srgb, var(--snm-warning) 40%, transparent)" : "1px solid var(--glass-border-lo)" }} />
                      </div>
                    </div>
                  );
                })()}

                {lineQtyPieces > 0 && (
                  <div className="flex justify-between text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                    <span>= {lineQtyPieces.toLocaleString()} pcs total</span>
                    <span className="text-foreground font-semibold text-[14px]">MVR {lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                {insufficient && <p className="text-[11px]" style={{ color: "var(--snm-error)" }}>⚠ Only {stockHere} pcs available in this warehouse</p>}
                <button onClick={handleAddLine} disabled={!lineQty || !linePrice || lineQtyPieces <= 0 || insufficient}
                  className="w-full h-11 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background: "var(--foreground)", color: "var(--background)" }}>
                  <Plus className="h-4 w-4" /> Add to Order
                </button>
              </div>
            ) : null}

            {/* Draft lines */}
            {draftLines.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
                <p className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
                  Order items · {draftLines.length}
                </p>
                {draftLines.map((l) => {
                  const pl = packLabel(l.sku);
                  const uomWord = l.uom === "carton" ? "carton" : l.uom === "piece" ? "pc" : pl.toLowerCase();
                  return (
                  <div key={l.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm" style={{ borderTop: "1px solid var(--glass-border-lo)" }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate">{l.sku.brand_name} · {l.sku.model_name}</p>
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{l.qty} {uomWord} · MVR {l.unit_price_mvr.toLocaleString()}/{uomWord}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-foreground font-semibold text-[13px]">MVR {l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      <button onClick={() => setDraftLines((p) => p.filter((x) => x.key !== l.key))} className="opacity-40 hover:opacity-100 transition">
                        <Trash2 className="h-3.5 w-3.5 text-foreground" />
                      </button>
                    </div>
                  </div>
                  );
                })}
                <div className="flex justify-between px-4 py-3 text-sm font-semibold" style={{ borderTop: "1px solid var(--glass-border-lo)", background: "var(--glass-bg-1)" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>Total</span>
                  <span className="text-foreground">MVR {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Confirm + Payment ── */}
        {step === 3 && (
          <div className="space-y-4">

            {/* Order total hero */}
            <div className="rounded-2xl p-5" style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }}>
              <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Order Total</p>
              <p className="text-[36px] font-light tracking-tight text-foreground leading-none mb-1">
                {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="text-[16px] ml-1.5" style={{ color: "var(--muted-foreground)" }}>MVR</span>
              </p>
              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                {draftLines.length} item{draftLines.length !== 1 ? "s" : ""} · {customerId === "walkin" ? "Walk-in" : (customer?.name ?? "—")} · via {CHANNELS.find((c) => c.value === channel)?.label}
              </p>
            </div>

            {/* Line items */}
            <div className="rounded-xl overflow-hidden" style={CARD}>
              {draftLines.map((l, i) => {
                const pl = packLabel(l.sku);
                const uomWord = l.uom === "carton" ? "carton" : l.uom === "piece" ? "pc" : pl.toLowerCase();
                return (
                  <div key={l.key} className="flex items-center justify-between gap-2 px-4 py-3 text-sm" style={{ borderBottom: i < draftLines.length - 1 ? "1px solid var(--glass-border-lo)" : "none" }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate">{l.sku.brand_name} · {l.sku.model_name} · {l.sku.variant_display}</p>
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{l.qty} {uomWord} · MVR {l.unit_price_mvr.toLocaleString()}/{uomWord}</p>
                    </div>
                    <span className="text-foreground font-semibold text-[13px] shrink-0">MVR {l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                );
              })}
            </div>

            {/* Payment method */}
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>How will the customer pay?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod("bank_transfer")}
                  className="rounded-xl p-4 text-left transition active:scale-95 space-y-2"
                  style={{ ...CARD, border: paymentMethod === "bank_transfer" ? "2px solid var(--foreground)" : "1px solid var(--glass-border-lo)" }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
                    <Smartphone className="h-4 w-4 text-foreground" />
                  </div>
                  <p className="text-[13px] font-semibold text-foreground">Bank Transfer</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>They send payment slip via WhatsApp / Viber</p>
                </button>
                <button
                  onClick={() => setPaymentMethod("cod")}
                  className="rounded-xl p-4 text-left transition active:scale-95 space-y-2"
                  style={{ ...CARD, border: paymentMethod === "cod" ? "2px solid var(--foreground)" : "1px solid var(--glass-border-lo)" }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
                    <Banknote className="h-4 w-4 text-foreground" />
                  </div>
                  <p className="text-[13px] font-semibold text-foreground">Cash on Delivery</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Driver collects cash, hands it to you</p>
                </button>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>Delivery notes (optional)</p>
              <textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="e.g. Leave at the gate, call before arriving…"
                rows={2}
                className="w-full px-4 py-3 rounded-xl text-sm text-foreground outline-none resize-none"
                style={{ ...CARD, border: "1px solid var(--glass-border-lo)" }} />
            </div>

            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              Placing this order will immediately deduct stock from the warehouse.
            </p>
          </div>
        )}
      </div>

      {/* Fixed bottom actions */}
      <footer className="fixed bottom-0 left-0 right-0 flex items-center gap-3 px-5 h-24 snm-bottom-nav">
        {step === 1 && (
          <>
            <button onClick={onClose} className="flex-1 h-14 rounded-xl text-sm font-semibold" style={{ ...CARD, border: "1px solid var(--glass-border-lo)", color: "var(--foreground)" }}>Cancel</button>
            <button disabled={!customerId} onClick={() => setStep(2)}
              className="flex-[2] h-14 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              Add Products <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <button onClick={() => setStep(1)} className="flex-1 h-14 rounded-xl text-sm font-semibold" style={{ ...CARD, border: "1px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
            <button disabled={draftLines.length === 0} onClick={() => setStep(3)}
              className="flex-[2] h-14 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              {draftLines.length === 0 ? "Add at least 1 item" : <>Review & Confirm <ArrowRight className="h-4 w-4" /></>}
            </button>
          </>
        )}
        {step === 3 && (
          <>
            <button onClick={() => setStep(2)} className="flex-1 h-14 rounded-xl text-sm font-semibold" style={{ ...CARD, border: "1px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
            <button disabled={saving} onClick={handleSubmit}
              className="flex-[2] h-14 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Place Order <ArrowRight className="h-4 w-4" /></>}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

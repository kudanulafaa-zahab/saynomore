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
  History,
} from "lucide-react";
import {
  listOrders,
  createOrder,
  nextOrderNumber,
  createOrderLine,
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
import { toPieces } from "@/lib/queries/sales";

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

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  picked: "Picked",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<OrderStatus, { bg: string; text: string }> = {
  draft:            { bg: "rgba(255,255,255,0.06)",    text: "#8e9192"  },
  confirmed:        { bg: "rgba(255,255,255,0.10)",    text: "#ffffff"  },
  picked:           { bg: "rgba(251,146,60,0.15)",     text: "#fb923c" },
  out_for_delivery: { bg: "rgba(196,199,200,0.12)",    text: "#c4c7c8"  },
  delivered:        { bg: "rgba(74,222,128,0.15)",     text: "#4ade80" },
  cancelled:        { bg: "rgba(255,180,171,0.12)",    text: "#ffb4ab" },
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

interface DraftLine {
  key: string;
  sku: SkuFullRow;
  uom: SaleUom;
  qty: number;
  qty_pieces: number;
  unit_price_mvr: number;
  line_total_mvr: number;
}

// ── Tiny glass input helper ───────────────────────────────────────────────────

function GlassInput({ label, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      {label && <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <input
        {...props}
        className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none placeholder:text-[#444748] transition"
        style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
      />
    </div>
  );
}

function GlassSelect({ label, value, onChange, children }: { label?: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-xl px-4 text-sm text-foreground outline-none appearance-none"
        style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
      >
        {children}
      </select>
    </div>
  );
}

// ── SalesList ────────────────────────────────────────────────────────────────

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
          .join(" ").toLowerCase().includes(term);
      });
    }
    return r;
  }, [rows, q, statusFilter, customers]);

  if (loading) {
    return (
      <div className="rounded-2xl p-12 flex flex-col items-center" style={{ ...CARD, color: "var(--muted-foreground)" }}>
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="label-caps text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>Operations</p>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">Sales</h1>
        </div>
        <button
          onClick={() => setNewDialog(true)}
          className="flex items-center gap-2 h-11 px-5 rounded-2xl text-sm font-semibold transition active:scale-95"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          <Plus className="h-4 w-4" />
          New Sale
        </button>
      </div>

      {/* ── Search + Filter ── */}
      <div className="flex gap-2">
        <div
          className="flex-1 flex items-center gap-3 rounded-2xl px-4 h-12"
          style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search order, customer…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            inputMode="search"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-12 rounded-2xl px-4 text-sm text-foreground outline-none appearance-none"
          style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <option value="all">All</option>
          {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {/* ── List ── */}
      {filtered.length === 0 ? (
        <div
          className="rounded-2xl p-10 flex flex-col items-center text-center space-y-3"
          style={CARD}
        >
          <div
            className="h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <ShoppingCart className="h-6 w-6 text-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {rows.length === 0 ? "No sales yet" : "No matches"}
          </h3>
          <p className="text-sm max-w-sm" style={{ color: "var(--muted-foreground)" }}>
            {rows.length === 0
              ? "Record a sale when a customer messages you on WhatsApp, Viber, Instagram, etc."
              : "Try a different filter."}
          </p>
          {rows.length === 0 && (
            <button
              onClick={() => setNewDialog(true)}
              className="mt-2 h-11 px-6 rounded-2xl text-sm font-semibold"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              Record first sale
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden space-y-1.5">
          {filtered.map((o) => {
            const Icon = STATUS_ICON[o.status];
            const cust = customers.find((c) => c.id === o.customer_id);
            const colors = STATUS_COLOR[o.status];
            return (
              <Link
                key={o.id}
                href={`/sales/${o.id}`}
                className="flex items-center justify-between gap-3 p-4 rounded-2xl transition-opacity hover:opacity-90"
                style={CARD}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: colors.bg, color: colors.text }}
                  >
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
                  <span
                    className="text-[10px] uppercase tracking-widest font-semibold rounded-lg px-2.5 py-1"
                    style={{ background: colors.bg, color: colors.text }}
                  >
                    {STATUS_LABEL[o.status]}
                  </span>
                  <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── New Sale Sheet ── */}
      {newDialog && (
        <NewSaleSheet
          customers={customers}
          skus={skus}
          godowns={godowns}
          stockLevels={stockLevels}
          existingOrders={rows}
          onClose={() => setNewDialog(false)}
          onCreated={(id) => {
            setNewDialog(false);
            load();
            router.push(`/sales/${id}`);
          }}
          onCustomerCreated={(c) => setCustomers((prev) => [c, ...prev])}
        />
      )}
    </div>
  );
}

// ── NewSaleSheet — full-screen glass overlay matching mockup ─────────────────

type Step = 1 | 2 | 3;

function NewSaleSheet({
  customers,
  skus,
  godowns,
  stockLevels,
  existingOrders,
  onClose,
  onCreated,
  onCustomerCreated,
}: {
  customers: CustomerRow[];
  skus: SkuFullRow[];
  godowns: GodownRow[];
  stockLevels: StockLevel[];
  existingOrders: SalesOrderRow[];
  onClose: () => void;
  onCreated: (id: string) => void;
  onCustomerCreated: (c: CustomerRow) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [orderNumber, setOrderNumber] = useState(nextOrderNumber(existingOrders));
  const [channel, setChannel] = useState<OrderChannel>("whatsapp");

  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustIsland, setNewCustIsland] = useState("");
  const [newCustChannel, setNewCustChannel] = useState<CustomerChannel>("whatsapp");
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [skuSearch, setSkuSearch] = useState("");
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [lineUom, setLineUom] = useState<SaleUom>("pack");
  const [lineQty, setLineQty] = useState("");
  const [linePrice, setLinePrice] = useState("");

  const [godownId, setGodownId] = useState(() => {
    const def = godowns.find((g) => g.is_default);
    return def?.id ?? godowns[0]?.id ?? "";
  });
  const [saving, setSaving] = useState(false);

  const customer = customers.find((c) => c.id === customerId);
  const selectedSku = skus.find((s) => s.id === selectedSkuId);

  const recentCustomers = useMemo(() => customers.slice(0, 6), [customers]);
  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return [];
    return customers.filter((c) =>
      [c.name, c.phone ?? "", c.island ?? ""].join(" ").toLowerCase().includes(term),
    ).slice(0, 10);
  }, [customers, customerSearch]);

  const filteredSkus = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    if (!term) return active.slice(0, 30);
    return active.filter((s) =>
      [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""]
        .join(" ").toLowerCase().includes(term),
    ).slice(0, 30);
  }, [skus, skuSearch]);

  const stockHere = selectedSku && godownId
    ? stockLevels.find((l) => l.sku_id === selectedSku.id && l.godown_id === godownId)?.qty_pieces ?? 0
    : null;

  useEffect(() => {
    if (!selectedSku) return;
    const price =
      lineUom === "piece"  ? selectedSku.selling_price_per_piece_mvr :
      lineUom === "pack"   ? selectedSku.selling_price_per_pack_mvr :
                             selectedSku.selling_price_per_carton_mvr;
    if (price != null) setLinePrice(price.toFixed(2));
    else setLinePrice("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkuId, lineUom]);

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
    setDraftLines((prev) => [...prev, {
      key: `${selectedSku.id}-${Date.now()}`,
      sku: selectedSku,
      uom: lineUom,
      qty: parseFloat(lineQty),
      qty_pieces: lineQtyPieces,
      unit_price_mvr: parseFloat(linePrice),
      line_total_mvr: lineTotal,
    }]);
    setSelectedSkuId(""); setSkuSearch(""); setLineQty(""); setLinePrice(""); setLineUom("pack");
  }

  async function handleSubmit() {
    if (!orderNumber.trim() || draftLines.length === 0) return;
    setSaving(true);
    try {
      const cust = customers.find((c) => c.id === customerId);
      const finalChannel = cust?.channel ?? channel;
      const created = await createOrder({
        order_number: orderNumber.trim(),
        customer_id: customerId || null,
        channel: finalChannel,
        status: "draft",
        source_godown_id: godownId || null,
      });
      await Promise.all(draftLines.map((l) =>
        createOrderLine({
          order_id: created.id,
          sku_id: l.sku.id,
          uom: l.uom,
          qty: l.qty,
          qty_pieces: l.qty_pieces,
          unit_price_mvr: l.unit_price_mvr,
          line_total_mvr: l.line_total_mvr,
        }),
      ));
      toast.success("Sale created — review and confirm below");
      onCreated(created.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const stepLabels: Record<Step, string> = { 1: "Customer", 2: "Products", 3: "Review" };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#000000" }}>

      {/* Header */}
      <header
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 h-16"
        style={{ background: "rgba(0,0,0,0.70)", backdropFilter: "blur(40px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-foreground opacity-70 hover:opacity-100 transition">
            ✕
          </button>
          <span className="text-[18px] font-bold text-foreground tracking-tight">New Sale</span>
        </div>
        <History className="h-5 w-5" style={{ color: "var(--muted-foreground)" }} />
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pt-20 pb-28 px-5 space-y-6">

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-all"
                style={
                  step === s
                    ? { background: "var(--foreground)", color: "var(--background)" }
                    : step > s
                    ? { background: "rgba(74,222,128,0.20)", color: "var(--snm-success)" }
                    : { background: "var(--secondary)", color: "var(--muted-foreground)" }
                }
              >
                {step > s ? "✓" : s}
              </div>
              <span className="text-[11px]" style={{ color: step === s ? "var(--foreground)" : "var(--muted-foreground)" }}>
                {stepLabels[s]}
              </span>
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
                  <div
                    className="flex-1 flex items-center gap-3 rounded-xl px-4 h-12"
                    style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                    <input
                      autoFocus
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Search name, phone, ID…"
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-[#444748] outline-none"
                    />
                  </div>
                  <button
                    onClick={() => setShowNewCustomer(true)}
                    className="flex items-center gap-1.5 h-12 px-4 rounded-xl text-sm font-semibold transition"
                    style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)", color: "var(--foreground)" }}
                  >
                    <UserPlus className="h-4 w-4" />
                    Add New
                  </button>
                </div>

                {/* Frequent customers */}
                <div>
                  <p className="label-caps text-[10px] mb-3" style={{ color: "var(--muted-foreground)" }}>Frequent Customers</p>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).map((c) => {
                      const initials = c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                      return (
                        <button
                          key={c.id}
                          onClick={() => { setCustomerId(c.id); setChannel((c.channel as OrderChannel) ?? "whatsapp"); }}
                          className="flex-shrink-0 p-4 rounded-xl w-36 text-left transition active:scale-95"
                          style={{ ...CARD, border: "1px solid rgba(255,255,255,0.08)" }}
                        >
                          <div
                            className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm mb-2"
                            style={{ background: "rgba(255,255,255,0.10)", color: "var(--foreground)" }}
                          >
                            {initials}
                          </div>
                          <p className="text-[12px] font-bold text-white truncate">{c.name}</p>
                          <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{c.channel}</p>
                        </button>
                      );
                    })}
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).length === 0 && (
                      <p className="text-sm py-4" style={{ color: "var(--muted-foreground)" }}>
                        {customerSearch.trim() ? "No matches." : "No customers yet."}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => { setCustomerId("walkin"); }}
                  className="w-full h-12 rounded-xl text-sm font-semibold transition"
                  style={{ ...CARD, border: "1px solid var(--glass-border)", color: "var(--muted-foreground)" }}
                >
                  Walk-in (no account)
                </button>
              </>
            )}

            {/* New customer form */}
            {showNewCustomer && !customerId && (
              <div className="rounded-xl p-5 space-y-4" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}>
                <p className="text-[13px] font-bold text-foreground flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  New Customer
                </p>
                <GlassInput label="NAME *" value={newCustName} onChange={(e) => setNewCustName((e.target as HTMLInputElement).value)} placeholder="Full name or company" autoFocus />
                <div className="grid grid-cols-2 gap-3">
                  <GlassInput label="PHONE" value={newCustPhone} onChange={(e) => setNewCustPhone((e.target as HTMLInputElement).value)} placeholder="+960…" inputMode="tel" />
                  <GlassInput label="ISLAND" value={newCustIsland} onChange={(e) => setNewCustIsland((e.target as HTMLInputElement).value)} placeholder="Malé…" />
                </div>
                <GlassSelect label="CHANNEL" value={newCustChannel} onChange={(v) => setNewCustChannel(v as CustomerChannel)}>
                  {CUSTOMER_CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </GlassSelect>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowNewCustomer(false)}
                    className="flex-1 h-11 rounded-xl text-sm font-semibold"
                    style={{ background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)" }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleCreateCustomer}
                    disabled={savingCustomer || !newCustName.trim()}
                    className="flex-[2] h-11 rounded-xl text-sm font-bold transition disabled:opacity-40"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}
                  >
                    {savingCustomer ? "Saving…" : "Save & Select"}
                  </button>
                </div>
              </div>
            )}

            {/* Selected customer chip */}
            {(customerId && customerId !== "walkin" && customer) && (
              <div
                className="rounded-xl p-4 flex items-center justify-between"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}
              >
                <div>
                  <p className="text-[14px] font-semibold text-foreground">{customer.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    {[customer.phone, customer.island, customer.channel].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button onClick={() => { setCustomerId(""); setCustomerSearch(""); }} className="text-[11px] text-foreground opacity-60 hover:opacity-100">Change</button>
              </div>
            )}
            {customerId === "walkin" && (
              <div
                className="rounded-xl p-4 flex items-center justify-between"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}
              >
                <div>
                  <p className="text-[14px] font-semibold text-foreground">Walk-in customer</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>No account</p>
                </div>
                <button onClick={() => setCustomerId("")} className="text-[11px] text-foreground opacity-60 hover:opacity-100">Change</button>
              </div>
            )}

            {/* Order # + channel */}
            {customerId && (
              <div className="grid grid-cols-2 gap-3">
                <GlassInput label="ORDER #" value={orderNumber} onChange={(e) => setOrderNumber((e.target as HTMLInputElement).value)} />
                <GlassSelect label="CHANNEL" value={channel} onChange={(v) => setChannel(v as OrderChannel)}>
                  {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </GlassSelect>
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Products ── */}
        {step === 2 && (
          <div className="space-y-4">
            <GlassSelect label="SHIP FROM WAREHOUSE" value={godownId} onChange={setGodownId}>
              {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}{g.is_default ? " (default)" : ""}</option>)}
            </GlassSelect>

            <div>
              <p className="label-caps text-[10px] mb-3" style={{ color: "var(--muted-foreground)" }}>Product Catalog</p>
              {!selectedSkuId ? (
                <>
                  <div
                    className="flex items-center gap-3 rounded-xl px-4 h-12 mb-3"
                    style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                    <input
                      value={skuSearch}
                      onChange={(e) => setSkuSearch(e.target.value)}
                      placeholder="Search brand, product, variant…"
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-[#444748] outline-none"
                      autoComplete="off"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredSkus.map((s) => {
                      const stock = godownId
                        ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0
                        : null;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setSelectedSkuId(s.id)}
                          className="rounded-xl p-4 text-left space-y-3 transition active:scale-[0.98]"
                          style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[14px] font-semibold text-foreground">{s.brand_name} · {s.model_name}</p>
                              <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{s.internal_code}</p>
                            </div>
                            {stock !== null && (
                              <span
                                className="text-[10px] font-bold px-2 py-0.5 rounded"
                                style={{
                                  background: stock > 0 ? "var(--secondary)" : "rgba(255,180,171,0.12)",
                                  color: stock > 0 ? "var(--muted-foreground)" : "var(--snm-error)",
                                }}
                              >
                                STOCK: {stock}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[18px] font-semibold text-white">
                              {s.selling_price_per_pack_mvr != null ? `${s.selling_price_per_pack_mvr.toFixed(2)} MVR` : "—"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                    {filteredSkus.length === 0 && (
                      <p className="text-sm col-span-2 py-4" style={{ color: "var(--muted-foreground)" }}>No products found.</p>
                    )}
                  </div>
                </>
              ) : selectedSku ? (
                <div className="rounded-xl p-4 space-y-4" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[14px] font-semibold text-foreground">{selectedSku.brand_name} · {selectedSku.model_name}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{selectedSku.variant_display}</p>
                      {stockHere !== null && (
                        <p className="text-[11px] mt-1" style={{ color: stockHere === 0 ? "#ffb4ab" : "#4ade80" }}>
                          In stock: {stockHere.toLocaleString()} pcs
                        </p>
                      )}
                    </div>
                    <button onClick={() => { setSelectedSkuId(""); setLineQty(""); setLinePrice(""); }} className="text-[11px] text-white opacity-60 hover:opacity-100">Change</button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <GlassSelect label="SELL BY" value={lineUom} onChange={(v) => setLineUom(v as SaleUom)}>
                      <option value="carton">Carton</option>
                      <option value="pack">Pack</option>
                      <option value="piece">Piece</option>
                    </GlassSelect>
                    <GlassInput label="QTY *" type="number" inputMode="decimal" min="1" value={lineQty} onChange={(e) => setLineQty((e.target as HTMLInputElement).value)} placeholder="0" />
                    <GlassInput label="PRICE MVR" type="number" inputMode="decimal" step="0.01" min="0" value={linePrice} onChange={(e) => setLinePrice((e.target as HTMLInputElement).value)} placeholder="0.00" />
                  </div>

                  {lineQtyPieces > 0 && (
                    <div className="flex justify-between text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      <span>= {lineQtyPieces.toLocaleString()} pieces</span>
                      <span className="text-foreground font-semibold">{lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} MVR</span>
                    </div>
                  )}
                  {insufficient && (
                    <p className="text-[11px]" style={{ color: "#ffb4ab" }}>⚠ Only {stockHere} pcs in this warehouse</p>
                  )}
                  <button
                    onClick={handleAddLine}
                    disabled={!lineQty || !linePrice || lineQtyPieces <= 0 || insufficient}
                    className="w-full h-11 rounded-xl text-sm font-bold transition disabled:opacity-40"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}
                  >
                    Add to Order
                  </button>
                </div>
              ) : null}
            </div>

            {/* Draft lines */}
            {draftLines.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ ...CARD, border: "1px solid rgba(255,255,255,0.06)" }}>
                <p className="px-4 pt-3 pb-2 label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>Order Items ({draftLines.length})</p>
                {draftLines.map((l) => (
                  <div
                    key={l.key}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate">{l.sku.brand_name} · {l.sku.model_name}</p>
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                        {l.qty} {l.uom} · {l.unit_price_mvr.toLocaleString()} MVR/{l.uom}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-foreground font-semibold text-[13px]">{l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR</span>
                      <button onClick={() => setDraftLines((p) => p.filter((x) => x.key !== l.key))} className="opacity-40 hover:opacity-100 transition">
                        <Trash2 className="h-3.5 w-3.5 text-white" />
                      </button>
                    </div>
                  </div>
                ))}
                <div
                  className="flex justify-between px-4 py-3 text-sm font-semibold"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)" }}
                >
                  <span style={{ color: "var(--muted-foreground)" }}>Total</span>
                  <span className="text-foreground">{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Review ── */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Revenue + Profit summary card matching mockup */}
            <div
              className="rounded-2xl p-5 relative overflow-hidden"
              style={{ ...CARD, border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="grid grid-cols-2 gap-y-5">
                <div>
                  <p className="label-caps text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>TOTAL REVENUE</p>
                  <p className="text-[28px] font-light tracking-tight text-white leading-none">
                    {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <span className="text-base ml-1" style={{ color: "var(--muted-foreground)" }}>MVR</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="label-caps text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>ITEMS</p>
                  <p className="text-[28px] font-light tracking-tight text-white leading-none">{draftLines.length}</p>
                </div>
              </div>
              <div
                className="mt-4 pt-4 flex justify-between text-[12px]"
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                <span style={{ color: "var(--muted-foreground)" }}>
                  Customer: {customerId === "walkin" ? "Walk-in" : (customer?.name ?? "—")}
                </span>
                <span style={{ color: "var(--muted-foreground)" }}>via {CHANNELS.find((c) => c.value === channel)?.label}</span>
              </div>
            </div>

            {/* Order summary */}
            <div className="rounded-xl overflow-hidden" style={{ ...CARD }}>
              {[
                { label: "Order #", value: orderNumber },
                { label: "Warehouse", value: godowns.find((g) => g.id === godownId)?.name ?? "—" },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex justify-between px-4 py-3 text-sm"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                >
                  <span style={{ color: "var(--muted-foreground)" }}>{row.label}</span>
                  <span className="text-foreground font-medium">{row.value}</span>
                </div>
              ))}
            </div>

            {/* Line items */}
            <div className="rounded-xl overflow-hidden" style={CARD}>
              {draftLines.map((l) => (
                <div
                  key={l.key}
                  className="flex items-center justify-between gap-2 px-4 py-3 text-sm"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate">{l.sku.brand_name} · {l.sku.model_name} · {l.sku.variant_display}</p>
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{l.qty} {l.uom} · {l.unit_price_mvr.toLocaleString()} MVR/{l.uom}</p>
                  </div>
                  <span className="text-foreground font-semibold text-[13px] shrink-0">{l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })} MVR</span>
                </div>
              ))}
            </div>

            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              Stock will be deducted when you confirm the order on the next screen.
            </p>
          </div>
        )}

      </div>

      {/* ── Fixed bottom actions ── */}
      <footer
        className="fixed bottom-0 left-0 right-0 flex items-center gap-3 px-5 h-24"
        style={{ background: "rgba(0,0,0,0.70)", backdropFilter: "blur(40px)", borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        {step === 1 && (
          <>
            <button
              onClick={onClose}
              className="flex-1 h-14 rounded-xl text-sm font-semibold"
              style={{ ...CARD, border: "1px solid rgba(255,255,255,0.08)", color: "var(--foreground)" }}
            >
              Cancel
            </button>
            <button
              disabled={!customerId || !orderNumber.trim()}
              onClick={() => setStep(2)}
              className="flex-[2] h-14 rounded-xl text-sm font-bold transition disabled:opacity-40"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              Next: Products →
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <button
              onClick={() => setStep(1)}
              className="flex-1 h-14 rounded-xl text-sm font-semibold"
              style={{ ...CARD, border: "1px solid rgba(255,255,255,0.08)", color: "var(--foreground)" }}
            >
              ← Back
            </button>
            <button
              disabled={draftLines.length === 0}
              onClick={() => setStep(3)}
              className="flex-[2] h-14 rounded-xl text-sm font-bold transition disabled:opacity-40"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              Review Order →
            </button>
          </>
        )}
        {step === 3 && (
          <>
            <button
              onClick={() => setStep(2)}
              className="flex-1 h-14 rounded-xl text-sm font-semibold"
              style={{ ...CARD, border: "1px solid rgba(255,255,255,0.08)", color: "var(--foreground)" }}
            >
              ← Back
            </button>
            <button
              disabled={saving || draftLines.length === 0}
              onClick={handleSubmit}
              className="flex-[2] h-14 rounded-xl text-sm font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm & Notify
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Truck,
  CheckCircle2,
  Package,
  MapPin,
  Phone,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import {
  listMyDeliveries,
  listOrderLines,
  updateOrder,
  type SalesOrderRow,
  type SalesOrderLineRow,
} from "@/lib/queries/sales";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import {
  listCustomers,
  listGodowns,
  type CustomerRow,
  type GodownRow,
} from "@/lib/queries/masters";
import { supabase } from "@/lib/supabase";

/* ─── types ─────────────────────────────────────── */

interface OrderWithLines {
  order: SalesOrderRow;
  lines: SalesOrderLineRow[];
  customer?: CustomerRow;
  godown?: GodownRow;
}

/* ─── reusable bottom sheet ─────────────────────── */

function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          zIndex: 50, backdropFilter: "blur(2px)",
        }}
      />
      {/* sheet */}
      <div
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "var(--glass-1)", borderRadius: "20px 20px 0 0",
          padding: "28px 20px 40px",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.25)",
          zIndex: 51, maxHeight: "85vh", overflowY: "auto",
        }}
      >
        {/* drag handle */}
        <div style={{
          width: 40, height: 4, borderRadius: 2,
          background: "var(--glass-border)", margin: "0 auto 20px",
        }} />
        <p style={{ fontSize: 18, fontWeight: 700, color: "var(--foreground)", marginBottom: 20 }}>
          {title}
        </p>
        {children}
      </div>
    </>
  );
}

/* ─── cash collection sheet ─────────────────────── */

function CashCollectSheet({
  open,
  order,
  expectedMvr,
  onClose,
  onDone,
}: {
  open: boolean;
  order?: SalesOrderRow;
  expectedMvr: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setAmount("");
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [open]);

  const collected = parseFloat(amount) || 0;
  const variance = collected - expectedMvr;

  async function save() {
    if (!order || !amount) return;
    setSaving(true);
    try {
      await updateOrder(order.id, {
        status: "delivered",
        payment_status: "paid",
        cash_collected_mvr: collected,
        delivered_at: new Date().toISOString(),
      } as Record<string, unknown>);
      toast.success("Delivered ✓ — remember to deposit the cash!");
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Cash collected">
      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 4 }}>
          Expected amount
        </p>
        <p style={{ fontSize: 24, fontWeight: 800, color: "var(--foreground)" }}>
          MVR {expectedMvr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 8 }}>
          Amount collected (MVR)
        </p>
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          style={{
            width: "100%", height: 64, fontSize: 32, fontWeight: 700,
            border: "2px solid var(--glass-border)", borderRadius: 12,
            background: "var(--glass-1)", color: "var(--foreground)",
            padding: "0 16px", outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {collected > 0 && Math.abs(variance) > 0.01 && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, marginBottom: 16,
          background: variance < 0
            ? "color-mix(in srgb, #ef4444 12%, transparent)"
            : "color-mix(in srgb, #22c55e 12%, transparent)",
          color: variance < 0 ? "#ef4444" : "#22c55e",
          fontSize: 14, fontWeight: 600,
        }}>
          {variance < 0
            ? `⚠ MVR ${Math.abs(variance).toFixed(2)} short — check with customer`
            : `+ MVR ${variance.toFixed(2)} over — return change`}
        </div>
      )}

      <button
        onClick={save}
        disabled={saving || !amount}
        style={{
          width: "100%", height: 60, borderRadius: 14, border: "none",
          background: saving || !amount ? "var(--glass-border)" : "#22c55e",
          color: "#fff", fontSize: 17, fontWeight: 700, cursor: saving || !amount ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        {saving ? <Loader2 size={20} className="animate-spin" /> : <><CheckCircle2 size={20} /> Mark Delivered</>}
      </button>
    </BottomSheet>
  );
}

/* ─── issue report sheet ─────────────────────── */

function IssueSheet({
  open,
  order,
  onClose,
  onDone,
}: {
  open: boolean;
  order?: SalesOrderRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setNote(""); }, [open]);

  async function save() {
    if (!order || !note.trim()) return;
    setSaving(true);
    try {
      await updateOrder(order.id, {
        notes: note.trim(),
      } as Record<string, unknown>);
      toast.success("Issue reported — admin has been notified.");
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Report an issue">
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 8 }}>
        Describe the problem (customer not home, damaged item, wrong address…)
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        placeholder="e.g. Customer not available, will retry tomorrow morning"
        style={{
          width: "100%", borderRadius: 12, padding: "12px 14px",
          border: "2px solid var(--glass-border)", background: "var(--glass-1)",
          color: "var(--foreground)", fontSize: 15, resize: "none",
          outline: "none", boxSizing: "border-box", marginBottom: 16,
        }}
      />
      <button
        onClick={save}
        disabled={saving || !note.trim()}
        style={{
          width: "100%", height: 56, borderRadius: 14, border: "none",
          background: saving || !note.trim() ? "var(--glass-border)" : "#ef4444",
          color: "#fff", fontSize: 16, fontWeight: 700,
          cursor: saving || !note.trim() ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        {saving ? <Loader2 size={18} className="animate-spin" /> : <><AlertTriangle size={18} /> Send issue report</>}
      </button>
    </BottomSheet>
  );
}

/* ─── status badge ───────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    confirmed:        { label: "Ready to pick", bg: "#f59e0b22", color: "#f59e0b" },
    picked:           { label: "Picked up",     bg: "#3b82f622", color: "#3b82f6" },
    out_for_delivery: { label: "On the way",    bg: "#8b5cf622", color: "#8b5cf6" },
    delivered:        { label: "Delivered ✓",   bg: "#22c55e22", color: "#22c55e" },
  };
  const s = map[status] ?? { label: status, bg: "var(--glass-2)", color: "var(--muted-foreground)" };
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
      padding: "3px 8px", borderRadius: 6, background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

/* ─── main component ─────────────────────────── */

export function MyDeliveries() {
  const [items, setItems] = useState<OrderWithLines[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [cashSheet, setCashSheet] = useState<{ open: boolean; order?: SalesOrderRow; expected: number }>({
    open: false, expected: 0,
  });
  const [issueSheet, setIssueSheet] = useState<{ open: boolean; order?: SalesOrderRow }>({ open: false });

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
      <div style={{ padding: 48, display: "flex", flexDirection: "column", alignItems: "center", color: "var(--muted-foreground)" }}>
        <Loader2 size={28} className="animate-spin" style={{ marginBottom: 12 }} />
        <p style={{ fontSize: 14 }}>Loading deliveries…</p>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* header */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted-foreground)", marginBottom: 4 }}>
          Today
        </p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--foreground)", margin: 0 }}>My Deliveries</h1>
        <p style={{ fontSize: 14, color: "var(--muted-foreground)", marginTop: 4 }}>
          {items.length === 0 ? "No deliveries assigned." : `${items.length} delivery${items.length === 1 ? "" : "s"} to handle.`}
        </p>
      </div>

      {/* empty state */}
      {items.length === 0 && (
        <div style={{
          background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16,
          padding: 40, textAlign: "center",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, background: "var(--glass-2)",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
          }}>
            <Truck size={24} style={{ color: "var(--foreground)" }} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)", marginBottom: 6 }}>All caught up!</p>
          <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
            New deliveries appear here when an admin assigns them to you.
          </p>
        </div>
      )}

      {/* order cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map(({ order, lines, customer, godown }) => {
          const isOpen = expanded === order.id;
          const isCod = order.payment_status === "cod";
          const totalMvr = lines.reduce((acc, l) => acc + Number(l.line_total_mvr), 0);
          const itemCount = lines.reduce((acc, l) => acc + (l.qty ?? 0), 0);

          return (
            <div key={order.id} style={{
              background: "var(--glass-1)", backdropFilter: "blur(20px)",
              borderRadius: 16, overflow: "hidden",
              border: "1px solid var(--glass-border)",
            }}>
              {/* card header — tap to expand */}
              <button
                onClick={() => setExpanded(isOpen ? null : order.id)}
                style={{
                  width: "100%", padding: "16px 16px 14px",
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                  gap: 12, background: "none", border: "none", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* status + COD badge row */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    <StatusBadge status={order.status} />
                    {isCod && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                        padding: "3px 8px", borderRadius: 6,
                        background: "#f59e0b22", color: "#f59e0b",
                      }}>
                        COD · MVR {totalMvr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>

                  {/* customer name */}
                  <p style={{ fontSize: 20, fontWeight: 700, color: "var(--foreground)", margin: "0 0 6px" }}>
                    {customer?.name ?? "—"}
                  </p>

                  {/* meta row */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 13, color: "var(--muted-foreground)" }}>
                    {godown && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Package size={13} />
                        <span>Pick: <strong style={{ color: "var(--foreground)" }}>{godown.name}</strong></span>
                      </span>
                    )}
                    {(order.delivery_island || customer?.island) && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <MapPin size={13} /> {order.delivery_island || customer?.island}
                      </span>
                    )}
                    <span>{itemCount} items</span>
                  </div>
                </div>

                <ChevronDown
                  size={20}
                  style={{
                    color: "var(--muted-foreground)", flexShrink: 0, marginTop: 2,
                    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s",
                  }}
                />
              </button>

              {/* expanded body */}
              {isOpen && (
                <div style={{
                  borderTop: "1px solid var(--glass-border)",
                  padding: "16px 16px 20px",
                  background: "color-mix(in srgb, var(--background) 40%, transparent)",
                }}>
                  {/* phone link */}
                  {customer?.phone && (
                    <a
                      href={`tel:${customer.phone}`}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        fontSize: 15, fontWeight: 600,
                        color: "var(--foreground)", textDecoration: "none",
                        padding: "8px 14px", borderRadius: 10,
                        background: "var(--glass-2)", marginBottom: 16,
                      }}
                    >
                      <Phone size={16} style={{ color: "#22c55e" }} />
                      {customer.phone}
                    </a>
                  )}

                  {/* address */}
                  {order.delivery_address && (
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", marginBottom: 4 }}>
                        Address
                      </p>
                      <p style={{ fontSize: 14, color: "var(--foreground)" }}>{order.delivery_address}</p>
                    </div>
                  )}

                  {/* items list */}
                  <div style={{ marginBottom: 20 }}>
                    <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", marginBottom: 6 }}>
                      Items
                    </p>
                    {lines.map((l) => {
                      const sku = skus.find((s) => s.id === l.sku_id);
                      return (
                        <div key={l.id} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "8px 0", borderBottom: "1px solid var(--glass-border)",
                        }}>
                          <span style={{ fontSize: 14, color: "var(--foreground)" }}>
                            {sku ? `${sku.brand_name} › ${sku.model_name} › ${sku.variant_display}` : l.sku_id}
                          </span>
                          <span style={{ fontSize: 14, color: "var(--muted-foreground)", flexShrink: 0, marginLeft: 12, fontWeight: 600 }}>
                            {l.qty} {l.uom}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* action buttons — 60px tall, full width */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {order.status === "confirmed" && (
                      <button
                        onClick={() => setStatus(order.id, { status: "picked", picked_at: new Date().toISOString() })}
                        style={{
                          height: 60, borderRadius: 14, border: "none",
                          background: "var(--foreground)", color: "var(--background)",
                          fontSize: 16, fontWeight: 700, cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        }}
                      >
                        <Package size={20} /> Picked from godown
                      </button>
                    )}

                    {order.status === "picked" && (
                      <button
                        onClick={() => setStatus(order.id, { status: "out_for_delivery" })}
                        style={{
                          height: 60, borderRadius: 14, border: "none",
                          background: "#3b82f6", color: "#fff",
                          fontSize: 16, fontWeight: 700, cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        }}
                      >
                        <Truck size={20} /> Out for delivery
                      </button>
                    )}

                    {order.status === "out_for_delivery" && (
                      <>
                        {isCod ? (
                          <button
                            onClick={() => setCashSheet({ open: true, order, expected: totalMvr })}
                            style={{
                              height: 60, borderRadius: 14, border: "none",
                              background: "#22c55e", color: "#fff",
                              fontSize: 16, fontWeight: 700, cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                            }}
                          >
                            <CheckCircle2 size={20} />
                            Delivered · Collect MVR {totalMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </button>
                        ) : (
                          <button
                            onClick={() => setStatus(order.id, { status: "delivered", delivered_at: new Date().toISOString() })}
                            style={{
                              height: 60, borderRadius: 14, border: "none",
                              background: "#22c55e", color: "#fff",
                              fontSize: 16, fontWeight: 700, cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                            }}
                          >
                            <CheckCircle2 size={20} /> Delivered
                          </button>
                        )}

                        <button
                          onClick={() => setIssueSheet({ open: true, order })}
                          style={{
                            height: 52, borderRadius: 14, border: "2px solid #ef4444",
                            background: "transparent", color: "#ef4444",
                            fontSize: 15, fontWeight: 600, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          }}
                        >
                          <AlertTriangle size={18} /> Report issue
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* cash collection sheet */}
      <CashCollectSheet
        open={cashSheet.open}
        order={cashSheet.order}
        expectedMvr={cashSheet.expected}
        onClose={() => setCashSheet({ open: false, expected: 0 })}
        onDone={() => { setCashSheet({ open: false, expected: 0 }); load(); }}
      />

      {/* issue sheet */}
      <IssueSheet
        open={issueSheet.open}
        order={issueSheet.order}
        onClose={() => setIssueSheet({ open: false })}
        onDone={() => { setIssueSheet({ open: false }); load(); }}
      />
    </div>
  );
}

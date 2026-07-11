"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Truck, CheckCircle2, Package, MapPin, Phone,
  AlertTriangle, RefreshCw, Warehouse, Navigation,
} from "lucide-react";
import {
  listMyDeliveries, listOrderLinesForOrders, updateOrder,
  type SalesOrderRow, type SalesOrderLineRow,
} from "@/lib/queries/sales";
import { listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { SkuIdentity } from "@/components/ui/sku-identity";
import { listCustomers, listGodowns, type CustomerRow, type GodownRow } from "@/lib/queries/masters";
import { supabase } from "@/lib/supabase";
import { withOfflineFallback } from "@/lib/offline-write";
import { notifyDelivered } from "@/lib/push";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { haptic } from "@/lib/haptics";

/* ─── types ─────────────────────────────────────────────────────────────── */

interface OrderWithLines {
  order: SalesOrderRow;
  lines: SalesOrderLineRow[];
  customer?: CustomerRow;
  godown?: GodownRow;
}

/* ─── status config ─────────────────────────────────────────────────────── */

const STATUS_PRIORITY: Record<string, number> = {
  out_for_delivery: 0,
  picked: 1,
  confirmed: 2,
  delivered: 3,
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Ready to pick",
  picked: "Picked up",
  out_for_delivery: "On the way",
  delivered: "Delivered",
};

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  confirmed:        { bg: "color-mix(in srgb, var(--snm-warning) 14%, transparent)", text: "var(--snm-warning)" },
  picked:           { bg: "color-mix(in srgb, var(--snm-info) 14%, transparent)",    text: "var(--snm-info)"    },
  out_for_delivery: { bg: "color-mix(in srgb, var(--snm-brand) 14%, transparent)",   text: "var(--snm-brand)"   },
  delivered:        { bg: "color-mix(in srgb, var(--snm-success) 14%, transparent)", text: "var(--snm-success)"  },
};

/* ─── delivery helpers ──────────────────────────────────────────────────── */

// Full unit word so the driver never mistakes a carton for a pack at the door.
const UOM_WORD: Record<string, string> = { carton: "carton", pack: "pack", piece: "piece" };
function uomWord(uom: string, qty: number): string {
  const w = UOM_WORD[uom] ?? uom;
  return qty === 1 ? w : `${w}s`;
}

// Compose the delivery address from the order (falling back to the customer
// profile), plus a maps deep-link so the driver gets one-tap navigation.
function deliveryAddress(order: SalesOrderRow, customer?: CustomerRow) {
  const line1  = order.delivery_address_line1 || customer?.address || null;
  const line2  = order.delivery_address_line2 || customer?.road || null;
  const island = order.delivery_island || customer?.island || null;
  const parts  = [line1, line2, island].filter(Boolean) as string[];
  const text   = parts.join(", ");
  const mapsUrl = text
    ? `https://maps.google.com/?q=${encodeURIComponent(text + ", Maldives")}`
    : null;
  return { line1, line2, island, hasAny: parts.length > 0, text, mapsUrl };
}

/* ─── bottom sheet ──────────────────────────────────────────────────────── */

function BottomSheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  const startY = useRef<number | null>(null);

  useBodyScrollLock(open);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
      }} />
      <div
        onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
        onTouchEnd={(e) => {
          if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 64) onClose();
          startY.current = null;
        }}
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 61,
          background: "var(--glass-bg-2)", backdropFilter: "blur(28px) saturate(180%)",
          borderRadius: "24px 24px 0 0",
          paddingBottom: "env(safe-area-inset-bottom, 24px)",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.20)",
          maxHeight: "90dvh", overflowY: "auto",
        }}
      >
        {/* drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 8 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--glass-border-lo)", opacity: 0.5 }} />
        </div>
        <div style={{ padding: "4px 20px 32px" }}>
          <p style={{ fontSize: 20, fontWeight: 700, color: "var(--foreground)", marginBottom: 20 }}>{title}</p>
          {children}
        </div>
      </div>
    </>
  );
}

/* ─── cash collection sheet ─────────────────────────────────────────────── */

function CashCollectSheet({ open, order, customerName, expectedMvr, delivererId, onClose, onDone }: {
  open: boolean; order?: SalesOrderRow; customerName?: string; expectedMvr: number;
  delivererId?: string | null;
  onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setAmount(""); setTimeout(() => inputRef.current?.focus(), 150); }
  }, [open]);

  const collected = parseFloat(amount) || 0;
  const variance = collected - expectedMvr;
  const isShort = collected > 0 && variance < -0.01;
  const isOver = collected > 0 && variance > 0.01;

  async function save() {
    if (!order || !amount) return;
    setSaving(true);
    try {
      const patch = {
        status: "delivered" as const,
        payment_status: "paid" as const,
        cash_collected_mvr: collected,
        delivered_at: new Date().toISOString(),
      };
      const { queued } = await withOfflineFallback(
        () => updateOrder(order.id, patch),
        { table: "sales_orders", action: "update", payload: patch, match: { id: order.id } },
      );
      haptic("success");
      toast.success(queued ? "Saved offline — will sync when connected" : "Delivered — remember to deposit the cash");

      // Tell the office a delivery just closed with cash collected, and
      // confirm to the driver on their own device. Skip when queued offline —
      // it isn't real until the update syncs (the push would also fail).
      if (!queued) {
        notifyDelivered(
          {
            title: "Delivery completed",
            body: `${customerName ?? "Walk-in"} · ${order.order_number} · MVR ${collected.toLocaleString()} collected.`,
            url: "/dispatch",
          },
          delivererId,
        );
      }
      onDone();
    } catch (err) { haptic("error"); toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Collect cash">
      {/* Expected */}
      <div style={{ marginBottom: 20, padding: "16px 20px", borderRadius: 16, background: "color-mix(in srgb, var(--snm-success) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
        <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Expected</p>
        <p className="snm-num" style={{ fontSize: 36, fontWeight: 800, color: "var(--snm-success)", letterSpacing: "-0.02em", lineHeight: 1 }}>
          MVR {expectedMvr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>

      {/* Input */}
      <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Amount collected (MVR)</p>
      <input
        ref={inputRef}
        // inputMode="decimal" (not numeric/[0-9]*) — the digits-only iOS
        // keypad has no decimal point, so drivers physically couldn't type
        // the .50 amounts the Expected figure shows, creating false
        // variances on every non-whole COD total.
        type="number" inputMode="decimal" step="0.01" min="0"
        value={amount} onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        style={{
          width: "100%", height: 72, fontSize: 36, fontWeight: 800,
          border: `2px solid ${isShort ? "var(--snm-error)" : isOver ? "var(--snm-success)" : "var(--glass-border-lo)"}`,
          borderRadius: 16, background: "var(--glass-bg-1)",
          color: "var(--foreground)", padding: "0 20px",
          outline: "none", boxSizing: "border-box", letterSpacing: "-0.02em",
        }}
      />

      {/* Variance */}
      {collected > 0 && Math.abs(variance) > 0.01 && (
        <div className="snm-num" style={{
          marginTop: 12, padding: "10px 16px", borderRadius: 12,
          background: isShort ? "color-mix(in srgb, var(--snm-error) 10%, transparent)" : "color-mix(in srgb, var(--snm-success) 10%, transparent)",
          color: isShort ? "var(--snm-error)" : "var(--snm-success)",
          fontSize: 14, fontWeight: 700,
        }}>
          {isShort ? `⚠ MVR ${Math.abs(variance).toFixed(2)} short — check with customer` : `+MVR ${variance.toFixed(2)} over — return change`}
        </div>
      )}

      <button
        onClick={save} disabled={saving || !amount}
        style={{
          marginTop: 20, width: "100%", height: 64, borderRadius: 18, border: "none",
          background: saving || !amount ? "var(--glass-border-lo)" : "var(--snm-success)",
          color: "#fff", fontSize: 18, fontWeight: 800, cursor: saving || !amount ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          transition: "background 0.15s, transform 0.1s",
          touchAction: "manipulation",
        }}
        onPointerDown={(e) => { if (!saving && amount) e.currentTarget.style.transform = "scale(0.97)"; }}
        onPointerUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        onPointerLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      >
        {saving ? <Loader2 size={22} className="animate-spin" /> : <><CheckCircle2 size={22} /> Mark Delivered</>}
      </button>
    </BottomSheet>
  );
}

/* ─── issue report sheet ─────────────────────────────────────────────────── */

function IssueSheet({ open, order, onClose, onDone }: {
  open: boolean; order?: SalesOrderRow;
  onClose: () => void; onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setNote(""); }, [open]);

  async function save() {
    if (!order || !note.trim()) return;
    setSaving(true);
    const patch = { notes: note.trim() };
    try {
      const { queued } = await withOfflineFallback(
        () => updateOrder(order.id, patch),
        { table: "sales_orders", action: "update", payload: patch, match: { id: order.id } },
      );
      haptic("success");
      toast.success(queued ? "Saved offline — will sync when connected" : "Issue reported — admin will see it on the order");
      onDone();
    } catch (err) { haptic("error"); toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  const QUICK_ISSUES = [
    "Customer not home — will retry",
    "Wrong address",
    "Customer refused delivery",
    "Damaged item",
    "Partial delivery only",
  ];

  return (
    <BottomSheet open={open} onClose={onClose} title="Report an issue">
      <p style={{ fontSize: 14, color: "var(--muted-foreground)", marginBottom: 16 }}>
        Admin will see this note on the order. Be specific.
      </p>

      {/* Quick-pick common issues */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {QUICK_ISSUES.map((q) => (
          <button key={q} onClick={() => setNote(q)}
            style={{
              padding: "8px 14px", borderRadius: 20, border: "0.5px solid var(--glass-border-lo)",
              background: note === q ? "color-mix(in srgb, var(--snm-error) 12%, transparent)" : "var(--glass-bg-1)",
              color: note === q ? "var(--snm-error)" : "var(--foreground)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              borderColor: note === q ? "color-mix(in srgb, var(--snm-error) 30%, transparent)" : "var(--glass-border-lo)",
            }}>
            {q}
          </button>
        ))}
      </div>

      <textarea
        value={note} onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Or type a custom note…"
        style={{
          width: "100%", borderRadius: 14, padding: "14px 16px",
          border: "0.5px solid var(--glass-border-lo)", background: "var(--glass-bg-1)",
          color: "var(--foreground)", fontSize: 15, resize: "none",
          outline: "none", boxSizing: "border-box",
        }}
      />

      <button
        onClick={save} disabled={saving || !note.trim()}
        style={{
          marginTop: 16, width: "100%", height: 60, borderRadius: 16, border: "none",
          background: saving || !note.trim() ? "var(--glass-border-lo)" : "var(--snm-error)",
          color: "#fff", fontSize: 17, fontWeight: 700,
          cursor: saving || !note.trim() ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        {saving ? <Loader2 size={20} className="animate-spin" /> : <><AlertTriangle size={20} /> Send report</>}
      </button>
    </BottomSheet>
  );
}

/* ─── items block (always on the card face) ─────────────────────────────── */
/* This is what the driver must carry — it must never be hidden or small. Each
   line reuses the app-wide SkuIdentity block (prominent name + pack-config
   chip) so NB/S vs S vs a different pack-count can't be confused, with a large
   quantity badge that spells out carton/pack/piece in full. */

function ItemsBlock({ lines, skus }: { lines: SalesOrderLineRow[]; skus: SkuFullRow[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 700, color: "var(--muted-foreground)", marginBottom: 8 }}>
        {lines.length === 1 ? "Item to deliver" : `${lines.length} items to deliver`}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lines.map((l) => {
          const sku = skus.find((s) => s.id === l.sku_id);
          return (
            <div key={l.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
              padding: "12px 14px", borderRadius: 14,
              background: "var(--glass-bg-2)",
              border: "0.5px solid var(--glass-border-lo)",
            }}>
              {sku ? (
                <SkuIdentity
                  brandName={sku.brand_name} modelName={sku.model_name} variantDisplay={sku.variant_display}
                  pcsPerPack={sku.pcs_per_pack} packsPerCarton={sku.packs_per_carton}
                  separator="·"
                />
              ) : (
                <span style={{ fontSize: 16, color: "var(--foreground)", fontWeight: 600 }}>{l.sku_id}</span>
              )}
              {/* Big, unmissable quantity — the number of units to load/hand over */}
              <div style={{
                flexShrink: 0, textAlign: "center", minWidth: 62,
                padding: "6px 12px", borderRadius: 12,
                background: "var(--snm-brand-muted)",
                border: "1px solid var(--snm-brand-border)",
              }}>
                <span style={{ display: "block", fontSize: 22, fontWeight: 800, lineHeight: 1, color: "var(--snm-brand-text)", fontVariantNumeric: "tabular-nums" }}>
                  {l.qty}
                </span>
                <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--snm-brand-text)", textTransform: "uppercase", letterSpacing: "0.03em", marginTop: 2 }}>
                  {uomWord(l.uom, l.qty)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── address block (always on the card face + one-tap navigate) ─────────── */

function AddressBlock({ order, customer }: { order: SalesOrderRow; customer?: CustomerRow }) {
  const addr = deliveryAddress(order, customer);
  if (!addr.hasAny) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 700, color: "var(--muted-foreground)", marginBottom: 8 }}>
        Deliver to
      </p>
      <div style={{
        display: "flex", alignItems: "stretch", gap: 10,
        padding: "12px 14px", borderRadius: 14,
        background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)",
      }}>
        <MapPin size={20} style={{ color: "var(--muted-foreground)", flexShrink: 0, marginTop: 2 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          {(addr.line1 || addr.line2) && (
            <p style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)", lineHeight: 1.35, margin: 0, overflowWrap: "anywhere" }}>
              {[addr.line1, addr.line2].filter(Boolean).join(", ")}
            </p>
          )}
          {addr.island && (
            <p style={{ fontSize: 14, color: "var(--muted-foreground)", margin: "2px 0 0" }}>{addr.island}</p>
          )}
        </div>
        {/* Navigate — one tap opens maps for turn-by-turn to the door (44pt) */}
        {addr.mapsUrl && (
          <a
            href={addr.mapsUrl} target="_blank" rel="noopener noreferrer"
            style={{
              alignSelf: "center", flexShrink: 0,
              width: 44, height: 44, borderRadius: 14, textDecoration: "none",
              background: "color-mix(in srgb, var(--snm-info) 12%, transparent)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            aria-label="Navigate to address"
          >
            <Navigation size={18} style={{ color: "var(--snm-info)" }} />
          </a>
        )}
      </div>
    </div>
  );
}

/* ─── issue note (shown when present) ───────────────────────────────────── */

function IssueNote({ note }: { note: string }) {
  return (
    <div style={{
      marginBottom: 12, padding: "12px 14px", borderRadius: 12,
      background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)",
      border: "1px solid color-mix(in srgb, var(--snm-warning) 25%, transparent)",
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--snm-warning)", marginBottom: 4 }}>Issue note</p>
      <p style={{ fontSize: 14, color: "var(--foreground)" }}>{note}</p>
    </div>
  );
}

/* ─── delivery card ─────────────────────────────────────────────────────── */

function DeliveryCard({ item, skus, onAction, onIssue, onCash }: {
  item: OrderWithLines;
  skus: SkuFullRow[];
  onAction: (id: string, patch: Record<string, string | number | null>) => void;
  onIssue: (order: SalesOrderRow) => void;
  onCash: (order: SalesOrderRow, expected: number, customerName?: string) => void;
}) {
  const { order, lines, customer, godown } = item;
  const isCod = order.payment_status === "cod";
  const totalMvr = lines.reduce((acc, l) => acc + Number(l.line_total_mvr), 0);
  const sc = STATUS_COLOR[order.status] ?? { bg: "var(--glass-bg-2)", text: "var(--muted-foreground)" };

  return (
    <div style={{
      background: "var(--glass-bg-1)",
      backdropFilter: "blur(28px) saturate(180%)",
      WebkitBackdropFilter: "blur(28px) saturate(180%)",
      borderRadius: 20,
      overflow: "hidden",
      border: "0.5px solid var(--glass-border-lo)",
      boxShadow: "var(--glass-shadow), var(--glass-inner)",
    }}>

      {/* ── Card face (always visible) ──────────────────────────────────── */}
      <div style={{ padding: "16px 16px 14px" }}>

        {/* Row 1: status badge + COD pill + phone */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em",
              padding: "4px 10px", borderRadius: 20,
              background: sc.bg, color: sc.text,
            }}>
              {STATUS_LABEL[order.status] ?? order.status}
            </span>
            {isCod && (
              <span style={{
                fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em",
                padding: "4px 10px", borderRadius: 20,
                background: "color-mix(in srgb, var(--snm-warning) 14%, transparent)", color: "var(--snm-warning)",
              }}>
                COD
              </span>
            )}
          </div>
          {/* Phone — 44×44pt tap target, always visible */}
          {customer?.phone && (
            <a
              href={`tel:${customer.phone}`}
              style={{
                width: 44, height: 44, borderRadius: 22, border: "none",
                background: "color-mix(in srgb, var(--snm-success) 12%, transparent)",
                display: "flex", alignItems: "center", justifyContent: "center",
                textDecoration: "none", flexShrink: 0,
              }}
            >
              <Phone size={18} style={{ color: "var(--snm-success)" }} />
            </a>
          )}
        </div>

        {/* Row 2: customer name */}
        <p style={{ fontSize: 22, fontWeight: 700, color: "var(--foreground)", margin: "0 0 6px", lineHeight: 1.2 }}>
          {customer?.name ?? "Walk-in"}
        </p>

        {/* Row 3: pickup godown — big and unmissable, this is the first
            thing the driver needs before he can pick anything up. */}
        {godown && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
            padding: "10px 12px", borderRadius: 12,
            background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--snm-brand) 22%, transparent)",
          }}>
            <Warehouse size={20} style={{ color: "var(--snm-brand-text)", flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--snm-brand-text)", margin: 0 }}>
                Pick up from
              </p>
              <p style={{ fontSize: 17, fontWeight: 700, color: "var(--foreground)", margin: 0 }}>
                {godown.name}
              </p>
            </div>
          </div>
        )}

        {/* ── Items — always visible, prominent (Ali's #1: no squinting, no
             dropdown, so the driver can't grab the wrong product) ───────── */}
        <ItemsBlock lines={lines} skus={skus} />

        {/* ── Address — always visible + one-tap navigate ──────────────── */}
        <AddressBlock order={order} customer={customer} />

        {/* ── Cash to collect (COD) — shown BEFORE pressing, so the driver
             knows how much to bring/expect while walking up ─────────────── */}
        {isCod && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            marginBottom: 12, padding: "12px 14px", borderRadius: 14,
            background: "color-mix(in srgb, var(--snm-success) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--snm-success) 22%, transparent)",
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--snm-success)" }}>
              Cash to collect
            </span>
            <span className="snm-num" style={{ fontSize: 22, fontWeight: 800, color: "var(--snm-success)", letterSpacing: "-0.02em" }}>
              MVR {totalMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        )}

        {/* ── Issue note (if previously reported) ──────────────────────── */}
        {order.notes && <IssueNote note={order.notes} />}

        {/* ── Primary action button — always on face, never hidden ─────── */}
        {order.status === "confirmed" && (
          <button
            onClick={() => onAction(order.id, { status: "picked", picked_at: new Date().toISOString() })}
            style={{
              width: "100%", height: 56, borderRadius: 16, border: "none",
              background: "var(--foreground)", color: "var(--background)",
              fontSize: 16, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            }}
          >
            <Package size={20} /> Picked from godown
          </button>
        )}

        {order.status === "picked" && (
          <button
            onClick={() => onAction(order.id, { status: "out_for_delivery" })}
            style={{
              width: "100%", height: 56, borderRadius: 16, border: "none",
              background: "var(--snm-info)", color: "#fff",
              fontSize: 16, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              transition: "transform 0.1s",
            }}
            onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
            onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            <Truck size={20} /> Out for delivery
          </button>
        )}

        {order.status === "out_for_delivery" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {isCod ? (
              /* COD: big green button showing the amount — hardest to miss */
              <button
                onClick={() => onCash(order, totalMvr, customer?.name)}
                style={{
                  width: "100%", height: 72, borderRadius: 18, border: "none",
                  background: "var(--snm-success)", color: "#fff", cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                }}
              >
                <span className="snm-num" style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1 }}>
                  MVR {totalMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, display: "flex", alignItems: "center", gap: 4 }}>
                  <CheckCircle2 size={13} /> Collect &amp; Mark Delivered
                </span>
              </button>
            ) : (
              <button
                onClick={() => onAction(order.id, { status: "delivered", delivered_at: new Date().toISOString() })}
                style={{
                  width: "100%", height: 64, borderRadius: 18, border: "none",
                  background: "var(--snm-success)", color: "#fff",
                  fontSize: 18, fontWeight: 800, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                }}
              >
                <CheckCircle2 size={22} /> Mark Delivered
              </button>
            )}

            {/* Report issue — secondary, clearly below primary */}
            <button
              onClick={() => onIssue(order)}
              style={{
                width: "100%", height: 48, borderRadius: 14,
                border: "1.5px solid color-mix(in srgb, var(--snm-error) 35%, transparent)",
                background: "color-mix(in srgb, var(--snm-error) 6%, transparent)",
                color: "var(--snm-error)",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <AlertTriangle size={16} /> Report issue
            </button>
          </div>
        )}

        {order.status === "delivered" && (
          <div style={{
            height: 48, borderRadius: 14,
            background: "color-mix(in srgb, var(--snm-success) 10%, transparent)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <CheckCircle2 size={18} style={{ color: "var(--snm-success)" }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--snm-success)" }}>Delivered</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── main component ─────────────────────────────────────────────────────── */

export function MyDeliveries() {
  const [items, setItems] = useState<OrderWithLines[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // The signed-in driver — passed as the "deliverer" so completion pushes
  // reach the office AND the driver's own device (their confirmation).
  const [userId, setUserId] = useState<string | null>(null);

  const [cashSheet, setCashSheet] = useState<{ open: boolean; order?: SalesOrderRow; customerName?: string; expected: number }>({ open: false, expected: 0 });
  const [issueSheet, setIssueSheet] = useState<{ open: boolean; order?: SalesOrderRow }>({ open: false });

  const CACHE_KEY = "snm_deliveries_cache";

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in");
      setUserId(userData.user.id);
      const [orders, customers, godowns, skusFlat] = await Promise.all([
        listMyDeliveries(userData.user.id),
        listCustomers(),
        listGodowns(),
        listSkusFlat(),
      ]);
      setSkus(skusFlat);
      const customerById = new Map(customers.map((c) => [c.id, c]));
      const godownById = new Map(godowns.map((g) => [g.id, g]));
      const linesByOrder = await listOrderLinesForOrders(orders.map((o) => o.id));
      const enriched: OrderWithLines[] = orders.map((o) => ({
        order: o,
        lines: linesByOrder.get(o.id) ?? [],
        customer: customerById.get(o.customer_id ?? ""),
        godown: godownById.get(o.source_godown_id ?? ""),
      }));
      // Sort: out_for_delivery → picked → confirmed → delivered
      enriched.sort((a, b) => (STATUS_PRIORITY[a.order.status] ?? 9) - (STATUS_PRIORITY[b.order.status] ?? 9));
      setItems(enriched);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ enriched, skusFlat, at: Date.now() })); } catch { /* quota */ }
    } catch (e) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          setItems(cached.enriched ?? []);
          setSkus(cached.skusFlat ?? []);
          const mins = Math.round((Date.now() - cached.at) / 60_000);
          toast.warning(`Offline — data from ${mins < 1 ? "just now" : `${mins}m ago`}`);
          return;
        }
      } catch { /* corrupt cache */ }
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function handleAction(id: string, patch: Record<string, string | number | null>) {
    try {
      const { queued } = await withOfflineFallback(
        () => updateOrder(id, patch),
        { table: "sales_orders", action: "update", payload: patch, match: { id } },
      );
      haptic("success");
      if (queued) toast.info("Saved offline — will sync when connected");

      // Non-cash "Mark Delivered" path — tell the office + confirm to the
      // driver. Skip when queued offline (not real until it syncs). The cash
      // path fires its own notifyDelivered inside CashSheet.save().
      if (patch.status === "delivered" && !queued) {
        const item = items.find((i) => i.order.id === id);
        notifyDelivered(
          {
            title: "Delivery completed",
            body: `${item?.customer?.name ?? "Walk-in"} · ${item?.order.order_number ?? ""}`.trim(),
            url: "/dispatch",
          },
          userId,
        );
      }
      load(true);
    } catch (e) { haptic("error"); toast.error((e as Error).message); }
  }

  const delivered = items.filter((i) => i.order.status === "delivered").length;
  const total = items.length;

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse pb-28">
        {/* Header skeleton */}
        <div className="space-y-2">
          <div className="h-3 w-16 rounded-full" style={{ background: "var(--muted)" }} />
          <div className="h-8 w-44 rounded-xl" style={{ background: "var(--muted)" }} />
          <div className="h-2 rounded-full mt-3" style={{ background: "var(--muted)" }} />
        </div>
        {/* Card skeletons */}
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-[20px] overflow-hidden" style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}>
            <div className="p-4 space-y-3">
              <div className="flex justify-between">
                <div className="h-5 w-20 rounded-full" style={{ background: "var(--muted)" }} />
                <div className="h-11 w-11 rounded-full" style={{ background: "var(--muted)" }} />
              </div>
              <div className="h-6 w-36 rounded-lg" style={{ background: "var(--muted)" }} />
              <div className="h-4 w-28 rounded-full" style={{ background: "var(--muted)" }} />
              <div className="h-14 w-full rounded-2xl" style={{ background: "var(--muted)" }} />
            </div>
            <div className="h-11" style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)", borderTop: "0.5px solid var(--glass-border-lo)" }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="pb-28">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Operations</p>
            <h1 className="ios-page-title">My Deliveries</h1>
          </div>
          <button
            onClick={() => load(true)} disabled={refreshing}
            className="snm-pressable"
            style={{
              width: 44, height: 44, borderRadius: 22, border: "0.5px solid var(--glass-border-lo)",
              background: "var(--glass-bg-1)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <RefreshCw size={16} style={{ color: "var(--muted-foreground)", animation: refreshing ? "spin 1s linear infinite" : "none" }} />
          </button>
        </div>

        {/* Progress bar — always visible if any orders */}
        {total > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                {delivered} of {total} delivered
              </p>
              <p style={{ fontSize: 13, fontWeight: 700, color: delivered === total ? "var(--snm-success)" : "var(--foreground)" }}>
                {Math.round((delivered / total) * 100)}%
              </p>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--glass-border-lo)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 3,
                width: `${(delivered / total) * 100}%`,
                background: delivered === total ? "var(--snm-success)" : "var(--snm-brand)",
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {total === 0 && (
        <div style={{
          background: "var(--glass-bg-1)", backdropFilter: "blur(28px) saturate(180%)",
          borderRadius: 20, padding: "48px 32px", textAlign: "center",
          border: "0.5px solid var(--glass-border-lo)",
          boxShadow: "var(--glass-shadow), var(--glass-inner)",
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18, background: "var(--glass-bg-2)",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
          }}>
            <Truck size={26} style={{ color: "var(--muted-foreground)" }} />
          </div>
          <p style={{ fontSize: 18, fontWeight: 700, color: "var(--foreground)", marginBottom: 8 }}>All caught up!</p>
          <p style={{ fontSize: 14, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
            New deliveries will appear here when an admin assigns them to you.
          </p>
        </div>
      )}

      {/* ── Order cards ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item) => (
          <DeliveryCard
            key={item.order.id}
            item={item}
            skus={skus}
            onAction={handleAction}
            onIssue={(order) => setIssueSheet({ open: true, order })}
            onCash={(order, expected, customerName) => setCashSheet({ open: true, order, expected, customerName })}
          />
        ))}
      </div>

      {/* ── Sheets ──────────────────────────────────────────────────────── */}
      <CashCollectSheet
        open={cashSheet.open} order={cashSheet.order} customerName={cashSheet.customerName} expectedMvr={cashSheet.expected}
        delivererId={userId}
        onClose={() => setCashSheet({ open: false, expected: 0 })}
        onDone={() => { setCashSheet({ open: false, expected: 0 }); load(true); }}
      />
      <IssueSheet
        open={issueSheet.open} order={issueSheet.order}
        onClose={() => setIssueSheet({ open: false })}
        onDone={() => { setIssueSheet({ open: false }); load(true); }}
      />
    </div>
  );
}

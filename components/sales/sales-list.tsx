"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, Plus, Search, ShoppingCart, CheckCircle2,
  Clock, Truck, Package, XCircle, UserPlus, ChevronRight, Trash2,
  Banknote, Smartphone, ArrowRight, ArrowLeft, X, Users, List, ChevronDown, ScanLine,
  Warehouse, TrendingUp, RotateCcw, Phone, MessageCircle, Check,
} from "lucide-react";
import dynamic from "next/dynamic";

// Lazy-load the barcode scanner: it pulls in the heavy @zxing decoding library,
// which we don't want in this route's bundle. It only renders when the user taps
// the scan button, so we fetch the chunk on demand instead of on every visit.
const BarcodeScanner = dynamic(
  () => import("@/components/ui/barcode-scanner").then((m) => m.BarcodeScanner),
  { ssr: false },
);
import {
  listOrdersPage, countOrders, listOrderCustomersPage, peekNextOrderNumber,
  createAndPostSale,
  getTierPricesForSkus, getLastOrderForCustomer,
  ORDER_PAGE_SIZE,
  type SalesOrderRow, type OrderStatus, type OrderChannel, type SaleUom, type TierPrice,
  type LastOrderSummary, type OrderCursor, type OrderPageFilters,
  type OrderCustomerGroup, type CustomerCursor,
} from "@/lib/queries/sales";
import {
  listCustomers, listGodowns,
  type CustomerRow, type GodownRow, type PriceTier,
} from "@/lib/queries/masters";
import { CustomerForm } from "@/components/masters/customer-form";
import { listSkusFlat, getCurrentUserRole, updateSku, type SkuFullRow } from "@/lib/queries/products";
import { SkuIdentity, PriceSourceTag } from "@/components/ui/sku-identity";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { listStockLevels, type StockLevel } from "@/lib/queries/inventory";
import { toPieces, describePriceSource } from "@/lib/queries/sales";
import { withOfflineFallback } from "@/lib/offline-write";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useRefreshHandler } from "@/lib/use-pull-to-refresh";
import { SwipeActions, type SwipeAction } from "@/components/ui/swipe-actions";
import { formatQtyInTradeUnits, formatMixedCartonQty, containerLabel, priceForMargin, sellableTiers, sellUnitLabel, costPerTradeUnit, type TradeUnitConfig, type UnitUom } from "@/lib/trade-units";
import { mvtDayKey, mvtInstant, mvtToday, mvtYesterday } from "@/lib/mvt-date";
import { CARD, CARD_L2 } from "@/lib/surfaces";

// ── Styling constants ─────────────────────────────────────────────────────────



// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft", confirmed: "Confirmed", picked: "Picked",
  out_for_delivery: "Out for Delivery", delivered: "Delivered", cancelled: "Cancelled",
};

const STATUS_COLOR: Record<OrderStatus, { bg: string; text: string }> = {
  draft:            { bg: "var(--muted)",                   text: "var(--muted-foreground)" },
  confirmed:        { bg: "color-mix(in srgb, var(--snm-info) 12%, transparent)",  text: "var(--snm-info)"  },
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


type PaymentMethod = "bank_transfer" | "cod";

interface DraftLine {
  key: string;
  sku: SkuFullRow;
  uom: SaleUom;
  qty: number;
  qty_pieces: number;
  unit_price_mvr: number;
  line_total_mvr: number;
  is_mixed_carton_fill: boolean;
  /** Godown this line is picked from. undefined = the order's godown, which is
   *  the normal case. Set when the product is only stocked somewhere else, so
   *  a sale is never blocked by the warehouse chosen at the start (0164/0165). */
  source_godown_id?: string;
  /** Display only — the name behind source_godown_id. */
  source_godown_name?: string;
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
// diapers/unit goods sell by pack (single retail pack) — but never default to a
// tier the SKU isn't sold in (a carton-only product must default to carton).
function defaultUom(sku: SkuFullRow): SaleUom {
  const su = sku.sellable_units ?? ["pack", "carton"];
  const preferred: SaleUom = sku.unit_uom === "ml" || sku.unit_uom === "g" ? "carton" : "pack";
  if (su.includes(preferred)) return preferred;
  if (su.includes("carton")) return "carton";
  if (su.includes("pack")) return "pack";
  return "carton";
}

// Adapter to the shared trade-unit helpers, so every quantity and per-unit
// cost on this screen is spoken in packs/cartons/bottles by one implementation.
function tradeCfg(sku: SkuFullRow): TradeUnitConfig {
  return {
    pcsPerPack: sku.pcs_per_pack,
    packsPerCarton: sku.packs_per_carton,
    unitUom: sku.unit_uom,
    sellableUnits: sku.sellable_units,
  };
}

/** Quantity text for ONE cart line.
 *
 *  A mixed-carton fill is stated in bottles only — "8 bottles" — never
 *  "1 ctn + 2 bottles". In a MIXED carton the cartons are made ACROSS colours,
 *  so a single colour does not have a carton of its own; printing one there
 *  said something untrue. The carton count belongs to the brand GROUP, and
 *  CartLines shows it in the group header where it is actually meaningful.
 *
 *  Everything else reads in its own selling unit, exactly as before. */
function lineQtyText(l: DraftLine): string {
  const per = l.sku.mixed_carton_pieces;
  if (per && per > 0 && l.is_mixed_carton_fill) {
    const noun = containerLabel(l.sku.unit_uom as UnitUom | null);
    return `${l.qty_pieces} ${plural(noun, l.qty_pieces)}`;
  }
  return `${l.qty} ${plural(sellUnitLabel(l.uom, tradeCfg(l.sku)), l.qty)}`;
}

/** "2 carton" is not a sentence. sellUnitLabel returns the singular noun, so
 *  anything that prints it beside a count has to agree with the count. */
function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

/** The number the +/− buttons move, and the word for it. Every product works
 *  the same way: you step the unit that product is sold in. */
function lineStepUnit(l: DraftLine): { value: number; word: string } {
  const per = l.sku.mixed_carton_pieces;
  if (per && per > 0 && l.is_mixed_carton_fill) {
    const noun = containerLabel(l.sku.unit_uom as UnitUom | null);
    return { value: l.qty_pieces, word: plural(noun, l.qty_pieces) };
  }
  return { value: l.qty, word: plural(sellUnitLabel(l.uom, tradeCfg(l.sku)), l.qty) };
}

/** Unit price for a cart line, quoted in the unit the product is SOLD in.
 *  A mixed fill is stored per bottle so the ledger can split a carton across
 *  colours, but "MVR 37/btl" is a price nobody is charged — the carton rate it
 *  was derived from is the real one. */
function linePriceText(l: DraftLine): string {
  const per = l.sku.mixed_carton_pieces;
  if (per && per > 0 && l.is_mixed_carton_fill) {
    return `MVR ${(l.unit_price_mvr * per).toLocaleString(undefined, { maximumFractionDigits: 0 })}/carton`;
  }
  return `MVR ${l.unit_price_mvr.toLocaleString()}/${sellUnitLabel(l.uom, tradeCfg(l.sku))}`;
}

// ── The cart ─────────────────────────────────────────────────────────────────
// Ali, 2026-08-09: "There must be function to add more products to each order.
// For example I add one case. There must be button or something to let me add
// more to this order or delete from order like a proper checkout page or cart."
// And: "This process should be same for all products. I mean the cart
// component. Not just sosoft. Everything must be harmonized ui/ux."
//
// So: ONE cart, used by New Sale step 2 AND step 3, and every product behaves
// identically — a +/− stepper on the unit that product is sold in, a bin, and
// a button to go back for more. There is no Sosoft-special cart.
//
// What was there before: step 2 had a bin and nothing else, and step 3 was a
// read-only list — no quantity, no delete, no way to add. Once an item was in,
// the only way to change it was to remove it and start again. The app already
// had this pattern in sale-detail.tsx (LineList: tap to edit, bin to remove,
// "Add item" to add); New Sale simply never got it.
//
// The ONE thing that varies by product is INFORMATION, not interaction:
// a mixed-carton brand also gets a group header saying how many cartons its
// lines add up to. That is the number Ali actually sells in, and it is the
// number the database enforces — it cannot be read off any single line,
// because a mixed carton is built across colours. When the group is short, the
// header says by how much and Place Order is blocked, so the shortfall is
// caught here rather than as a server error after the last tap.

interface CartGroup {
  key: string;
  /** Set only for a mixed-carton brand — the group is then a real section. */
  brandName: string | null;
  piecesPerCarton: number;
  unitUom: UnitUom | null;
  lines: DraftLine[];
  /** Pieces across this brand's MIXED lines — what the whole-carton rule counts. */
  mixedPieces: number;
  totalPieces: number;
  totalMvr: number;
}

/** Lines of a mixed-carton brand collapse into one section; everything else is
 *  its own row. First-seen order is preserved either way. */
function groupCartLines(lines: DraftLine[]): CartGroup[] {
  const out: CartGroup[] = [];
  const byBrand = new Map<string, CartGroup>();
  for (const l of lines) {
    const per = l.sku.mixed_carton_pieces ?? 0;
    if (per > 0) {
      let g = byBrand.get(l.sku.brand_id);
      if (!g) {
        g = {
          key: `brand-${l.sku.brand_id}`,
          brandName: l.sku.brand_name,
          piecesPerCarton: per,
          unitUom: (l.sku.unit_uom ?? null) as UnitUom | null,
          lines: [], mixedPieces: 0, totalPieces: 0, totalMvr: 0,
        };
        byBrand.set(l.sku.brand_id, g);
        out.push(g);
      }
      g.lines.push(l);
      if (l.is_mixed_carton_fill) g.mixedPieces += l.qty_pieces;
      g.totalPieces += l.qty_pieces;
      g.totalMvr += l.line_total_mvr;
    } else {
      out.push({
        key: l.key, brandName: null, piecesPerCarton: 0,
        unitUom: (l.sku.unit_uom ?? null) as UnitUom | null,
        lines: [l], mixedPieces: 0, totalPieces: l.qty_pieces, totalMvr: l.line_total_mvr,
      });
    }
  }
  return out;
}

/** Bottles still needed to round a brand's mixed lines up to whole cartons.
 *  0 means the group is valid. Mirrors the database rule exactly (0163). */
function cartonShortfall(g: CartGroup): number {
  if (g.piecesPerCarton <= 0 || g.mixedPieces === 0) return 0;
  const rem = g.mixedPieces % g.piecesPerCarton;
  return rem === 0 ? 0 : g.piecesPerCarton - rem;
}

/** Every mixed-carton group that is not yet a whole number of cartons. */
function cartShortfalls(lines: DraftLine[]): { brand: string; short: number; noun: string }[] {
  return groupCartLines(lines)
    .filter((g) => g.brandName != null && cartonShortfall(g) > 0)
    .map((g) => {
      const short = cartonShortfall(g);
      const noun = containerLabel(g.unitUom);
      return { brand: g.brandName!, short, noun: `${noun}${short === 1 ? "" : "s"}` };
    });
}

/** One item in the cart. Its own card with air around it — Ali, 2026-08-09:
 *  "Each product must have a line break so it's easier for me." Dense divided
 *  rows read as a table of numbers; a card per item reads as a list of things
 *  bought, which is what a cart is. */
function CartItemRow({
  line, hideBrand, editable, onChangeQty, onRemove, maxPiecesFor,
}: {
  line: DraftLine;
  hideBrand: boolean;
  editable: boolean;
  onChangeQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  maxPiecesFor: (line: DraftLine) => number;
}) {
  const l = line;
  const step = lineStepUnit(l);
  const per = l.sku.mixed_carton_pieces && l.is_mixed_carton_fill
    ? 1
    : (l.uom === "carton" ? l.sku.pcs_per_pack * l.sku.packs_per_carton
       : l.uom === "pack" ? l.sku.pcs_per_pack : 1);
  const atCap = l.qty_pieces + per > maxPiecesFor(l);

  return (
    <div className="rounded-2xl p-3.5"
      style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="ios-subhead font-semibold text-foreground truncate">
            {hideBrand ? l.sku.model_name : `${l.sku.brand_name} · ${l.sku.model_name}`}
          </p>
          <p className="ios-footnote truncate" style={{ color: "var(--muted-foreground)" }}>
            {l.sku.variant_display}
          </p>
          <p className="ios-footnote snm-num mt-0.5" style={{ color: "var(--foreground)", opacity: 0.75 }}>
            {lineQtyText(l)} · {linePriceText(l)}
          </p>
          {/* Only shown when this line does NOT come from the order's own
              warehouse — a normal line stays quiet. This is the line the
              picker and the driver have to see. */}
          {l.source_godown_name && (
            <p className="ios-footnote font-semibold mt-0.5" style={{ color: "var(--snm-warning)" }}>
              Pick from {l.source_godown_name}
            </p>
          )}
        </div>
        <span className="ios-subhead font-bold snm-num shrink-0 text-foreground">
          MVR {l.line_total_mvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>

      {editable && (
        <div className="flex items-center justify-between gap-3 mt-3">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => onChangeQty(l.key, -1)}
              disabled={step.value <= 1}
              aria-label="One less"
              className="w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
              style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)", color: "var(--foreground)" }}>
              −
            </button>
            <span className="min-w-[1.5rem] text-center ios-subhead font-bold tabular-nums text-foreground">
              {step.value}
            </span>
            <button
              onClick={() => onChangeQty(l.key, 1)}
              disabled={atCap}
              aria-label="One more"
              className="w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
              +
            </button>
            <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>{step.word}</span>
          </div>
          <button
            onClick={() => onRemove(l.key)}
            aria-label="Remove from order"
            className="snm-pressable w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Small section label inside a brand group. */
function CartSectionLabel({ text, tone }: { text: string; tone?: string }) {
  return (
    <p className="label-caps text-[11px] px-0.5 pt-1"
      style={{ color: tone ?? "var(--foreground)", opacity: tone ? 1 : 0.6 }}>
      {text}
    </p>
  );
}

function CartLines({
  lines, grandTotal, editable, onChangeQty, onRemove, maxPiecesFor,
}: {
  lines: DraftLine[];
  grandTotal: number;
  editable: boolean;
  onChangeQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  maxPiecesFor: (line: DraftLine) => number;
}) {
  if (lines.length === 0) return null;
  const groups = groupCartLines(lines);

  return (
    <div className="space-y-3">
      {/* Ali, 2026-08-09: "What's this big + sign? The actual '+add more' is
          scrolling."
          Both complaints had ONE cause: there were two ways to add another
          product — a pill in this cart and an icon in the footer — and the
          pill scrolled off because the cart scrolls. Adding the second control
          was the mistake; wherever an "add" control is placed INSIDE the page,
          it eventually leaves the screen. So the cart no longer carries one at
          all. It carries the list and the total, nothing else, and the single
          labelled "Add product" lives in the footer, which never moves. */}
      <div className="px-0.5">
        <p className="label-caps" style={{ color: "var(--muted-foreground)" }}>
          Order items · {lines.length}
        </p>
      </div>

      {groups.map((g) => {
        // Inside a mixed-carton brand, a whole carton of one colour and
        // bottles that make up a mixed carton are two different purchases and
        // must never share a list. Ali, 2026-08-09: "There is no
        // differentiator line between the single color carton and mix carton."
        const full = g.lines.filter((l) => !l.is_mixed_carton_fill);
        const mixed = g.lines.filter((l) => l.is_mixed_carton_fill);
        const short = cartonShortfall(g);
        const mixedCartons = g.piecesPerCarton > 0
          ? Math.floor(g.mixedPieces / g.piecesPerCarton) : 0;
        const noun = containerLabel(g.unitUom);

        // An ordinary product: one card, nothing around it.
        if (!g.brandName) {
          return (
            <CartItemRow key={g.key} line={g.lines[0]} hideBrand={false}
              editable={editable} onChangeQty={onChangeQty} onRemove={onRemove}
              maxPiecesFor={maxPiecesFor} />
          );
        }

        return (
          <div key={g.key} className="rounded-2xl p-3 space-y-2"
            style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <div className="min-w-0">
                <p className="ios-subhead font-bold text-foreground truncate">{g.brandName}</p>
                <p className="ios-footnote snm-num" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                  {formatMixedCartonQty(g.totalPieces, g.piecesPerCarton, g.unitUom)}
                </p>
              </div>
              <span className="ios-subhead font-bold snm-num shrink-0 text-foreground">
                MVR {g.totalMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>

            {full.length > 0 && (
              <>
                <CartSectionLabel text="Full cartons · one colour" />
                {full.map((l) => (
                  <CartItemRow key={l.key} line={l} hideBrand
                    editable={editable} onChangeQty={onChangeQty} onRemove={onRemove}
                    maxPiecesFor={maxPiecesFor} />
                ))}
              </>
            )}

            {mixed.length > 0 && (
              <>
                <CartSectionLabel
                  text={short > 0
                    ? `Mixed · ${g.mixedPieces} of ${(mixedCartons + 1) * g.piecesPerCarton} ${noun}s`
                    : `Mixed carton${mixedCartons === 1 ? "" : "s"} · ${mixedCartons} × ${g.piecesPerCarton} ${noun}s`}
                  tone={short > 0 ? "var(--snm-error)" : undefined}
                />
                {short > 0 && (
                  <p className="ios-footnote font-semibold px-0.5" style={{ color: "var(--snm-error)" }}>
                    {short} more {noun}{short === 1 ? "" : "s"} to fill the carton — {g.brandName} is only sold by the carton
                  </p>
                )}
                {mixed.map((l) => (
                  <CartItemRow key={l.key} line={l} hideBrand
                    editable={editable} onChangeQty={onChangeQty} onRemove={onRemove}
                    maxPiecesFor={maxPiecesFor} />
                ))}
              </>
            )}
          </div>
        );
      })}

      <div className="flex justify-between items-center px-3.5 py-3 rounded-2xl ios-subhead font-bold"
        style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
        <span style={{ color: "var(--muted-foreground)" }}>Total</span>
        <span className="text-foreground snm-num">MVR {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function GlassSelect({ label, value, onChange, children }: {
  label?: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none appearance-none"
        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
      >
        {children}
      </select>
    </div>
  );
}

// ── Prominent warehouse picker ────────────────────────────────────────────────
// The godown a sale ships from decides which stock gets deducted, so a wrong
// pick is a real operational error. This makes it impossible to skip past: a
// brand-accented card with an icon and the chosen warehouse shown large, with
// the native <select> laid transparently over the whole card for tapping.
function WarehouseSelect({ value, onChange, godowns }: {
  value: string; onChange: (v: string) => void; godowns: GodownRow[];
}) {
  const selected = godowns.find((g) => g.id === value);
  // Nothing chosen yet = the reminder state. Ali asked to be prompted on every
  // order, so the field starts empty and asks, rather than quietly pre-filling
  // the default and hoping he notices. Warning-toned so it reads as an
  // outstanding decision, not decoration.
  const unset = !selected;
  return (
    <div
      className="relative rounded-2xl px-4 py-3.5 flex items-center gap-3.5"
      style={unset
        ? {
            background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)",
            border: "1.5px solid color-mix(in srgb, var(--snm-warning) 45%, transparent)",
          }
        : {
            background: "var(--snm-brand-muted)",
            border: "1.5px solid var(--snm-brand-border)",
          }}
    >
      <div
        className="shrink-0 flex items-center justify-center rounded-xl"
        style={{ width: 44, height: 44, background: unset ? "var(--snm-warning)" : "var(--snm-brand)" }}
      >
        <Warehouse className="h-6 w-6" style={{ color: unset ? "var(--background)" : "var(--snm-brand-on)" }} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] uppercase tracking-widest font-semibold"
          style={{ color: unset ? "var(--snm-warning)" : "var(--snm-brand-text)" }}>
          {unset ? "Choose warehouse first" : "Ship from warehouse"}
        </p>
        <p className="ios-body font-bold text-foreground truncate">
          {selected ? `${selected.name}${selected.is_default ? " (usual)" : ""}` : "Tap to choose"}
        </p>
      </div>
      <ChevronDown className="h-5 w-5 shrink-0" style={{ color: unset ? "var(--snm-warning)" : "var(--snm-brand-text)" }} />
      {/* Transparent native select covers the card so the whole thing is tappable */}
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        aria-label="Ship from warehouse"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {/* Placeholder keeps the picker genuinely unset on open, so the wheel
            doesn't land on a warehouse he never actually chose. */}
        <option value="" disabled>Choose warehouse…</option>
        {godowns.map((g) => (
          <option key={g.id} value={g.id}>{g.name}{g.is_default ? " (usual)" : ""}</option>
        ))}
      </select>
    </div>
  );
}

// ── Order row (memoized — search re-renders SalesList on every keystroke,
// but a row only needs to re-render if its own order/customer changed) ──────

const OrderRow = memo(function OrderRow({ order: o, customer: cust }: { order: SalesOrderRow; customer?: CustomerRow }) {
  const Icon = STATUS_ICON[o.status];
  const colors = STATUS_COLOR[o.status];
  const total = o.order_total_mvr ?? 0;

  // Three lines, in the order you actually read them: WHO, WHAT, then the
  // reference. The order number used to share line one with the customer
  // name and truncated it to a couple of characters — but you never scan
  // this list for "SO-2026-080", you scan it for a person. Name now owns
  // the top line at Body size (17pt, Apple's floor for the primary label);
  // the reference drops to Footnote underneath.
  const owed = o.balance_mvr ?? 0;
  const isOwed = o.status !== "cancelled" && o.status !== "draft" && owed > 0.005;

  // Swipe left for the two things actually done from this list: ring the
  // customer, or message them. Deliberately no money action here — recording
  // a payment needs the amount and method, which is a sheet, not a swipe.
  const phone = cust?.phone?.replace(/[^\d+]/g, "") ?? "";
  const swipeActions: SwipeAction[] = phone
    ? [
        {
          label: "Call",
          icon: <Phone className="h-4 w-4" />,
          background: "var(--snm-info)",
          onSelect: () => { window.location.href = `tel:${phone}`; },
        },
        {
          label: "WhatsApp",
          icon: <MessageCircle className="h-4 w-4" />,
          background: "var(--snm-success)",
          onSelect: () => {
            const digits = phone.replace(/\D/g, "");
            // Maldives numbers are stored locally (7 digits); wa.me needs the
            // country code or it silently opens an empty chat.
            const intl = digits.length <= 7 ? `960${digits}` : digits;
            const msg = isOwed
              ? `Hello${cust?.name ? ` ${cust.name}` : ""}, about order ${o.order_number} — MVR ${owed.toLocaleString(undefined, { maximumFractionDigits: 2 })} is still outstanding.`
              : `Hello${cust?.name ? ` ${cust.name}` : ""}, about your order ${o.order_number}.`;
            window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
          },
        },
      ]
    : [];

  return (
    <SwipeActions actions={swipeActions}>
    <Link href={`/sales/${o.id}`}
      className="flex items-start gap-3 p-4 rounded-2xl snm-pressable active:opacity-80"
      style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
    >
      {/* Neutral tile — the pill below already states status in color;
          painting it twice per row was the "light green everywhere" wash
          Ali flagged. One row, one colored element. */}
      <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        {/* WHO — and what it cost. Tabular figures so the money column
            stays aligned down the list instead of jittering per row. */}
        <div className="flex items-baseline gap-2">
          <p className="text-[17px] font-semibold text-foreground truncate flex-1 min-w-0" style={{ letterSpacing: "-0.012em" }}>
            {cust?.name ?? "Walk-in"}
          </p>
          {total > 0 && (
            <p className="text-[16px] font-bold text-foreground snm-num shrink-0">
              {total >= 10000 ? `${(total / 1000).toFixed(1)}K` : total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              <span className="text-[11px] font-semibold ml-0.5" style={{ color: "var(--muted-foreground)" }}>MVR</span>
            </p>
          )}
        </div>

        {/* WHAT — built in Postgres so pack/carton maths never happens here.
            Two lines max: a mixed carton lists its full scent split. */}
        {o.items_summary && (
          <p
            className="text-[15px] mt-0.5"
            style={{
              color: "var(--foreground)",
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {o.items_summary}
          </p>
        )}

        {/* Reference line — never competes with the two above. */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <span className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>{o.order_number}</span>
          <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>·</span>
          <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>{o.channel}</span>
          <span className="text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 shrink-0" style={{ background: colors.bg, color: colors.text }}>
            {STATUS_LABEL[o.status]}
          </span>
          {/* Money still outstanding is the one thing worth a second colour. */}
          {isOwed && (
            <span className="text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 shrink-0 snm-num"
              style={{ background: "color-mix(in srgb, var(--snm-error) 15%, transparent)", color: "var(--snm-error)" }}>
              Owes {owed.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          )}
        </div>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 mt-2" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
    </Link>
    </SwipeActions>
  );
});

// ── SalesList ─────────────────────────────────────────────────────────────────

/** "Today" / "Yesterday" / "24 Jul" — the heading the order list groups under,
 *  so the newest-first sort is visible instead of looking arbitrary. */
function dayLabel(iso: string): string {
  // Malé days, not the device's. This used to compare local midnights, so an
  // order placed at 00:30 in Malé headed a "Yesterday" group on a phone set to
  // UTC while every total beside it came from Postgres on the Maldives day.
  const day = mvtDayKey(iso);
  if (day === mvtToday()) return "Today";
  if (day === mvtYesterday()) return "Yesterday";
  const sameYear = day.slice(0, 4) === mvtToday().slice(0, 4);
  return mvtInstant(iso, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// Monotonic key source for cart lines. Replaces Date.now() in the repeat-order
// builder: a counter can't collide inside the same millisecond, and it's pure
// (Date.now() is not, which the React Compiler flags).
let cartLineSeq = 0;
const nextCartLineKey = (skuId: string) => `${skuId}-r${++cartLineSeq}`;

export function SalesList() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  // ?filter=unpaid → show every order still owing money, matching the
  // dashboard "Unpaid" tile and the Finance "Owed" panel exactly. Both read
  // get_receivables_aging(): any active order (not draft/cancelled) whose
  // payment isn't settled — whether it's confirmed, on the road, or already
  // delivered. It is NOT delivered-only; a confirmed bank-transfer order the
  // customer hasn't paid is money Ali is still owed and wants to chase.
  const unpaidMode   = searchParams.get("filter") === "unpaid";

  const [rows, setRows] = useState<SalesOrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [newDialog, setNewDialog] = useState(false);
  const [groupBy, setGroupBy] = useState<"orders" | "customers">("orders");
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    getCurrentUserRole().then((r) => {
      setCanWrite(r !== "viewer");
    }).catch(() => {});
  }, []);

  // ── Paging state ─────────────────────────────────────────────────────────
  // Orders arrive one page at a time, newest first, filtered and searched in
  // Postgres. See listOrdersPage() for why it's a keyset cursor rather than
  // page numbers. `rows` therefore holds only what's been scrolled to — never
  // the whole ledger.
  const [cursor, setCursor]         = useState<OrderCursor | null>(null);
  const [hasMore, setHasMore]       = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [matchCount, setMatchCount] = useState(0);

  // Grouped-by-customer view — rolled up in Postgres for the same reason.
  const [custGroups, setCustGroups]   = useState<OrderCustomerGroup[]>([]);
  const [custCursor, setCustCursor]   = useState<CustomerCursor | null>(null);
  const [custHasMore, setCustHasMore] = useState(false);
  // Orders for whichever customer groups are expanded, fetched on demand.
  const [groupOrders, setGroupOrders] = useState<Map<string, SalesOrderRow[]>>(new Map());

  // Debounced search — one query per pause in typing, not per keystroke.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filters: OrderPageFilters = useMemo(
    () => ({ status: statusFilter, search: debouncedQ, unpaid: unpaidMode }),
    [statusFilter, debouncedQ, unpaidMode],
  );

  /** Catalogue data — customers, SKUs, godowns, stock. All bounded lists that
   *  the New Sale wizard needs in full, so they stay a single load. */
  async function loadSupporting() {
    const [c, sk, g, lvl] = await Promise.all([
      listCustomers(), listSkusFlat(), listGodowns(), listStockLevels(),
    ]);
    setCustomers(c); setSkus(sk); setGodowns(g); setStockLevels(lvl);
  }

  useEffect(() => {
    loadSupporting().catch((e) => toast.error((e as Error).message));
  }, []);

  /** First page for the current filters. Also runs on refresh after a save,
   *  which is why it swaps rows in place rather than clearing them first —
   *  no skeleton flash on an existing list. */
  const loadFirstPage = useCallback(async () => {
    try {
      if (groupBy === "orders") {
        const [page, count] = await Promise.all([
          listOrdersPage(filters, null),
          countOrders(filters),
        ]);
        setRows(page.rows);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setMatchCount(count);
      } else {
        const [page, count] = await Promise.all([
          listOrderCustomersPage(filters, null),
          countOrders(filters),
        ]);
        setCustGroups(page.rows);
        setCustCursor(page.nextCursor);
        setCustHasMore(page.hasMore);
        setMatchCount(count);
        setGroupOrders(new Map());
        setExpandedCustomers(new Set());
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [filters, groupBy]);

  // Refetch whenever the filter set or the view changes. The cursor resets
  // implicitly because loadFirstPage always starts from null.
  useEffect(() => {
    let cancelled = false;
    loadFirstPage().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadFirstPage]);

  /** Refresh after a mutation — keeps the current filters and view. */
  const load = loadFirstPage;

  // Pull down at the top of the list to reload it. loadFirstPage swaps rows in
  // place, so there is no skeleton flash behind the spinner.
  useRefreshHandler(loadFirstPage);

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      if (groupBy === "orders") {
        if (!cursor) return;
        const page = await listOrdersPage(filters, cursor);
        setRows((prev) => [...prev, ...page.rows]);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } else {
        if (!custCursor) return;
        const page = await listOrderCustomersPage(filters, custCursor);
        setCustGroups((prev) => [...prev, ...page.rows]);
        setCustCursor(page.nextCursor);
        setCustHasMore(page.hasMore);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  // Auto-load as the sentinel scrolls into view — the next page is already
  // arriving by the time the last row is on screen, so it reads as one
  // continuous list. The button below it stays as the visible, tappable
  // fallback (and the only control that works with reduced motion / when the
  // observer never fires).
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    const more = groupBy === "orders" ? hasMore : custHasMore;
    if (!el || !more || loadingMore) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
      { rootMargin: "400px" },   // start fetching before it's actually visible
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, hasMore, custHasMore, loadingMore, cursor, custCursor, filters]);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  /** True when anything is narrowing the list — used to tell "no sales yet"
   *  apart from "no matches". */
  const filtersActive = statusFilter !== "all" || debouncedQ !== "" || unpaidMode;

  // Server already filtered, searched and ordered these.
  const visibleOrders = rows;

  /** Expand/collapse a customer group, fetching that customer's orders the
   *  first time it opens (one small query, not the whole ledger up front). */
  async function toggleCustomer(key: string, customerId: string | null) {
    const isOpen = expandedCustomers.has(key);
    setExpandedCustomers((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(key); else next.add(key);
      return next;
    });
    if (isOpen || groupOrders.has(key)) return;
    try {
      const page = await listOrdersPage(
        { ...filters, customerId: customerId ?? undefined },
        null,
        100,
      );
      // Walk-in orders have no customer_id, so the server can't filter to
      // them — narrow client-side for that one bucket.
      const rowsForKey = customerId ? page.rows : page.rows.filter((o) => !o.customer_id);
      setGroupOrders((prev) => new Map(prev).set(key, rowsForKey));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-2.5 w-20 rounded-full" style={{ background: "var(--muted)" }} />
          <div className="h-8 w-24 rounded-xl" style={{ background: "var(--muted)" }} />
        </div>
        <div className="h-11 w-28 rounded-2xl" style={{ background: "var(--muted)" }} />
      </div>
      {/* Search bar */}
      <div className="h-12 rounded-2xl" style={{ background: "var(--muted)" }} />
      {/* Filter chips */}
      <div className="flex gap-2">
        {[64, 40, 72, 56, 80, 64].map((w, i) => (
          <div key={i} className="h-11 rounded-full shrink-0" style={{ width: w, background: "var(--muted)" }} />
        ))}
      </div>
      {/* Order cards */}
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-3 p-4 rounded-2xl" style={{ background: "var(--glass-1)" }}>
            <div className="h-10 w-10 rounded-xl shrink-0" style={{ background: "var(--muted)" }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-32 rounded-full" style={{ background: "var(--muted)" }} />
              <div className="h-2.5 w-20 rounded-full" style={{ background: "var(--muted)" }} />
            </div>
            <div className="h-6 w-16 rounded-lg" style={{ background: "var(--muted)" }} />
          </div>
          <div className="h-11 w-11 rounded-xl shrink-0" style={{ background: "var(--muted)" }} />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[12px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Operations</p>
          <h1 className="ios-page-title">Sales</h1>
        </div>
        {canWrite && (
          <button
            onClick={() => setNewDialog(true)}
            className="flex items-center gap-2 h-11 px-5 rounded-2xl text-sm font-semibold transition active:scale-95"
            style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}
          >
            <Plus className="h-4 w-4" /> New Sale
          </button>
        )}
      </div>

      {/* Unpaid filter banner — shown when arriving from dashboard */}
      {unpaidMode && (
        <div
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
          style={{
            background: "color-mix(in srgb, var(--snm-error) 8%, var(--glass-1))",
            border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)",
            boxShadow: "var(--glass-shadow), var(--glass-inner)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--snm-error)" }} />
            <p className="ios-subhead font-semibold text-foreground">
              Showing {matchCount} order{matchCount !== 1 ? "s" : ""} awaiting payment
            </p>
          </div>
          <button
            onClick={() => router.push("/sales")}
            className="ios-subhead font-medium shrink-0"
            style={{ color: "var(--muted-foreground)" }}
          >
            Clear ✕
          </button>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3 rounded-2xl px-4 h-12" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer…"
          aria-label="Search orders"
          className="flex-1 bg-transparent ios-subhead text-foreground placeholder:text-muted-foreground outline-none" />
        {q && (
          <button onClick={() => setQ("")} aria-label="Clear search" className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 active:opacity-60"
            style={{ color: "var(--muted-foreground)" }}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Status filter chips */}
      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {([
          { key: "all" as const, label: "All" },
          ...( Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => ({ key: s as "all" | OrderStatus, label: STATUS_LABEL[s] })),
        ]).map(({ key, label }) => {
          const active = statusFilter === key;
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className="shrink-0 h-11 px-4 rounded-full text-[14px] font-semibold transition active:scale-95"
              style={{
                background: active ? "var(--glass-accent)" : "var(--glass-1)",
                color:      active ? "var(--snm-brand-on)" : "var(--muted-foreground)",
                border:     active ? "none" : "0.5px solid var(--glass-border-lo)",
                touchAction: "manipulation",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* View toggle — Orders (flat) vs Customers (grouped) */}
      <div className="flex rounded-xl overflow-hidden" style={{ ...CARD }}>
        {([
          { val: "orders",    icon: List,  label: "Orders"    },
          { val: "customers", icon: Users, label: "Customers" },
        ] as const).map(({ val, icon: Icon, label }) => (
          <button key={val} onClick={() => setGroupBy(val)}
            className="flex-1 flex items-center justify-center gap-2 h-10 text-[14px] font-semibold transition"
            style={groupBy === val
              ? { background: "var(--glass-accent)", color: "var(--snm-brand-on)" }
              : { background: "transparent", color: "var(--muted-foreground)" }}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {matchCount === 0 ? (
        <div className="rounded-2xl p-10 flex flex-col items-center text-center space-y-3" style={CARD}>
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
            <ShoppingCart className="h-6 w-6 text-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">{filtersActive ? "No matches" : "No sales yet"}</h3>
          <p className="ios-subhead max-w-sm" style={{ color: "var(--muted-foreground)" }}>
            {unpaidMode ? "Every order has been paid. Nothing outstanding." : !filtersActive ? "Record a sale when a customer messages you on WhatsApp, Viber, or other channels." : "Try a different filter."}
          </p>
          {!filtersActive && (
            <button onClick={() => setNewDialog(true)} className="mt-2 h-11 px-6 rounded-2xl ios-subhead font-semibold"
              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
              Record first sale
            </button>
          )}
        </div>

      ) : groupBy === "orders" ? (
        /* ── Order list, newest first, under day headings ──────────────────
           The list is sorted by order date (newest first) — status is NOT a
           sort key, so a confirmed order sits above an older delivered one.
           That's the standard for an order log, but with no date on the rows
           the ordering looked arbitrary. Day headings make the sort visible. */
        <div className="space-y-1.5">
          {/* Make the paging visible. The list loads 30 at a time and pulls
              more only as you scroll, but with a small order book that is
              invisible — everything fits in a page or two, so it looks like
              the whole ledger downloaded (Ali asked exactly this). Saying
              "showing 30 of 53" states the bound outright. */}
          {hasMore && (
            <p className="ios-footnote px-1 pb-0.5" style={{ color: "var(--muted-foreground)" }}>
              Showing {rows.length} of {matchCount} · more load as you scroll
            </p>
          )}
          {visibleOrders.map((o, i) => {
            const day = dayLabel(o.created_at);
            const showHeading = i === 0 || dayLabel(visibleOrders[i - 1].created_at) !== day;
            return (
              <div key={o.id} className={showHeading && i > 0 ? "pt-3" : undefined}>
                {showHeading && (
                  <p className="text-[11px] font-bold uppercase tracking-wide px-1 pb-1.5"
                    style={{ color: "var(--muted-foreground)" }}>
                    {day}
                  </p>
                )}
                <OrderRow order={o} customer={customerById.get(o.customer_id ?? "")} />
              </div>
            );
          })}
          {/* Sentinel: the next page starts loading 400px before this is on
              screen, so scrolling feels continuous. */}
          {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full h-12 rounded-2xl ios-subhead font-semibold transition active:scale-[0.99] flex items-center justify-center gap-2"
              style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}
            >
              {loadingMore
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
                : `Load more (${Math.max(0, matchCount - rows.length)} more)`}
            </button>
          )}
          {!hasMore && rows.length >= ORDER_PAGE_SIZE && (
            <p className="ios-footnote text-center pt-2" style={{ color: "var(--muted-foreground)" }}>
              All {matchCount} orders shown
            </p>
          )}
        </div>

      ) : (
        /* ── Grouped by customer ── */
        <div className="space-y-2">
          {custGroups.map((g) => {
            const key = g.customer_id ?? "__walkin__";
            const isOpen = expandedCustomers.has(key);
            const toggle = () => toggleCustomer(key, g.customer_id);
            const name = g.name ?? "Walk-in";
            const initials = name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
            // Counts come from Postgres — they cover ALL of this customer's
            // matching orders, not just the ones downloaded so far.
            const active    = g.active_count;
            const delivered = g.delivered_count;
            const orders    = groupOrders.get(key) ?? [];

            return (
              <div key={key} className="rounded-2xl overflow-hidden" style={CARD}>
                {/* Customer header row — always visible */}
                <button onClick={toggle} aria-expanded={isOpen}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left snm-pressable">
                  <div className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                    style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}>
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-foreground">{name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                        {g.orders_count} order{g.orders_count !== 1 ? "s" : ""}
                      </span>
                      {active > 0 && (
                        <span className="ios-subhead font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: "color-mix(in srgb, var(--snm-warning) 15%, transparent)", color: "var(--snm-warning)" }}>
                          {active} active
                        </span>
                      )}
                      {g.island && (
                        <span className="ios-subhead" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>{g.island}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 mr-1">
                    <p className="ios-subhead font-semibold text-foreground">{delivered} done</p>
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>of {g.orders_count}</p>
                  </div>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 transition-transform"
                    style={{ color: "var(--muted-foreground)", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>

                {/* Expanded order rows */}
                {isOpen && (
                  <div style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                    {!groupOrders.has(key) && (
                      <div className="flex items-center justify-center gap-2 px-4 py-4 ios-subhead"
                        style={{ color: "var(--muted-foreground)" }}>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading orders…
                      </div>
                    )}
                    {orders.map((o) => {
                      const Icon = STATUS_ICON[o.status];
                      const colors = STATUS_COLOR[o.status];
                      // Plain tappable row — Void/Delete live on the order
                      // detail screen, one tap away via this link.
                      return (
                        <Link key={o.id} href={`/sales/${o.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-3 snm-pressable"
                          style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <p className="ios-subhead font-semibold text-foreground">{o.order_number}</p>
                              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                                {mvtInstant(o.created_at)} · via {o.channel}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[12px] uppercase tracking-widest font-semibold rounded-lg px-2 py-1" style={{ background: colors.bg, color: colors.text }}>
                              {STATUS_LABEL[o.status]}
                            </span>
                            <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)" }} />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {custHasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
          {custHasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full h-12 rounded-2xl ios-subhead font-semibold transition active:scale-[0.99] flex items-center justify-center gap-2"
              style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}
            >
              {loadingMore
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
                : "Load more customers"}
            </button>
          )}
        </div>
      )}

      {newDialog && canWrite && (
        <NewSaleSheet
          customers={customers} skus={skus} godowns={godowns}
          stockLevels={stockLevels}
          onClose={() => setNewDialog(false)}
          onCreated={(id) => { setNewDialog(false); load(); if (id !== "reload") router.push(`/sales/${id}`); }}
          onCustomerCreated={(c) => setCustomers((prev) => [c, ...prev])}
        />
      )}

    </div>
  );
}

// ── NewSaleSheet ──────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

function NewSaleSheet({
  customers, skus, godowns, stockLevels, onClose, onCreated, onCustomerCreated,
}: {
  customers: CustomerRow[]; skus: SkuFullRow[]; godowns: GodownRow[];
  stockLevels: StockLevel[];
  onClose: () => void; onCreated: (id: string) => void;
  onCustomerCreated: (c: CustomerRow) => void;
}) {
  // This full-screen sheet uses the calmer wallpaper variant (see
  // .glass-wallpaper--calm) since it's a dense list of thin rows rather
  // than a few large cards — same bokeh, muted, so rows stay legible. On
  // top of that muted backdrop the denser CARD_L2 fill reads as glass the
  // same way Dashboard's cards do; shadows the outer CARD constant for
  // every ...CARD spread in this function.
  const CARD = CARD_L2;

  // Portal target — mounted flag set in an effect (not a bare `typeof
  // document !== "undefined"` inline check), because that inline check
  // still evaluates during React's render pass and can race with
  // hydration: createPortal was thrown with "Target container is not a
  // DOM element" and crashed this entire component, silently falling back
  // to a broken render that LOOKED like the old, unfixed sheet — which is
  // exactly why the previous fix appeared to do nothing. Gating on a
  // state flag flipped inside useEffect guarantees this only ever runs
  // client-side, after mount, when document.body is unquestionably real.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  const [step, setStep] = useState<Step>(1);
  // Preview only — assign_sales_order_number assigns the real one atomically
  // on insert. Read from the live counter rather than guessed from whichever
  // orders happened to be downloaded (the list is paged now, so guessing from
  // memory would show a number already in use). Blank until it arrives, and
  // stays blank offline rather than showing a confident wrong number.
  const [orderNumber, setOrderNumber] = useState("");
  // Offline queue key. Independent of the preview above: offline is exactly
  // when the preview can't be read, and two orders keyed "offline-" would
  // collide in the queue.
  const [offlineKey] = useState(() => `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  useEffect(() => {
    let cancelled = false;
    peekNextOrderNumber()
      .then((n) => { if (!cancelled) setOrderNumber(n); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [channel, setChannel] = useState<OrderChannel>("whatsapp");

  // Step 1 — customer
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  // Order-level tier override — defaults to customer's tier, can be changed per order
  const [orderTier, setOrderTier] = useState<PriceTier>("retail");

  // Step 2 — products
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [skuSearch, setSkuSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [lineUom, setLineUom] = useState<SaleUom>("pack");
  const [lineQty, setLineQty] = useState("");
  const [linePrice, setLinePrice] = useState("");
  const [mixedCarton, setMixedCarton] = useState(false);
  // Deliberately NOT pre-filled with the default warehouse. Ali asked to be
  // reminded on every order which godown ships it, and the reason he was
  // "forgetting to choose" is that it was already chosen for him — so he was
  // really forgetting to CHANGE it on the ~7% of orders that ship from the
  // other warehouse, and a wrong pick only surfaced later at a stock count.
  // Starting empty makes it one deliberate tap every time. That is the
  // reminder: unmissable, and impossible to swipe away.
  const [godownId, setGodownId] = useState("");

  // Step 3 — payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [orderNotes, setOrderNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Tier pricing — fetched once when customer is confirmed and we move to step 2
  const [tierPrices, setTierPrices] = useState<Map<string, TierPrice>>(new Map());

  // "Repeat last order" — the customer's previous basket, fetched when a real
  // customer is picked. Shops mostly reorder the same basket; one tap rebuilds
  // it at TODAY's tier prices (never the old prices — fixed-price rule).
  const [lastOrder, setLastOrder] = useState<LastOrderSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLastOrder(null);
    if (!customerId || customerId === "walkin") return;
    getLastOrderForCustomer(customerId)
      .then((lo) => { if (!cancelled) setLastOrder(lo); })
      .catch(() => { /* non-fatal — banner simply doesn't show */ });
    return () => { cancelled = true; };
  }, [customerId]);

  const customer = customers.find((c) => c.id === customerId);
  // Local price fixes made from the "why is this the price?" sheet (see
  // showPriceExplain below) — applied on top of the parent's `skus` list so
  // a correction is reflected immediately without leaving New Sale or
  // waiting for the parent to reload. The parent's own data refreshes
  // normally next time this screen loads.
  const [priceOverrides, setPriceOverrides] = useState<Record<string, Partial<SkuFullRow>>>({});
  const selectedSku = useMemo(() => {
    const base = skus.find((s) => s.id === selectedSkuId);
    if (!base) return base;
    const ov = priceOverrides[base.id];
    return ov ? { ...base, ...ov } : base;
  }, [skus, selectedSkuId, priceOverrides]);

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
    // Phone is the primary identity for repeat customers. Normalise both sides
    // (strip +960 / spaces / dashes) so typing "7712345" matches a stored
    // "+960 771 2345". Text still matches name/island as before.
    const digits = term.replace(/\D/g, "").replace(/^960/, "");
    const normPhone = (p: string | null) => (p ?? "").replace(/\D/g, "").replace(/^960/, "");
    return customers.filter((c) => {
      const textHit = [c.name, c.phone ?? "", c.island ?? ""].join(" ").toLowerCase().includes(term);
      const phoneHit = digits.length >= 3 && normPhone(c.phone).includes(digits);
      return textHit || phoneHit;
    }).slice(0, 10);
  }, [customers, customerSearch]);

  const filteredSkus = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    const matched = term
      ? active.filter((s) => [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""].join(" ").toLowerCase().includes(term))
      : active;
    // Stock in the CHOSEN godown vs across ALL godowns. Two different questions:
    // "where does it ship from" (chosen) vs "do we own it at all" (total).
    const stockFor = (s: SkuFullRow) =>
      godownId ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0 : 1;
    const totalStockFor = (s: SkuFullRow) =>
      stockLevels.filter((l) => l.sku_id === s.id).reduce((sum, l) => sum + l.qty_pieces, 0);
    // NEVER hide a product we own. Show every SKU with stock in ANY godown, so a
    // product sitting in another warehouse can't be mistaken for out-of-stock and
    // lose a sale (the card will say "None here · N in <other>"). Only SKUs with
    // zero stock EVERYWHERE drop to the bottom (dimmed). When searching by name we
    // show all matches so a typed product never vanishes.
    const pool = term ? matched : matched.filter((s) => totalStockFor(s) > 0);
    // Rank: in the chosen godown first, then owned-elsewhere, then zero-everywhere.
    const rank = (s: SkuFullRow) => (stockFor(s) > 0 ? 2 : totalStockFor(s) > 0 ? 1 : 0);
    const ranked = [...pool].sort((a, b) => rank(b) - rank(a));
    // Cap raised from the old flat-list limit — SKUs are now grouped by
    // brand/model (see normalSkus below), so this only needs to bound a
    // pathological catalogue size, not the visible row count.
    return ranked.slice(0, 400);
  }, [skus, skuSearch, godownId, stockLevels]);

  const stockHere = selectedSku && godownId
    ? stockLevels.find((l) => l.sku_id === selectedSku.id && l.godown_id === godownId)?.qty_pieces ?? 0
    : null;

  // ── Mixed-carton brands (e.g. Sosoft: 5 scents, sold as a carton the
  // customer fills with any mix) collapse to ONE card in the grid instead of
  // one per SKU — opening MixedCartonSheet instead of the single-SKU editor.
  // brands.mixed_carton_pieces is the data-driven flag (migration 0065):
  // any brand can opt in, nothing here is hardcoded to "Sosoft".
  const { normalSkus, mixedCartonGroups } = useMemo(() => {
    const groups = new Map<string, SkuFullRow[]>();
    const normal: SkuFullRow[] = [];
    for (const s of filteredSkus) {
      if (s.mixed_carton_pieces != null) {
        const arr = groups.get(s.brand_id) ?? [];
        arr.push(s);
        groups.set(s.brand_id, arr);
      } else {
        normal.push(s);
      }
    }
    return { normalSkus: normal, mixedCartonGroups: groups };
  }, [filteredSkus]);

  const [mixedCartonBrandId, setMixedCartonBrandId] = useState<string | null>(null);
  /** The catalogue block, so the cart's "Add more" pill can bring it back into
   *  view — on step 2 the products are already on screen, just scrolled past. */
  const productSearchRef = useRef<HTMLDivElement | null>(null);

  // ── Brand → Model grouping for the normal product grid ──
  // Mamypoko alone spans 5 model lines (Royal Soft, Royal Soft Boy/Girl,
  // Skin Comfort, Xtra Kering) — flattened by SKU this became a long scroll
  // of near-identical cards. Brand stays a fixed section label (never
  // collapses, always visible); each model underneath is independently
  // collapsible, same chevron-row control Products already uses for its
  // brand divider, one level deeper. Collapsed by default — New Sale's job
  // is scanning many brands fast, the opposite default from the Products
  // catalogue (which stays expanded since that screen IS the catalogue).
  const brandModelGroups = useMemo(() => {
    const brands = new Map<string, { brandId: string; brandName: string; models: Map<string, { modelId: string; modelName: string; skus: SkuFullRow[] }> }>();
    for (const s of normalSkus) {
      let brand = brands.get(s.brand_id);
      if (!brand) {
        brand = { brandId: s.brand_id, brandName: s.brand_name, models: new Map() };
        brands.set(s.brand_id, brand);
      }
      let model = brand.models.get(s.model_id);
      if (!model) {
        model = { modelId: s.model_id, modelName: s.model_name, skus: [] };
        brand.models.set(s.model_id, model);
      }
      model.skus.push(s);
    }
    return [...brands.values()].map((b) => ({ ...b, models: [...b.models.values()] }));
  }, [normalSkus]);

  // Empty = every model collapsed (the default). A model is expanded once
  // its id is in this set — inverted vs. Products' collapsedBrands because
  // that screen defaults to EXPANDED (nothing pre-hidden); this one defaults
  // to COLLAPSED, so tracking "expanded" avoids having to pre-seed every id.
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  function toggleModel(modelId: string) {
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId); else next.add(modelId);
      return next;
    });
  }

  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [showPriceExplain, setShowPriceExplain] = useState(false);
  // Quick-add on a below-cost SKU pauses for a deliberate choice — losing
  // money must never be a single accidental tap. Holds the pending add.
  const [belowCostAdd, setBelowCostAdd] = useState<{ sku: SkuFullRow; uom: ReturnType<typeof defaultUom>; price: number } | null>(null);

  // One-tap rebuild of the customer's previous basket at TODAY's prices.
  // Every line passes the same doors a manual add would: active SKU, enough
  // stock somewhere, a resolvable price, and never below cost — lines that
  // fail any guard are skipped and counted, not silently altered.
  function repeatLastOrder() {
    if (!lastOrder) return;
    const added: DraftLine[] = [];
    let skipped = 0;
    for (const line of lastOrder.lines) {
      const sku = skus.find((s) => s.id === line.sku_id && s.is_active);
      if (!sku) { skipped++; continue; }
      // Don't re-add something already on the order — one line per product.
      if (draftLines.some((l) => l.sku.id === sku.id)) { skipped++; continue; }
      const totalStock = stockLevels
        .filter((l) => l.sku_id === sku.id)
        .reduce((a, l) => a + l.qty_pieces, 0);
      if (totalStock < line.qty_pieces) { skipped++; continue; }
      let uom: SaleUom = line.uom === "carton" || line.uom === "pack" || line.uom === "piece" ? line.uom : "piece";
      const perUnit = toPieces(uom, 1, sku.pcs_per_pack, sku.packs_per_carton);
      let qty = perUnit > 0 ? line.qty_pieces / perUnit : NaN;
      if (!Number.isInteger(qty) || qty <= 0) { uom = "piece"; qty = line.qty_pieces; }
      const ap = autoPrice(sku, uom, false);
      const price = parseFloat(ap.price);
      if (!ap.price || !Number.isFinite(price) || price <= 0) { skipped++; continue; }
      const perPiece = price / toPieces(uom, 1, sku.pcs_per_pack, sku.packs_per_carton);
      if (sku.landed_per_piece_mvr != null && perPiece < Number(sku.landed_per_piece_mvr)) { skipped++; continue; }
      added.push({
        key: nextCartLineKey(sku.id),
        sku, uom, qty,
        qty_pieces: line.qty_pieces,
        unit_price_mvr: price,
        line_total_mvr: price * qty,
        is_mixed_carton_fill: false,
      });
    }
    if (added.length === 0) {
      toast.error("Couldn't repeat — those items are out of stock or unpriced today");
      return;
    }
    setDraftLines((prev) => [...prev, ...added]);
    toast.success(
      `${added.length} item${added.length !== 1 ? "s" : ""} added from last order` +
      (skipped > 0 ? ` — ${skipped} skipped (stock or price)` : ""),
    );
  }

  function pushQuickLine(s: SkuFullRow, uom: ReturnType<typeof defaultUom>, price: number) {
    // Same one-line-per-product rule as handleAddLine — quick-add must not be
    // the back door that builds an order the database will reject on save.
    if (draftLines.some((l) => l.sku.id === s.id)) {
      toast.error(`${s.brand_name} ${s.variant_display} is already in this order`);
      return;
    }
    const pcs = toPieces(uom, 1, s.pcs_per_pack, s.packs_per_carton);
    setDraftLines((prev) => [...prev, {
      key: `${s.id}-${Date.now()}`,
      sku: s, uom, qty: 1,
      qty_pieces: pcs,
      unit_price_mvr: price,
      line_total_mvr: price,
      is_mixed_carton_fill: false,
    }]);
    toast.success(`${s.brand_name} ${s.variant_display} added`);
  }
  const [editingPrice, setEditingPrice] = useState(false);
  // Margin-simulator state for the inline price fix — mirrors the Pricing
  // screen's Margin Simulator exactly (slider drives a live price from
  // landed cost, always saved per-pack internally regardless of display
  // unit) so fixing a price here is never a disconnected typed number.
  const [simPackPrice, setSimPackPrice] = useState(0);
  const [simTyped, setSimTyped] = useState("");
  const [simEditingTyped, setSimEditingTyped] = useState(false);
  const [savingFixedPrice, setSavingFixedPrice] = useState<"margin" | "fixed" | null>(null);
  const [autoPriceSource, setAutoPriceSource] = useState<"price_list" | "sku_default" | "margin" | null>(null);

  // Lock the background page while this full-screen sheet is mounted (shared hook).
  useBodyScrollLock(true);

  function autoPrice(
    sku: typeof selectedSku,
    uom: SaleUom,
    isMixed: boolean,
  ): { price: string; source: "price_list" | "sku_default" | "margin" | null } {
    if (!sku) return { price: "", source: null };
    const tp = tierPrices.get(sku.id);
    // Mixed carton: charge the per-piece equivalent of the carton price
    if (isMixed && uom === "piece") {
      const pcsPerCarton = sku.pcs_per_pack * sku.packs_per_carton;
      if (pcsPerCarton > 0) {
        if (tp) {
          return { price: (tp.price_per_carton_mvr / pcsPerCarton).toFixed(4), source: tp.source };
        }
        const cartonPrice = sku.selling_price_per_carton_mvr;
        if (cartonPrice != null) {
          return { price: (cartonPrice / pcsPerCarton).toFixed(4), source: "sku_default" };
        }
      }
    }
    if (tp) {
      const p = uom === "piece" ? tp.price_per_piece_mvr
        : uom === "pack" ? tp.price_per_pack_mvr
        : tp.price_per_carton_mvr;
      return { price: p.toFixed(0), source: tp.source };
    }
    const p = uom === "piece" ? sku.selling_price_per_piece_mvr
      : uom === "pack" ? sku.selling_price_per_pack_mvr
      : sku.selling_price_per_carton_mvr;
    return { price: p != null ? p.toFixed(0) : "", source: p != null ? "sku_default" : null };
  }

  // When a new SKU is selected: set smart default UOM, then auto-fill price
  useEffect(() => {
    if (!selectedSku) return;
    const smartUom = defaultUom(selectedSku);
    setMixedCarton(false);
    const ap = autoPrice(selectedSku, smartUom, false);
    setLineUom(smartUom);
    setLinePrice(ap.price);
    setAutoPriceSource(ap.source);
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkuId, tierPrices]);

  // When UOM changes (user picks a different one): re-fill price, reset mixed carton
  useEffect(() => {
    if (!selectedSku) return;
    // Mixed carton only makes sense on piece UOM — auto-clear on UOM switch
    const nextMixed = lineUom === "piece" ? mixedCarton : false;
    if (lineUom !== "piece" && mixedCarton) setMixedCarton(false);
    const ap = autoPrice(selectedSku, lineUom, nextMixed);
    setLinePrice(ap.price);
    setAutoPriceSource(ap.source);
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineUom, tierPrices]);

  // When mixed carton toggle changes: re-fill price
  useEffect(() => {
    if (!selectedSku || lineUom !== "piece") return;
    const ap = autoPrice(selectedSku, lineUom, mixedCarton);
    setLinePrice(ap.price);
    setAutoPriceSource(ap.source);
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixedCarton]);

  function handlePriceChange(raw: string) {
    // Allow empty string while typing — don't restore auto price mid-keystroke
    setLinePrice(raw);
    if (raw === "") {
      setPriceManuallyEdited(false);
      // source stays — restored on blur if still empty
    } else {
      const ap = autoPrice(selectedSku, lineUom, mixedCarton);
      setPriceManuallyEdited(raw !== ap.price);
      if (raw !== ap.price) setAutoPriceSource(null);
      else setAutoPriceSource(ap.source);
    }
  }

  function handlePriceBlur() {
    // Only restore auto price on blur if field is empty
    if (linePrice === "") {
      const ap = autoPrice(selectedSku, lineUom, mixedCarton);
      setLinePrice(ap.price);
      setAutoPriceSource(ap.source);
      setPriceManuallyEdited(false);
    }
  }

  const lineQtyPieces = useMemo(() => {
    if (!selectedSku || !lineQty) return 0;
    const n = parseFloat(lineQty);
    if (isNaN(n) || n <= 0) return 0;
    return toPieces(lineUom, n, selectedSku.pcs_per_pack, selectedSku.packs_per_carton);
  }, [selectedSku, lineQty, lineUom]);

  // Guardrail on the manual price override — warns, never blocks (the rep
  // may genuinely intend a special price). Red: below what the goods cost
  // you. Amber: wildly different from the usual auto price, the classic
  // "typed the pack price on a carton line" mistake.
  const priceWarning = useMemo(() => {
    if (!selectedSku || linePrice === "") return null;
    const p = parseFloat(linePrice);
    if (isNaN(p) || p <= 0) return null;
    const perUom = lineUom === "carton" ? selectedSku.pcs_per_pack * selectedSku.packs_per_carton
      : lineUom === "pack" ? selectedSku.pcs_per_pack : 1;
    const landed = selectedSku.landed_per_piece_mvr;
    if (landed != null && landed > 0 && p / perUom < landed) {
      return { color: "var(--snm-error)", text: `Below cost — this ${lineUom} cost you ~MVR ${(landed * perUom).toFixed(0)}` };
    }
    const ap = autoPrice(selectedSku, lineUom, mixedCarton);
    const auto = ap.price ? parseFloat(ap.price) : NaN;
    if (!isNaN(auto) && auto > 0 && Math.abs(p - auto) / auto > 0.4) {
      return { color: "var(--snm-warning)", text: `Usual price is MVR ${auto.toFixed(0)} — double-check` };
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSku, linePrice, lineUom, mixedCarton]);

  const lineTotal = useMemo(() => {
    const q = parseFloat(lineQty); const p = parseFloat(linePrice);
    if (isNaN(q) || isNaN(p)) return 0;
    return q * p;
  }, [lineQty, linePrice]);

  const insufficient = stockHere !== null && lineQtyPieces > stockHere;
  const grandTotal = useMemo(() => draftLines.reduce((s, l) => s + l.line_total_mvr, 0), [draftLines]);

  /** Bottles/pieces on the shelf for a SKU in the chosen warehouse. The cart's
   *  + button stops here, so an order can never be built past what exists. */
  const maxPiecesFor = useCallback((line: DraftLine) => {
    // A line sourced from another warehouse is capped by THAT warehouse.
    const gid = line.source_godown_id ?? godownId;
    const onShelf = gid
      ? stockLevels.find((l) => l.sku_id === line.sku.id && l.godown_id === gid)?.qty_pieces ?? 0
      : stockLevels.filter((l) => l.sku_id === line.sku.id).reduce((a, l) => a + l.qty_pieces, 0);
    // A product can now sit in the cart TWICE — a full carton and bottles in a
    // mixed carton. Each entry may only claim what the other has not, or the
    // two together would oversell a shelf that holds one of them.
    const heldElsewhere = draftLines
      .filter((l) => l.sku.id === line.sku.id && l.key !== line.key)
      .reduce((a, l) => a + l.qty_pieces, 0);
    return Math.max(0, onShelf - heldElsewhere);
  }, [godownId, stockLevels, draftLines]);

  /** One step of whatever unit this line is sold in — a carton for a carton
   *  line, a pack for a pack line, a bottle for a mixed-carton fill. Every
   *  product behaves the same way; only the unit differs, and it comes from
   *  the line rather than from anything hardcoded.
   *
   *  qty_pieces and line_total are kept in step because the cart displays them,
   *  but Postgres re-derives both on save from uom and qty (rule 1) — these are
   *  never the numbers that get stored. */
  const changeLineQty = useCallback((key: string, delta: number) => {
    setDraftLines((prev) => prev.map((l) => {
      if (l.key !== key) return l;
      const mixed = !!l.sku.mixed_carton_pieces && l.is_mixed_carton_fill;
      const per = mixed ? 1
        : l.uom === "carton" ? l.sku.pcs_per_pack * l.sku.packs_per_carton
        : l.uom === "pack" ? l.sku.pcs_per_pack : 1;
      const nextQty = Math.max(1, l.qty + delta);
      const nextPieces = Math.round(nextQty * per);
      // Never step past the shelf.
      if (delta > 0 && nextPieces > maxPiecesFor(l)) return l;
      return {
        ...l,
        qty: nextQty,
        qty_pieces: nextPieces,
        line_total_mvr: nextQty * l.unit_price_mvr,
      };
    }));
  }, [maxPiecesFor]);

  const removeLine = useCallback((key: string) => {
    setDraftLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  /** Mixed-carton brands that do not yet add up to whole cartons. Place Order
   *  is blocked on this, so the shortfall is caught in the cart instead of
   *  coming back as a database error after the final tap (migration 0163). */
  const shortfalls = useMemo(() => cartShortfalls(draftLines), [draftLines]);

  /**
   * Is the chosen warehouse actually the right one for this basket?
   *
   * 93% of orders ship from the default, so a "did you pick a warehouse?"
   * prompt on every order would be dismissed reflexively within a week — and
   * then ignored on the 7% that matter. So this stays silent unless the
   * basket itself says the choice is wrong: a line the chosen warehouse
   * cannot cover, where the other one can.
   */
  const godownCheck = useMemo(() => {
    if (!godownId || draftLines.length === 0) return null;
    const need = new Map<string, number>();
    for (const l of draftLines) need.set(l.sku.id, (need.get(l.sku.id) ?? 0) + l.qty_pieces);

    const qtyIn = (skuId: string, gid: string) =>
      stockLevels.find((s) => s.sku_id === skuId && s.godown_id === gid)?.qty_pieces ?? 0;

    const short = [...need.entries()].filter(([skuId, pieces]) => qtyIn(skuId, godownId) < pieces);
    if (short.length === 0) return null;

    // Would another warehouse cover the WHOLE basket? Only then is a
    // one-tap switch honest advice rather than a different problem.
    const better = godowns.find((g) =>
      g.id !== godownId && [...need.entries()].every(([skuId, pieces]) => qtyIn(skuId, g.id) >= pieces));

    const names = short
      .map(([skuId]) => draftLines.find((l) => l.sku.id === skuId)?.sku)
      .filter(Boolean)
      .map((s) => `${s!.model_name} ${s!.variant_display ?? ""}`.trim());

    return { shortCount: short.length, names, better: better ?? null };
  }, [godownId, draftLines, stockLevels, godowns]);


  function handleScanResult(code: string) {
    setShowScanner(false);
    const match = skus.find(
      (s) => s.internal_code === code || s.supplier_barcode === code,
    );
    if (match) {
      setSelectedSkuId(match.id);
      setSkuSearch("");
      toast.success(`Found: ${match.brand_name} ${match.variant_display}`);
    } else {
      setSkuSearch(code);
      toast.warning(`No SKU matched "${code}" — showing search results`);
    }
  }

  // The actual add — reached directly for healthy prices, or via the
  // below-cost confirm sheet. Both entry doors share one guard.
  function doAddLine() {
    if (!selectedSku || !lineQty || !linePrice || lineQtyPieces <= 0) return;
    // Same confirmation as the carton sheet — every add says so, whatever the
    // product. The editor closes on add, so silence is indistinguishable from
    // a tap that did not register.
    toast.success(
      `Added ${parseFloat(lineQty)} ${sellUnitLabel(lineUom, tradeCfg(selectedSku))} of ${selectedSku.brand_name} ${selectedSku.model_name}`,
    );
    setDraftLines((prev) => [...prev, {
      key: `${selectedSku.id}-${Date.now()}`,
      sku: selectedSku, uom: lineUom, qty: parseFloat(lineQty),
      qty_pieces: lineQtyPieces, unit_price_mvr: parseFloat(linePrice), line_total_mvr: lineTotal,
      is_mixed_carton_fill: lineUom === "piece" && mixedCarton,
    }]);
    setSelectedSkuId(""); setSkuSearch(""); setLineQty(""); setLinePrice(""); setLineUom("pack");
    setMixedCarton(false); setPriceManuallyEdited(false); setAutoPriceSource(null);
  }

  const [editorBelowCostConfirm, setEditorBelowCostConfirm] = useState(false);

  function handleAddLine() {
    if (!selectedSku || !lineQty || !linePrice || lineQtyPieces <= 0) return;
    // One line per product per order — sales_order_lines has a UNIQUE
    // (order_id, sku_id), and edit_sales_order_line depends on that to scope
    // its FIFO stock reversal safely. Without this check you could build a
    // whole order with the same product on two lines and only discover it
    // when saving failed at the very end.
    if (draftLines.some((l) => l.sku.id === selectedSku.id)) {
      toast.error(`${selectedSku.brand_name} ${selectedSku.variant_display} is already in this order — change the quantity on that line instead`);
      return;
    }
    const landed = selectedSku.landed_per_piece_mvr;
    const mult = lineUom === "carton" ? selectedSku.pcs_per_pack * selectedSku.packs_per_carton
               : lineUom === "pack" ? selectedSku.pcs_per_pack : 1;
    const pricePerPiece = parseFloat(linePrice) / mult;
    if (landed != null && pricePerPiece < landed) {
      setEditorBelowCostConfirm(true);
      return;
    }
    doAddLine();
  }

  // Create order + lines + immediately confirm (post_sale) in one shot
  async function handleSubmit() {
    if (draftLines.length === 0) return;
    setSaving(true);
    try {
      const cust = customers.find((c) => c.id === customerId);
      const orderPayload = {
        order_number: orderNumber,
        customer_id: customerId && customerId !== "walkin" ? customerId : null,
        channel: cust?.channel ?? channel,
        status: "draft" as const,
        source_godown_id: godownId || null,
        payment_method: paymentMethod,
        payment_status: "pending" as const,
        notes: orderNotes.trim() || null,
      };
      // qty_pieces and line_total_mvr are deliberately NOT sent — Postgres
      // derives both from the SKU's own pack/carton configuration, so the
      // stored numbers can't drift from the price and quantity actually
      // agreed (hard rule 1: money math lives in Postgres).
      // The CART may hold a product twice — a full carton and bottles inside
      // a mixed carton are different purchases and are shown apart. The
      // DATABASE allows one row per product per order
      // (sales_order_lines_order_sku_uniq), so they are combined here, at the
      // last possible moment.
      //
      // Combining is lossless for everything that counts: both sides are
      // priced off the same carton rate, so the money is identical, and the
      // stock is the same pieces off the same shelf. Only the presentation
      // differs, and the presentation has already done its job by then.
      const linePayloads = [...draftLines.reduce((acc, l) => {
        const prev = acc.get(l.sku.id);
        if (!prev) {
          acc.set(l.sku.id, {
            sku_id: l.sku.id, uom: l.uom, qty: l.qty,
            unit_price_mvr: l.unit_price_mvr,
            is_mixed_carton_fill: l.is_mixed_carton_fill,
            source_godown_id: l.source_godown_id ?? null,
            _pieces: l.qty_pieces,
          });
          return acc;
        }
        // Two entries for one product: express the total in bottles, the only
        // unit that can describe a carton plus loose bottles.
        const perMix = l.sku.mixed_carton_pieces
          || l.sku.pcs_per_pack * l.sku.packs_per_carton || 1;
        const pieces = prev._pieces + l.qty_pieces;
        acc.set(l.sku.id, {
          sku_id: l.sku.id,
          uom: "piece" as SaleUom,
          qty: pieces,
          unit_price_mvr: (l.sku.selling_price_per_carton_mvr
            ?? (prev.unit_price_mvr * (prev.uom === "carton" ? perMix : 1))) / perMix,
          is_mixed_carton_fill: true,
          source_godown_id: prev.source_godown_id ?? l.source_godown_id ?? null,
          _pieces: pieces,
        });
        return acc;
      }, new Map<string, {
        sku_id: string; uom: SaleUom; qty: number; unit_price_mvr: number;
        is_mixed_carton_fill: boolean; source_godown_id: string | null; _pieces: number;
      }>()).values()].map(({ _pieces, ...line }) => line);

      // One RPC = one transaction: the order, its lines and the FIFO stock
      // deduction all commit together or not at all. The old three-step
      // client sequence could leave the order and lines saved with stock
      // never deducted if the connection dropped in between — that is
      // exactly how SO-2026-076 ended up delivered with no stock movement.
      // offlineKey makes a retry idempotent rather than a duplicate sale.
      const { queued } = await withOfflineFallback(
        () => createAndPostSale(orderPayload, linePayloads, offlineKey),
        {
          table: "sales_orders",
          action: "rpc",
          rpcName: "create_and_post_sale",
          payload: {
            p_order: orderPayload,
            p_lines: linePayloads,
            p_offline_key: offlineKey,
          },
          tempId: offlineKey,
        },
      );

      if (queued) {
        toast.warning(
          "You're offline — this sale is saved on this phone and will be sent when you reconnect. Stock is not deducted yet.",
          { duration: 6000 },
        );
        onClose();
      } else {
        toast.success("Order placed — stock deducted");
        // result is the created order but onCreated needs the ID;
        // reload the list to pick up the new order
        onCreated("reload");
      }
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  const stepLabels: Record<Step, string> = { 1: "Customer", 2: "Products", 3: "Confirm" };

  // Portalled to document.body: this is a full-screen `position: fixed`
  // takeover, and the app shell's content wrapper carries its own
  // `z-[1]` stacking context (needed so it paints above the wallpaper's
  // ::before pseudo-element). Any fixed layer nested inside that wrapper
  // is capped at that context's ceiling and can never out-rank the
  // shell's own always-on-top Topbar/BottomNav (z-40), no matter its own
  // z-index — same reasoning as the price-explain sheet's portal below.
  if (!portalReady) return null;
  return createPortal(
    // ── Three layouts, one component ─────────────────────────────────────────
    // Ali, 2026-08-09: "this is a Retina display mobile view first app but it
    // must be different for tablet and desktop completely with proper design."
    //
    // PHONE  (<768) full-screen takeover, three steps. Unchanged — it is what
    //        he uses every day and it is right for one thumb.
    // TABLET (md, 768-1023) the same three steps, but as a centred window with
    //        the app visible behind it, instead of one phone screen stretched
    //        to fill an iPad. A modal that eats a large screen for a creation
    //        task is an iPhone pattern, not an iPadOS/macOS one.
    // DESKTOP (lg, 1024+) the window widens and the ORDER moves into a rail on
    //        the right that is visible during all three steps — the standard
    //        desktop checkout shape. The cart stops being something you scroll
    //        to and becomes something you watch while you price.
    //
    // Deliberately ONE component with responsive classes, not a desktop fork.
    // Every guard that protects money — the below-cost confirm, whole mixed
    // cartons, the stock cap, the cross-godown pick — hangs off these same
    // handlers and this same footer button. A second component would be a
    // second door, and the standing rule here is one guard, every door.
    <div
      className="fixed inset-0 z-50 flex flex-col md:items-center md:justify-center md:p-6 lg:p-8"
      style={{ touchAction: "none" }}
      onTouchMove={(e) => e.stopPropagation()}
    >
      {/* Scrim — tablet and desktop only. On a phone the sheet IS the screen,
          so there is nothing to dim. */}
      <div className="hidden md:block absolute inset-0 snm-scrim-in"
        style={{ background: "color-mix(in srgb, var(--background) 55%, transparent)", backdropFilter: "blur(8px)" }}
        onClick={onClose} aria-hidden />

      <div
        // 100dvh = dynamic viewport height — shrinks when the keyboard opens on
        // iOS 15.4+. CSS-native, no JS measurement. Never 100vh (standing rule:
        // it ignores the iOS dynamic toolbar).
        className="relative flex flex-col w-full glass-wallpaper glass-wallpaper--calm
                   h-[100dvh] md:h-[92dvh] md:max-h-[920px]
                   md:rounded-3xl md:overflow-hidden md:max-w-3xl lg:max-w-6xl md:shadow-2xl"
        style={{ border: "0.5px solid var(--glass-border-lo)" }}
      >

      {/* Header — safe-area aware, clears Dynamic Island / notch */}
      <header className="glass-panel--strong px-5 shrink-0 relative z-[1]" style={{ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none", borderBottom: "0.5px solid var(--glass-border-lo)" }}>
        {/* Visible row sits BELOW the safe area inset */}
        <div className="flex items-center justify-between py-3.5" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div className="flex items-center gap-3">
            {/* 60% measured 4.19:1 — under the 4.5 floor. 72% clears it, and
                it is the close control on a money screen, so it should not be
                the faintest thing on it. Helps every palette, not just Soft. */}
            <button onClick={onClose} aria-label="Close new sale"
              className="text-foreground opacity-[0.72] active:opacity-100 text-xl">✕</button>
            <span className="text-[18px] font-bold text-foreground tracking-tight">New Sale</span>
          </div>
          <span className="snm-num ios-subhead font-mono" style={{ color: "var(--muted-foreground)" }}>
            {orderNumber || "Assigned on save"}
          </span>
        </div>

        {/* Step indicator — moved OUT of the scrolling body and into the fixed
            header, and a finished step is now tappable.

            Two things fall out of that. It is always on screen, so you can
            always see where you are; and it becomes the way BACK, which frees
            the footer to hold two buttons instead of three. At 393pt three
            buttons wrapped "Add product" and "Review & Confirm" onto two lines
            each — that was the "unorganized" look, measured in a browser at
            Ali's device size rather than guessed at.

            Backwards only. Going forward still has to pass the checks in the
            footer buttons (a customer chosen, a cart with whole cartons in
            it); a breadcrumb must never be a way around them. */}
        <div className="flex items-center gap-2 pb-3">
          {([1, 2, 3] as Step[]).map((s) => {
            const done = step > s;
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => setStep(s)}
                  aria-label={done ? `Back to ${stepLabels[s]}` : undefined}
                  className="flex items-center gap-2 min-w-0 disabled:cursor-default"
                >
                  <span className="h-6 w-6 rounded-full flex items-center justify-center ios-subhead font-bold shrink-0 transition-all"
                    style={step === s ? { background: "var(--glass-accent)", color: "var(--snm-brand-on)" }
                      : done ? { background: "color-mix(in srgb, var(--snm-success) 20%, transparent)", color: "var(--snm-success)" }
                      : { background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                    {done ? "✓" : s}
                  </span>
                  <span className="ios-subhead truncate"
                    style={{ color: step === s || done ? "var(--foreground)" : "var(--muted-foreground)" }}>
                    {stepLabels[s]}
                  </span>
                </button>
                {s < 3 && <div className="flex-1 h-px bg-border" />}
              </div>
            );
          })}
        </div>
      </header>

      {/* Content — takes all remaining space; touch-action auto re-enables scrolling inside.
          overscroll-behavior is CONTAIN, never none. Both stop the scroll
          chaining to the page underneath this full-screen sheet, but `none`
          also kills the rubber-band bounce, which is the iOS signature and a
          standing rule here (see globals.css) — with it set, this sheet felt
          dead against every other screen in the app. `contain` keeps the
          bounce and still traps the scroll. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden px-5 lg:px-8 pb-6 lg:pb-0"
        style={{
          touchAction: "pan-y",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        } as React.CSSProperties}
      >
      {/* Scroll ownership.
          PHONE/TABLET: one scroller — this element — and the columns just flow.
          DESKTOP: a split pane, where each column owns its own scroll. That is
          the one exception the standing rule allows, and it is needed here: a
          sticky rail inside a single scroller gets clipped the moment the order
          is taller than the window, and the first thing to disappear is the
          TOTAL. An order total you cannot reach is not a layout preference. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8 lg:h-full lg:min-h-0">
        <div className="space-y-5 min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-8 lg:pr-1"
          style={{ overscrollBehavior: "contain" }}>

        {/* ── Step 1: Customer ── */}
        {step === 1 && (
          <div className="space-y-4">
            {!customerId && !showNewCustomer && (
              <>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-3 rounded-xl px-4 h-12" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                    <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                    <input autoFocus value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Search name, phone…"
                      className="flex-1 bg-transparent ios-subhead text-foreground placeholder:text-muted-foreground outline-none" />
                    {customerSearch && (
                      <button onClick={() => setCustomerSearch("")}
                        aria-label="Clear search"
                        className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 active:opacity-60"
                        style={{ color: "var(--muted-foreground)" }}>
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <button onClick={() => setShowNewCustomer(true)}
                    className="flex items-center gap-1.5 h-12 px-4 rounded-xl text-sm font-semibold transition"
                    style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>
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
                            onClick={() => { const rc2 = customers.find((c) => c.id === id); setCustomerId(id); setOrderTier(rc2?.price_tier ?? "retail"); setChannel((rc2?.channel as OrderChannel) ?? "whatsapp"); touchRecentCustomer(id); }}
                            className="flex items-center gap-2 px-3 h-9 rounded-full ios-subhead font-semibold transition active:scale-95"
                            style={{
                              background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--snm-brand) 25%, transparent)",
                              color: "var(--snm-brand-text)",
                            }}
                          >
                            ★ {rc.name.split(" ")[0]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[12px] uppercase tracking-widest mb-3 font-medium" style={{ color: "var(--muted-foreground)" }}>
                    {customerSearch.trim() ? "Results" : "All Customers"}
                  </p>
                  <div className="space-y-1.5">
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).map((c) => {
                      const initials = c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                      return (
                        <button key={c.id}
                          onClick={() => { setCustomerId(c.id); setOrderTier(c.price_tier ?? "retail"); setChannel((c.channel as OrderChannel) ?? "whatsapp"); touchRecentCustomer(c.id); }}
                          className="w-full flex items-center gap-3 px-4 h-14 rounded-xl text-left transition active:scale-[0.99]"
                          style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                          <div className="h-9 w-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-semibold text-foreground truncate">{c.name}</p>
                            <p className="ios-subhead truncate" style={{ color: "var(--muted-foreground)" }}>{[c.island, c.channel].filter(Boolean).join(" · ")}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                        </button>
                      );
                    })}
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).length === 0 && (
                      <p className="ios-subhead py-4 text-center" style={{ color: "var(--muted-foreground)" }}>
                        {customerSearch.trim() ? "No matches." : "No customers yet."}
                      </p>
                    )}
                  </div>
                </div>

                <button onClick={() => setCustomerId("walkin")}
                  className="w-full h-12 rounded-xl text-sm font-semibold transition"
                  style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--muted-foreground)" }}>
                  Walk-in / No account
                </button>
              </>
            )}

            {showNewCustomer && !customerId && (
              <div className="rounded-xl py-4 flex flex-col" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", maxHeight: "70dvh" }}>
                <p className="ios-subhead font-bold text-foreground flex items-center gap-2 px-5 pb-2 shrink-0">
                  <UserPlus className="h-4 w-4" /> New Customer
                </p>
                {/* Same canonical form used on the Customers page — identical fields */}
                <CustomerForm
                  saveLabel="Create & Select"
                  existing={customers}
                  onPickExisting={(c) => {
                    setCustomerId(c.id);
                    setOrderTier(c.price_tier ?? "retail");
                    setChannel((c.channel as OrderChannel) ?? "whatsapp");
                    touchRecentCustomer(c.id);
                    setShowNewCustomer(false);
                  }}
                  onCancel={() => setShowNewCustomer(false)}
                  onSaved={(created) => {
                    onCustomerCreated(created);
                    setCustomerId(created.id);
                    setOrderTier(created.price_tier ?? "retail");
                    setChannel((created.channel as OrderChannel) ?? "whatsapp");
                    touchRecentCustomer(created.id);
                    setShowNewCustomer(false);
                  }}
                />
              </div>
            )}

            {customerId && customerId !== "walkin" && customer && (
              <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)" }}>
                {/* Customer identity row */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-semibold text-foreground">{customer.name}</p>
                    <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>{[customer.phone, customer.island, customer.channel].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button onClick={() => { setCustomerId(""); setCustomerSearch(""); setOrderTier("retail"); }}
                    className="ios-subhead font-semibold px-3 h-8 rounded-lg transition active:scale-95"
                    style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                    Change
                  </button>
                </div>

                {/* Order-level pricing tier — defaults to customer's tier, overrideable per order */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] uppercase tracking-widest font-semibold" style={{ color: "var(--muted-foreground)" }}>
                      Pricing tier for this order
                    </p>
                    {orderTier !== customer.price_tier && (
                      <button onClick={() => setOrderTier(customer.price_tier)}
                        className="ios-subhead font-semibold"
                        style={{ color: "var(--snm-brand-text)" }}>
                        Reset to default ({customer.price_tier})
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(["retail", "wholesale", "vip", "promo"] as PriceTier[]).map((t) => {
                      const isDefault = t === customer.price_tier;
                      const isActive = t === orderTier;
                      return (
                        <button key={t} type="button" onClick={() => setOrderTier(t)}
                          className="py-2 rounded-xl ios-subhead font-semibold capitalize transition active:scale-95 relative"
                          style={isActive
                            ? { background: "var(--glass-accent)", color: "var(--snm-brand-on)" }
                            : { background: "color-mix(in srgb, var(--foreground) 7%, transparent)", color: "var(--muted-foreground)" }}>
                          {t}
                          {isDefault && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{ background: "var(--glass-accent)" }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                    {orderTier !== customer.price_tier
                      ? `⚠ Override active — customer's default is ${customer.price_tier}`
                      : `Default tier for ${customer.name.split(" ")[0]}`}
                  </p>
                </div>
              </div>
            )}
            {customerId === "walkin" && (
              <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)" }}>
                <div>
                  <p className="text-[14px] font-semibold text-foreground">Walk-in customer</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>No account</p>
                </div>
                <button onClick={() => setCustomerId("")} className="ios-subhead text-foreground opacity-60 active:opacity-100">Change</button>
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
            <WarehouseSelect value={godownId} onChange={setGodownId} godowns={godowns} />

            {/* Everything below needs the warehouse settled first: it decides
                which stock is checked, which stock gets deducted, and whether
                a product reads as in stock at all. Gating here rather than
                nagging later means the choice is made once, before any of
                those answers can be computed from the wrong place. */}
            {!godownId ? (
              <p className="ios-subhead px-1" style={{ color: "var(--muted-foreground)" }}>
                Pick the warehouse this order ships from — stock and availability are
                counted from there.
              </p>
            ) : (
            <>
            {/* Repeat last order — the fastest possible order entry for a
                repeat customer. Shown only while the cart is still empty so
                it never competes with an in-progress basket. */}
            {!selectedSkuId && draftLines.length === 0 && lastOrder && (
              <button
                onClick={repeatLastOrder}
                className="w-full flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 transition active:scale-[0.98]"
                style={{
                  background: "color-mix(in srgb, var(--snm-brand) 10%, var(--glass-1))",
                  border: "1px solid var(--snm-brand-border)",
                  boxShadow: "var(--glass-shadow), var(--glass-inner)",
                }}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <RotateCcw className="h-4 w-4 shrink-0" style={{ color: "var(--snm-brand)" }} />
                  <span className="text-left min-w-0">
                    <span className="block text-[14px] font-semibold text-foreground">Repeat last order</span>
                    <span className="block ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                      {lastOrder.lines.length} item{lastOrder.lines.length !== 1 ? "s" : ""} · {mvtInstant(lastOrder.createdAt)} · today&rsquo;s prices
                    </span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
              </button>
            )}

            {/* Product picker */}
            {!selectedSkuId ? (
              <div className="space-y-3" ref={productSearchRef}>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-3 rounded-xl px-4 h-12" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                    <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                    <input value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)}
                      placeholder="Search brand, product, variant…"
                      aria-label="Search products"
                      className="flex-1 bg-transparent ios-subhead text-foreground placeholder:text-muted-foreground outline-none" autoComplete="off" />
                  </div>
                  {/* Scan button */}
                  <button
                    onClick={() => setShowScanner(true)}
                    style={{
                      width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                      background: "var(--snm-brand)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: "none", cursor: "pointer",
                      boxShadow: "0 4px 16px color-mix(in srgb, var(--snm-brand) 40%, transparent)",
                    }}
                    aria-label="Scan barcode"
                  >
                    <ScanLine size={20} color="var(--snm-brand-on)" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[...mixedCartonGroups.entries()].map(([brandId, groupSkus]) => {
                    const first = groupSkus[0];
                    const piecesNeeded = first.mixed_carton_pieces!;
                    const totalStock = groupSkus.reduce((sum, s) => {
                      const pcsPerCarton = s.pcs_per_pack * s.packs_per_carton || 1;
                      const stock = godownId
                        ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0
                        : stockLevels.filter((l) => l.sku_id === s.id).reduce((a, l) => a + l.qty_pieces, 0);
                      return sum + Math.floor(stock / pcsPerCarton);
                    }, 0);
                    const cartonPrice = first.selling_price_per_carton_mvr;
                    const outOfStock = totalStock <= 0;
                    // Every line for this brand counts, not just mixed fills —
                    // a single-colour carton is an ordinary carton line now.
                    // Kept in PIECES and formatted at the end: dividing here
                    // produced the raw "1.6666666666666667 cartons in cart".
                    const inCartPieces = draftLines
                      .filter((l) => groupSkus.some((s) => s.id === l.sku.id))
                      .reduce((a, l) => a + l.qty_pieces, 0);
                    return (
                      <button key={brandId} onClick={() => !outOfStock && setMixedCartonBrandId(brandId)}
                        disabled={outOfStock}
                        className="w-full rounded-2xl p-4 text-left transition active:scale-[0.98]"
                        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", cursor: outOfStock ? "default" : "pointer" }}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="ios-headline font-semibold" style={{ color: outOfStock ? "var(--muted-foreground)" : "var(--foreground)" }}>
                            {first.brand_name}
                          </p>
                          <span className="ios-footnote font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "color-mix(in srgb, var(--snm-brand) 12%, transparent)", color: "var(--snm-brand-text)" }}>
                            Add cartons
                          </span>
                        </div>
                        <p className="ios-footnote mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                          {groupSkus.length} colours · one colour or mixed, any quantity
                        </p>
                        <div className="flex items-end justify-between gap-2 mt-3" style={{ opacity: outOfStock ? 0.55 : 1 }}>
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-semibold" style={{ fontSize: 22, letterSpacing: "-0.02em", color: cartonPrice != null ? "var(--foreground)" : "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>
                              {cartonPrice != null ? cartonPrice.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "No GRN"}
                            </span>
                            {cartonPrice != null && <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>MVR / carton</span>}
                          </div>
                          <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                            {outOfStock ? "Out of stock" : `${totalStock} ctn in stock`}
                          </p>
                        </div>
                        {inCartPieces > 0 && (
                          <span className="ios-footnote font-semibold shrink-0 px-2 py-0.5 rounded-full inline-block mt-2"
                            style={{ color: "var(--snm-brand-text)", background: "var(--snm-brand-muted)" }}>
                            {formatMixedCartonQty(inCartPieces, piecesNeeded, first.unit_uom as UnitUom | null)} in cart
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {brandModelGroups.map(({ brandId, brandName, models }) => (
                    <div key={brandId} className="col-span-1 sm:col-span-2">
                      {/* Brand — fixed section label, never collapses, always visible */}
                      <p className="label-caps text-[12px] px-1 pt-2 pb-1.5" style={{ color: "var(--muted-foreground)" }}>
                        {brandName}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {models.map(({ modelId, modelName, skus: modelSkus }) => {
                          // Every model behaves identically: collapsed by
                          // default, tap to expand. Search still force-
                          // expands so a typed match is never hidden.
                          const expanded = skuSearch.trim() !== "" || expandedModels.has(modelId);
                          return (
                            <div key={modelId} className="col-span-1 sm:col-span-2">
                              <button
                                onClick={() => toggleModel(modelId)}
                                aria-expanded={expanded}
                                className="w-full flex items-center gap-1.5 px-3 py-2 rounded-xl transition active:scale-[0.99]"
                                style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}
                              >
                                <ChevronDown
                                  className="h-3.5 w-3.5 shrink-0 transition-transform"
                                  style={{ color: "var(--muted-foreground)", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
                                />
                                <p className="ios-subhead font-semibold text-left flex-1" style={{ color: "var(--foreground)" }}>
                                  {modelName}
                                </p>
                                <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                                  {modelSkus.length} SKU{modelSkus.length !== 1 ? "s" : ""}
                                </p>
                              </button>
                              {expanded && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                                  {modelSkus.map((s) => {
                    const stock = godownId ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0 : null;
                    // Stock in OTHER godowns — so a product held in another warehouse
                    // is never mistaken for out-of-stock (would lose a real sale).
                    const otherGodownStock = stockLevels
                      .filter((l) => l.sku_id === s.id && l.godown_id !== godownId && l.qty_pieces > 0)
                      .map((l) => ({ name: godowns.find((g) => g.id === l.godown_id)?.name ?? "another godown", qty: l.qty_pieces }))
                      .sort((a, b) => b.qty - a.qty);
                    const elsewhereTotal = otherGodownStock.reduce((sum, g) => sum + g.qty, 0);
                    const pl = packLabel(s);
                    // Show price per default UOM on the card — tier price takes priority
                    const cardUom = defaultUom(s);
                    const tp = tierPrices.get(s.id);
                    const cardPrice = tp
                      ? (cardUom === "carton" ? tp.price_per_carton_mvr : tp.price_per_pack_mvr)
                      : (cardUom === "carton" ? s.selling_price_per_carton_mvr : s.selling_price_per_pack_mvr);
                    const cardUomLabel = cardUom === "carton" ? "carton" : pl.toLowerCase();
                    const hasPrice = cardPrice != null;

                    // Where did this price come from? Classify against the same
                    // source the RPC resolved + the SKU's cost/target so the
                    // salesperson never sells on a mystery number. Normalise the
                    // shown price to per-piece so margin math is unit-agnostic.
                    const cardPricePerPiece = cardPrice == null ? null
                      : cardUom === "carton" ? cardPrice / (s.pcs_per_pack * s.packs_per_carton)
                      : cardPrice / s.pcs_per_pack;
                    // A fixed price can come from any of three columns (per-piece
                    // default, or a per-pack/per-carton volume-break override —
                    // v_skus.selling_price_per_pack/carton_mvr prefers the tier
                    // override first). Checking only fixed_selling_price_mvr here
                    // missed that case entirely, leaving the card with NO source
                    // tag and no below-cost warning even though cardPrice itself
                    // was correctly reading the override.
                    const hasFixedOverride = s.fixed_selling_price_mvr != null
                      || (cardUom === "carton" ? s.fixed_price_per_carton_mvr != null : s.fixed_price_per_pack_mvr != null);
                    const cardProvenance = describePriceSource({
                      source: tp ? tp.source : (hasFixedOverride ? "sku_default" : (s.target_margin_pct ? "margin" : null)),
                      priceListName: tp?.price_list_name,
                      priceListDate: tp?.price_list_date,
                      pricePerPiece: cardPricePerPiece,
                      landedPerPiece: s.landed_per_piece_mvr,
                      targetMarginPct: s.target_margin_pct,
                    });
                    const inCart = draftLines.filter((l) => l.sku.id === s.id).reduce((a, l) => a + l.qty, 0);

                    // Work & Co: quick-add adds 1 unit of the default UOM directly to cart.
                    // Tapping the card body still opens the detail editor for custom qty/price.
                    function handleQuickAdd(e: React.MouseEvent) {
                      e.stopPropagation();
                      // Allow adding when stock exists in ANY godown; block only when
                      // out everywhere. Products in another warehouse are sellable.
                      if (!hasPrice || outOfStock) return;
                      // Below cost: pause for a deliberate choice instead of a
                      // silent one-tap loss (Ali, 12 Jul, with screenshot).
                      if (cardProvenance.belowCost) {
                        setBelowCostAdd({ sku: s, uom: cardUom, price: cardPrice! });
                        return;
                      }
                      pushQuickLine(s, cardUom, cardPrice!);
                    }

                    const hereQty = stock ?? 0;
                    const noneHere = godownId != null && godownId !== "" && hereQty <= 0;
                    // Genuinely unavailable ONLY when zero in every godown. A product
                    // in another warehouse stays sellable (ships from there).
                    const outOfStock = noneHere && elsewhereTotal <= 0;
                    // Convert a piece count into the card's default unit label.
                    const qtyLabel = (pcs: number) => {
                      const dUom = defaultUom(s);
                      if (dUom === "carton" && s.pcs_per_pack > 0 && s.packs_per_carton > 0) {
                        const c = Math.floor(pcs / (s.pcs_per_pack * s.packs_per_carton));
                        return c > 0 ? `${c} ctn` : "< 1 ctn";
                      }
                      if (s.pcs_per_pack > 0) {
                        const p = Math.floor(pcs / s.pcs_per_pack);
                        const pll = packLabel(s).toLowerCase();
                        return p > 0 ? `${p} ${pll}s` : `< 1 ${pll}`;
                      }
                      // No pack config to convert with — still never a bare
                      // piece count on screen; the shared helper decides.
                      return formatQtyInTradeUnits(pcs, tradeCfg(s));
                    };
                    // Availability line: in-stock here / none here but elsewhere / out everywhere.
                    const stockLabel = stock == null ? null
                      : hereQty > 0 ? `${qtyLabel(hereQty)} in stock`
                      : elsewhereTotal > 0 ? `None here · ${qtyLabel(elsewhereTotal)} in ${otherGodownStock[0].name}`
                      : "Out of stock";
                    const inOtherGodown = noneHere && elsewhereTotal > 0;

                    return (
                      <div key={s.id} className="relative">
                        <button onClick={() => setSelectedSkuId(s.id)}
                          disabled={outOfStock}
                          className="w-full rounded-2xl p-4 text-left transition active:scale-[0.98]"
                          style={{
                            ...CARD,
                            border: "0.5px solid var(--glass-border-lo)",
                            cursor: outOfStock ? "default" : "pointer",
                          }}>
                          {/* Identity — same block as every other picker in the app */}
                          <div className="pr-9">
                            <SkuIdentity
                              brandName={s.brand_name} modelName={s.model_name} variantDisplay={s.variant_display}
                              pcsPerPack={s.pcs_per_pack} packsPerCarton={s.packs_per_carton}
                              separator="·"
                              dimmed={outOfStock}
                            />
                          </div>

                          {/* Price + availability — one neutral row, one accent only.
                              Right-padded when the quick-add "+" button is present
                              (absolutely positioned over this same bottom-right corner)
                              so the "in cart" badge wraps clear of it instead of
                              rendering underneath it. */}
                          <div className="flex items-end justify-between gap-2 mt-3" style={{ opacity: outOfStock ? 0.55 : 1, paddingRight: hasPrice && !outOfStock ? 44 : 0 }}>
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-1.5 flex-wrap">
                                <span className="font-semibold" style={{ fontSize: 22, letterSpacing: "-0.02em", color: hasPrice ? "var(--foreground)" : "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>
                                  {hasPrice ? cardPrice!.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "No GRN"}
                                </span>
                                {hasPrice && <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>MVR / {cardUomLabel}</span>}
                                {hasPrice && cardProvenance.source && (
                                  <span className="ml-0.5" style={{ position: "relative", top: 1 }}>
                                    <PriceSourceTag provenance={cardProvenance} />
                                  </span>
                                )}
                              </div>
                              <p className="ios-footnote mt-0.5" style={{ color: inOtherGodown ? "var(--snm-info)" : "var(--muted-foreground)", fontWeight: inOtherGodown ? 600 : 400 }}>
                                {stockLabel ?? " "}
                              </p>
                            </div>
                            {inCart > 0 && (
                              <span className="ios-footnote font-semibold shrink-0 px-2 py-0.5 rounded-full"
                                style={{ color: "var(--snm-brand-text)", background: "var(--snm-brand-muted)" }}>
                                {inCart} in cart
                              </span>
                            )}
                          </div>
                        </button>
                        {/* Quick-add — the single brand accent, present only when sellable */}
                        {hasPrice && !outOfStock && (
                          <button
                            onClick={handleQuickAdd}
                            className="absolute bottom-4 right-4 h-9 w-9 rounded-full flex items-center justify-center transition active:scale-90"
                            style={{
                              background: "var(--snm-brand)",
                              color: "var(--snm-brand-on)",
                              fontSize: 20,
                              fontWeight: 600,
                              lineHeight: 1,
                              boxShadow: "0 2px 10px color-mix(in srgb, var(--snm-brand) 35%, transparent)",
                            }}
                            aria-label={`Quick add ${s.brand_name} ${s.variant_display}`}
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {normalSkus.length === 0 && mixedCartonGroups.size === 0 && (
                    <p className="ios-subhead col-span-2 py-4 text-center" style={{ color: "var(--muted-foreground)" }}>
                      {skuSearch.trim()
                        ? "No products match your search."
                        : godownId
                          ? `No stock in ${godowns.find((g) => g.id === godownId)?.name ?? "this warehouse"}. Choose another warehouse or receive stock first.`
                          : "No products found."}
                    </p>
                  )}
                </div>
              </div>
            ) : selectedSku ? (() => {
              // ── Expert UX (Frog/IDEO/NNG): Display mode by default, edit on tap ──
              // No autoFocus. Qty uses +/− steppers — keyboard never opens automatically.
              // Price shows read-only; tap the pencil to edit it inline.
              // Keyboard only appears when user explicitly taps a field.
              const pl = packLabel(selectedSku);
              const uomWordHere = sellUnitLabel(lineUom, tradeCfg(selectedSku));
              const uomLabel = lineUom === "carton" ? "Carton" : lineUom === "pack" ? pl
                : uomWordHere.charAt(0).toUpperCase() + uomWordHere.slice(1);
              const qtyNum = parseFloat(lineQty) || 0;
              const hasNoPrice = !linePrice && selectedSku.landed_per_piece_mvr != null;

              // Cost + margin context
              const landed = selectedSku.landed_per_piece_mvr;
              const costForUom = landed == null ? null
                : lineUom === "piece" ? landed
                : lineUom === "pack"  ? landed * selectedSku.pcs_per_pack
                : landed * selectedSku.pcs_per_pack * selectedSku.packs_per_carton;
              const priceVal = parseFloat(linePrice);
              const margin = (costForUom != null && !isNaN(priceVal) && priceVal > 0)
                ? ((priceVal - costForUom) / priceVal) * 100 : null;

              // Price provenance — SAME classifier as the grid, so the tag the
              // salesperson saw while scanning matches what they see in the editor.
              // When the user has manually overridden the price, that's its own
              // state ("Edited") — provenance no longer describes an auto source.
              const tp = tierPrices.get(selectedSku.id);
              const editorPricePerPiece = !isNaN(priceVal) && priceVal > 0
                ? priceVal / (lineUom === "carton" ? selectedSku.pcs_per_pack * selectedSku.packs_per_carton : lineUom === "pack" ? selectedSku.pcs_per_pack : 1)
                : null;
              const editorProvenance = describePriceSource({
                source: priceManuallyEdited ? null : autoPriceSource,
                priceListName: tp?.price_list_name,
                priceListDate: tp?.price_list_date,
                pricePerPiece: editorPricePerPiece,
                landedPerPiece: selectedSku.landed_per_piece_mvr,
                targetMarginPct: selectedSku.target_margin_pct,
              });

              return (
                <div className="space-y-3">
                  {/* ── Product identity card — always visible, never obscured ── */}
                  <div className="rounded-2xl p-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                    <div className="flex items-start justify-between mb-3 gap-3">
                      <SkuIdentity
                        brandName={selectedSku.brand_name} modelName={selectedSku.model_name} variantDisplay={selectedSku.variant_display}
                        pcsPerPack={selectedSku.pcs_per_pack} packsPerCarton={selectedSku.packs_per_carton}
                        separator="·"
                        size="card"
                      />
                      <button
                        onClick={() => { setSelectedSkuId(""); setLineQty(""); setLinePrice(""); setPriceManuallyEdited(false); }}
                        className="shrink-0 ios-subhead font-semibold px-3 h-8 rounded-lg transition active:scale-95"
                        style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                        Change
                      </button>
                    </div>

                    {/* Stock + cost + margin in one clean row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {stockHere !== null && (
                        <span className="ios-subhead font-semibold px-2.5 py-1 rounded-full"
                          style={{ background: stockHere === 0 ? "color-mix(in srgb, var(--snm-error) 12%, transparent)" : "color-mix(in srgb, var(--snm-success) 12%, transparent)", color: stockHere === 0 ? "var(--snm-error)" : "var(--snm-success)" }}>
                          {stockHere === 0 ? "Out of stock" : (() => {
                            const dUom = defaultUom(selectedSku);
                            if (dUom === "carton" && selectedSku.pcs_per_pack > 0 && selectedSku.packs_per_carton > 0) {
                              const ctns = Math.floor(stockHere / (selectedSku.pcs_per_pack * selectedSku.packs_per_carton));
                              return ctns > 0 ? `${ctns} ctn in stock` : "< 1 ctn";
                            }
                            return `${formatQtyInTradeUnits(stockHere, {
                              pcsPerPack: selectedSku.pcs_per_pack,
                              packsPerCarton: selectedSku.packs_per_carton,
                              unitUom: selectedSku.unit_uom,
                              sellableUnits: selectedSku.sellable_units,
                            })} in stock`;
                          })()}
                        </span>
                      )}
                      {costForUom != null && (
                        <span className="ios-subhead px-2.5 py-1 rounded-full" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)", color: "var(--muted-foreground)" }}>
                          Cost {costForUom.toFixed(lineUom === "piece" ? 4 : 2)} MVR/{uomLabel.toLowerCase()}
                        </span>
                      )}
                      {margin !== null && costForUom != null && (() => {
                        // Plain money, not accountant-speak: "Makes MVR 25/pack",
                        // never "-5.8% margin". Profit in rufiyaa is what the owner
                        // actually thinks in; percentages live in Financials.
                        const profit = priceVal - costForUom;
                        const amt = Math.abs(profit) >= 10 ? Math.abs(profit).toFixed(0) : Math.abs(profit).toFixed(2);
                        const u = uomLabel.toLowerCase();
                        return (
                          <span className="ios-subhead font-bold px-2.5 py-1 rounded-full"
                            style={{ background: profit >= 0 ? "color-mix(in srgb, var(--snm-success) 12%, transparent)" : "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: profit >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                            {profit >= 0 ? `Makes MVR ${amt}/${u} · ${Math.round((profit / priceVal) * 100)}%` : `Loses MVR ${amt}/${u}`}
                          </span>
                        );
                      })()}
                    </div>

                    {/* No GRN warning */}
                    {selectedSku.landed_per_piece_mvr == null && (
                      <p className="ios-subhead mt-2 font-medium" style={{ color: "var(--snm-warning)" }}>
                        ⚠ No confirmed shipment — confirm a GRN first
                      </p>
                    )}

                    {/* Below-target-margin warning — suggestion only, never blocks the sale.
                        Distinct from the red "below 0%" badge above: this fires even on a
                        still-profitable sale if it undercuts the owner's own target margin. */}
                    {margin !== null && margin >= 0 && selectedSku.target_margin_pct != null && margin < selectedSku.target_margin_pct && (
                      <p className="ios-subhead mt-2 font-medium" style={{ color: "var(--snm-warning)" }}>
                        ⚠ Less profit than you usually aim for ({selectedSku.target_margin_pct}%)
                      </p>
                    )}
                  </div>

                  {/* ── UOM segmented control — exactly the tiers this SKU sells
                      in, no more. `sellable_units` is the only input: it used
                      to also synthesise a "Piece" button for any pack-selling
                      SKU, which put "sell one loose diaper" in front of Ali on
                      every product. Nobody in this trade sells diapers loose,
                      and no SKU lists `piece`. See lib/trade-units. ── */}
                  <div className="rounded-2xl p-1 flex gap-1" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}>
                    {sellableTiers(selectedSku.sellable_units).map((u) => {
                      const one = sellUnitLabel(u, tradeCfg(selectedSku));
                      const label = u === "carton" ? `Carton (${selectedSku.packs_per_carton} ${pl}s)`
                        : u === "pack" ? pl
                        : one.charAt(0).toUpperCase() + one.slice(1);
                      return (
                        <button key={u} onClick={() => setLineUom(u)}
                          className="flex-1 py-2.5 rounded-xl ios-subhead font-semibold transition active:scale-95"
                          style={lineUom === u
                            ? { background: "var(--glass-accent)", color: "var(--snm-brand-on)" }
                            : { color: "var(--muted-foreground)" }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Mixed carton toggle — only visible when selling by piece ── */}
                  {lineUom === "piece" && (
                    <button
                      type="button"
                      onClick={() => setMixedCarton((v) => !v)}
                      className="w-full flex items-center justify-between px-4 h-12 rounded-xl transition active:scale-[0.99]"
                      style={{
                        background: mixedCarton
                          ? "color-mix(in srgb, var(--snm-brand) 10%, var(--glass-1))"
                          : "var(--glass-1)",
                        border: mixedCarton
                          ? "1px solid color-mix(in srgb, var(--snm-brand) 30%, transparent)"
                          : "0.5px solid var(--glass-border-lo)",
                      }}
                    >
                      <div className="text-left">
                        <p className="ios-subhead font-semibold" style={{ color: mixedCarton ? "var(--snm-brand)" : "var(--foreground)" }}>
                          Mixed carton fill
                        </p>
                        <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                          {mixedCarton
                            ? `Charging carton rate ÷ ${selectedSku.pcs_per_pack * selectedSku.packs_per_carton} ${sellUnitLabel("piece", tradeCfg(selectedSku))}s`
                            : "Customer assembles their own mixed carton"}
                        </p>
                      </div>
                      <div
                        className="w-10 h-6 rounded-full flex items-center transition-all shrink-0 ml-3"
                        style={{
                          background: mixedCarton ? "var(--snm-brand)" : "color-mix(in srgb, var(--foreground) 15%, transparent)",
                          padding: "2px",
                          justifyContent: mixedCarton ? "flex-end" : "flex-start",
                        }}
                      >
                        <div className="w-5 h-5 rounded-full" style={{ background: "var(--background)" }} />
                      </div>
                    </button>
                  )}

                  {/* ── Qty stepper + Price display — the key UX insight ──
                      Qty: large +/− stepper, no keyboard.
                      Price: shown read-only. Tap pencil → inline input appears.
                      Keyboard only fires when the user deliberately asks for it. ── */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Qty stepper */}
                    <div className="rounded-2xl p-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                      <p className="text-[12px] uppercase tracking-widest mb-3 font-semibold" style={{ color: "var(--muted-foreground)" }}>
                        QTY · {uomLabel}S
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => { const n = Math.max(0, qtyNum - 1); setLineQty(n > 0 ? String(n) : ""); }}
                          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-bold transition active:scale-90"
                          style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--foreground)" }}>
                          −
                        </button>
                        {/* Tapping the number opens the keyboard for direct entry */}
                        <input
                          type="number" inputMode="numeric" min="1"
                          value={lineQty}
                          onChange={(e) => setLineQty((e.target as HTMLInputElement).value)}
                          onFocus={(e) => e.target.select()}
                          placeholder="0"
                          className="flex-1 text-center text-[28px] font-bold bg-transparent text-foreground outline-none"
                          style={{ minWidth: 0 }}
                        />
                        <button
                          onClick={() => setLineQty(String(qtyNum + 1))}
                          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-bold transition active:scale-90"
                          style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
                          +
                        </button>
                      </div>
                    </div>

                    {/* Price — display until tapped */}
                    <div className="rounded-2xl p-4" style={{ ...CARD, border: hasNoPrice ? "1px solid color-mix(in srgb, var(--snm-warning) 40%, transparent)" : "0.5px solid var(--glass-border-lo)" }}>
                      <p className="text-[12px] uppercase tracking-widest mb-3 font-semibold flex items-center gap-1.5" style={{ color: "var(--muted-foreground)" }}>
                        MVR / {uomLabel}
                        {priceManuallyEdited && linePrice ? (
                          <span className="ios-subhead px-1.5 py-0.5 rounded font-semibold" style={{ background: "var(--snm-brand-muted)", color: "var(--snm-brand-text)" }}>
                            Edited
                          </span>
                        ) : editorProvenance.source ? (
                          <PriceSourceTag provenance={editorProvenance} size="md" onClick={() => setShowPriceExplain(true)} />
                        ) : null}
                      </p>
                      {/* Single input — no autoFocus, displays cleanly, editable on tap */}
                      <input
                        type="number" inputMode="decimal" step="0.01" min="0"
                        value={linePrice}
                        onChange={(e) => handlePriceChange((e.target as HTMLInputElement).value)}
                        onFocus={(e) => e.target.select()}
                        onBlur={handlePriceBlur}
                        placeholder={hasNoPrice ? "Tap to set" : "0.00"}
                        className="w-full text-[28px] font-bold bg-transparent text-foreground outline-none text-center"
                        style={{ minWidth: 0 }}
                      />
                      {costForUom != null && !isNaN(priceVal) && priceVal > 0 && priceVal - costForUom >= 0 && (() => {
                        const profit = priceVal - costForUom;
                        const amt = profit >= 10 ? profit.toFixed(0) : profit.toFixed(2);
                        return (
                          <p className="w-full ios-subhead text-center mt-1 font-semibold leading-tight" style={{ color: "var(--snm-success)" }}>
                            Makes MVR {amt}/{uomLabel.toLowerCase()} · {Math.round((profit / priceVal) * 100)}%
                          </p>
                        );
                      })()}
                      {!priceManuallyEdited && editorProvenance.source && editorProvenance.detail && (
                        <button
                          type="button"
                          onClick={() => setShowPriceExplain(true)}
                          className="w-full ios-subhead text-center mt-1 leading-tight underline"
                          style={{ color: "var(--muted-foreground)", textUnderlineOffset: 2 }}
                        >
                          {editorProvenance.detail}
                        </button>
                      )}
                      {priceWarning && (
                        <button
                          type="button"
                          onClick={() => setShowPriceExplain(true)}
                          className="w-full ios-subhead text-center mt-1 font-semibold leading-tight underline"
                          style={{ color: priceWarning.color, textUnderlineOffset: 2 }}
                        >
                          ⚠ {priceWarning.text}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Line total — only shown once qty > 0 ── */}
                  {lineQtyPieces > 0 && (
                    <div className="flex items-center justify-between px-1">
                      <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                        {/* Packs and cartons, never a piece total — nobody
                            orders diapers by the piece. */}
                        = {formatQtyInTradeUnits(lineQtyPieces, {
                            pcsPerPack: selectedSku.pcs_per_pack,
                            packsPerCarton: selectedSku.packs_per_carton,
                            unitUom: selectedSku.unit_uom,
                            sellableUnits: selectedSku.sellable_units,
                          })} in total
                      </span>
                      <span className="text-[18px] font-bold text-foreground">MVR {lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {insufficient && (
                    <p className="ios-subhead font-semibold px-1" style={{ color: "var(--snm-error)" }}>
                      ⚠ Only {formatQtyInTradeUnits(stockHere, {
                          pcsPerPack: selectedSku.pcs_per_pack,
                          packsPerCarton: selectedSku.packs_per_carton,
                          unitUom: selectedSku.unit_uom,
                          sellableUnits: selectedSku.sellable_units,
                        })} available in this warehouse
                    </p>
                  )}

                  {/* ── "Where did this price come from?" — answers exactly
                      what's driving the number on screen, plain language,
                      with a direct tap-through to go fix it. Never leaves
                      Ali staring at a number with no explanation. ── */}
                  {showPriceExplain && portalReady && createPortal(
                    // Portalled to document.body — NOT rendered inside
                    // NewSaleSheet's own `fixed inset-x-0 top-0` container.
                    // A `position: fixed` element nested inside ANOTHER fixed
                    // element is a known iOS Safari compositing trap: the
                    // inner fixed layer can fail to promote above the
                    // outer's later-painted children (here, the outer
                    // sheet's own pinned footer), so the footer visibly
                    // showed through UNDER this sheet's buttons on a real
                    // phone despite a higher z-index — z-index only
                    // resolves stacking within the SAME containing block, and
                    // nesting fixed-in-fixed silently creates a new one.
                    // Portalling to <body> guarantees this sheet is a true
                    // sibling of the page, not a descendant of any other
                    // fixed element, so it always paints on top of
                    // everything with no ambiguity.
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label="How this price was worked out"
                      className="fixed inset-0 z-[80] flex items-end snm-scrim-in"
                      style={{ background: "var(--scrim-bg)", touchAction: "none" }}
                      onClick={() => { setShowPriceExplain(false); setEditingPrice(false); setSimEditingTyped(false); }}
                    >
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
                        style={{
                          background: "var(--background)",
                          borderTop: "0.5px solid var(--glass-border-lo)",
                          boxShadow: "var(--glass-shadow-lg)",
                          // Reaches the TRUE bottom of the screen — never a
                          // percentage guess. A 70dvh sheet left the real
                          // bottom 30% of the viewport exposed to the page
                          // underneath, which is exactly what showed through
                          // as "the old footer bleeding in below the sheet"
                          // on a real phone. maxHeight caps it so short
                          // content doesn't force the sheet absurdly tall.
                          maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
                        }}
                      >
                        {/* Fixed header — grabber + title stay pinned */}
                        <div className="shrink-0 px-5 pt-3">
                          <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />
                          <h2 className="text-lg font-semibold text-foreground text-center">Where this price comes from</h2>
                        </div>

                        {/* Scrollable body — the ONLY scroll region */}
                        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pt-4" style={{ touchAction: "pan-y" }}>
                          <div className="rounded-2xl p-4 space-y-2" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                            {editorProvenance.source === "sku_default" && (
                              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                                This is the <strong>fixed selling price</strong> saved on this product — not calculated from a formula, someone typed it in directly when the product was set up.
                              </p>
                            )}
                            {editorProvenance.source === "margin" && (
                              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                                This price is <strong>calculated automatically</strong>: landed cost{landed != null && selectedSku ? (() => {
                                  const c = costPerTradeUnit(landed, tradeCfg(selectedSku));
                                  return ` (MVR ${c.value.toFixed(2)}/${c.unitLabel === "ctn" ? "carton" : c.unitLabel})`;
                                })() : ""} plus a target margin of <strong>{selectedSku?.target_margin_pct ?? Math.round(editorProvenance.marginPct ?? 0)}%</strong>.
                              </p>
                            )}
                            {editorProvenance.source === "price_list" && (
                              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                                This price comes from a <strong>customer price list</strong>{editorProvenance.detail ? ` — ${editorProvenance.detail}` : ""}.
                              </p>
                            )}
                            {landed != null && selectedSku && (() => {
                              // Landed cost is stored per piece because that is
                              // what the stock ledger and the GRN divide down
                              // to. It is never SHOWN per piece: quote it in
                              // the unit Ali actually buys and sells.
                              const c = costPerTradeUnit(landed, tradeCfg(selectedSku));
                              return (
                                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                                  What this product costs you landed: <strong style={{ color: "var(--foreground)" }}>MVR {c.value.toFixed(2)} / {c.unitLabel === "ctn" ? "carton" : c.unitLabel}</strong>.
                                </p>
                              );
                            })()}
                            {margin != null && (
                              <p className="ios-subhead" style={{ color: margin < 0 ? "var(--snm-error)" : "var(--foreground)" }}>
                                At the price shown, you&apos;re making <strong>{margin.toFixed(1)}% margin</strong>{margin < 0 ? " — you are losing money on this sale." : "."}
                              </p>
                            )}
                          </div>

                          {/* Inline price fix — the same Margin Simulator used
                              on the Pricing screen (slider + typed-override,
                              saved as either an auto-recalculating target
                              margin or a locked fixed price), not a bare
                              number box. Never leaves New Sale. Editing a
                              customer's price list is a bigger, separate job
                              (multiple tiers/SKUs) so that case still
                              deep-links out. */}
                          {editingPrice && (editorProvenance.source === "sku_default" || editorProvenance.source === "margin") && selectedSku && landed != null && (() => {
                            const pcsPerPack = selectedSku.pcs_per_pack || 1;
                            const packsPerCarton = selectedSku.packs_per_carton || 1;
                            const landedPerPack = landed * pcsPerPack;
                            const landedPerCarton = landedPerPack * packsPerCarton;
                            const simPiecePrice  = simPackPrice / pcsPerPack;
                            const simCartonPrice = simPackPrice * packsPerCarton;
                            const simDisplayPrice = lineUom === "piece" ? simPiecePrice : lineUom === "carton" ? simCartonPrice : simPackPrice;
                            const simLandedForUom = lineUom === "piece" ? landed : lineUom === "carton" ? landedPerCarton : landedPerPack;
                            const currentMarginPct = simPackPrice > 0 ? Math.round(((simPackPrice - landedPerPack) / simPackPrice) * 100) : 0;
                            const sliderVal = Math.max(1, Math.min(99, currentMarginPct));
                            const fillPct = ((sliderVal - 1) / 98) * 100;

                            function setDisplayPrice(v: number) {
                              const asPack = lineUom === "piece" ? v * pcsPerPack : lineUom === "carton" ? v / packsPerCarton : v;
                              setSimPackPrice(asPack);
                            }

                            return (
                              <div className="rounded-2xl p-4 mt-3 space-y-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                                {/* Live price display — pencil to type an exact override */}
                                <div className="rounded-2xl px-5 pt-5 pb-4 text-center relative"
                                  style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}>
                                  {!simEditingTyped && (
                                    <button
                                      onClick={() => { setSimTyped(String(Math.round(simDisplayPrice))); setSimEditingTyped(true); }}
                                      className="absolute top-3 right-3 h-7 w-7 rounded-lg flex items-center justify-center transition active:scale-90"
                                      style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
                                      aria-label="Type exact price"
                                    >
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--muted-foreground)" }}>
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                      </svg>
                                    </button>
                                  )}
                                  {simEditingTyped ? (
                                    <input
                                      type="number" inputMode="decimal" autoFocus
                                      value={simTyped}
                                      onChange={(e) => setSimTyped(e.target.value)}
                                      onFocus={(e) => e.target.select()}
                                      onBlur={() => { const v = parseFloat(simTyped); if (!isNaN(v) && v > 0) setDisplayPrice(v); setSimEditingTyped(false); }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") { const v = parseFloat(simTyped); if (!isNaN(v) && v > 0) setDisplayPrice(v); setSimEditingTyped(false); }
                                        if (e.key === "Escape") setSimEditingTyped(false);
                                      }}
                                      className="text-[44px] font-light tracking-tight text-foreground text-center bg-transparent outline-none border-none w-full"
                                    />
                                  ) : (
                                    <p className="text-[44px] font-light tracking-tight text-foreground leading-none">{Math.round(simDisplayPrice)}</p>
                                  )}
                                  <p className="ios-subhead mt-1 font-medium" style={{ color: "var(--muted-foreground)" }}>MVR / {uomLabel.toLowerCase()}</p>
                                </div>

                                {/* Margin slider — always computed per-pack to avoid tiny-number drift */}
                                <div className="rounded-2xl px-5 py-4" style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}>
                                  <style>{`
                                    .snm-slider2 { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 9999px; outline: none; cursor: pointer; background: transparent; }
                                    .snm-slider2::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 32px; height: 32px; border-radius: 50%; background: var(--snm-brand); box-shadow: 0 2px 16px var(--snm-brand-muted); cursor: grab; border: 3px solid rgba(255,255,255,0.75); margin-top: -13px; }
                                    .snm-slider2::-moz-range-thumb { width: 32px; height: 32px; border-radius: 50%; background: var(--snm-brand); box-shadow: 0 2px 16px var(--snm-brand-muted); cursor: grab; border: 3px solid rgba(255,255,255,0.75); }
                                    .snm-slider2::-webkit-slider-runnable-track { height: 6px; border-radius: 9999px; }
                                    .snm-slider2::-moz-range-track { height: 6px; border-radius: 9999px; background: rgba(128,128,128,0.2); }
                                  `}</style>
                                  <div className="flex items-center justify-between mb-4">
                                    <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Margin</p>
                                    <div className="flex items-baseline gap-0.5">
                                      <p className="text-[28px] font-bold leading-none" style={{ color: "var(--snm-brand-text)" }}>{sliderVal}</p>
                                      <p className="text-[16px] font-semibold leading-none" style={{ color: "var(--muted-foreground)" }}>%</p>
                                    </div>
                                  </div>
                                  <div className="relative">
                                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full overflow-hidden pointer-events-none"
                                      style={{ background: "color-mix(in srgb, var(--foreground) 12%, transparent)" }}>
                                      <div className="h-full rounded-full" style={{ width: `${fillPct}%`, background: "var(--snm-brand)" }} />
                                    </div>
                                    <input
                                      type="range" min={1} max={99} step={1} value={sliderVal}
                                      onChange={(e) => {
                                        const pct = parseInt(e.target.value);
                                        const p = priceForMargin(landedPerPack, pct);
                                        if (p != null) setSimPackPrice(Math.round(p));
                                      }}
                                      className="snm-slider2 relative"
                                      style={{ touchAction: "none" }}
                                    />
                                  </div>
                                  <div className="flex justify-between mt-1">
                                    <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>1%</p>
                                    <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>99%</p>
                                  </div>
                                </div>

                                <p className="ios-subhead text-center" style={{ color: simDisplayPrice <= simLandedForUom ? "var(--snm-error)" : "var(--muted-foreground)" }}>
                                  Costs you {simLandedForUom.toFixed(2)} — {simDisplayPrice <= simLandedForUom ? "still below cost" : "you're above cost"}
                                </p>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Fixed footer — always visible, never scrolled past */}
                        <div className="shrink-0 flex flex-col gap-2 px-5 pt-3" style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
                          {editingPrice && (editorProvenance.source === "sku_default" || editorProvenance.source === "margin") && selectedSku && landed != null ? (() => {
                            const pcsPerPack = selectedSku.pcs_per_pack || 1;
                            const packsPerCarton = selectedSku.packs_per_carton || 1;
                            const landedPerPack = landed * pcsPerPack;
                            const piecePrice = simPackPrice / pcsPerPack;
                            const impliedMarginPct = landedPerPack > 0 && simPackPrice > landedPerPack
                              ? Math.round(((simPackPrice - landedPerPack) / simPackPrice) * 1000) / 10
                              : 0;
                            const displayNewPrice = lineUom === "piece" ? piecePrice : lineUom === "carton" ? simPackPrice * packsPerCarton : simPackPrice;
                            const canSave = simPackPrice > landedPerPack;

                            async function save(mode: "margin" | "fixed") {
                              if (!selectedSku || !canSave) return;
                              setSavingFixedPrice(mode);
                              try {
                                // v_skus resolves price per tier independently — a
                                // leftover fixed_price_per_pack/carton_mvr from an
                                // old volume-break override beats BOTH
                                // fixed_selling_price_mvr and target_margin_pct at
                                // that tier, silently reviving the stale price the
                                // next time this SKU loads. Whichever mode is
                                // chosen here must win at every tier, so always
                                // clear all three fixed-price columns first.
                                const cleared = { fixed_selling_price_mvr: null, fixed_price_per_pack_mvr: null, fixed_price_per_carton_mvr: null, target_margin_pct: null };
                                if (mode === "fixed") {
                                  await updateSku(selectedSku.id, { ...cleared, fixed_selling_price_mvr: piecePrice });
                                  setPriceOverrides((prev) => ({ ...prev, [selectedSku.id]: { ...prev[selectedSku.id], ...cleared, fixed_selling_price_mvr: piecePrice } }));
                                } else {
                                  await updateSku(selectedSku.id, { ...cleared, target_margin_pct: impliedMarginPct });
                                  setPriceOverrides((prev) => ({ ...prev, [selectedSku.id]: { ...prev[selectedSku.id], ...cleared, target_margin_pct: impliedMarginPct } }));
                                }
                                setLinePrice(String(Math.round(displayNewPrice)));
                                setPriceManuallyEdited(false);
                                setAutoPriceSource(mode === "fixed" ? "sku_default" : "margin");
                                // Stored per piece (that is the column), but
                                // confirmed back in the unit it will be sold in.
                                const shown = costPerTradeUnit(piecePrice, tradeCfg(selectedSku));
                                toast.success(mode === "fixed"
                                  ? `Fixed price saved — MVR ${shown.value.toFixed(2)}/${shown.unitLabel === "ctn" ? "carton" : shown.unitLabel}`
                                  : `${impliedMarginPct}% margin saved`);
                                setEditingPrice(false);
                                setShowPriceExplain(false);
                              } catch (e) {
                                toast.error((e as Error).message);
                              } finally {
                                setSavingFixedPrice(null);
                              }
                            }

                            return (
                              <>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setEditingPrice(false)}
                                    className="flex-1 h-12 rounded-xl font-semibold"
                                    style={{ background: "var(--secondary)", color: "var(--foreground)" }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    disabled={!!savingFixedPrice || !canSave}
                                    onClick={() => save("margin")}
                                    className="flex-[2] h-12 rounded-xl font-semibold transition disabled:opacity-40 flex items-center justify-center gap-2"
                                    style={{ background: "var(--snm-brand)", color: "var(--snm-brand-on)" }}
                                  >
                                    {savingFixedPrice === "margin" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><TrendingUp className="h-4 w-4" /> Save at {impliedMarginPct}% margin</>}
                                  </button>
                                </div>
                                <button
                                  disabled={!!savingFixedPrice || !canSave}
                                  onClick={() => save("fixed")}
                                  className="h-11 w-full rounded-xl ios-subhead font-semibold transition disabled:opacity-40 flex items-center justify-center gap-1.5"
                                  style={{ background: "var(--secondary)", color: "var(--foreground)" }}
                                >
                                  {savingFixedPrice === "fixed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Or lock as fixed price · MVR ${Math.round(displayNewPrice)}`}
                                </button>
                              </>
                            );
                          })() : (editorProvenance.source === "sku_default" || editorProvenance.source === "margin") && selectedSku ? (
                            <button
                              onClick={() => {
                                // Seed the simulator from the current price so
                                // the slider/thumb starts exactly where the
                                // shown price already is, not from zero.
                                const pcsPerPack = selectedSku.pcs_per_pack || 1;
                                const cur = parseFloat(linePrice) || 0;
                                const asPack = lineUom === "piece" ? cur * pcsPerPack : lineUom === "carton" ? cur / (selectedSku.packs_per_carton || 1) : cur;
                                setSimPackPrice(asPack > 0 ? asPack : (selectedSku.landed_per_piece_mvr ?? 0) * pcsPerPack * 1.3);
                                setEditingPrice(true);
                              }}
                              className="h-12 w-full rounded-xl font-semibold"
                              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}
                            >
                              Fix this product&apos;s price
                            </button>
                          ) : null}
                          {editorProvenance.source === "price_list" && (
                            <button
                              onClick={() => { window.location.href = "/pricelists"; }}
                              className="h-12 w-full rounded-xl font-semibold"
                              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}
                            >
                              Manage price lists →
                            </button>
                          )}
                          {!editingPrice && (
                            <button onClick={() => setShowPriceExplain(false)} className="h-12 w-full rounded-xl font-semibold" style={{ background: "var(--secondary)", color: "var(--foreground)" }}>
                              Close
                            </button>
                          )}
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
              );
            })() : null}

            {/* Draft lines — the same cart as step 3, same component. It is a
                list and a total; the way to add another product is the footer
                button, which is on screen no matter how far this has scrolled.
                Hidden at lg, where the rail on the right already shows it. */}
            <div className="lg:hidden">
              <CartLines
                lines={draftLines}
                grandTotal={grandTotal}
                editable
                onChangeQty={changeLineQty}
                onRemove={removeLine}
                maxPiecesFor={maxPiecesFor}
              />
            </div>

            </>
            )}
          </div>
        )}

        {/* ── Step 3: Confirm + Payment ── */}
        {step === 3 && (
          <div className="space-y-4">

            {/* Order total hero */}
            <div className="rounded-2xl p-5" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
              <p className="text-[12px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Order Total</p>
              <p className="text-[36px] font-bold tracking-tight text-foreground leading-none mb-1 tabular-nums">
                {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="text-[16px] ml-1.5" style={{ color: "var(--muted-foreground)" }}>MVR</span>
              </p>
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                {draftLines.length} item{draftLines.length !== 1 ? "s" : ""} · {customerId === "walkin" ? "Walk-in" : (customer?.name ?? "—")} · via {CHANNELS.find((c) => c.value === channel)?.label}
              </p>
            </div>

            {/* Line items — the SAME cart component as step 2, with the
                quantity steppers, the bin and a way back for more. It used to
                be a read-only list: nothing could be changed on the last
                screen before the order was placed. Hidden at lg — the rail. */}
            <div className="lg:hidden">
              <CartLines
                lines={draftLines}
                grandTotal={grandTotal}
                editable
                onChangeQty={changeLineQty}
                onRemove={removeLine}
                maxPiecesFor={maxPiecesFor}
              />
            </div>

            {/* ── Ship from ──
                The warehouse decides which stock gets deducted, and it was
                chosen back on step 2 and never shown again — so a wrong pick
                sailed through to Place Order unseen, and only surfaced at a
                stock count. Restating a consequential choice on the review
                step is the cheapest catch there is: no extra taps if it's
                right, one tap to fix if it isn't. */}
            <div className="space-y-2">
              <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>Ship from</p>
              <WarehouseSelect value={godownId} onChange={setGodownId} godowns={godowns} />

              {godownCheck && (
                <div className="rounded-xl p-3.5"
                  style={{
                    background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--snm-warning) 30%, transparent)",
                  }}>
                  <p className="ios-subhead font-semibold" style={{ color: "var(--snm-warning)" }}>
                    {godownCheck.shortCount === 1 ? "1 item isn't" : `${godownCheck.shortCount} items aren't`} in{" "}
                    {godowns.find((g) => g.id === godownId)?.name ?? "this warehouse"}
                  </p>
                  <p className="ios-subhead mt-1" style={{ color: "var(--muted-foreground)" }}>
                    {godownCheck.names.slice(0, 3).join(", ")}
                    {godownCheck.names.length > 3 ? ` +${godownCheck.names.length - 3} more` : ""}
                  </p>
                  {godownCheck.better && (
                    <button
                      onClick={() => setGodownId(godownCheck.better!.id)}
                      className="mt-2.5 h-11 px-4 rounded-xl ios-subhead font-semibold w-full active:scale-[0.99]"
                      style={{ background: "var(--foreground)", color: "var(--background)" }}
                    >
                      Ship from {godownCheck.better.name} instead
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Payment method */}
            <div className="space-y-2">
              <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>How will the customer pay?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod("bank_transfer")}
                  className="rounded-xl p-4 text-left transition active:scale-95 space-y-2"
                  style={{ ...CARD, border: paymentMethod === "bank_transfer" ? "2px solid var(--foreground)" : "0.5px solid var(--glass-border-lo)" }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
                    <Smartphone className="h-4 w-4 text-foreground" />
                  </div>
                  <p className="ios-subhead font-semibold text-foreground">Bank Transfer</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>They send payment slip via WhatsApp / Viber</p>
                </button>
                <button
                  onClick={() => setPaymentMethod("cod")}
                  className="rounded-xl p-4 text-left transition active:scale-95 space-y-2"
                  style={{ ...CARD, border: paymentMethod === "cod" ? "2px solid var(--foreground)" : "0.5px solid var(--glass-border-lo)" }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
                    <Banknote className="h-4 w-4 text-foreground" />
                  </div>
                  <p className="ios-subhead font-semibold text-foreground">Cash on Delivery</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Driver collects cash, hands it to you</p>
                </button>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>Delivery notes (optional)</p>
              <textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="e.g. Leave at the gate, call before arriving…"
                rows={2}
                className="w-full px-4 py-3 rounded-xl ios-subhead text-foreground outline-none resize-none"
                style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }} />
            </div>

            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
              Placing this order will immediately deduct stock from the warehouse.
            </p>
          </div>
        )}
        </div>

        {/* ── Desktop order rail (lg and up) ──────────────────────────────────
            The order, visible during all three steps. On a phone the cart is
            something you scroll to; on a wide screen there is room to simply
            keep it on screen, which is what every desktop checkout does and
            what makes the "Add product" footer button unnecessary here.

            It uses the SAME CartLines component and the SAME handlers as the
            phone, so the steppers, the bin, the stock cap and the whole-carton
            arithmetic behave identically. Nothing about money is re-implemented
            for a wide screen. There is also no action button in this rail: the
            single primary action stays in the footer, so there is exactly one
            door through the below-cost and shortfall guards. */}
        <aside aria-label="Order summary"
          className="hidden lg:block lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-8 space-y-3"
          style={{ overscrollBehavior: "contain" }}>
          <div className="rounded-2xl p-4 space-y-1"
            style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
            <p className="label-caps" style={{ color: "var(--muted-foreground)" }}>This order</p>
            <p className="ios-subhead font-semibold text-foreground truncate">
              {customerId === "walkin" ? "Walk-in customer" : (customer?.name ?? "No customer yet")}
            </p>
            <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
              {[
                customerId && customerId !== "walkin" ? `${orderTier} price` : null,
                godowns.find((g) => g.id === godownId)?.name ?? "No warehouse yet",
                CHANNELS.find((c) => c.value === channel)?.label,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>

          {draftLines.length === 0 ? (
            <div className="rounded-2xl p-5 text-center"
              style={{ background: "var(--glass-bg-1)", border: "0.5px dashed var(--glass-border-lo)" }}>
              <ShoppingCart className="h-5 w-5 mx-auto mb-2" style={{ color: "var(--foreground)", opacity: 0.5 }} />
              <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                Nothing added yet. Pick a product on the left and it appears here.
              </p>
            </div>
          ) : (
            <CartLines
              lines={draftLines}
              grandTotal={grandTotal}
              editable
              onChangeQty={changeLineQty}
              onRemove={removeLine}
              maxPiecesFor={maxPiecesFor}
            />
          )}

          {shortfalls.length > 0 && (
            <p className="ios-footnote font-semibold px-1" style={{ color: "var(--snm-error)" }}>
              {shortfalls[0].short} more {shortfalls[0].noun} needed to fill the carton
            </p>
          )}
        </aside>
      </div>
      </div>

      {/* Fixed bottom actions */}
      {/* Action bar. On a phone the buttons split the full width — a thumb
          needs the target. On desktop that same rule produced a 1110px-wide
          "Review & Confirm", which is a phone button stretched, not a desktop
          one: at lg they take their natural width and sit to the right, where
          a primary action belongs in a window. */}
      <footer className="glass-panel--strong shrink-0 px-5 lg:px-8 gap-3 flex items-center lg:justify-end relative z-[1]" style={{ paddingTop: "12px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", minHeight: 72, borderRadius: 0, borderLeft: "none", borderRight: "none", borderBottom: "none", borderTop: "0.5px solid var(--glass-border-lo)" }}>
        {step === 1 && (
          <>
            <button onClick={onClose} className="flex-1 lg:flex-none lg:px-10 h-14 rounded-xl ios-subhead font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>Cancel</button>
            <button disabled={!customerId} onClick={async () => {
                try {
                  const skuIds = skus.map((s) => s.id);
                  const map = await getTierPricesForSkus(skuIds, orderTier);
                  setTierPrices(map);
                } catch {
                  // Non-fatal: fall back to SKU defaults
                  setTierPrices(new Map());
                }
                setStep(2);
              }}
              className="flex-[2] lg:flex-none lg:px-14 h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
              Add Products <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}
        {step === 2 && (
          selectedSkuId ? (
            // A product is actively being configured — this docked bar IS
            // the primary action (was a second, in-flow button before,
            // which left a dead gap between it and this same bar). One
            // action, always in the same place, native-form style.
            <>
              <button onClick={() => setSelectedSkuId("")} className="flex-1 lg:flex-none lg:px-10 h-14 rounded-xl ios-subhead font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
              <button onClick={handleAddLine} disabled={!lineQty || !linePrice || lineQtyPieces <= 0 || insufficient}
                className="flex-[2] lg:flex-none lg:px-14 h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
                <Plus className="h-4 w-4" /> Add to Order
              </button>
            </>
          ) : (
            <>
              {/* Ali, 2026-08-09: "What's this big + sign? The actual '+add
                  more' is scrolling."
                  Two mistakes, one fix. The pill lived in the cart, and the
                  cart scrolls, so it left the screen — and the answer I reached
                  for was a SECOND control in the footer rather than moving the
                  first, which left a bare "+" whose meaning nobody can guess.
                  Now there is exactly one, it says what it does, and it is in
                  the footer, which never moves.

                  "← Back" goes icon-only once the cart has something in it, so
                  three controls still fit a 390pt phone without the primary
                  action wrapping. A left chevron is a universal affordance in
                  a way a bare plus is not.

                  Only TWO buttons here. A third made both of these wrap onto
                  two lines at 393pt — "Back" now lives in the step indicator
                  at the top, which is always on screen. */}
              <button
                onClick={() => draftLines.length > 0
                  ? productSearchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                  : setStep(1)}
                className="snm-pressable h-14 flex-1 rounded-xl px-3 flex items-center justify-center gap-1.5 ios-subhead font-semibold whitespace-nowrap lg:hidden"
                style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: draftLines.length > 0 ? "var(--snm-brand-text)" : "var(--foreground)" }}>
                {draftLines.length > 0
                  ? <><Plus className="h-4 w-4 shrink-0" /> Add product</>
                  : <><ArrowLeft className="h-4 w-4 shrink-0" /> Back</>}
              </button>
              <button disabled={draftLines.length === 0 || shortfalls.length > 0} onClick={() => setStep(3)}
                className="flex-[2] lg:flex-none lg:px-14 h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2 whitespace-nowrap"
                style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
                {draftLines.length === 0 ? "Add at least 1 item"
                  : shortfalls.length > 0 ? `Add ${shortfalls[0].short} more ${shortfalls[0].noun}`
                  : <>Review & Confirm <ArrowRight className="h-4 w-4" /></>}
              </button>
            </>
          )
        )}
        {step === 3 && (
          <>
            <button onClick={() => setStep(2)} className="flex-1 lg:flex-none lg:px-10 h-14 rounded-xl ios-subhead font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
            {/* A part-carton is refused by the database (0163). Catching it
                here means the reason is on screen next to the fix, instead of
                arriving as an error after the last tap. */}
            <button disabled={saving || shortfalls.length > 0} onClick={handleSubmit}
              className="flex-[2] lg:flex-none lg:px-14 h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" />
                : shortfalls.length > 0
                  ? `Add ${shortfalls[0].short} more ${shortfalls[0].noun}`
                  : <>Place Order <ArrowRight className="h-4 w-4" /></>}
            </button>
          </>
        )}
      </footer>

      {showScanner && (
        <BarcodeScanner
          hint="Scan product barcode"
          onResult={handleScanResult}
          onClose={() => setShowScanner(false)}
        />
      )}

      {belowCostAdd && portalReady && createPortal(
        (() => {
          const s = belowCostAdd.sku;
          const mult = belowCostAdd.uom === "carton" ? s.pcs_per_pack * s.packs_per_carton
                     : belowCostAdd.uom === "pack" ? s.pcs_per_pack : 1;
          const cost = (s.landed_per_piece_mvr ?? 0) * mult;
          const loss = cost - belowCostAdd.price;
          const u = sellUnitLabel(belowCostAdd.uom, tradeCfg(s));
          return (
            <ConfirmSheet
              open
              title="This sells below cost"
              message={`${s.brand_name} ${s.variant_display} costs you MVR ${cost.toFixed(0)}/${u} right now — at MVR ${belowCostAdd.price.toFixed(0)} you lose about MVR ${loss.toFixed(loss >= 10 ? 0 : 2)} per ${u}. Cancel and tap the product card to adjust the price, or add it anyway.`}
              confirmLabel="Add at a loss"
              onConfirm={() => {
                pushQuickLine(s, belowCostAdd.uom, belowCostAdd.price);
                setBelowCostAdd(null);
              }}
              onClose={() => setBelowCostAdd(null)}
            />
          );
        })(),
        document.body,
      )}

      {editorBelowCostConfirm && selectedSku && portalReady && createPortal(
        (() => {
          const s = selectedSku;
          const mult = lineUom === "carton" ? s.pcs_per_pack * s.packs_per_carton
                     : lineUom === "pack" ? s.pcs_per_pack : 1;
          const cost = (s.landed_per_piece_mvr ?? 0) * mult;
          const price = parseFloat(linePrice) || 0;
          const qty = parseFloat(lineQty) || 0;
          const lossEach = cost - price;
          const lossTotal = lossEach * qty;
          const u = sellUnitLabel(lineUom, tradeCfg(s));
          return (
            <ConfirmSheet
              open
              title="This sells below cost"
              message={`${s.brand_name} ${s.variant_display} costs you MVR ${cost.toFixed(0)}/${u} right now — at MVR ${price.toFixed(0)} you lose about MVR ${lossEach.toFixed(lossEach >= 10 ? 0 : 2)} per ${u}${qty > 1 ? ` (MVR ${lossTotal.toFixed(0)} on this line)` : ""}. Go back to adjust the price, or add it anyway.`}
              confirmLabel="Add at a loss"
              onConfirm={() => { setEditorBelowCostConfirm(false); doAddLine(); }}
              onClose={() => setEditorBelowCostConfirm(false)}
            />
          );
        })(),
        document.body,
      )}

      {mixedCartonBrandId && portalReady && createPortal(
        // Portalled to document.body for the same reason as the price-explain
        // sheet above — this is a `position: fixed` layer that must never be a
        // descendant of NewSaleSheet's own `fixed inset-x-0 top-0` container.
        <MixedCartonSheet
          skus={mixedCartonGroups.get(mixedCartonBrandId) ?? []}
          godownId={godownId}
          godowns={godowns}
          stockLevels={stockLevels}
          tierPrices={tierPrices}
          draftLines={draftLines}
          onClose={() => setMixedCartonBrandId(null)}
          onAdd={(adds) => {
            // ADD to whatever the colour already has — never replace it.
            // Replacing is what silently deleted bottles and left the cart
            // holding 1.67 cartons: build 2 Purple + 4 Red, then 6 Purple, and
            // Purple's 2 was overwritten by 6 instead of becoming 8.
            //
            // One line per product per order is a database rule
            // (sales_order_lines_order_sku_uniq), so the merge is mandatory,
            // not a convenience.
            setDraftLines((prev) => {
              const next = [...prev];
              for (const a of adds) {
                // Carton size for a LINE is the SKU's own pack config, because
                // that is what Postgres uses to derive qty_pieces from a
                // carton qty. mixed_carton_pieces is the brand-level "a carton
                // is this many individually-chosen bottles" figure and drives
                // the mix target and the per-bottle rate.
                const perLine = a.sku.pcs_per_pack * a.sku.packs_per_carton || 1;
                const perMix = a.sku.mixed_carton_pieces || perLine;
                const tp = tierPrices.get(a.sku.id);
                const cartonPrice = (tp ? tp.price_per_carton_mvr : a.sku.selling_price_per_carton_mvr) ?? 0;

                // A full carton of one colour and bottles inside a mixed
                // carton are DIFFERENT purchases and stay apart in the cart.
                // Ali, 2026-08-09: "You cannot say for example 7 bottles blue
                // because I chose a mix carton with 1 bottle blue and the
                // other 6 bottles merged with this."
                //
                // They are merged only at SAVE, because sales_order_lines
                // allows one row per product per order. The money and the
                // stored order are identical either way — both sides are
                // priced off the same carton rate — so this is presentation,
                // not a change to anything that counts.
                const kind = a.mixed ? "mix" : "ctn";
                const key = `${a.sku.id}-${kind}`;
                const i = next.findIndex((l) => l.key === key);
                const pieces = (i === -1 ? 0 : next[i].qty_pieces) + a.pieces;
                const mixed = a.mixed || pieces % perLine !== 0;

                // Keep whichever godown is already on the line; a merge never
                // silently moves stock to a different warehouse.
                const gId = (i === -1 ? undefined : next[i].source_godown_id) ?? a.godownId;
                const gName = (i === -1 ? undefined : next[i].source_godown_name) ?? a.godownName;
                const line: DraftLine = mixed
                  ? {
                      key, sku: a.sku, uom: "piece", qty: pieces, qty_pieces: pieces,
                      unit_price_mvr: cartonPrice / perMix,
                      line_total_mvr: (cartonPrice / perMix) * pieces,
                      is_mixed_carton_fill: true,
                      source_godown_id: gId, source_godown_name: gName,
                    }
                  : {
                      key, sku: a.sku, uom: "carton", qty: pieces / perLine, qty_pieces: pieces,
                      unit_price_mvr: cartonPrice,
                      line_total_mvr: cartonPrice * (pieces / perLine),
                      is_mixed_carton_fill: false,
                      source_godown_id: gId, source_godown_name: gName,
                    };
                if (i === -1) next.push(line); else next[i] = line;
              }
              return next;
            });
            // Ali, 2026-08-09: "It's not showing me whether adding or not.
            // There is no way for me to know." The sheet closes on add, so
            // without this nothing at all confirms it landed.
            const per = adds[0].sku.mixed_carton_pieces || 1;
            const pieces = adds.reduce((a, x) => a + x.pieces, 0);
            const ctns = Math.round(pieces / per);
            toast.success(
              `Added ${ctns} ${adds[0].mixed ? "mixed " : ""}carton${ctns === 1 ? "" : "s"} of ${adds[0].sku.brand_name}`,
            );
            setMixedCartonBrandId(null);
          }}
        />,
        document.body,
      )}
      </div>
    </div>,
    document.body,
  );
}

// ── Sosoft carton picker (single colour or mixed) ────────────────────────────
// Ali, 2026-08-07: "Sosoft I sell in cartons. Not bottles. But customer can
// make mixed carton of six bottles not less. Customer can also purchase single
// color carton." And 2026-08-09: "must be able to sell mixed color cartons and
// single color cartons too if the customer choice. And customer must be able to
// purchase any quantity of cartons as long as it's in stock."
//
// So there are two first-class ways to buy, and any number of cartons of each:
//
//   SINGLE COLOUR  n whole cartons of one colour -> an ordinary CARTON line
//                  (uom 'carton'), because that is exactly what it is. FIFO,
//                  costing, the money-in-the-unit-sold rule and the whole-unit
//                  edit guard (0156) then all apply unchanged.
//   MIXED          n cartons' worth of bottles picked across colours ->
//                  is_mixed_carton_fill piece lines at carton-rate ÷ 6. This is
//                  the sanctioned piece carve-out in CLAUDE.md: a mixed carton
//                  is the one place a bottle is a real ledger unit.
//
// WHAT WAS WRONG BEFORE
//
//  * The sheet could only ever build ONE carton. Every colour was capped at 6
//    bottles and the Add button required the total to equal exactly 6. There
//    was no quantity control at all.
//  * Single colour had no door. Every Sosoft SKU is pulled out of the product
//    grid into one card, so the mixer was the only way in. Six of one colour
//    did work, but nothing said so and it was still capped at one carton.
//  * Adding REPLACED any existing line for the same colour instead of adding to
//    it. Building 2 Purple + 4 Red, then 6 Purple, left 6 Purple + 4 Red = 10
//    bottles: four bottles the salesperson had entered vanished from the order,
//    and the cart held one and two-thirds of a carton. That is the
//    "1.6666666666666667 cartons in cart" Ali screenshotted.
//
// One line per product per order is a database rule
// (sales_order_lines_order_sku_uniq), so a colour bought BOTH as a whole carton
// and inside a mix merges into one line, expressed in bottles — the only unit
// that can describe a non-carton multiple. The money is identical either way,
// because both sides are priced off the same carton rate.
//
// Stock is counted net of what the cart already holds, so opening the sheet a
// second time cannot oversell what the first visit reserved.
type MixedCartonAdd = {
  sku: SkuFullRow; pieces: number; mixed: boolean;
  /** Set only when the chosen warehouse has none and this comes from another. */
  godownId?: string; godownName?: string;
};

function MixedCartonSheet({
  skus, godownId, godowns, stockLevels, tierPrices, draftLines, onClose, onAdd,
}: {
  skus: SkuFullRow[];
  godownId: string;
  godowns: GodownRow[];
  stockLevels: StockLevel[];
  tierPrices: Map<string, TierPrice>;
  draftLines: DraftLine[];
  onClose: () => void;
  onAdd: (adds: MixedCartonAdd[]) => void;
}) {
  const piecesPerCarton = skus[0]?.mixed_carton_pieces ?? 0;
  const unitUom = (skus[0]?.unit_uom ?? null) as UnitUom | null;
  const noun = containerLabel(unitUom);

  // Ali, 2026-08-09: "Create mix carton is default." It is the common sale —
  // a customer picking six bottles across colours — so it should not cost a
  // tap to reach.
  const [mode, setMode] = useState<"single" | "mixed">("mixed");
  const [cartons, setCartons] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [targetCartons, setTargetCartons] = useState(1);

  /** Bottles still on the shelf AFTER what this order already holds. */
  const availablePieces = (s: SkuFullRow) => {
    const onShelf = godownId
      ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0
      : stockLevels.filter((l) => l.sku_id === s.id).reduce((a, l) => a + l.qty_pieces, 0);
    // Sum every cart entry for this product — since the cart splits a full
    // carton from a mixed fill, find() would see only the first and the sheet
    // would offer stock the cart has already claimed.
    const inCart = draftLines
      .filter((l) => l.sku.id === s.id)
      .reduce((a, l) => a + l.qty_pieces, 0);
    return Math.max(0, onShelf - inCart);
  };
  /** Where this line would actually be picked from. NULL = the order's own
   *  godown. Ali, 2026-08-09: "I must be able to choose the godown where the
   *  sku is available and fulfill the order without going back." So when the
   *  chosen warehouse has none and another has stock, the sale is sourced from
   *  there instead of being refused -- no restart, no second order. */
  const sourceFor = (s: SkuFullRow) =>
    availablePieces(s) > 0 ? null : (elsewhereList(s)[0] ?? null);

  /** What can actually be sold: here if here has it, otherwise the other
   *  godown's stock, because that is where it will come from. */
  const usablePieces = (s: SkuFullRow) => {
    const here = availablePieces(s);
    return here > 0 ? here : (elsewhereList(s)[0]?.pieces ?? 0);
  };
  const availableCartons = (s: SkuFullRow) =>
    piecesPerCarton > 0 ? Math.floor(usablePieces(s) / piecesPerCarton) : 0;

  /** Where this colour IS, when the chosen warehouse has none. Ali,
   *  2026-08-09, on a Purple row reading "None left": "It could be available
   *  at another godown. In which case app must be intelligent enough to
   *  suggest availability at the other godown."
   *
   *  The product GRID already refuses to hide a product owned elsewhere and
   *  says "None here · N in <other>". This sheet did not, so inside it a
   *  colony of stock in Funvilu looked like nothing at all. Same answer, same
   *  words, both doors. */
  const elsewhereList = (s: SkuFullRow) => stockLevels
    .filter((l) => l.sku_id === s.id && l.godown_id !== godownId && l.qty_pieces > 0)
    .map((l) => ({ id: l.godown_id,
                   name: godowns.find((g) => g.id === l.godown_id)?.name ?? "another godown",
                   pieces: l.qty_pieces }))
    .sort((a, b) => b.pieces - a.pieces);

  /** Money is quoted per CARTON — that is the unit Sosoft is sold in. */
  const cartonPriceOf = (s: SkuFullRow) => {
    const tp = tierPrices.get(s.id);
    return tp ? tp.price_per_carton_mvr : s.selling_price_per_carton_mvr;
  };

  // ── Single colour ──
  const singleCartons = skus.reduce((a, s) => a + (cartons[s.id] ?? 0), 0);
  const singleTotalMvr = skus.reduce(
    (a, s) => a + (cartons[s.id] ?? 0) * (cartonPriceOf(s) ?? 0), 0);
  const singlePriced = skus.every((s) => (cartons[s.id] ?? 0) === 0 || cartonPriceOf(s) != null);
  const canAddSingle = singleCartons > 0 && singlePriced;

  // ── Mixed ──
  const mixedBottles = skus.reduce((a, s) => a + (counts[s.id] ?? 0), 0);
  const mixedTarget = targetCartons * piecesPerCarton;
  const mixedRemaining = mixedTarget - mixedBottles;
  const totalAvailableBottles = skus.reduce((a, s) => a + availablePieces(s), 0);
  const maxMixedCartons = piecesPerCarton > 0
    ? Math.max(1, Math.floor(totalAvailableBottles / piecesPerCarton)) : 1;
  const mixedPriced = skus.every((s) => (counts[s.id] ?? 0) === 0 || cartonPriceOf(s) != null);
  const mixedTotalMvr = skus.reduce(
    (a, s) => a + (counts[s.id] ?? 0) * ((cartonPriceOf(s) ?? 0) / Math.max(1, piecesPerCarton)), 0);
  const canAddMixed = piecesPerCarton > 0 && mixedBottles === mixedTarget && mixedPriced;

  function setCartonCount(s: SkuFullRow, next: number) {
    setCartons((prev) => ({ ...prev, [s.id]: Math.max(0, Math.min(next, availableCartons(s))) }));
  }
  function setBottleCount(s: SkuFullRow, next: number) {
    setCounts((prev) => ({ ...prev, [s.id]: Math.max(0, Math.min(next, usablePieces(s))) }));
  }

  function handleAdd() {
    const adds: MixedCartonAdd[] = [];
    for (const s of skus) {
      const src = sourceFor(s);
      if (mode === "single") {
        const n = cartons[s.id] ?? 0;
        if (n > 0) adds.push({ sku: s, pieces: n * piecesPerCarton, mixed: false,
                              godownId: src?.id, godownName: src?.name });
      } else {
        const n = counts[s.id] ?? 0;
        if (n > 0) adds.push({ sku: s, pieces: n, mixed: true,
                              godownId: src?.id, godownName: src?.name });
      }
    }
    if (adds.length > 0) onAdd(adds);
  }

  const canAdd = mode === "single" ? canAddSingle : canAddMixed;

  return (
    // role="dialog" + aria-modal: a bottom sheet IS a modal dialog, and until
    // now it was an anonymous div — a screen reader announced nothing, and
    // nothing could tell "a sheet is open" from "a sheet is closed" without
    // guessing at class names. The journey audit waits on this.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${skus[0]?.brand_name ?? "Product"} — add cartons`}
      className="fixed inset-0 z-[80] flex items-end snm-scrim-in"
      style={{ background: "var(--scrim-bg)", touchAction: "none" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
        style={{
          background: "var(--background)",
          borderTop: "0.5px solid var(--glass-border-lo)",
          boxShadow: "var(--glass-shadow-lg)",
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
        }}
      >
        {/* Fixed header — grabber, title, mode choice, and (for a mix) the
            carton target with its progress. Always visible. */}
        <div className="shrink-0 px-5 pt-3 pb-3" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
          <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground truncate">
                {skus[0]?.brand_name} · Add cartons
              </h2>
              <p className="ios-subhead" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                Sold by the carton · {piecesPerCarton} {noun}s in a carton
              </p>
            </div>
            <button onClick={onClose} className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }} aria-label="Close">
              <X className="h-4 w-4 text-foreground" />
            </button>
          </div>

          {/* A choice, so it is content: real foreground text on a filled
              surface, never muted-on-transparent. */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {([
              { key: "single" as const, label: "One colour" },
              { key: "mixed" as const,  label: "Mixed carton" },
            ]).map((m) => {
              const on = mode === m.key;
              return (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  className="h-11 rounded-xl ios-subhead font-semibold flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
                  style={{
                    background: on ? "var(--glass-accent)" : "var(--glass-bg-1)",
                    color: on ? "var(--snm-brand-on)" : "var(--foreground)",
                    border: "0.5px solid var(--glass-border-lo)",
                  }}
                >
                  {on && <Check className="h-4 w-4" />}
                  {m.label}
                </button>
              );
            })}
          </div>

          {mode === "mixed" && (
            <>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="ios-subhead font-semibold text-foreground">How many cartons</p>
                  <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                    = {mixedTarget} {noun}s to pick
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setTargetCartons((n) => Math.max(1, n - 1))}
                    disabled={targetCartons <= 1}
                    aria-label="One carton fewer"
                    className="w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
                    style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--foreground)" }}>
                    −
                  </button>
                  <span className="w-6 text-center ios-subhead font-bold tabular-nums text-foreground">{targetCartons}</span>
                  <button
                    onClick={() => setTargetCartons((n) => Math.min(maxMixedCartons, n + 1))}
                    disabled={targetCartons >= maxMixedCartons}
                    aria-label="One carton more"
                    className="w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
                    style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
                    +
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${Math.min(100, (mixedBottles / Math.max(1, mixedTarget)) * 100)}%`,
                    background: mixedBottles === mixedTarget ? "var(--snm-success)" : mixedBottles > mixedTarget ? "var(--snm-error)" : "var(--snm-brand)",
                  }} />
                </div>
                <p className="ios-subhead font-bold shrink-0 tabular-nums" style={{ color: mixedBottles === mixedTarget ? "var(--snm-success)" : "var(--foreground)" }}>
                  {mixedBottles} / {mixedTarget}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Scrollable body — one row per colour, the ONLY scroll region */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4 space-y-2" style={{ touchAction: "pan-y" }}>
          {skus.map((s) => {
            const price = cartonPriceOf(s);
            const singleMode = mode === "single";
            const cap = singleMode ? availableCartons(s) : usablePieces(s);
            const count = singleMode ? (cartons[s.id] ?? 0) : (counts[s.id] ?? 0);
            const soldOut = availablePieces(s) <= 0;
            return (
              <div key={s.id} className="rounded-2xl p-4 flex items-center justify-between gap-3"
                style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", opacity: cap > 0 ? 1 : 0.5 }}>
                <div className="min-w-0 flex-1">
                  {/* Colour first — the team picks Sosoft by colour, not scent.
                      model_name is the colour, variant_display is the scent. */}
                  <p className="ios-subhead font-semibold text-foreground truncate">{s.model_name}</p>
                  <p className="ios-footnote truncate" style={{ color: "var(--muted-foreground)" }}>{s.variant_display}</p>
                  <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                    {soldOut
                      ? (singleMode ? "No full carton in this warehouse" : "None in this warehouse")
                      : singleMode
                        ? `${cap} carton${cap === 1 ? "" : "s"} available${price != null ? ` · MVR ${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}/carton` : ""}`
                        : `${cap} ${noun}${cap === 1 ? "" : "s"} available`}
                  </p>
                  {/* Owned, just not here. Says which godown and how much, in
                      the unit he trades in — a warehouse he cannot sell from
                      today is still the difference between "we have none" and
                      "we have plenty, in the other place". */}
                  {soldOut && elsewhereList(s).length > 0 && (
                    <p className="ios-footnote font-semibold" style={{ color: "var(--snm-warning)" }}>
                      {(() => {
                        const e = elsewhereList(s)[0];
                        const n = singleMode && piecesPerCarton > 0
                          ? `${Math.floor(e.pieces / piecesPerCarton)} carton${Math.floor(e.pieces / piecesPerCarton) === 1 ? "" : "s"}`
                          : `${e.pieces} ${noun}${e.pieces === 1 ? "" : "s"}`;
                        return `Will be picked from ${e.name} · ${n} there`;
                      })()}
                    </p>
                  )}
                  {price == null && (
                    <p className="ios-footnote font-semibold" style={{ color: "var(--snm-error)" }}>No carton price set</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => singleMode ? setCartonCount(s, count - 1) : setBottleCount(s, count - 1)}
                    disabled={count <= 0}
                    aria-label={`One fewer ${s.model_name}`}
                    className="w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
                    style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--foreground)" }}>
                    −
                  </button>
                  <span className="w-6 text-center ios-subhead font-bold tabular-nums text-foreground">{count}</span>
                  <button
                    onClick={() => singleMode ? setCartonCount(s, count + 1) : setBottleCount(s, count + 1)}
                    disabled={count >= cap || price == null}
                    aria-label={`One more ${s.model_name}`}
                    className="w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-lg transition active:scale-90 disabled:opacity-30"
                    style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed footer — money first, then one primary action */}
        <div className="shrink-0 px-5 py-4 flex flex-col gap-2" style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          {mode === "mixed" && !canAddMixed && (
            <p className="ios-footnote text-center" style={{ color: mixedRemaining < 0 ? "var(--snm-error)" : "var(--foreground)", opacity: mixedRemaining < 0 ? 1 : 0.7 }}>
              {mixedRemaining > 0
                ? `Pick ${mixedRemaining} more ${noun}${mixedRemaining === 1 ? "" : "s"} to fill ${targetCartons === 1 ? "the carton" : `${targetCartons} cartons`}`
                : mixedRemaining < 0
                  ? `${Math.abs(mixedRemaining)} too many — remove some`
                  : "Set a carton price on these products first"}
            </p>
          )}
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="h-14 w-full rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
            <Plus className="h-4 w-4" />
            {mode === "single"
              ? (singleCartons === 0
                  ? "Add cartons"
                  : `Add ${singleCartons} carton${singleCartons === 1 ? "" : "s"} · MVR ${singleTotalMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
              : `Add ${targetCartons} mixed carton${targetCartons === 1 ? "" : "s"}${canAddMixed ? ` · MVR ${mixedTotalMvr.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

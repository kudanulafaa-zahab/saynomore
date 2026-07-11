"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "sonner";
import {
  Plus, Trash2, Loader2, Search, X, ChevronRight, ChevronDown,
  Package, Check, SlidersHorizontal, Pencil, ScanLine,
} from "lucide-react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import {
  listCategories, listBrands, listModels, listVariants, listSkusFlat,
  createBrand, createModel, createVariant, createSku, createCategory, deleteCategory, deleteModel,
  toggleSkuActive, getCurrentUserRole, updateSku,
  type CategoryRow, type BrandRow, type ModelRow, type VariantRow,
  type SkuFullRow, type AttrKey, type UnitUom, type CostBasis, type SellUnit,
} from "@/lib/queries/products";
import {
  EditSkuDialog, CascadeDeleteDialog, type CascadeTarget,
} from "./edit-dialogs";
import { haptic } from "@/lib/haptics";
import { SkeletonRows } from "@/components/layout/page-skeleton";

// Camera barcode scanner — same component used in Sales & Shipments. Lazy-loaded
// because it pulls in the heavy @zxing decoding library only when opened.
const BarcodeScanner = dynamic(
  () => import("@/components/ui/barcode-scanner").then((m) => m.BarcodeScanner),
  { ssr: false }
);

/* ── Attr metadata ── */

interface AttrSpec {
  key: AttrKey; label: string; placeholder?: string;
  type: "text" | "number"; options?: string[]; suffix?: string;
}

const ATTR_SPECS: Record<AttrKey, AttrSpec> = {
  size:      { key: "size",      label: "Size",    placeholder: "NB, S, M…",   type: "text" },
  scent:     { key: "scent",     label: "Scent",   placeholder: "Mint…",       type: "text" },
  format:    { key: "format",    label: "Format",  type: "text",
               options: ["Bottle","Pouch","Pack","Box"] },
  volume_ml: { key: "volume_ml", label: "Volume",  placeholder: "1500",        type: "number", suffix: "ml" },
  weight_g:  { key: "weight_g",  label: "Weight",  placeholder: "250",         type: "number", suffix: "g"  },
  colour:    { key: "colour",    label: "Colour",  placeholder: "Pink…",       type: "text" },
  other:     { key: "other",     label: "Other",   placeholder: "Optional",    type: "text" },
};

function attrsToDisplay(attrs: Record<string, string | number>, schema: AttrKey[]): string {
  return schema.map((k) => {
    const v = attrs[k];
    if (v === undefined || v === "") return "";
    const spec = ATTR_SPECS[k];
    return spec?.suffix ? `${v}${spec.suffix}` : String(v);
  }).filter(Boolean).join(" ");
}

/* ── Helpers ── */

function fmtPrice(n: number | null | undefined) {
  if (n == null) return null;
  return Number(n).toFixed(0);
}


/** Returns the trade unit label for a SKU — what the seller actually trades in. */
function packLabel(sku: SkuFullRow): string {
  const fmt = (sku.attributes as Record<string, string> | undefined)?.format;
  if (fmt) return fmt; // "Bottle", "Pouch", "Sachet", etc.
  const uom = sku.unit_uom;
  if (uom === "ml") return "Bottle";
  if (uom === "g")  return "Pouch";
  return "Pack";
}

/* ── Mobile bottom sheet wrapper ──────────────────────────────────────────────
   Native-iOS sheet behaviour: locks the page behind it (no scroll-through),
   shows a grabber, and supports drag-down-to-dismiss + tap-backdrop-to-close. */

function MobileSkuSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  // Lock the background page while the sheet is open (iOS-correct).
  useBodyScrollLock(true);

  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0].clientY;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setDragY(dy); // only allow downward drag
  }
  function onTouchEnd() {
    if (dragY > 110) onClose();   // dragged far enough → dismiss
    else setDragY(0);             // snap back
    startY.current = null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: "var(--scrim-bg)", backdropFilter: "var(--scrim-blur)", WebkitBackdropFilter: "var(--scrim-blur)" }}
        onClick={onClose}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl overflow-hidden flex flex-col"
        style={{
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          border: "0.5px solid var(--glass-border-lo)",
          transform: `translateY(${dragY}px)`,
          transition: startY.current == null ? "transform 0.25s cubic-bezier(0.32,0.72,0,1)" : "none",
        }}
      >
        {/* Grabber — drag-to-dismiss handle */}
        <div
          className="flex justify-center pt-3 pb-1 shrink-0 cursor-grab active:cursor-grabbing"
          style={{ touchAction: "none" }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="w-9 h-[5px] rounded-full" style={{ background: "var(--glass-border)" }} />
        </div>
        {children}
      </div>
    </>
  );
}

/* ── SKU detail panel ── */

function SkuPanel({
  sku, isAdmin, canWrite, onEdit, onDelete, onToggle, onClose, onPricingUpdated,
}: {
  sku: SkuFullRow;
  isAdmin: boolean;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onClose: () => void;
  onPricingUpdated: () => void;
}) {
  const pcsPerCtn = sku.pcs_per_pack * sku.packs_per_carton;

  // Inline pricing state (only shown when no pricing is configured yet)
  const [inlineMargin, setInlineMargin] = useState("");
  const [inlineFixed,  setInlineFixed]  = useState("");
  const [savingPrice,  setSavingPrice]  = useState(false);

  // Reset inline fields when a different SKU is shown
  useEffect(() => { setInlineMargin(""); setInlineFixed(""); }, [sku.id]);

  // Live profit preview — computed as the user types, zero DB calls
  const tradeLabel = packLabel(sku).toLowerCase(); // "bottle", "pack", etc.
  const landedPerPiece = sku.landed_per_piece_mvr != null ? Number(sku.landed_per_piece_mvr) : null;
  const landedPerPack  = landedPerPiece != null ? landedPerPiece * sku.pcs_per_pack : null;
  const landedPerCtn   = landedPerPack  != null ? landedPerPack * sku.packs_per_carton : null;

  const livePreview = useMemo(() => {
    if (!landedPerPiece) return null;

    // Fixed price path: user enters per-pack price
    const fp = inlineFixed ? parseFloat(inlineFixed) : NaN;
    if (!isNaN(fp) && fp > 0) {
      const sellingPerPiece = fp / sku.pcs_per_pack;
      const margin = ((sellingPerPiece - landedPerPiece) / sellingPerPiece) * 100;
      const profitPerPack = fp - landedPerPack!;
      const profitPerCtn  = profitPerPack * sku.packs_per_carton;
      return { margin, profitPerPack, profitPerCtn, sellingPerPack: fp, mode: "fixed" as const };
    }

    // Margin path
    const m = inlineMargin ? parseFloat(inlineMargin) : NaN;
    if (!isNaN(m) && m > 0 && m < 100) {
      const sellingPerPiece = landedPerPiece / (1 - m / 100);
      const sellingPerPack  = sellingPerPiece * sku.pcs_per_pack;
      const profitPerPack   = sellingPerPack - landedPerPack!;
      const profitPerCtn    = profitPerPack * sku.packs_per_carton;
      return { margin: m, profitPerPack, profitPerCtn, sellingPerPack, mode: "margin" as const };
    }

    return null;
  }, [inlineFixed, inlineMargin, landedPerPiece, landedPerPack, sku.pcs_per_pack, sku.packs_per_carton]);

  // Colour signal: green ≥20%, amber 10–19%, red <10% (or negative)
  const marginColor = livePreview == null ? "var(--muted-foreground)"
    : livePreview.margin >= 20 ? "var(--snm-success)"
    : livePreview.margin >= 10 ? "var(--snm-warning)"
    : "var(--snm-error)";

  async function saveInlinePrice() {
    const margin = inlineMargin ? parseFloat(inlineMargin) : null;
    // Fixed price entered per-pack → convert to per-piece for storage
    const fixedPackVal = inlineFixed ? parseFloat(inlineFixed) : null;
    const fixed = fixedPackVal != null && sku.pcs_per_pack > 0
      ? fixedPackVal / sku.pcs_per_pack
      : null;
    if (margin == null && fixed == null) return;
    setSavingPrice(true);
    try {
      await updateSku(sku.id, {
        target_margin_pct:       fixed != null ? null : margin,
        fixed_selling_price_mvr: fixed,
      });
      haptic("success");
      toast.success("Pricing saved");
      onPricingUpdated();
    } catch (e) { haptic("error"); toast.error((e as Error).message); }
    finally { setSavingPrice(false); }
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 flex-1"
      style={{ background: "var(--glass-2)", backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)" }}
    >
      {/* Header */}
      <div
        className="flex items-start justify-between px-5 py-4 shrink-0"
        style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}
      >
        <div className="min-w-0 flex-1 pr-3">
          <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>
            {sku.brand_name} · {sku.category_name}
          </p>
          <p className="text-[17px] font-semibold text-foreground leading-snug">
            {sku.model_name}
            {sku.variant_display
              ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {sku.variant_display}</span>
              : null}
          </p>
          <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>{sku.internal_code}</p>
        </div>
        <button
          onClick={onClose}
          className="h-11 w-11 rounded-full flex items-center justify-center shrink-0 transition"
          style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Pack config */}
        <div>
          <p className="label-caps text-[12px] mb-2.5" style={{ color: "var(--muted-foreground)" }}>Pack Configuration</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Pcs / Pack",   value: String(sku.pcs_per_pack) },
              { label: "Packs / Ctn",  value: String(sku.packs_per_carton) },
              { label: "Pcs / Carton", value: String(pcsPerCtn) },
            ].map((c) => (
              <div key={c.label} className="rounded-xl p-3 text-center"
                style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)" }}>
                <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
                <p className="text-[15px] font-bold text-foreground snm-num">{c.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Landed cost + selling prices */}
        <div>
          <p className="label-caps text-[12px] mb-2.5" style={{ color: "var(--muted-foreground)" }}>Pricing</p>

          {/* Landed cost row */}
          {sku.landed_per_piece_mvr != null && (
            <div className="rounded-xl px-4 py-3 mb-2 flex items-center justify-between"
              style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
              <div>
                <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>Landed cost · from last shipment</p>
                {/* Primary: per trade unit (Pack/Bottle) */}
                <p className="text-[17px] font-bold text-foreground snm-num">
                  MVR {(Number(sku.landed_per_piece_mvr) * (sku.pcs_per_pack ?? 1)).toFixed(2)}
                </p>
                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                  per {packLabel(sku).toLowerCase()}
                </p>
                {/* Secondary: per piece for competitor comparison */}
                <p className="ios-subhead mt-0.5 snm-num" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>
                  MVR {Number(sku.landed_per_piece_mvr).toFixed(4)} /pc
                </p>
              </div>
              {sku.fixed_selling_price_mvr != null && sku.actual_margin_pct != null ? (
                <div className="text-right">
                  <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>Actual margin</p>
                  <p className="text-[17px] font-bold snm-num" style={{ color: sku.actual_margin_pct >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                    {sku.actual_margin_pct}%
                  </p>
                </div>
              ) : sku.target_margin_pct != null ? (
                <div className="text-right">
                  <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>Target margin</p>
                  <p className="text-[17px] font-bold snm-num" style={{ color: "var(--snm-success)" }}>{sku.target_margin_pct}%</p>
                </div>
              ) : null}
            </div>
          )}

          {/* Selling prices grid */}
          {sku.selling_price_per_piece_mvr != null ? (
            <>
              <div className="flex items-center gap-1.5 mb-2">
                <p className="text-[12px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Selling price</p>
                {sku.fixed_selling_price_mvr != null
                  ? <span className="ios-subhead font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>FIXED</span>
                  : <span className="ios-subhead font-bold px-1.5 py-0.5 rounded" style={{ background: "color-mix(in srgb, var(--snm-success) 15%, transparent)", color: "var(--snm-success)" }}>AUTO</span>
                }
              </div>
              <div className="space-y-2">
                {/* Primary: per pack/bottle (trade unit) — large */}
                <div className="rounded-xl px-4 py-3 flex items-center justify-between"
                  style={{
                    background: sku.fixed_price_per_pack_mvr != null
                      ? "color-mix(in srgb, var(--snm-brand) 8%, transparent)"
                      : "color-mix(in srgb, var(--snm-success) 8%, transparent)",
                    border: `1px solid ${sku.fixed_price_per_pack_mvr != null
                      ? "color-mix(in srgb, var(--snm-brand) 20%, transparent)"
                      : "color-mix(in srgb, var(--snm-success) 20%, transparent)"}`,
                  }}>
                  <div>
                    <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>
                      Per {packLabel(sku).toLowerCase()} · selling price
                    </p>
                    <p className="text-[20px] font-bold snm-num" style={{ color: sku.fixed_price_per_pack_mvr != null ? "var(--snm-brand)" : "var(--snm-success)" }}>
                      MVR {fmtPrice(sku.selling_price_per_pack_mvr)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>/pc · comparison</p>
                    <p className="ios-subhead font-semibold text-foreground snm-num">
                      MVR {fmtPrice(sku.selling_price_per_piece_mvr)}
                    </p>
                  </div>
                </div>
                {/* Secondary: per carton (bulk) */}
                <div className="rounded-xl px-4 py-2 flex items-center justify-between"
                  style={{
                    background: sku.fixed_price_per_carton_mvr != null
                      ? "color-mix(in srgb, var(--snm-brand) 6%, transparent)"
                      : "color-mix(in srgb, var(--foreground) 4%, transparent)",
                    border: `1px solid ${sku.fixed_price_per_carton_mvr != null
                      ? "color-mix(in srgb, var(--snm-brand) 15%, transparent)"
                      : "var(--glass-border-lo)"}`,
                  }}>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Per carton</p>
                  <p className="ios-subhead font-semibold text-foreground snm-num">
                    MVR {fmtPrice(sku.selling_price_per_carton_mvr)}
                    {sku.fixed_price_per_carton_mvr != null && (
                      <span className="ml-1.5 ios-subhead font-bold px-1 py-0.5 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>VOL.</span>
                    )}
                  </p>
                </div>
              </div>
            </>
          ) : (sku.target_margin_pct != null || sku.fixed_selling_price_mvr != null) ? (
            <div className="rounded-xl px-4 py-3"
              style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)",
                       border: "1px solid color-mix(in srgb, var(--snm-warning) 20%, transparent)" }}>
              <p className="ios-subhead" style={{ color: "var(--snm-warning)" }}>
                Pricing configured — price available after first GRN
              </p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden"
              style={{ border: "1px solid color-mix(in srgb, var(--snm-brand) 25%, transparent)" }}>

              {/* Header */}
              <div className="px-4 py-2.5" style={{ background: "var(--muted)" }}>
                <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
                  Set pricing — see your profit before saving
                </p>
              </div>

              <div className="px-4 py-3 space-y-3" style={{ background: "color-mix(in srgb, var(--foreground) 3%, transparent)" }}>
                {/* Two inputs side by side */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="ios-subhead mb-1.5" style={{ color: "var(--muted-foreground)" }}>
                      Price per {tradeLabel} (MVR)
                    </p>
                    <input
                      type="number" inputMode="decimal" step="0.01" min="0.01"
                      value={inlineFixed}
                      onChange={(e) => { setInlineFixed(e.target.value); if (e.target.value) setInlineMargin(""); }}
                      disabled={savingPrice || !canWrite}
                      placeholder={landedPerPack ? `cost: ${landedPerPack.toFixed(2)}` : "e.g. 12.00"}
                      style={{
                        width: "100%", height: 40, padding: "0 10px", borderRadius: 8,
                        background: "color-mix(in srgb, var(--foreground) 6%, transparent)",
                        border: `1px solid ${inlineFixed ? "color-mix(in srgb, var(--snm-brand) 40%, transparent)" : "var(--glass-border-lo)"}`,
                        color: "var(--foreground)", fontSize: 14, fontWeight: 600, outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <p className="ios-subhead mb-1.5" style={{ color: "var(--muted-foreground)" }}>
                      Or target margin %
                    </p>
                    <input
                      type="number" inputMode="decimal" step="0.5" min="1" max="99"
                      value={inlineMargin}
                      onChange={(e) => { setInlineMargin(e.target.value); if (e.target.value) setInlineFixed(""); }}
                      disabled={!!inlineFixed || savingPrice || !canWrite}
                      placeholder="e.g. 30"
                      style={{
                        width: "100%", height: 40, padding: "0 10px", borderRadius: 8,
                        background: "color-mix(in srgb, var(--foreground) 6%, transparent)",
                        border: `1px solid ${inlineMargin ? "color-mix(in srgb, var(--snm-success) 40%, transparent)" : "var(--glass-border-lo)"}`,
                        color: "var(--foreground)", fontSize: 14, fontWeight: 600, outline: "none",
                        boxSizing: "border-box", opacity: inlineFixed ? 0.35 : 1,
                      }}
                    />
                  </div>
                </div>

                {/* ── Live profit meter — appears as you type ── */}
                {livePreview && landedPerPack != null && landedPerCtn != null && (
                  <div className="rounded-xl overflow-hidden"
                    style={{ border: `1px solid color-mix(in srgb, ${marginColor} 25%, transparent)` }}>

                    {/* Margin headline */}
                    <div className="px-4 py-3 flex items-center justify-between"
                      style={{ background: `color-mix(in srgb, ${marginColor} 10%, transparent)` }}>
                      <div>
                        <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: marginColor, opacity: 0.8 }}>Gross margin</p>
                        <p className="text-[28px] font-black leading-none" style={{ color: marginColor }}>
                          {livePreview.margin.toFixed(1)}%
                        </p>
                        {livePreview.margin < 0 && (
                          <p className="ios-subhead font-semibold mt-0.5" style={{ color: "var(--snm-error)" }}>⚠ Selling below cost</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>
                          Selling / {tradeLabel}
                        </p>
                        <p className="text-[17px] font-bold text-foreground">
                          MVR {livePreview.sellingPerPack.toFixed(0)}
                        </p>
                      </div>
                    </div>

                    {/* Cost vs profit bar */}
                    {livePreview.margin > 0 && livePreview.margin < 100 && (
                      <div className="px-4 pt-2 pb-1">
                        <div className="flex rounded-full overflow-hidden h-2" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
                          <div style={{ width: `${100 - livePreview.margin}%`, background: "color-mix(in srgb, var(--muted-foreground) 50%, transparent)", transition: "width 0.2s" }} />
                          <div style={{ flex: 1, background: marginColor, transition: "width 0.2s" }} />
                        </div>
                        <div className="flex justify-between mt-1">
                          <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                            Cost {(100 - livePreview.margin).toFixed(1)}%
                          </p>
                          <p className="ios-subhead" style={{ color: marginColor }}>
                            Profit {livePreview.margin.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Profit in MVR — the numbers a trader thinks in */}
                    <div className="grid grid-cols-2 gap-0" style={{ borderTop: `1px solid color-mix(in srgb, ${marginColor} 15%, transparent)` }}>
                      <div className="px-4 py-2.5" style={{ borderRight: `1px solid color-mix(in srgb, ${marginColor} 15%, transparent)` }}>
                        <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>
                          Profit / {tradeLabel}
                        </p>
                        <p className="text-[14px] font-bold" style={{ color: marginColor }}>
                          {livePreview.profitPerPack >= 0 ? "+" : ""}MVR {livePreview.profitPerPack.toFixed(2)}
                        </p>
                      </div>
                      <div className="px-4 py-2.5">
                        <p className="text-[12px] uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>
                          Profit / carton
                        </p>
                        <p className="text-[14px] font-bold" style={{ color: marginColor }}>
                          {livePreview.profitPerCtn >= 0 ? "+" : ""}MVR {livePreview.profitPerCtn.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* No GRN yet — explain why meter can't show */}
                {!landedPerPiece && (inlineFixed || inlineMargin) && (
                  <p className="ios-subhead" style={{ color: "var(--snm-warning)" }}>
                    Profit preview available after first shipment is confirmed.
                  </p>
                )}

                {/* Save button — only appears once a value is typed */}
                {(inlineMargin || inlineFixed) && canWrite && (
                  <button
                    onClick={saveInlinePrice}
                    disabled={savingPrice}
                    className="w-full h-10 rounded-lg ios-subhead font-bold flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
                    style={{ background: "var(--foreground)", color: "var(--background)", opacity: savingPrice ? 0.6 : 1 }}
                  >
                    {savingPrice ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save pricing →"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Carton dimensions */}
        <div>
          <p className="label-caps text-[12px] mb-2.5" style={{ color: "var(--muted-foreground)" }}>Carton Dimensions</p>
          <div className="rounded-xl px-4 py-3 space-y-1.5"
            style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
            <div className="flex justify-between ios-subhead">
              <span style={{ color: "var(--muted-foreground)" }}>L × W × H</span>
              <span className="text-foreground font-medium">
                {sku.carton_length_cm} × {sku.carton_width_cm} × {sku.carton_height_cm} cm
              </span>
            </div>
            <div className="flex justify-between ios-subhead">
              <span style={{ color: "var(--muted-foreground)" }}>CBM</span>
              <span className="text-foreground font-medium">{Number(sku.cbm_per_carton).toFixed(5)}</span>
            </div>
            {sku.carton_weight_kg && (
              <div className="flex justify-between ios-subhead">
                <span style={{ color: "var(--muted-foreground)" }}>Weight</span>
                <span className="text-foreground font-medium">{sku.carton_weight_kg} kg</span>
              </div>
            )}
          </div>
        </div>

        {/* Meta */}
        <div>
          <p className="label-caps text-[12px] mb-2.5" style={{ color: "var(--muted-foreground)" }}>Details</p>
          <div className="rounded-xl px-4 py-3 space-y-1.5"
            style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
            <div className="flex justify-between ios-subhead">
              <span style={{ color: "var(--muted-foreground)" }}>Category</span>
              <span className="text-foreground">{sku.category_name}</span>
            </div>
            <div className="flex justify-between ios-subhead">
              <span style={{ color: "var(--muted-foreground)" }}>UoM</span>
              <span className="text-foreground">{sku.unit_uom}</span>
            </div>
            {sku.supplier_barcode && (
              <div className="flex justify-between ios-subhead">
                <span style={{ color: "var(--muted-foreground)" }}>Barcode</span>
                <span className="text-foreground font-mono">{sku.supplier_barcode}</span>
              </div>
            )}
            <div className="flex justify-between ios-subhead">
              <span style={{ color: "var(--muted-foreground)" }}>Status</span>
              <span style={{ color: sku.is_active ? "var(--snm-success)" : "var(--muted-foreground)" }}>
                {sku.is_active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer actions */}
      {canWrite && (
        <div
          className="shrink-0 px-5 py-4 flex gap-2"
          style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}
        >
          <button
            onClick={onToggle}
            className="flex-1 h-10 rounded-xl ios-subhead font-medium transition"
            style={{
              background: sku.is_active
                ? "color-mix(in srgb, var(--snm-error) 10%, transparent)"
                : "color-mix(in srgb, var(--snm-success) 10%, transparent)",
              color: sku.is_active ? "var(--snm-error)" : "var(--snm-success)",
            }}
          >
            {sku.is_active ? "Deactivate" : "Activate"}
          </button>
          <button
            onClick={onEdit}
            className="flex-1 h-10 rounded-xl ios-subhead font-semibold transition flex items-center justify-center gap-1.5"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit SKU
          </button>
          {isAdmin && (
            <button
              onClick={onDelete}
              className="h-10 w-10 rounded-xl flex items-center justify-center transition shrink-0"
              style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)" }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── SKU row in the flat list ── */

function SkuRow({
  sku, selected, onClick,
}: { sku: SkuFullRow; selected: boolean; onClick: () => void }) {
  const pcsPerCtn = sku.pcs_per_pack * sku.packs_per_carton;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-4 text-left transition"
      style={{
        background: selected
          ? "color-mix(in srgb, var(--snm-brand) 8%, var(--glass-1))"
          : "transparent",
        borderLeft: selected ? "2px solid var(--snm-brand)" : "2px solid transparent",
      }}
    >
      {/* Status dot */}
      <div
        className="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5"
        style={{ background: sku.is_active ? "var(--snm-success)" : "var(--muted-foreground)", opacity: sku.is_active ? 1 : 0.4 }}
      />

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="ios-subhead font-semibold text-foreground truncate">
          {sku.model_name}
          {sku.variant_display
            ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {sku.variant_display}</span>
            : null}
        </p>
        <p className="ios-subhead mt-0.5 truncate" style={{ color: "var(--muted-foreground)" }}>
          {sku.pcs_per_pack}/pack × {sku.packs_per_carton}/ctn · {pcsPerCtn}/ctn
        </p>
      </div>

      {/* Price */}
      <div className="text-right shrink-0">
        {sku.selling_price_per_carton_mvr != null ? (
          <>
            <p className="ios-subhead font-semibold text-foreground">
              MVR {fmtPrice(sku.selling_price_per_carton_mvr)}
            </p>
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>per ctn</p>
          </>
        ) : (
          <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>no price</p>
        )}
      </div>

      <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
    </button>
  );
}

/* ── Main explorer ── */

export function ProductsExplorer() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [brands, setBrands]         = useState<BrandRow[]>([]);
  const [models, setModels]         = useState<ModelRow[]>([]);
  const [variants, setVariants]     = useState<VariantRow[]>([]);
  const [skus, setSkus]             = useState<SkuFullRow[]>([]);
  const [loading, setLoading]       = useState(true);

  const [q, setQ]                       = useState("");
  const [filterBrand, setFilterBrand]   = useState<string>("all");
  const [selectedSku, setSelectedSku]   = useState<SkuFullRow | null>(null);
  const [showFilters, setShowFilters]   = useState(false);
  // Collapsible brand groups. Holds the brand_ids that are COLLAPSED — default
  // empty means every brand is expanded (nothing hidden), matching the old view;
  // tapping a brand header collapses just that brand.
  const [collapsedBrands, setCollapsedBrands] = useState<Set<string>>(new Set());

  // Dialogs
  const [newSkuOpen, setNewSkuOpen]     = useState(false);
  const [editSku, setEditSku]           = useState<SkuFullRow | null>(null);
  const [cascadeTarget, setCascadeTarget] = useState<CascadeTarget | null>(null);

  const [role, setRole] = useState<"admin" | "manager" | "staff" | "viewer" | null>(null);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => setRole(null)); }, []);
  const isAdmin  = role === "admin";
  const canWrite = role !== "viewer" && role !== null;

  // Desktop split-pane height: measured from the grid's distance to the top of
  // the viewport rather than a hardcoded offset, so the detail panel always
  // fits exactly — its footer (Deactivate/Edit) can never be pushed off-screen
  // no matter how tall the title/tabs above it render.
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState<number | null>(null);
  useEffect(() => {
    function measure() {
      const el = gridRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const margin = 16; // breathing room at the viewport bottom
      setGridHeight(Math.max(360, window.innerHeight - top - margin));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [loading]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, b, m, v, s] = await Promise.all([
        listCategories(), listBrands(), listModels(), listVariants(), listSkusFlat(),
      ]);
      setCategories(c); setBrands(b); setModels(m); setVariants(v); setSkus(s);
    } catch (err) {
      toast.error("Failed to load: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Keep selectedSku in sync after reload
  useEffect(() => {
    if (selectedSku) {
      const fresh = skus.find((s) => s.id === selectedSku.id);
      if (fresh) setSelectedSku(fresh);
    }
  }, [skus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link: /products?editSku=<id> opens that SKU's price editor directly —
  // lets "why is this price what it is?" screens (New Sale) send Ali straight
  // to the fix instead of "go find it yourself" in a long product list.
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const id = searchParams.get("editSku");
    if (!id || skus.length === 0) return;
    const match = skus.find((s) => s.id === id);
    if (match) {
      setEditSku(match);
      router.replace("/products", { scroll: false }); // clean the URL, don't reopen on close
    }
  }, [searchParams, skus, router]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return skus.filter((s) => {
      if (filterBrand !== "all" && s.brand_id !== filterBrand) return false;
      if (!term) return true;
      return [s.brand_name, s.model_name, s.variant_display ?? "", s.internal_code]
        .join(" ").toLowerCase().includes(term);
    });
  }, [skus, q, filterBrand]);

  // Group flat list by brand for display
  const grouped = useMemo(() => {
    const map = new Map<string, { brandId: string; brand: string; skus: SkuFullRow[] }>();
    for (const s of filtered) {
      const entry = map.get(s.brand_id) ?? { brandId: s.brand_id, brand: s.brand_name, skus: [] };
      entry.skus.push(s);
      map.set(s.brand_id, entry);
    }
    // Rows arrive pre-sorted from listSkusFlat (brand → model → natural
    // variant order), so insertion order is already correct within each
    // group; just sort the brand groups A→Z for the dividers.
    return Array.from(map.values()).sort((a, b) => a.brand.localeCompare(b.brand));
  }, [filtered]);

  const toggleBrand = (brandId: string) => setCollapsedBrands((prev) => {
    const next = new Set(prev);
    next.has(brandId) ? next.delete(brandId) : next.add(brandId);
    return next;
  });

  const activeCount = skus.filter((s) => s.is_active).length;

  if (loading) {
    return <SkeletonRows rows={8} />;
  }

  // `scroll` = desktop split-pane that owns its own scroll (fixed height, inner
  // overflow). On mobile we pass false so the list flows in the page and the
  // document scrolls — one scroll container per screen (no nested scrolling).
  const listPanel = (scroll: boolean) => (
    <div
      className={`flex flex-col rounded-2xl ${scroll ? "h-full overflow-hidden" : ""}`}
      style={{
        background: "var(--glass-1)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        border: "0.5px solid var(--glass-border-lo)",
        boxShadow: "var(--glass-shadow), var(--glass-inner)",
      }}
    >
      {/* Toolbar */}
      <div className="px-4 pt-4 pb-3 space-y-3 shrink-0" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[15px] font-semibold text-foreground">
              {brands.length} brand{brands.length !== 1 ? "s" : ""}
              <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {activeCount} active SKUs</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="h-10 w-10 rounded-xl flex items-center justify-center transition active:scale-90"
              style={{
                background: showFilters ? "var(--snm-brand-muted)" : "var(--secondary)",
                color: showFilters ? "var(--snm-brand)" : "var(--muted-foreground)",
              }}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            {canWrite && (
              <button
                onClick={() => setNewSkuOpen(true)}
                className="h-10 px-4 rounded-xl ios-subhead font-semibold flex items-center gap-1.5 transition active:scale-95"
                style={{ background: "var(--foreground)", color: "var(--background)" }}
              >
                <Plus className="h-4 w-4" />
                New SKU
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div
          className="flex items-center gap-2 px-3 rounded-xl h-11"
          style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search SKUs…"
            className="flex-1 bg-transparent border-none outline-none ios-subhead text-foreground placeholder:text-muted-foreground"
          />
          {q && (
            <button onClick={() => setQ("")}>
              <X className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)" }} />
            </button>
          )}
        </div>

        {/* Brand filter */}
        {showFilters && (
          <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
            {[{ id: "all", name: "All brands" }, ...brands].map((b) => (
              <button
                key={b.id}
                onClick={() => setFilterBrand(b.id)}
                className="shrink-0 h-7 px-3 rounded-full ios-subhead font-medium transition whitespace-nowrap"
                style={{
                  background: filterBrand === b.id ? "var(--snm-brand)" : "var(--secondary)",
                  color: filterBrand === b.id ? "var(--snm-on-fill)" : "var(--muted-foreground)",
                }}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* SKU list */}
      <div className={scroll ? "flex-1 overflow-y-auto" : ""}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <Package className="h-8 w-8 mb-3 opacity-20" style={{ color: "var(--muted-foreground)" }} />
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
              {skus.length === 0
                ? "No SKUs yet — tap \"New SKU\" to add your first product."
                : "No results."}
            </p>
          </div>
        ) : (
          grouped.map(({ brandId, brand, skus: brandSkus }) => {
            // While searching, force every group open so no match is hidden.
            const collapsed = q.trim() === "" && collapsedBrands.has(brandId);
            return (
            <div key={brandId}>
              {/* Brand divider — tap to collapse/expand this brand's SKUs.
                  Expanded by default (nothing hidden); collapse the brands you
                  aren't working in. Inline (not sticky) reads more native for a
                  short catalogue. */}
              <button
                onClick={() => toggleBrand(brandId)}
                aria-expanded={!collapsed}
                className="w-full flex items-center gap-1.5 px-4 py-2.5 snm-pressable text-left"
                style={{
                  background: "color-mix(in srgb, var(--glass-1) 95%, transparent)",
                  borderBottom: "0.5px solid var(--glass-border-lo)",
                }}
              >
                <ChevronDown
                  className="h-3.5 w-3.5 shrink-0 transition-transform"
                  style={{ color: "var(--muted-foreground)", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                />
                <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                  {brand} · {brandSkus.length} SKU{brandSkus.length !== 1 ? "s" : ""}
                </p>
              </button>
              {!collapsed && brandSkus.map((sku) => (
                <SkuRow
                  key={sku.id}
                  sku={sku}
                  selected={selectedSku?.id === sku.id}
                  onClick={() => setSelectedSku(selectedSku?.id === sku.id ? null : sku)}
                />
              ))}
            </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="pb-28 lg:pb-0">
      {/* Desktop: side-by-side. Mobile: stack (panel slides over).
          Height subtracts the fixed chrome above the grid — topbar (52px),
          main top padding, the page title block and the tabs — so the panel
          fits the viewport and its footer (Deactivate/Edit) stays on-screen
          instead of being pushed below the fold. */}
      <div
        ref={gridRef}
        className="hidden lg:grid lg:grid-cols-[1fr_380px] gap-4"
        style={{ height: gridHeight ? `${gridHeight}px` : "calc(100dvh - 184px)" }}
      >
        {listPanel(true)}
        {selectedSku ? (
          <div className="rounded-2xl overflow-hidden h-full min-h-0 flex flex-col" style={{ border: "0.5px solid var(--glass-border-lo)" }}>
            <SkuPanel
              sku={selectedSku}
              isAdmin={isAdmin}
              canWrite={canWrite}
              onEdit={() => setEditSku(selectedSku)}
              onDelete={() => setCascadeTarget({ kind: "sku", id: selectedSku.id, label: selectedSku.internal_code })}
              onToggle={async () => {
                try { await toggleSkuActive(selectedSku.id, !selectedSku.is_active); await loadAll(); }
                catch (e) { toast.error((e as Error).message); }
              }}
              onClose={() => setSelectedSku(null)}
              onPricingUpdated={loadAll}
            />
          </div>
        ) : (
          <div
            className="rounded-2xl flex flex-col items-center justify-center text-center px-8"
            style={{
              background: "var(--glass-1)",
              backdropFilter: "var(--glass-blur)",
              border: "0.5px solid var(--glass-border-lo)",
              boxShadow: "var(--glass-shadow), var(--glass-inner)",
            }}
          >
            <ChevronRight className="h-8 w-8 mb-3 opacity-15" style={{ color: "var(--muted-foreground)" }} />
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
              Select a SKU to view details
            </p>
          </div>
        )}
      </div>

      {/* Mobile: list flows in the page — the document scrolls, not an inner
          pane. One scroll container per screen. Panel opens as a bottom sheet. */}
      <div className="lg:hidden">
        {listPanel(false)}

        {/* Mobile slide-up panel — scroll-locked, grabber, drag-to-dismiss */}
        {selectedSku && (
          <MobileSkuSheet onClose={() => setSelectedSku(null)}>
            <SkuPanel
              sku={selectedSku}
              isAdmin={isAdmin}
              canWrite={canWrite}
              onEdit={() => setEditSku(selectedSku)}
              onDelete={() => setCascadeTarget({ kind: "sku", id: selectedSku.id, label: selectedSku.internal_code })}
              onToggle={async () => {
                try { await toggleSkuActive(selectedSku.id, !selectedSku.is_active); await loadAll(); }
                catch (e) { toast.error((e as Error).message); }
              }}
              onClose={() => setSelectedSku(null)}
              onPricingUpdated={loadAll}
            />
          </MobileSkuSheet>
        )}
      </div>

      {/* New SKU wizard dialog */}
      <NewSkuWizard
        open={newSkuOpen}
        onOpenChange={setNewSkuOpen}
        brands={brands}
        categories={categories}
        models={models}
        variants={variants}
        existingSkus={skus}
        onSaved={loadAll}
      />

      {/* Edit SKU dialog */}
      <EditSkuDialog
        sku={editSku}
        open={!!editSku}
        onOpenChange={(o) => !o && setEditSku(null)}
        onSaved={async () => { await loadAll(); }}
      />

      {/* Cascade delete */}
      <CascadeDeleteDialog
        target={cascadeTarget}
        open={!!cascadeTarget}
        onOpenChange={(o) => !o && setCascadeTarget(null)}
        onDone={async () => { setSelectedSku(null); await loadAll(); }}
      />
    </div>
  );
}

/* ── New SKU form — single card, everything inline ── */

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] font-bold uppercase tracking-widest pt-1" style={{ color: "var(--muted-foreground)", opacity: 0.55 }}>
      {children}
    </p>
  );
}

/* ── Combobox: type to search, shows "Create X" when no match ── */
function Combobox({
  value, onChange, options, placeholder, createLabel, onCreateClick, disabled, onDeleteOption,
}: {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
  placeholder: string;
  createLabel?: string;
  onCreateClick?: () => void;
  disabled?: boolean;
  onDeleteOption?: (id: string, label: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);
  const filtered = q.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
    : options;
  const showCreate = onCreateClick && q.trim().length > 0 && !options.some(
    (o) => o.label.toLowerCase() === q.trim().toLowerCase()
  );

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        onClick={() => { if (!disabled) { setOpen(!open); setQ(""); } }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 44, padding: "0 12px", borderRadius: 10, cursor: disabled ? "default" : "pointer",
          background: disabled ? "color-mix(in srgb, var(--foreground) 3%, transparent)" : "color-mix(in srgb, var(--foreground) 6%, transparent)",
          border: "0.5px solid var(--glass-border-lo)",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ fontSize: 14, color: selected ? "var(--foreground)" : "var(--muted-foreground)" }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-foreground)", transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "var(--glass-2)", backdropFilter: "var(--glass-blur-lg)", WebkitBackdropFilter: "var(--glass-blur-lg)",
          border: "0.5px solid var(--glass-border-lo)", borderRadius: 12, overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}>
          <div style={{ padding: "8px 8px 4px" }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 8, border: "0.5px solid var(--glass-border-lo)",
                background: "color-mix(in srgb, var(--foreground) 5%, transparent)",
                color: "var(--foreground)", fontSize: 13, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            {filtered.map((o) => (
              <div
                key={o.id}
                style={{
                  display: "flex", alignItems: "center",
                  borderBottom: "0.5px solid color-mix(in srgb, var(--glass-border-lo) 60%, transparent)",
                }}
              >
                <button
                  onClick={() => { onChange(o.id); setOpen(false); setQ(""); }}
                  style={{
                    flex: 1, textAlign: "left", padding: "10px 14px", background: "transparent",
                    border: "none", cursor: "pointer", fontSize: 13,
                    color: o.id === value ? "var(--snm-brand)" : "var(--foreground)",
                    display: "flex", alignItems: "center", gap: 8,
                  }}
                >
                  {o.id === value && <Check className="h-3.5 w-3.5" style={{ color: "var(--snm-brand-text)", flexShrink: 0 }} />}
                  {o.label}
                </button>
                {onDeleteOption && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteOption(o.id, o.label); }}
                    title={`Delete ${o.label}`}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      padding: "0 12px 0 4px", color: "var(--muted-foreground)",
                      fontSize: 15, lineHeight: 1, flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {filtered.length === 0 && !showCreate && (
              <p style={{ padding: "10px 14px", fontSize: 13, color: "var(--muted-foreground)" }}>No results</p>
            )}
          </div>
          {showCreate && onCreateClick && (
            <button
              onClick={() => { onCreateClick(); setOpen(false); setQ(""); }}
              style={{
                width: "100%", textAlign: "left", padding: "10px 14px",
                borderTop: "0.5px solid var(--glass-border-lo)",
                background: "color-mix(in srgb, var(--snm-brand) 8%, transparent)",
                border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                color: "var(--snm-brand-text)",
              }}
            >
              + Create &ldquo;{q.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ATTR_SPECS_WIZARD: Record<string, { label: string; placeholder?: string; type: "text" | "number"; options?: string[]; suffix?: string }> = {
  size:      { label: "Size",    placeholder: "NB / S / M / L / XL / XXL", type: "text" },
  scent:     { label: "Scent",   placeholder: "e.g. Mint",                  type: "text" },
  format:    { label: "Format",  type: "text",
               options: ["Bottle","Pouch","Pack","Box"] },
  volume_ml: { label: "Volume",  placeholder: "e.g. 700",  type: "number", suffix: "ml" },
  weight_g:  { label: "Weight",  placeholder: "e.g. 250",  type: "number", suffix: "g"  },
  colour:    { label: "Colour",  placeholder: "e.g. Pink", type: "text" },
  other:     { label: "Other",   placeholder: "Optional",  type: "text" },
};

function attrsToDisplayName(attrs: Record<string, string>, schema: AttrKey[]): string {
  return schema.map((k) => {
    const v = attrs[k];
    if (!v || !v.trim()) return "";
    const spec = ATTR_SPECS_WIZARD[k];
    return spec?.suffix ? `${v.trim()}${spec.suffix}` : v.trim();
  }).filter(Boolean).join(" ");
}

/* ── CategoryPills — select existing + inline create + delete non-system ── */
function CategoryPills({
  categories, selectedId, onSelect, onCreated, onDeleted,
}: {
  categories: CategoryRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreated: (cat: CategoryRow) => void;
  onDeleted?: (id: string) => void;
}) {
  const [adding, setAdding]   = useState(false);
  const [name, setName]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [confirmCat, setConfirmCat] = useState<{ id: string; name: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => { if (adding) setTimeout(() => inputRef.current?.focus(), 50); }, [adding]);

  async function create() {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    try {
      const created = await createCategory({
        name: n,
        description: null,
        unit_uom: "pcs",
        cost_basis: "piece",
        variant_attributes: [],
      }) as CategoryRow;
      onCreated(created);
      setName(""); setAdding(false);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  function remove(id: string, catName: string) {
    setConfirmCat({ id, name: catName });
  }

  const pill: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "4px 8px 4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
    border: "1px solid", cursor: "pointer", whiteSpace: "nowrap",
  };

  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {categories.map((c) => {
        const active = selectedId === c.id;
        return (
          <span key={c.id} style={{
            ...pill,
            background: active ? "var(--snm-brand)" : "transparent",
            borderColor: active ? "var(--snm-brand)" : "var(--glass-border)",
            color: active ? "var(--snm-on-fill)" : "var(--muted-foreground)",
          }}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
                color: "inherit", fontSize: "inherit", fontWeight: "inherit" }}
            >
              {c.name}
            </button>
            {/* Delete only non-system categories */}
            {!c.is_system && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); remove(c.id, c.name); }}
                title="Delete category"
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: "0 2px",
                  color: active ? "rgba(255,255,255,0.7)" : "var(--muted-foreground)",
                  lineHeight: 1, fontSize: 13,
                }}
              >
                ×
              </button>
            )}
          </span>
        );
      })}

      {/* Inline new-category form */}
      {adding ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") { setAdding(false); setName(""); } }}
            placeholder="Category name"
            style={{
              height: 26, padding: "0 8px", borderRadius: 999, fontSize: 11,
              border: "1px solid var(--snm-brand)", outline: "none",
              background: "color-mix(in srgb, var(--snm-brand) 8%, transparent)",
              color: "var(--foreground)", width: 110,
            }}
          />
          <button type="button" onClick={create} disabled={saving || !name.trim()}
            style={{ height: 26, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
              background: "var(--foreground)", color: "var(--background)", border: "none", cursor: saving ? "wait" : "pointer",
              opacity: !name.trim() ? 0.5 : 1 }}>
            {saving ? "…" : "Add"}
          </button>
          <button type="button" onClick={() => { setAdding(false); setName(""); }}
            style={{ height: 26, padding: "0 8px", borderRadius: 999, fontSize: 11,
              background: "transparent", color: "var(--muted-foreground)", border: "0.5px solid var(--glass-border-lo)", cursor: "pointer" }}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          style={{ ...pill, borderStyle: "dashed", borderColor: "var(--glass-border)",
            color: "var(--muted-foreground)", background: "transparent" }}
        >
          + New
        </button>
      )}

      <ConfirmSheet
        open={confirmCat !== null}
        onClose={() => setConfirmCat(null)}
        title="Delete category?"
        message={confirmCat ? `"${confirmCat.name}" will be permanently deleted.` : ""}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmCat) return;
          try {
            await deleteCategory(confirmCat.id);
            haptic("success");
            if (selectedId === confirmCat.id) onSelect("");
            onDeleted?.(confirmCat.id);
            setConfirmCat(null);
          } catch (e) { haptic("error"); toast.error((e as Error).message); }
        }}
      />
    </div>
  );
}

function NewSkuWizard({
  open, onOpenChange, brands, categories, models, variants, existingSkus, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brands: BrandRow[];
  categories: CategoryRow[];
  models: ModelRow[];
  variants: VariantRow[];
  existingSkus: SkuFullRow[];
  onSaved: () => void;
}) {
  // NOTE: do NOT call useBodyScrollLock here. This dialog uses the Base-UI
  // <Dialog>, which already locks page scroll on open and restores it on close.
  // Adding our own manual lock stacked a second lock whose cleanup restored the
  // body to Base-UI's *already-locked* styles (position:fixed/overflow:hidden),
  // leaving the whole app frozen after Cancel. The edit dialogs (same <Dialog>)
  // never added the manual hook and work correctly — match that.

  // ── Identity fields (typed inline, not selected from a list first)
  const [brandInput,  setBrandInput]  = useState("");   // typed name or selected name
  const [brandId,     setBrandId]     = useState("");   // resolved id after match/create
  const [modelInput,  setModelInput]  = useState("");
  const [modelId,     setModelId]     = useState("");
  const [categoryId,  setCategoryId]  = useState("");
  const [variantAttrs, setVariantAttrs] = useState<Record<string, string>>({});

  // ── Pack config
  const [pcsPerPack,  setPcsPerPack]  = useState("");
  const [packsPerCtn, setPacksPerCtn] = useState("");
  const [lenCm, setLenCm] = useState("");
  const [widCm, setWidCm] = useState("");
  const [htCm,  setHtCm]  = useState("");
  const [code,       setCode]       = useState("");
  const [barcode,    setBarcode]    = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [marginPct,       setMarginPct]       = useState("");
  const [fixedPrice,      setFixedPrice]      = useState("");
  const [fixedPackPrice,  setFixedPackPrice]  = useState("");
  const [fixedCartonPrice,setFixedCartonPrice]= useState("");
  // "bottle" = enter per bottle/pack  |  "carton" = enter per carton (system derives bottle price)
  const [fixedEntryUnit,  setFixedEntryUnit]  = useState<"bottle" | "carton">("bottle");
  // Which tiers this product is sold in. Defaults from the category once picked.
  const [sellUnits,       setSellUnits]       = useState<SellUnit[]>(["pack", "carton"]);
  const [sellUnitsTouched, setSellUnitsTouched] = useState(false);
  const [saving,          setSaving]          = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [confirmDeleteModel, setConfirmDeleteModel] = useState<{ id: string; name: string } | null>(null);

  // ── Local items created during this session (so combos show them instantly)
  const [localBrands,        setLocalBrands]        = useState<BrandRow[]>([]);
  const [localModels,        setLocalModels]        = useState<ModelRow[]>([]);
  const [localCategories,    setLocalCategories]    = useState<CategoryRow[]>([]);
  // IDs deleted during this session — filter them out immediately without waiting for a re-fetch
  const [deletedCategoryIds, setDeletedCategoryIds] = useState<Set<string>>(new Set());
  const [deletedModelIds,    setDeletedModelIds]    = useState<Set<string>>(new Set());

  const allBrands = useMemo(() => {
    const ids = new Set(brands.map((b) => b.id));
    return [...brands, ...localBrands.filter((b) => !ids.has(b.id))];
  }, [brands, localBrands]);

  const allCategories = useMemo(() => {
    const ids = new Set(categories.map((c) => c.id));
    const merged = [...categories, ...localCategories.filter((c) => !ids.has(c.id))];
    return merged.filter((c) => !deletedCategoryIds.has(c.id));
  }, [categories, localCategories, deletedCategoryIds]);

  const allModels = useMemo(() => {
    const ids = new Set(models.map((m) => m.id));
    const merged = [...models, ...localModels.filter((m) => !ids.has(m.id))];
    return merged.filter((m) => !deletedModelIds.has(m.id));
  }, [models, localModels, deletedModelIds]);

  // Derived
  const brandModels  = allModels.filter((m) => m.brand_id === brandId);
  const category     = allCategories.find((c) => c.id === categoryId);
  const schema: AttrKey[] = (category?.variant_attributes ?? []) as AttrKey[];

  // Default the sellable units from the category (until the user picks manually).
  useEffect(() => {
    if (sellUnitsTouched) return;
    const def = category?.default_sellable_units;
    if (def && def.length > 0) setSellUnits(def);
  }, [categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sellsPack = sellUnits.includes("pack");
  const sellsCarton = sellUnits.includes("carton");

  // Carton-only product → the base price must be entered per carton (no pack tier).
  useEffect(() => {
    if (!sellsPack && fixedEntryUnit !== "carton") setFixedEntryUnit("carton");
  }, [sellsPack]); // eslint-disable-line react-hooks/exhaustive-deps

  const pcsPerCarton = useMemo(() => {
    const p = parseInt(pcsPerPack), c = parseInt(packsPerCtn);
    return p > 0 && c > 0 ? p * c : null;
  }, [pcsPerPack, packsPerCtn]);

  const cbm = useMemo(() => {
    const l = parseFloat(lenCm), w = parseFloat(widCm), h = parseFloat(htCm);
    return l > 0 && w > 0 && h > 0 ? (l * w * h) / 1_000_000 : null;
  }, [lenCm, widCm, htCm]);

  // Auto-fill dims from a sibling SKU when model is chosen;
  // also reset variant attrs so stale selections from a previous pick don't bleed through
  useEffect(() => {
    if (!modelId) return;
    setVariantAttrs({});
    const sib = existingSkus.find((s) => s.model_id === modelId);
    if (sib && !lenCm && !widCm && !htCm) {
      setLenCm(String(sib.carton_length_cm));
      setWidCm(String(sib.carton_width_cm));
      setHtCm(String(sib.carton_height_cm));
    }
  }, [modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate internal code
  useEffect(() => {
    const b = brandInput.replace(/\s/g, "").toUpperCase().slice(0, 4);
    const m = modelInput.replace(/\s/g, "").toUpperCase().slice(0, 4);
    const v = attrsToDisplayName(variantAttrs, schema).replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
    const p = pcsPerPack && packsPerCtn ? `${pcsPerPack}x${packsPerCtn}` : "";
    if (b || m) setCode([b, m, v, p].filter(Boolean).join("-"));
  }, [brandInput, modelInput, variantAttrs, pcsPerPack, packsPerCtn]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setBrandInput(""); setBrandId("");
    setModelInput(""); setModelId(""); setCategoryId("");
    setVariantAttrs({});
    setPcsPerPack(""); setPacksPerCtn("");
    setLenCm(""); setWidCm(""); setHtCm("");
    setCode(""); setBarcode(""); setMarginPct(""); setFixedPrice(""); setFixedPackPrice(""); setFixedCartonPrice(""); setFixedEntryUnit("bottle");
    setSellUnits(["pack", "carton"]); setSellUnitsTouched(false);
    setShowOptional(false); setShowScanner(false);
    setLocalBrands([]); setLocalModels([]); setLocalCategories([]); setDeletedCategoryIds(new Set()); setDeletedModelIds(new Set());
  }

  useEffect(() => { if (open) reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resolve brand: find existing or create new
  async function resolveBrand(name: string): Promise<string> {
    const existing = allBrands.find((b) => b.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing.id;
    const b = await createBrand(name.trim());
    setLocalBrands((prev) => [...prev, b]);
    return b.id;
  }

  // ── Resolve model: find existing for this brand+name, or create new
  async function resolveModel(name: string, bId: string, catId: string): Promise<string> {
    const existing = allModels.find(
      (m) => m.brand_id === bId && m.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (existing) return existing.id;
    const m = await createModel({ brand_id: bId, category_id: catId, name: name.trim() });
    setLocalModels((prev) => [...prev, m]);
    return m.id;
  }

  // ── Save: creates everything needed in sequence, then the SKU
  async function save() {
    if (!brandInput.trim() || !modelInput.trim() || !categoryId || !pcsPerPack || !packsPerCtn || !lenCm || !widCm || !htCm || !code.trim()) {
      toast.error("Fill all required fields.");
      return;
    }
    const variantDisplay = attrsToDisplayName(variantAttrs, schema) || modelInput.trim();
    setSaving(true);
    try {
      const bId = await resolveBrand(brandInput);
      const mId = await resolveModel(modelInput, bId, categoryId);

      // Resolve variant: find or create
      const existingVariant = variants.find(
        (v) => v.model_id === mId && v.display_name.toLowerCase() === variantDisplay.toLowerCase()
      );
      const cleanedAttrs: Record<string, string | number> = {};
      for (const k of schema) {
        const val = variantAttrs[k];
        if (val && val.trim()) {
          cleanedAttrs[k] = ATTR_SPECS_WIZARD[k]?.type === "number" ? Number(val) : val.trim();
        }
      }
      const vId = existingVariant
        ? existingVariant.id
        : (await createVariant({ model_id: mId, attributes: cleanedAttrs, display_name: variantDisplay })).id;

      await createSku({
        variant_id: vId,
        internal_code: code.trim(),
        supplier_barcode: barcode.trim() || null,
        pcs_per_pack: parseInt(pcsPerPack),
        packs_per_carton: parseInt(packsPerCtn),
        carton_length_cm: parseFloat(lenCm),
        carton_width_cm: parseFloat(widCm),
        carton_height_cm: parseFloat(htCm),
        sellable_units: sellUnits,
        target_margin_pct: marginPct ? parseFloat(marginPct) : null,
        // fixed_selling_price_mvr is always stored per-piece.
        // If user entered per bottle/pack: divide by pcs_per_pack.
        // If user entered per carton: divide by pcs_per_pack × packs_per_carton.
        fixed_selling_price_mvr: fixedPrice
          ? fixedEntryUnit === "carton"
            ? parseFloat(fixedPrice) / (parseInt(pcsPerPack) * parseInt(packsPerCtn))
            : parseFloat(fixedPrice) / parseInt(pcsPerPack)
          : null,
        // Don't persist a pack volume-break for a carton-only product.
        fixed_price_per_pack_mvr: sellUnits.includes("pack") && fixedPackPrice ? parseFloat(fixedPackPrice) : null,
        fixed_price_per_carton_mvr: fixedCartonPrice ? parseFloat(fixedCartonPrice) : null,
      });

      haptic("success");
      toast.success("SKU created");
      onOpenChange(false);
      onSaved();
    } catch (e) { haptic("error"); toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  const hasVariantFields = schema.length > 0;
  const variantFilled = !hasVariantFields || schema.some((k) => variantAttrs[k]?.trim());
  const canSave = !!brandInput.trim() && !!modelInput.trim() && !!categoryId &&
    variantFilled && !!pcsPerPack && !!packsPerCtn && !!lenCm && !!widCm && !!htCm && !!code.trim();

  const inp: React.CSSProperties = {
    width: "100%", height: 44, padding: "0 12px", borderRadius: 10,
    background: "color-mix(in srgb, var(--foreground) 6%, transparent)",
    border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)",
    fontSize: 14, outline: "none", boxSizing: "border-box",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent selfManaged className="bg-popover border-border sm:max-w-lg">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 shrink-0" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
          <DialogTitle className="text-[17px] font-semibold">New SKU</DialogTitle>
          <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Type to search or create — everything in one card
          </p>
        </div>

        {/* Scrollable body — flex-1 fills leftover space; footer stays pinned */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>

          {/* ── Row 1: Brand + Category ── */}
          <div className="grid grid-cols-2 gap-3">

            {/* Brand — combobox for existing + always-visible text field for new */}
            <div className="space-y-1.5">
              <Label className="ios-subhead">Brand *</Label>
              {/* Existing brand picker — shows selected brand with a clear button */}
              <div style={{ position: "relative" }}>
                <Combobox
                  value={brandId}
                  onChange={(id) => {
                    setBrandId(id);
                    const name = allBrands.find((b) => b.id === id)?.name ?? "";
                    setBrandInput(name);
                    setModelInput(""); setModelId("");
                  }}
                  options={allBrands.map((b) => ({ id: b.id, label: b.name }))}
                  placeholder="Pick existing…"
                />
                {brandId && (
                  <button
                    type="button"
                    onClick={() => { setBrandId(""); setBrandInput(""); setModelInput(""); setModelId(""); }}
                    title="Clear — type a new brand below"
                    style={{
                      position: "absolute", right: 32, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", cursor: "pointer", padding: 2,
                      color: "var(--muted-foreground)", lineHeight: 1, fontSize: 14,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              {/* Always-visible text field — type a NEW brand name here */}
              <input
                value={brandId ? "" : brandInput}
                onChange={(e) => { setBrandInput(e.target.value); setBrandId(""); setModelInput(""); setModelId(""); }}
                placeholder={brandId ? `Using: ${allBrands.find(b => b.id === brandId)?.name ?? ""}` : "Or type new brand name…"}
                disabled={!!brandId}
                style={{ ...inp, opacity: brandId ? 0.45 : 1 }}
              />
              {!brandId && brandInput.trim() && (
                <p className="ios-subhead" style={{ color: "var(--snm-brand-text)" }}>
                  Will create &ldquo;{brandInput.trim()}&rdquo; as a new brand
                </p>
              )}
            </div>

            {/* Category — pills + inline "+ New category" */}
            <div className="space-y-1.5">
              <Label className="ios-subhead">Category *</Label>
              <CategoryPills
                categories={allCategories}
                selectedId={categoryId}
                onSelect={(id) => { setCategoryId(id); setVariantAttrs({}); }}
                onCreated={(newCat) => {
                  setLocalCategories((prev) => [...prev, newCat]);
                  setCategoryId(newCat.id);
                  setVariantAttrs({});
                }}
                onDeleted={(id) => {
                  setLocalCategories((prev) => prev.filter((c) => c.id !== id));
                  setDeletedCategoryIds((prev) => new Set([...prev, id]));
                  if (categoryId === id) { setCategoryId(""); setVariantAttrs({}); }
                }}
              />
            </div>
          </div>

          {/* ── Row 2: Model ── */}
          <div className="space-y-1.5">
            <Label className="ios-subhead">Model name *</Label>
            <Combobox
              value={modelId}
              onChange={(id) => {
                setModelId(id);
                const name = brandModels.find((m) => m.id === id)?.name ?? "";
                setModelInput(name);
                // auto-select category from existing model
                const m = allModels.find((x) => x.id === id);
                if (m && !categoryId) setCategoryId(m.category_id);
              }}
              options={brandModels.map((m) => ({ id: m.id, label: m.name }))}
              placeholder={brandInput ? `Search models under ${brandInput}…` : "Select brand first"}
              disabled={!brandInput.trim()}
              onDeleteOption={(id, name) => setConfirmDeleteModel({ id, name })}
            />
            <input
              value={modelInput}
              onChange={(e) => { setModelInput(e.target.value); setModelId(""); }}
              placeholder="e.g. Mamypoko Diaper Pants"
              style={{ ...inp, marginTop: 6 }}
            />
            {!modelId && modelInput.trim() && (
              <p className="ios-subhead" style={{ color: "var(--snm-brand-text)" }}>
                Will create &ldquo;{modelInput.trim()}&rdquo; as a new model
              </p>
            )}
          </div>

          {/* ── Row 3: Variant attributes (category-driven) ── */}
          {categoryId && hasVariantFields && (
            <div className="space-y-2">
              <Label className="ios-subhead">
                {category?.name === "Diapers" ? "Size *" : "Variant *"}
                <span className="font-normal ml-1" style={{ color: "var(--muted-foreground)" }}>
                  — {schema.join(", ")}
                </span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {schema.map((key) => {
                  const spec = ATTR_SPECS_WIZARD[key];
                  if (spec?.options) {
                    // Check if the current value is a custom entry (not in the preset list)
                    const currentVal = variantAttrs[key] ?? "";
                    const isCustom = currentVal !== "" && !spec.options.includes(currentVal);
                    return (
                      <div key={key} className="flex flex-wrap gap-1 col-span-2">
                        {spec.options.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setVariantAttrs((prev) => {
                              const next = { ...prev };
                              if (next[key] === opt) delete next[key]; // toggle off
                              else next[key] = opt;
                              return next;
                            })}
                            style={{
                              padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                              border: "1px solid",
                              background: variantAttrs[key] === opt ? "var(--snm-brand)" : "transparent",
                              borderColor: variantAttrs[key] === opt ? "var(--snm-brand)" : "var(--glass-border)",
                              color: variantAttrs[key] === opt ? "var(--snm-on-fill)" : "var(--muted-foreground)",
                              cursor: "pointer",
                            }}
                          >
                            {opt}
                          </button>
                        ))}
                        {/* Custom format input */}
                        <input
                          type="text"
                          value={isCustom ? currentVal : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setVariantAttrs((prev) => {
                              const next = { ...prev };
                              if (v.trim()) next[key] = v;
                              else delete next[key];
                              return next;
                            });
                          }}
                          placeholder="Other…"
                          style={{
                            height: 28, padding: "0 8px", borderRadius: 999, fontSize: 11,
                            border: `1px solid ${isCustom ? "var(--snm-brand)" : "var(--glass-border)"}`,
                            background: isCustom ? "color-mix(in srgb, var(--snm-brand) 8%, transparent)" : "transparent",
                            color: "var(--foreground)", outline: "none", width: 72,
                          }}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={key} className="space-y-1">
                      <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                        {spec?.label}{spec?.suffix ? ` (${spec.suffix})` : ""}
                      </p>
                      <input
                        type={spec?.type === "number" ? "number" : "text"}
                        value={variantAttrs[key] ?? ""}
                        onChange={(e) => setVariantAttrs({ ...variantAttrs, [key]: e.target.value })}
                        placeholder={spec?.placeholder ?? ""}
                        style={inp}
                      />
                    </div>
                  );
                })}
              </div>
              {variantFilled && (
                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                  Variant: <strong style={{ color: "var(--foreground)" }}>{attrsToDisplayName(variantAttrs, schema) || "—"}</strong>
                </p>
              )}
            </div>
          )}

          {/* ── Divider ── */}
          <div style={{ borderTop: "0.5px solid var(--glass-border-lo)" }} />

          {/* ── Pack config ── */}
          <div className="space-y-3">
            <SectionHead>Pack Configuration</SectionHead>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="ios-subhead">Pcs per Pack *</Label>
                <input type="number" inputMode="numeric" min="1"
                  value={pcsPerPack} onChange={(e) => setPcsPerPack(e.target.value)}
                  placeholder="e.g. 34" style={inp} />
              </div>
              <div className="space-y-1.5">
                <Label className="ios-subhead">Packs per Carton *</Label>
                <input type="number" inputMode="numeric" min="1"
                  value={packsPerCtn} onChange={(e) => setPacksPerCtn(e.target.value)}
                  placeholder="e.g. 4" style={inp} />
              </div>
            </div>

            {pcsPerCarton && (
              <div className="rounded-xl px-3 py-2" style={{ background: "color-mix(in srgb, var(--snm-success) 10%, transparent)" }}>
                <p className="ios-subhead font-medium" style={{ color: "var(--snm-success)" }}>
                  {pcsPerCarton} pcs per carton total
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="ios-subhead">Carton dimensions (cm) *</Label>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" inputMode="decimal" step="0.1"
                  value={lenCm} onChange={(e) => setLenCm(e.target.value)}
                  placeholder="L" style={inp} />
                <input type="number" inputMode="decimal" step="0.1"
                  value={widCm} onChange={(e) => setWidCm(e.target.value)}
                  placeholder="W" style={inp} />
                <input type="number" inputMode="decimal" step="0.1"
                  value={htCm} onChange={(e) => setHtCm(e.target.value)}
                  placeholder="H" style={inp} />
              </div>
              {cbm !== null && (
                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                  {cbm.toFixed(5)} CBM per carton
                </p>
              )}
            </div>

            {/* Internal code */}
            <div className="space-y-1.5">
              <Label className="ios-subhead">Internal code *</Label>
              <input className="font-mono"
                value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="Auto-generated" style={{ ...inp, fontSize: 13 }} />
            </div>

            {/* ── Customer Selling Price ── */}
            {(() => {
              // Derive trade unit label from category/variant attrs
              const fmtAttr = variantAttrs["format"];
              const tradeUnit = fmtAttr
                ? fmtAttr
                : category?.unit_uom === "ml" ? "Bottle"
                : category?.unit_uom === "g"  ? "Pouch"
                : "Pack";

              // Parse pack config for live derivation
              const pcsN  = parseInt(pcsPerPack, 10);
              const ctnsN = parseInt(packsPerCtn, 10);
              const pcsPerCarton = pcsN > 0 && ctnsN > 0 ? pcsN * ctnsN : null;

              // Live derived prices when fixed carton price is entered
              const fixedVal = parseFloat(fixedPrice);
              const derivedBottlePrice = !isNaN(fixedVal) && fixedVal > 0 && pcsN > 0
                ? fixedEntryUnit === "carton"
                  // Can't derive per-bottle until packs/carton is filled in —
                  // falling through here used to show the CARTON price
                  // labeled as the per-bottle figure.
                  ? (pcsPerCarton ? fixedVal / ctnsN : null)
                  : fixedVal                        // already per bottle
                : null;
              const derivedCartonPrice = !isNaN(fixedVal) && fixedVal > 0
                ? fixedEntryUnit === "carton"
                  ? fixedVal                        // already per carton
                  : ctnsN > 0 ? fixedVal * ctnsN : null  // bottle × packs_per_carton
                : null;

              return (
                <div style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingTop: 16 }}>
                  {/* Header */}
                  <p style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", marginBottom: 2 }}>
                    Customer Selling Price
                  </p>
                  <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 12 }}>
                    What you charge shops — not your supplier cost. Supplier cost is calculated automatically when you confirm a shipment. You can set this now or after your first GRN.
                  </p>

                  {/* Sold in — which tiers this product is offered in. Drives which
                      price fields appear below (carton-only hides pack pricing). */}
                  <div className="space-y-1.5" style={{ marginBottom: 12 }}>
                    <Label className="ios-subhead">Sold in</Label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {([
                        { key: "pack" as const, label: tradeUnit },
                        { key: "carton" as const, label: "Carton" },
                      ]).map((opt) => {
                        const on = sellUnits.includes(opt.key);
                        return (
                          <button key={opt.key} type="button"
                            onClick={() => {
                              setSellUnitsTouched(true);
                              setSellUnits((prev) => {
                                const has = prev.includes(opt.key);
                                // Never allow an empty selection — keep at least one tier.
                                if (has && prev.length === 1) return prev;
                                return has ? prev.filter((u) => u !== opt.key) : [...prev, opt.key];
                              });
                            }}
                            style={{
                              flex: 1, padding: "8px 12px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                              border: on ? "none" : "0.5px solid var(--glass-border-lo)",
                              background: on ? "var(--foreground)" : "transparent",
                              color: on ? "var(--background)" : "var(--muted-foreground)",
                              transition: "all 0.15s",
                            }}>
                            {on && <Check className="h-3.5 w-3.5" style={{ flexShrink: 0 }} />}
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <p style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                      Tap to choose the units customers can buy — selected units show a checkmark. Prices below adapt to your choice.
                    </p>
                  </div>

                  {/* Strategy row: Margin % + Fixed price side by side */}
                  <div className="grid grid-cols-2 gap-2.5">

                    {/* Margin % */}
                    <div className="space-y-1.5">
                      <Label className="ios-subhead">
                        Target margin %
                      </Label>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="number" inputMode="decimal" step="0.5" min="1" max="99"
                          value={marginPct}
                          onChange={(e) => { setMarginPct(e.target.value); if (e.target.value) setFixedPrice(""); }}
                          placeholder="e.g. 30"
                          style={{ ...inp, width: "100%", opacity: fixedPrice ? 0.4 : 1 }}
                          disabled={!!fixedPrice} />
                        <span style={{ fontSize: 13, color: "var(--muted-foreground)", flexShrink: 0 }}>%</span>
                      </div>
                      <p style={{ fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
                        Auto-calculates after each shipment
                      </p>
                    </div>

                    {/* Fixed price — with entry-unit toggle */}
                    <div className="space-y-1.5">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Label className="ios-subhead">Fixed selling price</Label>
                        {/* Toggle: per bottle OR per carton. Carton-only products
                            (no pack tier) only offer "/ Carton" — no pack option. */}
                        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "0.5px solid var(--glass-border-lo)" }}>
                          {(sellsPack ? (["bottle", "carton"] as const) : (["carton"] as const)).map((u) => (
                            <button key={u} type="button"
                              onClick={() => { setFixedEntryUnit(u); setFixedPrice(""); }}
                              style={{
                                fontSize: 10, padding: "2px 7px", cursor: "pointer", border: "none",
                                background: fixedEntryUnit === u
                                  ? "var(--foreground)"
                                  : "transparent",
                                color: fixedEntryUnit === u
                                  ? "var(--background)"
                                  : "var(--muted-foreground)",
                                fontWeight: fixedEntryUnit === u ? 700 : 400,
                                transition: "background 0.15s",
                              }}>
                              {u === "bottle" ? `/ ${tradeUnit}` : "/ Carton"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="number" inputMode="decimal" step="0.01" min="0.01"
                          value={fixedPrice}
                          onChange={(e) => { setFixedPrice(e.target.value); if (e.target.value) setMarginPct(""); }}
                          placeholder={fixedEntryUnit === "carton" ? "e.g. 320.00" : "e.g. 45.00"}
                          style={{ ...inp, width: "100%" }} />
                        <span style={{ fontSize: 11, color: "var(--muted-foreground)", flexShrink: 0 }}>MVR</span>
                      </div>
                      <p style={{ fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
                        {fixedEntryUnit === "carton"
                          ? `Enter carton price — ${tradeUnit.toLowerCase()} price derived`
                          : `Enter ${tradeUnit.toLowerCase()} price — carton derived`}
                      </p>
                    </div>
                  </div>

                  {/* Live derivation preview */}
                  {fixedPrice && !isNaN(parseFloat(fixedPrice)) && parseFloat(fixedPrice) > 0 && (
                    <div style={{
                      marginTop: 10, padding: "8px 12px", borderRadius: 8,
                      background: "var(--muted)",
                      border: "0.5px solid var(--glass-border-lo)",
                      display: "flex", gap: 16,
                    }}>
                      {derivedBottlePrice != null && (
                        <div>
                          <p style={{ fontSize: 10, color: "var(--muted-foreground)" }}>Per {tradeUnit.toLowerCase()}</p>
                          <p style={{ fontSize: 15, fontWeight: 700, color: "var(--snm-brand-text)" }}>
                            MVR {derivedBottlePrice.toFixed(2)}
                          </p>
                        </div>
                      )}
                      {derivedCartonPrice != null && ctnsN > 0 && (
                        <div>
                          <p style={{ fontSize: 10, color: "var(--muted-foreground)" }}>Per carton ({ctnsN} {tradeUnit.toLowerCase()}s)</p>
                          <p style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)" }}>
                            MVR {derivedCartonPrice.toFixed(2)}
                          </p>
                        </div>
                      )}
                      {/* Per-piece only matters for multi-piece packs. For a single
                          unit (1 bottle = the piece) it's meaningless — hide it. */}
                      {pcsN > 1 && derivedBottlePrice != null && (
                        <div>
                          <p style={{ fontSize: 10, color: "var(--muted-foreground)" }}>Per piece</p>
                          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--muted-foreground)" }}>
                            MVR {(derivedBottlePrice / pcsN).toFixed(4)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {marginPct && !fixedPrice && (
                    <p style={{ fontSize: 11, color: "var(--snm-success)", marginTop: 8 }}>
                      {marginPct}% margin — selling price calculated automatically after each GRN
                    </p>
                  )}

                  {/* Volume-break pricing — collapsed by default */}
                  <div style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingTop: 14, marginTop: 14 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", marginBottom: 2 }}>Volume-Break Prices</p>
                    <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 10 }}>
                      Optional — set a lower price for carton buyers. Overrides the base price above for that unit only.
                    </p>
                    <div className={`grid gap-2.5 ${sellsPack && sellsCarton ? "grid-cols-2" : "grid-cols-1"}`}>
                      {/* Pack price only for products actually sold in packs. */}
                      {sellsPack && (
                        <div className="space-y-1.5">
                          <Label className="ios-subhead">{tradeUnit} price (MVR)</Label>
                          <input type="number" inputMode="decimal" step="0.01" min="0.01"
                            value={fixedPackPrice}
                            onChange={(e) => setFixedPackPrice(e.target.value)}
                            placeholder="e.g. 88.00"
                            style={{ ...inp, width: "100%" }} />
                          {fixedPackPrice && pcsN > 1 && (
                            <p style={{ fontSize: 10, color: "var(--snm-success)" }}>
                              = MVR {(parseFloat(fixedPackPrice) / pcsN).toFixed(4)} / pc
                            </p>
                          )}
                        </div>
                      )}
                      {/* Carton price only for products actually sold in cartons —
                          mirrors the sellsPack gate above; this field previously
                          showed unconditionally even when "Sold in" was Pack-only. */}
                      {sellsCarton && (
                        <div className="space-y-1.5">
                          <Label className="ios-subhead">Carton price (MVR)</Label>
                          <input type="number" inputMode="decimal" step="0.01" min="0.01"
                            value={fixedCartonPrice}
                            onChange={(e) => setFixedCartonPrice(e.target.value)}
                            placeholder="e.g. 320.00"
                            style={{ ...inp, width: "100%" }} />
                          {fixedCartonPrice && pcsPerCarton && pcsN > 1 && (
                            <p style={{ fontSize: 10, color: "var(--snm-success)" }}>
                              = MVR {(parseFloat(fixedCartonPrice) / pcsPerCarton).toFixed(4)} / pc
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    {(fixedPackPrice || fixedCartonPrice) && (
                      <p style={{ fontSize: 11, color: "var(--snm-success)", marginTop: 6 }}>
                        Volume-break active —
                        {fixedPackPrice ? ` ${tradeUnit.toLowerCase()}: MVR ${parseFloat(fixedPackPrice).toFixed(2)}` : ""}
                        {fixedPackPrice && fixedCartonPrice ? " · " : ""}
                        {fixedCartonPrice ? ` carton: MVR ${parseFloat(fixedCartonPrice).toFixed(2)}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Optional details */}
            <button
              type="button"
              onClick={() => setShowOptional(!showOptional)}
              className="flex items-center gap-1.5 ios-subhead font-medium py-1"
              style={{ color: "var(--muted-foreground)", background: "none", border: "none", cursor: "pointer" }}
            >
              <ChevronRight
                className="h-3.5 w-3.5 transition-transform duration-150"
                style={{ transform: showOptional ? "rotate(90deg)" : "rotate(0)" }}
              />
              {showOptional ? "Hide" : "Show"} optional fields
            </button>

            {showOptional && (
              <div className="space-y-1.5">
                <Label className="ios-subhead">Supplier barcode</Label>
                <div className="flex items-center gap-2">
                  <input value={barcode} onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Type or scan" inputMode="numeric"
                    style={{ ...inp, flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    aria-label="Scan supplier barcode"
                    className="snm-pressable shrink-0"
                    style={{ width: 48, height: 48, borderRadius: 14, background: "var(--snm-brand)",
                      display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer" }}
                  >
                    <ScanLine className="h-5 w-5" style={{ color: "var(--snm-brand-on)" }} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-3 shrink-0" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
          <Button variant="ghost" className="h-12 flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="h-12 flex-1 font-semibold"
            onClick={save}
            disabled={saving || !canSave}
            style={{ background: canSave ? "var(--foreground)" : undefined, color: canSave ? "var(--background)" : undefined }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create SKU"}
          </Button>
        </div>
      </DialogContent>

      {/* Camera barcode scanner — fills the Supplier barcode field on a hit. */}
      {showScanner && (
        <BarcodeScanner
          hint="Scan supplier barcode"
          onResult={(code) => { setBarcode(code); setShowScanner(false); haptic("success"); }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Model delete confirm */}
      <ConfirmSheet
        open={confirmDeleteModel !== null}
        onClose={() => setConfirmDeleteModel(null)}
        title="Delete model?"
        message={confirmDeleteModel ? `"${confirmDeleteModel.name}" and all its variants/SKUs will be permanently deleted.` : ""}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmDeleteModel) return;
          try {
            await deleteModel(confirmDeleteModel.id);
            haptic("success");
            setDeletedModelIds((prev) => new Set([...prev, confirmDeleteModel.id]));
            if (modelId === confirmDeleteModel.id) { setModelId(""); setModelInput(""); }
            setConfirmDeleteModel(null);
            toast.success(`${confirmDeleteModel.name} deleted`);
          } catch (e) { haptic("error"); toast.error((e as Error).message); }
        }}
      />
    </Dialog>
  );
}

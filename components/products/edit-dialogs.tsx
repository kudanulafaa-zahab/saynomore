"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { containerLabel, type UnitUom } from "@/lib/trade-units";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { updateSku, renameCataloguePart, adminDeleteBrandCascade, adminDeleteModelCascade, adminDeleteVariantCascade, adminDeleteSku, getPackConfigChangeImpact, type SkuFullRow, type SellUnit, type PackConfigImpact } from "@/lib/queries/products";
import { PackSizeCorrectionSheet } from "./pack-size-correction";

// ── Brand editor ────────────────────────────────────────────────────────

// EditBrandDialog, EditModelDialog and EditVariantDialog were removed on
// 2026-08-10. They were exported and never imported anywhere — 327 lines of
// dead dialogs carrying three of the app's react-hooks warnings, and three
// more places a future edit could have been made in the wrong copy. Brands,
// models and variants are edited through products-explorer's own sheets.

export function EditSkuDialog({
  sku,
  open,
  onOpenChange,
  onSaved,
}: {
  sku: SkuFullRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  // Initialised FROM the sku, not synced to it by an effect.
  //
  // The old shape was `useState("")` plus a `useEffect` that copied every field
  // across whenever `open` or `sku` changed. React 19 flags that (cascading
  // renders), and the real hazard behind the warning is worse than a render
  // cost: between the dialog painting and the effect running there is a frame
  // where a money form is showing the PREVIOUS sku's numbers. On a form that
  // sets selling prices, that is a frame too many.
  //
  // The reset now comes from mounting: products-explorer renders this only
  // while a sku is selected, so opening a different one is a fresh mount with
  // fresh initial state, and closing genuinely discards. Same behaviour, no
  // effect, no stale frame.
  const perPiece = sku?.fixed_selling_price_mvr;
  const initialFixedPrice = perPiece != null
    ? (perPiece * (sku?.pcs_per_pack ?? 1)).toFixed(2) : "";

  // ── The NAMES, which had no editor anywhere in the app until 0205 ────────
  //
  // Ali, 2026-08-24: *"I entered a product name by mistake... How can I correct
  // this and any other future mistakes?"* He could not: the product had stock,
  // so delete was correctly blocked, and nothing in the app renamed anything.
  //
  // They live at the TOP of this dialog on purpose. Everything below is
  // numbers — pack size, dimensions, prices — and a wrong NAME is the mistake
  // he is most likely to be here to fix, because a product is created in a
  // hurry, on a phone, the day he hears about it.
  const [brandName, setBrandName] = useState(sku?.brand_name ?? "");
  const [modelName, setModelName] = useState(sku?.model_name ?? "");
  const [variantName, setVariantName] = useState(sku?.variant_display ?? "");

  const [code, setCode] = useState(sku?.internal_code ?? "");
  const [barcode, setBarcode] = useState(sku?.supplier_barcode ?? "");
  const [pcsPerPack, setPcsPerPack] = useState(sku ? String(sku.pcs_per_pack) : "");
  const [packsPerCarton, setPacksPerCarton] = useState(sku ? String(sku.packs_per_carton) : "");
  const [l, setL] = useState(sku ? String(sku.carton_length_cm) : "");
  const [w, setW] = useState(sku ? String(sku.carton_width_cm) : "");
  const [h, setH] = useState(sku ? String(sku.carton_height_cm) : "");
  const [kg, setKg] = useState(sku?.carton_weight_kg?.toString() ?? "");
  const [marginPct, setMarginPct] = useState(sku?.target_margin_pct?.toString() ?? "");
  const [fixedPrice, setFixedPrice] = useState(initialFixedPrice);
  const [fixedPackPrice, setFixedPackPrice] = useState(sku?.fixed_price_per_pack_mvr?.toString() ?? "");
  const [fixedCartonPrice, setFixedCartonPrice] = useState(sku?.fixed_price_per_carton_mvr?.toString() ?? "");
  const [sellUnits, setSellUnits] = useState<SellUnit[]>(
    sku?.sellable_units?.length ? sku.sellable_units : ["pack", "carton"]);
  const [saving, setSaving] = useState(false);
  // A pack size that has already been received or sold cannot just be saved —
  // the database refuses it, and rightly. When it changes we ask what it would
  // move first, and only then offer the correction. Null means "not asked".
  const [packChange, setPackChange] = useState<PackConfigImpact | null>(null);


  const cbm = useMemo(() => {
    const lv = parseFloat(l), wv = parseFloat(w), hv = parseFloat(h);
    if (!lv || !wv || !hv) return null;
    return (lv * wv * hv) / 1_000_000;
  }, [l, w, h]);

  const landedPerPiece = sku?.landed_per_piece_mvr ?? null;
  const pcs = parseInt(pcsPerPack, 10);
  const packs = parseInt(packsPerCarton, 10);
  const sellsPack = sellUnits.includes("pack");

  // Preview from margin formula
  const marginPreview = useMemo(() => {
    const margin = parseFloat(marginPct);
    if (!landedPerPiece || isNaN(margin) || margin <= 0 || margin >= 100) return null;
    const perPiece = landedPerPiece / (1 - margin / 100);
    return {
      piece: perPiece,
      pack: perPiece * (isNaN(pcs) ? 0 : pcs),
      carton: perPiece * (isNaN(pcs) ? 0 : pcs) * (isNaN(packs) ? 0 : packs),
    };
  }, [marginPct, landedPerPiece, pcs, packs]);

  // Preview from fixed price (fixedPrice is entered in per-pack terms)
  const fixedPreview = useMemo(() => {
    const fpPack = parseFloat(fixedPrice);
    if (isNaN(fpPack) || fpPack <= 0 || isNaN(pcs) || pcs <= 0) return null;
    const fpPiece = fpPack / pcs;
    const actualMargin = landedPerPiece && landedPerPiece > 0
      ? ((1 - landedPerPiece / fpPiece) * 100)
      : null;
    return {
      piece: fpPiece,
      pack: fpPack,
      carton: fpPack * (isNaN(packs) ? 0 : packs),
      actualMargin,
    };
  }, [fixedPrice, landedPerPiece, pcs, packs]);

  // Which pricing method is active?
  const usingFixed = fixedPrice.trim() !== "";

  /** Has stock ever been received against this product?
   *
   *  `landed_per_piece_mvr` comes from its batches, so a value means at least
   *  one receipt exists — which is exactly when 0190 fixes the pack size. It is
   *  a read the row already carries, so this costs no extra query.
   *
   *  Deliberately belt AND braces: this only stops him typing something that
   *  cannot be saved. The database is what actually guarantees it, so if this
   *  ever reads wrong the save still refuses with a message that explains why. */
  const packSizeLocked = sku?.landed_per_piece_mvr != null;

  async function save() {
    if (!sku) return;
    // Friendly bounds checks — otherwise these surface as raw Postgres
    // CHECK-constraint errors in a toast.
    const m = marginPct ? parseFloat(marginPct) : null;
    if (m != null && (isNaN(m) || m <= 0 || m >= 100)) {
      toast.error("Target margin must be between 1% and 99%");
      return;
    }
    if (!(parseInt(pcsPerPack, 10) > 0) || !(parseInt(packsPerCarton, 10) > 0)) {
      toast.error("Pieces per pack and packs per carton must be at least 1");
      return;
    }
    // THE PACK SIZE IS NOT AN ORDINARY FIELD once stock has moved through it.
    // Everything else on this form describes the product; this one is the
    // divisor behind every piece figure in the ledger, so changing it is a
    // restatement and gets its own sheet with the money on it. Asked BEFORE
    // anything is written, so a refusal leaves nothing half-saved.
    const nextPcs = parseInt(pcsPerPack, 10);
    const nextPpc = parseInt(packsPerCarton, 10);
    if (nextPcs !== sku.pcs_per_pack || nextPpc !== sku.packs_per_carton) {
      setSaving(true);
      try {
        setPackChange(await getPackConfigChangeImpact(sku.id, nextPcs, nextPpc));
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      // RENAMES FIRST, and only the ones that actually changed.
      //
      // Before the numbers, because a rename can be REFUSED — a brand name
      // already in use, a blank field — and if that happens he should get the
      // sentence explaining it with nothing else half-saved. Each is skipped
      // when untouched, so the audit log records renames and not every visit to
      // this dialog.
      if (brandName.trim() && brandName.trim() !== sku.brand_name) {
        await renameCataloguePart("brand", sku.brand_id, brandName.trim());
      }
      if (modelName.trim() && modelName.trim() !== sku.model_name) {
        await renameCataloguePart("model", sku.model_id, modelName.trim());
      }
      if (variantName.trim() && variantName.trim() !== sku.variant_display) {
        await renameCataloguePart("variant", sku.variant_id, variantName.trim());
      }

      await updateSku(sku.id, {
        internal_code: code.trim(),
        supplier_barcode: barcode.trim() || null,
        pcs_per_pack: parseInt(pcsPerPack, 10),
        packs_per_carton: parseInt(packsPerCarton, 10),
        carton_length_cm: parseFloat(l),
        carton_width_cm: parseFloat(w),
        carton_height_cm: parseFloat(h),
        carton_weight_kg: kg ? parseFloat(kg) : null,
        sellable_units: sellUnits,
        target_margin_pct: marginPct ? parseFloat(marginPct) : null,
        // fixedPrice is entered per-pack; store per-piece (the DB's common denominator)
        fixed_selling_price_mvr: fixedPrice && pcs > 0 ? parseFloat(fixedPrice) / pcs : null,
        // Don't persist a pack volume-break for a carton-only product.
        fixed_price_per_pack_mvr: sellsPack && fixedPackPrice ? parseFloat(fixedPackPrice) : null,
        fixed_price_per_carton_mvr: fixedCartonPrice ? parseFloat(fixedCartonPrice) : null,
      });
      toast.success("Saved");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Trade unit label — what this product is actually sold as (never "Pc")
  const attrs = sku?.attributes as Record<string, string> | undefined;
  // containerLabel is the one place this mapping lives (and the twin of
  // Postgres unit_noun). This used to keep its own copy, which is how a tub
  // would have been called a "Pack" here while the database called it a tub.
  const singular = containerLabel(sku?.unit_uom as UnitUom | undefined);
  const unit = attrs?.format || (singular.charAt(0).toUpperCase() + singular.slice(1));

  return (
    <>
    {/* Sheet-over-dialog: the correction has its own z above the Dialog, so the
        product being corrected stays visible behind it. It is only ever reached
        by changing the pack size on the form below and pressing Save. */}
    {packChange && sku && (
      <PackSizeCorrectionSheet
        impact={packChange}
        unitUom={sku.unit_uom}
        onClose={() => setPackChange(null)}
        onDone={() => { setPackChange(null); onOpenChange(false); onSaved(); }}
      />
    )}
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">

          {/* ── The NAMES ────────────────────────────────────────────────────
              FIRST, because a mistyped name is the likeliest reason he opened
              this sheet, and until migration 0205 there was no way to fix one
              anywhere in the app — a product with stock could not be deleted
              (correctly) and nothing could rename it.

              Names, not numbers, so no unit word appears here and none is
              needed. The SKU code below is deliberately NOT regenerated: it is
              the permanent reference that ends up on labels and paperwork,
              while the name is the description. */}
          <div className="rounded-xl p-3 space-y-3"
            style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}>
            <p className="text-[12px] uppercase tracking-wider font-semibold" style={{ color: "var(--muted-foreground)" }}>
              Name
            </p>
            <div className="space-y-2">
              <Label>Brand</Label>
              <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Bodyshop" />
              {/* The blast radius, stated rather than discovered. Renaming a
                  brand is one edit that changes many screens. */}
              <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
                Renames it on every product of this brand.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Product</Label>
              <Input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Body Butter" />
              <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
                Renames it on every size of this product.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Size</Label>
              <Input value={variantName} onChange={(e) => setVariantName(e.target.value)} placeholder="200ml" />
            </div>
            <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
              Every past order, batch and stock movement stays attached and starts
              reading the corrected name. The code below does not change — it is
              what is printed on labels.
            </p>
          </div>

          {/* ── Current live prices (read-only summary) ── */}
          {sku?.landed_per_piece_mvr != null && (
            <div className="rounded-xl p-3 space-y-2"
              style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}>
              <p className="text-[12px] uppercase tracking-wider font-semibold" style={{ color: "var(--muted-foreground)" }}>
                Current landed cost
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] font-bold text-foreground">
                  MVR {(Number(sku.landed_per_piece_mvr) * (sku.pcs_per_pack ?? 1)).toFixed(2)}
                </span>
                <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>per {unit.toLowerCase()}</span>
              </div>
              <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>
                MVR {Number(sku.landed_per_piece_mvr).toFixed(4)} /pc
              </p>
              {sku.selling_price_per_piece_mvr != null && (
                <div className="pt-2 border-t" style={{ borderColor: "var(--glass-border-lo)" }}>
                  <p className="text-[12px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: "var(--muted-foreground)" }}>
                    Active selling prices
                    {sku.fixed_selling_price_mvr != null
                      ? <span className="ml-2 px-1.5 py-0.5 rounded ios-subhead" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>FIXED</span>
                      : <span className="ml-2 px-1.5 py-0.5 rounded ios-subhead" style={{ background: "color-mix(in srgb, var(--snm-success) 15%, transparent)", color: "var(--snm-success)" }}>AUTO</span>
                    }
                  </p>
                  <div className="space-y-2 ios-subhead">
                    {/* Primary: pack/bottle (trade unit) */}
                    <div className="flex items-center justify-between rounded-lg px-3 py-2"
                      style={{ background: "color-mix(in srgb, var(--snm-success) 8%, transparent)" }}>
                      <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Per {unit.toLowerCase()}</p>
                      <div className="text-right">
                        <p className="font-bold text-foreground text-[15px]">MVR {Number(sku.selling_price_per_pack_mvr).toFixed(0)}</p>
                        <p className="ios-subhead" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>
                          MVR {Number(sku.selling_price_per_piece_mvr).toFixed(4)} /pc
                        </p>
                      </div>
                    </div>
                    {/* Carton price */}
                    {[
                      { label: "Per carton", value: Number(sku.selling_price_per_carton_mvr).toFixed(0) },
                    ].map((c) => (
                      <div key={c.label} className="text-center">
                        <p className="text-[12px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
                        <p className="font-semibold text-foreground ios-subhead">MVR {c.value}</p>
                      </div>
                    ))}
                  </div>
                  {/* Gated on the margin itself, not on the per-PIECE price
                      column — see the note in products-explorer (0217). */}
                  {sku.actual_margin_pct != null && (
                    <p className="ios-subhead mt-1.5 pt-1.5 border-t" style={{ borderColor: "var(--glass-border-lo)", color: "var(--muted-foreground)" }}>
                      Actual margin on current cost: <strong style={{ color: "var(--snm-success)" }}>{sku.actual_margin_pct}%</strong>
                    </p>
                  )}
                  {sku.fixed_selling_price_mvr == null
                    && sku.fixed_price_per_pack_mvr == null
                    && sku.fixed_price_per_carton_mvr == null
                    && sku.target_margin_pct != null && (
                    <p className="ios-subhead mt-1.5 pt-1.5 border-t" style={{ borderColor: "var(--glass-border-lo)", color: "var(--muted-foreground)" }}>
                      Target margin: {sku.target_margin_pct}% — price updates automatically with each shipment
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Pack config.
              Fixed once stock has been received, because every batch cost and
              every past sale of this product was recorded against the size it
              had at the time. Changing it re-specs all of them silently — one
              product's Product Card was reporting MVR 110.53 a carton of profit
              that was not there, from exactly this. Migration 0190 refuses the
              write; this stops him typing a change that cannot be saved. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Pieces per {unit} *</Label>
              <Input type="number" min="1" value={pcsPerPack} disabled={packSizeLocked}
                onChange={(e) => setPcsPerPack(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Packs per Carton *</Label>
              <Input type="number" min="1" value={packsPerCarton} disabled={packSizeLocked}
                onChange={(e) => setPacksPerCarton(e.target.value)} />
            </div>
          </div>
          {packSizeLocked && (
            /* --foreground at 0.75, not --muted-foreground: this explains why two
               fields stopped working, so it has to be readable on the sheet. */
            <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
              Pack size is fixed — stock has already been received and costed at{" "}
              {sku?.pcs_per_pack} per {unit.toLowerCase()}, {sku?.packs_per_carton} per carton.
              A different pack size is a different product: add it as a new SKU.
            </p>
          )}
          <div className="space-y-2">
            <Label>Carton Dimensions (cm) *</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input type="number" step="0.1" value={l} onChange={(e) => setL(e.target.value)} placeholder="L" />
              <Input type="number" step="0.1" value={w} onChange={(e) => setW(e.target.value)} placeholder="W" />
              <Input type="number" step="0.1" value={h} onChange={(e) => setH(e.target.value)} placeholder="H" />
            </div>
            {cbm !== null && (
              <p className="ios-subhead" style={{ color: "var(--snm-success)" }}>→ {cbm.toFixed(5)} CBM per carton</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Carton Weight (kg)</Label>
              <Input type="number" step="0.01" value={kg} onChange={(e) => setKg(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Supplier Barcode</Label>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Internal Code *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>

          {/* ── Pricing section ── */}
          <div className="border-t border-border pt-4 space-y-4">
            <div>
              <p className="ios-subhead font-semibold text-foreground">Pricing</p>
              <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                Use margin % for auto pricing, or set a fixed price per {unit.toLowerCase()} (overrides margin). All prices shown per {unit.toLowerCase()} — the unit you trade in.
              </p>
            </div>

            {/* Sold in — which tiers this product is offered in */}
            <div className="space-y-2">
              <Label>Sold in</Label>
              <div className="flex gap-2">
                {([
                  // "Single" is the third door, added 2026-08-11 for products
                  // that ARE one item — a Body Shop body butter is a tub, not a
                  // pack of anything. sellable_units has always permitted
                  // 'piece'; nothing ever offered it, which is why a
                  // hand-carried tub could not be set up at all.
                  //
                  // This does NOT weaken the packs-and-cartons rule. That rule
                  // exists because nobody trades diapers loose, and a diaper
                  // SKU still never offers this — its category is measured in
                  // pcs, so the label below reads "Pack" and choosing Single
                  // would be visibly wrong. The rule is about diapers, not
                  // about arithmetic.
                  { key: "piece" as SellUnit, label: `Single ${singular}` },
                  { key: "pack" as SellUnit, label: unit },
                  { key: "carton" as SellUnit, label: "Carton" },
                ]).map((opt) => {
                  const on = sellUnits.includes(opt.key);
                  return (
                    <button key={opt.key} type="button"
                      onClick={() => setSellUnits((prev) => {
                        const has = prev.includes(opt.key);
                        if (has && prev.length === 1) return prev; // never empty
                        return has ? prev.filter((u) => u !== opt.key) : [...prev, opt.key];
                      })}
                      className="flex-1 h-10 rounded-xl ios-subhead font-semibold transition active:scale-95"
                      style={{
                        background: on ? "var(--foreground)" : "transparent",
                        color: on ? "var(--background)" : "var(--muted-foreground)",
                        border: on ? "none" : "0.5px solid var(--glass-border-lo)",
                      }}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                The units customers can buy. Carton-only products hide pack pricing.
                Choose <strong>Single {singular}</strong> for something sold one at a
                time — set pieces per {unit.toLowerCase()} and {unit.toLowerCase()}s per carton to 1.
              </p>
            </div>

            {/* Option A: Target margin */}
            <div className="space-y-2">
              <Label>
                Option A — Target Margin %
                {!usingFixed && marginPct && (
                  <span className="ml-2 ios-subhead font-bold px-1.5 py-0.5 rounded"
                    style={{ background: "color-mix(in srgb, var(--snm-success) 15%, transparent)", color: "var(--snm-success)" }}>
                    ACTIVE
                  </span>
                )}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" inputMode="decimal" step="0.5" min="1" max="99"
                  value={marginPct}
                  onChange={(e) => setMarginPct(e.target.value)}
                  placeholder="e.g. 30"
                  className="max-w-[120px]"
                  disabled={usingFixed}
                />
                <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>%</span>
                {usingFixed && (
                  <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                    (overridden by fixed price below)
                  </span>
                )}
              </div>
              {marginPreview && !usingFixed && (
                <div className="rounded-lg p-2.5 space-y-2"
                  style={{ background: "color-mix(in srgb, var(--snm-success) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
                  {/* Primary: pack/bottle — what trader sees */}
                  <div className="flex items-center justify-between">
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Per {unit.toLowerCase()}</p>
                    <div className="text-right">
                      <p className="text-[16px] font-bold" style={{ color: "var(--snm-success)" }}>MVR {marginPreview.pack.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1.5" style={{ borderTop: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Per carton</p>
                    <p className="ios-subhead font-semibold text-foreground">MVR {marginPreview.carton.toFixed(2)}</p>
                  </div>
                </div>
              )}
              {!marginPreview && !usingFixed && landedPerPiece && marginPct && (
                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                  Enter a valid margin (1–99%) to preview prices.
                </p>
              )}
            </div>

            {/* Option B: Fixed price — entered per trade unit (Pack/Bottle), stored per-piece in DB */}
            <div className="space-y-2">
              <Label>
                Option B — Fixed Price per {unit} (MVR)
                {usingFixed && (
                  <span className="ml-2 ios-subhead font-bold px-1.5 py-0.5 rounded snm-active-pill">
                    ACTIVE
                  </span>
                )}
              </Label>
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                Enter the price you sell one {unit.toLowerCase()} for.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="number" inputMode="decimal" step="0.01" min="0.01"
                  value={fixedPrice}
                  onChange={(e) => setFixedPrice(e.target.value)}
                  placeholder="e.g. 45.00"
                  className="max-w-[140px]"
                />
                <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>MVR / {unit.toLowerCase()}</span>
                {fixedPrice && (
                  <button
                    type="button"
                    onClick={() => setFixedPrice("")}
                    className="ios-subhead underline"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {fixedPreview && (
                <div className="rounded-lg p-2.5 space-y-2"
                  style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}>
                  {/* Primary: pack/bottle */}
                  <div className="flex items-center justify-between">
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Per {unit.toLowerCase()}</p>
                    <div className="text-right">
                      <p className="text-[16px] font-bold" style={{ color: "var(--snm-brand-text)" }}>MVR {fixedPreview.pack.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1.5" style={{ borderTop: "1px solid color-mix(in srgb, var(--snm-brand) 18%, transparent)" }}>
                    <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Per carton</p>
                    <p className="ios-subhead font-semibold text-foreground">MVR {fixedPreview.carton.toFixed(2)}</p>
                  </div>
                  {fixedPreview.actualMargin != null && (
                    <p className="ios-subhead pt-1.5 border-t text-center"
                      style={{ borderColor: "color-mix(in srgb, var(--snm-brand) 20%, transparent)", color: fixedPreview.actualMargin >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                      Margin on current cost: <strong>{fixedPreview.actualMargin.toFixed(1)}%</strong>
                      {fixedPreview.actualMargin < 0 && " — ⚠ below cost!"}
                    </p>
                  )}
                  {/* Tripwire for the classic mistake: typing the CARTON price
                      into this per-pack field shows up as an absurdly high
                      margin a novice won't recognize as wrong. */}
                  {fixedPreview.actualMargin != null && fixedPreview.actualMargin > 85 && (
                    <p className="ios-subhead text-center font-semibold"
                      style={{ color: "var(--snm-warning)" }}>
                      ⚠ This is unusually high vs your cost — did you type the carton price here by mistake? This field is per {unit.toLowerCase()}.
                    </p>
                  )}
                  {!landedPerPiece && (
                    <p className="ios-subhead pt-1 border-t" style={{ borderColor: "color-mix(in srgb, var(--snm-brand) 20%, transparent)", color: "var(--muted-foreground)" }}>
                      Margin % visible after first shipment is confirmed.
                    </p>
                  )}
                </div>
              )}
            </div>

            {!landedPerPiece && !fixedPrice && (
              <p className="ios-subhead" style={{ color: "var(--snm-warning)" }}>
                No stock received yet — margin preview available after first GRN. You can set pricing now.
              </p>
            )}
          </div>

          {/* ── Volume-break pricing ── */}
          <div className="border-t border-border pt-4 space-y-3">
            <div>
              <p className="ios-subhead font-semibold text-foreground">Volume-Break Pricing</p>
              <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                Optional — set a lower price for {sellsPack ? "pack or carton" : "carton"} buyers. Overrides the base price above for that unit only.
              </p>
            </div>
            <div className={`grid gap-3 ${sellsPack ? "grid-cols-2" : "grid-cols-1"}`}>
              {/* Fixed pack price — only for products sold in packs */}
              {sellsPack && (
                <div className="space-y-1.5">
                  <Label className="ios-subhead">Pack price (MVR)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" inputMode="decimal" step="0.01" min="0.01"
                      value={fixedPackPrice}
                      onChange={(e) => setFixedPackPrice(e.target.value)}
                      placeholder={marginPreview ? `Auto: ${marginPreview.pack.toFixed(2)}` : "e.g. 88.00"}
                    />
                  </div>
                  {fixedPackPrice && landedPerPiece && pcs > 0 && (
                    <p className="ios-subhead" style={{ color: "var(--snm-success)" }}>
                      MVR {(parseFloat(fixedPackPrice) / pcs).toFixed(2)}/pc · {(((parseFloat(fixedPackPrice) - landedPerPiece * pcs) / parseFloat(fixedPackPrice)) * 100).toFixed(1)}% margin
                    </p>
                  )}
                </div>
              )}
              {/* Fixed carton price */}
              <div className="space-y-1.5">
                <Label className="ios-subhead">Carton price (MVR)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" inputMode="decimal" step="0.01" min="0.01"
                    value={fixedCartonPrice}
                    onChange={(e) => setFixedCartonPrice(e.target.value)}
                    placeholder={marginPreview && packs > 0 ? `Auto: ${(marginPreview.pack * packs).toFixed(2)}` : "e.g. 320.00"}
                  />
                </div>
                {fixedCartonPrice && landedPerPiece && pcs > 0 && packs > 0 && (
                  <p className="ios-subhead" style={{ color: "var(--snm-success)" }}>
                    MVR {(parseFloat(fixedCartonPrice) / (pcs * packs)).toFixed(2)}/pc · {(((parseFloat(fixedCartonPrice) - landedPerPiece * pcs * packs) / parseFloat(fixedCartonPrice)) * 100).toFixed(1)}% margin
                  </p>
                )}
              </div>
            </div>
            {(fixedPackPrice || fixedCartonPrice) && (
              <div className="rounded-lg px-3 py-2" style={{ background: "color-mix(in srgb, var(--snm-success) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
                <p className="ios-subhead" style={{ color: "var(--snm-success)" }}>
                  Volume-break active — customers buying
                  {fixedPackPrice ? ` packs get MVR ${parseFloat(fixedPackPrice).toFixed(2)}/pack` : ""}
                  {fixedPackPrice && fixedCartonPrice ? " ·" : ""}
                  {fixedCartonPrice ? ` cartons get MVR ${parseFloat(fixedCartonPrice).toFixed(2)}/carton` : ""}
                </p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !code.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ── Cascade-delete confirmation (admin only) ────────────────────────────

export type CascadeTarget =
  | { kind: "brand";   id: string; label: string }
  | { kind: "model";   id: string; label: string }
  | { kind: "variant"; id: string; label: string }
  | { kind: "sku";     id: string; label: string };

export function CascadeDeleteDialog({
  target,
  open,
  onOpenChange,
  onDone,
}: {
  target: CascadeTarget | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  // Cleared by MOUNTING, not by an effect — see EditSkuDialog above.
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);


  if (!target) return null;

  const matches = confirmText.trim().toLowerCase() === target.label.toLowerCase();

  async function go() {
    if (!target) return;
    setBusy(true);
    try {
      if (target.kind === "brand")        await adminDeleteBrandCascade(target.id);
      else if (target.kind === "model")   await adminDeleteModelCascade(target.id);
      else if (target.kind === "variant") await adminDeleteVariantCascade(target.id);
      else if (target.kind === "sku")     await adminDeleteSku(target.id);
      toast.success("Deleted");
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)" }}>
              <AlertTriangle className="h-4 w-4" />
            </div>
            <DialogTitle>Delete {target.kind}</DialogTitle>
          </div>
          <DialogDescription>
            This will permanently delete <strong className="text-foreground">{target.label}</strong> and
            everything beneath it. This action is logged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="ios-subhead">Type the name to confirm:</Label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={target.label}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={go}
            disabled={!matches || busy}
            style={{ background: "var(--snm-error)", color: "var(--background)" }} className="disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Delete ${target.kind}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

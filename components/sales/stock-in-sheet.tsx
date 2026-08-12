"use client";

/**
 * StockInSheet — receive a product without leaving the sale.
 *
 * Ali, 2026-08-12: *"In sales/new sale/add products I cannot see bodybutter
 * maybe because it asks me to choose a godown first. In this case it's not in a
 * godown. So fix it so I can see it in sales and add my landed cost manually and
 * set selling price."*
 *
 * WHY NOT SIMPLY LET HIM SELL IT. Because stock in this app is
 * SUM(stock_movements) (hard rule 2), and that is what makes FIFO, landed cost
 * and every margin figure true. A sale with no stock behind it has no batch to
 * draw from, so it has no cost — the order would post with a zero or null cost
 * and quietly poison the P&L, Margin Watch and the Product Card at once. There
 * is a comment in new-sale-sheet.tsx pointing at SO-2026-076, an order that
 * once reached "delivered" with no stock movement at all. Selling from nothing
 * recreates exactly that.
 *
 * SO THE FRICTION MOVES INSTEAD OF THE RULE. The real defect was never the rule;
 * it was that acting on it meant abandoning the order, navigating to Stock Ops,
 * receiving, and starting the sale again. This sheet does the receipt in place:
 * quantity, the cost he actually paid, and a selling price — then the product is
 * genuinely in stock and the sale continues.
 *
 * THE WAREHOUSE IS NOT ASKED FOR, and that is the answer to "it's not in a
 * godown". Stock has to live somewhere or none of the arithmetic works, but he
 * has already chosen which warehouse this order ships from — asking twice would
 * be a second decision with only one sensible answer.
 *
 * IT IS A REAL RECEIPT. `receive_direct_stock` writes a batch and a stock
 * movement exactly as the Stock Ops screen does; this is a second door to the
 * same room, not a second implementation of receiving.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { receiveDirectStock } from "@/lib/queries/inventory";
import { updateSku, type SkuFullRow } from "@/lib/queries/products";
import { containerLabel, sellableTiers, type UnitUom, type SellUnit } from "@/lib/trade-units";
import { haptic } from "@/lib/haptics";

const INPUT = "w-full h-12 rounded-xl px-4 ios-subhead";
const INPUT_STYLE: React.CSSProperties = {
  background: "var(--glass-bg-1)",
  border: "0.5px solid var(--glass-border-lo)",
  color: "var(--foreground)",
  outline: "none",
};

export function StockInSheet({
  sku, godownId, godownName, onClose, onReceived,
}: {
  sku: SkuFullRow;
  /** The warehouse the order already ships from — not asked again. */
  godownId: string;
  godownName: string;
  onClose: () => void;
  /** Called after stock exists, so the sale can carry straight on. */
  onReceived: () => Promise<void> | void;
}) {
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState(
    sku.fixed_selling_price_mvr != null ? String(sku.fixed_selling_price_mvr)
      : sku.fixed_price_per_pack_mvr != null ? String(sku.fixed_price_per_pack_mvr)
      : "",
  );
  const [saving, setSaving] = useState(false);

  // The unit this product is actually received and sold in, and its NOUN.
  // A body butter is a tub; asking "how many packs" would be wrong in the one
  // place he most needs it to be right.
  const tiers = sellableTiers(sku.sellable_units as SellUnit[] | null);
  const uom: "piece" | "pack" | "carton" =
    tiers.includes("pack") ? "pack" : tiers.includes("carton") ? "carton" : "piece";
  const noun = uom === "piece"
    ? containerLabel(sku.unit_uom as UnitUom | undefined)
    : uom;

  const qtyNum   = Math.max(0, Math.floor(Number(qty) || 0));
  const costNum  = Number(cost);
  const priceNum = Number(price);
  const costOk   = cost.trim() !== "" && !Number.isNaN(costNum) && costNum >= 0;
  const priceOk  = price.trim() !== "" && !Number.isNaN(priceNum) && priceNum > 0;
  const canSave  = qtyNum > 0 && costOk && priceOk && !saving;

  const total = qtyNum > 0 && costOk ? qtyNum * costNum : null;

  // Losing money is a decision, never an accident (hard rule 7). The guard has
  // to live here too: this is a door where a price is set, and a door where a
  // price is set is a door where a loss can be set.
  const belowCost = costOk && priceOk && priceNum < costNum;
  const lossPer = belowCost ? costNum - priceNum : 0;

  const profitPer = costOk && priceOk && !belowCost ? priceNum - costNum : null;
  const marginPct = profitPer != null && priceNum > 0 ? (profitPer / priceNum) * 100 : null;

  async function submit() {
    setSaving(true);
    try {
      await receiveDirectStock({
        sku_id: sku.id, godown_id: godownId,
        qty: qtyNum, uom, unit_cost_mvr: costNum,
        note: "Added during a sale",
      });
      // Price is stored on the field that matches how it is sold, so Price
      // Lists, Margin Watch and the Product Card all read the same figure.
      await updateSku(sku.id, uom === "carton"
        ? { fixed_price_per_carton_mvr: priceNum }
        : uom === "pack"
        ? { fixed_price_per_pack_mvr: priceNum }
        : { fixed_selling_price_mvr: priceNum });
      haptic("success");
      toast.success(`${qtyNum} ${noun}${qtyNum === 1 ? "" : "s"} added — you can sell it now`);
      await onReceived();
      onClose();
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const title = useMemo(
    () => `${sku.model_name}${sku.variant_display ? ` · ${sku.variant_display}` : ""}`,
    [sku],
  );

  return (
    <Sheet open onClose={onClose} variant="auto" maxWidth="max-w-md">
      <div>
        <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          Add stock
        </p>
        <p className="ios-subhead font-semibold mt-0.5" style={{ color: "var(--foreground)" }}>
          {title}
        </p>
        <p className="ios-footnote mt-1" style={{ color: "var(--foreground)", opacity: 0.75 }}>
          It goes into {godownName}, the warehouse this order ships from. No shipment, no freight —
          what you paid is the cost.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="label-caps text-[12px] block" style={{ color: "var(--muted-foreground)" }}>
            How many {noun}s
          </label>
          <input type="number" inputMode="numeric" min="1" value={qty}
            onChange={(e) => setQty(e.target.value)} onFocus={(e) => e.target.select()}
            placeholder="24" className={INPUT} style={INPUT_STYLE} />
        </div>

        <div className="space-y-1.5">
          <label className="label-caps text-[12px] block" style={{ color: "var(--muted-foreground)" }}>
            What one {noun} cost you, MVR
          </label>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={cost}
            onChange={(e) => setCost(e.target.value)} onFocus={(e) => e.target.select()}
            placeholder="175" className={INPUT} style={INPUT_STYLE} />
          {/* Echoed back BEFORE committing: a mistyped unit cost silently
              becomes the cost basis of every future sale from this batch. */}
          {total != null && (
            <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
              = MVR {total.toLocaleString("en-MV", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for all {qtyNum}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="label-caps text-[12px] block" style={{ color: "var(--muted-foreground)" }}>
            Sell one {noun} for, MVR
          </label>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={price}
            onChange={(e) => setPrice(e.target.value)} onFocus={(e) => e.target.select()}
            placeholder="380" className={INPUT} style={INPUT_STYLE} />
          {profitPer != null && (
            <p className="ios-footnote" style={{ color: "var(--snm-success)" }}>
              You keep MVR {profitPer.toLocaleString("en-MV", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per {noun}
              {marginPct != null ? ` · ${marginPct.toFixed(1)}% margin` : ""}
            </p>
          )}
        </div>

        {belowCost && (
          <div className="rounded-xl px-4 py-3"
            style={{ background: "color-mix(in srgb, var(--snm-error) 12%, transparent)" }}>
            <p className="ios-subhead font-semibold" style={{ color: "var(--snm-error)" }}>
              This price loses MVR {lossPer.toLocaleString("en-MV", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on every {noun}
            </p>
            <p className="ios-footnote mt-0.5" style={{ color: "var(--foreground)", opacity: 0.8 }}>
              You are selling below what it cost you. Change the price, or continue if that is deliberate.
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button onClick={onClose} disabled={saving}
          className="flex-1 h-12 rounded-xl ios-subhead font-semibold snm-pressable"
          style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>
          Cancel
        </button>
        <button onClick={submit} disabled={!canSave}
          className="flex-1 h-12 rounded-xl ios-subhead font-semibold snm-pressable flex items-center justify-center gap-2"
          style={{
            background: belowCost ? "var(--snm-error)" : "var(--foreground)",
            color: belowCost ? "var(--snm-on-fill)" : "var(--background)",
            opacity: canSave ? 1 : 0.45,
          }}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {belowCost ? "Add at a loss" : "Add stock"}
        </button>
      </div>
    </Sheet>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Trash2 } from "lucide-react";
import { useCart } from "@/components/cart/cart-provider";
import { useCatalogue } from "@/components/catalogue-provider";
import { ProductImage } from "@/components/catalogue/product-image";
import { formatMvr } from "@/lib/format";
import type { SellUnit } from "@/lib/queries/catalogue";

const UOM_LABEL: Record<SellUnit, string> = { piece: "piece", pack: "pack", carton: "carton" };

function priceFor(row: { selling_price_per_piece_mvr: number | null; selling_price_per_pack_mvr: number | null; selling_price_per_carton_mvr: number | null }, uom: SellUnit) {
  if (uom === "carton") return row.selling_price_per_carton_mvr;
  if (uom === "pack") return row.selling_price_per_pack_mvr;
  return row.selling_price_per_piece_mvr;
}

export default function CartPage() {
  const router = useRouter();
  const { lines, setQty, remove } = useCart();
  const { bySkuId, loading } = useCatalogue();

  const resolved = lines
    .map((line) => {
      const row = bySkuId.get(line.sku_id);
      if (!row) return null;
      const unitPrice = priceFor(row, line.uom);
      return { line, row, unitPrice, total: (unitPrice ?? 0) * line.qty };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const subtotal = resolved.reduce((sum, r) => sum + r.total, 0);
  const outOfStock = resolved.some((r) => !r.row.is_orderable);

  return (
    <main className="min-h-dvh pb-40">
      <div className="sticky top-0 z-30 flex items-center gap-3 px-4 py-3" style={{
        background: "color-mix(in srgb, var(--background) 85%, transparent)",
        backdropFilter: "blur(20px)",
      }}>
        <button onClick={() => router.back()} className="snm-pressable h-9 w-9 flex items-center justify-center rounded-full" style={{ background: "var(--glass-1)" }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="ios-headline font-semibold">Your cart</h1>
      </div>

      {loading && <p className="px-5 py-10 text-center ios-subhead" style={{ color: "var(--muted-foreground)" }}>Loading…</p>}

      {!loading && resolved.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <p className="ios-body" style={{ color: "var(--muted-foreground)" }}>Your cart is empty.</p>
          <Link href="/" className="ios-subhead font-semibold">Start shopping →</Link>
        </div>
      )}

      {!loading && resolved.length > 0 && (
        <div className="px-4 pt-3 space-y-3">
          {resolved.map(({ line, row, unitPrice, total }) => (
            <div key={`${line.sku_id}:${line.uom}`} className="snm-card flex gap-3 p-3">
              <ProductImage
                src={row.image_url}
                alt={row.variant_display}
                categoryName={row.category_name}
                className="h-20 w-20 shrink-0 rounded-lg"
              />
              <div className="flex-1 min-w-0">
                <p className="ios-subhead font-semibold truncate">{row.variant_display}</p>
                <p className="ios-footnote mb-2" style={{ color: "var(--muted-foreground)" }}>
                  {formatMvr(unitPrice)} / {UOM_LABEL[line.uom]}
                </p>
                {!row.is_orderable && (
                  <p className="ios-footnote font-medium mb-2" style={{ color: "var(--snm-warning)" }}>
                    Out of stock — remove to check out
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center rounded-full" style={{ background: "var(--glass-1)" }}>
                    <button
                      onClick={() => setQty(line.sku_id, line.uom, line.qty - 1)}
                      className="snm-pressable h-8 w-8 font-semibold"
                    >
                      −
                    </button>
                    <span className="w-8 text-center ios-footnote font-semibold snm-num">{line.qty}</span>
                    <button
                      onClick={() => setQty(line.sku_id, line.uom, line.qty + 1)}
                      className="snm-pressable h-8 w-8 font-semibold"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="ios-subhead font-semibold snm-num">{formatMvr(total)}</span>
                    <button onClick={() => remove(line.sku_id, line.uom)} aria-label="Remove" className="snm-pressable">
                      <Trash2 className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && resolved.length > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 p-4 space-y-3"
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom), 16px)",
            background: "color-mix(in srgb, var(--background) 90%, transparent)",
            backdropFilter: "blur(20px)",
            borderTop: "0.5px solid var(--glass-border-lo)",
          }}
        >
          <div className="flex items-center justify-between ios-headline font-semibold">
            <span>Subtotal</span>
            <span className="snm-num">{formatMvr(subtotal)}</span>
          </div>
          <button
            onClick={() => router.push("/checkout")}
            disabled={outOfStock}
            className="snm-pressable w-full rounded-xl font-semibold"
            style={{
              background: "var(--foreground)",
              color: "var(--background)",
              opacity: outOfStock ? 0.4 : 1,
              height: "52px",
            }}
          >
            {outOfStock ? "Remove out-of-stock items to continue" : "Checkout"}
          </button>
        </div>
      )}
    </main>
  );
}

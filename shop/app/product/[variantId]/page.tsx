"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useCatalogue } from "@/components/catalogue-provider";
import { useCart } from "@/components/cart/cart-provider";
import { ProductImage } from "@/components/catalogue/product-image";
import { InstallSheet } from "@/components/install/install-sheet";
import { useInstallTrigger } from "@/components/install/use-install-trigger";
import { formatMvr } from "@/lib/format";
import { resolveImage } from "@/lib/brand-copy";
import type { SellUnit } from "@/lib/queries/catalogue";

const UOM_LABEL: Record<SellUnit, string> = { piece: "Piece", pack: "Pack", carton: "Carton" };

export default function ProductPage({ params }: { params: Promise<{ variantId: string }> }) {
  const { variantId } = use(params);
  const { rows, loading } = useCatalogue();
  const { add } = useCart();
  const router = useRouter();
  const installTrigger = useInstallTrigger("cart");

  const variantRows = rows.filter((r) => r.variant_id === variantId);
  const [skuIndex, setSkuIndex] = useState(0);
  const row = variantRows[skuIndex];
  const [uom, setUom] = useState<SellUnit | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (loading) {
    return <main className="min-h-dvh flex items-center justify-center">Loading…</main>;
  }
  if (!row) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="ios-body">We couldn&apos;t find that product.</p>
        <Link href="/" className="ios-subhead font-semibold">← Back to shop</Link>
      </main>
    );
  }

  const activeUom = uom ?? row.sellable_units[0];
  const unitPrice =
    activeUom === "carton" ? row.selling_price_per_carton_mvr
    : activeUom === "pack" ? row.selling_price_per_pack_mvr
    : row.selling_price_per_piece_mvr;

  function handleAdd() {
    add(row.sku_id, activeUom, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
    installTrigger.fire();
  }

  return (
    <main className="min-h-dvh pb-32">
      <div className="sticky top-0 z-30 flex items-center px-4 py-3" style={{
        background: "color-mix(in srgb, var(--background) 85%, transparent)",
        backdropFilter: "blur(20px)",
      }}>
        <button onClick={() => router.back()} className="snm-pressable h-9 w-9 flex items-center justify-center rounded-full" style={{ background: "var(--glass-1)" }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>

      <ProductImage
        src={resolveImage(row)}
        alt={row.variant_display}
        categoryName={row.category_name}
        className="w-full aspect-square"
        sizes="100vw"
      />

      <div className="px-5 pt-5 space-y-5">
        <div>
          <p className="ios-footnote font-semibold uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
            {row.brand_name} · {row.model_name}
          </p>
          <h1 className="ios-title2 font-bold mt-0.5">{row.variant_display}</h1>
          {row.sellable_units.includes("pack") && (
            <p className="ios-footnote mt-1" style={{ color: "var(--muted-foreground)" }}>
              {row.pcs_per_pack} pcs/pack
            </p>
          )}
          {row.category_name === "Liquid Detergent" && (
            <p className="ios-footnote mt-1" style={{ color: "var(--muted-foreground)" }}>
              1 carton = {row.pcs_per_carton} bottles
            </p>
          )}
        </div>

        {!row.is_orderable && (
          <p className="ios-subhead font-medium" style={{ color: "var(--snm-warning)" }}>
            Currently out of stock — check back soon.
          </p>
        )}

        {variantRows.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {variantRows.map((r, i) => (
              <button
                key={r.sku_id}
                onClick={() => { setSkuIndex(i); setUom(null); }}
                className="ios-footnote font-semibold px-3 py-1.5 rounded-full snm-pressable"
                style={{
                  background: i === skuIndex ? "var(--foreground)" : "var(--glass-1)",
                  color: i === skuIndex ? "var(--background)" : "var(--foreground)",
                }}
              >
                {r.pcs_per_pack}pc pack
              </button>
            ))}
          </div>
        )}

        {row.sellable_units.length > 1 && (
          <div className="flex gap-2">
            {row.sellable_units.map((u) => (
              <button
                key={u}
                onClick={() => setUom(u)}
                className="ios-subhead font-semibold px-4 py-2 rounded-full snm-pressable"
                style={{
                  background: activeUom === u ? "var(--foreground)" : "var(--glass-1)",
                  color: activeUom === u ? "var(--background)" : "var(--foreground)",
                }}
              >
                {UOM_LABEL[u]}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-baseline gap-2">
          <span className="ios-title1 font-bold snm-num">{formatMvr(unitPrice)}</span>
          <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
            / {UOM_LABEL[activeUom].toLowerCase()}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center rounded-full" style={{ background: "var(--glass-1)" }}>
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="snm-pressable h-11 w-11 ios-title3 font-semibold"
            >
              −
            </button>
            <span className="w-10 text-center ios-headline font-semibold snm-num">{qty}</span>
            <button
              onClick={() => setQty((q) => q + 1)}
              className="snm-pressable h-11 w-11 ios-title3 font-semibold"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 p-4"
        style={{
          paddingBottom: "max(env(safe-area-inset-bottom), 16px)",
          background: "color-mix(in srgb, var(--background) 90%, transparent)",
          backdropFilter: "blur(20px)",
          borderTop: "0.5px solid var(--glass-border-lo)",
        }}
      >
        <button
          onClick={handleAdd}
          disabled={!row.is_orderable || unitPrice == null}
          className="snm-pressable w-full h-13 rounded-xl font-semibold flex items-center justify-center"
          style={{
            background: "var(--foreground)",
            color: "var(--background)",
            opacity: !row.is_orderable || unitPrice == null ? 0.4 : 1,
            height: "52px",
          }}
        >
          {added ? "Added ✓" : `Add to cart — ${formatMvr((unitPrice ?? 0) * qty)}`}
        </button>
      </div>

      <InstallSheet open={installTrigger.open} onClose={installTrigger.close} />
    </main>
  );
}

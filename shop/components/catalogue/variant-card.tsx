import Link from "next/link";
import { ProductImage } from "@/components/catalogue/product-image";
import { fromPrice, type CatalogueRow } from "@/lib/queries/catalogue";
import { formatMvr } from "@/lib/format";

export function VariantCard({ row }: { row: CatalogueRow }) {
  const price = fromPrice(row);

  return (
    <Link
      href={`/product/${row.variant_id}`}
      className="snm-card snm-pressable flex flex-col overflow-hidden"
    >
      <ProductImage
        src={row.image_url}
        alt={row.variant_display}
        categoryName={row.category_name}
        className="aspect-square w-full"
      />
      <div className="p-3">
        <p className="ios-subhead font-semibold truncate">{row.variant_display}</p>
        {row.sellable_units.includes("pack") && (
          <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
            {row.pcs_per_pack} pcs/pack
          </p>
        )}
        {row.category_name === "Liquid Detergent" && (
          <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
            1 carton = {row.pcs_per_carton} bottles
          </p>
        )}
        {row.is_orderable ? (
          <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
            from {formatMvr(price)}
          </p>
        ) : (
          <p className="ios-footnote font-medium" style={{ color: "var(--snm-warning)" }}>
            Out of stock
          </p>
        )}
      </div>
    </Link>
  );
}

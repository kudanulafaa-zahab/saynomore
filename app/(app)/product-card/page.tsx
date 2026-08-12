import { Suspense } from "react";
import { ProductCardView } from "@/components/products/product-card-view";

export default function Page() {
  return (
    <div className="max-w-2xl mx-auto">
      {/* Suspense because the view reads ?sku= with useSearchParams. */}
      <Suspense fallback={null}>
        <ProductCardView />
      </Suspense>
    </div>
  );
}

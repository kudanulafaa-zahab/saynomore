"use client";

import { useState, useEffect } from "react";
import { useCatalogue } from "@/components/catalogue-provider";
import { ShopHeader } from "@/components/shop-header";
import { VariantCard } from "@/components/catalogue/variant-card";
import { BRAND_COPY } from "@/lib/brand-copy";

export default function HomePage() {
  const { categories, loading, error } = useCatalogue();
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCategoryId && categories.length > 0) {
      setActiveCategoryId(categories[0].category_id);
    }
  }, [categories, activeCategoryId]);

  const activeCategory = categories.find((c) => c.category_id === activeCategoryId) ?? categories[0];

  return (
    <main className="min-h-dvh">
      <ShopHeader />

      <div className="px-5 pt-5 pb-2">
        <h1 className="ios-large-title font-bold">Diapers &amp; detergent,</h1>
        <p className="ios-large-title font-bold" style={{ color: "var(--muted-foreground)" }}>
          delivered.
        </p>
      </div>

      {loading && (
        <p className="px-5 py-10 text-center ios-subhead" style={{ color: "var(--muted-foreground)" }}>
          Loading the shop…
        </p>
      )}
      {error && (
        <p className="px-5 py-10 text-center ios-subhead" style={{ color: "var(--snm-error)" }}>
          Couldn&apos;t load the catalogue — pull to refresh.
        </p>
      )}

      {!loading && !error && categories.length > 0 && (
        <>
          <div className="flex gap-2 px-5 py-3 overflow-x-auto">
            {categories.map((c) => (
              <button
                key={c.category_id}
                onClick={() => setActiveCategoryId(c.category_id)}
                className="snm-pressable shrink-0 ios-subhead font-semibold px-4 py-2 rounded-full"
                style={{
                  background: c.category_id === activeCategory?.category_id ? "var(--foreground)" : "var(--glass-1)",
                  color: c.category_id === activeCategory?.category_id ? "var(--background)" : "var(--foreground)",
                }}
              >
                {c.category_name}
              </button>
            ))}
          </div>

          <div className="px-5 pb-16 space-y-10">
            {activeCategory?.brands.map((brand) => (
              <section key={brand.brand_id}>
                <h2 className="ios-title2 font-bold">{brand.brand_name}</h2>
                {BRAND_COPY[brand.brand_name] && (
                  <p className="ios-subhead mt-1 mb-4" style={{ color: "var(--muted-foreground)" }}>
                    {BRAND_COPY[brand.brand_name]}
                  </p>
                )}
                <div className="space-y-6">
                  {brand.models.map((model) => (
                    <div key={model.model_id}>
                      {brand.models.length > 1 && (
                        <h3 className="ios-headline font-semibold mb-2">{model.model_name}</h3>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {model.variants.map((row) => (
                          <VariantCard key={row.sku_id} row={row} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

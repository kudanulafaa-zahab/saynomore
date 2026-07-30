"use client";

import { useState, useEffect } from "react";
import { useCatalogue } from "@/components/catalogue-provider";
import { ShopHeader } from "@/components/shop-header";
import { VariantCard } from "@/components/catalogue/variant-card";
import { BRAND_COPY } from "@/lib/brand-copy";
import { groupSeasonal, type BrandGroup, type CategoryGroup } from "@/lib/queries/catalogue";

const SEASONAL_TAB_ID = "__seasonal__";

// Display-only renames for the storefront — the underlying category name in
// Products/get_storefront_catalogue() stays what staff already know it as.
const CATEGORY_DISPLAY_NAME: Record<string, string> = {
  "Liquid Detergent": "Washing Detergent",
};

export default function HomePage() {
  const { rows, categories, loading, error } = useCatalogue();
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const seasonalBrands = groupSeasonal(rows);

  // Diapers first, then the synthesized Seasonal tab (if there's anything in
  // it), then every other real category in its normal sort order.
  const tabs: { id: string; label: string }[] = [];
  const diapers = categories.find((c) => c.category_name === "Diapers");
  const restCategories = categories.filter((c) => c.category_name !== "Diapers");
  if (diapers) tabs.push({ id: diapers.category_id, label: diapers.category_name });
  if (seasonalBrands.length > 0) tabs.push({ id: SEASONAL_TAB_ID, label: "Seasonal" });
  for (const c of restCategories) {
    tabs.push({ id: c.category_id, label: CATEGORY_DISPLAY_NAME[c.category_name] ?? c.category_name });
  }

  useEffect(() => {
    if (!activeTabId && tabs.length > 0) {
      setActiveTabId(tabs[0].id);
    }
  }, [tabs, activeTabId]);

  const activeCategory: CategoryGroup | undefined = categories.find((c) => c.category_id === activeTabId);
  const isSeasonalActive = activeTabId === SEASONAL_TAB_ID;
  const activeBrands: BrandGroup[] = isSeasonalActive ? seasonalBrands : (activeCategory?.brands ?? []);

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

      {!loading && !error && tabs.length > 0 && (
        <>
          <div className="flex gap-2 px-5 py-3 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTabId(t.id)}
                className="snm-pressable shrink-0 ios-subhead font-semibold px-4 py-2 rounded-full"
                style={{
                  background: t.id === activeTabId ? "var(--foreground)" : "var(--glass-1)",
                  color: t.id === activeTabId ? "var(--background)" : "var(--foreground)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="px-5 pb-16 space-y-10">
            {activeBrands.map((brand) => (
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

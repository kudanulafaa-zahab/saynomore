"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getCatalogue, groupCatalogue, type CatalogueRow, type CategoryGroup } from "@/lib/queries/catalogue";

interface CatalogueContextValue {
  rows: CatalogueRow[];
  bySkuId: Map<string, CatalogueRow>;
  categories: CategoryGroup[];
  loading: boolean;
  error: string | null;
}

const CatalogueContext = createContext<CatalogueContextValue>({
  rows: [],
  bySkuId: new Map(),
  categories: [],
  loading: true,
  error: null,
});

export function CatalogueProvider({ children }: { children: React.ReactNode }) {
  const [rows, setRows] = useState<CatalogueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCatalogue()
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const bySkuId = new Map(rows.map((r) => [r.sku_id, r]));
  const categories = groupCatalogue(rows);

  return (
    <CatalogueContext.Provider value={{ rows, bySkuId, categories, loading, error }}>
      {children}
    </CatalogueContext.Provider>
  );
}

export function useCatalogue() {
  return useContext(CatalogueContext);
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { listSkusFlat, toggleSkuActive, type SkuFullRow } from "@/lib/queries/products";

export function ProductsList() {
  const [rows, setRows] = useState<SkuFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await listSkusFlat();
      setRows(data);
    } catch (err) {
      toast.error("Failed to load: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.brand_name, r.model_name, r.variant_display, r.internal_code, r.supplier_barcode ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [rows, q]);

  if (loading) {
    return (
      <div className="snm-card p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search brand, model, variant, code…"
          className="pl-9 h-11"
          inputMode="search"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="snm-card p-10 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? "No products yet — add some from the Tree tab." : "No matches."}
        </div>
      ) : (
        <div className="snm-card overflow-hidden">
          {/* Desktop header */}
          <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground border-b bg-secondary/30" style={{ borderColor: "var(--glass-border-lo)" }}>
            <div className="col-span-3">Brand · Model</div>
            <div className="col-span-3">Variant</div>
            <div className="col-span-2">Pack × Carton</div>
            <div className="col-span-2">CBM</div>
            <div className="col-span-1">Code</div>
            <div className="col-span-1 text-right">State</div>
          </div>
          {filtered.map((r) => (
            <div
              key={r.id}
              className="last:border-0 hover:bg-accent/30 transition"
              style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}
            >
              {/* Mobile card layout */}
              <div className="md:hidden px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{r.brand_name}</p>
                  <p className="text-xs text-muted-foreground">{r.model_name} · {r.variant_display}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] text-muted-foreground">
                      {r.pcs_per_pack}/pk × {r.packs_per_carton}/ctn
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">{r.internal_code}</span>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    try { await toggleSkuActive(r.id, !r.is_active); load(); }
                    catch (e) { toast.error((e as Error).message); }
                  }}
                  className={`snm-pressable text-[10px] uppercase tracking-wider rounded-lg px-3 shrink-0 ${
                    r.is_active ? "snm-active-pill" : "bg-muted text-muted-foreground"
                  }`}
                  style={{ minHeight: 44, display: "flex", alignItems: "center" }}
                >
                  {r.is_active ? "Active" : "Off"}
                </button>
              </div>
              {/* Desktop row layout */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-3 text-sm">
                <div className="col-span-3">
                  <p className="text-foreground">{r.brand_name}</p>
                  <p className="text-xs text-muted-foreground">{r.model_name} · {r.category_name}</p>
                </div>
                <div className="col-span-3 text-foreground">{r.variant_display}</div>
                <div className="col-span-2 text-muted-foreground">
                  {r.pcs_per_pack}/pk × {r.packs_per_carton}/ctn
                  <span className="block text-[11px]">= {r.pcs_per_carton} pcs/ctn</span>
                </div>
                <div className="col-span-2 text-muted-foreground">{Number(r.cbm_per_carton).toFixed(4)}</div>
                <div className="col-span-1 text-xs font-mono text-muted-foreground truncate" title={r.internal_code}>{r.internal_code}</div>
                <div className="col-span-1 text-right">
                  <button
                    onClick={async () => {
                      try { await toggleSkuActive(r.id, !r.is_active); load(); }
                      catch (e) { toast.error((e as Error).message); }
                    }}
                    className={`snm-pressable text-[10px] uppercase tracking-wider rounded-lg px-2 py-1 ${
                      r.is_active ? "snm-active-pill" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.is_active ? "On" : "Off"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

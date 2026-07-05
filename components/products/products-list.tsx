"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/layout/page-skeleton";
import { listSkusFlat, toggleSkuActive, getCurrentUserRole, type SkuFullRow } from "@/lib/queries/products";

export function ProductsList() {
  const [rows, setRows] = useState<SkuFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    getCurrentUserRole().then((r) => setCanWrite(r !== "viewer")).catch(() => {});
  }, []);

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
    return <SkeletonRows rows={8} />;
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
        <div className="snm-card p-10 text-center ios-subhead text-muted-foreground">
          {rows.length === 0 ? "No products yet — add some from the Tree tab." : "No matches."}
        </div>
      ) : (
        <div className="snm-card overflow-hidden">
          {/* Desktop header */}
          <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 text-[12px] uppercase tracking-widest text-muted-foreground border-b bg-secondary/30" style={{ borderColor: "var(--glass-border-lo)" }}>
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
                  <p className="ios-subhead font-medium text-foreground">{r.brand_name}</p>
                  <p className="ios-subhead text-muted-foreground">{r.model_name} · {r.variant_display}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="snm-num ios-subhead text-muted-foreground">
                      {r.pcs_per_pack}/pk × {r.packs_per_carton}/ctn
                    </span>
                    <span className="snm-num ios-subhead font-mono text-muted-foreground">{r.internal_code}</span>
                  </div>
                </div>
                {canWrite ? (
                  <button
                    onClick={async () => {
                      try { await toggleSkuActive(r.id, !r.is_active); load(); }
                      catch (e) { toast.error((e as Error).message); }
                    }}
                    className={`snm-pressable text-[12px] uppercase tracking-wider rounded-lg px-3 shrink-0 ${
                      r.is_active ? "snm-active-pill" : "bg-muted text-muted-foreground"
                    }`}
                    style={{ minHeight: 44, display: "flex", alignItems: "center" }}
                  >
                    {r.is_active ? "Active" : "Off"}
                  </button>
                ) : (
                  <span
                    className={`text-[12px] uppercase tracking-wider rounded-lg px-3 shrink-0 ${
                      r.is_active ? "snm-active-pill" : "bg-muted text-muted-foreground"
                    }`}
                    style={{ minHeight: 44, display: "flex", alignItems: "center" }}
                  >
                    {r.is_active ? "Active" : "Off"}
                  </span>
                )}
              </div>
              {/* Desktop row layout */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-3 ios-subhead">
                <div className="col-span-3">
                  <p className="text-foreground">{r.brand_name}</p>
                  <p className="ios-subhead text-muted-foreground">{r.model_name} · {r.category_name}</p>
                </div>
                <div className="col-span-3 text-foreground">{r.variant_display}</div>
                <div className="col-span-2 text-muted-foreground">
                  {r.pcs_per_pack}/pk × {r.packs_per_carton}/ctn
                  <span className="block ios-subhead">= {r.pcs_per_carton} pcs/ctn</span>
                </div>
                <div className="col-span-2 text-muted-foreground">{Number(r.cbm_per_carton).toFixed(4)}</div>
                <div className="col-span-1 ios-subhead font-mono text-muted-foreground truncate" title={r.internal_code}>{r.internal_code}</div>
                <div className="col-span-1 text-right">
                  {canWrite ? (
                    <button
                      onClick={async () => {
                        try { await toggleSkuActive(r.id, !r.is_active); load(); }
                        catch (e) { toast.error((e as Error).message); }
                      }}
                      className={`snm-pressable text-[12px] uppercase tracking-wider rounded-lg px-2 py-1 inline-flex items-center justify-center ${
                        r.is_active ? "snm-active-pill" : "bg-muted text-muted-foreground"
                      }`}
                      style={{ minHeight: 44 }}
                    >
                      {r.is_active ? "On" : "Off"}
                    </button>
                  ) : (
                    <span
                      className={`inline-block text-[12px] uppercase tracking-wider rounded-lg px-2 py-1 ${
                        r.is_active ? "snm-active-pill" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {r.is_active ? "On" : "Off"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

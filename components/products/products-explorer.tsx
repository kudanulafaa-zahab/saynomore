"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus, Trash2, Loader2, Search, X, ChevronRight,
  Package, Check, SlidersHorizontal, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import {
  listCategories, listBrands, listModels, listVariants, listSkusFlat,
  createBrand, createModel, createVariant, createSku, createCategory,
  toggleSkuActive, getCurrentUserRole,
  type CategoryRow, type BrandRow, type ModelRow, type VariantRow,
  type SkuFullRow, type AttrKey, type UnitUom, type CostBasis,
} from "@/lib/queries/products";
import {
  EditSkuDialog, CascadeDeleteDialog, type CascadeTarget,
} from "./edit-dialogs";

/* ── Attr metadata ── */

interface AttrSpec {
  key: AttrKey; label: string; placeholder?: string;
  type: "text" | "number"; options?: string[]; suffix?: string;
}

const ATTR_SPECS: Record<AttrKey, AttrSpec> = {
  size:      { key: "size",      label: "Size",    placeholder: "NB, S, M…",   type: "text" },
  scent:     { key: "scent",     label: "Scent",   placeholder: "Mint…",       type: "text" },
  format:    { key: "format",    label: "Format",  type: "text",
               options: ["Bottle","Pouch","Sachet","Jar","Box","Tube","Pack","Can"] },
  volume_ml: { key: "volume_ml", label: "Volume",  placeholder: "1500",        type: "number", suffix: "ml" },
  weight_g:  { key: "weight_g",  label: "Weight",  placeholder: "250",         type: "number", suffix: "g"  },
  colour:    { key: "colour",    label: "Colour",  placeholder: "Pink…",       type: "text" },
  other:     { key: "other",     label: "Other",   placeholder: "Optional",    type: "text" },
};

function attrsToDisplay(attrs: Record<string, string | number>, schema: AttrKey[]): string {
  return schema.map((k) => {
    const v = attrs[k];
    if (v === undefined || v === "") return "";
    const spec = ATTR_SPECS[k];
    return spec?.suffix ? `${v}${spec.suffix}` : String(v);
  }).filter(Boolean).join(" ");
}

/* ── Helpers ── */

function fmtPrice(n: number | null | undefined) {
  if (n == null) return null;
  return Number(n).toFixed(2);
}

/* ── SKU detail panel ── */

function SkuPanel({
  sku, isAdmin, onEdit, onDelete, onToggle, onClose,
}: {
  sku: SkuFullRow;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onClose: () => void;
}) {
  const pcsPerCtn = sku.pcs_per_pack * sku.packs_per_carton;

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "var(--glass-2)", backdropFilter: "blur(30px)", WebkitBackdropFilter: "blur(30px)" }}
    >
      {/* Header */}
      <div
        className="flex items-start justify-between px-5 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--glass-border)" }}
      >
        <div className="min-w-0 flex-1 pr-3">
          <p className="label-caps text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>
            {sku.brand_name} · {sku.category_name}
          </p>
          <p className="text-[17px] font-semibold text-foreground leading-snug">
            {sku.model_name}
            {sku.variant_display
              ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {sku.variant_display}</span>
              : null}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{sku.internal_code}</p>
        </div>
        <button
          onClick={onClose}
          className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition"
          style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Pack config */}
        <div>
          <p className="label-caps text-[10px] mb-2.5" style={{ color: "var(--muted-foreground)" }}>Pack Configuration</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Pcs / Pack",   value: String(sku.pcs_per_pack) },
              { label: "Packs / Ctn",  value: String(sku.packs_per_carton) },
              { label: "Pcs / Carton", value: String(pcsPerCtn) },
            ].map((c) => (
              <div key={c.label} className="rounded-xl p-3 text-center"
                style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)" }}>
                <p className="label-caps text-[9px] mb-1" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
                <p className="text-[15px] font-bold text-foreground">{c.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Selling prices */}
        <div>
          <p className="label-caps text-[10px] mb-2.5" style={{ color: "var(--muted-foreground)" }}>Selling Price</p>
          {sku.selling_price_per_piece_mvr != null ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Per Piece",  value: `MVR ${fmtPrice(sku.selling_price_per_piece_mvr)}` },
                  { label: "Per Pack",   value: `MVR ${fmtPrice(sku.selling_price_per_pack_mvr)}` },
                  { label: "Per Carton", value: `MVR ${fmtPrice(sku.selling_price_per_carton_mvr)}` },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl p-3 text-center"
                    style={{ background: "color-mix(in srgb, var(--snm-success) 8%, transparent)",
                             border: "1px solid color-mix(in srgb, var(--snm-success) 20%, transparent)" }}>
                    <p className="label-caps text-[9px] mb-1" style={{ color: "var(--muted-foreground)" }}>{c.label}</p>
                    <p className="text-[13px] font-semibold text-foreground">{c.value}</p>
                  </div>
                ))}
              </div>
              {sku.target_margin_pct != null && (
                <p className="text-[11px] mt-2 text-center" style={{ color: "var(--muted-foreground)" }}>
                  Target margin: {sku.target_margin_pct}%
                </p>
              )}
            </>
          ) : sku.target_margin_pct != null ? (
            <div className="rounded-xl px-4 py-3"
              style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)",
                       border: "1px solid color-mix(in srgb, var(--snm-warning) 20%, transparent)" }}>
              <p className="text-[12px]" style={{ color: "var(--snm-warning)" }}>
                {sku.target_margin_pct}% margin set — price available after first GRN
              </p>
            </div>
          ) : (
            <button
              onClick={onEdit}
              className="w-full rounded-xl px-4 py-3 text-left transition active:scale-[0.98]"
              style={{ background: "color-mix(in srgb, var(--snm-brand) 8%, transparent)",
                       border: "1px dashed color-mix(in srgb, var(--snm-brand) 35%, transparent)" }}
            >
              <p className="text-[12px] font-semibold" style={{ color: "var(--snm-brand)" }}>
                + Set margin &amp; pricing
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                Tap to open Edit SKU and enter your target margin %
              </p>
            </button>
          )}
        </div>

        {/* Carton dimensions */}
        <div>
          <p className="label-caps text-[10px] mb-2.5" style={{ color: "var(--muted-foreground)" }}>Carton Dimensions</p>
          <div className="rounded-xl px-4 py-3 space-y-1.5"
            style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
            <div className="flex justify-between text-[12px]">
              <span style={{ color: "var(--muted-foreground)" }}>L × W × H</span>
              <span className="text-foreground font-medium">
                {sku.carton_length_cm} × {sku.carton_width_cm} × {sku.carton_height_cm} cm
              </span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span style={{ color: "var(--muted-foreground)" }}>CBM</span>
              <span className="text-foreground font-medium">{Number(sku.cbm_per_carton).toFixed(5)}</span>
            </div>
            {sku.carton_weight_kg && (
              <div className="flex justify-between text-[12px]">
                <span style={{ color: "var(--muted-foreground)" }}>Weight</span>
                <span className="text-foreground font-medium">{sku.carton_weight_kg} kg</span>
              </div>
            )}
          </div>
        </div>

        {/* Meta */}
        <div>
          <p className="label-caps text-[10px] mb-2.5" style={{ color: "var(--muted-foreground)" }}>Details</p>
          <div className="rounded-xl px-4 py-3 space-y-1.5"
            style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
            <div className="flex justify-between text-[12px]">
              <span style={{ color: "var(--muted-foreground)" }}>Category</span>
              <span className="text-foreground">{sku.category_name}</span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span style={{ color: "var(--muted-foreground)" }}>UoM</span>
              <span className="text-foreground">{sku.unit_uom}</span>
            </div>
            {sku.supplier_barcode && (
              <div className="flex justify-between text-[12px]">
                <span style={{ color: "var(--muted-foreground)" }}>Barcode</span>
                <span className="text-foreground font-mono">{sku.supplier_barcode}</span>
              </div>
            )}
            <div className="flex justify-between text-[12px]">
              <span style={{ color: "var(--muted-foreground)" }}>Status</span>
              <span style={{ color: sku.is_active ? "var(--snm-success)" : "var(--muted-foreground)" }}>
                {sku.is_active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div
        className="shrink-0 px-5 py-4 flex gap-2"
        style={{ borderTop: "1px solid var(--glass-border)" }}
      >
        <button
          onClick={onToggle}
          className="flex-1 h-10 rounded-xl text-[13px] font-medium transition"
          style={{
            background: sku.is_active
              ? "color-mix(in srgb, var(--snm-error) 10%, transparent)"
              : "color-mix(in srgb, var(--snm-success) 10%, transparent)",
            color: sku.is_active ? "var(--snm-error)" : "var(--snm-success)",
          }}
        >
          {sku.is_active ? "Deactivate" : "Activate"}
        </button>
        <button
          onClick={onEdit}
          className="flex-1 h-10 rounded-xl text-[13px] font-semibold transition flex items-center justify-center gap-1.5"
          style={{ background: "var(--snm-brand)", color: "#ffffff" }}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit SKU
        </button>
        {isAdmin && (
          <button
            onClick={onDelete}
            className="h-10 w-10 rounded-xl flex items-center justify-center transition shrink-0"
            style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)" }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── SKU row in the flat list ── */

function SkuRow({
  sku, selected, onClick,
}: { sku: SkuFullRow; selected: boolean; onClick: () => void }) {
  const pcsPerCtn = sku.pcs_per_pack * sku.packs_per_carton;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-4 text-left transition"
      style={{
        background: selected
          ? "color-mix(in srgb, var(--snm-brand) 8%, var(--glass-1))"
          : "transparent",
        borderLeft: selected ? "2px solid var(--snm-brand)" : "2px solid transparent",
      }}
    >
      {/* Status dot */}
      <div
        className="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5"
        style={{ background: sku.is_active ? "var(--snm-success)" : "var(--muted-foreground)", opacity: sku.is_active ? 1 : 0.4 }}
      />

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-foreground truncate">
          {sku.model_name}
          {sku.variant_display
            ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {sku.variant_display}</span>
            : null}
        </p>
        <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--muted-foreground)" }}>
          {sku.pcs_per_pack}/pack × {sku.packs_per_carton}/ctn · {pcsPerCtn}/ctn
        </p>
      </div>

      {/* Price */}
      <div className="text-right shrink-0">
        {sku.selling_price_per_carton_mvr != null ? (
          <>
            <p className="text-[13px] font-semibold text-foreground">
              MVR {fmtPrice(sku.selling_price_per_carton_mvr)}
            </p>
            <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>per ctn</p>
          </>
        ) : (
          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>no price</p>
        )}
      </div>

      <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
    </button>
  );
}

/* ── Main explorer ── */

export function ProductsExplorer() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [brands, setBrands]         = useState<BrandRow[]>([]);
  const [models, setModels]         = useState<ModelRow[]>([]);
  const [variants, setVariants]     = useState<VariantRow[]>([]);
  const [skus, setSkus]             = useState<SkuFullRow[]>([]);
  const [loading, setLoading]       = useState(true);

  const [q, setQ]                       = useState("");
  const [filterBrand, setFilterBrand]   = useState<string>("all");
  const [selectedSku, setSelectedSku]   = useState<SkuFullRow | null>(null);
  const [showFilters, setShowFilters]   = useState(false);

  // Dialogs
  const [newSkuOpen, setNewSkuOpen]     = useState(false);
  const [editSku, setEditSku]           = useState<SkuFullRow | null>(null);
  const [cascadeTarget, setCascadeTarget] = useState<CascadeTarget | null>(null);

  const [role, setRole] = useState<"admin" | "manager" | "staff" | null>(null);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => setRole(null)); }, []);
  const isAdmin = role === "admin";

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, b, m, v, s] = await Promise.all([
        listCategories(), listBrands(), listModels(), listVariants(), listSkusFlat(),
      ]);
      setCategories(c); setBrands(b); setModels(m); setVariants(v); setSkus(s);
    } catch (err) {
      toast.error("Failed to load: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Keep selectedSku in sync after reload
  useEffect(() => {
    if (selectedSku) {
      const fresh = skus.find((s) => s.id === selectedSku.id);
      if (fresh) setSelectedSku(fresh);
    }
  }, [skus]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return skus.filter((s) => {
      if (filterBrand !== "all" && s.brand_id !== filterBrand) return false;
      if (!term) return true;
      return [s.brand_name, s.model_name, s.variant_display ?? "", s.internal_code]
        .join(" ").toLowerCase().includes(term);
    });
  }, [skus, q, filterBrand]);

  // Group flat list by brand for display
  const grouped = useMemo(() => {
    const map = new Map<string, { brand: string; skus: SkuFullRow[] }>();
    for (const s of filtered) {
      const entry = map.get(s.brand_id) ?? { brand: s.brand_name, skus: [] };
      entry.skus.push(s);
      map.set(s.brand_id, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.brand.localeCompare(b.brand));
  }, [filtered]);

  const activeCount = skus.filter((s) => s.is_active).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  const listPanel = (
    <div
      className="flex flex-col h-full rounded-2xl overflow-hidden"
      style={{
        background: "var(--glass-1)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid var(--glass-border)",
      }}
    >
      {/* Toolbar */}
      <div className="px-4 pt-4 pb-3 space-y-3 shrink-0" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[15px] font-semibold text-foreground">
              {brands.length} brand{brands.length !== 1 ? "s" : ""}
              <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {activeCount} active SKUs</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="h-10 w-10 rounded-xl flex items-center justify-center transition active:scale-90"
              style={{
                background: showFilters ? "var(--snm-brand-muted)" : "var(--secondary)",
                color: showFilters ? "var(--snm-brand)" : "var(--muted-foreground)",
              }}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            <button
              onClick={() => setNewSkuOpen(true)}
              className="h-10 px-4 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 transition active:scale-95"
              style={{ background: "var(--snm-brand)", color: "#ffffff" }}
            >
              <Plus className="h-4 w-4" />
              New SKU
            </button>
          </div>
        </div>

        {/* Search */}
        <div
          className="flex items-center gap-2 px-3 rounded-xl h-11"
          style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "1px solid var(--glass-border)" }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search SKUs…"
            className="flex-1 bg-transparent border-none outline-none text-[13px] text-foreground placeholder:text-muted-foreground"
          />
          {q && (
            <button onClick={() => setQ("")}>
              <X className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)" }} />
            </button>
          )}
        </div>

        {/* Brand filter */}
        {showFilters && (
          <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
            {[{ id: "all", name: "All brands" }, ...brands].map((b) => (
              <button
                key={b.id}
                onClick={() => setFilterBrand(b.id)}
                className="shrink-0 h-7 px-3 rounded-full text-[11px] font-medium transition whitespace-nowrap"
                style={{
                  background: filterBrand === b.id ? "var(--snm-brand)" : "var(--secondary)",
                  color: filterBrand === b.id ? "#ffffff" : "var(--muted-foreground)",
                }}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* SKU list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <Package className="h-8 w-8 mb-3 opacity-20" style={{ color: "var(--muted-foreground)" }} />
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {skus.length === 0
                ? "No SKUs yet — tap \"New SKU\" to add your first product."
                : "No results."}
            </p>
          </div>
        ) : (
          grouped.map(({ brand, skus: brandSkus }) => (
            <div key={brand}>
              {/* Brand divider */}
              <div
                className="px-4 py-2 sticky top-0"
                style={{
                  background: "color-mix(in srgb, var(--glass-1) 95%, transparent)",
                  backdropFilter: "blur(8px)",
                  borderBottom: "1px solid var(--glass-border)",
                }}
              >
                <p className="label-caps text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  {brand} · {brandSkus.length} SKU{brandSkus.length !== 1 ? "s" : ""}
                </p>
              </div>
              {brandSkus.map((sku) => (
                <SkuRow
                  key={sku.id}
                  sku={sku}
                  selected={selectedSku?.id === sku.id}
                  onClick={() => setSelectedSku(selectedSku?.id === sku.id ? null : sku)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="pb-28 lg:pb-10">
      {/* Desktop: side-by-side. Mobile: stack (panel slides over) */}
      <div className="hidden lg:grid lg:grid-cols-[1fr_380px] gap-4" style={{ height: "calc(100vh - 100px)" }}>
        {listPanel}
        {selectedSku ? (
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--glass-border)" }}>
            <SkuPanel
              sku={selectedSku}
              isAdmin={isAdmin}
              onEdit={() => setEditSku(selectedSku)}
              onDelete={() => setCascadeTarget({ kind: "sku", id: selectedSku.id, label: selectedSku.internal_code })}
              onToggle={async () => {
                try { await toggleSkuActive(selectedSku.id, !selectedSku.is_active); await loadAll(); }
                catch (e) { toast.error((e as Error).message); }
              }}
              onClose={() => setSelectedSku(null)}
            />
          </div>
        ) : (
          <div
            className="rounded-2xl flex flex-col items-center justify-center text-center px-8"
            style={{
              background: "var(--glass-1)",
              backdropFilter: "blur(20px)",
              border: "1px solid var(--glass-border)",
            }}
          >
            <ChevronRight className="h-8 w-8 mb-3 opacity-15" style={{ color: "var(--muted-foreground)" }} />
            <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              Select a SKU to view details
            </p>
          </div>
        )}
      </div>

      {/* Mobile: list only, panel as bottom sheet */}
      <div className="lg:hidden">
        <div style={{ height: "calc(100vh - 140px)" }}>
          {listPanel}
        </div>

        {/* Mobile slide-up panel */}
        {selectedSku && (
          <>
            <div
              className="fixed inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
              onClick={() => setSelectedSku(null)}
            />
            <div
              className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl overflow-hidden"
              style={{ height: "80vh", border: "1px solid var(--glass-border)" }}
            >
              <SkuPanel
                sku={selectedSku}
                isAdmin={isAdmin}
                onEdit={() => setEditSku(selectedSku)}
                onDelete={() => setCascadeTarget({ kind: "sku", id: selectedSku.id, label: selectedSku.internal_code })}
                onToggle={async () => {
                  try { await toggleSkuActive(selectedSku.id, !selectedSku.is_active); await loadAll(); }
                  catch (e) { toast.error((e as Error).message); }
                }}
                onClose={() => setSelectedSku(null)}
              />
            </div>
          </>
        )}
      </div>

      {/* New SKU wizard dialog */}
      <NewSkuWizard
        open={newSkuOpen}
        onOpenChange={setNewSkuOpen}
        brands={brands}
        categories={categories}
        models={models}
        variants={variants}
        existingSkus={skus}
        onSaved={loadAll}
      />

      {/* Edit SKU dialog */}
      <EditSkuDialog
        sku={editSku}
        open={!!editSku}
        onOpenChange={(o) => !o && setEditSku(null)}
        onSaved={async () => { await loadAll(); }}
      />

      {/* Cascade delete */}
      <CascadeDeleteDialog
        target={cascadeTarget}
        open={!!cascadeTarget}
        onOpenChange={(o) => !o && setCascadeTarget(null)}
        onDone={async () => { setSelectedSku(null); await loadAll(); }}
      />
    </div>
  );
}

/* ── New SKU form — single card, everything inline ── */

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-widest pt-1" style={{ color: "var(--muted-foreground)", opacity: 0.55 }}>
      {children}
    </p>
  );
}

/* ── Combobox: type to search, shows "Create X" when no match ── */
function Combobox({
  value, onChange, options, placeholder, createLabel, onCreateClick, disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
  placeholder: string;
  createLabel?: string;
  onCreateClick?: () => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);
  const filtered = q.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
    : options;
  const showCreate = onCreateClick && q.trim().length > 0 && !options.some(
    (o) => o.label.toLowerCase() === q.trim().toLowerCase()
  );

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        onClick={() => { if (!disabled) { setOpen(!open); setQ(""); } }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 44, padding: "0 12px", borderRadius: 10, cursor: disabled ? "default" : "pointer",
          background: disabled ? "color-mix(in srgb, var(--foreground) 3%, transparent)" : "color-mix(in srgb, var(--foreground) 6%, transparent)",
          border: "1px solid var(--glass-border-lo)",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ fontSize: 14, color: selected ? "var(--foreground)" : "var(--muted-foreground)" }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-foreground)", transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
          border: "1px solid var(--glass-border)", borderRadius: 12, overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}>
          <div style={{ padding: "8px 8px 4px" }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--glass-border-lo)",
                background: "color-mix(in srgb, var(--foreground) 5%, transparent)",
                color: "var(--foreground)", fontSize: 13, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            {filtered.map((o) => (
              <button
                key={o.id}
                onClick={() => { onChange(o.id); setOpen(false); setQ(""); }}
                style={{
                  width: "100%", textAlign: "left", padding: "10px 14px", background: "transparent",
                  border: "none", cursor: "pointer", fontSize: 13,
                  color: o.id === value ? "var(--snm-brand)" : "var(--foreground)",
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                {o.id === value && <Check className="h-3.5 w-3.5" style={{ color: "var(--snm-brand)", flexShrink: 0 }} />}
                {o.label}
              </button>
            ))}
            {filtered.length === 0 && !showCreate && (
              <p style={{ padding: "10px 14px", fontSize: 13, color: "var(--muted-foreground)" }}>No results</p>
            )}
          </div>
          {showCreate && onCreateClick && (
            <button
              onClick={() => { onCreateClick(); setOpen(false); setQ(""); }}
              style={{
                width: "100%", textAlign: "left", padding: "10px 14px",
                borderTop: "1px solid var(--glass-border-lo)",
                background: "color-mix(in srgb, var(--snm-brand) 8%, transparent)",
                border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                color: "var(--snm-brand)",
              }}
            >
              + Create &ldquo;{q.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ATTR_SPECS_WIZARD: Record<string, { label: string; placeholder?: string; type: "text" | "number"; options?: string[]; suffix?: string }> = {
  size:      { label: "Size",    placeholder: "NB / S / M / L / XL / XXL", type: "text" },
  scent:     { label: "Scent",   placeholder: "e.g. Mint",                  type: "text" },
  format:    { label: "Format",  type: "text",
               options: ["Bottle","Pouch","Sachet","Jar","Box","Tube","Pack","Can"] },
  volume_ml: { label: "Volume",  placeholder: "e.g. 700",  type: "number", suffix: "ml" },
  weight_g:  { label: "Weight",  placeholder: "e.g. 250",  type: "number", suffix: "g"  },
  colour:    { label: "Colour",  placeholder: "e.g. Pink", type: "text" },
  other:     { label: "Other",   placeholder: "Optional",  type: "text" },
};

function attrsToDisplayName(attrs: Record<string, string>, schema: AttrKey[]): string {
  return schema.map((k) => {
    const v = attrs[k];
    if (!v || !v.trim()) return "";
    const spec = ATTR_SPECS_WIZARD[k];
    return spec?.suffix ? `${v.trim()}${spec.suffix}` : v.trim();
  }).filter(Boolean).join(" ");
}

function NewSkuWizard({
  open, onOpenChange, brands, categories, models, variants, existingSkus, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brands: BrandRow[];
  categories: CategoryRow[];
  models: ModelRow[];
  variants: VariantRow[];
  existingSkus: SkuFullRow[];
  onSaved: () => void;
}) {
  // ── Identity fields (typed inline, not selected from a list first)
  const [brandInput,  setBrandInput]  = useState("");   // typed name or selected name
  const [brandId,     setBrandId]     = useState("");   // resolved id after match/create
  const [modelInput,  setModelInput]  = useState("");
  const [modelId,     setModelId]     = useState("");
  const [categoryId,  setCategoryId]  = useState("");
  const [variantAttrs, setVariantAttrs] = useState<Record<string, string>>({});

  // ── Pack config
  const [pcsPerPack,  setPcsPerPack]  = useState("");
  const [packsPerCtn, setPacksPerCtn] = useState("");
  const [lenCm, setLenCm] = useState("");
  const [widCm, setWidCm] = useState("");
  const [htCm,  setHtCm]  = useState("");
  const [wgtKg, setWgtKg] = useState("");
  const [code,    setCode]    = useState("");
  const [barcode, setBarcode] = useState("");
  const [marginPct, setMarginPct] = useState("");
  const [saving,  setSaving]  = useState(false);
  const [showOptional, setShowOptional] = useState(false);

  // ── Local items created during this session (so combos show them instantly)
  const [localBrands, setLocalBrands] = useState<BrandRow[]>([]);
  const [localModels, setLocalModels] = useState<ModelRow[]>([]);

  const allBrands = useMemo(() => {
    const ids = new Set(brands.map((b) => b.id));
    return [...brands, ...localBrands.filter((b) => !ids.has(b.id))];
  }, [brands, localBrands]);

  const allModels = useMemo(() => {
    const ids = new Set(models.map((m) => m.id));
    return [...models, ...localModels.filter((m) => !ids.has(m.id))];
  }, [models, localModels]);

  // Derived
  const brandModels  = allModels.filter((m) => m.brand_id === brandId);
  const category     = categories.find((c) => c.id === categoryId);
  const schema: AttrKey[] = (category?.variant_attributes ?? []) as AttrKey[];

  const pcsPerCarton = useMemo(() => {
    const p = parseInt(pcsPerPack), c = parseInt(packsPerCtn);
    return p > 0 && c > 0 ? p * c : null;
  }, [pcsPerPack, packsPerCtn]);

  const cbm = useMemo(() => {
    const l = parseFloat(lenCm), w = parseFloat(widCm), h = parseFloat(htCm);
    return l > 0 && w > 0 && h > 0 ? (l * w * h) / 1_000_000 : null;
  }, [lenCm, widCm, htCm]);

  // Auto-fill dims from a sibling SKU when model is chosen
  useEffect(() => {
    if (!modelId) return;
    const sib = existingSkus.find((s) => s.model_id === modelId);
    if (sib && !lenCm && !widCm && !htCm) {
      setLenCm(String(sib.carton_length_cm));
      setWidCm(String(sib.carton_width_cm));
      setHtCm(String(sib.carton_height_cm));
      if (sib.carton_weight_kg) setWgtKg(String(sib.carton_weight_kg));
    }
  }, [modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate internal code
  useEffect(() => {
    const b = brandInput.replace(/\s/g, "").toUpperCase().slice(0, 4);
    const m = modelInput.replace(/\s/g, "").toUpperCase().slice(0, 4);
    const v = attrsToDisplayName(variantAttrs, schema).replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
    const p = pcsPerPack && packsPerCtn ? `${pcsPerPack}x${packsPerCtn}` : "";
    if (b || m) setCode([b, m, v, p].filter(Boolean).join("-"));
  }, [brandInput, modelInput, variantAttrs, pcsPerPack, packsPerCtn]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setBrandInput(""); setBrandId("");
    setModelInput(""); setModelId(""); setCategoryId("");
    setVariantAttrs({});
    setPcsPerPack(""); setPacksPerCtn("");
    setLenCm(""); setWidCm(""); setHtCm(""); setWgtKg("");
    setCode(""); setBarcode(""); setMarginPct("");
    setShowOptional(false);
    setLocalBrands([]); setLocalModels([]);
  }

  useEffect(() => { if (open) reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resolve brand: find existing or create new
  async function resolveBrand(name: string): Promise<string> {
    const existing = allBrands.find((b) => b.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing.id;
    const b = await createBrand(name.trim());
    setLocalBrands((prev) => [...prev, b]);
    return b.id;
  }

  // ── Resolve model: find existing for this brand+name, or create new
  async function resolveModel(name: string, bId: string, catId: string): Promise<string> {
    const existing = allModels.find(
      (m) => m.brand_id === bId && m.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (existing) return existing.id;
    const m = await createModel({ brand_id: bId, category_id: catId, name: name.trim() });
    setLocalModels((prev) => [...prev, m]);
    return m.id;
  }

  // ── Save: creates everything needed in sequence, then the SKU
  async function save() {
    if (!brandInput.trim() || !modelInput.trim() || !categoryId || !pcsPerPack || !packsPerCtn || !lenCm || !widCm || !htCm || !code.trim()) {
      toast.error("Fill all required fields.");
      return;
    }
    const variantDisplay = attrsToDisplayName(variantAttrs, schema) || modelInput.trim();
    setSaving(true);
    try {
      const bId = await resolveBrand(brandInput);
      const mId = await resolveModel(modelInput, bId, categoryId);

      // Resolve variant: find or create
      const existingVariant = variants.find(
        (v) => v.model_id === mId && v.display_name.toLowerCase() === variantDisplay.toLowerCase()
      );
      const cleanedAttrs: Record<string, string | number> = {};
      for (const k of schema) {
        const val = variantAttrs[k];
        if (val && val.trim()) {
          cleanedAttrs[k] = ATTR_SPECS_WIZARD[k]?.type === "number" ? Number(val) : val.trim();
        }
      }
      const vId = existingVariant
        ? existingVariant.id
        : (await createVariant({ model_id: mId, attributes: cleanedAttrs, display_name: variantDisplay })).id;

      await createSku({
        variant_id: vId,
        internal_code: code.trim(),
        supplier_barcode: barcode.trim() || null,
        pcs_per_pack: parseInt(pcsPerPack),
        packs_per_carton: parseInt(packsPerCtn),
        carton_length_cm: parseFloat(lenCm),
        carton_width_cm: parseFloat(widCm),
        carton_height_cm: parseFloat(htCm),
        carton_weight_kg: wgtKg ? parseFloat(wgtKg) : null,
        target_margin_pct: marginPct ? parseFloat(marginPct) : null,
      });

      toast.success("SKU created");
      onOpenChange(false);
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  const hasVariantFields = schema.length > 0;
  const variantFilled = !hasVariantFields || schema.some((k) => variantAttrs[k]?.trim());
  const canSave = !!brandInput.trim() && !!modelInput.trim() && !!categoryId &&
    variantFilled && !!pcsPerPack && !!packsPerCtn && !!lenCm && !!widCm && !!htCm && !!code.trim();

  const inp: React.CSSProperties = {
    width: "100%", height: 44, padding: "0 12px", borderRadius: 10,
    background: "color-mix(in srgb, var(--foreground) 6%, transparent)",
    border: "1px solid var(--glass-border-lo)", color: "var(--foreground)",
    fontSize: 14, outline: "none", boxSizing: "border-box",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="bg-popover border-border max-w-lg p-0 gap-0 overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 shrink-0" style={{ borderBottom: "1px solid var(--glass-border)" }}>
          <DialogTitle className="text-[17px] font-semibold">New SKU</DialogTitle>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Type to search or create — everything in one card
          </p>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-5 py-4 space-y-5" style={{ maxHeight: "calc(100dvh - 200px)" }}>

          {/* ── Row 1: Brand + Category ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Brand *</Label>
              <Combobox
                value={brandId}
                onChange={(id) => {
                  setBrandId(id);
                  const name = allBrands.find((b) => b.id === id)?.name ?? "";
                  setBrandInput(name);
                  setModelInput(""); setModelId("");
                }}
                options={allBrands.map((b) => ({ id: b.id, label: b.name }))}
                placeholder="Search or type new…"
                onCreateClick={() => {/* handled via typed input below */}}
              />
              {/* Typed input shown when not yet matched to an id */}
              {!brandId && (
                <input
                  value={brandInput}
                  onChange={(e) => { setBrandInput(e.target.value); setBrandId(""); }}
                  placeholder="Type brand name…"
                  style={inp}
                />
              )}
              {!brandId && brandInput.trim() && (
                <p className="text-[11px]" style={{ color: "var(--snm-brand)" }}>
                  Will create &ldquo;{brandInput.trim()}&rdquo; as a new brand
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">Category *</Label>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setCategoryId(c.id); setVariantAttrs({}); }}
                    style={{
                      padding: "5px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                      border: "1px solid",
                      background: categoryId === c.id ? "var(--snm-brand)" : "transparent",
                      borderColor: categoryId === c.id ? "var(--snm-brand)" : "var(--glass-border)",
                      color: categoryId === c.id ? "#fff" : "var(--muted-foreground)",
                      cursor: "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Row 2: Model ── */}
          <div className="space-y-1.5">
            <Label className="text-[13px]">Model name *</Label>
            <Combobox
              value={modelId}
              onChange={(id) => {
                setModelId(id);
                const name = brandModels.find((m) => m.id === id)?.name ?? "";
                setModelInput(name);
                // auto-select category from existing model
                const m = allModels.find((x) => x.id === id);
                if (m && !categoryId) setCategoryId(m.category_id);
              }}
              options={brandModels.map((m) => ({ id: m.id, label: m.name }))}
              placeholder={brandInput ? `Search models under ${brandInput}…` : "Select brand first"}
              disabled={!brandInput.trim()}
            />
            <input
              value={modelInput}
              onChange={(e) => { setModelInput(e.target.value); setModelId(""); }}
              placeholder="e.g. Mamypoko Diaper Pants"
              style={{ ...inp, marginTop: 6 }}
            />
            {!modelId && modelInput.trim() && (
              <p className="text-[11px]" style={{ color: "var(--snm-brand)" }}>
                Will create &ldquo;{modelInput.trim()}&rdquo; as a new model
              </p>
            )}
          </div>

          {/* ── Row 3: Variant attributes (category-driven) ── */}
          {categoryId && hasVariantFields && (
            <div className="space-y-2">
              <Label className="text-[13px]">
                {category?.name === "Diapers" ? "Size *" : "Variant *"}
                <span className="font-normal ml-1" style={{ color: "var(--muted-foreground)" }}>
                  — {schema.join(", ")}
                </span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {schema.map((key) => {
                  const spec = ATTR_SPECS_WIZARD[key];
                  if (spec?.options) {
                    return (
                      <div key={key} className="flex flex-wrap gap-1">
                        {spec.options.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setVariantAttrs({ ...variantAttrs, [key]: opt })}
                            style={{
                              padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                              border: "1px solid",
                              background: variantAttrs[key] === opt ? "var(--snm-brand)" : "transparent",
                              borderColor: variantAttrs[key] === opt ? "var(--snm-brand)" : "var(--glass-border)",
                              color: variantAttrs[key] === opt ? "#fff" : "var(--muted-foreground)",
                              cursor: "pointer",
                            }}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    );
                  }
                  return (
                    <div key={key} className="space-y-1">
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                        {spec?.label}{spec?.suffix ? ` (${spec.suffix})` : ""}
                      </p>
                      <input
                        type={spec?.type === "number" ? "number" : "text"}
                        value={variantAttrs[key] ?? ""}
                        onChange={(e) => setVariantAttrs({ ...variantAttrs, [key]: e.target.value })}
                        placeholder={spec?.placeholder ?? ""}
                        style={inp}
                      />
                    </div>
                  );
                })}
              </div>
              {variantFilled && (
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  Variant: <strong style={{ color: "var(--foreground)" }}>{attrsToDisplayName(variantAttrs, schema) || "—"}</strong>
                </p>
              )}
            </div>
          )}

          {/* ── Divider ── */}
          <div style={{ borderTop: "1px solid var(--glass-border-lo)" }} />

          {/* ── Pack config ── */}
          <div className="space-y-3">
            <SectionHead>Pack Configuration</SectionHead>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Pcs per Pack *</Label>
                <input type="number" inputMode="numeric" min="1"
                  value={pcsPerPack} onChange={(e) => setPcsPerPack(e.target.value)}
                  placeholder="e.g. 34" style={inp} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Packs per Carton *</Label>
                <input type="number" inputMode="numeric" min="1"
                  value={packsPerCtn} onChange={(e) => setPacksPerCtn(e.target.value)}
                  placeholder="e.g. 4" style={inp} />
              </div>
            </div>

            {pcsPerCarton && (
              <div className="rounded-xl px-3 py-2" style={{ background: "color-mix(in srgb, var(--snm-success) 10%, transparent)" }}>
                <p className="text-[12px] font-medium" style={{ color: "var(--snm-success)" }}>
                  {pcsPerCarton} pcs per carton total
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[13px]">Carton dimensions (cm) *</Label>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" inputMode="decimal" step="0.1"
                  value={lenCm} onChange={(e) => setLenCm(e.target.value)}
                  placeholder="L" style={inp} />
                <input type="number" inputMode="decimal" step="0.1"
                  value={widCm} onChange={(e) => setWidCm(e.target.value)}
                  placeholder="W" style={inp} />
                <input type="number" inputMode="decimal" step="0.1"
                  value={htCm} onChange={(e) => setHtCm(e.target.value)}
                  placeholder="H" style={inp} />
              </div>
              {cbm !== null && (
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  {cbm.toFixed(5)} CBM per carton
                </p>
              )}
            </div>

            {/* Internal code */}
            <div className="space-y-1.5">
              <Label className="text-[13px]">Internal code *</Label>
              <input className="font-mono"
                value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="Auto-generated" style={{ ...inp, fontSize: 13 }} />
            </div>

            {/* Margin — optional but shown by default */}
            <div className="space-y-1.5">
              <Label className="text-[13px]">
                Target margin %
                <span className="font-normal ml-1" style={{ color: "var(--muted-foreground)", fontSize: 11 }}>optional — can set later</span>
              </Label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="number" inputMode="decimal" step="0.5" min="1" max="99"
                  value={marginPct} onChange={(e) => setMarginPct(e.target.value)}
                  placeholder="e.g. 30" style={{ ...inp, width: 120 }} />
                <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>%</span>
              </div>
            </div>

            {/* Optional details */}
            <button
              type="button"
              onClick={() => setShowOptional(!showOptional)}
              className="flex items-center gap-1.5 text-[12px] font-medium py-1"
              style={{ color: "var(--muted-foreground)", background: "none", border: "none", cursor: "pointer" }}
            >
              <ChevronRight
                className="h-3.5 w-3.5 transition-transform duration-150"
                style={{ transform: showOptional ? "rotate(90deg)" : "rotate(0)" }}
              />
              {showOptional ? "Hide" : "Show"} optional fields
            </button>

            {showOptional && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Weight (kg)</Label>
                  <input type="number" inputMode="decimal" step="0.01"
                    value={wgtKg} onChange={(e) => setWgtKg(e.target.value)}
                    placeholder="Optional" style={inp} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Supplier barcode</Label>
                  <input value={barcode} onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Optional" style={inp} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex gap-3 shrink-0" style={{ borderTop: "1px solid var(--glass-border)" }}>
          <Button variant="ghost" className="h-12 flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="h-12 flex-1 font-semibold"
            onClick={save}
            disabled={saving || !canSave}
            style={{ background: canSave ? "var(--snm-brand)" : undefined, color: canSave ? "#ffffff" : undefined }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create SKU"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

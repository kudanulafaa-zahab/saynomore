"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

/* ── New SKU form — single scrollable sheet, no wizard steps ── */

function unitLabel(attrs: Record<string, string> | undefined): string {
  const fmt = attrs?.format;
  if (!fmt) return "Pc";
  return fmt; // Bottle, Pouch, Sachet, Jar, Box, Tube, Pack, Can → used verbatim
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-widest pt-1" style={{ color: "var(--muted-foreground)", opacity: 0.55 }}>
      {children}
    </p>
  );
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
  const [brandId, setBrandId]         = useState("");
  const [modelId, setModelId]         = useState("");
  const [variantId, setVariantId]     = useState("");
  const [pcsPerPack, setPcsPerPack]   = useState("");
  const [packsPerCtn, setPacksPerCtn] = useState("");
  const [lenCm, setLenCm]             = useState("");
  const [widCm, setWidCm]             = useState("");
  const [htCm, setHtCm]               = useState("");
  const [wgtKg, setWgtKg]             = useState("");
  const [code, setCode]               = useState("");
  const [barcode, setBarcode]         = useState("");
  const [saving, setSaving]           = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Inline creation state
  const [newBrandName, setNewBrandName]         = useState("");
  const [showNewBrand, setShowNewBrand]         = useState(false);
  const [newModelName, setNewModelName]         = useState("");
  const [newModelCat, setNewModelCat]           = useState("");
  const [showNewModel, setShowNewModel]         = useState(false);
  const [newVariantAttrs, setNewVariantAttrs]   = useState<Record<string, string>>({});
  const [showNewVariant, setShowNewVariant]     = useState(false);
  const [inlineLoading, setInlineLoading]       = useState(false);

  // Local pending items — merged into dropdown lists so newly created entries
  // display correctly before the parent reload completes
  const [localBrands,   setLocalBrands]   = useState<BrandRow[]>([]);
  const [localModels,   setLocalModels]   = useState<ModelRow[]>([]);
  const [localVariants, setLocalVariants] = useState<VariantRow[]>([]);

  const allBrands   = useMemo(() => {
    const ids = new Set(brands.map((b) => b.id));
    return [...brands, ...localBrands.filter((b) => !ids.has(b.id))];
  }, [brands, localBrands]);

  const allModels   = useMemo(() => {
    const ids = new Set(models.map((m) => m.id));
    return [...models, ...localModels.filter((m) => !ids.has(m.id))];
  }, [models, localModels]);

  const allVariants = useMemo(() => {
    const ids = new Set(variants.map((v) => v.id));
    return [...variants, ...localVariants.filter((v) => !ids.has(v.id))];
  }, [variants, localVariants]);

  const brandModels   = allModels.filter((m) => m.brand_id === brandId);
  const modelVariants = allVariants.filter((v) => v.model_id === modelId);
  const model         = models.find((m) => m.id === modelId);
  const brand         = brands.find((b) => b.id === brandId);
  const variant       = variants.find((v) => v.id === variantId);
  const category      = categories.find((c) => c.id === model?.category_id);
  const schema: AttrKey[] = (category?.variant_attributes ?? []) as AttrKey[];

  // Derive unit label from the variant's format attribute
  const unit = unitLabel(variant ? (variant.attributes as Record<string, string>) : undefined);

  const pcsPerCarton = useMemo(() => {
    const p = parseInt(pcsPerPack), c = parseInt(packsPerCtn);
    return p > 0 && c > 0 ? p * c : null;
  }, [pcsPerPack, packsPerCtn]);

  const cbm = useMemo(() => {
    const l = parseFloat(lenCm), w = parseFloat(widCm), h = parseFloat(htCm);
    return l > 0 && w > 0 && h > 0 ? (l * w * h) / 1_000_000 : null;
  }, [lenCm, widCm, htCm]);

  // Auto-fill dimensions from sibling SKU on same variant
  useEffect(() => {
    if (!variantId) return;
    const sib = existingSkus.find((s) => s.variant_id === variantId);
    if (sib && !lenCm && !widCm && !htCm) {
      setLenCm(String(sib.carton_length_cm));
      setWidCm(String(sib.carton_width_cm));
      setHtCm(String(sib.carton_height_cm));
      if (sib.carton_weight_kg) setWgtKg(String(sib.carton_weight_kg));
    }
  }, [variantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate internal code
  useEffect(() => {
    if (!brand || !model || !variant) return;
    const b = brand.name.replace(/\s/g, "").toUpperCase().slice(0, 4);
    const m = model.name.replace(/\s/g, "").toUpperCase().slice(0, 4);
    const v = variant.display_name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
    const p = pcsPerPack && packsPerCtn ? `${pcsPerPack}x${packsPerCtn}` : "";
    setCode([b, m, v, p].filter(Boolean).join("-"));
  }, [variant?.id, model?.id, brand?.id, pcsPerPack, packsPerCtn]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setBrandId(""); setModelId(""); setVariantId("");
    setPcsPerPack(""); setPacksPerCtn("");
    setLenCm(""); setWidCm(""); setHtCm(""); setWgtKg("");
    setCode(""); setBarcode("");
    setShowNewBrand(false); setShowNewModel(false); setShowNewVariant(false);
    setNewBrandName(""); setNewModelName(""); setNewModelCat("");
    setNewVariantAttrs({}); setShowDetails(false);
    setLocalBrands([]); setLocalModels([]); setLocalVariants([]);
  }

  useEffect(() => { if (open) reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createInlineBrand() {
    if (!newBrandName.trim()) return;
    setInlineLoading(true);
    try {
      const b = await createBrand(newBrandName.trim());
      // Add to local list immediately so the Select shows the name right away
      setLocalBrands((prev) => [...prev, b]);
      setShowNewBrand(false);
      setNewBrandName("");
      setModelId("");
      setVariantId("");
      setBrandId(b.id);
      onSaved(); // reload parent lists in background
      toast.success("Brand created");
    } catch (e) { toast.error((e as Error).message); }
    finally { setInlineLoading(false); }
  }

  async function createInlineModel() {
    if (!newModelName.trim() || !brandId || !newModelCat) return;
    setInlineLoading(true);
    try {
      const m = await createModel({ brand_id: brandId, category_id: newModelCat, name: newModelName.trim() });
      setLocalModels((prev) => [...prev, m]);
      setShowNewModel(false);
      setNewModelName("");
      setVariantId("");
      setModelId(m.id);
      onSaved();
      toast.success("Model created");
    } catch (e) { toast.error((e as Error).message); }
    finally { setInlineLoading(false); }
  }

  async function createInlineVariant() {
    if (!modelId) return;
    const cleaned: Record<string, string | number> = {};
    for (const k of schema) {
      const v = newVariantAttrs[k];
      if (v && v.trim()) cleaned[k] = ATTR_SPECS[k]?.type === "number" ? Number(v) : v.trim();
    }
    if (Object.keys(cleaned).length === 0) { toast.error("Fill at least one attribute."); return; }
    const display = attrsToDisplay(cleaned, schema) || "Variant";
    setInlineLoading(true);
    try {
      const v = await createVariant({ model_id: modelId, attributes: cleaned, display_name: display });
      setLocalVariants((prev) => [...prev, v]);
      setShowNewVariant(false);
      setNewVariantAttrs({});
      setVariantId(v.id);
      onSaved();
      toast.success("Variant created");
    } catch (e) { toast.error((e as Error).message); }
    finally { setInlineLoading(false); }
  }

  async function save() {
    if (!variantId || !pcsPerPack || !packsPerCtn || !lenCm || !widCm || !htCm || !code.trim()) {
      toast.error("Fill all required fields before saving.");
      return;
    }
    setSaving(true);
    try {
      await createSku({
        variant_id: variantId,
        internal_code: code.trim(),
        supplier_barcode: barcode.trim() || null,
        pcs_per_pack: parseInt(pcsPerPack),
        packs_per_carton: parseInt(packsPerCtn),
        carton_length_cm: parseFloat(lenCm),
        carton_width_cm: parseFloat(widCm),
        carton_height_cm: parseFloat(htCm),
        carton_weight_kg: wgtKg ? parseFloat(wgtKg) : null,
      });
      toast.success("SKU created");
      onOpenChange(false);
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  const canSave = !!variantId && !!pcsPerPack && !!packsPerCtn && !!lenCm && !!widCm && !!htCm && !!code.trim();

  // Inline creation card style
  const inlineCard: React.CSSProperties = {
    background: "color-mix(in srgb, var(--snm-brand) 6%, transparent)",
    border: "1px solid color-mix(in srgb, var(--snm-brand) 20%, transparent)",
    borderRadius: 12,
    padding: 12,
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="bg-popover border-border max-w-lg p-0 gap-0 overflow-hidden">

        {/* Fixed header */}
        <div className="px-5 pt-5 pb-4 shrink-0" style={{ borderBottom: "1px solid var(--glass-border)" }}>
          <DialogTitle className="text-[17px] font-semibold">New SKU</DialogTitle>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Fill in product details — all fields on one screen
          </p>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-5 py-4 space-y-5" style={{ maxHeight: "calc(100dvh - 200px)" }}>

          {/* ── Product identity ── */}
          <div className="space-y-3">
            <SectionHead>Product</SectionHead>

            {/* Brand */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[13px]">Brand *</Label>
                {!showNewBrand && (
                  <button type="button" onClick={() => setShowNewBrand(true)}
                    className="text-[12px] font-medium py-1 px-2 rounded-lg active:opacity-60"
                    style={{ color: "var(--snm-brand)" }}>+ New</button>
                )}
              </div>
              {showNewBrand ? (
                <div style={inlineCard} className="space-y-2">
                  <Input autoFocus value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)}
                    placeholder="Brand name" className="h-11" />
                  <div className="flex gap-2">
                    <Button className="flex-1 h-11" onClick={createInlineBrand}
                      disabled={inlineLoading || !newBrandName.trim()}
                      style={{ background: "var(--snm-brand)", color: "#fff" }}>
                      {inlineLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save brand"}
                    </Button>
                    <Button variant="ghost" className="h-11 px-4" onClick={() => setShowNewBrand(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Select value={brandId} onValueChange={(v) => { setBrandId(v ?? ""); setModelId(""); setVariantId(""); }}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="Select brand" /></SelectTrigger>
                  <SelectContent>
                    {allBrands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Model — only shown once brand selected */}
            {brandId && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[13px]">Model *</Label>
                  {!showNewModel && (
                    <button type="button" onClick={() => setShowNewModel(true)}
                      className="text-[12px] font-medium py-1 px-2 rounded-lg active:opacity-60"
                      style={{ color: "var(--snm-brand)" }}>+ New</button>
                  )}
                </div>
                {showNewModel ? (
                  <div style={inlineCard} className="space-y-2">
                    <Input autoFocus value={newModelName} onChange={(e) => setNewModelName(e.target.value)}
                      placeholder="e.g. SoSoft Detergent" className="h-11" />
                    <Select value={newModelCat} onValueChange={(v) => setNewModelCat(v ?? "")}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="Category" /></SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button className="flex-1 h-11" onClick={createInlineModel}
                        disabled={inlineLoading || !newModelName.trim() || !newModelCat}
                        style={{ background: "var(--snm-brand)", color: "#fff" }}>
                        {inlineLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save product line"}
                      </Button>
                      <Button variant="ghost" className="h-11 px-4" onClick={() => setShowNewModel(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Select value={modelId} onValueChange={(v) => { setModelId(v ?? ""); setVariantId(""); }}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Select product line" /></SelectTrigger>
                    <SelectContent>
                      {brandModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Variant — only shown once model selected */}
            {modelId && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[13px]">
                    {category?.name === "Diapers" ? "Size *" : "Variant *"}
                  </Label>
                  {!showNewVariant && (
                    <button type="button" onClick={() => setShowNewVariant(true)}
                      className="text-[12px] font-medium py-1 px-2 rounded-lg active:opacity-60"
                      style={{ color: "var(--snm-brand)" }}>+ New</button>
                  )}
                </div>
                {showNewVariant ? (
                  <div style={inlineCard} className="space-y-2">
                    {schema.map((key) => {
                      const spec = ATTR_SPECS[key];
                      return spec?.options ? (
                        <Select key={key} value={newVariantAttrs[key] ?? ""}
                          onValueChange={(v) => setNewVariantAttrs({ ...newVariantAttrs, [key]: v ?? "" })}>
                          <SelectTrigger className="h-11"><SelectValue placeholder={spec.label} /></SelectTrigger>
                          <SelectContent>
                            {spec.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input key={key} className="h-11"
                          placeholder={`${spec?.label}${spec?.suffix ? ` (${spec.suffix})` : ""}`}
                          type={spec?.type === "number" ? "number" : "text"}
                          value={newVariantAttrs[key] ?? ""}
                          onChange={(e) => setNewVariantAttrs({ ...newVariantAttrs, [key]: e.target.value })} />
                      );
                    })}
                    <div className="flex gap-2">
                      <Button className="flex-1 h-11" onClick={createInlineVariant}
                        disabled={inlineLoading}
                        style={{ background: "var(--snm-brand)", color: "#fff" }}>
                        {inlineLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save variant"}
                      </Button>
                      <Button variant="ghost" className="h-11 px-4" onClick={() => setShowNewVariant(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Select value={variantId} onValueChange={(v) => setVariantId(v ?? "")}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Select variant" /></SelectTrigger>
                    <SelectContent>
                      {modelVariants.map((v) => <SelectItem key={v.id} value={v.id}>{v.display_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>

          {/* ── Pack config — shown once variant is selected ── */}
          {variantId && (
            <div className="space-y-3">
              <SectionHead>Pack Configuration</SectionHead>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">{unit}s per Pack *</Label>
                  <Input type="number" inputMode="numeric" min="1" className="h-11"
                    value={pcsPerPack} onChange={(e) => setPcsPerPack(e.target.value)}
                    placeholder={unit === "Pc" ? "34" : "1"} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Packs per Carton *</Label>
                  <Input type="number" inputMode="numeric" min="1" className="h-11"
                    value={packsPerCtn} onChange={(e) => setPacksPerCtn(e.target.value)}
                    placeholder="4" />
                </div>
              </div>

              {pcsPerCarton && (
                <div className="rounded-xl px-3 py-2.5" style={{ background: "color-mix(in srgb, var(--snm-success) 10%, transparent)" }}>
                  <p className="text-[12px] font-medium" style={{ color: "var(--snm-success)" }}>
                    {pcsPerCarton} {unit.toLowerCase()}s per carton total
                  </p>
                </div>
              )}

              {/* Carton dimensions */}
              <div className="space-y-1.5">
                <Label className="text-[13px]">Carton dimensions (cm) *</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Input type="number" inputMode="decimal" step="0.1" className="h-11"
                    value={lenCm} onChange={(e) => setLenCm(e.target.value)} placeholder="L" />
                  <Input type="number" inputMode="decimal" step="0.1" className="h-11"
                    value={widCm} onChange={(e) => setWidCm(e.target.value)} placeholder="W" />
                  <Input type="number" inputMode="decimal" step="0.1" className="h-11"
                    value={htCm}  onChange={(e) => setHtCm(e.target.value)}  placeholder="H" />
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
                <Input className="h-11 font-mono text-[13px]"
                  value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto-generated" />
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Auto-built from product details — edit freely.</p>
              </div>

              {/* Optional details — collapsed by default */}
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1.5 text-[12px] font-medium py-1 active:opacity-60"
                style={{ color: "var(--muted-foreground)" }}
              >
                <ChevronRight
                  className="h-3.5 w-3.5 transition-transform duration-150"
                  style={{ transform: showDetails ? "rotate(90deg)" : "rotate(0deg)" }}
                />
                {showDetails ? "Hide" : "Show"} optional details
              </button>

              {showDetails && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">Weight (kg)</Label>
                    <Input type="number" inputMode="decimal" step="0.01" className="h-11"
                      value={wgtKg} onChange={(e) => setWgtKg(e.target.value)} placeholder="Optional" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">Supplier barcode</Label>
                    <Input className="h-11"
                      value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Optional" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fixed footer */}
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

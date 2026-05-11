"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus, Trash2, Loader2, Search, X, ChevronRight,
  Package, Pencil, Check, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
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
          ) : sku.target_margin_pct != null ? (
            <div className="rounded-xl px-4 py-3"
              style={{ background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)",
                       border: "1px solid color-mix(in srgb, var(--snm-warning) 20%, transparent)" }}>
              <p className="text-[12px]" style={{ color: "var(--snm-warning)" }}>
                {sku.target_margin_pct}% margin set — price available after first GRN
              </p>
            </div>
          ) : (
            <div className="rounded-xl px-4 py-3"
              style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                No margin set — tap Edit to configure pricing
              </p>
            </div>
          )}
          {sku.target_margin_pct != null && (
            <p className="text-[11px] mt-2 text-center" style={{ color: "var(--muted-foreground)" }}>
              Target margin: {sku.target_margin_pct}%
            </p>
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
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition"
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
          {sku.pcs_per_pack}/pk × {sku.packs_per_carton}/ctn · {pcsPerCtn} pcs/ctn
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
              className="h-8 w-8 rounded-xl flex items-center justify-center transition"
              style={{
                background: showFilters ? "var(--snm-brand-muted)" : "var(--secondary)",
                color: showFilters ? "var(--snm-brand)" : "var(--muted-foreground)",
              }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setNewSkuOpen(true)}
              className="h-8 px-3 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 transition"
              style={{ background: "var(--snm-brand)", color: "#ffffff" }}
            >
              <Plus className="h-3.5 w-3.5" />
              New SKU
            </button>
          </div>
        </div>

        {/* Search */}
        <div
          className="flex items-center gap-2 px-3 rounded-xl h-9"
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

/* ── New SKU wizard — 3 steps in one dialog ── */
// Step 1: Pick or create Brand → Model → Variant
// Step 2: Pack config (pcs/pk, pks/ctn, dimensions)
// Step 3: Confirm + save

type WizardStep = "hierarchy" | "pack" | "confirm";

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
  const [step, setStep]               = useState<WizardStep>("hierarchy");
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

  // New entity inline creation
  const [newBrandName, setNewBrandName]   = useState("");
  const [showNewBrand, setShowNewBrand]   = useState(false);
  const [newModelName, setNewModelName]   = useState("");
  const [newModelCat, setNewModelCat]     = useState("");
  const [showNewModel, setShowNewModel]   = useState(false);
  const [newVariantAttrs, setNewVariantAttrs] = useState<Record<string, string>>({});
  const [showNewVariant, setShowNewVariant]   = useState(false);
  const [inlineLoading, setInlineLoading] = useState(false);

  const brandModels   = models.filter((m) => m.brand_id === brandId);
  const modelVariants = variants.filter((v) => v.model_id === modelId);
  const model         = models.find((m) => m.id === modelId);
  const brand         = brands.find((b) => b.id === brandId);
  const variant       = variants.find((v) => v.id === variantId);
  const category      = categories.find((c) => c.id === model?.category_id);
  const schema: AttrKey[] = (category?.variant_attributes ?? []) as AttrKey[];

  const pcsPerCarton = useMemo(() => {
    const p = parseInt(pcsPerPack), c = parseInt(packsPerCtn);
    return p > 0 && c > 0 ? p * c : null;
  }, [pcsPerPack, packsPerCtn]);

  const cbm = useMemo(() => {
    const l = parseFloat(lenCm), w = parseFloat(widCm), h = parseFloat(htCm);
    return l > 0 && w > 0 && h > 0 ? (l * w * h) / 1_000_000 : null;
  }, [lenCm, widCm, htCm]);

  // Auto-fill dims from sibling SKU
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

  // Auto-generate code
  useEffect(() => {
    if (!brand || !model || !variant) return;
    const b = brand.name.replace(/\s/g, "").toUpperCase().slice(0, 4);
    const m = model.name.replace(/\s/g, "").toUpperCase().slice(0, 4);
    const v = variant.display_name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
    const p = pcsPerPack && packsPerCtn ? `${pcsPerPack}x${packsPerCtn}` : "";
    setCode([b, m, v, p].filter(Boolean).join("-"));
  }, [variant?.id, model?.id, brand?.id, pcsPerPack, packsPerCtn]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setStep("hierarchy");
    setBrandId(""); setModelId(""); setVariantId("");
    setPcsPerPack(""); setPacksPerCtn("");
    setLenCm(""); setWidCm(""); setHtCm(""); setWgtKg("");
    setCode(""); setBarcode("");
    setShowNewBrand(false); setShowNewModel(false); setShowNewVariant(false);
    setNewBrandName(""); setNewModelName(""); setNewModelCat("");
    setNewVariantAttrs({});
  }

  useEffect(() => { if (open) reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createInlineBrand() {
    if (!newBrandName.trim()) return;
    setInlineLoading(true);
    try {
      const b = await createBrand(newBrandName.trim());
      await onSaved();
      setBrandId(b.id);
      setShowNewBrand(false);
      setNewBrandName("");
      toast.success("Brand created");
    } catch (e) { toast.error((e as Error).message); }
    finally { setInlineLoading(false); }
  }

  async function createInlineModel() {
    if (!newModelName.trim() || !brandId || !newModelCat) return;
    setInlineLoading(true);
    try {
      const m = await createModel({ brand_id: brandId, category_id: newModelCat, name: newModelName.trim() });
      await onSaved();
      setModelId(m.id);
      setShowNewModel(false);
      setNewModelName("");
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
      await onSaved();
      setVariantId(v.id);
      setShowNewVariant(false);
      setNewVariantAttrs({});
      toast.success("Variant created");
    } catch (e) { toast.error((e as Error).message); }
    finally { setInlineLoading(false); }
  }

  async function save() {
    if (!variantId || !pcsPerPack || !packsPerCtn || !lenCm || !widCm || !htCm || !code.trim()) return;
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

  const step1Complete = !!variantId;
  const step2Complete = !!pcsPerPack && !!packsPerCtn && !!lenCm && !!widCm && !!htCm && !!code.trim();

  const stepLabels: Record<WizardStep, string> = {
    hierarchy: "1  Product",
    pack: "2  Pack Config",
    confirm: "3  Confirm",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="bg-popover border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>New SKU</DialogTitle>
          <DialogDescription>
            {stepLabels[step]}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex gap-1 mb-1">
          {(["hierarchy","pack","confirm"] as WizardStep[]).map((s, i) => (
            <div key={s} className="flex-1 h-1 rounded-full" style={{
              background: step === s ? "var(--snm-brand)"
                : (step === "pack" && i === 0) || step === "confirm" ? "color-mix(in srgb, var(--snm-brand) 30%, transparent)"
                : "var(--secondary)",
            }} />
          ))}
        </div>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">

          {/* ── Step 1: hierarchy ── */}
          {step === "hierarchy" && (
            <>
              {/* Brand */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Brand *</Label>
                  {!showNewBrand && (
                    <button type="button" onClick={() => setShowNewBrand(true)}
                      className="text-xs" style={{ color: "var(--snm-brand)" }}>+ New brand</button>
                  )}
                </div>
                {showNewBrand ? (
                  <div className="flex gap-2">
                    <Input autoFocus value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} placeholder="Brand name" className="flex-1" />
                    <Button size="sm" onClick={createInlineBrand} disabled={inlineLoading || !newBrandName.trim()}>
                      {inlineLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowNewBrand(false)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Select value={brandId} onValueChange={(v) => { setBrandId(v ?? ""); setModelId(""); setVariantId(""); }}>
                    <SelectTrigger><SelectValue placeholder="Pick a brand" /></SelectTrigger>
                    <SelectContent>
                      {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Model */}
              {brandId && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Model / Product Line *</Label>
                    {!showNewModel && (
                      <button type="button" onClick={() => setShowNewModel(true)}
                        className="text-xs" style={{ color: "var(--snm-brand)" }}>+ New model</button>
                    )}
                  </div>
                  {showNewModel ? (
                    <div className="space-y-2 rounded-xl p-3"
                      style={{ background: "color-mix(in srgb, var(--snm-brand) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-brand) 20%, transparent)" }}>
                      <Input autoFocus value={newModelName} onChange={(e) => setNewModelName(e.target.value)} placeholder="e.g. Xtra Kering" />
                      <Select value={newModelCat} onValueChange={setNewModelCat}>
                        <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                        <SelectContent>
                          {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" onClick={createInlineModel}
                          disabled={inlineLoading || !newModelName.trim() || !newModelCat}>
                          {inlineLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save model"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowNewModel(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Select value={modelId} onValueChange={(v) => { setModelId(v ?? ""); setVariantId(""); }}>
                      <SelectTrigger><SelectValue placeholder="Pick a model" /></SelectTrigger>
                      <SelectContent>
                        {brandModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Variant */}
              {modelId && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{category?.name === "Diapers" ? "Size *" : "Variant *"}</Label>
                    {!showNewVariant && (
                      <button type="button" onClick={() => setShowNewVariant(true)}
                        className="text-xs" style={{ color: "var(--snm-brand)" }}>+ New variant</button>
                    )}
                  </div>
                  {showNewVariant ? (
                    <div className="space-y-2 rounded-xl p-3"
                      style={{ background: "color-mix(in srgb, var(--snm-brand) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-brand) 20%, transparent)" }}>
                      {schema.map((key) => {
                        const spec = ATTR_SPECS[key];
                        return spec?.options ? (
                          <Select key={key} value={newVariantAttrs[key] ?? ""} onValueChange={(v) => setNewVariantAttrs({ ...newVariantAttrs, [key]: v })}>
                            <SelectTrigger><SelectValue placeholder={spec.label} /></SelectTrigger>
                            <SelectContent>{spec.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <Input key={key} placeholder={`${spec?.label}${spec?.suffix ? ` (${spec.suffix})` : ""}`}
                            type={spec?.type === "number" ? "number" : "text"}
                            value={newVariantAttrs[key] ?? ""}
                            onChange={(e) => setNewVariantAttrs({ ...newVariantAttrs, [key]: e.target.value })} />
                        );
                      })}
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" onClick={createInlineVariant} disabled={inlineLoading}>
                          {inlineLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save variant"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowNewVariant(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Select value={variantId} onValueChange={(v) => setVariantId(v ?? "")}>
                      <SelectTrigger><SelectValue placeholder="Pick a variant" /></SelectTrigger>
                      <SelectContent>
                        {modelVariants.map((v) => <SelectItem key={v.id} value={v.id}>{v.display_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Step 2: pack config ── */}
          {step === "pack" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Pcs per Pack *</Label>
                  <Input type="number" min="1" value={pcsPerPack} onChange={(e) => setPcsPerPack(e.target.value)} placeholder="34" autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label>Packs per Carton *</Label>
                  <Input type="number" min="1" value={packsPerCtn} onChange={(e) => setPacksPerCtn(e.target.value)} placeholder="4" />
                </div>
              </div>
              {pcsPerCarton && (
                <p className="text-[11px]" style={{ color: "var(--snm-success)" }}>→ {pcsPerCarton} pcs per carton</p>
              )}

              <div className="space-y-1.5">
                <Label>Carton dimensions (cm) *</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Input type="number" step="0.1" value={lenCm} onChange={(e) => setLenCm(e.target.value)} placeholder="L" />
                  <Input type="number" step="0.1" value={widCm} onChange={(e) => setWidCm(e.target.value)} placeholder="W" />
                  <Input type="number" step="0.1" value={htCm}  onChange={(e) => setHtCm(e.target.value)}  placeholder="H" />
                </div>
                {cbm !== null && (
                  <p className="text-[11px]" style={{ color: "var(--snm-success)" }}>→ {cbm.toFixed(5)} CBM</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Weight (kg)</Label>
                  <Input type="number" step="0.01" value={wgtKg} onChange={(e) => setWgtKg(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label>Supplier barcode</Label>
                  <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Internal code *</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto-generated" />
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Auto-built — edit freely.</p>
              </div>
            </>
          )}

          {/* ── Step 3: confirm ── */}
          {step === "confirm" && brand && model && variant && (
            <div className="space-y-3">
              <div className="rounded-xl p-4 space-y-2"
                style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
                <div className="flex justify-between text-[13px]">
                  <span style={{ color: "var(--muted-foreground)" }}>Brand</span>
                  <span className="text-foreground font-medium">{brand.name}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span style={{ color: "var(--muted-foreground)" }}>Model</span>
                  <span className="text-foreground font-medium">{model.name}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span style={{ color: "var(--muted-foreground)" }}>Variant</span>
                  <span className="text-foreground font-medium">{variant.display_name}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span style={{ color: "var(--muted-foreground)" }}>Pack</span>
                  <span className="text-foreground font-medium">{pcsPerPack}/pk × {packsPerCtn}/ctn = {pcsPerCarton} pcs/ctn</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span style={{ color: "var(--muted-foreground)" }}>Dimensions</span>
                  <span className="text-foreground font-medium">{lenCm}×{widCm}×{htCm} cm · {cbm?.toFixed(4)} CBM</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span style={{ color: "var(--muted-foreground)" }}>Code</span>
                  <span className="text-foreground font-mono">{code}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {step !== "hierarchy" && (
            <Button variant="ghost" onClick={() => setStep(step === "confirm" ? "pack" : "hierarchy")}>
              Back
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {step === "hierarchy" && (
            <Button onClick={() => setStep("pack")} disabled={!step1Complete}>Next</Button>
          )}
          {step === "pack" && (
            <Button onClick={() => setStep("confirm")} disabled={!step2Complete}>Review</Button>
          )}
          {step === "confirm" && (
            <Button onClick={save} disabled={saving} style={{ background: "var(--snm-brand)", color: "#ffffff" }}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create SKU"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

// The two small select primitives New Sale uses. Extracted from sales-list.tsx
// so the wizard and the list stop sharing a scope with them.

import { ChevronDown, Warehouse } from "lucide-react";
import type { GodownRow } from "@/lib/queries/masters";
import { CARD } from "@/lib/surfaces";

// ── Small helpers ─────────────────────────────────────────────────────────────

export function GlassSelect({ label, value, onChange, children }: {
  label?: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none appearance-none"
        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
      >
        {children}
      </select>
    </div>
  );
}

// ── Prominent warehouse picker ────────────────────────────────────────────────
// The godown a sale ships from decides which stock gets deducted, so a wrong
// pick is a real operational error. This makes it impossible to skip past: a
// brand-accented card with an icon and the chosen warehouse shown large, with
// the native <select> laid transparently over the whole card for tapping.
export function WarehouseSelect({ value, onChange, godowns }: {
  value: string; onChange: (v: string) => void; godowns: GodownRow[];
}) {
  const selected = godowns.find((g) => g.id === value);
  // Nothing chosen yet = the reminder state. Ali asked to be prompted on every
  // order, so the field starts empty and asks, rather than quietly pre-filling
  // the default and hoping he notices. Warning-toned so it reads as an
  // outstanding decision, not decoration.
  const unset = !selected;
  return (
    <div
      className="relative rounded-2xl px-4 py-3.5 flex items-center gap-3.5"
      style={unset
        ? {
            background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)",
            border: "1.5px solid color-mix(in srgb, var(--snm-warning) 45%, transparent)",
          }
        : {
            background: "var(--snm-brand-muted)",
            border: "1.5px solid var(--snm-brand-border)",
          }}
    >
      <div
        className="shrink-0 flex items-center justify-center rounded-xl"
        style={{ width: 44, height: 44, background: unset ? "var(--snm-warning)" : "var(--snm-brand)" }}
      >
        <Warehouse className="h-6 w-6" style={{ color: unset ? "var(--background)" : "var(--snm-brand-on)" }} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] uppercase tracking-widest font-semibold"
          style={{ color: unset ? "var(--snm-warning)" : "var(--snm-brand-text)" }}>
          {unset ? "Choose warehouse first" : "Ship from warehouse"}
        </p>
        <p className="ios-body font-bold text-foreground truncate">
          {selected ? `${selected.name}${selected.is_default ? " (usual)" : ""}` : "Tap to choose"}
        </p>
      </div>
      <ChevronDown className="h-5 w-5 shrink-0" style={{ color: unset ? "var(--snm-warning)" : "var(--snm-brand-text)" }} />
      {/* Transparent native select covers the card so the whole thing is tappable */}
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        aria-label="Ship from warehouse"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {/* Placeholder keeps the picker genuinely unset on open, so the wheel
            doesn't land on a warehouse he never actually chose. */}
        <option value="" disabled>Choose warehouse…</option>
        {godowns.map((g) => (
          <option key={g.id} value={g.id}>{g.name}{g.is_default ? " (usual)" : ""}</option>
        ))}
      </select>
    </div>
  );
}

"use client";

import { ChevronDown } from "lucide-react";
import type { ArrivalRow } from "@/lib/queries/price-review";

/* ── One arrival menu, used by every screen that reasons about arrivals ─────
 *
 * The visible card is ours; the tapping is a native <select> laid transparently
 * over it — the same primitive WarehouseSelect uses. On a phone that gives the
 * real iOS wheel for free: no custom menu, nothing to get wrong, and no new
 * input primitive.
 *
 * Extracted from the price review rather than copied into the simulator. Two
 * copies of one control is how this app ended up with ten doors onto "what
 * should I charge?", and a second copy would be free to drift in wording, in
 * date format, and in what it considers an arrival. */

/** The date as Ali reads it: "27 Aug". */
export function shortArrivalDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-MV", { day: "numeric", month: "short" });
}

export function ArrivalPicker({
  label, value, arrivals, allowNone, noneLabel, hint, onChange,
}: {
  label: string;
  value: string | null;
  arrivals: ArrivalRow[];
  /** Offer "no choice" as a real option — the caller supplies what it means. */
  allowNone?: boolean;
  noneLabel?: string;
  /** One short line under the reference: what this choice implies in money. */
  hint?: string;
  onChange: (id: string) => void;
}) {
  const chosen = arrivals.find((a) => a.id === value);
  return (
    <div
      className="relative rounded-2xl px-4 py-3 flex items-center gap-3 flex-1"
      style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="label-caps text-[11px]" style={{ color: "var(--foreground)", opacity: 0.7 }}>{label}</p>
        <p className="ios-subhead font-semibold truncate snm-num" style={{ color: "var(--foreground)" }}>
          {chosen ? `${chosen.reference} · ${shortArrivalDate(chosen.received_on)}` : (noneLabel ?? "The arrival before")}
        </p>
        {/* --foreground at 0.85, never muted: this is the number the choice is
            being made ON, not a caption beside it. */}
        {hint && (
          <p className="ios-footnote snm-num mt-0.5" style={{ color: "var(--foreground)", opacity: 0.85 }}>
            {hint}
          </p>
        )}
      </div>
      <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "var(--foreground)", opacity: 0.7 }} />
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {allowNone && <option value="">{noneLabel ?? "The arrival before"}</option>}
        {arrivals.map((a) => (
          <option key={a.id} value={a.id}>
            {a.reference} · {shortArrivalDate(a.received_on)}
          </option>
        ))}
      </select>
    </div>
  );
}

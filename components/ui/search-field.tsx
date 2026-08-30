"use client";

import { Search, X } from "lucide-react";
import { CARD } from "@/lib/surfaces";

/**
 * The one search bar.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * There were THIRTEEN of these, hand-written, and every one had the same
 * defect: a wrapper `div` with a fixed height and a bare `flex-1` input inside
 * it. A flex child with no height sizes to its own line box, so the input was
 * about 20px tall inside a bar that looked 44-52px tall. Tapping the visible
 * top or bottom of the field did nothing — the part of a search bar a thumb
 * lands on first is the part that was dead.
 *
 * `h-full` on the input is the whole fix. It is one word, and it was missing
 * in thirteen places at once, which is the real finding: this is one control
 * and it was written thirteen times. The copies had drifted to five heights
 * (44 / 46 / 48 / 52), four radii, three background recipes, and two of them
 * had clear buttons with no size at all — a 14px icon in a bare `<button>`.
 *
 * ── THE GEOMETRY IS NOT A TASTE CALL ───────────────────────────────────────
 *
 * 48px, because `.snm-input` in globals.css is 48px. Every other field in the
 * app is already that height; picking anything else would have made the search
 * bar the one input that does not match. The 44pt floor (Apple HIG, and this
 * is an installed iOS PWA) is cleared with 4px to spare.
 *
 * ── THE LABEL IS REQUIRED, ON PURPOSE ──────────────────────────────────────
 *
 * `label` has no default. A search field's name lives nowhere on screen — the
 * placeholder is muted by definition, so a screen reader reading placeholder
 * text is reading the one string the contrast rule says cannot be relied on.
 * Making it required means a new search bar cannot ship without one.
 *
 * `type="search"` is what puts a "Search" key on the iOS keyboard instead of
 * "return". WebKit's own cancel button is suppressed because this component
 * draws its own, at 44pt.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  autoFocus = false,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Spoken name for the field. Required — see the note above. */
  label: string;
  autoFocus?: boolean;
  /** Layout only (e.g. `flex-1` when the bar shares a row, or `mb-3`). */
  className?: string;
}) {
  return (
    /* CARD, not a hand-mixed background: lib/surfaces.ts is the one place that
       knows what a content surface is made of, and eight of the thirteen bars
       this replaces already used it. The hairline border override is the
       recipe those eight carried — a search bar sits lighter than a card. */
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 h-12 ${className}`}
      style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
    >
      <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} aria-hidden />
      {/* h-full is the fix. Without it this input is ~20px tall in a 48px bar. */}
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        autoComplete="off"
        className="flex-1 min-w-0 h-full appearance-none bg-transparent border-none outline-none ios-subhead text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value && (
        /* -mr-3.5 pulls the 44pt target back so the X still sits 16px from the
           bar's edge optically, exactly where the smaller icons used to. */
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="snm-pressable w-11 h-11 -mr-3.5 rounded-full flex items-center justify-center shrink-0"
          style={{ color: "var(--muted-foreground)" }}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

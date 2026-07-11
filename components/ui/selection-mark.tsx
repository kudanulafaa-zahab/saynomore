"use client";

import { Check, Minus } from "lucide-react";

// Tri-state selection indicator — Apple's actual multi-select convention
// (Mail, Files, Reminders): a filled circle for selected/checked, the same
// filled circle with a dash for "some children selected" (indeterminate),
// and a plain OUTLINE circle — never a faint/low-opacity checkmark — for
// unselected. Dimming an icon's opacity to signal "off" fails legibility at
// small sizes (this replaced exactly that pattern, flagged unreadable on a
// real device in both light and dark mode, 2026-07-11). An outline-vs-fill
// state swap stays legible at any size because neither state is ever faint.
export type SelectionState = "none" | "some" | "all";

export function SelectionMark({ state, size = 16 }: { state: SelectionState; size?: number }) {
  if (state === "none") {
    return (
      <span
        className="shrink-0 rounded-full"
        style={{
          width: size, height: size,
          border: "1.5px solid var(--muted-foreground)",
          opacity: 0.5,
          display: "inline-block",
        }}
      />
    );
  }
  const Icon = state === "all" ? Check : Minus;
  return (
    <span
      className="shrink-0 rounded-full flex items-center justify-center"
      style={{ width: size, height: size, background: "var(--snm-success)" }}
    >
      <Icon style={{ width: size * 0.68, height: size * 0.68, color: "var(--snm-on-fill)" }} strokeWidth={3} />
    </span>
  );
}

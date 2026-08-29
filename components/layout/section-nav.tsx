"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navForRole, itemsInSection, activeItem } from "./nav-config";

/* The screens inside the tab you are on.
 *
 * Deleting the "More" sheet took away the only way to reach sixteen of the
 * app's twenty screens, so this is what replaces it — and it is a better
 * answer, because it only ever shows you the screens that belong to the job
 * you are already doing. Standing in Prices, you see Price book, Simulator and
 * Market. You are never offered Godowns from there.
 *
 * DERIVED FROM nav-config, like everything else. A screen added to that file
 * appears here with nobody doing anything, which is the property that stops a
 * page shipping unreachable (hard rule 8).
 *
 * It renders nothing at all when the tab holds one screen — a switcher with a
 * single option is a label pretending to be a control.
 *
 * PILLS ARE CONTENT, NOT HINTS. Each one carries a destination, so the
 * unselected ones are real --foreground text on a filled surface, never muted
 * text on transparent (CLAUDE.md, contrast). The row scrolls sideways in its
 * own container; the page body never does. */

export function SectionNav({ role }: { role: string }) {
  const pathname = usePathname();
  const items    = navForRole(role);
  const current  = activeItem(items, pathname);

  if (!current) return null;
  const siblings = itemsInSection(items, current.section);
  if (siblings.length < 2) return null;

  return (
    <nav
      aria-label={`${current.section} screens`}
      className="flex gap-2 overflow-x-auto mb-4 -mx-1 px-1 pb-0.5"
      style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
    >
      {siblings.map((item) => {
        const active = item.href === current.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            // 44pt tall. These pills were py-1.5 — 32px — and they are the
            // switcher on EVERY screen, so they were the other half of the
            // app's touch-target debt. I shipped them at 32px earlier the same
            // day the audit that caught them was written, which is the case
            // for measuring rather than reviewing: they look correct, and the
            // measurement is the only thing that says otherwise.
            // inline-flex + items-center keeps the label centred now that the
            // pill is taller than its text.
            className="snm-pressable shrink-0 inline-flex items-center rounded-full px-4 min-h-11 ios-footnote font-semibold whitespace-nowrap"
            style={{
              background: active ? "var(--foreground)" : "var(--glass-bg-1)",
              color:      active ? "var(--background)" : "var(--foreground)",
              border:     "0.5px solid var(--glass-border-lo)",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

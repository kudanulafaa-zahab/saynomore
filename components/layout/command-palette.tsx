"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { navForRole } from "./nav-config";

// Topbar (or anything else) can open the palette without prop-drilling:
// window.dispatchEvent(new CustomEvent("snm:open-palette"))
export const OPEN_PALETTE_EVENT = "snm:open-palette";

// Desktop keyboard-first navigation (skills.md §4): Cmd/Ctrl+K opens a
// Spotlight-style switcher over the role's nav destinations. Mobile users
// never see it — there's no hardware keyboard to summon it with.
export function CommandPalette({ role }: { role: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => navForRole(role), [role]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    // Rank prefix matches above substring matches so "s" puts Sales first.
    const starts = items.filter((i) => i.label.toLowerCase().startsWith(q));
    const contains = items.filter(
      (i) => !i.label.toLowerCase().startsWith(q) && i.label.toLowerCase().includes(q),
    );
    return [...starts, ...contains];
  }, [items, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  // Global hotkey + external open event
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  // Focus the field on open
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Clamp at render time instead of syncing state — results can shrink while
  // the arrow-key position points past the end of the new list.
  const activeIdx = Math.min(active, Math.max(0, results.length - 1));

  if (!open) return null;

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIdx + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIdx - 1, 0));
    } else if (e.key === "Enter" && results[activeIdx]) {
      e.preventDefault();
      go(results[activeIdx].href);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] hidden lg:flex items-start justify-center snm-scrim-in"
      style={{ background: "var(--scrim-bg)", backdropFilter: "var(--scrim-blur)", WebkitBackdropFilter: "var(--scrim-blur)", paddingTop: "18vh" }}
      onMouseDown={close}
      role="dialog"
      aria-modal="true"
      aria-label="Go to page"
    >
      <div
        className="glass-elevated w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top"
        style={{ borderRadius: 20 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search field */}
        <div className="flex items-center gap-3 px-4" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
          <Search className="h-4.5 w-4.5 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Go to…"
            aria-label="Search pages"
            className="w-full bg-transparent outline-none ios-body py-3.5"
            style={{ color: "var(--foreground)" }}
          />
          <kbd
            className="ios-caption1 px-1.5 py-0.5 rounded-md shrink-0"
            style={{ background: "var(--muted)", color: "var(--muted-foreground)", border: "0.5px solid var(--glass-border-lo)" }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {results.length === 0 ? (
            <p className="ios-subhead px-3 py-6 text-center" style={{ color: "var(--muted-foreground)" }}>
              No screen matches “{query}”
            </p>
          ) : (
            results.map((item, i) => {
              const Icon = item.icon;
              const isActive = i === activeIdx;
              return (
                <button
                  key={item.href}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item.href)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left"
                  style={{
                    background: isActive ? "var(--snm-brand)" : "transparent",
                    color: isActive ? "var(--snm-brand-on)" : "var(--foreground)",
                  }}
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" style={{ opacity: isActive ? 1 : 0.6 }} />
                  <span className="ios-subhead font-medium flex-1">{item.label}</span>
                  {isActive && <CornerDownLeft className="h-3.5 w-3.5 opacity-70" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

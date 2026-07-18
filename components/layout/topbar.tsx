"use client";

import { LogOut, Search as SearchIcon } from "lucide-react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ThemeToggle } from "./theme-toggle";
import { OPEN_PALETTE_EVENT } from "./command-palette";

// Calm Technology: peripheral sync awareness — never blocks, never pops up.
// Online: shows "Updated Xm ago". Offline: shows a quiet red pill.
function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function SyncStamp() {
  const [loadedAt] = useState(() => Date.now());
  const [label, setLabel]   = useState("Just updated");
  // Browser connectivity is external state — subscribe instead of syncing it
  // into useState from an effect. Server snapshot assumes online.
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  useEffect(() => {
    const tick = () => {
      const mins = Math.floor((Date.now() - loadedAt) / 60_000);
      setLabel(mins < 1 ? "Just updated" : `Updated ${mins}m ago`);
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [loadedAt]);

  if (!online) {
    return (
      <span
        className="inline-flex items-center gap-1.5 ios-subhead font-semibold px-2.5 py-1 rounded-full"
        style={{
          background: "color-mix(in srgb, var(--snm-error) 12%, transparent)",
          color: "var(--snm-error)",
        }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--snm-error)" }}
        />
        No connection
      </span>
    );
  }

  return (
    <span
      className="hidden sm:inline ios-subhead tabular-nums"
      style={{ color: "var(--muted-foreground)", opacity: 0.6 }}
    >
      {label}
    </span>
  );
}

export function Topbar({ name, role }: { name: string; role: string }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header
      className="fixed top-0 w-full z-40 flex items-center justify-between px-4 glass-panel--strong"
      style={{
        borderRadius: 0,
        borderTop: "none",
        borderLeft: "none",
        borderRight: "none",
        paddingTop: "env(safe-area-inset-top, 0px)",
        height: "calc(52px + env(safe-area-inset-top, 0px))",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <Image
          src="/icon.svg"
          alt="SayNoMore"
          width={28}
          height={28}
          unoptimized
          className="w-7 h-7 rounded-lg shrink-0"
          style={{ objectFit: "cover" }}
        />
        <span className="snm-wordmark text-[16px] text-foreground">
          saynomore
        </span>
      </div>

      {/* Centre: viewer badge or sync stamp */}
      {role === "viewer" ? (
        <span
          className="inline-flex items-center gap-1.5 ios-subhead font-semibold px-2.5 py-1 rounded-full"
          style={{
            background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)",
            color: "var(--snm-brand-text)",
            border: "1px solid color-mix(in srgb, var(--snm-brand) 20%, transparent)",
          }}
        >
          View only
        </span>
      ) : (
        <SyncStamp />
      )}

      {/* Right: search hint + theme toggle + avatar dropdown */}
      <div className="flex items-center gap-1">
        {/* Desktop-only ⌘K affordance — opens the command palette */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}
          aria-label="Open quick navigation (Cmd+K)"
          className="hidden lg:flex items-center gap-2 h-8 px-2.5 mr-1 rounded-lg snm-pressable"
          style={{ background: "var(--secondary)", border: "0.5px solid var(--glass-border-lo)", color: "var(--muted-foreground)" }}
        >
          <SearchIcon className="h-3.5 w-3.5" />
          <kbd className="ios-caption1">⌘K</kbd>
        </button>
        {/* Global search — phones had no path to the command palette
            (desktop has ⌘K). 44pt target, monochrome icon = tappable. */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}
          aria-label="Search"
          className="lg:hidden h-11 w-11 -m-1 flex items-center justify-center active:opacity-60"
          style={{ color: "var(--foreground)" }}
        >
          <SearchIcon className="h-[18px] w-[18px]" />
        </button>
        <ThemeToggle />

        {/* Avatar + popover — React state driven, reliable on mobile */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={`Account menu for ${name}`}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            className="w-11 h-11 rounded-full flex items-center justify-center ios-subhead font-semibold text-foreground active:opacity-70 focus:outline-none"
            style={{ background: "var(--secondary)", border: "0.5px solid var(--glass-border-lo)" }}
          >
            {initials}
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-52 rounded-2xl overflow-hidden glass-panel
                animate-in fade-in zoom-in-95 duration-150 origin-top-right"
              style={{ zIndex: 60 }}
            >
              {/* User info */}
              <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center ios-subhead font-semibold shrink-0"
                  style={{ background: "var(--secondary)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
                >
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="ios-subhead font-semibold text-foreground truncate">{name}</p>
                  <p className="text-[12px] uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>{role}</p>
                </div>
              </div>
              {/* Actions */}
              <div className="p-1.5">
                <button
                  onClick={() => { setMenuOpen(false); handleSignOut(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition active:opacity-70 active:scale-[0.98]"
                  style={{ color: "var(--snm-error)" }}
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}


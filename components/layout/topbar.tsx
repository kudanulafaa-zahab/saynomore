"use client";

import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./theme-toggle";

// Calm Technology: peripheral sync awareness — never blocks, never pops up.
// Online: shows "Updated Xm ago". Offline: shows a quiet red pill.
function SyncStamp() {
  const [loadedAt] = useState(() => Date.now());
  const [label, setLabel]   = useState("Just updated");
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Initialise from browser state
    setOnline(navigator.onLine);

    const goOnline  = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

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
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
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
      className="hidden sm:inline text-[11px] tabular-nums"
      style={{ color: "var(--muted-foreground)", opacity: 0.6 }}
    >
      {label}
    </span>
  );
}

export function Topbar({ name, role }: { name: string; role: string }) {
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header
      className="fixed top-0 w-full z-40 flex items-center justify-between px-4"
      style={{
        background: "color-mix(in srgb, var(--background) 82%, transparent)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderBottom: "1px solid var(--glass-border)",
        paddingTop: "env(safe-area-inset-top, 0px)",
        height: "calc(52px + env(safe-area-inset-top, 0px))",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-bold"
          style={{ background: "var(--snm-brand)", color: "#ffffff" }}
        >
          S
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          SayNoMore
        </span>
      </div>

      {/* Centre: sync stamp — calm peripheral awareness */}
      <SyncStamp />

      {/* Right: theme toggle + avatar dropdown */}
      <div className="flex items-center gap-1">
        <ThemeToggle />

        {/* Avatar + popover — CSS-driven focus-within */}
        <div className="relative group">
          <button
            className="w-11 h-11 rounded-full flex items-center justify-center text-[12px] font-semibold text-foreground active:opacity-70 focus:outline-none"
            style={{ background: "var(--secondary)", border: "1px solid var(--glass-border)" }}
          >
            {initials}
          </button>

          <div
            className="absolute right-0 top-full mt-2 w-52 rounded-2xl overflow-hidden
              opacity-0 scale-95 pointer-events-none
              group-focus-within:opacity-100 group-focus-within:scale-100 group-focus-within:pointer-events-auto
              transition-all duration-150 origin-top-right"
            style={{
              background: "var(--glass-2)",
              backdropFilter: "blur(32px)",
              WebkitBackdropFilter: "blur(32px)",
              border: "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
            }}
          >
            {/* User info */}
            <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: "1px solid var(--glass-border)" }}>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
                style={{ background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--glass-border)" }}
              >
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground truncate">{name}</p>
                <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>{role}</p>
              </div>
            </div>
            {/* Actions */}
            <div className="p-1.5">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm active:opacity-70"
                style={{ color: "var(--snm-error)" }}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}


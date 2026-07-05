"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { UsersManager } from "@/components/masters/users-manager";

export default function SettingsPage() {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="space-y-5 pb-10">

      {/* Page header */}
      <div>
        <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>System</p>
        <h1 className="ios-page-title">Settings</h1>
      </div>

      <UsersManager />

      {/* ── Sign out ──────────────────────────────────────────── */}
      <section
        className="rounded-2xl overflow-hidden"
        style={{
          background: "var(--glass-1)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "0.5px solid var(--glass-border-lo)",
          boxShadow: "var(--glass-shadow), var(--glass-inner)",
        }}
      >
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Sign out</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>You&apos;ll be returned to the login screen</p>
            </div>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition active:scale-95 active:opacity-70 disabled:opacity-40 shrink-0"
              style={{
                background: "color-mix(in srgb, var(--snm-error) 10%, transparent)",
                color: "var(--snm-error)",
                border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)",
              }}
            >
              {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

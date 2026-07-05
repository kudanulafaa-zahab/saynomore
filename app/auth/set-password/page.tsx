"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";

function SetPasswordForm() {
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    // Supabase sends the token as a URL hash: #access_token=...&type=invite
    // The Supabase JS client automatically detects and processes this hash.
    // We listen for the SIGNED_IN event which fires once the hash is consumed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY")) {
        setReady(true);
      }
    });

    // Also check if session already exists (page refresh after hash consumed)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Handle ?error=expired from /auth/callback fallback
  useEffect(() => {
    if (searchParams.get("error") === "expired") {
      setError("This link has expired or already been used. Request a new one from the login page.");
      setReady(true);
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }

    setLoading(true);
    // Use the server API so password is set against the cookie session user,
    // not whoever is in the browser's localStorage.
    const res = await fetch("/api/admin/set-invited-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const json = await res.json();
    setLoading(false);

    if (!res.ok) { setError(json.error ?? "Failed to set password."); return; }
    setDone(true);
    setTimeout(() => { window.location.href = "/login"; }, 2000);
  }

  const inputStyle = {
    width: "100%", height: "44px", borderRadius: "12px", padding: "0 12px",
    fontSize: "14px", outline: "none", background: "var(--glass-1)",
    border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)",
  } as React.CSSProperties;

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ background: "var(--background)" }}>
        <div className="flex flex-col items-center gap-3" style={{ color: "var(--muted-foreground)" }}>
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="ios-subhead">Verifying link…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-md p-10 space-y-7 rounded-2xl"
        style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)" }}>
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: "var(--snm-brand)" }}>
            <span className="text-xl font-bold text-white">S</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>Set your password</h1>
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Choose a password to access the app</p>
          </div>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 rounded-xl text-center"
            style={{ background: "color-mix(in srgb, var(--snm-success) 12%, transparent)" }}>
            <CheckCircle2 className="h-8 w-8" style={{ color: "var(--snm-success)" }} />
            <p className="font-medium" style={{ color: "var(--snm-success)" }}>Password set! Taking you to login…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="ios-subhead font-medium" style={{ color: "var(--foreground)" }}>New password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required autoFocus value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  style={{ ...inputStyle, paddingRight: "44px" }}
                  disabled={!!error}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-0 top-0 h-full w-11 flex items-center justify-center transition-opacity hover:opacity-70 active:opacity-50"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="ios-subhead font-medium" style={{ color: "var(--foreground)" }}>Confirm password</label>
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  required value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  style={{ ...inputStyle, paddingRight: "44px" }}
                  disabled={!!error}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                  className="absolute right-0 top-0 h-full w-11 flex items-center justify-center transition-opacity hover:opacity-70 active:opacity-50"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl px-3 py-2.5 ios-subhead"
                style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-error) 30%, transparent)", color: "var(--snm-error)" }}>
                {error}
              </div>
            )}

            {!error && (
              <button type="submit" disabled={loading}
                className="w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{ background: "var(--foreground)", color: "var(--background)" }}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set password & continue"}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense>
      <SetPasswordForm />
    </Suspense>
  );
}

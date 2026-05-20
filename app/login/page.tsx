"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot password state
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }
    window.location.href = "/dashboard";
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setResetError(null);
    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    setResetLoading(false);
    if (error) { setResetError(error.message); return; }
    setResetSent(true);
  }

  const inputStyle = {
    width: "100%",
    height: "44px",
    borderRadius: "12px",
    padding: "0 12px",
    fontSize: "14px",
    outline: "none",
    background: "var(--glass-1)",
    border: "0.5px solid var(--glass-border-lo)",
    color: "var(--foreground)",
  } as React.CSSProperties;

  if (showReset) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6" style={{ background: "var(--background)" }}>
        <div className="w-full max-w-md p-10 space-y-6 rounded-2xl" style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)" }}>
          <div className="text-center space-y-1">
            <h1 className="text-xl font-semibold" style={{ color: "var(--foreground)" }}>Set your password</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Enter your email — we&apos;ll send a link to set your password
            </p>
          </div>

          {resetSent ? (
            <div className="flex flex-col items-center gap-3 py-6 rounded-xl text-center" style={{ background: "color-mix(in srgb, var(--snm-success) 12%, transparent)" }}>
              <CheckCircle2 className="h-8 w-8" style={{ color: "var(--snm-success)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--snm-success)" }}>
                Email sent! Check your inbox and click the link.
              </p>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <input
                type="email"
                required
                autoFocus
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="your@email.com"
                style={inputStyle}
              />
              {resetError && (
                <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)" }}>
                  {resetError}
                </div>
              )}
              <button
                type="submit"
                disabled={resetLoading}
                className="w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{ background: "var(--foreground)", color: "var(--background)" }}
              >
                {resetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send password link"}
              </button>
            </form>
          )}

          <button onClick={() => setShowReset(false)} className="w-full text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-md p-10 space-y-7 rounded-2xl" style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)" }}>
        <div className="space-y-3 text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "var(--snm-brand)", boxShadow: "0 8px 32px color-mix(in srgb, var(--snm-brand) 35%, transparent)" }}
          >
            <span className="text-xl font-bold text-white">S</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>SayNoMore</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@saynomore.mv"
              style={inputStyle}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Password</label>
              <button
                type="button"
                onClick={() => { setShowReset(true); setResetEmail(email); }}
                className="text-xs hover:opacity-70 transition-opacity"
                style={{ color: "var(--muted-foreground)" }}
              >
                Forgot password?
              </button>
            </div>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </div>

          {error && (
            <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-error) 30%, transparent)", color: "var(--snm-error)" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
          Access by invitation only
        </p>
      </div>
    </div>
  );
}

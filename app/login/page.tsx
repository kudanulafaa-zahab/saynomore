"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2, CheckCircle2, Eye, EyeOff, WifiOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Track connectivity so we can show a clear "connect once" message instead
  // of a confusing "load failed" when a first-time user opens the app offline.
  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Forgot password state
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // First-ever login genuinely needs the network to verify credentials and
    // create a session. Tell the user plainly rather than letting it fail.
    if (!navigator.onLine) {
      setError("You're offline. Connect to the internet once to sign in — after that the app works offline.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
      window.location.href = "/dashboard";
    } catch {
      // Network dropped mid-request
      setError("Couldn't reach the server. Check your connection and try again.");
      setLoading(false);
    }
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
        <div className="w-full max-w-md p-10 space-y-6 rounded-2xl" style={{ background: "var(--glass-1)", backdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)" }}>
          <div className="text-center space-y-1">
            <h1 className="text-xl font-semibold" style={{ color: "var(--foreground)" }}>Set your password</h1>
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
              Enter your email — we&apos;ll send a link to set your password
            </p>
          </div>

          {resetSent ? (
            <div className="flex flex-col items-center gap-3 py-6 rounded-xl text-center" style={{ background: "color-mix(in srgb, var(--snm-success) 12%, transparent)" }}>
              <CheckCircle2 className="h-8 w-8" style={{ color: "var(--snm-success)" }} />
              <p className="ios-subhead font-medium" style={{ color: "var(--snm-success)" }}>
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
                <div className="rounded-xl px-3 py-2.5 ios-subhead" style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)" }}>
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

          <button onClick={() => setShowReset(false)} className="w-full text-center ios-subhead" style={{ color: "var(--muted-foreground)" }}>
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-md p-10 space-y-7 rounded-2xl" style={{ background: "var(--glass-1)", backdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)" }}>
        <div className="space-y-3 text-center">
          <img
            src="/icon.svg"
            alt="SayNoMore"
            width={56}
            height={56}
            className="mx-auto h-14 w-14 rounded-2xl"
            style={{ objectFit: "cover", boxShadow: "0 8px 32px color-mix(in srgb, var(--snm-brand) 35%, transparent)" }}
          />
          <div>
            <h1 className="snm-wordmark text-2xl" style={{ color: "var(--foreground)" }}>saynomore</h1>
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Sign in to continue</p>
          </div>
        </div>

        {isOffline && (
          <div
            className="flex items-start gap-2.5 rounded-xl px-3 py-3"
            style={{
              background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--snm-warning) 30%, transparent)",
            }}
          >
            <WifiOff className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--snm-warning)" }} />
            <p className="ios-subhead leading-snug" style={{ color: "var(--snm-warning)" }}>
              You&apos;re offline. Connect to the internet <strong>once</strong> to sign in. After that, the app works offline automatically.
            </p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="ios-subhead font-medium" style={{ color: "var(--foreground)" }}>Email</label>
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
              <label className="ios-subhead font-medium" style={{ color: "var(--foreground)" }}>Password</label>
              <button
                type="button"
                onClick={() => { setShowReset(true); setResetEmail(email); }}
                className="ios-subhead hover:opacity-70 transition-opacity"
                style={{ color: "var(--muted-foreground)" }}
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...inputStyle, paddingRight: "44px" }}
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

          {error && (
            <div className="rounded-xl px-3 py-2.5 ios-subhead" style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-error) 30%, transparent)", color: "var(--snm-error)" }}>
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

        <p className="text-center ios-subhead" style={{ color: "var(--muted-foreground)" }}>
          Access by invitation only
        </p>
      </div>
    </div>
  );
}

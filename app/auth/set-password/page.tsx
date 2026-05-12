"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function SetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // If the callback redirected here with ?error=expired the token was invalid.
    if (searchParams.get("error") === "expired") {
      setError("This invite link has expired. Ask your admin to send a new invite.");
      setReady(true);
      return;
    }

    // The /auth/callback route ran verifyOtp server-side and set the session
    // in the cookie before redirecting here. Just read it directly.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true);
        return;
      }

      // Fallback: no session in cookie yet — wait briefly for it to propagate,
      // or for onAuthStateChange if somehow a hash token was used.
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (session && (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY")) {
          setReady(true);
        }
      });

      // After 6s with no session, the link is broken.
      const timeout = setTimeout(() => {
        setError("This invite link has expired. Ask your admin to send a new invite.");
        setReady(true);
      }, 6000);

      return () => { subscription.unsubscribe(); clearTimeout(timeout); };
    });
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) { setError(updateError.message); return; }
    setDone(true);
    setTimeout(() => router.push("/dashboard"), 1500);
  }

  const inputStyle = {
    width: "100%",
    height: "44px",
    borderRadius: "12px",
    padding: "0 12px",
    fontSize: "14px",
    outline: "none",
    background: "var(--glass-1)",
    border: "1px solid var(--glass-border)",
    color: "var(--foreground)",
  } as React.CSSProperties;

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ background: "var(--background)" }}>
        <div className="flex flex-col items-center gap-3" style={{ color: "var(--muted-foreground)" }}>
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Verifying invite link…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6" style={{ background: "var(--background)" }}>
      <div
        className="w-full max-w-md p-10 space-y-7 rounded-2xl"
        style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid var(--glass-border)" }}
      >
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: "var(--snm-brand)" }}>
            <span className="text-xl font-bold text-white">S</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>Set your password</h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Choose a password to access the app</p>
          </div>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 rounded-xl text-center" style={{ background: "color-mix(in srgb, var(--snm-success) 12%, transparent)" }}>
            <CheckCircle2 className="h-8 w-8" style={{ color: "var(--snm-success)" }} />
            <p className="font-medium" style={{ color: "var(--snm-success)" }}>Password set! Entering app…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>New password</label>
              <input type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" style={inputStyle} disabled={!!error} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Confirm password</label>
              <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat your password" style={inputStyle} disabled={!!error} />
            </div>

            {error && (
              <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-error) 30%, transparent)", color: "var(--snm-error)" }}>
                {error}
              </div>
            )}

            {!error && (
              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{ background: "var(--foreground)", color: "var(--background)" }}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set password & enter app"}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

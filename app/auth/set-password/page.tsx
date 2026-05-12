"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function SetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Case 1: session already in cookies (came via /auth/callback after code exchange)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { setReady(true); return; }

      // Case 2: invite link with hash token (#access_token=...) — handled by Supabase JS automatically
      // onAuthStateChange fires when Supabase parses the hash
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (session && (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY")) {
          setReady(true);
        }
      });

      // Timeout: if no session after 8s, something went wrong
      const timeout = setTimeout(() => {
        setError("This link has expired or is invalid. Use 'Forgot password?' on the login page to get a new one.");
        setReady(true); // show form anyway so error is visible
      }, 8000);

      return () => { subscription.unsubscribe(); clearTimeout(timeout); };
    });
  }, []);

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
          <p className="text-sm">Verifying link…</p>
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
              <input type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" style={inputStyle} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Confirm password</label>
              <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat your password" style={inputStyle} />
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
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set password & enter app"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

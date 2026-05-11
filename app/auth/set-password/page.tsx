"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setDone(true);
    setTimeout(() => router.push("/dashboard"), 1800);
  }

  return (
    <div
      className="flex min-h-dvh items-center justify-center px-6"
      style={{ background: "var(--background)" }}
    >
      <div
        className="w-full max-w-md p-10 space-y-7 rounded-2xl"
        style={{
          background: "var(--glass-1)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border)",
        }}
      >
        {/* Header */}
        <div className="space-y-3 text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "var(--snm-brand)", boxShadow: "0 8px 32px color-mix(in srgb, var(--snm-brand) 35%, transparent)" }}
          >
            <span className="text-xl font-bold" style={{ color: "#ffffff" }}>S</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
              Set your password
            </h1>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Choose a password to complete your account setup
            </p>
          </div>
        </div>

        {done ? (
          <div
            className="flex flex-col items-center gap-3 py-6 rounded-xl text-center"
            style={{ background: "color-mix(in srgb, var(--snm-success) 12%, transparent)" }}
          >
            <CheckCircle2 className="h-8 w-8" style={{ color: "var(--snm-success)" }} />
            <p className="font-medium" style={{ color: "var(--snm-success)" }}>Password set! Redirecting…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                New password
              </label>
              <input
                type="password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full h-11 rounded-xl px-3 text-sm outline-none"
                style={{
                  background: "var(--glass-1)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--foreground)",
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                Confirm password
              </label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your password"
                className="w-full h-11 rounded-xl px-3 text-sm outline-none"
                style={{
                  background: "var(--glass-1)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--foreground)",
                }}
              />
            </div>

            {error && (
              <div
                className="rounded-xl px-3 py-2.5 text-sm"
                style={{
                  background: "color-mix(in srgb, var(--snm-error) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--snm-error) 30%, transparent)",
                  color: "var(--snm-error)",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-85 disabled:opacity-50"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set password & continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

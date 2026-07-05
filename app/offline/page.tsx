"use client";

export default function OfflinePage() {
  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
        style={{ background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)" }}
      >
        📶
      </div>
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="ios-subhead" style={{ color: "var(--muted-foreground)", maxWidth: 280 }}>
        This page isn&apos;t cached yet. Any changes you entered are saved locally and will sync when you reconnect.
      </p>
      <button
        onClick={() => window.history.back()}
        className="snm-pressable mt-2 px-6 py-3 rounded-2xl ios-subhead font-semibold"
        style={{ background: "var(--foreground)", color: "var(--background)" }}
      >
        Go back
      </button>
    </div>
  );
}

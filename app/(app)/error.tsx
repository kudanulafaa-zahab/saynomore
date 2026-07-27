"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, LayoutDashboard } from "lucide-react";

/**
 * Screen-level error boundary for every page inside the app shell.
 *
 * Without this, a single render error anywhere in a screen unmounts the whole
 * React tree and Ali gets a blank white page on the phone with no way back —
 * the PWA has no browser chrome to reload from. Next's boundary keeps the tab
 * bar and sidebar alive and gives one obvious way out.
 *
 * Plain-English copy on purpose: it names what happened and what to do, and
 * keeps the technical detail folded away for a support screenshot.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Kept in production (next.config strips log/info, not error) so a real
    // failure is still visible in the device console when debugging live.
    console.error("Screen crashed:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
        style={{ background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)" }}
      >
        ⚠️
      </div>

      <h1 className="ios-page-title">This screen didn&apos;t load</h1>
      <p className="ios-subhead" style={{ color: "var(--muted-foreground)", maxWidth: 300 }}>
        Nothing was saved or changed — your data is safe. Try again, and if it
        keeps happening send a screenshot of the detail below.
      </p>

      <div className="flex gap-2.5 mt-2">
        <button
          onClick={reset}
          className="snm-pressable px-5 py-3 rounded-2xl ios-subhead font-semibold inline-flex items-center gap-2"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          <RotateCw className="h-4 w-4" /> Try again
        </button>
        <Link
          href="/dashboard"
          className="snm-pressable px-5 py-3 rounded-2xl ios-subhead font-semibold inline-flex items-center gap-2"
          style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}
        >
          <LayoutDashboard className="h-4 w-4" /> Dashboard
        </Link>
      </div>

      <details className="mt-4 max-w-full">
        <summary
          className="ios-footnote cursor-pointer"
          style={{ color: "var(--muted-foreground)" }}
        >
          Technical detail
        </summary>
        <p
          className="ios-footnote mt-2 px-3 py-2 rounded-xl text-left break-words"
          style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}
        >
          {error.message}
          {error.digest ? ` (${error.digest})` : ""}
        </p>
      </details>
    </div>
  );
}

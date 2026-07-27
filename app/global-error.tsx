"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary. This one catches failures in the root layout itself,
 * where the normal `error.tsx` can't help — so it has to render its own
 * <html>/<body> and cannot rely on the app's fonts or CSS variables loading.
 * Everything here is deliberately self-contained and hue-free.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App crashed:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "0 24px",
          textAlign: "center",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
          background: "#fff",
          color: "#111",
        }}
      >
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          SayNoMore couldn&apos;t start
        </h1>
        <p style={{ fontSize: 15, color: "#666", maxWidth: 300, margin: 0 }}>
          Nothing was saved or changed — your data is safe. Reload to try again.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: 8,
            padding: "14px 24px",
            borderRadius: 16,
            border: "none",
            background: "#111",
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}

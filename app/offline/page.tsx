"use client";

import { useSyncExternalStore } from "react";

/* The shell the service worker serves when a page will not load.
 *
 * IT MUST WORK OUT WHICH OF TWO THINGS HAPPENED, because it is the same cached
 * HTML either way and the service worker cannot know. Ali, 2026-08-28, on 4G
 * with full signal, opening Financials minutes after a deploy: the page said
 * **"You're offline"**. He was not — the deploy's reload had aborted the
 * navigation, and an abort rejects exactly like a dead network.
 *
 * Telling him he has no signal when he has four bars sends him to check his
 * phone instead of the app. So the wording is decided HERE, in the browser,
 * from `navigator.onLine`, at the moment it is read — and the online case gets
 * a Try again button, because retrying is the entire fix for a one-off abort.
 *
 * `useSyncExternalStore` rather than useState + useEffect: it subscribes to the
 * real online/offline events, so if the connection comes back while he is
 * looking at this page the words change under him without a reload. */
function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
    // Server render and first paint: assume connected. The honest default —
    // this page is reached far more often by a failed request than by a
    // genuinely dead connection.
    () => true,
  );
}

export default function OfflinePage() {
  const online = useOnline();

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

      <h1 className="text-xl font-semibold">
        {online ? "That didn’t load" : "You’re offline"}
      </h1>

      {/* If it has to be read, it is --foreground (CLAUDE.md, contrast): this
          is the only content on the screen, not a caption beside something. */}
      <p className="ios-subhead" style={{ color: "var(--foreground)", opacity: 0.8, maxWidth: 300 }}>
        {online
          ? "Your connection is fine — the page just didn’t come through. This usually happens for a moment right after an update."
          : "This page isn’t saved on your phone yet. Anything you entered is saved and will sync when you reconnect."}
      </p>

      <div className="flex flex-col items-center gap-2 mt-2">
        {online && (
          <button
            onClick={() => window.location.reload()}
            className="snm-pressable px-6 py-3 rounded-2xl ios-subhead font-semibold"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            Try again
          </button>
        )}
        <button
          onClick={() => window.history.back()}
          className="snm-pressable px-6 py-3 rounded-2xl ios-subhead font-semibold"
          style={
            online
              ? { background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }
              : { background: "var(--foreground)", color: "var(--background)" }
          }
        >
          Go back
        </button>
      </div>
    </div>
  );
}

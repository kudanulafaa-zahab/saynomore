"use client";

import { useEffect, useState } from "react";
import { X, Share2, SquarePlus, Download, ExternalLink } from "lucide-react";
import { isIOS, isAndroid, isInAppBrowser } from "@/lib/install-detect";
import { useInstallPrompt } from "@/components/install/install-context";

export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { canPromptInstall, promptInstall } = useInstallPrompt();
  const [platform, setPlatform] = useState<"android" | "ios-in-app" | "ios" | "none">("none");

  // Platform checks read navigator/UA — client only, decided once we know
  // we're actually showing something.
  useEffect(() => {
    if (!open) return;
    if (isAndroid()) setPlatform("android");
    else if (isIOS() && isInAppBrowser()) setPlatform("ios-in-app");
    else if (isIOS()) setPlatform("ios");
    else setPlatform("none");
  }, [open]);

  if (!open) return null;
  // Android without a captured install event yet has nothing real to offer;
  // an empty sheet is worse than no sheet.
  if (platform === "android" && !canPromptInstall) return null;
  if (platform === "none") return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 snm-scrim-in"
        style={{ background: "var(--scrim-bg)", backdropFilter: "var(--scrim-blur)" }}
        onClick={onClose}
      />
      <div
        className="glass-modal snm-sheet-in relative w-full max-w-md rounded-t-3xl p-6"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 h-8 w-8 flex items-center justify-center rounded-full"
          style={{ background: "var(--glass-1)" }}
        >
          <X className="h-4 w-4" />
        </button>

        {platform === "android" && (
          <>
            <h2 className="ios-title3 font-semibold mb-1">Add SayNoMore to your phone</h2>
            <p className="ios-subhead mb-5" style={{ color: "var(--muted-foreground)" }}>
              One tap installs it like a real app — quicker checkout next time, no browser tabs.
            </p>
            <button
              onClick={async () => {
                await promptInstall();
                onClose();
              }}
              className="snm-pressable w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              <Download className="h-4 w-4" />
              Install App
            </button>
          </>
        )}

        {platform === "ios-in-app" && (
          <>
            <h2 className="ios-title3 font-semibold mb-1">Add to your Home Screen</h2>
            <p className="ios-subhead mb-4" style={{ color: "var(--muted-foreground)" }}>
              This only works from Safari — tap the •••/share icon at the top or bottom of this
              screen and choose <strong>&ldquo;Open in Browser&rdquo;</strong> or{" "}
              <strong>&ldquo;Open in Safari&rdquo;</strong> first, then come back to this page.
            </p>
            <div
              className="flex items-center gap-2 ios-footnote rounded-xl p-3"
              style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
            >
              <ExternalLink className="h-4 w-4 shrink-0" />
              Instagram/Facebook/TikTok&apos;s built-in browser can&apos;t save apps to your Home
              Screen — only Safari can.
            </div>
          </>
        )}

        {platform === "ios" && (
          <>
            <h2 className="ios-title3 font-semibold mb-1">Add to your Home Screen</h2>
            <p className="ios-subhead mb-5" style={{ color: "var(--muted-foreground)" }}>
              Order faster next time — it opens like a real app, right from your Home Screen.
            </p>
            <ol className="space-y-3">
              <li className="flex items-center gap-3">
                <span className="ios-footnote font-semibold h-6 w-6 shrink-0 rounded-full flex items-center justify-center"
                  style={{ background: "var(--muted)" }}>1</span>
                <Share2 className="h-4 w-4 shrink-0" />
                <span className="ios-subhead">Tap the Share icon in Safari&apos;s toolbar</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="ios-footnote font-semibold h-6 w-6 shrink-0 rounded-full flex items-center justify-center"
                  style={{ background: "var(--muted)" }}>2</span>
                <SquarePlus className="h-4 w-4 shrink-0" />
                <span className="ios-subhead">Scroll down and tap &ldquo;Add to Home Screen&rdquo;</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="ios-footnote font-semibold h-6 w-6 shrink-0 rounded-full flex items-center justify-center"
                  style={{ background: "var(--muted)" }}>3</span>
                <Download className="h-4 w-4 shrink-0" />
                <span className="ios-subhead">Tap &ldquo;Add&rdquo; in the top corner</span>
              </li>
            </ol>
          </>
        )}

        <button
          onClick={onClose}
          className="ios-subhead w-full text-center mt-5"
          style={{ color: "var(--muted-foreground)" }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

// Subtle haptic feedback for key confirm actions (native-app feel).
//
// Uses the Vibration API — supported on Android/Chrome PWAs; iOS Safari
// currently ignores it, so this is a progressive enhancement that never
// throws and never blocks. Keep patterns SHORT: a confirm should feel like
// a tick, not a buzz.

type Haptic = "light" | "success" | "warning" | "error";

const PATTERNS: Record<Haptic, number | number[]> = {
  light: 8,
  success: [10, 40, 10],
  warning: [20, 60, 20],
  error: [30, 40, 30, 40, 30],
};

export function haptic(kind: Haptic = "light"): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(PATTERNS[kind]);
    }
  } catch {
    /* never let feedback break an action */
  }
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Compiler: build-time auto-memoization of every component — the
  // hand-written memo()/useMemo work becomes the floor, not the ceiling.
  // Verified against this codebase via `next build` before enabling.
  reactCompiler: true,

  // Strip console noise from production bundles; keep errors/warnings so
  // real failures still reach the device console when debugging live.
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },

  // Tree-shake large/barrel packages so each route only ships the icons and
  // helpers it actually uses — trims First Load JS on every screen, which is
  // the dominant cost of navigating between modules in this client-heavy app.
  experimental: {
    optimizePackageImports: ["lucide-react", "@supabase/ssr", "@supabase/supabase-js"],

    // Client-side Router Cache. Server-rendered screens (Dashboard, Sales,
    // Financials…) default to ZERO navigation cache, so every tap on the tab
    // bar re-renders from the server — the round-trip you feel as "slow",
    // even though each query is ~30ms. Caching the rendered payload briefly
    // makes tapping between tabs feel instant (the native-app switch feel),
    // while a full reload or a data mutation still fetches fresh — so money
    // and stock are never shown stale beyond a quick back-and-forth.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;

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
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake large/barrel packages so each route only ships the icons and
  // helpers it actually uses — trims First Load JS on every screen, which is
  // the dominant cost of navigating between modules in this client-heavy app.
  experimental: {
    optimizePackageImports: ["lucide-react", "@supabase/ssr", "@supabase/supabase-js"],
  },
};

export default nextConfig;

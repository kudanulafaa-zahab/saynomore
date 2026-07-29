import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This is a sibling app inside the main saynomore repo (its own
  // package.json/lockfile), not a workspace of the root app — pin the root
  // explicitly so Turbopack doesn't guess wrong from the two lockfiles.
  turbopack: { root: __dirname },
  reactCompiler: true,
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "@supabase/ssr", "@supabase/supabase-js"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "smhdwkrmiytvpsgqezsl.supabase.co" },
    ],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This is a sibling app inside the main saynomore repo (its own
  // package.json/lockfile), not a workspace of the root app — pin the root
  // explicitly so Turbopack doesn't guess wrong from the two lockfiles.
  turbopack: { root: __dirname },

  // Public anon key + project URL — safe to bake in as a fallback default
  // (not secrets: this is exactly what NEXT_PUBLIC_* means, and RLS +
  // get_storefront_catalogue()/place_customer_order() are what actually
  // gate access, same as the main app). A real Vercel env var, if one is
  // ever set in the dashboard, still wins — this only fills the gap when
  // none is configured, which is otherwise a hard build failure since the
  // Supabase client is created at module scope in a client component that
  // Next statically renders once during the production build.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://smhdwkrmiytvpsgqezsl.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtaGR3a3JtaXl0dnBzZ3FlenNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNTY4NTAsImV4cCI6MjA5MzYzMjg1MH0.JQY7QUdt4j0kxLfDP9P9vH4Q4qz4vByVy2VXoXy_-TA",
  },
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

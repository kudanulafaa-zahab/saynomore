"use client";

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Guest-only storefront: no auth session to persist. Every read/write here
// runs as anon, gated by get_storefront_catalogue()/place_customer_order() —
// never a bare table select, matching the staff app's own rule.
export const supabase = createBrowserClient(url, anon, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

"use client";

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// persistSession + autoRefreshToken keep the user logged in across app
// restarts and refresh the token automatically whenever the device is online,
// so field staff effectively never have to re-enter their password.
export const supabase = createBrowserClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

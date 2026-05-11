import { createClient } from "@supabase/supabase-js";

// Server-only admin client — uses service role key, bypasses RLS.
// NEVER import this in client components or pages — only in app/api/** routes.
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase admin env vars");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

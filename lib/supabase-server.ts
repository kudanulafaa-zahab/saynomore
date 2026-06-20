import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              // 400-day maxAge so sessions survive PWA restarts on iOS
              cookieStore.set(name, value, { ...options, maxAge: 34560000 })
            );
          } catch {
            // setAll called from a Server Component — ignore.
          }
        },
      },
    }
  );
}

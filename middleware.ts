import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const path = request.nextUrl.pathname;

  // Public routes: always pass through, no session check, no redirect ever.
  // /offline must be reachable without auth or network so the service worker
  // can cache it and serve it as the offline fallback shell.
  if (
    path.startsWith("/auth/") ||
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/offline")
  ) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Not logged in → send to login
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Fetch role — single lightweight query
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = profile?.role ?? "staff";

  // Staff can only access /deliveries
  if (role === "staff") {
    if (!path.startsWith("/deliveries")) {
      return NextResponse.redirect(new URL("/deliveries", request.url));
    }
    return response;
  }

  // Non-staff: root → dashboard
  if (path === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  // Exclude Next internals, images, AND the PWA files (sw.js, manifest,
  // workbox, icons). The service worker MUST be served as JS, never
  // redirected to /login — otherwise registration fails and the app cannot
  // work offline at all.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon-.*\\.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

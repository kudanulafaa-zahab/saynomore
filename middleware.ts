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

  // Determine whether the user is logged in WITHOUT forcing a network call.
  // getUser() validates the token against Supabase over the network — offline
  // that always fails and would wrongly bounce a logged-in user to /login.
  // Instead read the session from the cookie locally (getSession, no network).
  // If a session cookie exists, we trust it and let the user through; the
  // session auto-refreshes whenever the device is back online.
  let user = null;
  let networkFailed = false;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // Distinguish "no/invalid session" from "couldn't reach Supabase".
      // AuthApiError = server reachable but rejected; anything else (fetch
      // failure) = offline/network, in which case fall back to the cookie.
      if (error.name === "AuthApiError") {
        user = null;
      } else {
        networkFailed = true;
      }
    } else {
      user = data.user;
    }
  } catch {
    networkFailed = true;
  }

  // Offline / network failure: trust a locally stored session if present.
  if (networkFailed) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      user = session.user;
    }
  }

  // Genuinely not logged in (and online enough to know it) → send to login
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Fetch role — single lightweight query. Offline this can fail; in that case
  // role stays null and we DON'T apply role-based redirects (the user already
  // passed auth, so let them stay on the page they opened rather than wrongly
  // bouncing an admin to /deliveries). Role gating resumes once back online.
  let role: string | null = null;
  try {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    role = profile?.role ?? "staff";
  } catch {
    role = null; // unknown — skip role redirects this request
  }

  // Role unknown (offline): allow the request through without re-routing.
  if (role === null) {
    return response;
  }

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

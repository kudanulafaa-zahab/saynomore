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
            // Force a 400-day maxAge so auth cookies survive PWA restarts on iOS.
            // Without this, Supabase sets session cookies that iOS clears on app close.
            response.cookies.set(name, value, { ...options, maxAge: 34560000 })
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

  // Fetch role. This used to run a user_profiles query on EVERY navigation —
  // a second network round-trip stacked on getUser(), the dominant cause of
  // sluggish page transitions. We now cache it in a cookie keyed by user id:
  // most requests read the role locally (zero network) and only the first
  // request per session (or after a user switch) hits the database.
  const ROLE_COOKIE = "snm_role";
  const cached = request.cookies.get(ROLE_COOKIE)?.value; // format: "<userId>:<role>"
  let role: string | null = null;

  if (cached) {
    const sep = cached.indexOf(":");
    if (sep > 0 && cached.slice(0, sep) === user.id) {
      role = cached.slice(sep + 1); // same user → trust cached role, no query
    }
  }

  if (role === null) {
    try {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      role = profile?.role ?? "staff";
      // Persist for subsequent navigations. Short-ish maxAge so a role change
      // propagates within the hour without needing a logout.
      response.cookies.set(ROLE_COOKIE, `${user.id}:${role}`, {
        httpOnly: true, sameSite: "lax", maxAge: 3600, path: "/",
      });
    } catch {
      role = null; // offline / unknown — skip role redirects this request
    }
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

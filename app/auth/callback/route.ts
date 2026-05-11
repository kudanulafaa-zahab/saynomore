import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type"); // "invite" or "recovery"
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await getSupabaseServer();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Invite links: type param may say "invite", OR the user has no password set yet
      // (last_sign_in_at === created_at is a reliable indicator of a brand-new invited user)
      const isInvite =
        type === "invite" ||
        type === "recovery" ||
        (data.user &&
          data.user.last_sign_in_at &&
          data.user.created_at &&
          Math.abs(
            new Date(data.user.last_sign_in_at).getTime() -
              new Date(data.user.created_at).getTime()
          ) < 60_000); // within 1 minute = first-ever sign in

      if (isInvite) {
        return NextResponse.redirect(`${origin}/auth/set-password`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}

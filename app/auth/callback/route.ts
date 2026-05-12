import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/dashboard";

  const supabase = await getSupabaseServer();

  // For invite/recovery links: sign out any existing session first so the
  // invited user's token is exchanged cleanly with no prior session in the way.
  if (type === "invite" || type === "recovery") {
    await supabase.auth.signOut();
  }

  // Path A: PKCE code exchange
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const isInviteOrRecovery =
        type === "invite" ||
        type === "recovery" ||
        (data.user &&
          data.user.last_sign_in_at &&
          data.user.created_at &&
          Math.abs(
            new Date(data.user.last_sign_in_at).getTime() -
              new Date(data.user.created_at).getTime()
          ) < 60_000);

      if (isInviteOrRecovery) {
        return NextResponse.redirect(`${origin}/auth/set-password`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  // Path B: token_hash exchange (Supabase invite emails send this)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "invite" | "recovery" | "signup" | "email" | "magiclink" | "sms" | "email_change" | "phone_change",
    });
    if (!error) {
      if (type === "invite" || type === "recovery") {
        return NextResponse.redirect(`${origin}/auth/set-password`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}

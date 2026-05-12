import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type"); // "invite" | "recovery" | "signup" | etc.
  const next = searchParams.get("next") ?? "/dashboard";

  const supabase = await getSupabaseServer();

  // Path A: token_hash — this is what Supabase sends for invite and recovery emails.
  // The email link goes to Supabase's server first, which then redirects here with
  // ?token_hash=XXX&type=invite appended to our redirectTo URL.
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
    return NextResponse.redirect(`${origin}/auth/set-password?error=expired`);
  }

  // Path B: code — used by OAuth and some magic link flows.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/auth/set-password?error=expired`);
  }

  return NextResponse.redirect(`${origin}/auth/set-password?error=expired`);
}

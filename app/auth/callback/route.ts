import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  const supabase = await getSupabaseServer();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "invite" | "recovery" | "signup" | "email" | "magiclink" | "sms" | "email_change" | "phone_change",
    });
    if (!error) {
      return NextResponse.redirect(`${origin}/auth/set-password`);
    }
    return NextResponse.redirect(`${origin}/auth/set-password?error=expired`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/auth/set-password`);
    }
    return NextResponse.redirect(`${origin}/auth/set-password?error=expired`);
  }

  return NextResponse.redirect(`${origin}/auth/set-password?error=expired`);
}

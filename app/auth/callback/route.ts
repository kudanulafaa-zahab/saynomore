import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/dashboard";

  const supabase = await getSupabaseServer();

  // token_hash flow — Supabase sends this for invite and recovery emails
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

    // verifyOtp failed — show the error message in the URL so we can see it
    const msg = encodeURIComponent(error.message ?? "unknown");
    return NextResponse.redirect(`${origin}/auth/set-password?error=expired&msg=${msg}`);
  }

  // code flow — OAuth and some magic links
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    const msg = encodeURIComponent(error.message ?? "unknown");
    return NextResponse.redirect(`${origin}/auth/set-password?error=expired&msg=${msg}`);
  }

  return NextResponse.redirect(`${origin}/auth/set-password?error=expired&msg=no_token`);
}

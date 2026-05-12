import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (!password || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    // Read the invited user's session from the cookie (set by /auth/callback verifyOtp).
    // This is the invited user's session — NOT the admin's browser session.
    const supabase = await getSupabaseServer();
    const { data: { user }, error: sessionError } = await supabase.auth.getUser();

    if (sessionError || !user) {
      return NextResponse.json({ error: "Session expired. Ask your admin to send a new invite." }, { status: 401 });
    }

    // Use the admin client to set the password for this specific user by ID.
    // This bypasses any browser session confusion entirely.
    const admin = getSupabaseAdmin();
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, email: user.email });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

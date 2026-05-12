import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (!password || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    // Get the user from the server cookie session.
    // When the invite hash is processed client-side, Supabase sets the session
    // in both localStorage AND cookies, so this will return the invited user.
    const supabase = await getSupabaseServer();
    const { data: { user }, error: sessionError } = await supabase.auth.getUser();

    if (sessionError || !user) {
      return NextResponse.json({ error: "Session not found. Please click the invite link again." }, { status: 401 });
    }

    // Set password via admin SDK using the exact user ID from the cookie session.
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

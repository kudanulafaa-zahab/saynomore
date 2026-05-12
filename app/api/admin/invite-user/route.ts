import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    // Verify the caller is an authenticated admin
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { email, full_name, role } = await req.json();
    if (!email || !role) {
      return NextResponse.json({ error: "email and role are required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // redirectTo points directly to /auth/set-password.
    // Supabase appends #access_token=... to this URL in the email link.
    // The set-password page catches that hash via onAuthStateChange client-side.
    const origin = req.headers.get("origin") ?? "https://saynomore-beta.vercel.app";
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: full_name ?? "", role },
      redirectTo: `${origin}/auth/debug`,
    });
    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 });
    }

    // Pre-create the user_profiles row so the role is set immediately
    if (invited.user) {
      await admin
        .from("user_profiles")
        .upsert({ id: invited.user.id, full_name: full_name ?? null, role, email }, { onConflict: "id" });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

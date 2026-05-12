import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
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

    const { email, full_name, role, temp_password } = await req.json();
    if (!email || !role || !temp_password) {
      return NextResponse.json({ error: "email, role and temp_password are required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // Create the user directly with a password — no email link confusion.
    // email_confirm: true means they can log in immediately.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: temp_password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? "" },
    });

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    if (created.user) {
      await admin
        .from("user_profiles")
        .upsert(
          { id: created.user.id, full_name: full_name ?? null, role, email },
          { onConflict: "id" }
        );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

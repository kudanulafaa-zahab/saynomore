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

    // ── THE ROLE. Read this before changing anything here. ──────────────────
    //
    // A trigger on auth.users (handle_new_user) has ALREADY inserted a profile
    // row by this point, hardcoded to 'staff'. This write is what turns it into
    // the role that was actually chosen — so if it fails, the account silently
    // becomes delivery staff and the screen says "added successfully".
    //
    // It was failing, every time. The upsert carried an `email` column that
    // user_profiles does not have (the address lives on auth.users, which is
    // where list-users reads it from), so PostgREST rejected the whole write —
    // and the error was never checked. Picking Viewer produced Delivery Staff:
    // MORE access than intended, and silent. Roles on production read correctly
    // only because they were corrected afterwards through the Edit dialog,
    // which is a different path.
    //
    // Two rules follow, and both matter more than the column fix:
    //   1. NEVER report success on a write whose error you did not read.
    //   2. An account whose role could not be set must not survive. Leaving it
    //      is leaving a staff login nobody asked for.
    if (created.user) {
      const { error: profileError } = await admin
        .from("user_profiles")
        .upsert(
          { id: created.user.id, full_name: full_name ?? null, role },
          { onConflict: "id" }
        );

      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return NextResponse.json(
          { error: `Could not set the role, so the account was not created: ${profileError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

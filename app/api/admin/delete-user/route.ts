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

    const body = await req.json();
    const user_id = body?.user_id;
    if (!user_id || typeof user_id !== "string") {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }

    // Basic UUID format check
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(user_id)) {
      return NextResponse.json({ error: `Invalid user ID format: "${user_id}"` }, { status: 400 });
    }

    // Prevent self-deletion
    if (user_id === user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // Delete from auth.users — ignore "not found" (user may only exist in user_profiles)
    const { error: deleteError } = await admin.auth.admin.deleteUser(user_id);
    if (deleteError && !deleteError.message.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    // Always clean up user_profiles row
    await admin.from("user_profiles").delete().eq("id", user_id);

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

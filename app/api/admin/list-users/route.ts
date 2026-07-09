import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET() {
  try {
    // Verify caller is authenticated admin or manager. Read-only (lists
    // users, doesn't create/delete/change roles) — managers need this to
    // populate the driver-assignment dropdown in Dispatch, same
    // admin-or-manager bar as everywhere else in the app (is_admin_or_manager()).
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin" && profile?.role !== "manager") {
      return NextResponse.json({ error: "Admin or manager only" }, { status: 403 });
    }

    const admin = getSupabaseAdmin();

    // Pull all auth users (up to 1000)
    const { data: authData, error: authError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });

    // Pull all user_profiles for role + full_name
    const { data: profiles } = await admin.from("user_profiles").select("id, full_name, role");
    const profileMap = new Map((profiles ?? []).map((p: { id: string; full_name: string | null; role: string }) => [p.id, p]));

    const users = authData.users.map((u) => {
      const prof = profileMap.get(u.id);
      return {
        id: u.id,
        email: u.email ?? null,
        full_name: prof?.full_name ?? (u.user_metadata?.full_name as string | null) ?? null,
        role: (prof?.role ?? "staff") as "admin" | "manager" | "staff" | "viewer",
        created_at: u.created_at,
      };
    });

    return NextResponse.json(users);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

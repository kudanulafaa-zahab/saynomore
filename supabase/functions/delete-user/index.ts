import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // Verify caller is admin
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await callerClient
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") return json({ error: "Only admins can delete users" }, 403);

    const { user_id } = await req.json();
    if (!user_id) return json({ error: "user_id is required" }, 400);

    // Cannot delete yourself
    if (user_id === user.id) return json({ error: "You cannot delete your own account" }, 400);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Delete the auth user (cascades to user_profiles via FK or we delete manually)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user_id);
    if (deleteError) return json({ error: deleteError.message }, 400);

    // Also remove the profile in case FK didn't cascade
    await adminClient.from("user_profiles").delete().eq("id", user_id);

    return json({ message: "User deleted" });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

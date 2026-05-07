import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    // Verify the caller is an authenticated admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const callerClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    // Check caller is admin
    const { data: profile } = await callerClient
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") return json({ error: "Only admins can invite users" }, 403);

    // Parse request body
    const { email, full_name, role } = await req.json();
    if (!email || !full_name || !role) return json({ error: "email, full_name and role are required" }, 400);
    if (!["manager", "staff"].includes(role)) return json({ error: "Role must be manager or staff" }, 400);

    // Use service role client to send the invite
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role },
    });

    if (inviteError) {
      // If user already exists, just update their profile
      if (inviteError.message.includes("already been registered")) {
        const { data: existing } = await adminClient.auth.admin.listUsers();
        const existingUser = existing?.users?.find((u) => u.email === email.toLowerCase());
        if (existingUser) {
          await adminClient
            .from("user_profiles")
            .upsert({ id: existingUser.id, full_name, role }, { onConflict: "id" });
          return json({ message: "User already exists — role updated" });
        }
      }
      return json({ error: inviteError.message }, 400);
    }

    // Upsert the profile with the correct role (trigger creates it as 'staff' by default)
    await adminClient
      .from("user_profiles")
      .upsert({ id: invited.user.id, full_name, role }, { onConflict: "id" });

    return json({ message: `Invite sent to ${email}` });
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

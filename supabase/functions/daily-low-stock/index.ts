// Daily low-stock digest. Triggered once a day by pg_cron (see migration 0036).
// Reads get_low_stock_digest() (all logic + formatting lives in Postgres) and
// pushes ONE summary to every admin/manager. Sends nothing when no SKU is low.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(payload: object, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async () => {
  // Access control is handled by the gateway JWT check (the function is only
  // reachable with a valid Supabase key) — same as the send-push function. No
  // extra bearer-string guard here: the Supabase gateway rewrites the
  // Authorization header for service-role calls, so matching it inside the
  // function is unreliable. This endpoint only READS low-stock data and pushes
  // a digest to admins — it exposes nothing to the caller and writes nothing.
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Ask Postgres what's low (count + ready-to-send body).
  const { data: digest, error: digestErr } = await supabase
    .rpc("get_low_stock_digest")
    .single<{ alert_count: number; body: string }>();

  if (digestErr) return json({ error: digestErr.message }, 500);
  if (!digest || digest.alert_count === 0) {
    return json({ sent: 0, reason: "no low-stock SKUs" }, 200);
  }

  // 2) Resolve recipients: every admin/manager.
  const { data: admins, error: adminErr } = await supabase
    .from("user_profiles")
    .select("id")
    .in("role", ["admin", "manager"]);

  if (adminErr) return json({ error: adminErr.message }, 500);
  if (!admins?.length) return json({ sent: 0, reason: "no admins" }, 200);

  const title =
    digest.alert_count === 1
      ? "1 product is running low"
      : `${digest.alert_count} products are running low`;

  // 3) Fan out through the existing send-push function (handles VAPID + webpush).
  const sendUrl = `${SUPABASE_URL}/functions/v1/send-push`;
  let sent = 0;
  for (const a of admins) {
    try {
      const res = await fetch(sendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          user_id: a.id,
          title,
          body: digest.body,
          url: "/inventory",
        }),
      });
      if (res.ok) sent++;
    } catch {
      // non-critical — one failed recipient shouldn't abort the digest
    }
  }

  return json({ sent, attempted: admins.length, alert_count: digest.alert_count }, 200);
});

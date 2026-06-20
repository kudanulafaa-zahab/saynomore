import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3.0";

// VAPID keys are stored as JWK JSON strings (not base64) to avoid any decoding
// ambiguity. VAPID_PUBLIC_JWK / VAPID_PRIVATE_JWK are set as edge secrets.
const VAPID_PUBLIC_JWK = JSON.parse(Deno.env.get("VAPID_PUBLIC_JWK")!);
const VAPID_PRIVATE_JWK = JSON.parse(Deno.env.get("VAPID_PRIVATE_JWK")!);
const VAPID_SUBJECT = "mailto:admin@saynomore.mv";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: object, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function getAppServer() {
  const vapidKeys = await webpush.importVapidKeys(
    { publicKey: VAPID_PUBLIC_JWK, privateKey: VAPID_PRIVATE_JWK },
    { extractable: false },
  );
  return await webpush.ApplicationServer.new({
    contactInformation: VAPID_SUBJECT,
    vapidKeys,
  });
}

Deno.serve(async (req) => {
  // Browser preflight — must answer with CORS headers or the fetch is blocked
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const { user_id, title, body, url } = await req.json() as {
    user_id: string;
    title: string;
    body: string;
    url?: string;
  };

  if (!user_id || !title) {
    return json({ error: "user_id and title required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .eq("user_id", user_id);

  if (error) return json({ error: error.message }, 500);
  if (!subs?.length) return json({ sent: 0, attempted: 0 }, 200);

  let appServer: Awaited<ReturnType<typeof getAppServer>>;
  try {
    appServer = await getAppServer();
  } catch (e) {
    return json({ error: `VAPID key error: ${(e as Error).message}` }, 500);
  }

  const payload = JSON.stringify({ title, body, url });
  const errors: string[] = [];
  let sent = 0;

  for (const s of subs as { endpoint: string; p256dh: string; auth_key: string }[]) {
    try {
      const subscriber = appServer.subscribe({
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth_key },
      });
      await subscriber.pushTextMessage(payload, {});
      sent++;
    } catch (e) {
      errors.push(String((e as Error).message ?? e));
    }
  }

  return json({ sent, attempted: subs.length, errors }, 200);
});

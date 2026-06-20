import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = "mailto:admin@saynomore.mv";

// ── VAPID JWT ────────────────────────────────────────────────────────────────

function base64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function buildVapidHeaders(audience: string): Promise<Record<string, string>> {
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))
  );

  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: VAPID_SUBJECT })
    )
  );

  const signingInput = `${header}.${payload}`;

  // Import the private key (PKCS8 DER, base64-encoded)
  const keyBytes = Uint8Array.from(atob(VAPID_PRIVATE_KEY), (c) => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;

  return {
    Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
    "Content-Type": "application/octet-stream",
  };
}

// ── Encrypt payload (RFC 8291 / AES-128-GCM) ─────────────────────────────────

async function encryptPayload(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  plaintext: string
): Promise<{ ciphertext: ArrayBuffer; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const b64d = (s: string) =>
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

  const clientPublicKey = b64d(subscription.keys.p256dh);
  const authSecret = b64d(subscription.keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Generate server ECDH key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );

  const serverPublicKeyBuffer = await crypto.subtle.exportKey("raw", serverKeyPair.publicKey);

  const clientKey = await crypto.subtle.importKey(
    "raw",
    clientPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const sharedSecret = await crypto.subtle.deriveKey(
    { name: "ECDH", public: clientKey },
    serverKeyPair.privateKey,
    { name: "HKDF", hash: "SHA-256", salt: authSecret, info: new TextEncoder().encode("Content-Encoding: auth\0") },
    false,
    ["deriveKey"]
  );

  const enc = new TextEncoder();
  const serverPublicKey = new Uint8Array(serverPublicKeyBuffer);
  const keyInfo = new Uint8Array([
    ...enc.encode("Content-Encoding: aesgcm\0"),
    0x00, 0x41, ...clientPublicKey,
    0x00, 0x41, ...serverPublicKey,
  ]);

  const nonceInfo = new Uint8Array([
    ...enc.encode("Content-Encoding: nonce\0"),
    0x00, 0x41, ...clientPublicKey,
    0x00, 0x41, ...serverPublicKey,
  ]);

  const contentEncryptionKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: keyInfo },
    sharedSecret,
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt"]
  );

  const nonceDerived = await crypto.subtle.exportKey(
    "raw",
    await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info: nonceInfo },
      sharedSecret,
      { name: "AES-GCM", length: 128 },
      true,
      ["encrypt"]
    )
  );
  const nonce = new Uint8Array(nonceDerived).slice(0, 12);

  const paddedPayload = new Uint8Array([0, 0, ...enc.encode(plaintext)]);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    contentEncryptionKey,
    paddedPayload
  );

  return { ciphertext, salt, serverPublicKey };
}

// ── Send one push ─────────────────────────────────────────────────────────────

async function sendPush(
  endpoint: string,
  p256dh: string,
  authKey: string,
  payload: object
) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const vapidHeaders = await buildVapidHeaders(audience);

  const { ciphertext, salt, serverPublicKey } = await encryptPayload(
    { endpoint, keys: { p256dh, auth: authKey } },
    JSON.stringify(payload)
  );

  const body = new Uint8Array([...salt, ...serverPublicKey, ...new Uint8Array(ciphertext)]);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...vapidHeaders,
      "Content-Encoding": "aesgcm",
      Encryption: `salt=${btoa(String.fromCharCode(...salt)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")}`,
      "Crypto-Key": `dh=${btoa(String.fromCharCode(...serverPublicKey)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")}; keyid=p256ecdsa`,
      "Content-Length": String(body.byteLength),
      TTL: "86400",
    },
    body,
  });

  return res.status;
}

// ── Handler ───────────────────────────────────────────────────────────────────

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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .eq("user_id", user_id);

  if (error) return json({ error: error.message }, 500);
  if (!subs?.length) return json({ sent: 0 }, 200);

  const results = await Promise.allSettled(
    subs.map((s: { endpoint: string; p256dh: string; auth_key: string }) =>
      sendPush(s.endpoint, s.p256dh, s.auth_key, { title, body, url })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => String(r.reason));

  return json({ sent, attempted: subs.length, errors }, 200);
});

// Prepare a LOCAL database for the browser audits.
//
// Refuses to run against anything that is not localhost. The audits create
// orders and move stock; pointing them at production would post real sales.
//
// Does three things:
//   1. applies supabase/fixtures/ui_fixture.sql
//   2. creates the audit sign-in through the real signup endpoint — which also
//      exercises handle_new_user, the trigger whose missing search_path made
//      every rebuilt database reject account creation until migration 0166
//   3. promotes that account to admin so every screen is reachable
//
// Usage:  node scripts/audit/seed.mjs

import { execFileSync } from "node:child_process";
import { EMAIL, PASSWORD } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API = process.env.AUDIT_SUPABASE_URL || "http://127.0.0.1:54321";
const ANON = process.env.AUDIT_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// ── Guard. Non-negotiable: these scripts write orders and stock movements. ───
// Parsed, not pattern-matched. A regex over the whole string got this wrong on
// the very first run — `postgres:postgres@127.0.0.1` has the credentials where
// it expected the host — and a safety check that mis-reads its input is worse
// than none, because it teaches you to ignore it.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
for (const [name, value] of [["AUDIT_DB_URL", DB], ["AUDIT_SUPABASE_URL", API]]) {
  let host;
  try { host = new URL(value).hostname; } catch { host = null; }
  if (!host || !LOCAL_HOSTS.has(host)) {
    console.error(`REFUSING TO RUN: ${name} points at "${host ?? value}", which is not local.`);
    console.error("The audits create orders and deduct stock. They only ever run against a disposable database.");
    process.exit(2);
  }
}

const psql = (args) => execFileSync("psql", [DB, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

console.log("→ applying supabase/fixtures/ui_fixture.sql");
psql(["-v", "ON_ERROR_STOP=1", "-q", "-f", "supabase/fixtures/ui_fixture.sql"]);

console.log(`→ creating ${EMAIL} through the real signup endpoint`);
const res = await fetch(`${API}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!res.ok) {
  const body = await res.text();
  // Already registered is fine on a re-run; anything else is a real failure and
  // usually means handle_new_user cannot write user_profiles.
  if (!/already registered|User already exists/i.test(body)) {
    console.error(`signup failed (${res.status}): ${body.slice(0, 300)}`);
    process.exit(1);
  }
  console.log("   (already existed)");
}

console.log("→ confirming the address and promoting to admin");
psql(["-v", "ON_ERROR_STOP=1", "-q", "-c",
  `update auth.users set email_confirmed_at = now() where email = '${EMAIL}';
   update user_profiles set role = 'admin'
     where id = (select id from auth.users where email = '${EMAIL}');`]);

const profiles = psql(["-tAc",
  `select role from user_profiles where id = (select id from auth.users where email = '${EMAIL}')`]).trim();
if (profiles !== "admin") {
  console.error(`Expected an admin profile for ${EMAIL}, got "${profiles}".`);
  console.error("If this is empty, handle_new_user did not create the row — check its search_path (see migration 0166).");
  process.exit(1);
}

console.log("Seeded.");

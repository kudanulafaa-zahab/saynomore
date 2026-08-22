// Ask the live business whether its own arithmetic still agrees with itself.
//
// `npm run ledger`
//
// This is the production half of migration 0194. The pgTAP suite proves the
// detector CAN fire, on a database built for the purpose; this points it at the
// real one and prints the answer.
//
// WHY IT IS A SCRIPT AND NOT A SCREEN. A row here is not a job Ali can do —
// "batch per-pack disagrees with per-piece" is a bug report addressed to
// whoever is working on the app. This app's own rule is that every alert must
// be actionable or absent, so it stays out of his way and lives where the
// person who can fix it will see it.
//
// It reads and never writes. Safe to run against production, which is the whole
// point: the X-Tra Kering XXXL fault (MVR 88.63 of profit on a pack reported as
// MVR 133.97) was found by a sweep run by hand, once, during an unrelated
// audit — and a second copy of the same fault survived the first fix and had to
// be found the same lucky way.

import { readFileSync } from "node:fs";

function env(name) {
  // .env.local first so a local run needs no exports; real env wins.
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n").find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : null;
  } catch { return null; }
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and a key (service role, or anon while signed in).");
  process.exit(2);
}

const res = await fetch(`${url}/rest/v1/rpc/get_ledger_integrity`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: "{}",
});
if (!res.ok) {
  console.error(`Could not reach the ledger check: ${res.status} ${await res.text()}`);
  process.exit(2);
}

const rows = await res.json();
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("The ledger check returned nothing — that is itself a fault.");
  process.exit(2);
}

const bad = rows.filter((r) => Number(r.bad_rows) > 0);
const examined = rows.reduce((n, r) => n + Number(r.rows_examined), 0);

// "All clear" over an empty database is not all clear. Say what was looked at.
console.log(`\n  ${rows.length} invariants · ${examined.toLocaleString()} rows examined\n`);
for (const r of rows) {
  const n = Number(r.bad_rows);
  const mark = n > 0 ? "✗" : "✓";
  const tail = n > 0 ? `${n} WRONG of ${r.rows_examined}` : `${r.rows_examined}`;
  console.log(`  ${mark} ${String(r.check_name).padEnd(38)} ${tail}`);
}

if (examined === 0) {
  console.error("\n  Nothing was examined — the guard is not guarding anything.\n");
  process.exit(2);
}
if (bad.length > 0) {
  console.error(`\n  ${bad.length} invariant(s) BROKEN. These are money and stock figures that`);
  console.error("  disagree with themselves — find the cause before shipping anything else.\n");
  process.exit(1);
}
console.log("\n  The ledger agrees with itself.\n");

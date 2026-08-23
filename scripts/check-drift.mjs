// Does production have the schema its own migrations build?
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// `db-tests.yml` replays every migration onto a fresh Postgres and runs 351
// pgTAP tests against the result. That is the whole guarantee that the money
// and stock engines are right — and it is worth exactly nothing if the schema
// it builds is not the schema production has. CI would be testing a database
// that does not exist, and green would mean less than it looks like.
//
// docs/OPEN.md carried ONE drifted column, noticed in passing. Running this
// found THREE, all on sales_orders: godown_id, dispatched_at, payment_ref —
// 486 columns against 483, with every other one of the 45 tables and views
// identical. The register was right that there was a problem and wrong about
// its size, which is the exact failure mode a register exists to prevent.
// Migration 0198 dropped them after proving all three dead.
//
// ── WHY IT IS NOT AN AUDIT ─────────────────────────────────────────────────
//
// Every browser audit refuses to run against anything but a local database,
// because this repo is PUBLIC and an audit writes real rows. This one is the
// opposite by nature: it can only do its job by reading production. So it is
// deliberately not in `audit:ui` and not in CI, which has no production
// credentials and must never have any.
//
// It reads INFORMATION_SCHEMA only — table names, column names, types. It never
// selects a row, so no business figure can reach a log or a terminal. Run it by
// hand after any schema change:
//
//     PROD_DB_URL=postgresql://… npm run drift
//
// Compares against the LOCAL database, which is the migrations made real — so
// `npx supabase db reset` first if the local one has drifted itself.

import { execFileSync } from "node:child_process";

const LOCAL = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PROD  = process.env.PROD_DB_URL;

if (!PROD) {
  console.error(
    "PROD_DB_URL is not set.\n" +
    "This check compares production's schema with the one the migrations build,\n" +
    "so it needs a production connection string. It reads information_schema\n" +
    "only — never a row of business data.\n\n" +
    "  PROD_DB_URL='postgresql://…' npm run drift"
  );
  process.exit(2);
}

// The local side must genuinely BE the migrations, not a database that has
// itself drifted. Nothing here can prove that, so say it rather than imply it.
const localHost = (() => { try { return new URL(LOCAL).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(localHost ?? "")) {
  console.error(`REFUSING: the LOCAL side points at "${localHost ?? LOCAL}", which is not local.`);
  process.exit(2);
}

const SHAPE = `
  select table_name || '.' || column_name || ' :: ' || data_type
    from information_schema.columns
   where table_schema = 'public'
   order by 1;
`;

const shapeOf = (url) =>
  execFileSync("psql", [url, "-tAc", SHAPE], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);

let local, prod;
try {
  local = shapeOf(LOCAL);
  prod  = shapeOf(PROD);
} catch (e) {
  console.error("Could not read a schema:", String(e.message).split("\n")[0]);
  process.exit(2);
}

// THE GUARD IS GUARDING SOMETHING. Two empty lists also compare equal, which is
// how a check like this quietly stops checking.
if (local.length < 100 || prod.length < 100) {
  console.error(`REFUSING: read ${local.length} local and ${prod.length} production columns — too few to be a real schema.`);
  process.exit(2);
}

const localSet = new Set(local);
const prodSet  = new Set(prod);
const onlyProd  = prod.filter((c) => !localSet.has(c));
const onlyLocal = local.filter((c) => !prodSet.has(c));

console.log(`  migrations build ${local.length} columns · production has ${prod.length}\n`);

if (onlyProd.length === 0 && onlyLocal.length === 0) {
  console.log("✓ No drift — production is exactly what the migrations build.\n");
  process.exit(0);
}

if (onlyProd.length) {
  console.log(`✗ ${onlyProd.length} in PRODUCTION but created by no migration:`);
  for (const c of onlyProd) console.log(`    ${c}`);
  console.log("    → either add the migration that creates it, or drop it once proven dead.\n");
}
if (onlyLocal.length) {
  console.log(`✗ ${onlyLocal.length} built by a migration but MISSING from production:`);
  for (const c of onlyLocal) console.log(`    ${c}`);
  console.log("    → a migration has not been applied to production.\n");
}
console.log("FAILED — CI is testing a schema production does not have.");
process.exit(1);

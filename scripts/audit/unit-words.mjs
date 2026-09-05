// A unit word is never typed into a screen. It is read from the product.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
//
// Ali, 2026-09-05, with a screenshot of the Products list:
//   *"Why is it still showing cartons for body butter?"*
//
// It was the fourth time in a month that a hardcoded unit word reached him —
// "1/pk × 1/ctn" on a tub, "MVR 380 per ctn" for a product with no carton,
// "12 piece" on an order detail in a business that never sells pieces. Each
// time it was fixed on the screen where he found it, and each time it survived
// somewhere else, because the same string was typed into thirty other files.
//
// Three independent design audits on 2026-09-05 all landed on the same root
// cause: `lib/trade-units.ts` already contains the correct answer for every
// unit string in the app — `containerLabel`, `packConfigText`, `headlineTier`,
// `sellUnitLabel`, `formatQtyInTradeUnits` — and screens hand-roll their own
// instead. Four separate private copies of one quantity formatter were found,
// each with a different set of bugs.
//
// So this is the door lock. A fix that is not enforced is a fix with a
// half-life.
//
// ── WHAT IT BANS, AND WHAT IT DOES NOT ────────────────────────────────────
//
// Banned: a unit NOUN written as a literal in JSX text or in a template
// string that reaches the screen — "/ctn", " ctn", "/pk", "pcs", "pieces",
// "per carton", "per pack". Those are answers that belong to the product.
//
// Not banned, deliberately:
//   - the same words inside a COMMENT (that is how the rules are explained)
//   - `lib/trade-units.ts` itself, which is where the words legitimately live
//   - Postgres, SQL and tests — pieces are the ledger's real unit
//   - Market/competitor screens, where per-piece is the only comparable unit
//     across rivals selling 30s, 34s and 48s (CLAUDE.md states this exemption)
//
// A baseline per file, ratcheting down, same as the touch audits: a number may
// only fall. Fixing thirty files in one commit is the batch CLAUDE.md forbids.
//
// Usage:  node scripts/audit/unit-words.mjs [--report]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checklist, finish } from "./lib.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const SCAN = ["components", "app"];

// The exemption list, with a reason each. Nothing is exempt "for now".
const EXEMPT = [
  // The one place a unit noun is allowed to be written down.
  "lib/trade-units.ts",
  // Rivals sell 30s, 34s and 48s, so per-piece is the only comparable unit —
  // CLAUDE.md names this as the single deliberate exception.
  "components/competitors/",
];

const BASELINE = JSON.parse(
  readFileSync(new URL("./unit-words.baseline.json", import.meta.url), "utf8")
);

/** A unit noun that has reached the screen as a literal. */
const PATTERNS = [
  /\/ctn\b/,
  /\bctn\b/,
  /\/pk\b/,
  /\bpcs\b/,
  /\bpieces?\b/i,
  /per carton/i,
  /per pack/i,
  /packs?\/day/i,
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(abs);
  }
  return out;
}

/** Strip comments so the RULES can be written in English without tripping the
 *  rule they describe — this file, and every migration header, says "pieces"
 *  many times on purpose. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const files = SCAN.flatMap((d) => walk(join(ROOT, d)));
const seen = {};
const found = {};

for (const abs of files) {
  const rel = relative(ROOT, abs);
  if (EXEMPT.some((e) => rel.startsWith(e) || rel === e)) continue;
  const src = stripComments(readFileSync(abs, "utf8"));
  const hits = [];
  src.split("\n").forEach((line, i) => {
    for (const re of PATTERNS) {
      if (re.test(line)) { hits.push({ line: i + 1, text: line.trim().slice(0, 100) }); break; }
    }
  });
  if (hits.length > 0) { seen[rel] = hits.length; found[rel] = hits; }
}

const report = process.argv.includes("--report");
const list = checklist("Unit words come from the product, never from the screen");

if (!report) {
  for (const [file, count] of Object.entries(seen)) {
    const allowed = BASELINE[file] ?? 0;
    list.ok(count <= allowed,
      `${file}: ${count} hardcoded unit word(s) (baseline ${allowed})` +
      found[file].slice(0, 3).map((h) => `\n        :${h.line}  ${h.text}`).join(""));
  }
  // A file that has NO baseline entry and no hits is silent; a file that was
  // cleaned must have its entry removed, or the gain can be lost again.
  const slack = Object.entries(BASELINE)
    .filter(([f, n]) => typeof n === "number" && (seen[f] ?? 0) < n);
  list.ok(slack.length === 0,
    `${slack.length} file(s) are now better than their baseline — tighten it` +
    slack.slice(0, 8).map(([f, n]) => `\n        ${f}: ${seen[f] ?? 0} now, baseline ${n}`).join(""));
}

const total = Object.values(seen).reduce((a, b) => a + b, 0);
console.log(`\n  hardcoded unit words: ${total} across ${Object.keys(seen).length} files`);
for (const [f, c] of Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  const base = BASELINE[f] ?? 0;
  console.log(`    ${String(c).padStart(3)}  ${f}${c > base ? `   OVER baseline ${base}` : ""}`);
}

if (report) {
  console.log("\nBaseline block — paste into scripts/audit/unit-words.baseline.json:\n");
  console.log(JSON.stringify(seen, null, 2));
  process.exit(0);
}

finish(list.report());

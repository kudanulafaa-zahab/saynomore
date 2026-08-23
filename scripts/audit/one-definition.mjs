// One concept, defined once.
//
// THE BUG CLASS THIS EXISTS TO STOP, with three cases in one week:
//
//   UnitUom      lib/trade-units.ts said eleven units; lib/queries/products.ts
//                declared its own of THREE. The New Category form imported the
//                short one, so there was no way to say a bedding item is a
//                "set" or a body butter comes in a "tub" — Bodybutter's tub had
//                to be set by a migration because the form could not express it.
//                Ali hit this as "How do I add ikea? It's very complicated."
//
//   SellUnit     Declared identically in both of those files. Harmless right up
//                until one of them is extended — which is precisely how UnitUom
//                got stuck at three values while the rest of the app knew eleven.
//
//   FobCurrency  lib/queries/shipments.ts said IDR|USD|MVR; lib/queries/costing.ts
//                said USD|IDR|MVR. Same members, different order, one edit away
//                from not being the same type at all.
//
// None of these fail a build. Both copies compile, both look right in review,
// and the divergence only shows up as a feature that is quietly impossible.
// A comment saying "don't declare this twice" would have been read by nobody;
// this runs in the gate.
//
// The same rule covers helpers, not just types. CLAUDE.md already says of
// formatQtyInTradeUnits: "it already exists, do not write a second one." That
// is this check, for values.
//
// Pure text over the source tree — no browser, no database, no build. Runs in
// well under a second, so it goes first.
//
// Usage:  npm run audit:onedef

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checklist, finish } from "./lib.mjs";

const ROOTS = ["lib", "components", "app", "scripts"];

// Next.js OWNS these names. A route file must export a function called GET; a
// page may export a const called metadata. They are duplicated by design, in
// every framework project that has ever existed, and they say nothing about
// whether a concept is defined twice. Only forgiven in the files the framework
// actually reads.
const FRAMEWORK_EXPORTS = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
  "metadata", "generateMetadata", "viewport", "generateViewport",
  "dynamic", "revalidate", "runtime", "fetchCache", "maxDuration",
  "preferredRegion", "generateStaticParams", "dynamicParams",
]);
const isFrameworkFile = (f) => /(^|\/)(route|page|layout|template|error|loading|not-found)\.tsx?$/.test(f);

// A TYPE and a COMPONENT may share a name — `MorningBriefing` the shape and
// `MorningBriefing` the thing that renders it is ordinary React, not a second
// definition of one concept. So a clash only counts when both sides are the
// same kind of thing.
const TYPEISH = new Set(["type", "interface", "enum"]);
const category = (kind) => (TYPEISH.has(kind) ? "type" : "value");

const files = [];
for (const root of ROOTS) {
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts)$/.test(p)) files.push(p);
    }
  })(root);
}

// Only a DECLARATION counts. `export type { SellUnit }` is the fix, not the
// fault — it has a brace where a declaration has a name, so it never matches.
const DECLARATION = /^export\s+(?:declare\s+)?(?:async\s+)?(type|interface|enum|const|function|class|let|var)\s+([A-Za-z_$][\w$]*)/gm;

const seen = new Map();
for (const file of files) {
  for (const m of readFileSync(file, "utf8").matchAll(DECLARATION)) {
    const [, kind, name] = m;
    if (FRAMEWORK_EXPORTS.has(name) && isFrameworkFile(file)) continue;
    const key = `${category(kind)} ${name}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(file);
  }
}

const clashes = [...seen.entries()]
  .map(([key, where]) => [key, [...new Set(where)]])
  .filter(([, where]) => where.length > 1)
  .sort();

const list = checklist("One concept, defined once");

// ── Money is formatted in ONE module ───────────────────────────────────────
//
// Twenty-three private money formatters existed across twenty-one files —
// `fmt`, `fmt0`, `fmt2`, `fmtMvr`, `fmtMoney`, `fmtShort`, `fmtInt` — each
// taking a bare `number`. They were invisible to the export check above
// because they are module-PRIVATE: `function fmt(...)` with no `export`, so
// two files never clash.
//
// What they cost, measured on the values the app actually hands them:
//
//     fmt0(null)       ->  "0"     a missing figure displayed as MVR 0
//     fmt0(undefined)  ->  "NaN"   shown to the user, on screen
//
// "0" is the dangerous one: a number Ali can read, sanity-check and price
// against, where the truth is "we do not know". The same class crashed the
// Pricing Tool outright when a null reached `.toLocaleString` — that one at
// least failed loudly. They also disagreed on LOCALE, half formatting money in
// whatever the viewer's phone is set to.
//
// They all delegate to lib/money.ts now. This stops the twenty-fourth.
// STATED AS AN INVARIANT OVER THE WHOLE FILE, not over each declaration.
//
// Two earlier shapes of this check both failed, and the reasons are worth
// keeping. Looking only for helpers named `fmt*` walked straight past six more
// called `mvr`, `mvrShort`, `num`, `int` and `money`. Widening it to ANY name
// then flagged whole components, because a 900-line component's body contains
// an inline call somewhere and brace-matching swallows all of it.
//
// The invariant that is actually true, now that every money call goes through
// lib/money.ts, is simpler than either: OUTSIDE lib/, no toLocaleString with
// NUMBER options exists at all — not in a helper, not inline. Date formatting
// is untouched and legitimate, so an argument list carrying date options is
// not money and is skipped.
const DATE_OPTS = /\b(month|weekday|day|year|hour|minute|second|timeZone|dateStyle|timeStyle|era)\b/;
const NUMBER_OPTS = /\b(minimumFractionDigits|maximumFractionDigits|minimumIntegerDigits|notation|currency)\b/;

function argsOf(src, callIndex) {
  const open = src.indexOf("(", callIndex);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return "";
}

const offenders = [];
for (const file of files) {
  if (file.startsWith("lib/")) continue;          // lib/money.ts is the one home
  const src = readFileSync(file, "utf8");
  let at = -1;
  while ((at = src.indexOf(".toLocaleString", at + 1)) !== -1) {
    const args = argsOf(src, at + ".toLocaleString".length);
    if (DATE_OPTS.test(args)) continue;           // a date, not money
    if (!NUMBER_OPTS.test(args) && args.trim() !== "" && args.trim() !== "undefined") continue;
    offenders.push(`${file}:${src.slice(0, at).split("\n").length}`);
  }
}
list.ok(offenders.length === 0,
  offenders.length
    ? `${offenders.length} money toLocaleString call(s) outside lib/money.ts: ${offenders.slice(0, 6).join(", ")}`
    : "money is formatted only in lib/money.ts — no number formatting anywhere else");

// ── And that module behaves ───────────────────────────────────────────────
// A missing value must read "—", never "0" and never "NaN". Postgres numerics
// arrive as STRINGS through PostgREST, so a string must still format — nine of
// the helpers replaced here wrapped their argument in Number() for exactly that
// reason, and a module that only took `number` would have turned every real
// figure into "—", a worse bug than the one being fixed.
const { mvr, mvr2, mvrShort, mvrCeil } = await import("../../lib/money.ts");
const cases = [
  [mvr(1234567.891), "1,234,568",     "a plain number is grouped"],
  [mvr("1234.50"),   "1,235",         "a Postgres numeric STRING still formats"],
  [mvr2("1234.50"),  "1,234.50",      "and keeps its laari at two decimals"],
  [mvr(0),           "0",             "a real zero is still a zero"],
  [mvr(null),        "—",             "null reads as unknown, NOT as 0"],
  [mvr(undefined),   "—",             "undefined reads as unknown, not NaN"],
  [mvr(NaN),         "—",             "NaN never reaches the screen"],
  [mvr(""),          "—",             "an empty string is not a confident zero"],
  [mvr(Infinity),    "—",             "a divide-by-zero does not print an infinity sign"],
  [mvrShort(-2500000), "-2.5M",       "a NEGATIVE abbreviates — the old helpers printed it in full"],
  [mvrShort(2500000),  "2.5M",        "millions abbreviate everywhere (Expenses used to say 2500.0K)"],
  [mvrShort(null),   "—",             "and an absent figure stays absent when abbreviated"],
  [mvrCeil(2.1),     "3",             "a part unit still costs a whole one"],
];
for (const [got, want, why] of cases) list.is(got, want, why);

for (const [key, where] of clashes) {
  list.ok(false, `${key} is declared in ${where.length} modules — ${where.join(", ")}. ` +
    `Keep the one that owns the concept and re-export from the other: export type { X } from "…".`);
}
if (clashes.length === 0) {
  list.ok(true, `no exported name is declared in two modules (${seen.size} exports across ${files.length} files)`);
}

// THE GUARD IS GUARDING SOMETHING. Zero clashes is also the answer if the walk
// found nothing, or if the regex stopped matching because the codebase moved to
// a different export style. Both would make this file pass forever while
// checking nothing — which is how a gate quietly retires.
list.ok(files.length > 150, `and it actually read the source tree (${files.length} files)`);
list.ok(seen.size > 400, `finding a real number of exports to compare (${seen.size})`);
// The three types the incident was about must still be reachable as ONE
// definition each. If a future refactor deletes lib/trade-units.ts the check
// above goes quiet; this one does not.
const canon = readFileSync("lib/trade-units.ts", "utf8");
for (const t of ["UnitUom", "SellUnit"]) {
  list.ok(new RegExp(`^export type ${t}\\b`, "m").test(canon),
    `${t} is still declared in lib/trade-units.ts, which owns it`);
}

finish(list.report());

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

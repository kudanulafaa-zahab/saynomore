// Is it actually live? — the definition of done.
//
// Ali, 2026-08-15: "After this always remember to deploy to production. I do
// not want to remind you every time. You are not following this command?"
//
// He was right, and he had already been right once before. The rule was written
// down ("merged is not live", CLAUDE.md hard rule 6) and I still stopped at
// "PR open, CI running" and reported that as progress. A rule that depends on
// remembering gets forgotten. A command does not.
//
// This asks the ONE question that matters and answers it from outside the
// build: what commit is the app on saynomore-beta.vercel.app actually serving,
// and is it the same one that is on origin/main? Everything else — pushed,
// merged, green, READY — is a step, not the finish.
//
// It deliberately does NOT use the Vercel API. A token-based check would prove
// what Vercel BELIEVES it deployed; fetching the running app proves what the
// phone in Ali's hand will load. Those are not always the same thing — an alias
// can point at an older deployment, which is exactly the failure "merged is not
// live" was written about.
//
// Usage:  npm run shipped
//         npm run shipped -- --wait     (poll until it matches, up to 5 min)

import { execSync } from "node:child_process";

const URL_BASE = process.env.SHIPPED_URL || "https://saynomore-beta.vercel.app";
const WAIT = process.argv.includes("--wait");
const DEADLINE_MS = 5 * 60 * 1000;

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

function fail(msg, detail) {
  console.error(`\n  NOT SHIPPED — ${msg}`);
  if (detail) console.error(`  ${detail}`);
  console.error("");
  process.exit(1);
}

// What SHOULD be live: whatever main is at right now.
execSync("git fetch origin main --quiet", { stdio: "ignore" });
const mainSha = sh("git rev-parse origin/main");

// Anything still only on this branch has not shipped, whatever CI says.
const branch = sh("git rev-parse --abbrev-ref HEAD");
let unmerged = "";
try {
  unmerged = sh(`git log --oneline origin/main..HEAD`);
} catch { /* detached or no upstream — the live check below still applies */ }

async function liveSha() {
  const res = await fetch(`${URL_BASE}/api/version`, {
    headers: { "cache-control": "no-cache" },
  });
  if (!res.ok) throw new Error(`${URL_BASE}/api/version returned ${res.status}`);
  const body = await res.json();
  return body.sha;
}

let live;
const started = Date.now();
for (;;) {
  try {
    live = await liveSha();
  } catch (e) {
    // Before this endpoint existed anywhere, a 404 is the expected answer and
    // says nothing about the deploy. Say so rather than claiming a failure.
    fail("could not read the live version", String(e).slice(0, 160)
      + "\n  (if this 404s, the version endpoint has not shipped yet — deploy once, then this works)");
  }
  if (live === mainSha) break;
  if (!WAIT || Date.now() - started > DEADLINE_MS) break;
  process.stdout.write(".");
  await new Promise((r) => setTimeout(r, 15000));
}

if (unmerged) {
  fail(
    `${unmerged.split("\n").length} commit(s) on "${branch}" are not in main`,
    unmerged.split("\n").map((l) => `    ${l}`).join("\n").trim(),
  );
}

if (live !== mainSha) {
  fail(
    "production is serving a different commit than main",
    `main is  ${mainSha.slice(0, 7)}\n  live is  ${String(live).slice(0, 7)}\n`
      + `  The merge happened but the deploy has not finished or the alias still\n`
      + `  points at an older build. Re-run with --wait, or check Vercel.`,
  );
}

console.log(`\n  SHIPPED — ${URL_BASE} is serving ${mainSha.slice(0, 7)}, which is main.\n`);

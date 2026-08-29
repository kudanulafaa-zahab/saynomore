// Shared plumbing for the browser audits.
//
// These exist because for months the only thing checking a SayNoMore screen was
// Ali opening it on his phone. The money and stock code has 170+ pgTAP tests and
// has not produced an incident; the UI had none, and every UI defect this month
// was found by him after it shipped. Same app, different halves — the
// difference is that one half checks itself.
//
// Everything here is deliberately dependency-light: plain Playwright, no test
// runner. An audit is a script that exits 0 or 1, so it works identically on a
// laptop and in CI, and its output is meant to be read by a person.

import { chromium } from "playwright";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export const BASE = process.env.AUDIT_BASE_URL || "http://localhost:3000";
export const EMAIL = process.env.AUDIT_EMAIL || "fixture@test.local";
export const PASSWORD = process.env.AUDIT_PASSWORD || "Fixture123!";

// The Chromium that ships in this environment; Playwright's own download is
// disabled here (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD), so point at it explicitly
// when it exists and let Playwright find its own elsewhere (e.g. CI).
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium";

/** Every device class the app actually ships to, named rather than numbered. */
export const DEVICES = {
  phone:   { width: 393,  height: 852,  dpr: 3 },  // iPhone 15 Pro
  tablet:  { width: 820,  height: 1180, dpr: 2 },  // iPad Air portrait
  desktop: { width: 1512, height: 945,  dpr: 2 },  // 14" MacBook Pro
};

/** Palettes the audits sweep. Kept in step with lib/palette.ts by hand — a
 *  mismatch shows up immediately as an audit that skips a theme. */
// Adding a palette here is the whole registration for the automated gate:
// audit:contrast measures every screen in every palette in both schemes, so a
// new theme arrives already measured (5 x 2 x 20 = 200 cases) rather than
// being checked by eye once and then never again.
export const PALETTES = ["ember", "aurora"];

// ── Every screen in the app, read from the routes on disk ──────────────────
//
// WHY THIS IS DERIVED AND NOT A LIST. It used to be a list, hand-kept in BOTH
// material.mjs and contrast.mjs, and on 2026-08-22 a route audit found that
// SEVEN of the app's twenty screens were on neither: competitors, costing,
// customers, deliveries, dispatch, godowns, stock-ops. Thirty-five per cent of
// the app had never had a single word's contrast measured or a single surface
// checked against the theme — and `components/sales/my-deliveries.tsx` was
// carrying a hand-typed `box-shadow` that no palette can reach, which is
// exactly the defect the material audit exists to catch. It sat there because
// the screen was not on the list.
//
// This is hard rule 8's pattern for the third time: nav grouping was DATA once
// a second hardcoded list of hrefs shipped the Price Simulator invisible, and
// the CI workflow named each audit by hand so a new one ran locally and not in
// CI. A list a human must remember to extend is not a gate; it is a comment
// that happens to execute.
//
// So the routes come from the filesystem. Add a page, and it is measured on the
// next run by both audits, with nobody doing anything.
export function appRoutes({ skip = [] } = {}) {
  const dir = new URL("../../app/(app)/", import.meta.url).pathname;
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      // A dynamic segment needs a real id to render, so it cannot be visited
      // blind. Those screens are covered by the journey audits, which create
      // the row first and then open it.
      if (entry.name.startsWith("[")) continue;
      const nextAbs = join(abs, entry.name);
      if (entry.isDirectory()) walk(nextAbs, `${rel}/${entry.name}`);
      else if (entry.name === "page.tsx" && rel) out.push([rel.slice(1), rel]);
    }
  };
  walk(dir, "");
  return out.filter(([name]) => !skip.includes(name)).sort((a, b) => a[0].localeCompare(b[0]));
}

export async function launch() {
  const fs = await import("node:fs");
  const opts = fs.existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {};
  return chromium.launch(opts);
}

/**
 * A logged-in page at a given device size, colour scheme and palette.
 * Sets the palette BEFORE logging in so the first authenticated paint is
 * already themed — the app reads it from localStorage in an inline script.
 */
export async function signedInPage(browser, {
  device = "phone", scheme = "light", palette = null,
} = {}) {
  const d = DEVICES[device];
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
  page.errors = pageErrors;

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  if (palette) {
    await page.evaluate((v) => localStorage.setItem("snm-palette", v), palette);
    await page.reload({ waitUntil: "networkidle" });
  }
  await page.locator("input[type=email]").fill(EMAIL);
  await page.locator("input[type=password]").fill(PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  // The app redirects by role after the session lands; wait for a real app
  // route rather than a fixed timeout.
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

/** Small assertion helper. Collects rather than throws, so one run reports
 *  everything that is wrong instead of only the first thing. */
export function checklist(title) {
  const failures = [];
  let checks = 0;
  return {
    ok(condition, message) {
      checks++;
      if (!condition) failures.push(message);
    },
    is(actual, expected, message) {
      checks++;
      if (actual !== expected) failures.push(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    report() {
      if (failures.length === 0) {
        console.log(`✓ ${title} — ${checks} checks passed`);
        return 0;
      }
      console.log(`✗ ${title} — ${failures.length} of ${checks} checks FAILED`);
      for (const f of failures) console.log(`    ${f}`);
      return 1;
    },
    get failed() { return failures.length; },
  };
}

/** Exit the process the way CI expects, after flushing output. */
export function finish(code) {
  process.exitCode = code;
  if (code === 0) console.log("\nAll good.");
  else console.log("\nFAILED — see above.");
}

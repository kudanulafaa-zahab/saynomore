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
export const PALETTES = ["sunrise", "aurora", "ember", "soft"];

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

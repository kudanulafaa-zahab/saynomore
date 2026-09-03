// Every control says WHAT IT IS. Measured on the rendered page.
//
// ── WHY THIS EXISTS, AND WHY IT IS NOT A TIDINESS CHECK ───────────────────
//
// Ali, 2026-09-02, with a screenshot of the New Sale sheet. Answering it meant
// opening the product step in a test, and nothing could: the product CARD —
// the control you tap to sell something — had no accessible name. VoiceOver
// read it as a price, a provenance badge and a stock line with the product
// buried in the middle, and Playwright could not address it at all.
//
// That one missing attribute cost three CI rounds of guessing at selectors,
// and the honest conclusion at the time was to record the step as "not
// covered". So the exact screen he had photographed a 36px control on stayed
// the one screen no audit could open — because of an accessibility defect
// nobody was looking for.
//
// A control with no name is therefore two failures at once: a person using
// VoiceOver cannot tell what it does, and no test can reach it to check
// anything else about it. The second is why this audit pays for itself even
// if Ali never turns VoiceOver on.
//
// ── WHAT COUNTS AS A NAME ─────────────────────────────────────────────────
//
// The accessible name computation, simplified to the parts this app uses:
// aria-label, aria-labelledby, the control's own text, an alt on an image
// inside it, a <label> for an input, or a title. Any one is enough. Icon-only
// buttons are the ones that fail, and they fail silently — nothing looks wrong
// on screen.
//
// ── THE RATCHET, SAME AS THE TOUCH AUDIT ──────────────────────────────────
//
// A baseline per screen; the number may only go DOWN. Fixing every unnamed
// control in one commit is the batch CLAUDE.md forbids, and a pass/fail gate
// would either block every change or be switched off.
//
// Usage:  node scripts/audit/accessible-names.mjs [--report]

import { readFileSync } from "node:fs";
import { launch, signedInPage, checklist, finish, BASE, appRoutes } from "./lib.mjs";

const SCREENS = appRoutes();
const DETAIL = 8;

const BASELINE = JSON.parse(
  readFileSync(new URL("./accessible-names.baseline.json", import.meta.url), "utf8")
);

// Self-contained: page.evaluate serialises this and runs it in the browser,
// where nothing from this module exists. Same rule as lib-touch.mjs, and the
// same mistake was made there once — a wrapper closing over a module-scope
// name fails with "not defined".
const NAMELESS = () => {
  const SEL = 'button, a[href], select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"], [role="switch"], [role="option"]';
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    // A disabled control cannot be operated, so it cannot be misunderstood.
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
    // Hidden from the accessibility tree ON PURPOSE is a decision, not a gap —
    // a decorative element whose meaning is carried by a sibling.
    if (el.getAttribute("aria-hidden") === "true" || el.closest('[aria-hidden="true"]')) continue;

    const byId = (ids) => (ids || "").split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.innerText || "").join(" ").trim();

    const name =
      (el.getAttribute("aria-label") || "").trim()
      || byId(el.getAttribute("aria-labelledby"))
      || (el.innerText || "").trim()
      || (el.getAttribute("title") || "").trim()
      || (el.getAttribute("placeholder") || "").trim()
      || [...el.querySelectorAll("img[alt]")].map((i) => i.alt).join(" ").trim()
      // An input's <label>, both spellings: wrapping and for=.
      || (el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText || "").trim() : "")
      || (el.closest("label")?.innerText || "").trim()
      // A <select> with no label still announces its chosen option, which is
      // at least something; an empty one announces nothing.
      || (el.tagName === "SELECT" ? (el.selectedOptions?.[0]?.text || "").trim() : "");

    if (name) continue;

    const cls = (el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    out.push({
      what: `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`,
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      // Where it is, so a nameless icon in a corner can be found by eye.
      at: `${Math.round(r.x)},${Math.round(r.y)}`,
    });
  }
  return out;
};

const report = process.argv.includes("--report");
const browser = await launch();
const list = checklist(`Accessible names — every control says what it is, ${SCREENS.length} screens`);
const { ctx, page } = await signedInPage(browser, { device: "phone", scheme: "light" });

const seen = {};
const found = {};
for (const [name, url] of SCREENS) {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const bad = await page.evaluate(NAMELESS);
  seen[name] = bad.length;
  found[name] = bad;

  if (report) continue;
  const allowed = BASELINE[name] ?? 0;
  list.ok(bad.length <= allowed,
    `${name}: ${bad.length} control(s) with no accessible name (baseline ${allowed})` +
    bad.slice(0, 4).map((b) => `\n        ${b.size} at ${b.at}  ${b.what}`).join(""));
}

await ctx.close();
await browser.close();

// PRINT THE WHOLE TABLE, PASS OR FAIL — the number can only be driven down if
// it can be read while the gate is green.
console.log(`\n  unnamed controls, by screen:`);
for (const [n, c] of Object.entries(seen).sort((a, b) => b[1] - a[1])) {
  const base = BASELINE[n] ?? 0;
  const mark = c === 0 ? "clean" : c > base ? `OVER baseline ${base}` : c < base ? `better than ${base}` : "at baseline";
  console.log(`    ${String(c).padStart(3)}  ${n.padEnd(16)} ${mark}`);
}

const withDebt = Object.entries(found).filter(([, l]) => l.length > 0);
if (withDebt.length > 0) {
  console.log(`\n  what they are (first ${DETAIL} per screen):`);
  for (const [n, l] of withDebt.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${n}`);
    for (const b of l.slice(0, DETAIL)) console.log(`      ${b.size.padStart(8)} at ${b.at.padStart(8)}  ${b.what}`);
    if (l.length > DETAIL) console.log(`      … and ${l.length - DETAIL} more`);
  }
}

if (report) {
  console.log("\nBaseline block — paste into scripts/audit/accessible-names.baseline.json:\n");
  console.log(JSON.stringify(seen, null, 2));
  process.exit(0);
}

const slack = Object.entries(seen).filter(([n, c]) => c < (BASELINE[n] ?? 0));
list.ok(slack.length === 0,
  `${slack.length} screen(s) are now better than their baseline — tighten it so the gain cannot be lost` +
  slack.slice(0, 6).map(([n, c]) => `\n        ${n}: ${c} now, baseline ${BASELINE[n]}`).join(""));

finish(list.report());

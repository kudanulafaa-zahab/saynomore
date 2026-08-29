// Every control is big enough to hit — measured on the rendered page.
//
// Ali, 2026-08-29: *"optimize the user ui/UX experience to the latest
// standards."*
//
// ── THE STANDARD, AND WHY IT IS 44 AND NOT 24 ──────────────────────────────
//
// WCAG 2.2 SC 2.5.8 (AA) asks for 24×24 CSS px. Apple's HIG asks for 44×44pt
// and has since the first iPhone. This app is an installed iOS PWA that Ali
// uses one-handed, standing in a godown — so the HIG figure is the one that
// describes the actual use, and 24 would pass controls he cannot reliably hit.
//
// The stock Button in this repo shipped at 32px, its `sm` at 28px, and the
// close button on EVERY dialog was 28px until 2026-08-29. None of that was
// caught by eye in a year of use. It is not the kind of defect eyes catch:
// a 28px button looks fine and simply misses when you are holding a phone in
// one hand and a carton in the other.
//
// ── WHY THIS IS A RATCHET AND NOT A PASS/FAIL ──────────────────────────────
//
// There are still small controls in the app, and fixing all of them in one
// commit is exactly the batch that CLAUDE.md says degrades quality. So this
// holds a BASELINE per screen and fails only when a number goes UP. The count
// can fall to zero one screen at a time and can never quietly climb back —
// the strangler boundary, made enforceable.
//
// Run with --report to print a fresh baseline block rather than judge one.
//
// Usage:  node scripts/audit/touch-targets.mjs [--report]

import { readFileSync } from "node:fs";
import { launch, signedInPage, checklist, finish, BASE, appRoutes } from "./lib.mjs";

const SCREENS = appRoutes();
const MIN = 44;

const BASELINE = JSON.parse(
  readFileSync(new URL("./touch-targets.baseline.json", import.meta.url), "utf8")
);

const AUDIT = (min) => {
  const SEL = 'button, a[href], select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"], [role="switch"], [role="option"]';
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;

    // A LINK INSIDE A SENTENCE IS EXEMPT, in both WCAG and the HIG: padding it
    // to 44px would break the line it lives in. The test is the box, not the
    // tag — an inline-displayed anchor is running text.
    if (el.tagName === "A" && cs.display.startsWith("inline") && !cs.display.includes("block")) continue;

    // A control whose PARENT is the real tap target is not itself a target —
    // an icon inside a row that is one big link, for instance. Judging both
    // would report the row's own chevron as a defect.
    const outer = el.parentElement?.closest(SEL);
    if (outer) {
      const pr = outer.getBoundingClientRect();
      if (pr.height >= min && pr.width >= min) continue;
    }

    // The HIT AREA, not the ink. A 24px icon centred in 44px of padding is a
    // 44px target, and this is the box the browser actually routes taps to.
    if (r.width >= min && r.height >= min) continue;

    const cls = (el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    out.push({
      what: `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`,
      label: (el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 24).replace(/\n/g, " "),
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
    });
  }
  return out;
};

const report = process.argv.includes("--report");
const browser = await launch();
const list = checklist(`Touch targets — every control is at least ${MIN}x${MIN}, ${SCREENS.length} screens`);
// A phone, because that is the device the rule is about.
const { ctx, page } = await signedInPage(browser, { device: "phone", scheme: "light" });

const seen = {};
for (const [name, url] of SCREENS) {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const small = await page.evaluate(AUDIT, MIN);
  seen[name] = small.length;

  if (report) continue;
  const allowed = BASELINE[name] ?? 0;
  list.ok(small.length <= allowed,
    `${name}: ${small.length} control(s) under ${MIN}px (baseline ${allowed})` +
    small.slice(0, 4).map((s) => `\n        ${s.size}  ${s.what} "${s.label}"`).join(""));
}

await ctx.close();
await browser.close();

// PRINT THE WHOLE TABLE, PASS OR FAIL. A gate that only speaks when it is
// angry cannot be used to drive a number down — and driving this one down,
// screen by screen, is the entire point of holding a baseline.
console.log(`\n  under ${MIN}px, by screen:`);
for (const [n, c] of Object.entries(seen).sort((a, b) => b[1] - a[1])) {
  const base = BASELINE[n] ?? 0;
  const mark = c === 0 ? "clean" : c > base ? `OVER baseline ${base}` : c < base ? `better than ${base}` : `at baseline`;
  console.log(`    ${String(c).padStart(3)}  ${n.padEnd(16)} ${mark}`);
}

if (report) {
  console.log("\nBaseline block — paste into scripts/audit/touch-targets.baseline.json:\n");
  console.log(JSON.stringify(seen, null, 2));
  process.exit(0);
}

// A screen that has been FIXED below its baseline should tighten the baseline,
// or the slack it leaves is somewhere a regression can hide.
const slack = Object.entries(seen).filter(([n, c]) => c < (BASELINE[n] ?? 0));
list.ok(slack.length === 0,
  `${slack.length} screen(s) are now better than their baseline — tighten it so the gain cannot be lost` +
  slack.slice(0, 6).map(([n, c]) => `\n        ${n}: ${c} now, baseline ${BASELINE[n]}`).join(""));

finish(list.report());

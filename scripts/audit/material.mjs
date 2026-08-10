// Material audit — is the theme actually applied everywhere?
//
// Ali, 2026-08-10: "I think it's not consistent app wide." He was right, and
// this is what found where. Two causes explained all of it, and neither was
// reachable from a stylesheet: the content blur had been typed out by hand in
// 22 components, and shadows were hardcoded in 8 more. A theme could not switch
// off something no theme ever owned.
//
// So this does not check "does it look nice". It checks a structural rule that
// is either true or false: in a CARVED palette, an in-flow surface must be
// opaque, unblurred, and carrying the carve's two-shadow signature. Floating
// chrome — tab bar, sheet headers, docked footers — is exempt, because in this
// design chrome is the one thing that stays Liquid Glass.
//
// Run it after any styling change. If it reports a new pattern, something was
// styled outside the token system and the next theme will miss it too.
//
// Usage:  node scripts/audit/material.mjs [--palette soft]

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const SCREENS = [
  ["dashboard",  "/dashboard"],
  ["sales",      "/sales"],
  ["inventory",  "/inventory"],
  ["financials", "/financials"],
  ["products",   "/products"],
  ["shipments",  "/shipments"],
  ["settings",   "/settings"],
  ["reorder",    "/reorder"],
  ["pricelists", "/pricelists"],
];

// Settings shows a preview swatch per palette; those are gradients ON PURPOSE —
// they advertise the colour schemes. Excluded by selector, not by screen, so the
// rest of Settings is still audited.
const KNOWN_GOOD = '[data-palette-swatch], .snm-palette-swatch';

const AUDIT = (knownGood) => {
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { a: p.length > 3 ? p[3] : 1 };
  };
  const groups = new Map();
  const note = (key, el) => {
    if (!groups.has(key)) groups.set(key, { n: 0, sample: "" });
    const g = groups.get(key);
    g.n++;
    if (!g.sample) {
      const cls = (el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 4).join(".");
      g.sample = `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} "${(el.innerText || "").slice(0, 26).replace(/\n/g, " ")}"`;
    }
  };

  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16) continue;
    if (r.bottom <= 0 || r.top >= innerHeight) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    if (knownGood && el.closest(knownGood)) continue;

    const cs = getComputedStyle(el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || "none";
    const bg = parse(cs.backgroundColor);
    const bgi = cs.backgroundImage;
    const sh = cs.boxShadow;
    const isChrome = !!el.closest('header, footer, nav, .glass-tabbar, .glass-panel--strong, [role="dialog"] > header');

    if (!isChrome) {
      if (bf !== "none" && !/blur\(0px\)/.test(bf)) {
        note(`BLUR on in-flow content: ${bf.slice(0, 36)}`, el);
      }
      if (bg && bg.a > 0 && bg.a < 0.98 && (sh !== "none" || bgi !== "none")) {
        note(`TRANSLUCENT in-flow surface (alpha ${bg.a})`, el);
      }
      // A gradient whose stops are all the same colour paints flat — that is the
      // token bridge working, not a defect. Only a gradient that VARIES is one.
      if (/gradient/.test(bgi) && r.height > 28) {
        const stops = [...bgi.matchAll(/rgba?\([^)]+\)/g)].map((m) => m[0]);
        if (new Set(stops).size > 1) note(`GRADIENT fill: ${bgi.slice(0, 44)}`, el);
      }
      // The carve is always TWO shadows (a light one and a dark one). A single
      // drop shadow is the old glass vocabulary, hardcoded past the theme.
      if (sh !== "none") {
        const parts = sh.split(/,(?![^(]*\))/).length;
        if (parts === 1 && !/inset/.test(sh)) note(`SINGLE drop shadow (not a carve): ${sh.slice(0, 44)}`, el);
      }
    }
  }
  return [...groups.entries()].sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => ({ pattern: k, count: v.n, sample: v.sample }));
};

const palette = process.argv.includes("--palette")
  ? process.argv[process.argv.indexOf("--palette") + 1] : "soft";

const browser = await launch();
const list = checklist(`Material consistency — ${palette}, ${SCREENS.length} screens`);
const { ctx, page } = await signedInPage(browser, { palette, scheme: "light" });

for (const [name, url] of SCREENS) {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const rows = await page.evaluate(AUDIT, KNOWN_GOOD);
  list.ok(rows.length === 0,
    `${name}: ${rows.length} inconsistent pattern(s)` +
    rows.slice(0, 4).map((r) => `\n        ${r.count}x ${r.pattern}\n           e.g. ${r.sample}`).join(""));
}

await ctx.close();
await browser.close();
finish(list.report());

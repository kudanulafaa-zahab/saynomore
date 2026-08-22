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

import { launch, signedInPage, checklist, finish, BASE, appRoutes } from "./lib.mjs";

// Every screen the app has, read from the routes on disk rather than listed
// here — see appRoutes() in lib.mjs for why. Seven screens used to be on
// neither this list nor the material audit's, and one of them was carrying the
// exact defect the material audit exists to catch.
const SCREENS = appRoutes();

// Settings shows a preview swatch per palette; those are gradients ON PURPOSE —
// they advertise the colour schemes. Excluded by selector, not by screen, so the
// rest of Settings is still audited.
const KNOWN_GOOD = '[data-palette-swatch], .snm-palette-swatch';

const AUDIT = ([knownGood, material]) => {
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
    // Chrome floats ABOVE the content plane and is exempt in every material —
    // that is the layering law, not a carve-out. Position fixed/sticky is added
    // to the structural list because an element that is taken out of flow IS
    // floating by definition, whatever tag it uses: the shipments screen's
    // floating action button is a bare <button> and was being judged as though
    // it sat on the page. This only ever REMOVES checks, so it cannot make a
    // passing palette fail; it was verified not to change Soft's result.
    const pos = cs.position;
    const isChrome = pos === "fixed" || pos === "sticky" ||
      !!el.closest('header, footer, nav, .glass-tabbar, .glass-panel--strong, [role="dialog"] > header');

    if (!isChrome) {
      if (bf !== "none" && !/blur\(0px\)/.test(bf)) {
        note(`BLUR on in-flow content: ${bf.slice(0, 36)}`, el);
      }
      if (bg && bg.a > 0 && bg.a < 0.98 && (sh !== "none" || bgi !== "none")) {
        note(`TRANSLUCENT in-flow surface (alpha ${bg.a})`, el);
      }
      // ── The rest of the law depends on WHICH material is active ─────────
      // The first two checks above (no blur, nothing translucent) are true of
      // any opaque material. These last two are not: a carve is defined by
      // shadows and an edge-lit panel is defined by the absence of them, so
      // running the carve's rules over Lumen would flag its seam and its
      // top-rim bar as defects. Same discipline as everywhere else in this
      // gate — state each material's own invariant rather than exempting a
      // palette by name.
      if (material === "carved") {
        // A gradient whose stops are all the same colour paints flat — that is
        // the token bridge working, not a defect. Only a gradient that VARIES
        // is one.
        if (/gradient/.test(bgi) && r.height > 28) {
          const stops = [...bgi.matchAll(/rgba?\([^)]+\)/g)].map((m) => m[0]);
          if (new Set(stops).size > 1) note(`GRADIENT fill: ${bgi.slice(0, 44)}`, el);
        }
        // The carve is always TWO shadows (a light one and a dark one). A
        // single drop shadow is the old glass vocabulary, hardcoded past the
        // theme.
        if (sh !== "none") {
          const parts = sh.split(/,(?![^(]*\))/).length;
          if (parts === 1 && !/inset/.test(sh)) note(`SINGLE drop shadow (not a carve): ${sh.slice(0, 44)}`, el);
        }
      } else if (material === "edge") {
        // Lumen's whole claim is that depth lives in the SEAM, not under the
        // panel: every content shadow is a hard 1px spread with NO blur radius.
        // So any blurred drop shadow in the content plane is the glass or carve
        // vocabulary hardcoded past the theme — the exact defect class the
        // material audit was written for, expressed for this material.
        //
        // Parsed rather than pattern-matched: a CSS shadow is
        // "<x> <y> <blur> <spread> <colour>", so the third length is the blur.
        // inset shadows are the recessed-input and nested-surface vocabulary
        // and are correct here.
        for (const part of sh === "none" ? [] : sh.split(/,(?![^(]*\))/)) {
          if (/inset/.test(part)) continue;
          const lengths = part.match(/-?[\d.]+px/g) || [];
          const blur = lengths[2] ? parseFloat(lengths[2]) : 0;
          if (blur > 0) note(`BLURRED drop shadow in the content plane (blur ${blur}px, not a seam): ${part.trim().slice(0, 44)}`, el);
        }
      }
    }
  }
  return [...groups.entries()].sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => ({ pattern: k, count: v.n, sample: v.sample }));
};

const palette = process.argv.includes("--palette")
  ? process.argv[process.argv.indexOf("--palette") + 1] : "soft";

// Which law to apply. Derived from the palette's own declared material in
// lib/palette.ts, so a future palette cannot be audited under the wrong
// physics — and a palette that declares no material is a GLASS palette, whose
// in-flow surfaces are legitimately translucent and blurred and which this
// audit therefore has nothing to say about.
const { PALETTE_SWATCHES } = await import("../../lib/palette.ts");
const material = PALETTE_SWATCHES[palette]?.material;
if (!material) {
  console.error(`REFUSING: "${palette}" declares no material in lib/palette.ts, so there is no law to check it against.`);
  process.exit(2);
}

const browser = await launch();
const list = checklist(`Material consistency — ${palette} (${material}), ${SCREENS.length} screens`);
const { ctx, page } = await signedInPage(browser, { palette, scheme: "light" });

for (const [name, url] of SCREENS) {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const rows = await page.evaluate(AUDIT, [KNOWN_GOOD, material]);
  list.ok(rows.length === 0,
    `${name}: ${rows.length} inconsistent pattern(s)` +
    rows.slice(0, 4).map((r) => `\n        ${r.count}x ${r.pattern}\n           e.g. ${r.sample}`).join(""));
}

await ctx.close();
await browser.close();
finish(list.report());

// Material audit — can the theme actually REACH every surface?
//
// Ali, 2026-08-10: "I think it's not consistent app wide." He was right, and
// this is what found where. Two causes explained all of it, and neither was
// reachable from a stylesheet: the content blur had been typed out by hand in
// 22 components, and shadows were hardcoded in 8 more. A theme could not switch
// off something no theme ever owned.
//
// ── WHY THE LAW CHANGED ON 2026-08-29 ──────────────────────────────────────
//
// This used to check that a CARVED palette (Soft) was opaque and two-shadowed,
// or that an EDGE-LIT one (Lumen) had no blurred drop shadows. Ali cut the five
// palettes to two, and Ember and Aurora are both Liquid Glass — so both of
// those laws are about materials that no longer exist, and the audit refused to
// run on a glass palette by design.
//
// Deleting it outright would have been the easy read and the wrong one. The
// defect it exists to catch is still live, because the thing it really protects
// is not a material — it is whether a surface is reachable from the tokens at
// all. Two features depend on exactly that and are still shipped:
//
//   THE FROST DIAL      Settings → Glass finish moves --glass-frost, and every
//                       blur token is blur(calc(Npx * var(--frost-b))). A
//                       hand-typed blur(14px) does not move with it.
//   ACCESSIBILITY       prefers-reduced-transparency: reduce switches the glass
//                       off. It cannot switch off a blur no token owns.
//
// ── THE LAW, AND WHY IT CANNOT BE FOOLED ───────────────────────────────────
//
// Computed style is no help on its own: by the time the browser reports a
// backdrop-filter, var() is already resolved and blur(14px) from a token looks
// identical to blur(14px) typed by hand.
//
// So this MOVES THE DIAL and watches. Every blur the token system owns is a
// multiple of --frost-b; drive --glass-frost from 0 to 1 and every honest blur
// changes. Any element whose blur is non-zero and IDENTICAL at both ends is
// hardcoded past the theme, by construction. No pattern matching, no list of
// blessed values, and nothing to keep in step with the stylesheet.
//
// Both readings happen in one page evaluation on one DOM, so elements are
// compared with themselves rather than matched across navigations.
//
// Run it after any styling change. If it reports a new pattern, something was
// styled outside the token system and the frost dial has already stopped
// reaching it.
//
// Usage:  node scripts/audit/material.mjs [--palette ember]

import { launch, signedInPage, checklist, finish, BASE, appRoutes, PALETTES } from "./lib.mjs";

// Every screen the app has, read from the routes on disk rather than listed
// here — see appRoutes() in lib.mjs for why. Seven screens used to be on
// neither this list nor the material audit's, and one of them was carrying the
// exact defect the material audit exists to catch.
const SCREENS = appRoutes();

// Settings previews the OTHER palette; those tiles are gradients ON PURPOSE.
// Excluded by selector, not by screen, so the rest of Settings is still
// audited.
const KNOWN_GOOD = '[data-palette-swatch], .snm-palette-swatch';

const AUDIT = (knownGood) => {
  const root = document.documentElement;
  const blurOf = (cs) => {
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || "none";
    if (bf === "none") return 0;
    const m = bf.match(/blur\(([\d.]+)px\)/);
    return m ? parseFloat(m[1]) : 0;
  };

  // The elements worth judging: in flow, visible, big enough to be a surface.
  // Chrome floats ABOVE the content plane and is exempt in every material —
  // that is the layering law, not a carve-out. Position fixed/sticky counts as
  // chrome because an element taken out of flow IS floating, whatever tag it
  // uses: the shipments screen's floating action button is a bare <button> and
  // was being judged as though it sat on the page.
  const subjects = [];
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16) continue;
    if (r.bottom <= 0 || r.top >= innerHeight) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    if (knownGood && el.closest(knownGood)) continue;
    const cs = getComputedStyle(el);
    const pos = cs.position;
    if (pos === "fixed" || pos === "sticky") continue;
    if (el.closest('header, footer, nav, .glass-tabbar, .glass-panel--strong, [role="dialog"] > header')) continue;
    subjects.push(el);
  }

  const prev = root.style.getPropertyValue("--glass-frost");
  root.style.setProperty("--glass-frost", "0");
  const clear = subjects.map((el) => blurOf(getComputedStyle(el)));
  root.style.setProperty("--glass-frost", "1");
  const frosty = subjects.map((el) => blurOf(getComputedStyle(el)));
  if (prev) root.style.setProperty("--glass-frost", prev);
  else root.style.removeProperty("--glass-frost");

  const groups = new Map();
  subjects.forEach((el, i) => {
    // Zero at both ends is not a glass surface at all — most of the app is
    // plain text and layout, and it is correct for those to have no blur.
    if (clear[i] === 0 && frosty[i] === 0) return;
    if (clear[i] !== frosty[i]) return; // moves with the dial: token-owned.
    const key = `BLUR THE THEME CANNOT REACH: blur(${clear[i]}px) unchanged from clear to frosty`;
    if (!groups.has(key)) groups.set(key, { n: 0, sample: "" });
    const g = groups.get(key);
    g.n++;
    if (!g.sample) {
      const cls = (el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 4).join(".");
      // SAY WHAT WAS SEEN, not just that something was wrong. A failure that
      // reports only "unchanged" cannot distinguish a hand-typed blur from a
      // token that failed to re-resolve — and guessing between those two is
      // how two earlier audits in this repo wasted a CI round each.
      const own = (el.getAttribute("style") || "").match(/backdrop-filter:[^;]*/i);
      const cs2 = getComputedStyle(el);
      g.sample =
        `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} "${(el.innerText || "").slice(0, 20).replace(/\n/g, " ")}"` +
        `\n           inline: ${own ? own[0].slice(0, 60) : "(none — comes from a class)"}` +
        `\n           at this element: --glass-frost=${cs2.getPropertyValue("--glass-frost").trim() || "(unset)"}` +
        ` --frost-b=${cs2.getPropertyValue("--frost-b").trim() || "(unset)"}` +
        ` --glass-blur-content=${cs2.getPropertyValue("--glass-blur-content").trim().slice(0, 40) || "(unset)"}`;
    }
  });

  return [...groups.entries()].sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => ({ pattern: k, count: v.n, sample: v.sample }));
};

const palette = process.argv.includes("--palette")
  ? process.argv[process.argv.indexOf("--palette") + 1] : PALETTES[0];

if (!PALETTES.includes(palette)) {
  console.error(`REFUSING: "${palette}" is not a palette. Available: ${PALETTES.join(", ")}`);
  process.exit(2);
}

const browser = await launch();
const list = checklist(`Material — the theme reaches every surface (${palette}), ${SCREENS.length} screens`);
const { ctx, page } = await signedInPage(browser, { palette, scheme: "light" });

for (const [name, url] of SCREENS) {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const rows = await page.evaluate(AUDIT, KNOWN_GOOD);
  list.ok(rows.length === 0,
    `${name}: ${rows.length} surface(s) the theme cannot reach` +
    rows.slice(0, 4).map((r) => `\n        ${r.count}x ${r.pattern}\n           e.g. ${r.sample}`).join(""));
}

await ctx.close();
await browser.close();
finish(list.report());

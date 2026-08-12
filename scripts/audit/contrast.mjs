// Contrast audit — every readable word on every screen, in every theme.
//
// Why it walks the rendered page rather than reading the tokens: muted text does
// not sit on the page, it sits on a CARD, and a card is near-white in light mode
// and LIGHTER than the page in dark mode. The same token that measures fine
// against the page failed at 2.81:1 and 3.59:1 against the cards it is actually
// printed on. No amount of reading globals.css would have found that. Neither
// would reading it have found that the tab bar composites lighter than the page
// and failed the nav labels in all four palettes at once.
//
// Standard: WCAG 2.2 SC 1.4.3 — 4.5:1 for body text, 3:1 for large text
// (>=24px, or >=18.66px at weight 700+). Disabled controls are exempt by
// definition and are skipped.
//
// Usage:  node scripts/audit/contrast.mjs [--palette soft] [--quiet]

import { launch, signedInPage, PALETTES, checklist, finish, BASE } from "./lib.mjs";

const SCREENS = [
  ["dashboard",  "/dashboard"],
  ["sales",      "/sales"],
  ["inventory",  "/inventory"],
  ["financials", "/financials"],
  ["reorder",    "/reorder"],
  ["pricelists", "/pricelists"],
  ["products",   "/products"],
  ["shipments",  "/shipments"],
  ["settings",   "/settings"],
  // Added 2026-08-10: the P&L's running costs are entered here, and the
  // screen was never measured because it was not on this list.
  ["expenses",   "/expenses"],
  // Added 2026-08-10 with the jargon sweep: Reports was never measured either.
  ["reports",    "/reports"],
  // Added 2026-08-12 with the new screen itself. A page dense with money is
  // exactly where a low-contrast number is dangerous — it is the figure he
  // prices against.
  ["product-card", "/product-card"],
];

// Runs inside the page. Kept as one self-contained function because it is
// serialised across the CDP boundary — it cannot close over anything here.
const AUDIT = () => {
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  // The REAL backdrop: walk ancestors compositing every layer that is not fully
  // transparent. This is the whole point of the audit — a token's colour tells
  // you nothing until you know what is painted behind it.
  const backdrop = (el) => {
    const stack = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) stack.push(c);
    }
    const html = parse(getComputedStyle(document.documentElement).backgroundColor);
    let base = html && html.a > 0 ? html : { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const ratio = (a, b) => {
    const L1 = lum([a.r, a.g, a.b]), L2 = lum([b.r, b.g, b.b]);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };

  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim()).join(" ").trim();
    if (!txt) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // Off-screen by TRANSFORM — the mobile More sheet sits translated below the
    // fold. checkVisibility does not catch that, and it invented five phantom
    // failures a page until this line existed.
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    // checkVisibility walks ANCESTORS — without it the lg-only sidebar
    // (display:none on a phone) was audited and reported as failing.
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (el.closest('button:disabled, [aria-disabled="true"], fieldset:disabled')) continue;
    const op = parseFloat(cs.opacity);
    if (op === 0) continue;

    let fg = parse(cs.color);
    if (!fg) continue;
    const bg = backdrop(el);
    if (op < 1) fg = { ...over({ ...fg, a: op }, bg), a: 1 };
    if (fg.a < 1) fg = over(fg, bg);

    const px = parseFloat(cs.fontSize);
    const wt = parseInt(cs.fontWeight) || 400;
    const need = px >= 24 || (px >= 18.66 && wt >= 700) ? 3 : 4.5;
    const cr = ratio(fg, bg);
    if (cr < need) out.push({
      text: txt.slice(0, 44), cr: Math.round(cr * 100) / 100, need, px: Math.round(px), wt,
      color: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`,
      on: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
    });
  }
  const seen = new Set();
  return out.sort((a, b) => a.cr - b.cr).filter((x) => {
    const k = x.text + x.cr;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const only = process.argv.includes("--palette")
  ? process.argv[process.argv.indexOf("--palette") + 1] : null;
const palettes = only ? [only] : PALETTES;

const browser = await launch();
const list = checklist(`Contrast — ${palettes.length} palettes x 2 schemes x ${SCREENS.length} screens`);

for (const palette of palettes) {
  for (const scheme of ["light", "dark"]) {
    const { ctx, page } = await signedInPage(browser, { scheme, palette });
    for (const [name, url] of SCREENS) {
      await page.goto(BASE + url, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const bad = await page.evaluate(AUDIT);
      list.ok(bad.length === 0,
        `${palette}/${scheme} ${name}: ${bad.length} below floor` +
        bad.slice(0, 4).map((x) =>
          `\n        ${x.cr}:1 (needs ${x.need}) ${x.px}px/${x.wt} "${x.text}" ${x.color} on ${x.on}`).join(""));
    }
    await ctx.close();
  }
}

await browser.close();
finish(list.report());

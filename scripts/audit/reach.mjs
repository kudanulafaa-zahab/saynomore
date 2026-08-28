// Reach — can you actually touch the button, and does the screen hold still?
//
// Ali, 2026-08-11: "From now on I don't want to show you where you break stuff.
// Specially the ui. It's your damn job to do it properly without me asking
// everytime."
//
// He is right, and the reason he kept having to is structural. The other nine
// audits each guard ONE screen against ONE bug that had already reached him.
// That is a bug list, not a gate: every new defect needs him to find it first,
// and then gets its own bespoke check afterwards. This one is different — it
// asserts two invariants that must hold on EVERY sheet in the app, so a screen
// written next month is covered by a check written today.
//
// ── INVARIANT 1: THE KEYBOARD DOES NOT SWALLOW THE ACTION ──────────────────
//
// On iOS the software keyboard does NOT resize the layout viewport. It slides
// up OVER the page, so a sheet pinned to the bottom keeps its full height and
// its footer simply ends up underneath the keyboard. Measured on the New SKU
// sheet at 393pt: the "Create SKU" button sits at y=788-836 while the reachable
// area ends at 516. It is 320 points below the line — invisible, untappable,
// and nothing on screen says so.
//
// The app already solved this. `lib/use-keyboard-inset.ts` publishes the
// keyboard height as `--kb-inset`, and a footer lifts itself with
//
//     paddingBottom: max(env(safe-area-inset-bottom), var(--kb-inset))
//
// Six sheets used it. Eight did not, all of them with text fields in them. That
// asymmetry is invisible in review — both versions look identical with the
// keyboard down, which is how every one of them shipped.
//
// So this audit publishes `--kb-inset` itself, exactly as a real iPhone would,
// and then measures. A footer that consumes the variable lifts and passes; one
// that ignores it stays put and fails with the number of points it is out by.
// No iPhone required, and no judgement involved.
//
// ── INVARIANT 2: THE SCREEN DOES NOT DRIFT SIDEWAYS ────────────────────────
//
// Ali: "it's moving to the sides." A vertical scroller written as
// `overflow-y-auto` does NOT get `overflow-x: visible` — CSS forces the other
// axis to `auto` whenever one axis is not visible. So every scrolling sheet
// body in this app is silently a horizontal scroller too, waiting for one child
// to be a few pixels too wide.
//
// It is checked as two halves, because clamping alone would only hide it:
//   (a) nothing OVERFLOWS — so there is nothing to see when panning is off;
//   (b) nothing can PAN — so a future overflow cannot drag the screen sideways.
// (a) makes (b) safe; (b) makes (a) permanent. Either alone is half a fix.
//
// Usage:  node scripts/audit/reach.mjs [--sheet "New SKU"]

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

// An iPhone 15 Pro's alphabetic keyboard. The exact figure does not matter —
// any realistic height separates a footer that lifts from one that does not.
const KEYBOARD_PX = 336;

const only = (() => {
  const i = process.argv.indexOf("--sheet");
  return i === -1 ? null : process.argv[i + 1];
})();

/**
 * Click the first control matching `re` that is actually on screen.
 *
 * `locator(...).first()` is not good enough here. Several screens render the
 * same row twice — once for the phone list and once inside the `hidden lg:grid`
 * desktop pane — so `.first()` can resolve to the copy that is display:none and
 * then time out waiting for it to become visible, which reads like a broken
 * opener rather than a second copy. Walk the matches and take one with a real
 * box.
 */
async function tap(page, re, { timeout = 12_000 } = {}) {
  const all = page.locator("button, [role=button], a[href]").filter({ hasText: re });
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    const box = await el.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      await el.click({ timeout });
      return true;
    }
  }
  throw new Error(`no visible control matching ${re} (${n} match(es), all off-screen)`);
}

/**
 * Every sheet in the app that takes typed input, with how to open it.
 *
 * A sheet is listed here because it has a text field AND an action the user
 * must reach afterwards — that pairing is what the keyboard breaks. Adding a
 * new sheet without adding it here is the gap this file exists to close, so
 * keep it in step; `--sheet` runs one while you are working on it.
 */
const SHEETS = [
  {
    name: "New SKU",
    route: "/products",
    open: async (page) => {
      await tap(page, /^New SKU$/);
      await page.waitForTimeout(1500);
      // Typing is what raises the keyboard, so type before measuring: the
      // sheet grows as sections appear, and an empty form is the easy case.
      await page.getByPlaceholder(/or type new brand name/i).first().fill("Bodyshop");
      await page.waitForTimeout(600);
    },
  },
  {
    name: "New Sale",
    route: "/sales",
    open: async (page) => {
      await tap(page, /new sale/i);
      await page.waitForTimeout(1800);
    },
  },
  {
    name: "Edit SKU",
    route: "/products",
    open: async (page) => {
      // Drill into a SKU row, then Edit. Brands are expanded by default.
      await tap(page, /\d+\/pack × \d+\/ctn/);
      await page.waitForTimeout(1500);
      await tap(page, /^Edit SKU$/i);
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "Add Customer",
    route: "/customers",
    open: async (page) => {
      await tap(page, /Add Customer/);
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "New Price List",
    route: "/pricelists",
    open: async (page) => {
      await tap(page, /New list/);
      await page.waitForTimeout(1500);
    },
  },
  // Stock Ops and Reorder are deliberately NOT here. Their forms are in-page,
  // not sheets, so the document scrolls them and the keyboard cannot strand the
  // submit button. Listing them would have bought a free pass, not coverage —
  // which is exactly the failure mode this audit is meant to remove.
];

/**
 * Measure one open screen. All geometry is read in ONE evaluate so nothing can
 * shift between reads.
 *
 * The distinction that makes invariant 1 precise: a control inside the sheet's
 * own vertical scroller can always be scrolled up into view, so it is fine
 * wherever it currently sits. A control in PINNED chrome cannot be scrolled to
 * at all — where it is, is where it stays. Only those are judged.
 */
async function measure(page, kb) {
  return page.evaluate((kbPx) => {
    const vh = window.innerHeight;
    const reachable = vh - kbPx;

    // FIND THE SHEET GENERICALLY, by shape rather than by markup.
    //
    // This app builds sheets three different ways — shadcn's DialogContent, a
    // hand-rolled createPortal sheet in products-explorer, and another in
    // price-lists. Selecting on [role="dialog"] found only the first, so two of
    // the three silently measured a plain page and passed. Shape is the honest
    // test and it also covers whatever the fourth one turns out to be:
    // position:fixed, roughly full width, sitting on the bottom edge, with
    // something to press inside it. Highest stacking order wins.
    const sheet = (() => {
      let best = null, bestZ = -1;
      for (const el of document.body.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed") continue;
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        const r = el.getBoundingClientRect();
        const fullWidth = r.width >= window.innerWidth * 0.9;
        const onBottom = Math.abs(r.bottom - window.innerHeight) < 2;
        const tall = r.height >= window.innerHeight * 0.25;
        if (!fullWidth || !onBottom || !tall) continue;
        if (!el.querySelector("button, [role=button]")) continue;
        const z = parseInt(cs.zIndex, 10) || 0;
        if (z >= bestZ) { bestZ = z; best = el; }
      }
      return best || document.body;
    })();
    const root = sheet.getBoundingClientRect();

    // PINNED vs REACHABLE. Walk up from the control; whichever comes first
    // decides:
    //   a scrollable ancestor  -> it can be scrolled into view. Fine anywhere.
    //   position: fixed        -> where it is now is where it stays. Judge it.
    //   neither, to the top    -> normal document flow, and the app shell
    //                             scrolls the document (CLAUDE.md: the page
    //                             scrolls, not inner panes). Fine.
    //
    // Getting this wrong in the obvious direction is what the first version of
    // this audit did: it treated everything below the fold on an ordinary page
    // as stranded and "found" 30 failures per screen, all of them nonsense.
    // A check that cries wolf gets switched off, which is worse than no check.
    const isPinned = (el) => {
      for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (["auto", "scroll"].includes(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) return false;
        if (cs.position === "fixed") return true;
      }
      return false;
    };

    // The tab bar is fixed and IS covered by the keyboard — on purpose. You are
    // typing, not navigating, and every native iOS app behaves this way.
    // Named by its own class, not by "nav": the section switcher at the top
    // of every page is a <nav> too, and excluding that would be an accident.
    const inTabBar = (el) => !!el.closest("nav.glass-tabbar");

    const stranded = [];
    for (const el of sheet.querySelectorAll('button, [role="button"], a[href]')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;                 // not rendered
      if (getComputedStyle(el).visibility === "hidden") continue;
      // Entirely below the viewport = a CLOSED layer parked off-screen, not a
      // stranded control. The old "More" sheet sat at translateY(100%) with
      // real geometry at y=1679 and produced 18 phantom failures per screen;
      // that sheet is gone (0218) but any closed bottom layer has the shape.
      // A footer the keyboard covers is different: still ON screen
      // (top < viewport height) but below the reachable line.
      if (r.top >= vh) continue;
      if (r.bottom <= reachable + 0.5) continue;           // above the line: fine
      if (inTabBar(el)) continue;
      if (!isPinned(el)) continue;                         // can be scrolled to
      stranded.push({
        // A DISABLED control still counts. "Create SKU" is disabled until the
        // form is valid, so skipping disabled ones would report the footer as
        // fine right up until the moment it matters.
        label: (el.textContent || el.getAttribute("aria-label") || "?").trim().slice(0, 40) + (el.disabled ? " (disabled)" : ""),
        bottom: Math.round(r.bottom),
        below: Math.round(r.bottom - reachable),
      });
    }

    // Sideways: anything that can pan, and anything that spills its container.
    const pans = [], spills = [];
    const scan = sheet === document.body ? document.body : sheet;
    for (const el of [scan, ...scan.querySelectorAll("*")]) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const cs = getComputedStyle(el);
      if (["auto", "scroll"].includes(cs.overflowX) && el.scrollWidth - el.clientWidth > 1) {
        pans.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 44),
          by: el.scrollWidth - el.clientWidth,
        });
      }
      // Spill past the right edge of the sheet. Fixed/absolute chrome
      // (menus, toasts) is positioned against the viewport, not the sheet.
      if (cs.position === "fixed" || cs.position === "absolute") continue;
      const over = r.right - root.right;
      if (over > 0.5) {
        spills.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 44),
          by: +over.toFixed(1),
        });
      }
    }

    return { vh, reachable, stranded, pans, spills, sheetFound: sheet !== document.body };
  }, kb);
}

const b = await launch();
const list = checklist("Reach — the action stays touchable and the screen holds still");

for (const s of SHEETS) {
  if (only && s.name !== only) continue;
  const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });
  try {
    await page.goto(`${BASE}${s.route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await s.open(page);

    // Publish the keyboard exactly as lib/use-keyboard-inset.ts does on a
    // real device. A footer that reads the variable lifts; one that does
    // not, does not — which is the whole measurement.
    await page.evaluate((px) => {
      document.documentElement.style.setProperty("--kb-inset", `${px}px`);
    }, KEYBOARD_PX);
    await page.waitForTimeout(500);

    const m = await measure(page, KEYBOARD_PX);

    // An opener that quietly opens nothing would make every other check on this
    // entry pass against a plain page. Fail loudly instead.
    list.ok(m.sheetFound, `${s.name}: the sheet actually opened (nothing to measure otherwise)`);

    const worst = m.stranded.sort((a, x) => x.below - a.below)[0];
    list.ok(
      m.stranded.length === 0,
      `${s.name}: with the keyboard up, ${m.stranded.length} pinned control(s) are out of reach` +
        (worst ? ` — "${worst.label}" is ${worst.below}pt below the reachable line (y=${worst.bottom}, line=${m.reachable})` : ""),
    );
    list.ok(
      m.pans.length === 0,
      `${s.name}: ${m.pans.length} element(s) can pan sideways` +
        (m.pans[0] ? ` — <${m.pans[0].tag} class="${m.pans[0].cls}"> by ${m.pans[0].by}px` : ""),
    );
    list.ok(
      m.spills.length === 0,
      `${s.name}: ${m.spills.length} element(s) spill past the right edge` +
        (m.spills[0] ? ` — <${m.spills[0].tag} class="${m.spills[0].cls}"> by ${m.spills[0].by}px` : ""),
    );
    list.is(page.errors.length, 0, `${s.name}: no page errors (${page.errors.slice(0, 1).join("")})`);
  } catch (e) {
    list.ok(false, `${s.name}: could not be opened — ${String(e).split("\n")[0].slice(0, 150)}`);
  }
  await ctx.close();
}

await b.close();
finish(list.report());

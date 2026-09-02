// The controls INSIDE the sheets — the half nobody was measuring.
//
// Ali, 2026-09-01, with a screenshot of the New Sale sheet showing the
// Pack/Carton pill at 36px, hours after being told every control in the app
// was 44px.
//
// The claim was false and the reason is structural, not a slip:
// touch-targets.mjs loads each of the 21 screens and measures what is ON it.
// Nothing inside a sheet, dialog or bottom sheet has ever been measured, by
// this or any other audit. New Sale, the product picker, the GRN dialog, the
// mixed-carton sheet, Edit SKU, every confirm — all unmeasured, and all of
// them are where money is entered. "Zero on 21 screens" was true; saying it
// about the app was not.
//
// ── WHY A SECOND FILE AND NOT A LOOP IN THE FIRST ─────────────────────────
//
// A screen is a URL: go there and read it. A sheet is a JOURNEY — tap New
// Sale, pick a customer, tap Add products, tap a brand — and each one needs
// its own steps, its own waits, and its own failure mode when a step does not
// land. Folding that into the screen sweep would make one slow, brittle audit
// out of one fast reliable one and one deliberately fragile one.
//
// The MEASUREMENT is shared, not copied: both import AUDIT/AUDIT_WITHIN from
// lib-touch.mjs, so "is this big enough, and what is exempt" has exactly one
// definition. Two copies would drift at the exemptions first, which are the
// part carrying the reasoning.
//
// ── ONLY WHAT IS INSIDE ───────────────────────────────────────────────────
//
// Measured within the dialog element, never the page. A sheet sits over a
// screen that has already been judged by the other audit, and counting the
// page behind it would report the same control twice and make both numbers
// meaningless.
//
// Usage:  node scripts/audit/touch-targets-sheets.mjs [--report]

import { readFileSync } from "node:fs";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";
import { AUDIT_WITHIN } from "./lib-touch.mjs";

const MIN = 44;
const DETAIL = 10;

const BASELINE = JSON.parse(
  readFileSync(new URL("./touch-targets-sheets.baseline.json", import.meta.url), "utf8")
);

/** Every sheet worth measuring, and exactly how Ali reaches it.
 *
 *  Kept to flows the journey audits already drive, so a failure here means a
 *  control is too small — not that this file guessed a selector wrong. */
const SHEETS = [
  {
    name: "new-sale",
    where: "/sales",
    what: "New Sale — customer step",
    async open(page) {
      await page.getByRole("button", { name: /new sale/i }).first().click();
      await page.waitForTimeout(900);
      return page.getByRole("dialog", { name: /new sale/i });
    },
  },
  {
    name: "sale-mixed-carton",
    where: "/sales",
    what: "New Sale — the Sosoft sheet: single bottle, mixed carton, whole carton",
    async open(page) {
      await page.getByRole("button", { name: /new sale/i }).first().click();
      const newSale = page.getByRole("dialog", { name: /new sale/i });
      await newSale.getByText("Ahmed Ziyad").first().click();
      await page.getByRole("button", { name: /add products/i }).first().click();
      await page.waitForTimeout(1500);
      // Ship-from must be chosen explicitly; the fixture's stock is in Veesange.
      await page.locator("select").first().selectOption({ label: "Veesange" });
      await page.waitForTimeout(1500);
      // SOSOFT, because journey.mjs and sosoft-three-ways.mjs both drive this
      // exact flow and pass. Three attempts at reaching the plain diaper step
      // instead cost three CI rounds and taught me only that guessing at a
      // selector one 15-minute run at a time is not debugging. That step is
      // not covered yet and is listed as not covered, rather than pretended
      // at — see the note in the baseline file.
      await page.locator("button", { hasText: "Sosoft" }).first().click();
      await page.waitForFunction(
        () => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
          .some((d) => (d.getAttribute("aria-label") || "").toLowerCase() !== "new sale"),
        null, { timeout: 15_000 });
      await page.waitForTimeout(700);
      return page.getByRole("dialog", { name: /add to sale/i });
    },
  },
  {
    name: "product-type",
    where: "/products?tab=categories",
    what: "Product type — how a kind of product is sold",
    async open(page) {
      await page.locator("button", { hasText: "Diapers" }).first().click();
      await page.waitForTimeout(900);
      return page.getByRole("dialog").first();
    },
  },
  {
    name: "new-sku",
    where: "/products",
    what: "New SKU — adding a product",
    async open(page) {
      await page.getByRole("button", { name: /new sku/i }).first().click();
      await page.waitForTimeout(900);
      return page.getByRole("dialog").first();
    },
  },
];

const report = process.argv.includes("--report");
const browser = await launch();
const list = checklist(`Touch targets INSIDE sheets — ${SHEETS.length} sheets, every control at least ${MIN}x${MIN}`);
const { ctx, page } = await signedInPage(browser, { device: "phone", scheme: "light" });

const seen = {};
const found = {};

for (const sheet of SHEETS) {
  let small = null;
  let failure = null;
  try {
    await page.goto(BASE + sheet.where, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const dialog = await sheet.open(page);
    const handle = await dialog.elementHandle({ timeout: 10_000 });
    if (!handle) throw new Error("the sheet did not open");
    small = await page.evaluate(AUDIT_WITHIN, [MIN, handle]);
  } catch (err) {
    failure = String(err).split("\n")[0].slice(0, 160);
    // SAY WHAT WAS ON SCREEN. Three runs were spent guessing which control to
    // click, at fifteen minutes each, because the failure said only that
    // something timed out. A locator that does not match is a question about
    // the page, so the page should answer it.
    try {
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll("button, [role=button]")]
          .filter((b) => b.getBoundingClientRect().height > 0)
          .map((b) => (b.getAttribute("aria-label") || b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40))
          .filter(Boolean).slice(0, 25));
      failure += `\n        on screen: ${labels.join(" | ")}`;
    } catch { /* the page may be gone; the original error is the point */ }
  }

  if (failure) {
    // A SHEET THAT CANNOT BE OPENED IS ITS OWN FINDING. Skipping quietly is
    // how this surface stayed unmeasured in the first place.
    seen[sheet.name] = null;
    list.ok(false, `${sheet.name}: could not open — ${failure}`);
    continue;
  }

  seen[sheet.name] = small.length;
  found[sheet.name] = small;

  if (report) continue;
  const allowed = BASELINE[sheet.name] ?? 0;
  list.ok(small.length <= allowed,
    `${sheet.name}: ${small.length} control(s) under ${MIN}px (baseline ${allowed}) — ${sheet.what}` +
    small.slice(0, 4).map((s) => `\n        ${s.size}  ${s.what} "${s.label}"`).join(""));
}

await ctx.close();
await browser.close();

console.log(`\n  under ${MIN}px, by sheet:`);
for (const [n, c] of Object.entries(seen)) {
  const base = BASELINE[n] ?? 0;
  const mark = c === null ? "COULD NOT OPEN"
    : c === 0 ? "clean" : c > base ? `OVER baseline ${base}` : c < base ? `better than ${base}` : "at baseline";
  console.log(`    ${String(c ?? "-").padStart(3)}  ${n.padEnd(22)} ${mark}`);
}

const withDebt = Object.entries(found).filter(([, l]) => l.length > 0);
if (withDebt.length > 0) {
  console.log(`\n  what they are (first ${DETAIL} per sheet):`);
  for (const [n, l] of withDebt.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${n}`);
    for (const s of l.slice(0, DETAIL)) {
      console.log(`      ${s.size.padStart(7)}  ${s.what}${s.label ? `  "${s.label}"` : ""}`);
    }
    if (l.length > DETAIL) console.log(`      … and ${l.length - DETAIL} more`);
  }
}

if (report) {
  console.log("\nBaseline block — paste into scripts/audit/touch-targets-sheets.baseline.json:\n");
  console.log(JSON.stringify(seen, null, 2));
  process.exit(0);
}

const slack = Object.entries(seen).filter(([n, c]) => c !== null && c < (BASELINE[n] ?? 0));
list.ok(slack.length === 0,
  `${slack.length} sheet(s) are now better than their baseline — tighten it so the gain cannot be lost` +
  slack.slice(0, 6).map(([n, c]) => `\n        ${n}: ${c} now, baseline ${BASELINE[n]}`).join(""));

finish(list.report());

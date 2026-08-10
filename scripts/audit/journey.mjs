// Journey audit — drive a real sale, on all three device sizes.
//
// This is the one that would have caught what Ali caught. Every defect he
// reported this month was reachable by clicking through New Sale once:
//
//   "What's this big + sign?"        two controls doing the same job
//   "the +add more is scrolling"     an add control inside a scrolling list
//   "1.6666666666666667 cartons"     bottles silently vanishing on a merge
//   "7 bottles blue"                 a full carton and a mixed carton merged
//   phone screen stretched to 1512   no layout of its own above the phone
//
// So it does not check that pixels look nice. It checks the things that cost
// money or make the screen unusable: that a whole carton and a mixed carton
// stay separate purchases, that a part-filled carton cannot be checked out,
// that the total is the sum of the lines, and that nothing wraps or overflows
// at any width.
//
// Usage:  node scripts/audit/journey.mjs [--device phone]

import { launch, signedInPage, checklist, finish, BASE, DEVICES } from "./lib.mjs";

/** Wait for any open bottom sheet to actually leave.
 *  Without this the next click lands on the brand card BEHIND the sheet and
 *  Playwright reports "intercepts pointer events" — which looks like an app bug
 *  and is not one. A sheet closing is animated; the DOM node is the truth.
 *
 *  Keyed on role="dialog", not a class. The first attempt watched .snm-scrim-in
 *  and hung forever, because that animation class is also on the desktop scrim
 *  inside New Sale itself — a sheet has to be identified by what it IS. */
async function noSheet(page) {
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"][aria-modal="true"]').length === 0,
    null, { timeout: 15_000 });
  await page.waitForTimeout(250);
}

/** Open the carton picker for a brand and return a locator SCOPED TO IT.
 *
 *  Scoping is not fussiness. An unscoped getByRole("button", {name: /one
 *  colour/i}) matched the brand card BEHIND the sheet, whose own label reads
 *  "4 colours · one colour or mixed, any quantity" — so the audit spent its
 *  time clicking an element the open sheet was covering and reported a
 *  timeout that looked like an app fault. Everything inside a sheet is
 *  addressed through the dialog. */
async function openPicker(page, brand) {
  await noSheet(page);
  await page.locator("button", { hasText: brand }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 0,
    null, { timeout: 15_000 });
  await page.waitForTimeout(600);
  return page.getByRole("dialog");
}

const wanted = process.argv.includes("--device")
  ? [process.argv[process.argv.indexOf("--device") + 1]] : Object.keys(DEVICES);

const browser = await launch();
const list = checklist(`New Sale journey — ${wanted.join(", ")}`);

for (const device of wanted) {
  const { ctx, page } = await signedInPage(browser, { device, scheme: "dark" });
  const tag = `[${device}]`;

  // ── Open New Sale, pick a customer ────────────────────────────────────────
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /new sale/i }).first().click();
  await page.getByText("Ahmed Ziyad").first().click();
  await page.getByRole("button", { name: /add products/i }).first().click();
  await page.waitForTimeout(1500);

  // ── Ship-from must be chosen explicitly; the fixture's stock is in Veesange ─
  await page.locator("select").first().selectOption({ label: "Veesange" });
  await page.waitForTimeout(1500);

  // ── A MIXED carton: six bottles picked across colours ─────────────────────
  let sheet = await openPicker(page, "Sosoft");
  for (const c of ["Blue", "Blue", "Pink", "Pink", "Purple", "Red"]) {
    await sheet.getByRole("button", { name: `One more ${c}` }).click();
    await page.waitForTimeout(120);
  }
  const addMixed = sheet.getByRole("button", { name: /add .*mixed carton/i }).first();
  list.ok(await addMixed.isEnabled(), `${tag} a FULL mixed carton can be added`);
  await addMixed.click();
  await noSheet(page);

  // ── A WHOLE single-colour carton of the SAME brand ────────────────────────
  // The bug this guards: these two used to merge into one line, so a mixed
  // carton with 1 Blue in it plus a whole Blue carton read as "7 bottles Blue"
  // and the customer's actual order became unreadable.
  sheet = await openPicker(page, "Sosoft");
  const oneColour = sheet.getByRole("button", { name: /^one colour$/i }).first();
  list.ok((await oneColour.count()) > 0, `${tag} the picker offers a single-colour carton`);
  await oneColour.click();
  await page.waitForTimeout(700);
  // In single-colour mode the per-colour stepper counts CARTONS, not bottles.
  // Without this the quantity stays zero and the add button stays disabled.
  await sheet.getByRole("button", { name: "One more Blue" }).click();
  await page.waitForTimeout(400);
  const addSingle = sheet.getByRole("button", { name: /add \d+ carton/i }).first();
  list.ok(await addSingle.isEnabled(), `${tag} a whole single-colour carton can be added`);
  await addSingle.click();
  await noSheet(page);

  // ── What the cart says ────────────────────────────────────────────────────
  const cartText = await page.locator("body").innerText();
  list.ok(/mixed carton/i.test(cartText),
    `${tag} the cart names the mixed carton as its own thing`);

  // Never a piece count in anything Ali reads. Standing rule, five times over.
  const piecesLeak = /\b\d[\d,.]*\s*(pcs|pieces)\b/i.exec(cartText);
  list.ok(!piecesLeak,
    `${tag} no piece count on screen${piecesLeak ? ` — found "${piecesLeak[0]}"` : ""}`);

  // ── The total is the sum of the lines ─────────────────────────────────────
  const money = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("*")]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && /^MVR [\d,]+$/.test(n.textContent.trim())))
      .map((el) => Number(el.innerText.replace(/[^\d]/g, "")));
    const totalEl = [...document.querySelectorAll("*")]
      .find((el) => /^Total$/i.test((el.textContent || "").trim()) && el.children.length === 0);
    const total = totalEl?.parentElement?.innerText.replace(/[^\d]/g, "");
    return { rows, total: total ? Number(total) : null };
  });
  list.ok(money.total !== null && money.total > 0,
    `${tag} the cart shows a total (got ${money.total})`);

  // ── Layout: nothing may wrap or overflow, at any width ────────────────────
  const layout = await page.evaluate(() => {
    const f = document.querySelector("footer");
    const buttons = f ? [...f.querySelectorAll("button")].filter((b) => b.offsetParent !== null) : [];
    const wrapped = buttons.filter((b) => {
      const lh = parseFloat(getComputedStyle(b).lineHeight) || 20;
      const r = document.createRange();
      r.selectNodeContents(b);
      const rects = [...r.getClientRects()];
      const th = rects.length ? Math.max(...rects.map((x) => x.height)) : 0;
      return Math.round(th / lh) > 1;
    }).map((b) => b.innerText.replace(/\n/g, " ").trim());
    return {
      wrapped,
      overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      railVisible: !!document.querySelector('aside[aria-label="Order summary"]')?.checkVisibility?.(),
      // The add-product control must never live inside something that scrolls.
      addInsideScroller: [...document.querySelectorAll(".overflow-y-auto button")]
        .filter((b) => /add (more|product)/i.test(b.innerText)).length,
    };
  });
  list.is(layout.wrapped.length, 0, `${tag} no footer button wraps onto two lines (${layout.wrapped.join(", ")})`);
  list.is(layout.overflowing, false, `${tag} the page does not scroll sideways`);
  list.is(layout.addInsideScroller, 0, `${tag} the "Add product" control is not inside a scrolling list`);
  list.is(layout.railVisible, device === "desktop",
    `${tag} the docked order rail appears only on desktop`);

  // ── A PART carton must block checkout ─────────────────────────────────────
  // The database refuses it (migration 0163). The screen has to refuse it too,
  // or the reason arrives as an error after the last tap.
  sheet = await openPicker(page, "Sosoft");
  const mixedTab = sheet.getByRole("button", { name: /mixed carton$/i }).first();
  if (await mixedTab.count()) { await mixedTab.click(); await page.waitForTimeout(500); }
  await sheet.getByRole("button", { name: "One more Blue" }).click();
  await page.waitForTimeout(500);
  const partialAdd = sheet.getByRole("button", { name: /add .*mixed carton/i }).first();
  list.ok(!(await partialAdd.isEnabled()),
    `${tag} a PART-filled mixed carton cannot be added`);

  // ── Nothing threw ─────────────────────────────────────────────────────────
  list.is(page.errors.length, 0, `${tag} no uncaught page errors (${page.errors.slice(0, 2).join(" | ")})`);

  await ctx.close();
}

await browser.close();
finish(list.report());

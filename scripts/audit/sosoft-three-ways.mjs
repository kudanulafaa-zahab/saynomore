// The THREE ways Ali sells Sosoft, in one order, through the sheet he uses.
//
// Ali, 2026-08-25:
//   *"Sosoft my regular sales are mixed carton of 6 bottles. Same color carton
//    of 6 bottles and also individual bottles sales."*
//
//   1. MIXED CARTON        6 bottles, colours mixed
//   2. WHOLE CARTON        6 of the same colour
//   3. SINGLE BOTTLES      loose, any number
//
// ── WHY ALL THREE, AND NOT JUST THE ONE THAT BROKE ──────────────────────────
//
// This file began as a guard on way 3 alone, after Ali sent a screenshot:
// *"I still can't add sosoft single bottle."* Migration 0208 gave every Sosoft
// SKU a `pack` tier and I reported that selling needed no new UI, because the
// New Sale sheet renders `sellableTiers`. True of the GENERIC product sheet —
// and Sosoft never reaches it. A brand with `mixed_carton_pieces` routes to its
// own MixedCartonSheet, which had two modes, both counted in cartons, and read
// nothing from `sellable_units`.
//
// Broadened on 2026-08-25 because the ledger answered a question nobody had
// asked it. Every Sosoft bottle ever sold — 204 of them, MVR 7,480 across 112
// lines — is recorded as a MIXED-CARTON FILL. Zero whole cartons, zero singles.
// Way 3 was only possible from the day before; way 2 has always been possible
// and **no audit had ever driven it**. So a third of his Sosoft trade was
// untested and a third had never happened, and the two are not the same third.
//
// ONE ORDER, all three, because that is the real basket and because it also
// proves they can coexist: the mixed fill must still total a whole carton while
// a loose bottle and a whole carton sit beside it and count toward neither.
// Different colours throughout — a mixed fill and a loose single OF THE SAME
// COLOUR cannot share an order (register D6), and that is deliberate.
//
// Uses the SHARED FIXTURE rather than building a catalogue, exactly as
// journey.mjs does.
//
// Usage:  node scripts/audit/sosoft-three-ways.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates a real sale and deducts stock.");
  process.exit(2);
}
const scalar = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const SINGLE = "SOSO-BLUE-1x6";   // way 3 — one loose bottle
const CARTON = "SOSO-PINK-1x6";   // way 2 — a whole carton of one colour
const MIX_A  = "SOSO-PURPLE-1x6"; // way 1 — three of one colour...
const MIX_B  = "SOSO-RED-1x6";    //         ...and three of another, = one carton

/** Everything inside a sheet is addressed through the dialog — an unscoped
 *  match hits the brand card behind it. Same helper as journey.mjs. */
async function openPicker(page, brand) {
  await page.locator("button", { hasText: brand }).first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="dialog"][aria-modal="true"]:not([aria-label="New sale"])').length > 0,
    null, { timeout: 15_000 });
  await page.waitForTimeout(600);
  return page.getByRole("dialog", { name: /add to sale/i });
}

const stockOf = (code) => scalar(`select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)),0)
  from stock_movements sm join skus s on s.id=sm.sku_id where s.internal_code='${code}';`);

const before = Object.fromEntries([SINGLE, CARTON, MIX_A, MIX_B].map((c) => [c, Number(stockOf(c))]));

const browser = await launch();
const list = checklist("The three ways Ali sells Sosoft, in one order");
const { ctx, page } = await signedInPage(browser, { device: "phone", scheme: "dark" });

try {
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /new sale/i }).first().click();
  const newSale = page.getByRole("dialog", { name: /new sale/i });
  await newSale.getByText("Ahmed Ziyad").first().click();
  await page.getByRole("button", { name: /add products/i }).first().click();
  await page.waitForTimeout(1500);
  await page.locator("select").first().selectOption({ label: "Veesange" });
  await page.waitForTimeout(1500);

  // ── The sheet offers all three, and says so ─────────────────────────────
  let sheet = await openPicker(page, "Sosoft");
  const opened = await sheet.innerText();
  list.ok(/one colour/i.test(opened), "the sheet offers a whole carton of ONE COLOUR");
  list.ok(/mixed carton/i.test(opened), "and a MIXED carton");
  list.ok(/single bottles/i.test(opened), "and SINGLE BOTTLES — the three ways he actually sells");
  list.ok(/one bottle at a time/i.test(opened),
    "the header says so too, instead of calling the product carton-only");

  // ── WAY 2: a whole carton of one colour ─────────────────────────────────
  // Never driven by any audit until now, and never once recorded in the
  // ledger — which is exactly why it is first here.
  await sheet.getByRole("button", { name: /^one colour$/i }).first().click();
  await page.waitForTimeout(700);
  await sheet.getByRole("button", { name: "One more Pink" }).click();
  await page.waitForTimeout(500);
  const oneColour = await sheet.innerText();
  list.ok(/Add 1 carton . MVR 220/i.test(oneColour.replace(/\s+/g, " ")),
    "one carton of Pink is offered at the CARTON price, MVR 220");
  await sheet.getByRole("button", { name: /add 1 carton/i }).first().click();
  await page.waitForTimeout(1800);

  // ── WAY 1: six bottles, colours mixed ───────────────────────────────────
  sheet = await openPicker(page, "Sosoft");
  await sheet.getByRole("button", { name: /^mixed carton$/i }).first().click();
  await page.waitForTimeout(700);
  for (let i = 0; i < 3; i++) {
    await sheet.getByRole("button", { name: "One more Purple" }).click();
    await page.waitForTimeout(160);
  }
  for (let i = 0; i < 3; i++) {
    await sheet.getByRole("button", { name: "One more Red" }).click();
    await page.waitForTimeout(160);
  }
  const mixed = await sheet.innerText();
  list.ok(/6 \/ 6/.test(mixed.replace(/\s+/g, " ")),
    "six bottles across two colours fill exactly one carton");
  await sheet.getByRole("button", { name: /add 1 mixed carton/i }).first().click();
  await page.waitForTimeout(1800);

  // ── WAY 3: one loose bottle ─────────────────────────────────────────────
  sheet = await openPicker(page, "Sosoft");
  await sheet.getByRole("button", { name: /^single bottles$/i }).first().click();
  await page.waitForTimeout(700);
  const loose = await sheet.innerText();
  list.ok(/MVR\s*40\s*\/\s*bottle/i.test(loose.replace(/\s+/g, " ")),
    "a single bottle is priced at its own MVR 40, not the MVR 220 carton divided by six");
  list.ok(!/\bpcs\b|\bpieces\b/i.test(loose), "and nothing on the sheet says pcs");
  await sheet.getByRole("button", { name: "One more Blue" }).click();
  await page.waitForTimeout(500);
  await sheet.getByRole("button", { name: /add 1 bottle/i }).first().click();
  await page.waitForTimeout(2000);

  const cart = await page.locator("body").innerText();
  list.ok(!/short of a full carton|more bottles needed/i.test(cart),
    "the basket is complete -- a whole carton and a loose bottle count toward no mixed carton");

  const cont = page.getByRole("button", { name: /^(continue|review)/i }).first();
  if (await cont.count() > 0) { await cont.scrollIntoViewIfNeeded(); await cont.click(); await page.waitForTimeout(1800); }
  const place = page.getByRole("button", { name: /place order|confirm sale|create order/i }).first();
  await place.scrollIntoViewIfNeeded();
  await place.click({ timeout: 15000 });
  await page.waitForTimeout(6000);

  const after = await page.locator("body").innerText();
  list.ok(!/not sold in single pieces|short of a full carton|violates|constraint/i.test(after),
    "the ledger accepted all three together -- no refusal of any kind");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await browser.close();

// ── WHAT THE LEDGER RECORDED, ONE WAY AT A TIME ────────────────────────────
// qty is NUMERIC, so it renders "1.000" — trimmed, because the assertion is
// about the unit and the flag, not about how Postgres prints a decimal.
const lineOf = (code) => scalar(`select sol.uom || '|' || trim(trailing '.' from trim(trailing '0' from sol.qty::text))
                                   || '|' || round(sol.unit_price_mvr,2) || '|' || sol.is_mixed_carton_fill
  from sales_order_lines sol join skus s on s.id=sol.sku_id
  where s.internal_code = '${code}' order by sol.created_at desc limit 1;`);

const carton = lineOf(CARTON);
list.is(carton, "carton|1|220.00|false",
  `WAY 2 is ONE CARTON at MVR 220, and NOT a mixed-carton fill (${carton || "no line"})`);

const mixA = lineOf(MIX_A);
list.ok(/^piece\|3\|/.test(mixA) && /\|true$/.test(mixA),
  `WAY 1 is three loose bottles marked as a mixed-carton fill (${mixA || "no line"})`);

const single = lineOf(SINGLE);
list.is(single, "pack|1|40.00|false",
  `WAY 3 is ONE PACK -- which for a 1x6 product is one bottle -- at MVR 40, and NOT a fill (${single || "no line"})`);

// ── AND THE STOCK MOVED BY EXACTLY WHAT WAS SOLD ───────────────────────────
// The half a line-level check cannot see: a line can be right while the shelf
// is wrong. Six bottles for the carton, three and three for the mix, one loose.
const moved = (code) => before[code] - Number(stockOf(code));
list.is(String(moved(CARTON)), "6", `six bottles left the shelf for the whole carton (${moved(CARTON)})`);
list.is(String(moved(MIX_A)), "3", `three for the first colour of the mix (${moved(MIX_A)})`);
list.is(String(moved(MIX_B)), "3", `three for the second (${moved(MIX_B)})`);
list.is(String(moved(SINGLE)), "1", `and exactly one for the loose bottle (${moved(SINGLE)})`);

finish(list.report());

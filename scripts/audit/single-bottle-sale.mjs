// Selling ONE Sosoft bottle, through the sheet Ali actually uses.
//
// Ali, 2026-08-24, with a screenshot of the Sosoft sheet: *"I still can't add
// sosoft single bottle."*
//
// ── THE MISS THIS AUDIT EXISTS FOR ──────────────────────────────────────────
//
// Migration 0208 gave every Sosoft SKU a `pack` tier and I reported that
// "selling needed no new UI at all", because the New Sale sheet renders
// `sellableTiers(sku.sellable_units)`. That is true of the GENERIC product
// sheet — and Sosoft never reaches it. A brand with `mixed_carton_pieces` is
// routed to its own MixedCartonSheet, which had exactly two modes, both counted
// in cartons, and read nothing from `sellable_units` at all.
//
// The data change was real and invisible. The giveaway audit passed because it
// drives Stock Ops, not a sale. Nothing drove the sell path for a mixed-carton
// brand, so nothing caught it: I shipped a claim the gate could not check.
//
// Uses the SHARED FIXTURE rather than building a catalogue, exactly as
// journey.mjs does — the fixture is Sosoft-shaped on purpose, and a second
// hand-built version of it is a second thing to keep true.
//
// Usage:  node scripts/audit/single-bottle-sale.mjs

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

const CODE = "SOSO-BLUE-1x6";

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

const before = scalar(`select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)),0)
  from stock_movements sm join skus s on s.id=sm.sku_id where s.internal_code='${CODE}';`);
const linesBefore = scalar(`select count(*) from sales_order_lines sol
  join skus s on s.id=sol.sku_id where s.internal_code='${CODE}';`);

const browser = await launch();
const list = checklist("Selling ONE bottle, through the sheet Ali actually uses");
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

  const sheet = await openPicker(page, "Sosoft");
  const opened = await sheet.innerText();

  list.ok(/one colour/i.test(opened) && /mixed carton/i.test(opened),
    "the Sosoft sheet opens with the two ways of buying he already had");
  // THE WHOLE POINT. This tab did not exist, which is why he could not add one.
  list.ok(/single bottles/i.test(opened),
    "and a THIRD way: Single bottles — the tab that was missing");
  list.ok(/one bottle at a time/i.test(opened),
    "the header says so too, instead of calling the product carton-only");

  await sheet.getByRole("button", { name: /^single bottles$/i }).first().click();
  await page.waitForTimeout(800);
  const loose = await sheet.innerText();

  // The BOTTLE price, not the carton rate divided by six.
  list.ok(/MVR\s*40\s*\/\s*bottle/i.test(loose.replace(/\s+/g, " ")),
    "each bottle is priced at its own MVR 40, not the MVR 220 carton divided by six");
  list.ok(!/\bpcs\b|\bpieces\b/i.test(loose), "and nothing on the sheet says pcs");

  await sheet.getByRole("button", { name: "One more Blue" }).click();
  await page.waitForTimeout(600);
  const withOne = await sheet.innerText();
  list.ok(/Add 1 bottle . MVR 40/i.test(withOne.replace(/\s+/g, " ")),
    "the button offers to add ONE bottle for MVR 40");

  await sheet.getByRole("button", { name: /add 1 bottle/i }).first().click();
  await page.waitForTimeout(2000);

  const cart = await page.locator("body").innerText();
  list.ok(!/short of a full carton|more bottles needed/i.test(cart),
    "a single bottle is NOT treated as an unfinished mixed carton -- the thing that made it impossible");

  const cont = page.getByRole("button", { name: /^(continue|review)/i }).first();
  if (await cont.count() > 0) { await cont.scrollIntoViewIfNeeded(); await cont.click(); await page.waitForTimeout(1800); }
  const place = page.getByRole("button", { name: /place order|confirm sale|create order/i }).first();
  await place.scrollIntoViewIfNeeded();
  await place.click({ timeout: 15000 });
  await page.waitForTimeout(6000);

  const after = await page.locator("body").innerText();
  list.ok(!/not sold in single pieces|short of a full carton|violates|constraint/i.test(after),
    "the ledger accepted it -- no 'not sold in single pieces', no whole-carton refusal");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await browser.close();

// ── WHAT THE LEDGER RECORDED ───────────────────────────────────────────────
// qty is NUMERIC, so it renders "1.000" — trimmed, because the assertion is
// about the unit and the price, not about how Postgres prints a decimal.
const line = scalar(`select sol.uom || '|' || trim(trailing '.' from trim(trailing '0' from sol.qty::text))
                       || '|' || round(sol.unit_price_mvr,2)
                       || '|' || sol.is_mixed_carton_fill
  from sales_order_lines sol join skus s on s.id=sol.sku_id
  where s.internal_code = '${CODE}' order by sol.created_at desc limit 1;`);
const after = scalar(`select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)),0)
  from stock_movements sm join skus s on s.id=sm.sku_id where s.internal_code='${CODE}';`);
const linesAfter = scalar(`select count(*) from sales_order_lines sol
  join skus s on s.id=sol.sku_id where s.internal_code='${CODE}';`);

list.is(String(Number(linesAfter) - Number(linesBefore)), "1", "exactly one new order line was written");
list.is(line, "pack|1|40.00|false",
  `it is ONE PACK -- which for a 1x6 product is one bottle -- at MVR 40, and NOT a mixed-carton fill (${line || "no line"})`);
list.is(String(Number(before) - Number(after)), "1",
  `and exactly one bottle left the shelf (${before} then ${after})`);

finish(list.report());

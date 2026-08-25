// Picking a product in Stock Ops leaves one product on screen, and one word per
// unit.
//
// Ali, 2026-08-25, with a screenshot of the Giveaway sheet:
// *"In stockops give away when I select a product the other products are
// scrolling behind. There no way to go back. Also there is 2 bottles option
// when I choose sosoft."*
//
// ── TWO DEFECTS, AND NEITHER WAS VISIBLE TO ANY EXISTING CHECK ──────────────
//
// 1. THE PICKER DID NOT GO AWAY. Choosing a product opened the form ABOVE a
//    list that still rendered every other product, inside its own
//    `max-h-[42vh] overflow-y-auto` — a scroll region nested in a page that
//    also scrolls, which CLAUDE.md forbids outright ("the page scrolls, not
//    inner panes"). So the form and a finished-with list fought for the same
//    gesture, and the only way to deselect was to scroll past the form and tap
//    the chosen row again — an undiscoverable gesture. The same shape was in
//    the Transfer and Write-off tabs; all three are fixed.
//
// 2. THE TOGGLE SAID `ctn | btl | btl`. The five Sosoft SKUs carried
//    sellable_units = {carton, pack, piece}, and for a 1 x 6 product `pack` and
//    `piece` are the same physical thing — one bottle — so both render "btl".
//    Migration 0210 removed the duplicate tier and added a CHECK; the toggle
//    also de-duplicates by label, because the data was wrong for weeks with
//    nothing watching.
//
// The giveaway audit passed throughout: it drives the form, and both defects
// are in what surrounds the form.
//
// Usage:  node scripts/audit/giveaway-picker.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  process.exit(2);
}
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const list = checklist("Picking a product leaves one product on screen, and one word per unit");

// THE DATA RULE, FIRST. If a 1-per-pack SKU can carry both tiers again, the
// screen check below would be testing a screen that has nothing to de-duplicate.
const dup = q1(`select count(*) from skus
   where pcs_per_pack = 1 and 'piece' = any(sellable_units) and 'pack' = any(sellable_units);`);
list.is(dup, "0", `no product sells the same unit as both a pack and a piece (${dup})`);

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });

try {
  await page.goto(`${BASE}/stock-ops?tab=giveaway`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  // The warehouse the fixture's stock is actually in. The tab opens on the
  // DEFAULT godown, which holds nothing, so without this the list is legitimately
  // empty and every check below would be testing an empty screen.
  await page.getByLabel("Warehouse").selectOption({ label: "Veesange" });
  await page.waitForTimeout(2000);

  const before = await page.locator("body").innerText();
  // THE DEEP LINK ITSELF. `?tab=giveaway` was missing from the tab parser and
  // landed on Verify Count in silence — the same defect the file's own comment
  // records happening to `?tab=receive`.
  list.ok(/give away|giveaway|prizes and samples/i.test(before),
    "?tab=giveaway actually opens Giveaway, not the tab it falls back to");
  list.ok(/Sosoft/i.test(before), "the giveaway list shows what is in the warehouse");
  const others = /Mamypoko|Fixture/i.test(before);
  list.ok(others, "including products other than the one about to be picked");

  // Pick the Sosoft row — the product in his screenshot.
  await page.locator("button:visible").filter({ hasText: /Sosoft/i }).first().click();
  await page.waitForTimeout(1500);
  const after = await page.locator("body").innerText();

  // ── 1. THE PICKER IS GONE ────────────────────────────────────────────────
  list.ok(/Which promotion/i.test(after), "the giveaway form opens for the product picked");
  list.ok(!/Mamypoko|Fixture Detergent/i.test(after),
    "and every OTHER product is gone — nothing left to scroll behind the form");

  // ── THE WAY BACK IS A CONTROL, NOT A GESTURE ─────────────────────────────
  const back = page.getByRole("button", { name: /choose a different product/i }).first();
  list.is(await back.count(), 1, "there is a named way back, not a hidden second tap");

  // ── 2. ONE WORD PER UNIT ─────────────────────────────────────────────────
  // Count the toggle's buttons by their exact labels rather than by scraping
  // text: "btl" also appears in the quantity placeholder, so a body-text match
  // would find it whether or not the toggle was fixed.
  const btl = await page.getByRole("button", { name: "btl", exact: true }).count();
  const ctn = await page.getByRole("button", { name: "ctn", exact: true }).count();
  list.is(String(btl), "1", `exactly ONE bottle button, not two (${btl})`);
  list.is(String(ctn), "1", `and one carton button (${ctn})`);

  // ── AND IT STILL DOES THE JOB ────────────────────────────────────────────
  // The tier that survived is the trade tier, so a single bottle can still be
  // given away — which is the whole reason Sosoft has a pack tier at all.
  await page.getByRole("button", { name: "btl", exact: true }).first().click();
  await page.waitForTimeout(500);
  // Read the ATTRIBUTE, not the page text: a placeholder is not in innerText,
  // so the first version of this check failed on a screen that was correct.
  const ph = await page.getByLabel("Campaign name").locator("xpath=../../..")
    .locator('input[type="number"]').first().getAttribute("placeholder");
  list.is(ph, "How many btl?",
    `choosing it asks how many bottles — a single bottle can still be given away (${ph})`);

  // ── NO NESTED SCROLL ANYWHERE ON THE TAB ─────────────────────────────────
  // Measured on the rendered page, not read off the source: an in-page element
  // that scrolls inside a page that also scrolls is the double-scroll CLAUDE.md
  // bans, and it is invisible in review.
  const nested = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return [...main.querySelectorAll("*")].filter((el) => {
      const s = getComputedStyle(el);
      const scrolls = s.overflowY === "auto" || s.overflowY === "scroll";
      return scrolls && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0;
    }).length;
  });
  list.is(String(nested), "0", `nothing inside the page owns its own scroll (${nested})`);

  // ── THE WAY BACK ACTUALLY GOES BACK ──────────────────────────────────────
  await back.click();
  await page.waitForTimeout(1200);
  const returned = await page.locator("body").innerText();
  list.ok(/Mamypoko|Fixture/i.test(returned), "tapping it brings the whole list back");
  list.ok(!/Which promotion/i.test(returned), "and closes the form, so the screen is one job at a time");

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();
finish(list.report());

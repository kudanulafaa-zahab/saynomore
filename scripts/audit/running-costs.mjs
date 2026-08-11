// Running costs — does the P&L tell the truth about them?
//
// The bug this guards was not a crash. get_pnl reported MVR 13,790 "net
// profit" for a month whose running costs were MVR 0, in 32px confident green,
// because business_expenses held ONE row in the app's entire life — the app
// modelled rent (identical every month) as a one-off event and asked again
// every month. Ali reads his profit here and nowhere else.
//
// Two things therefore have to stay true, and neither is visible in a unit
// test because both are about what the SCREEN claims:
//
//   * with no running costs recorded, the bottom line must NOT call itself Net
//     Profit. It is profit before the cost of running the business, it must say
//     so, and it must offer the one tap that fixes it.
//   * the moment costs exist, it must become a real Net Profit — otherwise the
//     honest state is just a nag that never goes away and gets ignored.
//
// It also holds the jargon line: COGS must never come back to this screen.
//
// Usage:  node scripts/audit/running-costs.mjs

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

import { execFileSync } from "node:child_process";

// This audit asserts the EMPTY state first ("no running costs recorded"), and
// then creates one — so it consumes what it tests. Run it twice on a laptop and
// the second run fails at check 1, which is not a failure and is exactly the
// flakiness that teaches people to ignore red. Same problem grn.mjs has, same
// solution: reset the fixture first.
//
// Local databases only. These statements against production would delete real
// expenses out of the P&L.
const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit deletes expenses to reset its fixture.");
  process.exit(2);
}
execFileSync("psql", [DB, "-q", "-c",
  "delete from business_expenses where recurring_id is not null; delete from recurring_expenses;"],
  { encoding: "utf8" });

const browser = await launch();
const list = checklist("Running costs — the feature itself");
const { ctx, page } = await signedInPage(browser, { device: "phone", scheme: "light" });
try {
  // ── The P&L must NOT claim net profit with no running costs ──────────────
  await page.goto(`${BASE}/financials`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  const pnl = await page.locator("body").innerText();
  // THE TERM IS ALWAYS "NET PROFIT" — Ali, 2026-08-10: "Don't change the
  // finance or account terms like cogs net profit etc... Always use correct
  // terms where applicable." An earlier version of this feature renamed the
  // line to "Profit before running costs" when expenses were missing, and this
  // audit enforced that rename. Both were wrong: a standard subtotal keeps its
  // standard name, and the incompleteness is carried by a note beside it.
  list.ok(/net profit/i.test(pnl),
    "the bottom line is called Net Profit -- the correct term, always");
  list.ok(!/profit before running costs/i.test(pnl),
    "and is NOT renamed to a paraphrase when expenses are missing");
  list.ok(/no operating expenses recorded this period/i.test(pnl),
    "with no expenses recorded, it says so plainly and says the real figure is lower");
  list.ok(/add operating expenses/i.test(pnl),
    "and offers the one tap that fixes it");
  list.ok(/COGS/.test(pnl),
    "COGS is present -- the proper accounting term is kept, not paraphrased");
  list.ok(/gross profit/i.test(pnl),
    "so is Gross Profit");

  // ── Expenses offers the repeat choice ────────────────────────────────────
  await page.goto(`${BASE}/expenses`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const exp = await page.locator("body").innerText();
  list.ok(/every month/i.test(exp), "Expenses offers 'Every month'");
  list.ok(/one time/i.test(exp),    "and 'One time'");
  list.ok(/operating expenses/i.test(exp),
    "and explains what is missing, in the proper term");

  // ── Record a real monthly cost, end to end ───────────────────────────────
  await page.getByRole("button", { name: /^every month$/i }).first().click();
  await page.locator('input[type="number"]').first().fill("5000");
  await page.getByRole("button", { name: /^save$/i }).first().click();
  await page.waitForTimeout(4000);
  const after = await page.locator("body").innerText();
  list.ok(/recurring expenses/i.test(after), "the expense appears under 'Recurring Expenses'");
  list.ok(/a month/i.test(after), "labelled per month, in words");

  // ── And the P&L becomes honest ───────────────────────────────────────────
  await page.goto(`${BASE}/financials`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  const pnl2 = await page.locator("body").innerText();
  list.ok(/net profit/i.test(pnl2), "the P&L still calls it Net Profit");
  list.ok(!/no operating expenses recorded this period/i.test(pnl2),
    "and the incomplete-figure caveat is gone now that expenses exist");
  list.ok(/operating expenses/i.test(pnl2),
    "with an Operating Expenses line in the breakdown");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0,2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow did not complete: ${String(e).split("\n")[0].slice(0,180)}`);
}
await ctx.close(); await browser.close();
finish(list.report());

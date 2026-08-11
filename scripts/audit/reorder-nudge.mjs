// Customers who have run out — does the app actually ASK for the second order?
//
// THE BUSINESS FACT THIS GUARDS. 52 of 73 customers have never bought twice,
// on a product a household finishes in about a fortnight (measured: the median
// pack lasts 6.8 days, a typical order is 2.5 packs). In a repeat-purchase
// business the second order is the whole game.
//
// The intelligence already existed and was invisible. get_customer_insights
// has computed `expected_supply_days` and flagged `ran_out` for months — it
// lived behind a lens on the Customers screen you had to know to open. The
// dashboard offered "Assign now", "Check COD", "Reorder now" and nothing about
// the people who are out of nappies today. A brain nobody hears is not
// intelligence, which is what this audit exists to keep true.
//
// It checks the whole path: the section appears, names people, says how long
// it has been and how long what they bought should have lasted, offers ONE TAP
// to WhatsApp with a first-name draft, and the "See all" link lands on the At
// risk lens rather than dumping you on A-Z. Plus the standing units rule: no
// piece count ever reaches this screen.
//
// The link SAFETY (never guess a phone number) is checked separately and
// without a browser by audit:wa — a bug there messages a stranger.
//
// Usage:  node scripts/audit/reorder-nudge.mjs

import { execFileSync } from "node:child_process";

// Self-contained fixture, like grn.mjs: the seeded customer has a recent order,
// so nobody has "run out" and the section would correctly not render. This
// back-dates that order well past what it could have covered, then puts it back
// afterwards so a second run behaves identically. Local databases only.
const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit rewrites order dates to create a run-out case.");
  process.exit(2);
}
const q = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const CUST = "(select id from customers order by created_at limit 1)";
// 400 days, not 45. The earlier version used 45 and passed alone but FAILED
// when run after journey.mjs and offline.mjs — those place extra orders for the
// same fixture customer, so their last order becomes much larger and 45 days no
// longer exceeds what it could have covered. An audit whose result depends on
// which audits ran before it is not a check, it is a coin toss. 400 days is
// past any plausible supply from any order this fixture can produce.
q(`update sales_orders set created_at = now() - interval '400 days' where customer_id = ${CUST};`);

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";
const b = await launch();
const list = checklist("Dashboard — customers who have run out");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });
try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);
  const txt = await page.locator("body").innerText();
  list.ok(/probably out of stock at home/i.test(txt), "the section appears when someone has run out");
  list.ok(/due a top-up/i.test(txt), "it says how many customers");
  list.ok(/Ahmed Ziyad/.test(txt), "and names them");
  list.ok(/last ordered \d+ days ago/i.test(txt), "with how long it has been");
  list.ok(/bought about \d+ days' worth/i.test(txt), "and how long what they bought should have lasted");
  list.ok(!/\bpcs\b|pieces/i.test(txt), "no piece counts anywhere on the dashboard");

  const wa = page.getByRole("link", { name: /message ahmed ziyad on whatsapp/i }).first();
  list.ok(await wa.count() > 0, "a one-tap Message button is offered");
  const href = await wa.getAttribute("href");
  list.ok(!!href?.startsWith("https://wa.me/960"), `it opens WhatsApp with a Maldives number (${href?.slice(0,26)}…)`);
  list.ok(!!href?.includes("?text=Hi%20Ahmed"), "with a first-name draft, not auto-sent");

  const seeAll = page.getByRole("link", { name: /see all/i }).first();
  list.ok(await seeAll.count() > 0, "and a link to the full list");
  list.is(await seeAll.getAttribute("href"), "/customers?lens=risk", "which deep-links to the At risk lens");

  await seeAll.click();
  await page.waitForTimeout(3500);
  const cust = await page.locator("body").innerText();
  list.ok(/at risk/i.test(cust), "the Customers screen opens on At risk, not A–Z");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0,2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0,180)}`);
}
await ctx.close(); await b.close();

// Put the fixture back so the next run starts from the same place.
q(`update sales_orders set created_at = now() - interval '1 day' where customer_id = ${CUST};`);

finish(list.report());

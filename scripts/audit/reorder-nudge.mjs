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

  // THREE DRAFTS, AND THE WORD IS "WE".
  // Ali, 2026-08-12: "I need to be able to select a message from 3 options.
  // Don't use 'I'. Use 'we'." One canned line is a form letter, and the same
  // form letter twice to one customer is worse than not writing.
  // ONE OWNER FOR THE FOLLOW-UP JOB.
  // The morning briefing below this card used to list the SAME customers as
  // sentences — same names, same two facts, and a worse action ("Worth a call
  // (9409259)", a phone number you cannot tap). Ali, 2026-08-12: "In dashboard
  // you're also duplicating the same stuff for which you gave the better option
  // to message. Below it is a list of same people."
  // A name may appear ONCE on this screen.
  const nameHits = (await page.locator("body").innerText()).match(/Ahmed Ziyad/g) ?? [];
  list.is(nameHits.length, 1, `a customer is named ONCE on the dashboard, not repeated in the briefing (found ${nameHits.length})`);
  list.ok(!/worth a call/i.test(txt), "no 'Worth a call' sentence duplicating the Message button");

  const msg = page.getByRole("button", { name: /message ahmed ziyad on whatsapp/i }).first();
  list.ok(await msg.count() > 0, "a one-tap Message button is offered");
  await msg.click();
  await page.waitForTimeout(1200);

  const links = page.locator('a[href^="https://wa.me/"]');
  const n = await links.count();
  list.is(n, 3, "the picker offers THREE drafts to choose from");

  const hrefs = [];
  for (let i = 0; i < n; i++) hrefs.push(await links.nth(i).getAttribute("href"));
  list.ok(hrefs.every((h) => h?.startsWith("https://wa.me/960")),
    `every draft opens WhatsApp with a Maldives number (${hrefs[0]?.slice(0, 26)}…)`);
  list.ok(hrefs.every((h) => h?.includes("?text=Hi%20Ahmed")), "each carries a first-name draft, not auto-sent");
  list.is(new Set(hrefs).size, 3, "the three drafts are actually DIFFERENT, not one text three times");

  // "I can deliver today" makes the business sound like one man with a scooter,
  // and stops being true the moment a driver delivers. Checked on the decoded
  // text, since the href is percent-encoded.
  const decoded = hrefs.map((h) => decodeURIComponent(h ?? ""));
  list.ok(decoded.every((t) => !/\bI\b|\bI'|\bmy\b/.test(t)),
    `no draft speaks as "I" (${decoded.find((t) => /\bI\b|\bI'|\bmy\b/.test(t))?.slice(0, 60) ?? ""})`);
  list.ok(decoded.some((t) => /\bwe\b/i.test(t)), 'the drafts speak as "we"');

  await page.keyboard.press("Escape").catch(() => {});
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(800);

  const seeAll = page.getByRole("link", { name: /see all/i }).first();
  list.ok(await seeAll.count() > 0, "and a link to the full list");
  list.is(await seeAll.getAttribute("href"), "/customers?lens=risk", "which deep-links to the At risk lens");

  // THE DESTINATION HAS TO BE USEFUL, NOT MERELY CORRECT.
  // This used to assert the href and then that the word "At risk" appeared —
  // both true while the page it landed on ranked people by PROFIT, showed no
  // reason and offered no way to act. Ali: "absolutely useless since I can't
  // see who's at risk of running out or who ran out already." A check that
  // tests the link instead of the destination is how a half-built feature gets
  // reported as done.
  await seeAll.click();
  await page.waitForTimeout(4000);
  const cust = await page.locator("body").innerText();
  list.ok(/at risk/i.test(cust), "the Customers screen opens on At risk, not A–Z");
  list.ok(/probably out of stock at home/i.test(cust), "it separates who has RUN OUT from who is merely late");
  list.ok(/Ahmed Ziyad/.test(cust), "and names them");
  list.ok(/last ordered \d+ days ago/i.test(cust), "with how long it has been");
  list.ok(/days' worth|usually every \d+ days/i.test(cust), "and the reason they are on the list");
  list.ok(await page.getByRole("button", { name: /message ahmed ziyad on whatsapp/i }).count() > 0,
    "and the SAME Message button as the dashboard — the list is actionable, not a report");
  list.ok(!/\bpcs\b|pieces/i.test(cust), "no piece counts on the At risk list either");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0,2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0,180)}`);
}
await ctx.close(); await b.close();

// Put the fixture back so the next run starts from the same place.
q(`update sales_orders set created_at = now() - interval '1 day' where customer_id = ${CUST};`);

finish(list.report());

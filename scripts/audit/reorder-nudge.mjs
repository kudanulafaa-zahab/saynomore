// The At risk lens — is the destination worth arriving at?
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
// This file checks the screen a person lands on when they want the whole list
// rather than today's round: it separates who has RUN OUT from who is merely
// late, names them, says how long it has been and why, and offers the same one
// tap to WhatsApp. Plus the standing units rule: no piece count reaches it.
//
// The link SAFETY (never guess a phone number) is checked separately and
// without a browser by audit:wa — a bug there messages a stranger.
//
// ── WHAT MOVED, 2026-08-20 ────────────────────────────────────────────────
// The dashboard half of this audit is gone, and deliberately. Migration 0188
// gave the follow-up job a QUEUE that can act — one customer at a time, send or
// skip, every decision remembered — and took those people off the worklist so
// nobody is named twice on one screen. followup-round.mjs owns that half now,
// and asserts more than this ever did: that the round ends, that a skip is
// recorded, and that the same person is not offered again tomorrow.
//
// What is left here is the DESTINATION, and it is worth keeping on its own.
// "See all" has to land somewhere useful, and this file exists because it once
// did not: the link was correct while the page behind it ranked people by
// profit, showed no reason and offered no way to act. A check that tests the
// link instead of the destination is how a half-built feature gets reported as
// done.
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
// THE BACK-DATE IS COMPUTED, NOT A CONSTANT — and the two constants before it
// were both wrong for the same reason.
//
// `ran_out` fires when days_since_last > max(expected_supply_days * 1.5, 14).
// journey.mjs and offline.mjs place extra orders for this same fixture
// customer, and collapsing every order onto one instant makes that instant's
// "last buy" bigger on every run — so expected_supply_days GROWS, and with it
// the threshold. 45 days passed alone and failed after those two. 400 days
// survived longer and then failed too, at 276 days of supply: 276 * 1.5 = 414.
//
// A fixed number can only ever postpone this. So: collapse the orders first,
// ask the function what supply it now sees, then back-date past 1.5x THAT with
// 30 days to spare. Whatever history has accumulated, the case is a run-out.
//
// The lesson the two earlier constants missed: "an audit whose result depends
// on which audits ran before it is not a check, it is a coin toss" is not
// fixed by choosing a bigger number — it is fixed by removing the dependency.
q(`update sales_orders set created_at = now() - interval '400 days' where customer_id = ${CUST};`);
q(`update sales_orders set created_at = now() - make_interval(days => (
     select greatest((coalesce(expected_supply_days, 0) * 1.5)::int, 14) + 30
     from get_customer_insights() where customer_id = ${CUST}
   )) where customer_id = ${CUST};`);

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";
const b = await launch();
const list = checklist("At risk — the destination is worth arriving at");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });
try {
  // THE DESTINATION HAS TO BE USEFUL, NOT MERELY CORRECT.
  // This used to assert the href and then that the word "At risk" appeared —
  // both true while the page it landed on ranked people by PROFIT, showed no
  // reason and offered no way to act. Ali: "absolutely useless since I can't
  // see who's at risk of running out or who ran out already." A check that
  // tests the link instead of the destination is how a half-built feature gets
  // reported as done.
  await page.goto(`${BASE}/customers?lens=risk`, { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  const cust = await page.locator("body").innerText();
  list.ok(/at risk/i.test(cust), "the Customers screen opens on At risk, not A–Z");
  list.ok(/probably out of stock at home/i.test(cust), "it separates who has RUN OUT from who is merely late");
  list.ok(/Ahmed Ziyad/.test(cust), "and names them");
  list.ok(/last ordered \d+ days ago/i.test(cust), "with how long it has been");
  list.ok(/days' worth|usually every \d+ days/i.test(cust), "and the reason they are on the list");
  list.ok(await page.getByRole("button", { name: /message ahmed ziyad on whatsapp/i }).count() > 0,
    "and the same one-tap Message button the round offers — a list that can act, not a report");
  list.ok(!/\bpcs\b|pieces/i.test(cust), "no piece counts on the At risk list either");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0,2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0,180)}`);
}
await ctx.close(); await b.close();

// Put the fixture back so the next run starts from the same place.
q(`update sales_orders set created_at = now() - interval '1 day' where customer_id = ${CUST};`);

finish(list.report());

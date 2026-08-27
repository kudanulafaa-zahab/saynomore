// The follow-up round: does the app ask for the second order, or wait to be asked?
//
// 55 of Ali's 81 customers bought once. A customer who comes back is worth
// MVR 1,098 against MVR 485, and the 26 who repeat make 52% of the revenue. The
// app has known who was due for months — get_customer_insights has flagged
// `ran_out` since July, and 0184 put those people on the dashboard.
//
// None of that is the same as ACTING. A list waits to be read; this is a queue
// that ends, remembers, and can be asked whether it worked (0188).
//
// WHAT ONLY A BROWSER CAN CHECK HERE. pgTAP owns the cooldown, the ordering and
// the results arithmetic (followup_round.test.sql). What it cannot see is the
// thing that decides whether the feature exists at all:
//
//   * the card reaches the dashboard, with the money on it
//   * the round opens as ONE customer, not a list to browse
//   * choosing a draft opens WhatsApp with a real Maldives number
//   * and — the one that matters most — the decision is RECORDED, so the same
//     person is not put in front of him again tomorrow
//
// That last one is what separates this from every list the app already had. A
// queue that forgets is a nag, and a nag is ignored inside a fortnight.
//
// Its own customer, created and cleaned up here: the shared fixture picks up
// order history from journey.mjs and offline.mjs, and an audit whose result
// depends on which audits ran before it is not a check.
//
// Usage:  node scripts/audit/followup-round.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates a customer and an order.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const NAME  = "Due A Topup";
const PHONE = "7714567";
const cleanup = `
  delete from customer_followups where customer_id in (select id from customers where name = '${NAME}');
  delete from order_payments where order_id in
    (select id from sales_orders where customer_id in (select id from customers where name = '${NAME}'));
  delete from sales_order_lines where order_id in
    (select id from sales_orders where customer_id in (select id from customers where name = '${NAME}'));
  delete from sales_orders where customer_id in (select id from customers where name = '${NAME}');
  delete from customers where name = '${NAME}';
`;
q(cleanup);

// One pack, 45 days ago — far past the supply that could have covered, so the
// insights engine calls them `ran_out`. A big order value so they sort to the
// top of the queue and the audit is not at the mercy of the fixture's others.
q(`
do $$
declare g uuid; c uuid; o uuid; s uuid; ppk int;
begin
  insert into customers (name, phone, channel) values ('${NAME}', '${PHONE}', 'whatsapp') returning id into c;
  select bs.godown_id, bs.sku_id, sk.pcs_per_pack into g, s, ppk
  from v_batch_stock bs join skus sk on sk.id = bs.sku_id
  where bs.qty_pieces_remaining >= sk.pcs_per_pack and sk.pcs_per_pack > 0
  order by bs.qty_pieces_remaining desc limit 1;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
  values ('FUA-1', c, 'delivered', g, now() - interval '45 days', now() - interval '45 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s, 'pack', 1, ppk, 5000, 5000);
  -- PAID. A customer who still owes money is deliberately kept out of the
  -- round — chase the debt, not another order — and this audit's first run
  -- found that rule missing precisely because its fixture had not paid.
  insert into order_payments (order_id, amount_mvr, method) values (o, 5000, 'cash');
end $$;`);

const list = checklist("The follow-up round asks for the second order");

const queued = Number(q1(`select count(*) from get_followup_queue(50) where name = '${NAME}';`));
list.is(queued, 1, "a customer past the supply they bought is in the round");

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });
try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);
  const body = await page.locator("body").innerText();

  list.ok(/follow up with \d+ customer/i.test(body),
    "the dashboard offers the round without being asked");
  list.ok(/MVR [\d,]+ of orders at stake/i.test(body),
    "and says what it is worth, so it competes with the other work on money");

  // THE SAME PERSON MUST NOT BE ON THE DASHBOARD TWICE. The worklist used to
  // carry these people as rows; 0188 hands them to the round, which can act.
  // Ali, 2026-08-12: "you're also duplicating the same stuff… Below it is a
  // list of same people."
  const nameHits = (body.match(new RegExp(NAME, "g")) ?? []).length;
  list.is(nameHits, 0, "and the worklist no longer names them as well — one owner for the job");

  await page.getByRole("button", { name: /follow up with/i }).first().click();
  await page.waitForTimeout(1500);
  const sheet = await page.locator("body").innerText();

  list.ok(sheet.includes(NAME), "the list names the customer");
  // WHY, AND HOW OVERDUE. This asserted "last ordered N days ago", which 0212
  // deliberately replaced: a raw age says nothing on its own, because 41 days
  // is not late for a customer who buys twice a year. The row now carries the
  // reason AND the distance past THIS customer's own due point, which is also
  // what the queue is ordered by — so the order on screen is explained by a
  // number on the same row. Both halves are asserted; dropping either would
  // let the row go back to being uninformative.
  list.ok(/probably out/i.test(sheet), "saying why they are due");
  list.ok(/\d+ days? past due|due about now|weeks past due/i.test(sheet),
    "and how far past THEIR OWN due point, not just how long ago they bought");
  list.ok(/usually MVR [\d,]+ an order/i.test(sheet),
    "and what an order from them is worth");

  // EVERY NAME IS VISIBLE AT ONCE. It was a one-at-a-time queue for about an
  // hour. Ali: "I only can see each customer after I choose or refuse. It's
  // terrible." He was right — these are people, and he knows things about them
  // the app never will, which needs seeing them together.
  const namesShown = await page.getByRole("button", { name: /^Not today for /i }).count();
  list.ok(namesShown >= 1, `every person due is on screen at once (${namesShown} rows)`);
  list.ok(!/follow up · 1 of/i.test(sheet), "not a one-at-a-time queue that hides the next name");

  // Three drafts, "we" not "I", a real Maldives number. Same promise as every
  // other message door in the app — because it IS the same component: the list
  // hands MessageButton the right words and is told which draft was picked, so
  // there is no second picker growing beside the first.
  await page.getByRole("button", { name: new RegExp(`Message ${NAME} on WhatsApp`, "i") }).first().click();
  await page.waitForTimeout(1200);
  const links = page.locator('a[href^="https://wa.me/"]');
  const n = await links.count();
  list.is(n, 3, "three drafts to choose from");
  const hrefs = [];
  for (let k = 0; k < n; k++) hrefs.push(await links.nth(k).getAttribute("href"));
  list.ok(hrefs.every((h) => h?.startsWith("https://wa.me/960")),
    `every draft opens WhatsApp with a Maldives number (${hrefs[0]?.slice(0, 24)}…)`);
  const decoded = hrefs.map((h) => decodeURIComponent(h ?? ""));
  list.ok(decoded.every((t) => !/\bI\b|\bI'|\bmy\b/.test(t)), 'no draft speaks as "I"');

  // ── IT REMEMBERS ──────────────────────────────────────────────────────────
  // The check the whole design rests on. Skip is used rather than send, because
  // clicking a wa.me link navigates the browser away mid-audit — and a skip is
  // the harder case anyway: it is the one a careless implementation forgets to
  // record, on the grounds that "nothing happened".
  // Close the draft picker before acting on the row behind it.
  await page.keyboard.press("Escape").catch(() => {});
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(900);

  await page.getByRole("button", { name: new RegExp(`^Not today for ${NAME}$`, "i") }).first().click();
  await page.waitForTimeout(2500);

  // MARKED, NOT VANISHED. A row that disappears when touched leaves no way to
  // check what you just did — the other half of the same complaint.
  const after = await page.locator("body").innerText();
  list.ok(after.includes(NAME), "the row stays on screen after being handled, marked rather than removed");

  const logged = q1(`
    select outcome from customer_followups
    where customer_id = (select id from customers where name = '${NAME}')
    order by created_at desc limit 1;`);
  list.is(logged, "skipped", "a skip is recorded — it is a decision, not an absence");

  const stillQueued = Number(q1(`select count(*) from get_followup_queue(50) where name = '${NAME}';`));
  list.is(stillQueued, 0, "and they leave the round, so tomorrow does not ask again");

  list.ok(!/\bpcs\b|\bpieces\b/i.test(sheet), "no piece counts anywhere in the round");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

try {
  q(cleanup);
} catch (e) {
  list.ok(false, `cleanup left rows behind: ${String(e).split("\n")[0].slice(0, 150)}`);
}

finish(list.report());

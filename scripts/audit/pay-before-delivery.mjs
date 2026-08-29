// Money can be recorded before the goods move.
//
// Ali, 2026-08-28:
//   *"In sales when a customer places an order and delivery is for example
//    after 2 days I cannot enter paid. I have to follow
//    confirmed-dispatched-delivered. Then only I can enter as paid."*
//
// ── PAYMENT AND DELIVERY ARE TWO DIFFERENT CLOCKS ──────────────────────────
//
// A customer can pay on order, on delivery, or weeks after it. The goods move
// on their own schedule. The payment ledger was rendered inside the DELIVERED
// card, so recording money required first walking the order through dispatch
// and delivery — which meant marking an order delivered on a day it was not,
// to get past a screen. Every report that reads `delivered_at` is then wrong,
// and nothing on the screen says why.
//
// THE ENGINE NEVER REQUIRED IT. `record_order_payment` refuses exactly two
// things: a draft (nothing confirmed to pay for) and a cancelled order
// (nothing owed). Everything else it accepts. This is the same shape as the
// bug that stranded him on SO-2026-117 with a return he could not record: the
// screen and the engine disagreeing, with the screen the stricter of the two.
//
// ── WHAT THIS ASSERTS, AND WHY THE LAST ONE MATTERS MOST ───────────────────
//
// Recording a payment must NOT advance the delivery status. If paying quietly
// marked the order delivered, the screen would look fixed while the ledger
// went on telling the same lie in a new place. The order must still be
// `confirmed` afterwards, with no delivered_at.
//
// Usage:  node scripts/audit/pay-before-delivery.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates an order and records a payment against it.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-tAc", sql], { encoding: "utf8" }).trim();

// Keyed off the customer, never the order number: trg_assign_sales_order_number
// rewrites whatever number the INSERT supplies, so matching on it deletes
// nothing and the next run trips over its own leftovers.
const NAME = "Pays In Advance";
q(`
  delete from order_payments where order_id in
    (select id from sales_orders where customer_id in (select id from customers where name = '${NAME}'));
  delete from sales_order_lines where order_id in
    (select id from sales_orders where customer_id in (select id from customers where name = '${NAME}'));
  delete from sales_orders where customer_id in (select id from customers where name = '${NAME}');
  delete from customers where name = '${NAME}';
`);

// A CONFIRMED order, and deliberately NOT cash-on-delivery: COD is the one
// case that genuinely waits for the driver, and it keeps its own flow.
q(`
do $$
declare c uuid; g uuid; s uuid; ppk int; o uuid;
begin
  insert into customers (name, phone, channel)
  values ('${NAME}', '7799002', 'whatsapp') returning id into c;
  select id into g from godowns limit 1;
  select id, pcs_per_pack into s, ppk from skus order by internal_code limit 1;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, payment_method)
  values ('PAY-1', c, 'confirmed', g, 'transfer') returning id into o;
  -- qty_pieces must equal qty x pcs_per_pack or enforce_sol_qty_pieces rejects
  -- the line outright, which is the ledger guard doing its job.
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s, 'pack', 1, ppk, 500, 500);
end $$;`);

const orderId = q1(`select o.id from sales_orders o
  join customers c on c.id = o.customer_id where c.name = '${NAME}' limit 1;`);

const list = checklist("Paid on order, delivered later");
list.ok(orderId.length > 0, `the fixture order exists (${orderId.slice(0, 8)})`);
list.is(q1(`select status from sales_orders where id = '${orderId}';`), "confirmed",
  "and it is CONFIRMED -- not dispatched, not delivered");

const browser = await launch();
const { ctx, page } = await signedInPage(browser, { device: "phone", scheme: "dark" });

try {
  await page.goto(`${BASE}/sales/${orderId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const before = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  list.ok(!/Delivered/.test(before.replace(/Mark .{0,20}Delivered/gi, "")),
    "the order is not showing as delivered");

  // ── THE CONTROL HAS TO BE THERE, ON A CONFIRMED ORDER ───────────────────
  const record = page.getByRole("button", { name: /record .*payment|add payment/i }).first();
  list.ok(await record.count() > 0,
    "a confirmed order offers somewhere to record a payment");

  await record.scrollIntoViewIfNeeded();
  await record.click();
  await page.waitForTimeout(1200);

  // The amount prefills from the server-computed outstanding balance, so the
  // common case -- paid in full, on order -- is one tap.
  const sheet = await page.locator("body").innerText();
  list.ok(/500/.test(sheet.replace(/\s+/g, "")),
    "the amount is prefilled with what is outstanding, so paying in full is one tap");

  const confirm = page.getByRole("button", { name: /^(record|save|add) payment/i }).last();
  await confirm.scrollIntoViewIfNeeded();
  await confirm.click();
  await page.waitForTimeout(3000);

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}

await ctx.close();
await browser.close();

// ── THE LEDGER RECORDED IT ─────────────────────────────────────────────────
list.is(q1(`select coalesce(sum(amount_mvr), 0)::int from order_payments
  where order_id = '${orderId}';`), "500",
  "the payment is in the ledger, in full");
list.is(q1(`select payment_status from sales_orders where id = '${orderId}';`), "paid",
  "and the order reads as paid");

// ── AND PAYING DID NOT PRETEND THE GOODS MOVED ─────────────────────────────
// The assertion that matters most. If recording money advanced the status,
// the screen would look fixed while the ledger told the same lie somewhere
// else -- and every report reading delivered_at would be wrong.
list.is(q1(`select status from sales_orders where id = '${orderId}';`), "confirmed",
  "the order is STILL confirmed -- paying is not delivering");
list.is(q1(`select coalesce(delivered_at::text, 'null') from sales_orders where id = '${orderId}';`), "null",
  "and it carries no delivery date it did not earn");

finish(list.report());

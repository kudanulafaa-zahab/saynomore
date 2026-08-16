// A returned order must never be called paid.
//
// Ali photographed SO-2026-117 on 2026-08-16 and said "This is very wrong and
// confusing." Two adjacent lines on his phone:
//
//     ✓ Paid in full          (green, with a tick)
//     Paid MVR 0 of MVR 207
//
// He had sold 1 pack of nappies, the customer rejected it at the door without
// paying, and the pack came back opened and unsellable. He recorded the return
// correctly. The app then awarded him a green tick for money that never
// existed.
//
// EVERY NUMBER UNDERNEATH WAS RIGHT — the balance, the stock, the P&L. The
// defect was the WORD, which is why no database test would have caught it and
// why this file has to drive a browser. `recalculate_order_payment_status`
// added the returned amount to the paid amount and called the total "paid";
// migration 0185 splits them, and 'settled' is the state for an invoice closed
// by goods rather than by money.
//
// WHAT THIS GUARDS, precisely: that the panel never again prints two sentences
// that contradict each other. A green tick is a claim about money received. If
// the screen can say "paid" while its own next line says MVR 0 arrived, then
// the screen cannot be trusted on any money question.
//
// The database side is settled_not_paid.test.sql — the vocabulary, the guards
// on Void and Delete, and the one definition of "unpaid". This one is the
// sentence on the glass.
//
// Usage:  node scripts/audit/returned-order.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit posts a sale and records a return against it.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const NAME = "Rejected At Door";
const cleanup = `
  delete from sales_returns where order_id in
    (select id from sales_orders where customer_id in (select id from customers where name = '${NAME}'));
  delete from stock_movements where source_id in
    (select id from sales_orders where customer_id in (select id from customers where name = '${NAME}'));
  delete from sales_order_lines where order_id in
    (select id from sales_orders where customer_id in (select id from customers where name = '${NAME}'));
  delete from sales_orders where customer_id in (select id from customers where name = '${NAME}');
  delete from customers where name = '${NAME}';
`;
q(cleanup);

// The whole order comes back, nothing was ever paid, and the pack is not
// sellable — Ali's exact case. `record_customer_return` is called through the
// real RPC rather than by inserting a row, because the flag it sets is the
// thing under test.
//
// A SKU WITH STOCK, not merely the first one in the catalogue: post_sale
// refuses to sell from nothing, and picking blind made this fixture depend on
// whichever audit ran before it.
q(`
do $$
declare c uuid; g uuid; s uuid; ppk int; o uuid;
begin
  insert into customers (name, phone, channel)
  values ('${NAME}', '7799007', 'whatsapp') returning id into c;

  select bs.godown_id, bs.sku_id, sk.pcs_per_pack into g, s, ppk
  from v_batch_stock bs
  join skus sk on sk.id = bs.sku_id
  where bs.qty_pieces_remaining >= sk.pcs_per_pack and sk.pcs_per_pack > 0
  order by bs.qty_pieces_remaining desc
  limit 1;
  if s is null then raise exception 'no SKU has a full pack in stock to sell'; end if;

  insert into sales_orders (order_number, customer_id, status, payment_status,
                            source_godown_id, created_at)
  values ('RET-1', c, 'draft', 'pending', g, now() - interval '2 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s, 'pack', 1, ppk, 207, 207);
  perform post_sale(o);
  update sales_orders set status = 'out_for_delivery' where id = o;

  perform record_customer_return(o, s, ppk, 'defective', 'credit', false, 'opened at the door');
end $$;`);

const orderId = q1(`
  select o.id from sales_orders o join customers c on c.id = o.customer_id
  where c.name = '${NAME}' limit 1;`);
const flag = q1(`select payment_status from sales_orders where id = '${orderId}';`);
const status = q1(`select status from sales_orders where id = '${orderId}';`);

const list = checklist("A returned order is never called paid");
list.is(flag, "settled", "the order is SETTLED in the database, not 'paid'");
list.is(status, "delivered",
  "and it closed itself — he should not have to go and mark it delivered by hand");

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });
try {
  await page.goto(`${BASE}/sales/${orderId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  const body = await page.locator("body").innerText();

  // THE SCREENSHOT. Both halves, because either one alone is survivable and
  // together they are a lie.
  list.ok(!/paid in full/i.test(body),
    "the screen never says 'Paid in full' about money that never arrived");
  list.ok(/returned\s*[—-]\s*nothing to pay/i.test(body),
    "it says what actually happened: returned, nothing to pay");

  // The line underneath the headline has to agree with it. "Paid MVR 0 of
  // MVR 207" under any kind of closed-order headline is the contradiction.
  list.ok(!/Paid\s+MVR\s+0\s+of/i.test(body),
    "and it does not report MVR 0 paid beside a closed order");
  list.ok(/MVR\s*207\s*returned of\s*MVR\s*207/i.test(body),
    "the money line states the return: MVR 207 returned of MVR 207");

  // "MVR 0 left" is not a sentence worth printing; the headline already said it.
  list.ok(!/MVR\s*0\s*left/i.test(body), "no 'MVR 0 left' hanging off the bar");

  // The standing units rule: this screen is money and packs, never pieces.
  list.ok(!/\bpcs\b|\bpieces\b/i.test(body), "no piece counts on the order screen");

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

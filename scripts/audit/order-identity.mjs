// Whose order is this? The Sales list must never guess.
//
// Ali, 2026-08-15: "When a new customer is created by selecting WhatsApp it
// shows as walk-in customer. There's no name on display. When I click and go
// back the name appears."
//
// THE BUG THIS GUARDS, precisely. The list used to render the customer by
// looking the id up in a SEPARATE list of customers, fetched once per mount and
// cached for five minutes, and falling back to "Walk-in" on a miss. So one
// label meant two unrelated things: an order that genuinely has no customer,
// and an order whose customer had not been downloaded yet. A brand-new customer
// is always the second case — which is why his order was attributed to nobody,
// and why coming back later "fixed" it.
//
// That is a reporting error, not a refresh annoyance. Who owes money is read off
// this screen, and an order silently filed under nobody is money nobody chases.
//
// WHY THE FIXTURE IS BUILT IN SQL AND NOT THROUGH THE UI. The whole point is a
// customer the browser has never heard of. Creating one through New Sale would
// put it straight into the component's state and prove nothing — the old code
// passed that path too. Inserting behind the app's back is the only way to
// reproduce the state that was broken, and it is exactly what happens in real
// life when the customer was added on another device, or in a session the list
// has already outlived.
//
// pgTAP checks the same invariant in the database (order_identity.test.sql).
// This one exists because the defect was in the CLIENT: the data was always
// there to be joined, and the screen chose to re-derive it instead.
//
// Usage:  node scripts/audit/order-identity.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit inserts a customer and an order directly.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const NAME = "Unseen Buyer";
// Keyed off the customer, never the order number: trg_assign_sales_order_number
// rewrites whatever number the INSERT supplies, so matching on it deletes
// nothing and the next run trips over its own leftovers.
const cleanup = `
  delete from sales_order_lines where order_id in
    (select id from sales_orders where customer_id in (select id from customers where name = '${NAME}'));
  delete from sales_orders where customer_id in (select id from customers where name = '${NAME}');
  delete from customers where name = '${NAME}';
`;
q(cleanup);

q(`
do $$
declare c uuid; g uuid; s uuid; ppk int; o uuid;
begin
  insert into customers (name, phone, channel)
  values ('${NAME}', '7799001', 'whatsapp') returning id into c;
  select id into g from godowns limit 1;
  select id, pcs_per_pack into s, ppk from skus order by internal_code limit 1;
  insert into sales_orders (order_number, customer_id, status, source_godown_id)
  values ('OID-1', c, 'confirmed', g) returning id into o;
  -- qty_pieces must equal qty x pcs_per_pack or enforce_sol_qty_pieces rejects
  -- the line outright, which is the ledger guard doing its job.
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s, 'pack', 1, ppk, 100, 100);
end $$;`);

const orderNo = q1(`
  select o.order_number from sales_orders o
  join customers c on c.id = o.customer_id where c.name = '${NAME}' limit 1;`);

const list = checklist("Whose order is this — the Sales list never guesses");
list.ok(orderNo.length > 0, `the fixture order exists (${orderNo})`);

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });
try {
  // ONE load, and no navigating away. The old bug healed itself on the second
  // visit, so a check that navigated first would have passed against it.
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);

  const body = await page.locator("body").innerText();
  list.ok(body.includes(NAME),
    "a customer the browser has never loaded is still shown by name, on first paint");

  // Scoped to THIS order's row: "Walk-in" is legitimate elsewhere on the screen
  // (the New Sale picker offers it), so a page-wide search would be meaningless.
  // The order's own link, not `.last()` of everything containing the number —
  // that resolves to the innermost node, which is just the number itself and
  // can never contain the name.
  const row = page.locator('a[href*="/sales/"]').filter({ hasText: new RegExp(orderNo) }).first();
  const rowText = await row.innerText();
  list.ok(!/walk-?in/i.test(rowText),
    "and their order is not filed under Walk-in");
  list.ok(rowText.includes(NAME), "the name is on the row itself, not merely somewhere on the page");

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

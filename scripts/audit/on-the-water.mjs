// The purchase list says what is already coming.
//
// On 2026-08-17 the Reorder screen was telling Ali to buy 49 cartons of goods
// sitting in a container he had already paid for — 10 of Xtra Kering XL against
// 13 afloat, 5 of L against 13, 20 of NB/S already coming. Migration 0187 makes
// the suggestion net of stock on order.
//
// WHY THIS NEEDS A BROWSER AS WELL AS pgTAP. The arithmetic is guarded by
// reorder_sees_the_water.test.sql. What a database test cannot see is whether
// the REASON reaches the screen. A suggestion that quietly drops from 10 to 0
// with nothing explaining it is worse than the bug it fixed: he cannot tell a
// corrected number from a broken one, and the honest response to a figure you
// cannot account for is to stop trusting the tool.
//
// So this drives the real screen and reads the line back.
//
// Its own shipment, its own SKU state: the GRN audit confirms the fixture's
// shipment during a full run, which would turn "arriving" into "arrived and
// received" halfway through the suite. An audit whose result depends on which
// audits ran before it is not a check.
//
// Usage:  node scripts/audit/on-the-water.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates a shipment.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const REF = "SH-AUDIT-WATER";
const CARTONS = 37;   // a number that appears nowhere else on the screen
const cleanup = `
  delete from shipment_lines where shipment_id in (select id from shipments where reference = '${REF}');
  delete from shipments where reference = '${REF}';
`;
q(cleanup);

// A SKU that already sells, so it is on the purchase list at all.
const sku = q1(`
  select sl.sku_id::text
  from sales_order_lines sl
  join sales_orders so on so.id = sl.order_id and so.status not in ('draft','cancelled')
  join skus s on s.id = sl.sku_id
  join variants v on v.id = s.variant_id
  join product_models pm on pm.id = v.model_id and pm.discontinued_at is null
  group by sl.sku_id order by sum(sl.qty_pieces) desc limit 1;`);

// Measured as a DELTA, never as an absolute. The fixture already has a shipment
// carrying this SKU, so "incoming == 37" was wrong the first time it ran — and
// wrong in the direction that would have had me "fixing" correct arithmetic.
const before = Number(q1(`
  select coalesce(incoming_cartons, 0) from get_reorder_suggestions() where sku_id = '${sku}';`));

q(`
do $$
declare v_ship uuid;
begin
  insert into shipments (reference, supplier_id, status, expected_arrival_date,
                         rate_usd_to_mvr, rate_usd_to_idr)
  values ('${REF}', (select id from suppliers limit 1), 'in_transit',
          (now() at time zone 'Indian/Maldives')::date + 9, 15.4, 15400)
  returning id into v_ship;
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (v_ship, '${sku}', ${CARTONS}, 0.036, 10, 'USD', (select id from godowns limit 1));
end $$;`);

const list = checklist("The purchase list says what is already coming");

// The database half, so a screen failure can be told apart from a maths one.
const suggested = Number(q1(`
  select suggested_cartons from get_reorder_suggestions() where sku_id = '${sku}';`));
const incoming = Number(q1(`
  select incoming_cartons from get_reorder_suggestions() where sku_id = '${sku}';`));
list.is(incoming - before, CARTONS,
  `a new container of ${CARTONS} cartons is counted as stock on order (was ${before}, now ${incoming})`);
list.is(suggested, 0, "and stops asking him to buy what he has already bought");

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });
try {
  await page.goto(`${BASE}/reorder`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);

  // "Needs ordering" is a shelf-health lens, and the shelf is deliberately
  // untouched by 0187 — a product with a full shelf and a container coming is
  // not "needing order", so it lives under All products. That is where the
  // incoming line has to be legible, because that is the tab he opens to decide
  // what else to put in the container.
  await page.getByRole("button", { name: /all products/i }).first().click();
  await page.waitForTimeout(3000);
  const body = await page.locator("body").innerText();

  list.ok(new RegExp(`${incoming}\\s*ctn already on the way`, "i").test(body),
    `the screen says "${incoming} ctn already on the way" (so a 0 is explained, not mysterious)`);
  list.ok(/arrives\s+\w/i.test(body),
    "and when it arrives, so he can judge whether it lands in time");

  // The standing units rule: a purchase list is cartons, never pieces.
  list.ok(!/\bpcs\b|\bpieces\b/i.test(body), "no piece counts on the purchase list");
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

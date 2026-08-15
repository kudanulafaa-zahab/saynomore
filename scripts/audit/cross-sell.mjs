// The cheapest sale is the one already going out the door.
//
// 55 customers buy nappies, 19 buy detergent, and NOT ONE buys both. Across 101
// orders no basket has ever held two categories. Every detergent sale needed its
// own conversation, its own delivery and its own trip — while a nappy order was
// being packed for the same person.
//
// The engine (get_cross_sell_suggestion, 0183) decides WHICH product and has its
// own pgTAP suite covering everything it must refuse. This checks the half pgTAP
// cannot see: that the offer actually REACHES the till, reads correctly, and
// adds through the same door as every other product.
//
// It also guards the two rules most easily broken by a card like this:
//   * no piece count ever reaches the screen
//   * the suggestion lives in the SCROLLING BODY, never the pinned footer —
//     reach.mjs enforces that the footer keeps holding the action
//
// Usage:  node scripts/audit/cross-sell.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates a category, a product and stock.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

// The shared fixture has ONE category, so there is nothing to cross-sell to.
// This adds a second, in the same warehouse the fixture order ships from.
// FULLY SELF-CONTAINED, including its own warehouse.
//
// Three earlier versions of this fixture leaned on the shared one and each
// failed for a different reason once `audit:ui` ran the other audits first:
// the godown it named had been emptied, then the deepest-stocked product was a
// mixed-carton one with its own flow, then the only product left was BELOW COST
// and quick-add correctly refused it (hard rule 7) so the basket stayed empty
// and the audit blamed the cross-sell card for the guard working.
//
// A private godown ends the argument: it contains exactly two products, one in
// a category this customer has bought and one in a category they have not, both
// above cost, so there is exactly one possible suggestion and no other audit
// can change it. "A check whose result depends on which audits ran before it is
// a coin toss, not a check."
const cleanup = `
  delete from sales_order_lines where sku_id in
    (select id from skus where internal_code in ('XSELL-BASKET-1x6','XSELL-OFFER-1x6'));
  delete from sales_orders where customer_id in (select id from customers where name = 'Cross Sell Buyer');
  delete from stock_movements where sku_id in
    (select id from skus where internal_code in ('XSELL-BASKET-1x6','XSELL-OFFER-1x6'));
  delete from inventory_batches where sku_id in
    (select id from skus where internal_code in ('XSELL-BASKET-1x6','XSELL-OFFER-1x6'));
  delete from skus where internal_code in ('XSELL-BASKET-1x6','XSELL-OFFER-1x6');
  delete from variants where model_id in (select id from product_models where name in ('Cross Basket','Cross Soap'));
  delete from product_models where name in ('Cross Basket','Cross Soap');
  delete from product_categories where name in ('Cross Bought Cat','Cross Offer Cat');
  delete from customers where name = 'Cross Sell Buyer';
  delete from godowns where name = 'Cross Godown';
`;
q(cleanup);

const GODOWN = "Cross Godown";
const BASKET_MODEL = "Cross Basket";

q(`
do $$
declare cb uuid; co uuid; b uuid; m1 uuid; m2 uuid; v1 uuid; v2 uuid;
        s1 uuid; s2 uuid; g uuid; batch uuid; cust uuid; o uuid;
begin
  insert into godowns (name) values ('Cross Godown') returning id into g;
  insert into product_categories (name, unit_uom, cost_basis) values ('Cross Bought Cat','bottle','piece') returning id into cb;
  insert into product_categories (name, unit_uom, cost_basis) values ('Cross Offer Cat','bottle','piece') returning id into co;
  select id into b from brands order by created_at limit 1;

  insert into product_models (brand_id, category_id, name) values (b, cb, 'Cross Basket') returning id into m1;
  insert into product_models (brand_id, category_id, name) values (b, co, 'Cross Soap')   returning id into m2;
  insert into variants (model_id, display_name) values (m1, 'Plain 700ml') returning id into v1;
  insert into variants (model_id, display_name) values (m2, 'Lemon 700ml') returning id into v2;

  -- One bottle to a pack, priced MVR 240 against MVR 100 of cost: comfortably
  -- above cost, so the below-cost guard is never what decides this run.
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v1, 'XSELL-BASKET-1x6', 1, 6, 240) returning id into s1;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v2, 'XSELL-OFFER-1x6', 1, 6, 240) returning id into s2;

  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s1, g, 10, 60, 100, 100, 600, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s1, g, 'in', 60, 'adjustment');

  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s2, g, 10, 60, 100, 100, 600, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s2, g, 'in', 60, 'adjustment');

  -- A customer who has bought the FIRST category and never the second.
  insert into customers (name, phone) values ('Cross Sell Buyer', '7714500') returning id into cust;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at)
  values ('XSELL-1', cust, 'delivered', g, now() - interval '6 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s1, 'pack', 1, 1, 240, 240);
end $$;`);

const list = checklist("The cheapest sale — offered at the till");

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });
const sheet = () => page.getByRole("dialog", { name: /new sale/i });
try {
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /new sale/i }).first().click();
  await page.waitForTimeout(2000);

  // Scoped to the sheet: unscoped this matches the order row behind it and
  // silently closes the sheet (the trap journey.mjs documents).
  await sheet().getByText("Cross Sell Buyer").first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /add products/i }).first().click();
  await page.waitForTimeout(2000);
  // The label carries a "(usual)" suffix for the default warehouse, so match
  // on the name rather than the whole string.
  await sheet().locator("select").first()
    .selectOption({ label: (await sheet().locator("select").first().locator("option").allInnerTexts())
      .find((o) => o.startsWith(GODOWN)) });
  await page.waitForTimeout(2000);

  // Nothing is suggested until something is in the basket — the whole argument
  // is "it travels with the order", so there has to be an order.
  const before = await page.evaluate(() => document.body.innerText);
  list.ok(!/Going out anyway/i.test(before),
    "nothing is suggested against an empty basket");

  await sheet().getByRole("button", { name: new RegExp(BASKET_MODEL, "i") }).first().click();
  await page.waitForTimeout(1200);
  await sheet().locator("button").filter({ hasText: /^\+$/ }).first().click();
  await page.waitForTimeout(3500);

  const t = await page.evaluate(() => document.body.innerText);
  if (process.env.XS_DEBUG) {
    console.log("GODOWN:", GODOWN, "MODEL:", BASKET_MODEL);
    console.log("SHEET:", (await sheet().innerText()).split("\n").map(x=>x.trim()).filter(Boolean).slice(0,40).join(" | "));
  }
  list.ok(/Going out anyway/i.test(t), "once the basket has something, an offer appears");
  list.ok(/Cross Soap/i.test(t), "and it names the product");
  list.ok(/MVR 240 a pack/i.test(t), "priced in the unit it is actually sold in");
  list.ok(/packs here/i.test(t), "saying how many PACKS are on that shelf");
  list.ok(!/\bpcs\b|\bpieces\b/i.test(t), "no piece count reaches this screen");

  const add = page.getByRole("button", { name: /add to this order/i }).first();
  list.ok(await add.count() > 0, "one tap adds it — a suggestion you cannot act on is a leaflet");

  await add.click();
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => document.body.innerText);
  list.ok(/Cross Soap/i.test(after), "the product really lands in the cart");
  list.ok(!/Going out anyway/i.test(after),
    "and the card goes away once taken — it never nags for the same thing twice");

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

try { q(cleanup); } catch (e) {
  list.ok(false, `cleanup left rows behind: ${String(e).split("\n")[0].slice(0, 150)}`);
}
finish(list.report());

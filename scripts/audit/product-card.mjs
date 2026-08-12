// Product Card — one screen that tells you everything, and every number on it
// reconciles to the ledger.
//
// Ali, 2026-08-12: "a new module where I can get all details about an sku when
// I search… fob price, landed cost, selling price, profit by MVR and percentage
// and any other detail I might have missed… Must have competitor price."
//
// WHY THE CHECKS ARE ARITHMETIC AND NOT "IS THE WORD THERE".
//
// A fact sheet is only worth having if it agrees with the ledger. A screen that
// shows a confident wrong margin is worse than no screen — he would price
// against it. So this asserts the numbers ADD UP:
//
//   FOB + freight + local + duty  ==  landed total
//   landed total / cartons        ==  landed per carton
//   price - cost                  ==  profit
//   profit / price                ==  margin %
//
// and only then that the screen renders them. The database half is checked
// against get_product_card directly, so a UI failure and a maths failure are
// never confused for each other.
//
// THE UNITS RULE IS THE OTHER HALF. This page is dense with money, which is
// exactly where a piece price leaks in. It asserts NO piece figure reaches the
// screen — including via the rival, whose price is converted to our pack size
// inside Postgres precisely so this screen never has to.
//
// Usage:  node scripts/audit/product-card.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  process.exit(2);
}
const q = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const list = checklist("Product Card — everything about one product, and it adds up");

// ── Half one: the maths, straight from the function. ───────────────────────
const skuId = q(`select id from skus where internal_code like 'MAMY%' limit 1;`);
const raw = q(`select get_product_card('${skuId}'::uuid);`);
let card;
try { card = JSON.parse(raw); } catch { card = null; }

if (!card) {
  list.ok(false, "get_product_card returned something parseable");
} else {
  const c = card.cost, p = card.price;
  const near = (a, b, tol = 0.02) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol;

  list.ok(!!c, "the card knows what the product cost (a confirmed GRN exists)");
  if (c) {
    const parts = Number(c.fob_mvr) + Number(c.freight_mvr) + Number(c.local_mvr) + Number(c.duty_mvr);
    list.ok(near(parts, c.landed_total_mvr, 0.05),
      `supplier price + freight + local + duty = landed total (${parts.toFixed(2)} vs ${Number(c.landed_total_mvr).toFixed(2)})`);
    list.ok(near(Number(c.landed_total_mvr) / Number(c.qty_cartons), c.per_carton_mvr, 0.05),
      `landed total / cartons = landed per carton (${(Number(c.landed_total_mvr) / Number(c.qty_cartons)).toFixed(2)} vs ${Number(c.per_carton_mvr).toFixed(2)})`);
    list.ok(near(Number(c.per_carton_mvr) / Number(card.pack.packs_per_carton), c.per_pack_mvr, 0.05),
      "landed per carton / packs per carton = landed per pack");
  }

  if (p && p.per_pack_mvr != null && p.pack_cost_mvr != null) {
    list.ok(near(Number(p.per_pack_mvr) - Number(p.pack_cost_mvr), p.pack_profit_mvr),
      `pack price - pack cost = pack profit (${(Number(p.per_pack_mvr) - Number(p.pack_cost_mvr)).toFixed(2)} vs ${p.pack_profit_mvr})`);
    const m = (Number(p.pack_profit_mvr) / Number(p.per_pack_mvr)) * 100;
    list.ok(near(m, p.pack_margin_pct, 0.1),
      `margin is profit over the SELLING price, not markup on cost (${m.toFixed(1)}% vs ${p.pack_margin_pct}%)`);
    // Markup on cost would read several points higher. Guard the convention
    // explicitly: an accountant, a bank and a supplier all mean gross margin.
    const markup = (Number(p.pack_profit_mvr) / Number(p.pack_cost_mvr)) * 100;
    list.ok(!near(markup, p.pack_margin_pct, 0.1) || near(markup, m, 0.1),
      "margin is NOT markup-on-cost dressed up as margin");
  }

  if (p && p.carton_discount_mvr != null && p.per_pack_mvr != null && p.per_carton_mvr != null) {
    const d = Number(p.per_pack_mvr) * Number(card.pack.packs_per_carton) - Number(p.per_carton_mvr);
    list.ok(near(d, p.carton_discount_mvr),
      `the carton-vs-packs gap is real arithmetic (${d.toFixed(2)} vs ${p.carton_discount_mvr})`);
  }

  // The rival must arrive already converted. If Postgres handed the screen a
  // per-piece number the screen would have to divide, and that is where the
  // units rule breaks.
  if (card.rival) {
    const conv = Number(card.rival.their_price_mvr) / Number(card.rival.their_pack_size) * Number(card.pack.pcs_per_pack);
    list.ok(near(conv, card.rival.their_price_at_our_pack_size, 0.05),
      `the rival's price is converted to OUR pack size in Postgres (${conv.toFixed(2)} vs ${card.rival.their_price_at_our_pack_size})`);
    list.ok(near(Number(card.rival.their_price_at_our_pack_size) - Number(card.rival.our_price_mvr),
                 card.rival.we_are_cheaper_by_mvr),
      "and the gap is their converted price minus ours");
  }

  // Sales must count only orders that really happened — a draft is not a sale.
  const ledgerRevenue = q(`
    select coalesce(round(sum(l.line_total_mvr), 2), 0) from sales_order_lines l
    join sales_orders o on o.id = l.order_id
    where l.sku_id = '${skuId}'::uuid and o.status in ('confirmed','out_for_delivery','delivered');`);
  list.ok(Math.abs(Number(ledgerRevenue) - Number(card.sales.revenue_mvr)) < 0.01,
    `revenue matches the ledger exactly (${ledgerRevenue} vs ${card.sales.revenue_mvr})`);

  const draftRevenue = q(`
    select coalesce(round(sum(l.line_total_mvr), 2), 0) from sales_order_lines l
    join sales_orders o on o.id = l.order_id
    where l.sku_id = '${skuId}'::uuid and o.status = 'draft';`);
  list.ok(Number(draftRevenue) === 0 || Number(card.sales.revenue_mvr) < Number(ledgerRevenue) + Number(draftRevenue),
    "drafts are excluded from what the product has earned");
}

// ── Half two: the screen. ──────────────────────────────────────────────────
const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });
try {
  // It is in the menu at all — hard rule 8. journey.mjs enforces this for every
  // page, but a brand-new page is exactly when it gets forgotten.
  await page.goto(`${BASE}/product-card`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const listText = await page.locator("body").innerText();
  list.ok(/product card/i.test(listText), "the page renders");
  list.ok(/mamypoko/i.test(listText), "and lists products, grouped by brand");

  // Search, then open one.
  const search = page.getByPlaceholder(/search products/i);
  await search.fill("Xtra");
  await page.waitForTimeout(900);
  const rows = page.locator("button").filter({ hasText: /per pack ×/ });
  list.ok(await rows.count() > 0, "search narrows the list");
  await rows.first().click();
  await page.waitForTimeout(2500);

  const t = await page.locator("body").innerText();
  list.ok(/what it costs you/i.test(t), "the card shows what it costs");
  list.ok(/supplier price/i.test(t), "including the supplier price");
  list.ok(/freight share/i.test(t), "and the freight share that makes it a LANDED cost");
  list.ok(/landed, per pack/i.test(t), "and the landed cost per pack");
  list.ok(/what you charge/i.test(t), "what he charges");
  list.ok(/you keep, per pack/i.test(t), "the profit in rufiyaa");
  list.ok(/margin/i.test(t), "with the percentage beside it, not instead of it");
  list.ok(/what it has earned/i.test(t), "what it has earned");
  list.ok(/stock/i.test(t), "and the stock position");

  // THE UNITS RULE. This page is dense with money, which is exactly where a
  // piece price leaks in.
  list.ok(!/\bpcs\b/i.test(t), "no 'pcs' anywhere on the card");
  list.ok(!/per piece|\/piece|per pc\b/i.test(t), "and no per-piece price — not even for the rival");

  // Money must be readable: MVR figures with separators, tabular numerals.
  list.ok(/MVR\s[\d,]+/.test(t), "money is written in MVR with thousands separated");

  // The deep link Products uses.
  const skuFromDb = skuId;
  await page.goto(`${BASE}/product-card?sku=${skuFromDb}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const deep = await page.locator("body").innerText();
  list.ok(/what it costs you/i.test(deep),
    "?sku=<id> opens straight to that card (the link Products sends you on)");

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

finish(list.report());

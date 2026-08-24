// A cost typed as the selling price does not slide past in green.
//
// ── THE INCIDENT, WHICH IS IN THE LEDGER ────────────────────────────────────
//
// On 2026-08-22 five Body Shop tubs were received in one sitting, as direct
// receipts. Two went in at MVR 123. Three went in at MVR 380 — which is exactly
// what a tub sells for.
//
//     BODY-DEWB-1x1   landed 123.00   price 380   margin 67.6%
//     BODY-STRA-1x1   landed 123.00   price 380   margin 67.6%
//     BODY-BODY-1x1   landed 380.00   price 380   margin  0.0%
//     BODY-MORI-1x1   landed 380.00   price 380   margin  0.0%
//     BODY-SATS-1x1   landed 380.00   price 380   margin  0.0%
//
// The loss guard is `price < cost`, strictly less-than, so equal passed. Worse,
// the sheet then said "You keep MVR 0.00 per tub · 0.0% margin" in
// --snm-success GREEN — the colour that means good money in this app. Three
// tubs were waved through by a reassurance.
//
// It is not a cosmetic error. The Promo Advisor must clear a 10% floor over
// cost, so those three are the only dead stock in the business it cannot offer
// a clearance price for, while their two identical siblings get one.
//
// ── WHY BOTH DOORS ──────────────────────────────────────────────────────────
//
// "One guard, every door" (skills.md, Seat 4). The Stock In sheet in the sales
// flow asks for a cost AND a price. Stock Ops → Receive asks for a cost only,
// so it never compared the figure to anything and the mistake was invisible
// there entirely. It does not need to ask: the product already has a selling
// price, in the unit the pill is set to.
//
// Usage:  node scripts/audit/cost-equals-price.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates a product and types costs into a receipt form.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const cleanup = `
  delete from stock_movements where sku_id in (select id from skus where internal_code like 'AUDCEP-%');
  delete from inventory_batches where sku_id in (select id from skus where internal_code like 'AUDCEP-%');
  delete from skus where internal_code like 'AUDCEP-%';
  delete from variants where model_id in (select id from product_models where name like 'AudCep %');
  delete from product_models where name like 'AudCep %';
  delete from product_categories where name = 'AudCep Category';
  delete from brands where name = 'AudCep Brand';
`;
q(cleanup);

// A TUB, deliberately: pcs_per_pack = 1, so one piece is one whole item and the
// unit word is the product's own noun. It is also the exact shape of the five
// real tubs in the incident, and the shape where cost and price are quoted in
// the same unit with no pack arithmetic in between to hide a mismatch.
q(`
do $$
declare v_cat uuid; v_brand uuid; v_model uuid; v_variant uuid; v_sku uuid;
begin
  insert into product_categories (name, unit_uom, cost_basis)
    values ('AudCep Category', 'tub', 'piece') returning id into v_cat;
  insert into brands (name) values ('AudCep Brand') returning id into v_brand;
  insert into product_models (brand_id, category_id, name)
    values (v_brand, v_cat, 'AudCep Butter') returning id into v_model;
  insert into variants (model_id, display_name)
    values (v_model, '200ml') returning id into v_variant;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm,
                    fixed_price_per_pack_mvr, sellable_units)
    values (v_variant, 'AUDCEP-TUB-1x1', 1, 1, 20, 20, 20, 380, array['pack'])
    returning id into v_sku;
end $$;
`);

const price = q1(`select selling_price_per_pack_mvr from v_skus where internal_code = 'AUDCEP-TUB-1x1';`);

const list = checklist("A cost typed as the selling price never slides past in green");
list.is(price, "380", `the tub sells for MVR 380 (${price})`);

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });

try {
  // ── DOOR TWO: Stock Ops → Receive, which had no margin check at all ──────
  await page.goto(`${BASE}/stock-ops`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const receive = page.getByRole("button", { name: /^receive$/i }).first();
  if (await receive.count() > 0) { await receive.click(); await page.waitForTimeout(1200); }

  await page.locator('input[placeholder="Search"]:visible').first().fill("AudCep");
  await page.waitForTimeout(1200);
  await page.locator("button", { hasText: "AudCep Butter" }).first().click();
  await page.waitForTimeout(1000);

  await page.locator('input[placeholder="24"]:visible').first().fill("3");
  const costBox = page.locator('input[placeholder="175"]:visible').first();

  // A REAL cost first. The warning must be ABSENT here, or it is not a warning,
  // it is wallpaper — and a form that always complains gets ignored on the day
  // it is right.
  await costBox.fill("123");
  await page.waitForTimeout(900);
  const honest = await page.locator("body").innerText();
  list.ok(!/earn nothing|earns you nothing|exactly what this sells for/i.test(honest),
    "a real cost of MVR 123 against a MVR 380 price says nothing — the form is quiet when it should be");

  // Now the mistake.
  await costBox.fill("380");
  await page.waitForTimeout(900);
  const wrong = await page.locator("body").innerText();
  list.ok(/exactly what this sells for/i.test(wrong),
    "typing the SELLING price into the cost box is caught — the door that had no check at all");
  list.ok(/earn nothing/i.test(wrong),
    "and it says what that means in money: it would earn nothing");
  list.ok(/selling price has been typed into the cost box/i.test(wrong),
    "naming the likely cause, which is the part he can actually check");
  list.ok(/\btub\b/i.test(wrong) && !/\bpiece\b|\bpcs\b/i.test(wrong),
    "in the product's own word — a tub, never a piece");

  // NOT BLOCKED. Buying at cost can be a real decision; the rule is that it
  // must be a decision, not an accident.
  const addBtn = page.getByRole("button", { name: /add to stock/i }).first();
  list.ok(await addBtn.isEnabled(),
    "and it is still allowed — this is a caution, not a block, because buying at cost can be deliberate");

  // The confirm sheet is the last chance to catch a wrong price, so the warning
  // has to survive to it.
  await addBtn.click();
  await page.waitForTimeout(1200);
  const sheet = await page.locator("body").innerText();
  list.ok(/exactly what it sells for/i.test(sheet),
    "the confirm sheet repeats it — the last tap sees the caution, not just the form behind it");

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

// NOTHING WAS RECEIVED. The audit stops at the confirmation on purpose: it is
// testing the warning, not the receipt, and a batch left behind would change
// what every audit after it sees.
const batches = q1(`select count(*) from inventory_batches b join skus s on s.id = b.sku_id
                     where s.internal_code = 'AUDCEP-TUB-1x1';`);
list.is(batches, "0", `and nothing was actually received — the audit stopped at the confirmation (${batches})`);

try {
  q(cleanup);
} catch (e) {
  list.ok(false, `cleanup left rows behind: ${String(e).split("\n")[0].slice(0, 150)}`);
}

finish(list.report());

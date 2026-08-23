// Direct receipt — stock that never travelled in a container.
//
// Ali, 2026-08-11: "Recently I brought with my baggage a few dozen Body Shop
// body butter with me. It's not a shipment I create with logistics etc. I do
// not have to enter the cbm or freight costs since it was carried by myself. I
// just want to sell them as individual tubs of body butter. Not cartons."
//
// There was one door into stock: a shipment, a GRN, freight split by CBM.
// shipment_lines requires CBM > 0 — rightly, because that check is what makes
// freight land correctly on real imports — so a hand-carried tub could not be
// entered at all. This audit guards the second door.
//
// WHAT IT ACTUALLY WATCHES, beyond "the form works":
//
//   * the screen asks in the PRODUCT'S OWN UNIT ("How many tubs"), not a
//     hardcoded pack or carton;
//   * the total is echoed back BEFORE committing, because a mistyped unit cost
//     silently becomes the cost basis of every future sale from that batch;
//   * the confirm says what it will NOT do (no freight, no duty);
//   * and Inventory afterwards reads "24 tubs" and never "24 packs" or a piece
//     count. That last one was a REAL bug found by writing this: three
//     different places knew what a unit is called — Postgres unit_noun,
//     lib/trade-units containerLabel, and a private copy inside
//     inventory-view — so the same 24 tubs read "24 ctn" on the brand rollup
//     while the database called them tubs.
//
// Usage:  node scripts/audit/direct-receipt.mjs

import { execFileSync } from "node:child_process";

// Self-contained fixture, like grn.mjs. Local databases only: this inserts
// catalogue rows and deletes batches.
const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates catalogue rows and deletes stock batches.");
  process.exit(2);
}
const q = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });

// A product sold ONE AT A TIME — 1 per pack, 1 per carton, sells by the piece,
// in a category whose unit is a tub. This is the shape the whole feature
// exists for, and nothing else in the fixture has it.
q(`
do $$
declare v_cat uuid; v_b uuid; v_m uuid; v_v uuid;
begin
  if exists (select 1 from skus where internal_code = 'BODYSHOP-BUTTER-200-1x1') then return; end if;

  -- 'pack', not 'piece' — see 0200/0201. A piece-only tub is a product the
  -- ledger refuses to sell, so this fixture was reproducing the defect rather
  -- than testing around it.
  select id into v_cat from product_categories where name = 'Bodybutter';
  if v_cat is null then
    insert into product_categories (name, unit_uom, cost_basis, default_sellable_units)
    values ('Bodybutter', 'tub', 'piece', array['pack']) returning id into v_cat;
  else
    update product_categories set unit_uom = 'tub', default_sellable_units = array['pack'] where id = v_cat;
  end if;

  insert into brands (name) values ('Body Shop') returning id into v_b;
  insert into product_models (brand_id, category_id, name) values (v_b, v_cat, 'Body Butter') returning id into v_m;
  insert into variants (model_id, display_name, attributes) values (v_m, '200ml Shea', '{}'::jsonb) returning id into v_v;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm, sellable_units)
  values (v_v, 'BODYSHOP-BUTTER-200-1x1', 1, 1, 10, 10, 10, array['pack']);
end $$;`);

// Start from "nothing received yet" whatever the last run did.
q(`delete from stock_movements where batch_id in (select id from inventory_batches where source = 'direct');
   delete from inventory_batches where source = 'direct';`);

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";
const b = await launch();
const list = checklist("Direct receipt — stock that never travelled in a container");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });
try {
  await page.goto(`${BASE}/stock-ops`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const txt = await page.locator("body").innerText();
  list.ok(/receive/i.test(txt), "Stock Ops offers a Receive tab");

  await page.getByRole("button", { name: /^receive$/i }).first().click();
  await page.waitForTimeout(1200);
  const t2 = await page.locator("body").innerText();
  list.ok(/stock you bought or carried in/i.test(t2), "it explains what it is for");
  list.ok(/no shipment, no freight, no cbm/i.test(t2), "and says no freight or CBM is needed");

  await page.getByPlaceholder("Search").first().fill("Body Butter");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /Body Shop.*Body Butter/i }).first().click();
  await page.waitForTimeout(700);

  const t3 = await page.locator("body").innerText();
  list.ok(/how many tubs/i.test(t3), "it asks in the product's OWN unit — tubs, not packs");
  list.ok(/cost of one, mvr/i.test(t3), "and for the cost of one, in MVR");

  await page.getByPlaceholder("24").first().fill("24");
  await page.getByPlaceholder("175").first().fill("175");
  await page.waitForTimeout(600);
  const t4 = await page.locator("body").innerText();
  list.ok(/= MVR 4,200\.00 for 24 tubs/i.test(t4), "it echoes the total back before you commit");

  await page.getByRole("button", { name: /add to stock/i }).first().click();
  await page.waitForTimeout(1200);
  const sheet = await page.locator("body").innerText();
  list.ok(/add this to stock\?/i.test(sheet), "it confirms before writing");
  list.ok(/not a shipment, so no freight or duty is added/i.test(sheet), "and says what it will NOT do");

  await page.getByRole("button", { name: /^add to stock$/i }).last().click();
  await page.waitForTimeout(4000);

  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const inv = await page.locator("body").innerText();
  list.ok(/24 tubs/i.test(inv), "Inventory shows 24 tubs");
  list.ok(!/24 packs/i.test(inv), "and never calls them packs");
  list.ok(!/\bpcs\b|pieces/i.test(inv), "no piece counts anywhere");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0,2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0,190)}`);
}
await ctx.close(); await b.close();

// Leave nothing behind: the next run must start from "no stock received".
q(`delete from stock_movements where batch_id in (select id from inventory_batches where source = 'direct');
   delete from inventory_batches where source = 'direct';`);

finish(list.report());

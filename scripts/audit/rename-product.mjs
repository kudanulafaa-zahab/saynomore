// Correcting a name typed wrong, on a product that already has stock.
//
// Ali, 2026-08-24, with a screenshot of the Products screen: *"I entered a
// product name by mistake. Example Bodyshop bodymilk. I don't have a bodymilk
// it's a mistake. How can I correct this and any other future mistakes? Like
// spelling mistakes or a different name by mistake?"* — and, asked whether the
// product itself was real or invented: *"Wrong name."*
//
// ── WHY HE WAS STUCK ────────────────────────────────────────────────────────
//
// `BODY-BODY-1x1` has 4 tubs in stock and has never been sold, which blocked
// both exits:
//
//   DELETE   correctly refused. admin_delete_sku will not touch anything with a
//            batch or a movement, and it should not — deleting it would destroy
//            the landed cost those 4 tubs depend on.
//   RENAME   did not exist. updateBrand/updateModel/updateVariant have been in
//            lib/queries/products.ts the whole time and were called from
//            NOWHERE; the dialogs that used them were deleted as dead code.
//
// ── WHY THIS IS A BROWSER AUDIT AND NOT ONLY pgTAP ──────────────────────────
//
// rename_catalogue.test.sql proves the ENGINE — history stays attached, the SKU
// code does not move, a viewer is refused. It cannot prove the thing Ali
// actually asked for: that he can FIND the fix and use it on a phone. This
// drives the real sheet, types a new name, saves, and reads the database back.
//
// Usage:  node scripts/audit/rename-product.mjs

import { execFileSync } from "node:child_process";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates catalogue rows and renames them.");
  process.exit(2);
}
const q      = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const scalar = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const BRAND = "RenameAudit";
const WRONG = "Bodymilk";
const RIGHT = "Body Butter";

function wipe() {
  q(`delete from stock_movements where sku_id in (
       select s.id from skus s join variants v on v.id=s.variant_id
       join product_models pm on pm.id=v.model_id join brands b on b.id=pm.brand_id
       where b.name in ('${BRAND}', '${BRAND} Fixed'));`);
  q(`delete from inventory_batches where sku_id in (
       select s.id from skus s join variants v on v.id=s.variant_id
       join product_models pm on pm.id=v.model_id join brands b on b.id=pm.brand_id
       where b.name in ('${BRAND}', '${BRAND} Fixed'));`);
  q(`delete from shipment_lines where sku_id in (
       select s.id from skus s join variants v on v.id=s.variant_id
       join product_models pm on pm.id=v.model_id join brands b on b.id=pm.brand_id
       where b.name in ('${BRAND}', '${BRAND} Fixed'));`);
  q(`delete from shipments where reference = 'SH-RENAME-AUDIT';`);
  q(`delete from skus where variant_id in (
       select v.id from variants v join product_models pm on pm.id=v.model_id
       join brands b on b.id=pm.brand_id where b.name in ('${BRAND}', '${BRAND} Fixed'));`);
  q(`delete from variants where model_id in (
       select pm.id from product_models pm join brands b on b.id=pm.brand_id
       where b.name in ('${BRAND}', '${BRAND} Fixed'));`);
  q(`delete from product_models where brand_id in (
       select id from brands where name in ('${BRAND}', '${BRAND} Fixed'));`);
  q(`delete from brands where name in ('${BRAND}', '${BRAND} Fixed');`);
  q(`delete from product_categories where name = 'Rename Audit Tubs';`);
  // AUDIT ROWS TOO. Without this the "it is in the audit log" check counts
  // every previous run as well and reads 2, 3, 4 — a test that passes on the
  // first run and fails on the second is worse than one that never worked,
  // because the failure looks like a regression in the code under test. Caught
  // by mutation-testing this file, not by reasoning about it.
  q(`delete from audit_log where table_name = 'product_models'
       and old_value = '${WRONG}' and new_value = '${RIGHT}';`);
}
wipe();

// EXACTLY ALI'S SITUATION: real stock, never sold, wrong name. A product with
// no history would be the easy case and would prove nothing.
q(`
do $$
declare v_cat uuid; v_b uuid; v_m uuid; v_v uuid; v_s uuid; v_sh uuid; v_sl uuid; v_ba uuid; v_g uuid;
begin
  insert into product_categories (name, unit_uom, cost_basis, default_sellable_units)
  values ('Rename Audit Tubs', 'tub', 'piece', array['pack']) returning id into v_cat;
  insert into brands (name) values ('${BRAND}') returning id into v_b;
  insert into product_models (brand_id, category_id, name) values (v_b, v_cat, '${WRONG}')
    returning id into v_m;
  insert into variants (model_id, display_name, attributes)
  values (v_m, '200ml', '{"size":"200ml"}'::jsonb) returning id into v_v;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm,
                    fixed_price_per_pack_mvr, sellable_units)
  values (v_v, 'RENA-BODY-200ML-1x1', 1, 1, 20, 20, 20, 380, array['pack'])
    returning id into v_s;

  select id into v_g from godowns order by created_at limit 1;
  select id into v_sh from shipments where reference = 'SH-RENAME-AUDIT';
  if v_sh is null then
    insert into shipments (reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
    values ('SH-RENAME-AUDIT', (select id from suppliers order by created_at limit 1), 15.4, 15400)
      returning id into v_sh;
  end if;
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (v_sh, v_s, 4, 0.008, 10, 'USD', v_g) returning id into v_sl;
  insert into inventory_batches (shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
  values (v_sl, v_s, v_g, now() - interval '3 days', 4, 4, 123, 123, 123) returning id into v_ba;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (v_ba, v_s, v_g, 'in', 4, 'shipment');
end $$;`);

const codeBefore = scalar(`select internal_code from skus where internal_code = 'RENA-BODY-200ML-1x1';`);
const stockBefore = scalar(`select coalesce(sum(qty_pieces),0) from stock_movements sm
  join skus s on s.id = sm.sku_id where s.internal_code = 'RENA-BODY-200ML-1x1';`);

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";
const b = await launch();
const list = checklist("A name typed wrong can be typed right, without losing the stock");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });

list.is(stockBefore, "4", `the product really does carry stock (${stockBefore}) -- which is why deleting it was never the answer`);

try {
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  // Find it the way he would: search, then tap the product.
  // SCROLLED INTO VIEW FIRST, and that is not defensive padding — it is a
  // finding. The "not ready to trade" panel sits above the tabs, and on a phone
  // with five rows in it the search box is pushed off the first screen
  // entirely. Ali's own screenshot shows "Search SKUs" clipped at the bottom
  // edge. The panel was redesigned to a single collapsed line because of this;
  // the scroll stays so the audit keeps working whatever is above it.
  // `:visible`, not `.first()`. The Products screen has THREE tab panels and
  // Base UI renders all of them, so a plain placeholder match resolves to a
  // search box inside a hidden panel — it exists in the DOM, is never visible,
  // and every fill and scroll against it times out looking like a broken page.
  // Same trap the IKEA audit hit with `role=tab`.
  const search = page.locator('input[placeholder*="Search" i]:visible').first();
  await search.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await search.fill(WRONG);
  await page.waitForTimeout(1500);

  const found = await page.locator("body").innerText();
  list.ok(new RegExp(WRONG, "i").test(found), "the mistyped product is findable by its wrong name");

  // The row reads "Bodymilk · 200ml" — model then size — so an exact-match on
  // the model name alone never matches it. Target the CARD by the text it
  // contains, the same way the IKEA and sell-new audits do.
  // `button:visible`, not `button`. The Products screen has three tab panels
  // and Base UI renders all of them, so an unscoped match resolves to a card
  // inside a hidden panel — present in the DOM, never clickable, and the
  // failure reads like a broken page rather than a bad selector. Every locator
  // in this file is scoped the same way for the same reason.
  await page.locator("button:visible").filter({ hasText: new RegExp(WRONG, "i") }).first().click();
  await page.waitForTimeout(1500);

  // The sheet opens with an Edit action — the primary button in the nav bar.
  await page.locator("button:visible").filter({ hasText: /^Edit/i }).first().click();
  await page.waitForTimeout(1500);

  const sheet = await page.locator("body").innerText();
  // THE POINT OF THE WHOLE CHANGE: the name is editable, and he is told what
  // happens to his history before he commits to it.
  list.ok(/\bname\b/i.test(sheet), "the edit sheet has a Name section -- it had none at all before");
  list.ok(/\bBrand\b/i.test(sheet) && /\bProduct\b/i.test(sheet),
    "with the brand and the product name as separate fields");
  list.ok(/stays attached|starts reading the corrected name/i.test(sheet),
    "and it says what happens to past orders and stock, before he saves");
  list.ok(/does not change|printed on labels/i.test(sheet),
    "and that the code on his labels will NOT change");

  // Type the correct name over the wrong one.
  const productField = page.locator('input[placeholder="Body Butter"]:visible').first();
  await productField.scrollIntoViewIfNeeded();
  await productField.fill(RIGHT);
  await page.waitForTimeout(400);

  const save = page.locator("button:visible").filter({ hasText: /^Save/i }).first();
  await save.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await save.click({ timeout: 15000 });
  await page.waitForTimeout(4000);

  const after = await page.locator("body").innerText();
  list.ok(!/duplicate key|violates|constraint/i.test(after),
    "no raw database error reached the screen");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

// ── WHAT LANDED, AND WHAT MUST NOT HAVE MOVED ──────────────────────────────
const nameNow  = scalar(`select pm.name from product_models pm join brands b on b.id=pm.brand_id
                          where b.name = '${BRAND}';`);
const codeNow  = scalar(`select internal_code from skus s join variants v on v.id=s.variant_id
                          join product_models pm on pm.id=v.model_id join brands b on b.id=pm.brand_id
                          where b.name = '${BRAND}';`);
const stockNow = scalar(`select coalesce(sum(sm.qty_pieces),0) from stock_movements sm
                          join skus s on s.id=sm.sku_id join variants v on v.id=s.variant_id
                          join product_models pm on pm.id=v.model_id join brands b on b.id=pm.brand_id
                          where b.name = '${BRAND}';`);
const costNow  = scalar(`select round(ib.landed_per_piece_mvr, 2) from inventory_batches ib
                          join skus s on s.id=ib.sku_id join variants v on v.id=s.variant_id
                          join product_models pm on pm.id=v.model_id join brands b on b.id=pm.brand_id
                          where b.name = '${BRAND}' limit 1;`);
const audited  = scalar(`select count(*) from audit_log
                          where table_name = 'product_models' and old_value = '${WRONG}' and new_value = '${RIGHT}';`);
const viewName = scalar(`select model_name from v_skus where internal_code = '${codeBefore}';`);

list.is(nameNow, RIGHT, `the product is now called what he meant (${nameNow})`);
// THIS CHECK IS WEAKER THAN IT LOOKS, and saying so is the point. The Edit
// sheet writes its code field back on every save, so a database-side
// regeneration would be overwritten here and this would pass anyway — proven by
// mutation, not assumed. What it DOES prove is the user-facing guarantee: after
// correcting a name, the code Ali reads on the product is the one on his
// labels. The real guard on the engine is rename_catalogue.test.sql test 6,
// which calls the function directly and fails on exactly that mutation.
list.is(codeNow, codeBefore, `the code he reads is unchanged (${codeNow}) -- it is what is printed on labels`);
list.is(stockNow, stockBefore, `all ${stockBefore} tubs are still attached (${stockNow}) -- a rename moves no stock`);
list.is(costNow, "123.00", `and the batch still carries the cost they landed at (MVR ${costNow})`);
list.is(audited, "1", `the change is in the audit log, old and new (${audited} row)`);
list.is(viewName, RIGHT, `and every screen reads the corrected name at once (${viewName})`);

wipe();
finish(list.report());

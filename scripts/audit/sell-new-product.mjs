// Selling a product you own but have never received — without leaving the sale.
//
// Ali, 2026-08-12: "In sales/new sale/add products I cannot see bodybutter
// maybe because it asks me to choose a godown first. In this case it's not in a
// godown. So fix it so I can see it in sales and add my landed cost manually and
// set selling price."
//
// HIS DIAGNOSIS WAS HALF RIGHT AND THAT MATTERS. New Sale does gate everything
// on picking a warehouse — but the reason the product was missing is that a SKU
// with zero stock in EVERY godown is hidden from browsing, and when found by
// search it rendered as a `disabled` card reading "Out of stock". A dead end at
// the exact moment he needed it.
//
// WHAT WAS NOT CHANGED, DELIBERATELY. He asked to sell it anyway. That is the
// one thing this must never do: stock is SUM(stock_movements) (hard rule 2), and
// a sale with no stock behind it has no batch, therefore no cost, and would
// quietly poison the P&L, Margin Watch and the Product Card at once. There is a
// comment in new-sale-sheet.tsx naming SO-2026-076, an order that once reached
// "delivered" with no stock movement. So the RULE stayed and the FRICTION moved:
// an out-of-stock card is now a route in, receiving happens in place, and the
// sale continues.
//
// This audit therefore checks BOTH halves — that the door opens, and that the
// wall behind it is still standing.
//
// Usage:  node scripts/audit/sell-new-product.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates a product and receives stock against it.");
  process.exit(2);
}
const q = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

// A product that exists, is priced, and has NEVER been received — the exact
// state BODY-DEWB-1x1 was in on production when he could not find it.
q(`
do $$
declare v_cat uuid; v_b uuid; v_m uuid; v_v uuid;
begin
  delete from stock_movements where sku_id in (select id from skus where internal_code = 'AUDIT-NEVER-1x1');
  delete from inventory_batches where sku_id in (select id from skus where internal_code = 'AUDIT-NEVER-1x1');
  delete from skus where internal_code = 'AUDIT-NEVER-1x1';

  select id into v_cat from product_categories where name = 'Bodybutter';
  if v_cat is null then
    insert into product_categories (name, unit_uom, cost_basis, default_sellable_units)
    values ('Bodybutter', 'tub', 'piece', array['pack']) returning id into v_cat;
  end if;

  select id into v_b from brands where lower(name) = 'auditbrand';
  if v_b is null then insert into brands (name) values ('AuditBrand') returning id into v_b; end if;
  select id into v_m from product_models where brand_id = v_b and lower(name) = 'nevershipped';
  if v_m is null then
    insert into product_models (brand_id, category_id, name) values (v_b, v_cat, 'NeverShipped') returning id into v_m;
  end if;
  select id into v_v from variants where model_id = v_m limit 1;
  if v_v is null then
    insert into variants (model_id, display_name, attributes) values (v_m, 'NeverShipped', '{}'::jsonb) returning id into v_v;
  end if;

  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, sellable_units)
  values (v_v, 'AUDIT-NEVER-1x1', 1, 1, array['pack']);
end $$;`);

const skuId = q(`select id from skus where internal_code = 'AUDIT-NEVER-1x1';`);

const list = checklist("Selling a product you own but never received");
const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });
try {
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /new sale/i }).first().click();
  await page.waitForTimeout(2000);

  // SCOPED TO THE SHEET. Unscoped, this matches the ORDER ROW behind it and
  // silently closes the sheet — the same trap journey.mjs documents, which made
  // an audit pass on an empty database and fail on a used one.
  const newSale = page.getByRole("dialog", { name: /new sale/i });
  await newSale.getByText("Ahmed Ziyad").first().click();
  await page.getByRole("button", { name: /add products/i }).first().click();
  await page.waitForTimeout(1500);

  const gate = await newSale.innerText();
  list.ok(/warehouse/i.test(gate), "the sale still asks which warehouse it ships from");

  // The warehouse is a <select>, not a button row.
  await newSale.locator("select").first().selectOption({ label: "Veesange" });
  await page.waitForTimeout(1800);

  // EVERY locator below is scoped to the sheet. Reading `body.innerText()`
  // matched text that was in the DOM but BEHIND the sheet, so the first version
  // of this audit "found" the product on a screen where the sheet had already
  // closed — green for a flow it never drove. Same class of mistake as the
  // "See all" check that tested the link instead of the destination.
  const search = newSale.getByPlaceholder(/search/i).first();
  await search.fill("NeverShipped");
  await page.waitForTimeout(1800);

  const found = await newSale.innerText();
  list.ok(/nevershipped/i.test(found), "searching finds a product with no stock anywhere");
  list.ok(/no stock — tap to add/i.test(found),
    "and it invites the fix rather than reading 'Out of stock' as a dead end");

  // It must be TAPPABLE. It used to be a disabled button — the whole defect.
  // Target the CARD, not the brand group header. Products stay grouped by brand
  // (Ali's standing rule), so "NeverShipped" alone matches the collapsible
  // header first — a button that does nothing. The availability line is unique
  // to the card.
  const card = newSale.locator("button").filter({ hasText: /No stock — tap to add/ }).first();
  list.ok(!(await card.isDisabled()), "the card is tappable, not a disabled dead end");
  await card.click();
  await page.waitForTimeout(1800);

  const sheet = await page.locator("body").innerText();
  list.ok(/add stock/i.test(sheet), "tapping it opens Add stock, without leaving the sale");
  list.ok(/how many tubs/i.test(sheet), "asking in the product's own unit — tubs, never packs");
  list.ok(/what one tub cost you/i.test(sheet), "for the cost he actually paid, entered by hand");
  list.ok(/sell one tub for/i.test(sheet), "and for the selling price, in the same place");
  list.ok(!/which (godown|warehouse)/i.test(sheet),
    "and it does NOT ask for the warehouse again — the order already chose one");

  // Fill it in. A cost of 175 and a price of 380: healthy.
  const nums = page.locator('input[type="number"]');
  await nums.nth(0).fill("24");
  await nums.nth(1).fill("175");
  await nums.nth(2).fill("380");
  await page.waitForTimeout(900);

  const filled = await page.locator("body").innerText();
  list.ok(/= MVR 4,200\.00 for all 24/i.test(filled),
    "the total is echoed back before committing (a mistyped cost becomes the cost basis for ever)");
  list.ok(/you keep MVR 205\.00 per tub/i.test(filled), "and the profit per tub is shown before saving");

  // LOSING MONEY IS A DECISION (hard rule 7). A price under cost must stop him.
  await nums.nth(2).fill("100");
  await page.waitForTimeout(800);
  const loss = await page.locator("body").innerText();
  list.ok(/loses MVR 75\.00 on every tub/i.test(loss), "a price below cost is named in rufiyaa, not hinted at");
  list.ok(/add at a loss/i.test(loss), "and the button says exactly what it is about to do");

  // Back to a sane price and commit.
  await nums.nth(2).fill("380");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /^add stock$/i }).first().click();
  await page.waitForTimeout(5000);

  // ── The ledger did the real thing ────────────────────────────────────────
  const pcs = q(`select coalesce(sum(qty_pieces),0) from stock_movements where sku_id = '${skuId}'::uuid;`);
  list.is(Number(pcs), 24, `stock really moved — the ledger says ${pcs}`);

  const batches = q(`select count(*) from inventory_batches where sku_id = '${skuId}'::uuid and source = 'direct';`);
  list.is(Number(batches), 1, "a real batch was created, carrying its own cost");

  const cost = q(`select round(landed_per_piece_mvr, 2) from inventory_batches where sku_id = '${skuId}'::uuid limit 1;`);
  list.is(Number(cost), 175, `the batch carries the cost he typed (MVR ${cost})`);

  // THE PRICE LANDS ON THE COLUMN THAT MATCHES THE UNIT SOLD. This used to read
  // fixed_selling_price_mvr — the PER-PIECE column — and passed only because a
  // tub was piece-only, which migration 0201 established is a product the ledger
  // refuses to sell. A tub now sells by the pack (one pack IS one tub), so the
  // price belongs on the pack column, and that is not a detail: migration 0139
  // was written because margin measured against a per-piece price nobody is
  // charged was wrong on 21 of 29 SKUs.
  const price = q(`select round(fixed_price_per_pack_mvr, 2) from skus where id = '${skuId}'::uuid;`);
  list.is(Number(price), 380, `and the selling price was saved against the unit sold (MVR ${price})`);

  // And NOT also onto the per-piece column, which would give Margin Watch and
  // the Product Card two prices for one tub and let them disagree.
  const piecePrice = q(`select coalesce(fixed_selling_price_mvr::text, 'none') from skus where id = '${skuId}'::uuid;`);
  list.is(piecePrice, "none",
    `and no per-piece price was written beside it (${piecePrice})`);

  // ── And the product is now sellable, in the same sale ─────────────────────
  const after = await page.locator("body").innerText();
  list.ok(!/no stock — tap to add/i.test(after), "the card is no longer out of stock");
  list.ok(!/\bpcs\b/i.test(after), "no piece count reached the screen at any point");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

// ── THE WALL IS STILL STANDING ─────────────────────────────────────────────
// The rule he asked to remove. Checked in the database rather than the UI,
// because this is the invariant, not a screen behaviour: a confirmed sale can
// never leave stock negative.
const negative = q(`
  select count(*) from (
    select sku_id, godown_id, sum(qty_pieces) as bal
    from stock_movements group by sku_id, godown_id
  ) t where bal < 0;`);
list.is(Number(negative), 0, "no product anywhere sits at negative stock");

q(`delete from stock_movements where sku_id in (select id from skus where internal_code = 'AUDIT-NEVER-1x1');
   delete from inventory_batches where sku_id in (select id from skus where internal_code = 'AUDIT-NEVER-1x1');
   delete from skus where internal_code = 'AUDIT-NEVER-1x1';`);

finish(list.report());

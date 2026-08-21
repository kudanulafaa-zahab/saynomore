// One trip through New SKU makes a whole size range.
//
// THE BUSINESS FACT. Ali is adding IKEA bedding: a pattern is a model, and
// Single / Queen / King are sizes under it. He also asked how professional
// systems do this — Shopify options, Odoo attributes, NetSuite matrix items are
// all the same idea: define the product once, name its options, let the system
// make the combinations.
//
// This app was already built that way — `product_categories.variant_attributes`
// IS the per-category attribute set, and the wizard renders a field per
// attribute. ONE link was broken: create_sku_full stored '{}' for every variant
// it made, and `variants` is unique on (model_id, attributes). So a model could
// hold exactly one wizard-made variant, and the SECOND size of anything failed:
//
//     duplicate key value violates unique constraint
//     "variants_model_id_attributes_key"
//
// That is why Ali's two Body Shop scents are two separate MODELS rather than
// two variants of one body butter — through the app, there was no other way.
//
// What this checks is the whole path, in a browser, on a phone: type three
// sizes, tap once, and get three products under ONE model, each with its own
// code, each visible. Migration 0193.
//
// Usage:  node scripts/audit/size-range.mjs

import { execFileSync } from "node:child_process";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  process.exit(2);
}
const q = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const scalar = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const BRAND = "RangeCo";
const MODEL = "Blavinda";
const CAT   = "Range Bedding";

// Its own brand and category so nothing else in the fixture can affect it, and
// so it cleans up completely. (Audits must depend only on what they create.)
function wipe() {
  q(`delete from skus where variant_id in (
       select v.id from variants v join product_models pm on pm.id=v.model_id
       join brands b on b.id=pm.brand_id where b.name='${BRAND}');`);
  q(`delete from variants where model_id in (
       select pm.id from product_models pm join brands b on b.id=pm.brand_id where b.name='${BRAND}');`);
  q(`delete from product_models where brand_id in (select id from brands where name='${BRAND}');`);
  q(`delete from brands where name='${BRAND}';`);
  q(`delete from product_categories where name='${CAT}';`);
}
wipe();

// A bedding category: sized variants, sold one set at a time, unit word "set".
q(`insert into product_categories (name, unit_uom, cost_basis, variant_attributes, default_sellable_units)
   values ('${CAT}', 'set', 'piece', '["size"]'::jsonb, array['piece']::text[]);`);

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";
const b = await launch();
const list = checklist("One trip through New SKU makes a whole size range");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });
try {
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "New SKU" }).first().click();
  await page.waitForTimeout(1500);

  await page.getByPlaceholder(/or type new brand name/i).first().fill(BRAND);
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: new RegExp(`^${CAT}$`) }).first().click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder(/e\.g\. Mamypoko Diaper Pants/i).first().fill(MODEL);
  await page.waitForTimeout(800);

  // THE RANGE. Three sizes, entered as chips, in one form.
  const sizeBox = page.getByPlaceholder(/NB \/ S \/ M \/ L/i).first();
  list.ok(await sizeBox.count() > 0, "the size field is there for a category whose variants have sizes");
  for (const s of ["Single", "Queen", "King"]) {
    await sizeBox.fill(s);
    await sizeBox.press("Enter");
    await page.waitForTimeout(350);
  }

  const withChips = await page.locator("body").innerText();
  list.ok(/Single/.test(withChips) && /Queen/.test(withChips) && /King/.test(withChips),
    "all three sizes are on screen as chips before anything is created");
  // He must be able to SEE the count before committing — several products from
  // one tap is exactly the case where a surprise is expensive.
  list.ok(/creates\s*3\s*skus/i.test(withChips.replace(/\s+/g, " ")),
    "and it says how many products the tap will create");

  const nums = page.locator('input[type="number"]');
  await nums.nth(0).fill("1");
  await nums.nth(1).fill("6");
  await page.waitForTimeout(800);

  const create = page.getByRole("button", { name: /create sku/i }).first();
  await create.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await create.click({ timeout: 15000 });
  await page.waitForTimeout(7000);

  const after = await page.locator("body").innerText();
  list.ok(!/duplicate key value/i.test(after), "NO duplicate-key error — the bug this fixes");
  list.ok(!/violates unique constraint/i.test(after), "no unique-constraint error of any kind");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0,2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0,190)}`);
}
await ctx.close(); await b.close();

// ── What actually landed in the database ───────────────────────────────────
// The screen can look right and the data be wrong; these read the rows.
const models   = scalar(`select count(*) from product_models pm join brands b on b.id=pm.brand_id where b.name='${BRAND}';`);
const variants = scalar(`select count(*) from variants v join product_models pm on pm.id=v.model_id
                          join brands b on b.id=pm.brand_id where b.name='${BRAND}';`);
const skus     = scalar(`select count(*) from skus s join variants v on v.id=s.variant_id
                          join product_models pm on pm.id=v.model_id
                          join brands b on b.id=pm.brand_id where b.name='${BRAND}';`);
const sizes    = scalar(`select string_agg(v.attributes->>'size', ',' order by v.attributes->>'size')
                          from variants v join product_models pm on pm.id=v.model_id
                          join brands b on b.id=pm.brand_id where b.name='${BRAND}';`);
const codes    = scalar(`select count(distinct s.internal_code) from skus s join variants v on v.id=s.variant_id
                          join product_models pm on pm.id=v.model_id
                          join brands b on b.id=pm.brand_id where b.name='${BRAND}';`);
const noun     = scalar(`select unit_noun('set');`);

list.is(models,   "1", "ONE model holds the whole range, not three models");
list.is(variants, "3", "three variants under it");
list.is(skus,     "3", "and three SKUs");
list.is(sizes, "King,Queen,Single", `each variant carries its size as an attribute (${sizes})`);
list.is(codes,    "3", "with three DIFFERENT codes — internal_code is unique, so a shared one would fail");
list.is(noun,   "set", "and a bedding set is called a set, never a pack");

wipe();
finish(list.report());

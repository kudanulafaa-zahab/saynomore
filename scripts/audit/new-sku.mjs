// New SKU — a product with no carton, created on top of a FAILED attempt.
//
// Ali, 2026-08-11, with a screenshot: "Can't create bodybutter."
//
//   duplicate key value violates unique constraint
//   "variants_model_id_attributes_key"
//
// THREE BUGS IN ONE, AND THE ERROR NAMED NONE OF THEM:
//
//  1. skus.carton_length_cm / width / height were NOT NULL CHECK (> 0). A body
//     butter carried home in a suitcase has no carton. The SKU insert was
//     rejected (0176).
//  2. The card inserted brand -> model -> variant -> sku in sequence with no
//     transaction, so that rejection left the first three STRANDED. Because a
//     variant is unique on (model_id, attributes) and this category has no
//     attributes, every retry then collided on the orphan and reported THAT —
//     an error about a completely different thing (0177).
//  3. And the Create button's own `canSave` still demanded L x W x H, so it sat
//     permanently greyed out with nothing on screen explaining why. Found by
//     driving this flow: the click timed out waiting for a button that could
//     never become enabled. Worse than an error, which at least tells you what
//     to fix.
//
// The fixture deliberately reproduces the STUCK STATE — orphan brand, model and
// variant with zero SKUs — because a fix that only works on a clean database
// would not have helped him at all.
//
// Usage:  node scripts/audit/new-sku.mjs

import { execFileSync } from "node:child_process";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates catalogue rows.");
  process.exit(2);
}
const q = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });

q(`
do $$
declare v_cat uuid; v_b uuid; v_m uuid;
begin
  delete from skus where internal_code = 'BODY-DEWB-1x1';

  select id into v_cat from product_categories where name = 'Bodybutter';
  if v_cat is null then
    insert into product_categories (name, unit_uom, cost_basis, default_sellable_units)
    values ('Bodybutter', 'tub', 'piece', array['piece']) returning id into v_cat;
  else
    update product_categories set unit_uom = 'tub', default_sellable_units = array['piece'] where id = v_cat;
  end if;

  -- The orphans, exactly as a failed attempt leaves them.
  select id into v_b from brands where lower(name) = 'bodyshop';
  if v_b is null then insert into brands (name) values ('Bodyshop') returning id into v_b; end if;
  select id into v_m from product_models where brand_id = v_b and lower(name) = 'dewberry';
  if v_m is null then
    insert into product_models (brand_id, category_id, name) values (v_b, v_cat, 'Dewberry') returning id into v_m;
  end if;
  if not exists (select 1 from variants where model_id = v_m) then
    insert into variants (model_id, display_name, attributes) values (v_m, 'Dewberry', '{}'::jsonb);
  end if;
end $$;`);

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";
const b = await launch();
const list = checklist("New SKU — a product with no carton, on top of a failed attempt");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });
try {
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: "New SKU" }).first().click();
  await page.waitForTimeout(1800);

  await page.getByPlaceholder(/or type new brand name/i).first().fill("Bodyshop");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Bodybutter$/ }).first().click();
  await page.waitForTimeout(800);
  await page.getByPlaceholder(/e\.g\. Mamypoko Diaper Pants/i).first().fill("Dewberry");
  await page.waitForTimeout(800);

  const sold = await page.locator("body").innerText();
  list.ok(/single tub/i.test(sold), "the wizard offers 'Single tub' for this category");

  const nums = page.locator('input[type="number"]');
  await nums.nth(0).fill("1");
  await nums.nth(1).fill("1");
  await page.waitForTimeout(1000);
  // L / W / H deliberately left EMPTY — a tub has no carton.

  const create = page.getByRole("button", { name: /create sku/i }).first();
  await create.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await create.click({ timeout: 15000 });
  await page.waitForTimeout(6000);

  const after = await page.locator("body").innerText();
  list.ok(!/duplicate key value/i.test(after), "NO duplicate-key error");
  list.ok(!/violates unique constraint/i.test(after), "no unique-constraint error");
  list.ok(!/fill all required fields/i.test(after), "carton dimensions are not demanded");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0,2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0,190)}`);
}
await ctx.close(); await b.close();

// Leave nothing behind: the next run must start from the same stuck state.
q(`delete from skus where internal_code = 'BODY-DEWB-1x1';`);

finish(list.report());

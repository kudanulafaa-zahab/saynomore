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

/** Click the first match with a real box — some rows render twice, once inside
 *  the `hidden lg:grid` desktop pane, and `.first()` can resolve to that copy. */
async function tapVisible(page, re) {
  const all = page.locator("button, [role=button], a[href]").filter({ hasText: re });
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const box = await all.nth(i).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) { await all.nth(i).click({ timeout: 12000 }); return; }
  }
  throw new Error(`no visible control matching ${re} (${n} matches)`);
}

/** Same problem, same fix, for inputs: the list panel renders twice (phone and
 *  the `hidden lg:grid` desktop pane), so `.first()` can be the hidden copy. */
async function fillVisible(page, re, value) {
  const all = page.getByPlaceholder(re);
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const box = await all.nth(i).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) { await all.nth(i).fill(value); return; }
  }
  throw new Error(`no visible input matching ${re} (${n} matches)`);
}
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

  // ── AND THEN WHAT? ──────────────────────────────────────────────────────
  // Creating a SKU defines a product. It does not put anything on a shelf, and
  // New Sale browses only what you own — so a brand-new product is simply
  // ABSENT from Sales, with nothing anywhere saying why or what to do next.
  // Ali, 2026-08-12: "When I enter sku Bodyshop it doesn't show in sales. How
  // do I sell it? Where do I enter cost price?" Both answers are Stock Ops ->
  // Receive, and until now nothing pointed at it. A create flow that ends in a
  // product you cannot sell is half a feature.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  // Search rather than walk the tree: the fixture already contains a "Body
  // Shop" brand (with a space) from the direct-receipt audit, and several SKUs
  // share the "1/pack x 1/ctn" shape. "Dewberry" is unique to this product.
  await fillVisible(page, /search skus/i, "Dewberry");
  await page.waitForTimeout(1500);

  const listed = await page.locator("body").innerText();
  list.ok(/no stock — can.t be sold/i.test(listed), "the product LIST flags it as not sellable");

  await tapVisible(page, /Dewberry/);
  await page.waitForTimeout(2500);

  const panel = await page.locator("body").innerText();
  list.ok(/no stock yet/i.test(panel), "the product page SAYS it cannot be sold yet");
  list.ok(/cost/i.test(panel), "and says that receiving is where cost price is entered");

  // The SKU panel renders twice — the phone sheet and the `hidden lg:grid`
  // desktop pane — so take the copy with a real box, not `.first()`.
  const all = page.locator('a[href*="/stock-ops"]').filter({ hasText: /receive stock/i });
  let recv = null;
  for (let i = 0; i < await all.count(); i++) {
    const box = await all.nth(i).boundingBox().catch(() => null);
    if (box && box.width > 0) { recv = all.nth(i); break; }
  }
  list.ok(!!recv, "with a one-tap route to Receive");
  const href = recv ? await recv.getAttribute("href") : null;
  list.ok(!!href?.includes("tab=receive"), `which lands on the RECEIVE tab (${href})`);
  list.ok(!!href?.includes("sku="), "with the product already chosen");

  // The link has to WORK. ?tab=receive silently fell through to Verify Count
  // from the day the Receive tab shipped, because the tab was added and its
  // route was not.
  await recv.click();
  await page.waitForTimeout(4000);
  const ops = await page.locator("body").innerText();
  list.ok(/no shipment, no freight/i.test(ops), "the Receive tab actually opens (not Verify Count)");
  list.ok(/how many tubs/i.test(ops), "asking in the product's own unit — tubs, never packs");
  list.ok(/cost of one/i.test(ops), "and for what one cost");
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0,190)}`);
}
await ctx.close(); await b.close();

// Leave nothing behind: the next run must start from the same stuck state.
q(`delete from skus where internal_code = 'BODY-DEWB-1x1';`);

finish(list.report());

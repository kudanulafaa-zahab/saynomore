// Adding IKEA bedding from nothing, the way Ali would.
//
// Ali, 2026-08-21, with a screenshot of the New SKU sheet:
// *"How do I add ikea and set it up? It's very complicated. Is there no other
// easy way to setup sku creation universally to create any product and
// models/variants etc."*
//
// He was right, and one of the reasons was a hard blocker rather than a matter
// of taste: the New Category form offered exactly three units — pcs, ml, g —
// because `lib/queries/products.ts` declared its OWN `UnitUom` of those three
// while `lib/trade-units.ts` carried the real eleven. Two definitions of one
// concept, silently disagreeing. So there was no way to say that one IKEA
// bedding item is a "set", and no way to say a body butter is a "tub" either —
// Bodybutter's tub had to be set by a migration, because the form could not.
//
// The other reasons were jargon and busywork:
//   Unit of Measure / Cost Basis / Variant Attributes — three database words
//   Pcs per Pack and Packs per Carton REQUIRED on every product, so a bedding
//   set could only be saved by typing 1 and 1
//
// This drives the whole job end to end on a phone, from no category at all:
// make the kind of product, then make the three sizes, then read the database.
// If any of it needs a migration, a console, or a person who knows what a
// cost basis is, this fails.
//
// Usage:  node scripts/audit/add-ikea.mjs

import { execFileSync } from "node:child_process";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  process.exit(2);
}
const q = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const scalar = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const BRAND = "IkeaAudit";
const CAT   = "Audit Bedding";
const MODEL = "Blavinda";

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

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";
const b = await launch();
const list = checklist("Adding IKEA bedding from nothing, the way Ali would");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });
try {
  // ── 1. The kind of product ────────────────────────────────────────────────
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  // Categories live behind a TAB on the Products screen, not a route — and it
  // is a real `tab` role, not a button.
  await page.getByRole("tab", { name: /categories/i }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /new category/i }).first().click();
  await page.waitForTimeout(1200);

  const catForm = await page.locator("body").innerText();
  // The jargon has to be GONE, not merely relabelled — these three words are
  // what made the screen unanswerable.
  list.ok(!/unit of measure/i.test(catForm), "no 'Unit of Measure' — it asks what you call one of them");
  list.ok(!/cost basis/i.test(catForm),      "no 'Cost Basis' — it follows from that answer");
  list.ok(!/variant attributes/i.test(catForm), "no 'Variant Attributes' — sizes are optional per product");
  // THE BLOCKER. Without this word there is no way to describe bedding at all.
  list.ok(/\bSet\b/.test(catForm), "and 'Set' is offered, which it never was before");

  await page.getByPlaceholder(/bedding/i).first().fill(CAT);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Set/ }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^create$/i }).first().click();
  await page.waitForTimeout(3000);

  const uom = scalar(`select unit_uom from product_categories where name='${CAT}';`);
  list.is(uom, "set", `the kind is stored as a set, from the form alone (${uom || "nothing"})`);
  const basis = scalar(`select cost_basis from product_categories where name='${CAT}';`);
  list.is(basis, "piece", "with the cost basis worked out rather than asked for");

  // ── 2. The product, in three sizes, in one pass ───────────────────────────
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "New SKU" }).first().click();
  await page.waitForTimeout(1500);

  await page.getByPlaceholder(/or type new brand name/i).first().fill(BRAND);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: new RegExp(`^${CAT}$`) }).first().click();
  await page.waitForTimeout(700);
  await page.getByPlaceholder(/e\.g\. Mamypoko Diaper Pants/i).first().fill(MODEL);
  await page.waitForTimeout(800);

  // A set comes one at a time, so the pack numbers must not be demanded.
  const skuForm = await page.locator("body").innerText();
  list.ok(/one set at a time/i.test(skuForm),
    "the form asks HOW IT COMES, in this product's own word — a set, not a pack");
  list.ok(!/pcs per pack/i.test(skuForm),
    "and does not demand pieces-per-pack for something sold one at a time");

  const sizeBox = page.getByPlaceholder(/NB \/ S \/ M \/ L/i).first();
  for (const s of ["Single", "Queen", "King"]) {
    await sizeBox.fill(s);
    await sizeBox.press("Enter");
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(700);

  const ready = await page.locator("body").innerText();
  list.ok(/creates\s*3\s*skus/i.test(ready.replace(/\s+/g, " ")),
    "it says three products are about to be created, before the tap");

  const create = page.getByRole("button", { name: /create sku/i }).first();
  await create.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await create.click({ timeout: 15000 });
  await page.waitForTimeout(7000);

  const after = await page.locator("body").innerText();
  list.ok(!/fill all required fields/i.test(after),
    "nothing invisible was still required — it saved without a pack size");
  list.ok(!/duplicate key value/i.test(after), "no duplicate-key error");
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0,2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0,190)}`);
}
await ctx.close(); await b.close();

// ── What landed ────────────────────────────────────────────────────────────
const models   = scalar(`select count(*) from product_models pm join brands b on b.id=pm.brand_id where b.name='${BRAND}';`);
const variants = scalar(`select count(*) from variants v join product_models pm on pm.id=v.model_id
                          join brands b on b.id=pm.brand_id where b.name='${BRAND}';`);
const sizes    = scalar(`select string_agg(v.attributes->>'size', ',' order by v.attributes->>'size')
                          from variants v join product_models pm on pm.id=v.model_id
                          join brands b on b.id=pm.brand_id where b.name='${BRAND}';`);
const packcfg  = scalar(`select string_agg(distinct s.pcs_per_pack || 'x' || s.packs_per_carton, ',')
                          from skus s join variants v on v.id=s.variant_id
                          join product_models pm on pm.id=v.model_id
                          join brands b on b.id=pm.brand_id where b.name='${BRAND}';`);
const noun     = scalar(`select unit_noun(unit_uom) from product_categories where name='${CAT}';`);

list.is(models,   "1", "ONE pattern holds all three sizes");
list.is(variants, "3", "three sizes under it");
list.is(sizes, "King,Queen,Single", `each carrying its own size (${sizes})`);
list.is(packcfg, "1x1", `sold one at a time, filled in for him (${packcfg})`);
list.is(noun,  "set", "and the whole app calls one of them a set");

wipe();
finish(list.report());

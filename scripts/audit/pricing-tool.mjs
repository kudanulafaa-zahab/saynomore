// The Pricing Tool survives every product in the catalogue.
//
// Ali, 2026-08-22, with a screenshot of the error screen:
// *"In market module pricing tool this error comes up."*
//
// It said "This screen didn't load", and under Technical detail:
//
//     Cannot read properties of null (reading 'toLocaleString')
//
// Every Sosoft SKU did it. The Customer Tier Prices table printed three
// figures — Pc, Pk, Ctn — behind ONE gate that only checked the per-piece
// value, then asserted the other two non-null with `!`:
//
//     {fmt2(tc.price_per_pack_mvr!)}
//
// Sosoft sells by the CARTON only, so get_tier_price_for_sku returns
// (37, null, 220): a piece price, no pack price, a carton price. The gate
// passed, the assertion lied, and fmt2 was handed a null. A `!` is a promise to
// the compiler that the runtime never made.
//
// ── WHY NO EXISTING AUDIT COULD HAVE CAUGHT IT ─────────────────────────────
//
// Two blind spots, and the second is the bigger one:
//
//   1. The fixture had ZERO competitors and ZERO competitor prices, so every
//      block in Market gated on `prices.length` rendered as nothing in every
//      run ever. /competitors passed contrast and material because the half of
//      the screen carrying the money was never on screen. Fixed in
//      supabase/fixtures/ui_fixture.sql.
//
//   2. Nothing ever changed the SKU. A screen with a product picker is not one
//      screen — it is one per product, and the first product in the list is the
//      only one anybody ever tests. The crash was invisible on the SKU that
//      loads by default and certain on four others.
//
// So this walks the WHOLE dropdown. Not a sample, not the first three: every
// option, because the one that breaks is by definition not the one you would
// have picked.
//
// Usage:  npm run audit:pricing

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  process.exit(2);
}
const scalar = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const list = checklist("The Pricing Tool survives every product in the catalogue");

// THE GUARD IS GUARDING SOMETHING. The whole point of this file is that the
// crashing shape exists in the fixture; if it ever stops existing, this audit
// keeps passing while testing nothing.
const cartonOnly = scalar(`select count(*) from v_skus
   where is_active and sellable_units = array['carton']::text[]
     and selling_price_per_pack_mvr is null;`);
list.ok(Number(cartonOnly) > 0,
  `the fixture still contains a carton-only SKU with no pack price — the shape that crashed (${cartonOnly})`);

const rivalPrices = scalar(`select count(*) from competitor_prices;`);
list.ok(Number(rivalPrices) > 0,
  `and a logged rival price, so the competitor blocks actually render (${rivalPrices})`);

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });
try {
  await page.goto(`${BASE}/competitors`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /pricing tool/i }).first().click();
  await page.waitForTimeout(2500);

  const body = await page.locator("body").innerText();
  list.ok(!/didn.t load/i.test(body), "the Pricing Tool opens at all");

  const sel = page.locator("select").first();
  const opts = await sel.locator("option").evaluateAll((os) =>
    os.map((o) => ({ v: o.value, t: o.textContent.trim() })));

  list.ok(opts.length > 3, `and offers the catalogue to choose from (${opts.length} products)`);

  const broken = [];
  for (const o of opts) {
    await sel.selectOption(o.v).catch(() => {});
    await page.waitForTimeout(1400);
    const text = await page.locator("body").innerText();
    if (/didn.t load/i.test(text)) {
      broken.push(o.t.split("(")[0].trim());
      // Recover, so one bad product does not report every product after it as
      // broken too — the failure list has to name the real culprits.
      await page.goto(`${BASE}/competitors`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2200);
      await page.getByRole("button", { name: /pricing tool/i }).first().click().catch(() => {});
      await page.waitForTimeout(1400);
    }
  }
  list.ok(broken.length === 0,
    `every product in the picker renders — ${broken.length} crashed: ${broken.join(", ") || "none"}`);

  // The units rule, at this door. A carton-only product must not be shown a
  // per-pack price, which is both what crashed and what was wrong to display.
  const cartonSku = opts.find((o) => /Sosoft/i.test(o.t));
  if (cartonSku) {
    await sel.selectOption(cartonSku.v);
    await page.waitForTimeout(1800);
    const tierBlock = await page.locator("text=Customer Tier Prices").locator("xpath=../..").innerText().catch(() => "");
    list.ok(tierBlock.length > 0, "the Customer Tier Prices table renders for a carton-only product");
    list.ok(!/\bPk\b/.test(tierBlock),
      `and offers no per-PACK price for a product sold only by the carton (${tierBlock.replace(/\s+/g, " ").slice(0, 90)})`);
    list.ok(/\bCtn\b/.test(tierBlock),
      "while still showing the carton price, which is the one he actually charges");
  }

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close();
await b.close();
finish(list.report());

// A half-finished product says so, on the screen where products are added.
//
// Ali, 2026-08-24: *"Solve the problems professionally so it doesn't repeat and
// I will be able to add any new product without coming back and debugging every
// time."*
//
// ── THE TWO FAILURES THIS DRIVES ────────────────────────────────────────────
//
// 1. TWO ENGINES DISAGREEING. The sell sheet showed MVR 380 a tub; Margin Watch
//    said the same tub had NO PRICE. Since migration 0201 every single item —
//    tub, jar, bar, bedding set — is born on the `pack` tier with its price on
//    the per-piece column, so EVERY product added from now on landed in exactly
//    that shape and would have been reported unpriced for ever.
//
// 2. NOBODY COULD SEE A HALF-FINISHED PRODUCT. get_pricing_health only looks at
//    products that HAVE STOCK, because its job is the money in the godown. So a
//    product with no price and no stock was invisible until a container landed
//    and someone tried to sell it. X-Tra Kering NB/S was in exactly that state.
//
// ── WHY THIS IS A BROWSER AUDIT AND NOT ONLY pgTAP ──────────────────────────
//
// setup_gaps.test.sql already proves the ENGINE. This proves Ali can SEE it: the
// panel is on Products, it names the product, it says what is missing and what
// that blocks, and — the part a database test cannot check — it says none of it
// in pieces. A migration without its screen is not a delivery (hard rule 6).
//
// Usage:  node scripts/audit/setup-gaps.mjs

import { execFileSync } from "node:child_process";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates catalogue rows.");
  process.exit(2);
}
const q      = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const scalar = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const BRAND = "GapAudit";

function wipe() {
  q(`delete from skus where variant_id in (
       select v.id from variants v join product_models pm on pm.id=v.model_id
       join brands b on b.id=pm.brand_id where b.name='${BRAND}');`);
  q(`delete from variants where model_id in (
       select pm.id from product_models pm join brands b on b.id=pm.brand_id where b.name='${BRAND}');`);
  q(`delete from product_models where brand_id in (select id from brands where name='${BRAND}');`);
  q(`delete from brands where name='${BRAND}';`);
  q(`delete from product_categories where name='Gap Audit Tubs';`);
}
wipe();

// THREE PRODUCTS, EACH IN A STATE THE APP CAN GENUINELY CREATE:
//
//   Priced      a tub, one per pack, price on the PER-PIECE column — exactly
//               what the New SKU sheet writes for a single item. Must be
//               reported as FINE by both engines. This is regression 1.
//   Unpriced    no price on any unit and no stock. Must be reported. This is
//               regression 2 — the state nothing could see.
//   Unmeasured  priced, but no carton dimensions, so a GRN carrying it would be
//               blocked by hard rule 4 long after the container sailed.
q(`
do $$
declare v_cat uuid; v_b uuid; v_m uuid; v_v uuid;
begin
  insert into product_categories (name, unit_uom, cost_basis, default_sellable_units)
  values ('Gap Audit Tubs', 'tub', 'piece', array['pack']) returning id into v_cat;

  insert into brands (name) values ('${BRAND}') returning id into v_b;
  insert into product_models (brand_id, category_id, name) values (v_b, v_cat, 'Butter')
    returning id into v_m;

  insert into variants (model_id, display_name, attributes) values (v_m, 'Priced', '{"size":"Priced"}'::jsonb)
    returning id into v_v;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm,
                    fixed_selling_price_mvr, sellable_units)
  values (v_v, 'GAPAUDIT-PRICED-1x1', 1, 1, 20, 20, 20, 380, array['pack']);

  insert into variants (model_id, display_name, attributes) values (v_m, 'Unpriced', '{"size":"Unpriced"}'::jsonb)
    returning id into v_v;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm, sellable_units)
  values (v_v, 'GAPAUDIT-UNPRICED-1x1', 1, 1, 20, 20, 20, array['pack']);

  insert into variants (model_id, display_name, attributes) values (v_m, 'Unmeasured', '{"size":"Unmeasured"}'::jsonb)
    returning id into v_v;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    fixed_price_per_pack_mvr, sellable_units)
  values (v_v, 'GAPAUDIT-NOCBM-1x1', 1, 1, 380, array['pack']);
end $$;`);

// ── The engine, before the browser ─────────────────────────────────────────
// Checked here as well as in pgTAP because a screen showing the right rows for
// the wrong reason still passes a screenshot test.
const pricedGaps   = scalar(`select count(*) from get_setup_gaps() where internal_code = 'GAPAUDIT-PRICED-1x1';`);
const unpricedGap  = scalar(`select gap from get_setup_gaps() where internal_code = 'GAPAUDIT-UNPRICED-1x1';`);
const nocbmGap     = scalar(`select gap from get_setup_gaps() where internal_code = 'GAPAUDIT-NOCBM-1x1';`);

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";
const b = await launch();
const list = checklist("A half-finished product says so, before it costs money");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });

list.is(pricedGaps, "0",
  `a tub priced MVR 380 on the per-piece column is FINE -- the shape every single item is now created in (${pricedGaps} gaps)`);
list.is(unpricedGap, "no_price",
  `a product with no price and no stock is caught (${unpricedGap || "nothing"})`);
list.is(nocbmGap, "no_carton_size",
  `and one with no carton measurements is caught before a container carries it (${nocbmGap || "nothing"})`);

try {
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  const body = await page.locator("body").innerText();

  list.ok(/not ready to trade/i.test(body),
    "the panel is on the Products screen, where products are added");
  list.ok(/GapAudit\s*›\s*Butter\s*›\s*Unpriced/i.test(body.replace(/\s+/g, " ")),
    "it names the product in full -- brand, model and size, not a SKU code");
  list.ok(/No selling price yet/i.test(body),
    "it says what is missing, in words");
  list.ok(/Cannot be sold/i.test(body),
    "and what that stops him doing -- a gap with no consequence is not worth a row");
  list.ok(/No carton measurements/i.test(body),
    "the unmeasured carton is listed too");
  list.ok(/cannot be received/i.test(body),
    "named as a RECEIVING problem, which is the one nothing warned about until the container arrived");

  // THE PRICED TUB MUST NOT APPEAR. This is the whole regression: it is the
  // shape every single item now has, so if it shows up here the panel would be
  // permanently full of healthy products and nobody would read it again.
  list.ok(!/GapAudit\s*›\s*Butter\s*›\s*Priced\b/i.test(body.replace(/\s+/g, " ")),
    "the PRICED tub is absent -- it used to read as unpriced while the till charged MVR 380");

  // NEVER A PIECE COUNT (CLAUDE.md: the rule covers every word Ali reads).
  const panel = await page.locator("text=/not ready to trade/i").locator("xpath=ancestor::div[1]").innerText();
  list.ok(!/\bpcs\b|\bpieces?\b/i.test(panel),
    `no piece count anywhere in the panel (${panel.replace(/\s+/g, " ").slice(0, 80)})`);

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

// ── AND IT DISAPPEARS WHEN THE CATALOGUE IS FINISHED ───────────────────────
// The rule that makes it worth reading. Checked at the engine, because proving
// the ABSENCE of a panel in a browser proves nothing about why it is absent.
q(`update skus set fixed_price_per_pack_mvr = 380
    where internal_code = 'GAPAUDIT-UNPRICED-1x1';`);
q(`update skus set carton_length_cm = 20, carton_width_cm = 20, carton_height_cm = 20
    where internal_code = 'GAPAUDIT-NOCBM-1x1';`);
const afterFix = scalar(`select count(*) from get_setup_gaps() where internal_code like 'GAPAUDIT-%';`);
list.is(afterFix, "0", `once each gap is filled the products drop off the list (${afterFix} left)`);

wipe();
finish(list.report());

// Giving away a carton of diapers as an Instagram prize.
//
// Ali, 2026-08-24: *"I launched an Instagram giveaway promotion for a case of
// diapers. Now I have chosen a winner. How do I apply it from my app? Since it's
// not a sale I will still have to enter it to the system and deduct from stock.
// Where will it go into the system and what's the best way professionals do
// it?"*
//
// ── WHAT THE BROWSER PROVES THAT pgTAP CANNOT ───────────────────────────────
//
// giveaway.test.sql proves the ACCOUNTING: cost not retail, marketing not
// write-off, no revenue, no order, no demand signal. This proves he can find it
// and use it on a phone — and, the part that matters most on screen, that he is
// asked for the quantity in CARTONS, never in pieces.
//
// Usage:  node scripts/audit/giveaway.mjs

import { execFileSync } from "node:child_process";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit moves stock and writes marketing spend.");
  process.exit(2);
}
const q      = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const scalar = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const BRAND    = "GiveawayAudit";
// A SECOND PRODUCT, SOSOFT-SHAPED: 1 x 6, so one piece IS one whole bottle.
// Ali, 2026-08-24: *"I'm also giving away sosoft bottles. I must be able to give
// away sosoft individual bottles too."* The unit toggle used to infer its trade
// tiers from the pack numbers — `pcs_per_pack > 1 ? pack : none` — which hides
// the bottle for exactly this shape, so the one screen built for giving things
// away could not give away one bottle.
const BOTTLE   = "GIVE-BOTL-700-1x6";
const CAMPAIGN = "Instagram giveaway audit";
const CODE     = "GIVE-DIAP-M-48x4";

function wipe() {
  // DEPENDENCY ORDER, and it matters: `inventory_batches` points at
  // `shipment_lines`, which points at `shipments`. The first version of this
  // cleaned one product, then deleted the shipment, then cleaned the second —
  // whose lines still hung off that shipment, so the foreign key refused and
  // the audit died before it ran. Both products are cleaned to the same depth
  // first, and only then is the shipment removed.
  const codes = `'${CODE}', '${BOTTLE}'`;
  q(`delete from marketing_spend_skus where spend_id in
       (select id from marketing_spend where campaign_name like '${CAMPAIGN}%');`);
  q(`delete from marketing_spend where campaign_name like '${CAMPAIGN}%';`);
  q(`delete from audit_log where action = 'giveaway' and reason like '%${CAMPAIGN}%';`);
  q(`delete from stock_movements   where sku_id in (select id from skus where internal_code in (${codes}));`);
  q(`delete from inventory_batches where sku_id in (select id from skus where internal_code in (${codes}));`);
  q(`delete from shipment_lines    where sku_id in (select id from skus where internal_code in (${codes}));`);
  q(`delete from shipments where reference = 'SH-GIVEAWAY-AUDIT';`);
  q(`delete from skus where internal_code in (${codes});`);
  q(`delete from variants where model_id in (
       select pm.id from product_models pm join brands b on b.id=pm.brand_id where b.name='${BRAND}');`);
  q(`delete from product_models where brand_id in (select id from brands where name='${BRAND}');`);
  q(`delete from brands where name='${BRAND}';`);
}
wipe();

// TWO CARTONS of 4 packs of 48, landed at MVR 5 a piece. One carton = 192
// pieces = MVR 960. It SELLS for MVR 1,560 — and that MVR 600 gap is the whole
// argument: the prize cost him 960, it did not lose him 1,560.
q(`
do $$
declare v_cat uuid; v_b uuid; v_m uuid; v_v uuid; v_s uuid; v_sh uuid; v_sl uuid; v_ba uuid; v_g uuid;
begin
  select id into v_cat from product_categories where unit_uom = 'pcs' order by sort_order limit 1;
  insert into brands (name) values ('${BRAND}') returning id into v_b;
  insert into product_models (brand_id, category_id, name) values (v_b, v_cat, 'Prize Diaper')
    returning id into v_m;
  insert into variants (model_id, display_name, attributes)
  values (v_m, 'M', '{"size":"M"}'::jsonb) returning id into v_v;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm,
                    fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
  values (v_v, '${CODE}', 48, 4, 40, 30, 30, 400, 1560, array['pack','carton'])
    returning id into v_s;

  select id into v_g from godowns where is_default order by created_at limit 1;
  if v_g is null then select id into v_g from godowns order by created_at limit 1; end if;

  insert into shipments (reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr)
  values ('SH-GIVEAWAY-AUDIT', (select id from suppliers order by created_at limit 1), 15.4, 15400)
    returning id into v_sh;
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (v_sh, v_s, 2, 0.036, 10, 'USD', v_g) returning id into v_sl;
  insert into inventory_batches (shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
  values (v_sl, v_s, v_g, now() - interval '5 days', 2, 384, 5.00, 240.00, 960.00)
    returning id into v_ba;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (v_ba, v_s, v_g, 'in', 384, 'shipment');

  -- The Sosoft shape: 1 x 6, sold by the bottle AND the carton.
  --
  -- ITS OWN MODEL UNDER AN ml CATEGORY. The first version hung this variant off
  -- the diaper model above, so its unit_uom was pcs and the toggle rendered
  -- "pk" — the check failed and it read as the tier being missing when the tier
  -- was fine and the fixture was wrong. A bottle needs a category that says
  -- bottle. (No backticks in here: this whole block is a JS template literal,
  -- and the first attempt closed the string with one.)
  select id into v_cat from product_categories where unit_uom = 'ml' order by sort_order limit 1;
  insert into product_models (brand_id, category_id, name) values (v_b, v_cat, 'Cleaning Liquid')
    returning id into v_m;
  insert into variants (model_id, display_name, attributes)
  values (v_m, '700ml', '{"size":"700ml"}'::jsonb) returning id into v_v;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm,
                    fixed_selling_price_mvr, fixed_price_per_carton_mvr, sellable_units)
  values (v_v, '${BOTTLE}', 1, 6, 40, 30, 30, 37, 220, array['pack','carton'])
    returning id into v_s;
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (v_sh, v_s, 2, 0.036, 10, 'USD', v_g) returning id into v_sl;
  insert into inventory_batches (shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
  values (v_sl, v_s, v_g, now() - interval '5 days', 2, 12, 17.50, 17.50, 105.00)
    returning id into v_ba;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (v_ba, v_s, v_g, 'in', 12, 'shipment');
end $$;`);

const stockBefore = scalar(`select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)),0)
  from stock_movements sm join skus s on s.id = sm.sku_id where s.internal_code = '${CODE}';`);

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";
const b = await launch();
const list = checklist("Giving away a carton as a prize — marketing at cost, not a sale");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });

list.is(stockBefore, "384", `two cartons are on hand before the giveaway (${stockBefore} pcs in the ledger)`);

try {
  await page.goto(`${BASE}/stock-ops`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const tabs = await page.locator("body").innerText();
  list.ok(/giveaway/i.test(tabs),
    "Giveaway is its own action in Stock Ops -- not hidden inside Write-off, which means shrinkage");

  await page.locator("button:visible").filter({ hasText: /^Giveaway$/i }).first().click();
  await page.waitForTimeout(1200);

  const intro = await page.locator("body").innerText();
  list.ok(/what it cost you/i.test(intro),
    "it says the cost basis before he starts -- at COST, never the shelf price");
  list.ok(/not to sales, and not to write-offs/i.test(intro),
    "and names the two places it deliberately does NOT go");

  const search = page.locator('input[placeholder*="gave away" i]:visible').first();
  await search.scrollIntoViewIfNeeded();
  await search.fill("Prize Diaper");
  await page.waitForTimeout(1500);

  await page.locator("button:visible").filter({ hasText: /Prize Diaper/i }).first().click();
  await page.waitForTimeout(1200);

  const sheet = await page.locator("body").innerText();
  list.ok(/which promotion/i.test(sheet),
    "the campaign is asked for as a NAMED field -- a prize nobody attributed cannot be measured");
  // THE UNITS RULE, at the one door where it matters most: he gave away a
  // CARTON, and the app must let him say so.
  list.ok(/how many given away/i.test(sheet), "it asks how many, in the unit he trades in");
  list.ok(!/\bpcs\b|\bpieces\b/i.test(sheet.split("Recent")[0]),
    "and never asks for a piece count");

  // Campaign, then one carton.
  await page.locator('input[aria-label="Campaign name"]:visible').first().fill(CAMPAIGN);
  await page.waitForTimeout(400);

  // Choose the CARTON tier explicitly — this is how he thinks about a "case".
  const ctnPill = page.locator("button:visible").filter({ hasText: /^ctn$|^carton$/i }).first();
  if (await ctnPill.count() > 0) { await ctnPill.click(); await page.waitForTimeout(400); }

  const qtyBox = page.locator('input[type="number"]:visible').first();
  await qtyBox.fill("1");
  await page.waitForTimeout(500);

  const go = page.locator("button:visible").filter({ hasText: /Record giveaway/i }).first();
  await go.scrollIntoViewIfNeeded();
  await go.click({ timeout: 15000 });
  await page.waitForTimeout(4000);

  const after = await page.locator("body").innerText();
  list.ok(!/violates|constraint|duplicate key/i.test(after), "no raw database error reached the screen");

  // ── AND ONE SINGLE BOTTLE ────────────────────────────────────────────────
  // The whole of Ali's second request. A 1 x 6 product's trade tiers must come
  // from `sellable_units`, not from the pack numbers — inferring them hides the
  // bottle, because pcs_per_pack is 1.
  const search2 = page.locator('input[placeholder*="gave away" i]:visible').first();
  await search2.scrollIntoViewIfNeeded();
  await search2.fill("700ml");
  await page.waitForTimeout(1500);
  await page.locator("button:visible").filter({ hasText: /700ml/i }).first().click();
  await page.waitForTimeout(1200);

  const bottleSheet = await page.locator("body").innerText();
  list.ok(/\bbtl\b|\bbottle\b/i.test(bottleSheet),
    "a 1x6 product offers its own unit — a BOTTLE — beside the carton");
  list.ok(!/\bpcs\b/i.test(bottleSheet.split("Recent")[0]),
    "and still never says pcs");

  await page.locator('input[aria-label="Campaign name"]:visible').first().fill(CAMPAIGN + " bottle");
  await page.waitForTimeout(400);
  const btlPill = page.locator("button:visible").filter({ hasText: /^btl$|^bottle$/i }).first();
  if (await btlPill.count() > 0) { await btlPill.click(); await page.waitForTimeout(400); }
  await page.locator('input[type="number"]:visible').first().fill("1");
  await page.waitForTimeout(400);
  const go2 = page.locator("button:visible").filter({ hasText: /Record giveaway/i }).first();
  await go2.scrollIntoViewIfNeeded();
  await go2.click({ timeout: 15000 });
  await page.waitForTimeout(4000);

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

// ── WHERE IT LANDED ────────────────────────────────────────────────────────
const stockAfter = scalar(`select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)),0)
  from stock_movements sm join skus s on s.id = sm.sku_id where s.internal_code = '${CODE}';`);
const spend = scalar(`select round(amount_mvr, 2) from marketing_spend where campaign_name = '${CAMPAIGN}';`);
const channel = scalar(`select channel from marketing_spend where campaign_name = '${CAMPAIGN}';`);
const linked = scalar(`select count(*) from marketing_spend_skus mss
  join marketing_spend ms on ms.id = mss.spend_id
  join skus s on s.id = mss.sku_id
  where ms.campaign_name = '${CAMPAIGN}' and s.internal_code = '${CODE}';`);
const orders = scalar(`select count(*) from sales_order_lines sol
  join skus s on s.id = sol.sku_id where s.internal_code = '${CODE}';`);
const source = scalar(`select distinct source_type from stock_movements sm
  join skus s on s.id = sm.sku_id where s.internal_code = '${CODE}' and sm.movement_type = 'out';`);

list.is(stockAfter, "192", `one carton left the godown (${stockAfter} pcs remain of ${stockBefore})`);
list.is(spend, "960.00",
  `and it cost MVR ${spend} -- what it LANDED at, not the MVR 1,560 it sells for`);
list.is(channel, "giveaway",
  `charged as goods, not as an ad boost (${channel}) -- stock out of the godown is a different cost from money out of the bank`);
list.is(linked, "1", "linked to the product, so campaign ROI measures it against that product's sales");
list.is(orders, "0",
  "NO sales order was created -- the winner is not a customer, and the follow-up round must not chase them");
list.is(source, "promotion",
  `the movement is marked as a promotion (${source}), so the P&L write-off line stays clean`);

// ── THE SINGLE BOTTLE LANDED ───────────────────────────────────────────────
const btlLeft = scalar(`select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)),0)
  from stock_movements sm join skus s on s.id = sm.sku_id where s.internal_code = '${BOTTLE}';`);
const btlSpend = scalar(`select round(amount_mvr, 2) from marketing_spend
  where campaign_name = '${CAMPAIGN} bottle';`);

list.is(btlLeft, "11", `exactly ONE bottle left the godown of twelve (${btlLeft} remain)`);
list.is(btlSpend, "17.50",
  `costed at the bottle's landed cost, MVR ${btlSpend} — not the MVR 37 it sells for, and not a whole carton`);

wipe();
finish(list.report());

// The home screen never tells him to buy what he has already bought.
//
// ── THE STATE OF THE BUSINESS THAT PROMPTED IT ──────────────────────────────
//
// On 2026-08-24 the top of the dashboard worklist read:
//
//     Merries Good skin L      Out of stock · sells about MVR 738 a week
//     Sosoft Green             Out of stock · sells about MVR 261 a week
//     Mamypoko Xtra Kering XL  Out of stock · sells about MVR  44 a week
//
// and every one linked to /reorder — the screen for BUYING MORE. All three sit
// on SH-2026-002, which was due on 2026-08-16, is eight days overdue and still
// in transit; two more products on it are also at zero. The goods were paid for
// and on the water, and the highest-ranked advice on his home screen was to
// order them a second time.
//
// ── WHY THIS IS A BROWSER AUDIT AND NOT ONLY A pgTAP TEST ───────────────────
//
// on_the_water_today.test.sql proves get_today returns the right rows. It
// cannot prove Ali SEES them, and that distinction is exactly what he caught
// four days ago with a screenshot: migration 0208 was correct, the sell sheet
// never read it, and I reported the feature as shipped. The dashboard renders
// Today rows generically — title, detail, href, no switch on kind — so this
// should need no UI change at all. "Should" is the word that failed last time.
// This drives the real page and reads the real panel.
//
// Usage:  node scripts/audit/late-shipment.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates products, stock, shipments, a customer and orders.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

// Everything this audit needs, created by this audit — the lesson
// reorder-nudge.mjs paid for: a check whose result depends on which audits ran
// before it is a coin toss.
//
// Keyed off the SKU code and the shipment reference, never the order number:
// `trg_assign_sales_order_number` rewrites order_number on insert, so a
// hand-written one does not survive to be deleted by.
const cleanup = `
  delete from sales_order_lines where sku_id in (select id from skus where internal_code like 'AUDLATE-%');
  delete from sales_orders where customer_id in (select id from customers where name = 'AudLate Buyer');
  delete from stock_movements where sku_id in (select id from skus where internal_code like 'AUDLATE-%');
  delete from inventory_batches where sku_id in (select id from skus where internal_code like 'AUDLATE-%');
  delete from shipment_lines where shipment_id in (select id from shipments where reference like 'AUDLATE-%');
  delete from shipments where reference like 'AUDLATE-%';
  delete from skus where internal_code like 'AUDLATE-%';
  delete from variants where model_id in (select id from product_models where name like 'AudLate %');
  delete from product_models where name like 'AudLate %';
  delete from product_categories where name = 'AudLate Category';
  delete from customers where name = 'AudLate Buyer';
`;
q(cleanup);

q(`
do $$
declare
  v_cat uuid; v_brand uuid; v_sup uuid; g uuid;
  m_late uuid; m_none uuid; m_soon uuid;
  vr_late uuid; vr_none uuid; vr_soon uuid;
  s_late uuid; s_none uuid; s_soon uuid;
  ship_late uuid; ship_soon uuid;
  batch uuid; cust uuid; o uuid; sk uuid;
  -- Maldives time, because get_today counts days in that calendar. A date
  -- taken from UTC is a day out for the last five hours of every day, which is
  -- how "7 days late" reads back as 8.
  v_today date := (now() at time zone 'Indian/Maldives')::date;
begin
  select id into g from godowns limit 1;
  select id into v_sup from suppliers limit 1;
  select id into v_brand from brands where name = 'Mamypoko' limit 1;

  insert into product_categories (name, unit_uom, cost_basis)
    values ('AudLate Category', 'pcs', 'piece') returning id into v_cat;

  -- THREE PRODUCTS, IDENTICAL IN EVERY WAY THAT MATTERS: same category, same
  -- pack size, same price, same stock story — in 40 days ago, all sold 10 days
  -- ago, so all three are at zero with real demand behind them. The ONLY thing
  -- that differs is which shipment, if any, is bringing more.
  insert into product_models (brand_id, category_id, name) values (v_brand, v_cat, 'AudLate Waiting') returning id into m_late;
  insert into product_models (brand_id, category_id, name) values (v_brand, v_cat, 'AudLate Nothing') returning id into m_none;
  insert into product_models (brand_id, category_id, name) values (v_brand, v_cat, 'AudLate OnTime')  returning id into m_soon;

  insert into variants (model_id, display_name, attributes) values (m_late, 'Waiting M', '{"size":"M"}'::jsonb) returning id into vr_late;
  insert into variants (model_id, display_name, attributes) values (m_none, 'Nothing M', '{"size":"M"}'::jsonb) returning id into vr_none;
  insert into variants (model_id, display_name, attributes) values (m_soon, 'OnTime M',  '{"size":"M"}'::jsonb) returning id into vr_soon;

  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr, sellable_units)
    values (vr_late, 'AUDLATE-WAIT-M-10x2', 10, 2, 300, array['pack','carton']) returning id into s_late;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr, sellable_units)
    values (vr_none, 'AUDLATE-NONE-M-10x2', 10, 2, 300, array['pack','carton']) returning id into s_none;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr, sellable_units)
    values (vr_soon, 'AUDLATE-SOON-M-10x2', 10, 2, 300, array['pack','carton']) returning id into s_soon;

  insert into customers (name, phone) values ('AudLate Buyer', '7778890') returning id into cust;

  foreach sk in array array[s_late, s_none, s_soon] loop
    insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                   landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr,
                                   source, received_at)
      values (sk, g, 10, 200, 10, 100, 200, 'direct', now() - interval '40 days') returning id into batch;
    insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
      values (batch, sk, g, 'in', 200, 'adjustment', now() - interval '40 days');
    insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
      values (batch, sk, g, 'out', 200, 'sales_order', now() - interval '10 days');
    -- A real, paid order, so the reorder engine has a velocity to price the
    -- loss at. Without it the product is merely absent, not missed.
    insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
      values ('AUDLATE-' || sk::text, cust, 'delivered', g, now() - interval '12 days', now() - interval '12 days')
      returning id into o;
    insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
      values (o, sk, 'pack', 20, 200, 300, 6000);
    insert into order_payments (order_id, amount_mvr, method) values (o, 6000, 'cash');
  end loop;

  -- LATE: due a week ago, still not here. SH-2026-002's shape.
  insert into shipments (reference, supplier_id, status, expected_arrival_date, rate_usd_to_mvr, rate_usd_to_idr)
    values ('AUDLATE-SHIP-LATE', v_sup, 'in_transit', v_today - 7, 15.4, 15400) returning id into ship_late;
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton, fob_per_carton, fob_currency, destination_godown_id)
    values (ship_late, s_late, 10, 0.05, 100, 'USD', g);

  -- ON SCHEDULE: open, not yet due. Nothing has gone wrong, so nothing is said.
  insert into shipments (reference, supplier_id, status, expected_arrival_date, rate_usd_to_mvr, rate_usd_to_idr)
    values ('AUDLATE-SHIP-SOON', v_sup, 'in_transit', v_today + 14, 15.4, 15400) returning id into ship_soon;
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton, fob_per_carton, fob_currency, destination_godown_id)
    values (ship_soon, s_soon, 10, 0.05, 100, 'USD', g);
end $$;
`);

const shipId = q1(`select id from shipments where reference = 'AUDLATE-SHIP-LATE';`);

const list = checklist("The home screen never says buy it again when it is already on the water");
const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });

try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  // The worklist panel, not the whole page: "Out of stock" appears in other
  // cards on this screen, and a body-wide match would read one of those as the
  // row that is supposed to be gone.
  const panel = page.locator("text=Worth doing today").locator("xpath=..");
  const work = await panel.innerText();

  // ── THE CONTROL, FIRST ──────────────────────────────────────────────────
  // If this fails every check below is meaningless, because the fixture would
  // not be producing stock-out rows at all.
  list.ok(/AudLate Nothing/.test(work),
    "a product at zero with nothing on order is still on the list, exactly as before");

  // ── THE INCIDENT ────────────────────────────────────────────────────────
  list.ok(!/AudLate Waiting/.test(work),
    "the product waiting on a LATE shipment is NOT listed as something to go and buy");
  list.ok(/AUDLATE-SHIP-LATE is 7 days late/.test(work),
    "the shipment is the row instead — named, and counted in days late");
  list.ok(/1 product out of stock waiting on it/.test(work),
    "and it says how many products are stuck behind it");

  // ── ON SCHEDULE IS NOT A PROBLEM ────────────────────────────────────────
  list.ok(!/AUDLATE-SHIP-SOON/.test(work),
    "a shipment still inside its expected date says nothing at all");
  list.ok(/AudLate OnTime/.test(work),
    "and the product behind it is still a live buying decision — on order early is not on order late");

  // ── THE UNITS RULE, AT THIS DOOR ────────────────────────────────────────
  list.ok(!/\bpcs\b|\bpieces?\b/i.test(work),
    "nothing on the worklist counts anything in pieces");

  // ── ONE TAP GOES TO THE SHIPMENT, NOT TO THE BUY SCREEN ─────────────────
  const row = panel.locator(`a[href="/shipments/${shipId}"]`);
  list.is(await row.count(), 1, "the row links to the shipment itself");

  await row.first().click();
  await page.waitForTimeout(3000);
  const dest = await page.locator("body").innerText();
  list.ok(page.url().includes(`/shipments/${shipId}`),
    `and it opens (${page.url().replace(BASE, "").slice(0, 60)})`);
  list.ok(/AUDLATE-SHIP-LATE/.test(dest),
    "on the shipment he can actually chase, showing its own reference");

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

// Teardown is REPORTED, never allowed to swallow the run: a cleanup bug that
// throws looks exactly like a broken feature, and it leaves rows behind for the
// next audit either way.
try {
  q(cleanup);
} catch (e) {
  list.ok(false, `cleanup left rows behind: ${String(e).split("\n")[0].slice(0, 150)}`);
}

finish(list.report());

// The price review a container triggers — and the two answers it must give.
//
// Ali, 2026-08-27, the morning after SH-2026-002 landed at MVR 5,133 per CBM
// against SH-2026-001's MVR 2,392:
//   *"For me to set the selling price with the best profit how do I see it?
//    Is there an easy way? ... Also how do I know compared the 001 shipment
//    price."*
//
// ── WHAT THIS GUARDS, AND WHY EACH LINE IS HERE ────────────────────────────
//
// 1. THE COMPARISON, NAMED ON BOTH SIDES. "Cost per pack MVR 128.10 → 147.32 ·
//    SH-AUDIT-PRICE-1 → SH-AUDIT-PRICE-2". His second question has no answer
//    else in the app, and a comparison that does not name which arrival it is
//    against is not a comparison.
//
// 2. THE MARKET CAP. Restoring a margin is arithmetic; whether the price is
//    SELLABLE is not. Sosoft's cost rose 49.5% on the real container, restoring
//    40% needs MVR 56 a bottle, and Ali reports the shops at MVR 36 — so the
//    review must refuse to suggest it. A screen that hands over an unsellable
//    number is worse than one that says nothing, and only a rendered assertion
//    proves the refusal reaches the page rather than sitting in a column.
//
// 3. THE RATCHET (migration 0214). Accepting a suggestion re-anchored "the
//    margin this price used to earn" on the price just accepted, so the next
//    render asked for more, for ever. The tap is driven here for real and the
//    row is checked afterwards: no button, and no larger number.
//
// 4. NEVER PIECES. Sosoft says "bottle" and the diaper says "pack", both from
//    the category, and "pcs" must not appear anywhere on the panel. Five other
//    files have re-derived this noun and every one fell through to a wrong
//    "pack".
//
// ── WHY THIS AUDIT BUILDS ITS OWN CATALOGUE ────────────────────────────────
//
// The shared fixture has ONE arrival, so there is nothing to compare against. A
// second arrival could have gone into ui_fixture.sql, but every product it
// touched would gain stock, and that file's own comments record twice that
// extra stock turned a healthy fixture product into a slow mover and broke
// unrelated audits.
//
// The first version borrowed the fixture's Sosoft and diaper and was wrong to.
// The GRN audit runs earlier in the same job and confirms SH-FIXTURE-GRN, which
// spreads MVR 2,000 of freight and MVR 15,400 of duty over two lines — so by
// the time this ran, the fixture diaper's newest landed cost was MVR 1,083 a
// pack against a MVR 199 price and every verdict came back `below_cost`,
// correctly. The audit was measuring the GRN audit's arithmetic, not its own.
//
// So it builds all of it: two categories, a brand, models, variants, SKUs and
// two confirmed arrivals with costs chosen here. Nothing it asserts depends on
// what ran before it. And the workflow runs this BEFORE the contrast sweep, so
// the panel it creates is measured there too rather than being the one screen
// nobody has measured.
//
// The figures asserted on screen are still READ BACK from get_price_review
// rather than typed twice. Whether they are RIGHT is price_review.test.sql's
// job; this audit's job is that the screen shows them, in the right unit, with
// a button that works.
//
// Usage:  node scripts/audit/price-review.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit receives a shipment and rewrites selling prices.");
  process.exit(2);
}
const run    = (q) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" });
const scalar = (q) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-tAc", q], { encoding: "utf8" }).trim();

const DIAPER = "AUDIT-PACK-42x4";   // 42 x 4, sold by pack and carton — noun "pack"
const BOTTLE = "AUDIT-BOTT-1x6";    // 1 x 6, sold by the bottle and the carton

// ── Its own catalogue, and two arrivals ────────────────────────────────────
// FIRST VERSION BORROWED THE FIXTURE'S OWN PRODUCTS AND WAS WRONG TO. The GRN
// audit runs earlier in the same job and confirms SH-FIXTURE-GRN, which puts
// MVR 2,000 of freight and MVR 15,400 of duty across two lines — so by the time
// this audit ran, the fixture diaper's newest landed cost was MVR 1,083 a pack
// against a MVR 199 price. Every verdict came back `below_cost`, correctly, and
// the audit was measuring the GRN audit's arithmetic rather than its own.
//
// So it builds everything: two categories (one 'ml', so its noun really is
// "bottle" and not a fallback "pack"), a brand, models, variants, SKUs, and two
// grn_confirmed arrivals with costs chosen here. Nothing it asserts depends on
// what ran before it, and because its second arrival is the newest confirmed
// GRN in the database, the panel under test contains exactly these two rows.
//
//   pack   MVR 128.10 → 147.84 a pack, priced 199  → restores at 230, no rival
//   bottle MVR  22.16 →  33.14 a bottle, priced 40 → restores at 60, shelf 36
run(`
do $$
declare
  v_cat_d uuid := '00000000-0000-0000-0000-00000000ea01';
  v_cat_l uuid := '00000000-0000-0000-0000-00000000ea02';
  v_brand uuid := '00000000-0000-0000-0000-00000000ea03';
  v_mod_d uuid := '00000000-0000-0000-0000-00000000ea04';
  v_mod_l uuid := '00000000-0000-0000-0000-00000000ea05';
  v_var_d uuid := '00000000-0000-0000-0000-00000000ea06';
  v_var_l uuid := '00000000-0000-0000-0000-00000000ea07';
  v_dia   uuid := '00000000-0000-0000-0000-00000000ea08';
  v_bot   uuid := '00000000-0000-0000-0000-00000000ea09';
  v_comp  uuid := '00000000-0000-0000-0000-00000000ea10';
  v_ship1 uuid := '00000000-0000-0000-0000-00000000eb01';
  v_ship2 uuid := '00000000-0000-0000-0000-00000000eb02';
  v_sup   uuid := (select id from suppliers limit 1);
  v_god   uuid := (select id from godowns where is_default limit 1);
begin
  -- Idempotent: this audit can be run twice against one seeded database.
  delete from stock_movements where sku_id in (v_dia, v_bot);
  delete from inventory_batches where sku_id in (v_dia, v_bot);
  delete from shipment_lines where sku_id in (v_dia, v_bot);
  delete from shipments where id in (v_ship1, v_ship2);
  delete from competitor_prices where competitor_id = v_comp;
  delete from competitors where id = v_comp;
  delete from audit_log where table_name = 'skus' and record_id in (v_dia, v_bot);
  delete from skus where id in (v_dia, v_bot);
  delete from variants where id in (v_var_d, v_var_l);
  delete from product_models where id in (v_mod_d, v_mod_l);
  delete from product_categories where id in (v_cat_d, v_cat_l);
  delete from brands where id = v_brand;

  insert into product_categories (id, name, unit_uom, cost_basis)
  values (v_cat_d, 'Audit Diapers', 'pcs', 'piece'),
         -- 'ml' is what makes unit_noun say BOTTLE. A category of 'pcs' would
         -- fall through to "pack" and the noun assertion would pass for the
         -- wrong reason -- which is how five other files got this wrong.
         (v_cat_l, 'Audit Liquid', 'ml', 'per_100ml');
  insert into brands (id, name, mixed_carton_pieces) values (v_brand, 'Audit Brand', null);
  insert into product_models (id, category_id, brand_id, name)
  values (v_mod_d, v_cat_d, v_brand, 'Audit Nappy'),
         (v_mod_l, v_cat_l, v_brand, 'Audit Cleaner');
  insert into variants (id, model_id, display_name)
  values (v_var_d, v_mod_d, 'L'), (v_var_l, v_mod_l, 'Blue 700ml');

  insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                    carton_length_cm, carton_width_cm, carton_height_cm,
                    fixed_price_per_pack_mvr, fixed_price_per_carton_mvr, sellable_units)
  values (v_dia, v_var_d, '${DIAPER}', 42, 4, 50, 40, 40, 199, 776, array['pack','carton']),
         (v_bot, v_var_l, '${BOTTLE}',  1, 6, 40, 30, 30,  40, 240, array['pack','carton']);

  insert into shipments (id, reference, supplier_id, status, grn_confirmed_at,
                         rate_usd_to_mvr, rate_usd_to_idr)
  values (v_ship1, 'SH-AUDIT-PRICE-1', v_sup, 'grn_confirmed', now() - interval '40 days', 20.5, 16000),
         (v_ship2, 'SH-AUDIT-PRICE-2', v_sup, 'grn_confirmed', now(),                      21.5, 16000);

  -- Arrival 1, then arrival 2 at the dearer cost. Written out rather than
  -- looped so both figures are visible beside the prices they are judged against.
  insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  -- TWENTY CARTONS, NOT ONE. The daily list ranks every row against every
  -- other by money at stake in the next seven days and shows the top five, so a
  -- single carton of each would leave the price-review row ranked below the
  -- fixture's dead stock and off the screen this audit is checking. A real
  -- shipment line is twenty-odd cartons; one was the unrealistic number.
  values ('00000000-0000-0000-0000-00000000ec01', v_ship1, v_dia, 20, 0.08,  40, 'USD', v_god),
         ('00000000-0000-0000-0000-00000000ec02', v_ship1, v_bot, 20, 0.036, 10, 'USD', v_god),
         ('00000000-0000-0000-0000-00000000ec03', v_ship2, v_dia, 20, 0.08,  40, 'USD', v_god),
         ('00000000-0000-0000-0000-00000000ec04', v_ship2, v_bot, 20, 0.036, 10, 'USD', v_god);

  insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                 qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
  values ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-00000000ec01',
          v_dia, v_god, now() - interval '40 days', 20, 3360,  3.05, 128.10,  512.40),
         ('00000000-0000-0000-0000-00000000ed02', '00000000-0000-0000-0000-00000000ec02',
          v_bot, v_god, now() - interval '40 days', 20, 120, 22.16,  22.16,  132.96),
         ('00000000-0000-0000-0000-00000000ed03', '00000000-0000-0000-0000-00000000ec03',
          v_dia, v_god, now(),                     20, 3360,  3.52, 147.84,  591.36),
         ('00000000-0000-0000-0000-00000000ed04', '00000000-0000-0000-0000-00000000ec04',
          v_bot, v_god, now(),                     20, 120, 33.14,  33.14,  198.84);

  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values ('00000000-0000-0000-0000-00000000ed01', v_dia, v_god, 'in', 3360, 'shipment'),
         ('00000000-0000-0000-0000-00000000ed02', v_bot, v_god, 'in',  120, 'shipment'),
         ('00000000-0000-0000-0000-00000000ed03', v_dia, v_god, 'in', 3360, 'shipment'),
         ('00000000-0000-0000-0000-00000000ed04', v_bot, v_god, 'in',  120, 'shipment');

  -- The shelf price that makes the restoring price unsellable. Ali reported
  -- MVR 36 for a 700ml bottle on 2026-08-28 against his own 37.
  insert into competitors (id, name) values (v_comp, 'Fixture Shelf');
  insert into competitor_prices (competitor_id, variant_id, their_pcs_per_pack,
                                 price_mvr, price_basis, observed_date)
  values (v_comp, v_var_l, 1, 36, 'per_pack', current_date);
end $$;
`);

/** One row of the engine's own answer, so the screen is checked against what
 *  Postgres computed rather than against a number typed in this file. */
const review = (code, col) => scalar(`select coalesce(${col}::text, '') from get_price_review(
  (select id from shipments where reference = 'SH-AUDIT-PRICE-2')) where internal_code = '${code}';`);
const priceOf = (code, col) => scalar(`select coalesce(${col}::text, '') from skus where internal_code = '${code}';`);

const expect = {
  diaperPrev: review(DIAPER, "prev_cost_unit"),
  diaperNow:  review(DIAPER, "this_cost_unit"),
  diaperSug:  review(DIAPER, "suggested_unit"),
  diaperRef:  review(DIAPER, "prev_reference"),
  bottlePrev: review(BOTTLE, "prev_cost_unit"),
  bottleNow:  review(BOTTLE, "this_cost_unit"),
  bottleSug:  review(BOTTLE, "suggested_unit"),
  bottleWord: review(BOTTLE, "unit_noun"),
};

const browser = await launch();
const list = checklist("Price review — what the container did to every margin");
const { ctx, page } = await signedInPage(browser, { device: "phone", scheme: "dark" });

try {
  // The engine must have set the stage before the screen is judged. If these
  // two are wrong the rest of the run is measuring the wrong thing.
  list.is(review(DIAPER, "verdict"), "raise",
    "the diaper has room in the market, so the review says raise it");
  list.is(review(BOTTLE, "verdict"), "capped_by_market",
    "and the bottle does not, so the review refuses to suggest a price");
  list.is(expect.bottleWord, "bottle",
    `the bottle's unit noun comes from its category (${expect.bottleWord})`);

  // ── THE DAILY LIST POINTS AT IT, AND HE ARRIVES BY TAPPING ──────────────
  //
  // Ali, 2026-08-28: *"Is financials the proper place to have this? What's
  // expert view?"* No — Financials is a REPORT and a price review is a TASK
  // that finishes, so it belongs on the daily list and on the shipment (0216).
  // This audit follows the route he actually takes rather than typing the URL,
  // because a row that does not deep-link to the right container is the whole
  // failure and a direct `goto` would never see it.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const home = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  list.ok(/SH-AUDIT-PRICE-2 cost more than last time/.test(home),
    "the daily list carries one row for the arrival that cost more");
  list.ok(/2 products to reprice/.test(home),
    "and counts the products behind it rather than listing them");
  list.ok(!/\bpcs\b|\bpieces\b/i.test(home), "with nothing on the home screen counted in pieces");

  await page.getByText(/SH-AUDIT-PRICE-2 cost more than last time/).first().click();
  await page.waitForTimeout(3500);
  list.ok(/SH-AUDIT-PRICE-2/.test(await page.locator("body").innerText()),
    "and tapping it lands on that shipment, not on a list of all of them");

  const seen = await page.locator("body").innerText();
  const flat = seen.replace(/\s+/g, " ");

  // ── 1. It is there, and it names BOTH arrivals ──────────────────────────
  list.ok(/Price review/i.test(seen), "the price review panel is on the Financials screen");
  list.ok(/SH-AUDIT-PRICE-2/.test(seen), "and it names the shipment it is reviewing");
  list.ok(flat.includes(`${expect.diaperRef} → SH-AUDIT-PRICE-2`),
    `and the arrival it is comparing against (${expect.diaperRef}) -- the question that had no answer anywhere in the app`);

  // ── 2. The comparison, in money, in the unit the product is SOLD in ─────
  list.ok(flat.includes(`Cost per pack MVR ${expect.diaperPrev} → ${expect.diaperNow}`),
    `the diaper's cost is compared per PACK, old against new (${expect.diaperPrev} → ${expect.diaperNow})`);
  list.ok(flat.includes(`Cost per bottle MVR ${expect.bottlePrev} → ${expect.bottleNow}`),
    "and the Sosoft row says BOTTLE -- the noun comes from the product, never a hardcoded 'pack'");

  // ── 3. Never pieces ─────────────────────────────────────────────────────
  const panelText = await page.locator("div.glass-panel").filter({ hasText: /Price review/i })
    .first().innerText().catch(() => flat);
  list.ok(!/\bpcs\b|\bpieces\b/i.test(panelText),
    "nothing on the panel counts anything in pieces");

  // ── 4. The market cap: the honest refusal, rendered ─────────────────────
  list.ok(/Fixture Shelf is at MVR 36/.test(flat),
    "the Sosoft row quotes the shelf price in Ali's own selling unit");
  list.ok(/not the answer here/i.test(flat),
    `and says raising is not the answer, instead of handing over the MVR ${expect.bottleSug} that would restore the margin`);
  list.is(
    String(await page.getByRole("button", { name: new RegExp(`^Set MVR ${expect.bottleSug} per bottle$`) }).count()),
    "0",
    "so no button offers the unsellable price");

  // ── 5. The suggestion that IS sellable, and one tap ─────────────────────
  const before = priceOf(DIAPER, "fixed_price_per_pack_mvr");
  list.is(before, "199.00", `the diaper is still at its old MVR 199 a pack (${before})`);

  const setBtn = page.getByRole("button", { name: new RegExp(`^Set MVR ${expect.diaperSug} per pack$`) }).first();
  list.ok(await setBtn.count() > 0,
    `the diaper row offers one tap at MVR ${expect.diaperSug} a pack, the price that restores its margin`);
  await setBtn.scrollIntoViewIfNeeded();
  await setBtn.click();
  await page.waitForTimeout(3500);

  const after = priceOf(DIAPER, "fixed_price_per_pack_mvr");
  list.is(Number(after).toFixed(0), Number(expect.diaperSug).toFixed(0),
    `one tap set the pack price to MVR ${expect.diaperSug} (${after})`);
  list.ok(Number(priceOf(DIAPER, "fixed_price_per_carton_mvr")) > 776,
    "and moved the carton with it, so the two never drift apart");

  // ── 6. THE RATCHET. It must now be finished with this product ───────────
  list.is(review(DIAPER, "verdict"), "repriced",
    "accepting the suggestion ENDS the review for that product");
  list.is(review(DIAPER, "suggested_unit"), "",
    "so there is no second, higher price waiting behind the first");

  // The diaper is the only product on this panel sold by the PACK, so after it
  // has been repriced no "per pack" button may remain. Left unfixed, the row
  // came straight back offering a higher number, and then a higher one again.
  const settled = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  list.ok(!/Set MVR [\d,]+ per pack/.test(settled),
    "and the screen stops offering to raise it -- the ratchet that would have talked him up for ever");

  list.is(scalar(`select count(*) from audit_log where table_name = 'skus'
      and field_name = 'selling_price'
      and record_id = (select id from skus where internal_code = '${DIAPER}');`),
    "1", "the change is in the audit log, once");

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}

await ctx.close();
await browser.close();
finish(list.report());

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
//    SH-FIXTURE → SH-FIXTURE-PRICE". His second question has no answer anywhere
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
// ── WHY THIS AUDIT BUILDS ITS OWN ARRIVAL ──────────────────────────────────
//
// The shared fixture has ONE arrival, so there is nothing to compare against. A
// second arrival could have gone into ui_fixture.sql, but every product it
// touched would gain stock, and that file's own comments record twice that
// extra stock turned a healthy fixture product into a slow mover and broke
// unrelated audits. So the arrival is created here — and the workflow runs this
// BEFORE the contrast sweep, so the panel it creates is measured there too
// rather than being the one screen nobody has measured.
//
// ── AND WHY THE EXPECTED FIGURES ARE READ, NOT TYPED ───────────────────────
//
// The GRN audit runs earlier in the same run and confirms SH-FIXTURE-GRN, which
// gives these same two products a NEWER batch at a cost confirm_grn worked out.
// A hardcoded "previous cost" would therefore pass or fail on which audits ran
// first. So the new cost is derived from whatever the current one actually is
// (+15%, which keeps the verdict a `raise`), and the figures asserted on screen
// are read back from get_price_review. Whether those figures are RIGHT is
// price_review.test.sql's job; this audit's job is that the screen shows them,
// in the right unit, with a button that works.
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

const DIAPER = "MAMY-XTRA-L-42x4";   // 42 x 4, sold by pack and carton
const BOTTLE = "SOSO-BLUE-1x6";      // 1 x 6, sold by the bottle and the carton

// ── A second, dearer arrival ───────────────────────────────────────────────
// The shape of SH-2026-002: the supplier price moved a little and the freight
// moved a lot. +15% on whatever the current cost is, so the verdict is a raise
// no matter which audits ran before this one.
run(`
do $$
declare
  v_ship uuid := '00000000-0000-0000-0000-00000000e001';
  v_comp uuid := '00000000-0000-0000-0000-00000000e009';
  v_sup  uuid := (select id from suppliers limit 1);
  v_god  uuid := (select id from godowns where is_default limit 1);
  v_dia  uuid := (select id from skus where internal_code = '${DIAPER}');
  v_bot  uuid := (select id from skus where internal_code = '${BOTTLE}');
  v_i    integer := 0;
  r      record;
  v_old  numeric;
  v_new  numeric;
begin
  delete from shipments where id = v_ship;
  insert into shipments (id, reference, supplier_id, status, grn_confirmed_at,
                         rate_usd_to_mvr, rate_usd_to_idr)
  values (v_ship, 'SH-FIXTURE-PRICE', v_sup, 'grn_confirmed', now(), 21.5, 16000);

  for r in select k.id, k.pcs_per_pack, k.packs_per_carton, k.cbm_per_carton
             from skus k where k.id in (v_dia, v_bot) loop
    v_i := v_i + 1;
    select ib.landed_per_piece_mvr into v_old
      from inventory_batches ib
     where ib.sku_id = r.id and ib.landed_per_piece_mvr is not null
     order by ib.received_at desc limit 1;
    v_new := round(v_old * 1.15, 4);

    insert into shipment_lines (id, shipment_id, sku_id, qty_cartons, cbm_per_carton,
                                fob_per_carton, fob_currency, destination_godown_id)
    values (('00000000-0000-0000-0000-00000000e1' || lpad(v_i::text, 2, '0'))::uuid,
            v_ship, r.id, 1, r.cbm_per_carton, 40, 'USD', v_god);
    insert into inventory_batches (id, shipment_line_id, sku_id, godown_id, received_at,
                                   qty_cartons_received, qty_pieces_received,
                                   landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr)
    values (('00000000-0000-0000-0000-00000000e2' || lpad(v_i::text, 2, '0'))::uuid,
            ('00000000-0000-0000-0000-00000000e1' || lpad(v_i::text, 2, '0'))::uuid,
            r.id, v_god, now(), 1, r.pcs_per_pack * r.packs_per_carton,
            v_new, v_new * r.pcs_per_pack, v_new * r.pcs_per_pack * r.packs_per_carton);
    insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
    values (('00000000-0000-0000-0000-00000000e2' || lpad(v_i::text, 2, '0'))::uuid,
            r.id, v_god, 'in', r.pcs_per_pack * r.packs_per_carton, 'shipment');
  end loop;

  -- The shelf price that makes the restoring price unsellable. Ali reported
  -- MVR 36 for a 700ml bottle on 2026-08-28; the fixture prices his at 40.
  delete from competitors where id = v_comp;
  insert into competitors (id, name) values (v_comp, 'Fixture Shelf');
  insert into competitor_prices (competitor_id, variant_id, their_pcs_per_pack,
                                 price_mvr, price_basis, observed_date)
  select v_comp, k.variant_id, 1, 36, 'per_pack', current_date
    from skus k where k.id = v_bot;

  -- An earlier audit in the run may have edited these products, and the review
  -- would then read them as already dealt with. Wind the clock back so this
  -- audit does not pass or fail on what ran before it.
  update skus set updated_at = now() - interval '1 hour' where id in (v_dia, v_bot);
  delete from audit_log where table_name = 'skus' and field_name = 'selling_price'
    and record_id in (v_dia, v_bot);
end $$;
`);

/** One row of the engine's own answer, so the screen is checked against what
 *  Postgres computed rather than against a number typed in this file. */
const review = (code, col) => scalar(`select coalesce(${col}::text, '') from get_price_review(
  (select id from shipments where reference = 'SH-FIXTURE-PRICE')) where internal_code = '${code}';`);
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

  await page.goto(`${BASE}/financials?tab=profit`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const seen = await page.locator("body").innerText();
  const flat = seen.replace(/\s+/g, " ");

  // ── 1. It is there, and it names BOTH arrivals ──────────────────────────
  list.ok(/Price review/i.test(seen), "the price review panel is on the Financials screen");
  list.ok(/SH-FIXTURE-PRICE/.test(seen), "and it names the shipment it is reviewing");
  list.ok(flat.includes(`${expect.diaperRef} → SH-FIXTURE-PRICE`),
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

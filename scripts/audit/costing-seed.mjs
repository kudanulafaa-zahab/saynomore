// The simulator says which container it is costing like.
//
// Ali, 2026-08-29:
//   *"In prices, pricing tool where is it getting the landed cost from? How
//    does it apply between grns? 002 is much higher price than 001. So is
//    this tool accurate?"*
//
// ── THE ARITHMETIC WAS NEVER WRONG. THE ASSUMPTION WAS SILENT ──────────────
//
// The screen pre-filled forex, freight and clearing from whichever shipment
// was newest, and never said so. Freight is charged by VOLUME, so the rate
// belongs to one container rather than to the trade:
//
//     SH-2026-001   8.01 CBM   MVR 19,156 freight   =  MVR 2,392 per CBM
//     SH-2026-002   2.69 CBM   MVR 13,829 freight   =  MVR 5,133 per CBM
//
// Every simulation started after 27 August therefore ran at more than double
// the earlier rate. That is REAL -- a small consignment has less container to
// share -- but simulating a full container against it over-costs every line
// and argues him out of quotes that are perfectly good.
//
// ── WHAT THIS ASSERTS ──────────────────────────────────────────────────────
//
// That the rate is NAMED on screen, in MVR per CBM with the container behind
// it, and that choosing a different arrival actually re-seeds the numbers. The
// last one is the assertion that matters: a picker that changes a label and
// not the money would look fixed and be worse than nothing.
//
// Usage:  node scripts/audit/costing-seed.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit inserts shipments.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-tAc", sql], { encoding: "utf8" }).trim();

// Two arrivals shaped like his real ones: a big cheap-per-CBM container and a
// small dear-per-CBM one. Deliberately the NEWEST two, so the screen opens on
// the dear one exactly as it does in production.
//   BIG:  10 cartons x 0.8 CBM = 8 CBM, USD 400 at 20 -> MVR 1,000 per CBM
//   SMALL: 2 cartons x 0.5 CBM = 1 CBM, USD 200 at 25 -> MVR 5,000 per CBM
q(`
  delete from shipment_lines where shipment_id in
    (select id from shipments where reference in ('SH-SEED-BIG','SH-SEED-SMALL'));
  delete from shipments where reference in ('SH-SEED-BIG','SH-SEED-SMALL');
`);
q(`
do $$
declare v_sup uuid; v_god uuid; v_sku uuid; v_big uuid; v_small uuid;
begin
  select id into v_sup from suppliers limit 1;
  select id into v_god from godowns limit 1;
  select id into v_sku from skus order by internal_code limit 1;
  insert into shipments (reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr, status,
                         grn_confirmed_at, my_freight_share_usd,
                         mpl_charges_mvr, agent_fee_mvr, last_mile_mvr)
  values ('SH-SEED-BIG', v_sup, 20, 16000, 'grn_confirmed', now() - interval '2 hours', 400, 100, 200, 300)
  returning id into v_big;
  insert into shipments (reference, supplier_id, rate_usd_to_mvr, rate_usd_to_idr, status,
                         grn_confirmed_at, my_freight_share_usd,
                         mpl_charges_mvr, agent_fee_mvr, last_mile_mvr)
  values ('SH-SEED-SMALL', v_sup, 25, 16500, 'grn_confirmed', now() - interval '1 hour', 200, 700, 800, 900)
  returning id into v_small;
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, cbm_per_carton,
                              fob_per_carton, fob_currency, destination_godown_id)
  values (v_big,   v_sku, 10, 0.8, 40, 'USD', v_god),
         (v_small, v_sku,  2, 0.5, 40, 'USD', v_god);
end $$;`);

const list = checklist("Costing seed — which container the simulator is costing like");

// The engine first, so a UI failure below cannot be blamed on the maths.
list.is(q1(`select freight_mvr_per_cbm::int::text from get_costing_defaults(
  (select id from shipments where reference = 'SH-SEED-BIG'));`), "1000",
  "the big container works out at MVR 1,000 per CBM");
list.is(q1(`select freight_mvr_per_cbm::int::text from get_costing_defaults(
  (select id from shipments where reference = 'SH-SEED-SMALL'));`), "5000",
  "and the small one at MVR 5,000 -- five times the rate for the same trade");

const browser = await launch();
const { ctx, page } = await signedInPage(browser, { device: "phone", scheme: "dark" });

try {
  await page.goto(`${BASE}/costing`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  const opened = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  list.ok(!/didn.t load/i.test(opened), "the simulator opens");

  // ── 1. IT SAYS WHICH CONTAINER, AND AT WHAT RATE ────────────────────────
  const picker = page.getByLabel("Costing like");
  list.ok(await picker.count() > 0, "the screen says which arrival it is costing like");
  list.ok(/SH-SEED-SMALL/.test(opened),
    "and opens on the most recent arrival, as it always has");
  list.ok(/Freight MVR 5,?000 per CBM/.test(opened),
    "naming the freight rate in MVR per CBM -- the figure that says whether a simulation is realistic");
  list.ok(/1 CBM/.test(opened),
    "with the container's own volume beside it, because a freight share means nothing without it");

  // ── 2. CHOOSING ANOTHER ARRIVAL RE-SEEDS THE MONEY, NOT JUST THE LABEL ──
  // The assertion that matters. A picker that moves a label and leaves the
  // numbers behind would look fixed and be worse than nothing.
  const before = await page.getByLabel(/USD . MVR/).first().inputValue().catch(() => "");
  await picker.selectOption({ label: (await picker.locator("option").allInnerTexts())
    .find((t) => /SH-SEED-BIG/.test(t)) });
  await page.waitForTimeout(2500);

  const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  list.ok(/Freight MVR 1,?000 per CBM/.test(after),
    "picking the bigger container re-states the rate as MVR 1,000 per CBM");
  const rateNow = await page.getByLabel(/USD . MVR/).first().inputValue().catch(() => "");
  list.ok(rateNow !== before && Number(rateNow) === 20,
    `and re-seeds the forex rate with that shipment's own (${before} -> ${rateNow})`);

  // Every shipment stands alone: the clearing charges move with it too. Forex
  // from one container and clearing from another is a shipment that never was,
  // so this reads the field rather than scanning the page for a number that
  // could have come from anywhere.
  const mpl = await page.getByLabel("MPL charges (MVR)").first().inputValue().catch(() => "");
  list.is(Number(mpl), 100,
    `and its own clearing charges come with it, not the other container's (MPL ${mpl})`);

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}

await ctx.close();
await browser.close();
finish(list.report());

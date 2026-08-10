// GRN audit — receiving a shipment, and the money it produces.
//
// This is the biggest money calculation in the app and it had no screen-level
// check at all. Confirming a GRN does four irreversible things at once:
//
//   * apportions FREIGHT and LOCAL charges across lines by each line's share of
//     total CBM — which is why the fixture's shipment has two lines with
//     different carton sizes; a single-line shipment apportions 100% to itself
//     and proves nothing
//   * apportions DUTY by rate-weighted FOB value, a different basis from freight
//   * LOCKS the forex rate, permanently — every margin, price suggestion and
//     P&L figure downstream is denominated in what is decided here
//   * creates the batches and moves the stock
//
// Get it wrong and nothing errors. Every landed cost is simply wrong from then
// on, and the app reports those wrong numbers confidently. New Sale got covered
// first because that is where Ali complained; this is covered because it is
// where the largest quiet mistake could live.
//
// The arithmetic is asserted in the DATABASE (that is where the money math
// lives), and the SCREEN is asserted for the things a screen owns: that it
// refuses to receive twice, and that it shows what happened.
//
// Usage:  node scripts/audit/grn.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const q = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

// Receiving is IRREVERSIBLE by design, so this audit consumes the thing it
// tests: run it twice and the second run has nothing left to receive. CI always
// starts from a fresh database and would never notice; a person running it
// twice on their laptop would see a failure that is not a failure — which is
// precisely the flakiness that teaches people to ignore red.
//
// So it un-receives the FIXTURE shipment first, and only that one, matched by
// reference. Local databases only: the guard below refuses anything else,
// because these statements against production would delete real stock.
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit deletes stock movements and batches to reset its fixture.");
  process.exit(2);
}
q(`
  delete from stock_movements where batch_id in (
    select b.id from inventory_batches b
    join shipment_lines l on l.id = b.shipment_line_id
    join shipments s on s.id = l.shipment_id
    where s.reference = 'SH-FIXTURE-GRN');
  delete from inventory_batches where shipment_line_id in (
    select l.id from shipment_lines l join shipments s on s.id = l.shipment_id
    where s.reference = 'SH-FIXTURE-GRN');
  update shipments set status = 'arrived', grn_confirmed_at = null, grn_confirmed_by = null
   where reference = 'SH-FIXTURE-GRN';
`);

const browser = await launch();
const list = checklist("GRN — receiving a shipment and the money it produces");
const { ctx, page } = await signedInPage(browser, { device: "desktop", scheme: "light" });

try {
  // ── Before ────────────────────────────────────────────────────────────────
  const before = {
    status: q("select status from shipments where reference='SH-FIXTURE-GRN'"),
    batches: Number(q("select count(*) from inventory_batches b join shipment_lines l on l.id=b.shipment_line_id join shipments s on s.id=l.shipment_id where s.reference='SH-FIXTURE-GRN'")),
  };
  list.is(before.status, "arrived", "the fixture shipment starts ARRIVED, not received");
  list.is(before.batches, 0, "and has no batches yet");

  // ── Receive it, through the real screen ───────────────────────────────────
  const shipmentId = q("select id from shipments where reference='SH-FIXTURE-GRN'");
  await page.goto(`${BASE}/shipments/${shipmentId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  // The CTA reads "Confirm receipt — add to stock". Matched on the FULL phrase:
  // the amber banner above it also says "confirm receipt to update stock" and is
  // itself a button, so a loose match clicks the banner and nothing happens.
  const receive = page.getByRole("button", { name: /confirm receipt\s*—\s*add to stock/i }).first();
  list.ok((await receive.count()) > 0, "the screen offers a way to receive the shipment");
  await receive.click();
  await page.waitForTimeout(1500);

  // The confirm sheet asks which warehouse, then commits.
  const commit = page.getByRole("button", { name: /confirm|receive|yes/i }).last();
  await commit.click();
  await page.waitForTimeout(6000);

  // ── The money ─────────────────────────────────────────────────────────────
  const after = q(`
    select string_agg(x.line, '|' order by x.code) from (
      select sk.internal_code as code,
             sk.internal_code || '~' ||
             round(b.landed_per_carton_mvr, 2) || '~' ||
             b.qty_cartons_received as line
      from inventory_batches b
      join shipment_lines l on l.id = b.shipment_line_id
      join shipments s      on s.id = l.shipment_id
      join skus sk          on sk.id = b.sku_id
      where s.reference = 'SH-FIXTURE-GRN'
    ) x`);
  const rows = Object.fromEntries((after || "").split("|").filter(Boolean)
    .map((r) => { const [c, landed, qty] = r.split("~"); return [c, { landed: Number(landed), qty: Number(qty) }]; }));

  list.is(Object.keys(rows).length, 2, `both lines produced a batch (${Object.keys(rows).join(", ")})`);

  // THE APPORTIONMENT, WORKED OUT BY HAND
  //
  // CBM shares — line A: 10 cartons x 0.036 = 0.36. Line B: 10 x 0.080 = 0.80.
  // Total 1.16, so A carries 31.034% and B 68.966%.
  //
  // A NOTE ON DUTY, because the first version of this audit got it wrong and the
  // mistake is worth keeping. confirm_grn apportions duty by DUTY-RATE-WEIGHTED
  // FOB (fob_total_mvr * duty_rate_pct), and falls back to CBM share when the
  // total weight is zero. Every category Ali actually trades — Diapers,
  // Dishwashing, Liquid and Powder Detergent — is at 0.00% duty in production;
  // only Tobacco carries a rate, and he does not sell it. So in production TODAY
  // the weighted branch never runs and duty spreads by CBM like everything else.
  // The fixture matches that, deliberately: an audit should exercise the path the
  // business is on, not the one the code merely permits.
  //
  //   freight 2,000 USD x 15.4 = 30,800 + local 7,700 + duty 15,400 = 53,900
  //   A: 0.31034 x 53,900 = 16,727.59 + FOB (100 USD x 15.4 = 1,540) = 18,267.59
  //   B: 0.68966 x 53,900 = 37,172.41 + FOB (400 USD x 15.4 = 6,160) = 43,332.41
  //   per carton: A 1,826.76   B 4,333.24
  const A = rows["SOSO-BLUE-1x6"], B = rows["MAMY-XTRA-L-42x4"];
  const near = (got, want, tol = 0.5) => got != null && Math.abs(got - want) <= tol;
  list.ok(near(A?.landed, 1826.76), `the small-carton line lands at 1,826.76/carton (got ${A?.landed})`);
  list.ok(near(B?.landed, 4333.24), `the big-carton line lands at 4,333.24/carton (got ${B?.landed})`);

  // And the two lines must differ: freight apportioned by CBM is the whole point,
  // so a change that accidentally split it evenly would still total 61,600 and
  // still be wrong. This is the assertion that would catch it.
  list.ok((B?.landed ?? 0) > (A?.landed ?? 0) * 2,
    "the bigger-carton line carries materially more freight — apportionment is by CBM, not per line");

  // The whole shipment's cost must end up in the batches — nothing lost, nothing
  // invented. FOB 500 USD x 15.4 = 7,700, plus 38,500 freight+local, plus 15,400
  // duty = 61,600.
  const total = Number(q(`
    select round(sum(b.landed_per_carton_mvr * b.qty_cartons_received), 2)
    from inventory_batches b
    join shipment_lines l on l.id = b.shipment_line_id
    join shipments s      on s.id = l.shipment_id
    where s.reference = 'SH-FIXTURE-GRN'`));
  list.ok(Math.abs(total - 61600) <= 2,
    `every rufiyaa of the shipment is accounted for in the batches (expected 61,600, got ${total})`);

  // Forex is locked at receiving and must never move afterwards.
  // Compared as a NUMBER: Postgres renders numeric as "15.40000000".
  list.is(Number(q("select rate_usd_to_mvr from shipments where reference='SH-FIXTURE-GRN'")), 15.4,
    "the forex rate is the one locked at receiving");

  // Stock actually moved.
  const moved = Number(q(`
    select coalesce(sum(m.qty_pieces), 0) from stock_movements m
    join inventory_batches b on b.id = m.batch_id
    join shipment_lines l on l.id = b.shipment_line_id
    join shipments s on s.id = l.shipment_id
    where s.reference='SH-FIXTURE-GRN' and m.movement_type='in'`));
  list.ok(moved > 0, `stock moved into the warehouse (${moved} pieces across both lines)`);

  list.is(q("select status from shipments where reference='SH-FIXTURE-GRN'"), "grn_confirmed",
    "the shipment is marked received");

  // ── It must refuse to receive twice ───────────────────────────────────────
  // Receiving again would double the stock and re-apportion the cost. The
  // screen must not offer it.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const again = await page.getByRole("button", { name: /confirm receipt\s*—\s*add to stock/i }).count();
  list.is(again, 0, "the screen no longer offers to receive an already-received shipment");

  list.is(page.errors.length, 0, `no uncaught page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (err) {
  list.ok(false, `the GRN flow did not complete: ${String(err).split("\n")[0].slice(0, 200)}`);
}

await ctx.close();
await browser.close();
finish(list.report());

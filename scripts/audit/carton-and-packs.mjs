// One carton and two packs, of the same product, on one order.
//
// Ali, 2026-08-16: *"I try to sell 1 carton and 2 packs of Royal soft boys
// diapers. I have to add one carton, set the price manually since I'm giving a
// discount and again press add to order and add 2 packs with a manual discount
// price applied."* And the app refused the second add:
//
//     Mamypoko M is already in this order — change the quantity on that line
//     instead
//
// So the sale could not be entered at all. Not awkward — impossible.
//
// HE HAD ALREADY ASKED FOR THIS. On 2026-08-09, quoted at the top of
// cart-math.ts: *"There must be function to add more products to each order…
// let me add more to this order or delete from order like a proper checkout
// page or cart."* That was built, for DIFFERENT products. The same product in
// two units stayed blocked behind a UNIQUE (order_id, sku_id) added in
// migration 0060, whose own header calls it a "known limitation (accepted)" —
// accepted by me, never put to him.
//
// THE CONSTRAINT IS STILL RIGHT. `stock_movements` records (order, sku) and
// not which LINE, so two lines of one product would make a return or a line
// edit reverse the wrong stock — the exact class of silent money bug this
// project keeps paying for. What was wrong was the answer to it: refusing the
// sale rather than doing the arithmetic.
//
// So the two adds now JOIN into one line, and this audit is the proof that
// they do — with the money exact and the quantity described the way he typed
// it, not as the flat pack count the arithmetic collapses to.
//
// Usage:  node scripts/audit/carton-and-packs.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

// Read-only, and local only: the cart is checked on the screen, but whether the
// sale actually moved stock can only be answered by the ledger.
const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

// ITS OWN CUSTOMER, and this is not tidiness — the audit failed without one.
// Run alone it passed; run after the others it did not, because the shared
// fixture customer had picked up order history from journey.mjs and offline.mjs
// and the screen then offers "Repeat last order" and a cross-sell prompt that
// intercept the taps. An audit whose result depends on which audits ran before
// it is not a check, it is a coin toss — the lesson cross-sell.mjs paid for
// over four attempts, written down in this folder's README.
const NAME = "Carton Plus Packs";
const cleanup = `
  delete from stock_movements where source_id in
    (select id from sales_orders where customer_id in (select id from customers where name = '${NAME}'));
  delete from sales_order_lines where order_id in
    (select id from sales_orders where customer_id in (select id from customers where name = '${NAME}'));
  delete from sales_orders where customer_id in (select id from customers where name = '${NAME}');
  delete from customers where name = '${NAME}';
`;
q(cleanup);
q(`insert into customers (name, phone, channel) values ('${NAME}', '7799123', 'whatsapp');`);

const b = await launch();
const list = checklist("A carton and some loose packs, on one line");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });

// The fixture SKU: Mamypoko Xtra Kering L, 42 pieces a pack, 4 packs a carton.
// 1 carton + 2 packs = 6 packs.
//
// THE PRICES ARE DERIVED FROM COST, NOT TYPED. Hardcoded ones (MVR 1,200 a
// carton) passed alone and then failed inside the gate: sell-new-product.mjs
// receives stock of this SKU at its own landed cost, so by the time this audit
// runs the cost has moved and MVR 300 a pack is BELOW it. The below-cost
// confirm sheet then opens — correctly, that guard is doing its job — and
// swallows the tap, which reads as "Add to Order is broken".
//
// So the prices are read off the shelf and set above it, keeping Ali's shape:
// a better rate per pack inside a full carton than on the loose ones, which is
// the whole reason two prices were wanted in the first place.
const COST_PACK = Number(q1(`
  select round(max(bs.landed_per_piece_mvr) * sk.pcs_per_pack, 2)
  from v_batch_stock bs join skus sk on sk.id = bs.sku_id
  where sk.internal_code = 'MAMY-XTRA-L-42x4' and bs.qty_pieces_remaining > 0
  group by sk.pcs_per_pack;`));
const CARTON_PRICE = Math.ceil(COST_PACK * 4 * 1.25);   // a carton, ~25% up
const PACK_PRICE   = Math.ceil(COST_PACK * 1.35);       // loose packs, dearer
const PACKS        = 2;
const EXPECTED     = CARTON_PRICE + PACK_PRICE * PACKS;

try {
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /new sale/i }).first().click();
  const newSale = page.getByRole("dialog", { name: /new sale/i });
  await newSale.getByText(NAME).first().click();
  await page.getByRole("button", { name: /add products/i }).first().click();
  await page.waitForTimeout(1500);
  await page.locator("select").first().selectOption({ label: "Veesange" });
  await page.waitForTimeout(1500);

  // The catalogue is two taps: the model, then the SKU inside it. Everything
  // afterwards is scoped to the New Sale dialog — unscoped matches hit the
  // catalogue card behind it, which is the lesson journey.mjs paid for.
  const sheet = page.getByRole("dialog", { name: /new sale/i });

  // Idempotent on purpose. After the first add the model stays expanded, so a
  // blind second tap on it COLLAPSES the list and the SKU row disappears —
  // which reads as "the app refused me" when it is the audit fumbling the
  // catalogue. Open the model only when the SKU is not already showing.
  async function openEditor() {
    const skuRow = page.getByRole("button", { name: /Mamypoko · Xtra Kering · L/i }).first();
    if (!(await skuRow.isVisible().catch(() => false))) {
      await page.locator("button", { hasText: "Xtra Kering" }).first().click();
      await page.waitForTimeout(900);
    }
    await skuRow.click();
    await page.waitForTimeout(1200);
  }

  async function add(unit, count, unitPrice) {
    await sheet.getByRole("button", { name: unit, exact: true }).first().click();
    await page.waitForTimeout(500);
    await sheet.locator('input[inputmode="numeric"]').first().fill(String(count));
    await sheet.locator('input[inputmode="decimal"]').first().fill(String(unitPrice));
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /add to order/i }).first().click();
    await page.waitForTimeout(1500);
    // The cross-sell prompt is a real feature and it lands right here. Declining
    // it is what a person would do; leaving it open blocks every later tap.
    const notNow = page.getByRole("button", { name: /not this time/i }).first();
    if (await notNow.isVisible().catch(() => false)) {
      await notNow.click();
      await page.waitForTimeout(800);
    }
  }

  // ── The carton ────────────────────────────────────────────────────────────
  await openEditor();
  await add("Carton (4 Packs)", 1, CARTON_PRICE);
  const afterCarton = await page.locator("body").innerText();
  list.ok(/order items · 1/i.test(afterCarton), "the carton goes on the order");

  // ── And then the loose packs, which is where it used to stop ──────────────
  await openEditor();
  await add("Pack", PACKS, PACK_PRICE);

  const body = await page.locator("body").innerText();

  // SCOPED TO THE CART, and this is not fussiness — it is a bug this audit
  // already had. "1 ctn + 2 pack" is also how the SKU card states what is on
  // the shelf, so a page-wide search matched the STOCK badge and the quantity
  // check passed against a deliberately broken build. A check that can be
  // satisfied by a different part of the screen is not checking anything.
  const cart = (body.split(/ORDER ITEMS/i)[1] ?? "").split(/\nTotal\b/i)[0];

  // THE REFUSAL IS GONE.
  list.ok(!/already in this order/i.test(body),
    "adding loose packs of the same product is no longer refused");

  // AND IT IS STILL ONE LINE — the ledger's rule is kept by arithmetic, not by
  // a red message. Two lines here would be a database error at the final tap.
  list.ok(/order items · 1/i.test(body),
    "the two adds became ONE line, so the stock ledger stays unambiguous");

  // THE QUANTITY IS WHAT HE TYPED. "6 packs" is arithmetically identical and
  // reads as a mistake to someone who entered a carton and two packs.
  list.ok(/1 ctn \+ 2 pack/i.test(cart),
    `the cart line reads as 1 carton + 2 packs, not the flat pack count (cart said "${cart.trim().replace(/\s+/g, " ").slice(0, 90)}")`);

  // THE MONEY IS EXACT. This is the check that matters most: a join that
  // rounded, or that re-derived a price from one of the two rates, would be a
  // silent discount on every mixed order.
  const total = (body.match(/Total\s*MVR\s*([\d,]+)/i) ?? [])[1]?.replace(/,/g, "");
  list.is(Number(total), EXPECTED,
    `the total is the two prices he typed, added (MVR ${EXPECTED.toLocaleString()})`);

  // The standing units rule.
  list.ok(!/\bpcs\b|\bpieces\b/i.test(body), "no piece counts anywhere in the cart");

  // ── AND THEN IT HAS TO SURVIVE THE LEDGER ─────────────────────────────────
  // A cart that looks right is half a check. The joined line still has to pass
  // `enforce_sol_qty_pieces` (qty_pieces must equal qty × the unit conversion,
  // exactly), the UNIQUE (order_id, sku_id) it was built to respect, and the
  // `sol_line_total_matches` tolerance of two laari between line_total and
  // qty × unit_price — a blended rate is a repeating decimal, so that last one
  // is not a formality.
  //
  // Stopping at the cart is how a change like this ships and then fails on the
  // final tap, which is the worst possible place to find out.
  await page.getByRole("button", { name: /review & confirm/i }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /place order/i }).first().click();
  await page.waitForTimeout(6000);

  const after = await page.locator("body").innerText();
  list.ok(!/qty_pieces|does not match|violates|duplicate key/i.test(after),
    `the order saves — no ledger guard rejected the joined line (${after.slice(0, 120).replace(/\s+/g, " ")})`);

  const saved = q1(`
    select coalesce(sum(sol.qty_pieces), 0) || '|' || coalesce(sum(sol.line_total_mvr), 0)
                                            || '|' || count(*)
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    where so.customer_id = (select id from customers where name = '${NAME}')
      and sol.sku_id = (select id from skus where internal_code = 'MAMY-XTRA-L-42x4')
      and so.created_at > now() - interval '10 minutes';`);
  const [pieces, money, lines] = saved.split("|");
  list.is(Number(lines), 1, "one row reached sales_order_lines, not two");
  list.is(Number(pieces), 252, "with the full quantity: 1 carton + 2 packs = 6 packs (252 in the ledger's own unit)");
  list.is(Number(money), EXPECTED, `and the full money, MVR ${EXPECTED.toLocaleString()}`);

  // Stock is derived from movements, never stored, so this is the real test
  // that the sale actually moved what it charged for.
  const moved = q1(`
    select coalesce(sum(sm.qty_pieces), 0)
    from stock_movements sm
    join sales_orders so on so.id = sm.source_id
    where sm.source_type = 'sales_order' and sm.movement_type = 'out'
      and sm.sku_id = (select id from skus where internal_code = 'MAMY-XTRA-L-42x4')
      and so.customer_id = (select id from customers where name = '${NAME}')
      and so.created_at > now() - interval '10 minutes';`);
  list.is(Number(moved), 252, "and the shelf gave up exactly that much stock");

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}

await ctx.close(); await b.close();

// Put the fixture back so a second run behaves exactly like the first.
try {
  q(cleanup);
} catch (e) {
  list.ok(false, `cleanup left rows behind: ${String(e).split("\n")[0].slice(0, 150)}`);
}

finish(list.report());

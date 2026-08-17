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

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const b = await launch();
const list = checklist("A carton and some loose packs, on one line");
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });

// The fixture SKU: Mamypoko Xtra Kering L, 42 pieces a pack, 4 packs a carton.
// 1 carton + 2 packs = 6 packs. The prices are Ali's shape — a better rate per
// pack inside a full carton than on the loose ones, which is the whole reason
// two lines were wanted in the first place.
const CARTON_PRICE = 1200;   // MVR for one carton (= 300 a pack)
const PACK_PRICE   = 305;    // MVR for each loose pack
const PACKS        = 2;
const EXPECTED     = CARTON_PRICE + PACK_PRICE * PACKS;  // MVR 1,810

try {
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /new sale/i }).first().click();
  const newSale = page.getByRole("dialog", { name: /new sale/i });
  await newSale.getByText("Ahmed Ziyad").first().click();
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
  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}

await ctx.close(); await b.close();
finish(list.report());

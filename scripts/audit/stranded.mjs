// Customers left with nothing to reorder — does the app say so, and offer a fix?
//
// Ali, 2026-08-14: "For diapers I am discontinuing mamypoko Royal soft and skin
// comfort and only sticking to xtra kering and merries for diapers."
//
// THE BUSINESS FACT THIS GUARDS. Fourteen customers had bought one of the four
// dropped ranges. Six of them also buy a range we kept and will not notice.
// EIGHT HAVE BOUGHT NOTHING ELSE — when the stock they hold runs out there is
// nothing in their history to bring them back, and on a ~9-day repurchase clock
// they leave without ever saying so. That is the most expensive kind of churn
// there is: silent, and entirely caused by our own decision.
//
// The engine for it (get_stranded_customers, migration 0180) is checked by
// pgTAP. This checks the half pgTAP cannot see: that the answer REACHES HIM.
// The last two features to ship engine-first — the run-out rule and the Price
// Simulator — were both invisible for weeks, one behind a lens nobody opened
// and one missing from the menu entirely. A brain nobody hears is not
// intelligence.
//
// WHAT IT DRIVES, END TO END: the At risk lens shows a stranded block, names
// the person, says what they were buying, offers a replacement WE ACTUALLY HAVE
// IN STOCK, and puts a WhatsApp draft one tap away that leads with the offer
// rather than announcing a loss. Plus the two standing rules: never "I", always
// "we"; and no piece count reaches the screen.
//
// THE FIXTURE HAS NO SIZES ON PURPOSE. seed.sql's variant carries no `size`
// attribute, so this exercises the category-agnostic path — a detergent, a
// bodybutter, anything without a size ladder. If the swap rule ever grows a
// hidden assumption that products have sizes, this goes red.
//
// Usage:  node scripts/audit/stranded.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates products, stock, a customer and an order.");
  process.exit(2);
}
const q = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

// Everything this audit needs, created by this audit. reorder-nudge.mjs learned
// the hard way that a check whose result depends on which audits ran before it
// is a coin toss, not a check.
//
// KEYED OFF THE SKU CODE AND THE CUSTOMER NAME, NEVER THE ORDER NUMBER.
// `trg_assign_sales_order_number` rewrites order_number on insert, so the
// 'AUD-STR-1' handed to the INSERT does not survive it — matching on it deleted
// nothing, the order line outlived its SKU, and the run died on a foreign key
// during teardown. The SKU code and the customer name are ours and nothing
// rewrites them.
const cleanup = `
  delete from sales_order_lines where sku_id in (select id from skus where internal_code like 'AUDSTR-%');
  delete from sales_orders where customer_id in (select id from customers where name = 'AudStr Stranded');
  delete from stock_movements where sku_id in (select id from skus where internal_code like 'AUDSTR-%');
  delete from inventory_batches where sku_id in (select id from skus where internal_code like 'AUDSTR-%');
  delete from skus where internal_code like 'AUDSTR-%';
  delete from variants where model_id in (select id from product_models where name like 'AudStr %');
  delete from product_models where name like 'AudStr %';
  delete from product_categories where name = 'AudStr Category';
  delete from customers where name = 'AudStr Stranded';
`;
q(cleanup);

q(`
do $$
declare v_cat uuid; v_brand uuid; m_dead uuid; m_live uuid;
        v_dead uuid; v_live uuid; s_dead uuid; s_live uuid;
        g uuid; batch uuid; cust uuid; o uuid;
begin
  -- ITS OWN CATEGORY, and this is not tidiness. The swap rule searches the
  -- whole category for a replacement, so borrowing the shared fixture category
  -- would let another audit's SKU win the swap whenever that audit happened to
  -- leave more stock behind — a check whose answer depends on run order, which
  -- is precisely the failure reorder-nudge.mjs was rewritten to remove.
  insert into product_categories (name, unit_uom, cost_basis)
  values ('AudStr Category', 'pcs', 'piece') returning id into v_cat;
  select id into v_brand from brands  order by created_at limit 1;
  select id into g       from godowns limit 1;

  -- One range we have stopped buying, one we still buy, same category and same
  -- (absent) size, so the swap rule has a genuine choice to make.
  insert into product_models (brand_id, category_id, name, discontinued_at)
  values (v_brand, v_cat, 'AudStr Dropped', current_date) returning id into m_dead;
  insert into product_models (brand_id, category_id, name)
  values (v_brand, v_cat, 'AudStr Kept') returning id into m_live;

  insert into variants (model_id, display_name) values (m_dead, 'AudStr Dropped') returning id into v_dead;
  insert into variants (model_id, display_name) values (m_live, 'AudStr Kept')    returning id into v_live;

  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v_dead, 'AUDSTR-DEAD-10x2', 10, 2) returning id into s_dead;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v_live, 'AUDSTR-KEPT-10x2', 10, 2) returning id into s_live;

  -- Only the KEPT one is in stock. A swap that cannot be shipped must never be
  -- offered, so the replacement has to be real.
  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_live, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_live, g, 'in', 200, 'adjustment');

  insert into customers (name, phone) values ('AudStr Stranded', '7778881') returning id into cust;

  insert into sales_orders (order_number, customer_id, status, delivered_at)
  values ('AUD-STR-1', cust, 'delivered', now() - interval '12 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_dead, 'pack', 3, 30, 100, 300);
end $$;`);

// The engine agrees before the browser is asked — so a red browser check means
// the SCREEN is wrong, not the data.
const engineRows = q1(`select count(*) from get_stranded_customers() where name = 'AudStr Stranded';`);

const list = checklist("Customers left with nothing to reorder");
list.is(Number(engineRows), 1, "the engine finds the stranded customer (fixture is sound)");

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "light" });
try {
  // Straight to the lens the dashboard deep-links to.
  await page.goto(`${BASE}/customers?lens=risk`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);

  const txt = await page.locator("body").innerText();

  list.ok(/nothing left for them to reorder/i.test(txt),
    "the At risk lens has a block for people with nothing left to reorder");
  list.ok(/AudStr Stranded/.test(txt), "and it names the customer");
  list.ok(/was buying .*AudStr Dropped/i.test(txt),
    "saying what they were buying, so the conversation has a subject");
  list.ok(/offer .*AudStr Kept/i.test(txt),
    "and what to offer instead — a replacement, not just bad news");
  list.ok(/packs in stock/i.test(txt),
    "with how much of it we hold, in PACKS");
  list.ok(!/\bpcs\b|pieces/i.test(txt), "no piece count reaches this screen");

  // The action. A work list that cannot be acted on is a report.
  const offer = page.getByRole("button", { name: /message audstr stranded on whatsapp/i }).first();
  list.ok(await offer.count() > 0, "one tap opens a draft to that customer");

  await offer.click();
  await page.waitForTimeout(1200);
  const sheet = await page.locator("body").innerText();

  // Scoped to the DRAFTS, not the whole sheet: every draft opens "Hi <name>,"
  // so they can be isolated exactly. Asserting against the sheet as a whole
  // would police the surrounding chrome, which is not what the rule is about.
  const drafts = sheet.split("\n").map((l) => l.trim()).filter((l) => /^Hi /.test(l));
  list.is(drafts.length, 3, "three drafts to choose from, as Ali asked");
  list.ok(drafts.every((l) => /AudStr Kept/.test(l)),
    "every draft leads with what we CAN send, not with what has gone");
  list.ok(drafts.every((l) => /\bwe\b/i.test(l)), "each one speaks as 'we'");
  list.ok(!drafts.some((l) => /\bI\b/.test(l)), "and none of them says 'I'");
  list.ok(!drafts.some((l) => /discontinued|no longer|stopped selling/i.test(l)),
    "none announces a loss or makes the customer feel caught out");

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

// Teardown is REPORTED, not allowed to swallow the run. The first CI run died
// here with the checks already done and never printed one of them, so a cleanup
// bug looked exactly like a broken feature. A failure to tidy up is worth
// knowing about — it leaves rows behind for the next audit — so it becomes a
// failed check rather than an exception that eats the results.
try {
  q(cleanup);
} catch (e) {
  list.ok(false, `cleanup left rows behind: ${String(e).split("\n")[0].slice(0, 150)}`);
}

finish(list.report());

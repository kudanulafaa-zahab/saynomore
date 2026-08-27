// The follow-up round never chases someone who just bought, and never goes
// quiet by accident.
//
// Ali, 2026-08-25:
//   *"In dashboard 'follow up customers' is very dumb. And the UX is terrible.
//    The card disappears when I pull down. And even when a customer in the
//    follow up orders it doesn't update. There is one customer who already
//    placed order but it is still showing."*
//
// Three complaints, three defects, all real:
//
// 1. STILL SHOWING AFTER THEY ORDERED. The queue is two halves and only one
//    ever asked whether the customer was DUE. `at_risk` is gated on the
//    ran-out / rhythm test; `stranded` was gated on nothing but "has a
//    replacement available". get_stranded_customers answers WHO has nothing
//    left to reorder — correctly — and says nothing about WHEN, so a customer
//    entered the queue the day after buying and stayed. On production:
//    Hassan Agil (ordered 1 day earlier), Chum hameed (3 days), Luhaa Ahmed
//    (10 days) were all still queued. Migration 0212 gives both halves the
//    same due test.
//
// 2. THE CARD DISAPPEARS ON REFRESH. The dashboard caught a failed fetch into
//    `[]`, and the card renders nothing for an empty queue — so a hiccup on
//    pull-to-refresh was indistinguishable from "you have nobody to follow up
//    with". For a retention list that is the worst possible lie. `null` now
//    means "could not load" and the card says so with a retry.
//
// 3. "VERY DUMB". It ranked by average order alone, so someone six weeks past
//    due outranked one who fell due this week for a slightly bigger average —
//    backwards, since the longer someone is silent past their own cycle the
//    less a message is worth. Ordered by winnability now, and the row says how
//    OVERDUE they are rather than only how long ago they last bought.
//
// Usage:  node scripts/audit/followup-freshness.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates customers and orders.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const cleanup = `
  delete from customer_followups where customer_id in (select id from customers where name like 'AudFup %');
  delete from order_payments where order_id in (select id from sales_orders where customer_id in (select id from customers where name like 'AudFup %'));
  delete from sales_order_lines where order_id in (select id from sales_orders where customer_id in (select id from customers where name like 'AudFup %'));
  delete from sales_orders where customer_id in (select id from customers where name like 'AudFup %');
  delete from customers where name like 'AudFup %';
  delete from stock_movements where sku_id in (select id from skus where internal_code like 'AUDFUP-%');
  delete from inventory_batches where sku_id in (select id from skus where internal_code like 'AUDFUP-%');
  delete from skus where internal_code like 'AUDFUP-%';
  delete from variants where model_id in (select id from product_models where name like 'AudFup %');
  delete from product_models where name like 'AudFup %';
  delete from product_categories where name = 'AudFup Category';
  delete from brands where name = 'AudFup Brand';
`;
q(cleanup);

// ── THE FIXTURE HAS TO REACH THE *STRANDED* PATH, NOT JUST ANY PATH ───────
//
// The first version of this audit built two customers who bought an arbitrary
// SKU. Both reached the queue through the `at_risk` half — which has ALWAYS had
// the due test — so removing the due test from the `stranded` half left every
// check passing. The audit was green on the very bug it was written for, and
// only the mutation run exposed it.
//
// To be STRANDED a customer must have bought, in one category, nothing but
// models that are now discontinued, and a live replacement must be in stock.
// So this builds its own category with exactly that shape: one dropped model
// the customers bought, one live model with stock to swap them onto. Its OWN
// category, like stranded.mjs, so another audit's product cannot win the swap
// and make the result depend on run order.
//
// TWO CUSTOMERS, IDENTICAL IN EVERY WAY THAT MATTERS: same product, same
// quantity, same price, both far past due. Then ONE of them buys again
// yesterday. That order is the only difference between them.
q(`
do $$
declare
  g uuid; v_cat uuid; v_brand uuid;
  m_drop uuid; m_live uuid; v_drop uuid; v_live uuid; sk_drop uuid; sk_live uuid;
  batch uuid; c_stale uuid; c_fresh uuid; o uuid; cid uuid;
begin
  select id into g from godowns limit 1;

  insert into product_categories (name, unit_uom, cost_basis)
    values ('AudFup Category', 'pcs', 'piece') returning id into v_cat;
  insert into brands (name) values ('AudFup Brand') returning id into v_brand;

  -- The model they bought, which is no longer restocked...
  insert into product_models (brand_id, category_id, name, discontinued_at)
    values (v_brand, v_cat, 'AudFup Dropped', current_date) returning id into m_drop;
  -- ...and the one they can be moved onto. Same category and size, in stock.
  insert into product_models (brand_id, category_id, name)
    values (v_brand, v_cat, 'AudFup Kept') returning id into m_live;

  insert into variants (model_id, display_name, attributes)
    values (m_drop, 'Dropped L', '{"size":"L"}'::jsonb) returning id into v_drop;
  insert into variants (model_id, display_name, attributes)
    values (m_live, 'Kept L', '{"size":"L"}'::jsonb) returning id into v_live;

  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
    values (v_drop, 'AUDFUP-DROP-L-1x4', 1, 4, 300) returning id into sk_drop;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
    values (v_live, 'AUDFUP-KEPT-L-1x4', 1, 4, 300) returning id into sk_live;

  -- The replacement must actually be on the shelf, or there is no swap to
  -- offer and get_stranded_customers returns nothing.
  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
    values (sk_live, g, 10, 40, 100, 100, 400, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
    values (batch, sk_live, g, 'in', 40, 'adjustment');

  insert into customers (name, phone) values ('AudFup Stale', '7770001') returning id into c_stale;
  insert into customers (name, phone) values ('AudFup Fresh', '7770002') returning id into c_fresh;

  -- Both bought ONLY the dropped model, twice, ending 60 days ago.
  foreach cid in array array[c_stale, c_fresh] loop
    insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
      values ('AUDFUP-A-' || cid::text, cid, 'delivered', g,
              now() - interval '75 days', now() - interval '75 days') returning id into o;
    insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
      values (o, sk_drop, 'pack', 2, 2, 300, 600);
    insert into order_payments (order_id, amount_mvr, method) values (o, 600, 'cash');

    insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
      values ('AUDFUP-B-' || cid::text, cid, 'delivered', g,
              now() - interval '60 days', now() - interval '60 days') returning id into o;
    insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
      values (o, sk_drop, 'pack', 2, 2, 300, 600);
    insert into order_payments (order_id, amount_mvr, method) values (o, 600, 'cash');
  end loop;

  -- ...and then ONE of them buys again YESTERDAY. Paid in full, so neither is
  -- excluded for owing money, and still the dropped model so both stay
  -- stranded. The recent order is the only thing separating them.
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
    values ('AUDFUP-NEW', c_fresh, 'delivered', g, now() - interval '1 day', now() - interval '1 day')
    returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
    values (o, sk_drop, 'pack', 2, 2, 300, 600);
  insert into order_payments (order_id, amount_mvr, method) values (o, 600, 'cash');
end $$;
`);

const list = checklist("The follow-up round chases only people who are actually due");

// ── 1. THE CONTROL, FIRST ─────────────────────────────────────────────────
// If the stale customer is not queued, every check below is meaningless: the
// fixture would be proving nothing rather than proving the rule.
// THE PATH, BEFORE THE RULE. If these two ever stop being STRANDED, the checks
// below would be exercising the at_risk half — which has always had the due
// test — and would pass on the very bug this file exists for. That is not a
// hypothetical: the first version of this audit did exactly that.
const strandedPath = q1(`select count(*) from get_stranded_customers()
   where name in ('AudFup Stale','AudFup Fresh') and swap_sku_id is not null;`);
list.is(strandedPath, "2",
  `both fixture customers reach the queue through the STRANDED path (${strandedPath})`);

const stale = q1(`select reason from get_followup_queue(100) where name = 'AudFup Stale';`);
list.is(stale, "stranded",
  `a customer 60 days silent and long past due IS chased, as stranded (${stale || "not queued"})`);

// ── THE COMPLAINT ITSELF ──────────────────────────────────────────────────
const fresh = q1(`select count(*) from get_followup_queue(100) where name = 'AudFup Fresh';`);
list.is(fresh, "0",
  `and the identical customer who ordered YESTERDAY is not (${fresh})`);

// The same statement over the whole real queue, which is how Ali found it:
// he did not read a rule, he saw a name he had just sold to.
const anyRecent = q1(`select coalesce(string_agg(q.name, ', '), 'none')
  from get_followup_queue(100) q
 where exists (select 1 from sales_orders so
                where so.customer_id = q.customer_id
                  and so.status not in ('draft','cancelled')
                  and so.created_at > now() - interval '7 days');`);
list.is(anyRecent, "none", `nobody in the whole queue ordered this week (${anyRecent})`);

// ── 3. RANKED BY WHO IS STILL WINNABLE ────────────────────────────────────
// Value alone put a customer six weeks gone above one who fell due this week.
const order = q1(`select coalesce(string_agg(name, ' > ' order by rn), 'empty') from (
    select name, row_number() over () as rn from get_followup_queue(3)) t;`);
const overdueSane = q1(`select count(*) from get_followup_queue(100) where overdue_days < 0;`);
list.is(overdueSane, "0", "nobody is reported as a negative number of days overdue");
list.ok(order !== "empty", `the queue is ordered and non-empty (${order.slice(0, 80)})`);

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });

try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  const body = await page.locator("body").innerText();

  list.ok(/Follow up with \d+ customer/i.test(body), "the card is on the dashboard");
  list.ok(!/didn.t load/i.test(body), "and it is NOT showing the could-not-load state on a healthy load");

  // ── 2. AND IT SAYS HOW OVERDUE, NOT ONLY HOW LONG AGO ───────────────────
  // "49 days ago" means nothing by itself: a customer who buys twice a year is
  // not late at 49 days. Opening the round is the only way to see the line.
  await page.getByRole("button", { name: /follow up with/i }).first().click();
  await page.waitForTimeout(2000);
  const sheet = await page.locator("body").innerText();
  list.ok(/past due|due about now/i.test(sheet),
    "the round says how far past DUE the customer is, which is also what the order is based on");
  list.ok(!/AudFup Fresh/.test(sheet), "and the customer who just ordered is nowhere in it");

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

try {
  q(cleanup);
} catch (e) {
  list.ok(false, `cleanup left rows behind: ${String(e).split("\n")[0].slice(0, 150)}`);
}

finish(list.report());

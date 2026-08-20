-- One list that says what to do today.
--
-- get_today unions five engines that already exist and were each tested on
-- their own. So this suite does NOT re-test them. It tests the only three
-- things the union itself can get wrong, and every one of them has already
-- gone wrong once:
--
--   1. COMPARABILITY. "MVR 5,000 owed", "MVR 700 a week of lost sales" and
--      "MVR 34,000 of dead stock" are not the same quantity. The first draft
--      sorted them by raw magnitude and real data punished it within minutes:
--      eight of the top ten rows were dead stock while the best seller being
--      OUT sat at ninth. Every row must be normalised to money at stake in
--      the next seven days before it is ranked.
--
--   2. ONE ROW PER ACTION, not per fact. Dead stock is a single decision
--      ("run a clearance"), so eleven dead products are one row. Eleven rows
--      would be eleven copies of one job crowding out ten other jobs.
--
--   3. WHAT MUST NOT REACH THE LIST AT ALL. A discontinued range running out
--      is the plan (0180), not an emergency. An order that went out this
--      morning is not an unpaid debt — the driver may still be holding the
--      cash.
--
-- Nothing here names a real product or a real customer. The fixture invents
-- its own catalogue, so what is proven is the MECHANISM.

begin;
select plan(17);

-- ── Silent when healthy ────────────────────────────────────────────────────
-- Asserted BEFORE the fixture exists, because "no rows" is the correct and
-- common answer and a list that always finds something to say becomes
-- wallpaper. The shared seed is one catalogue chain and no trading at all.
select is(
  (select count(*)::int from get_today(50)),
  0,
  'a business with nothing wrong is given nothing to do'
);

do $$
declare
  c_nap uuid; c_soap uuid; b uuid;
  m_live uuid; m_swap uuid; m_drop uuid; m_d1 uuid; m_d2 uuid;
  v_live uuid; v_swap uuid; v_drop uuid; v_d1 uuid; v_d2 uuid;
  s_live uuid; s_swap uuid; s_drop uuid; s_d1 uuid; s_d2 uuid;
  g uuid; batch uuid;
  cust uuid; o uuid;
begin
  insert into product_categories (name, unit_uom, cost_basis) values ('TD Nappies','pcs','piece')   returning id into c_nap;
  insert into product_categories (name, unit_uom, cost_basis) values ('TD Soap','bottle','piece')   returning id into c_soap;
  insert into brands (name) values ('TDBrand') returning id into b;

  -- The seller that has run out. Live, so running out is a problem.
  insert into product_models (brand_id, category_id, name) values (b, c_nap,'TD Live') returning id into m_live;
  -- The same, in a range we stopped buying. Running out is the plan.
  insert into product_models (brand_id, category_id, name, discontinued_at)
  values (b, c_nap,'TD Dropped', current_date) returning id into m_drop;
  -- Same category and same size as the dropped one, in stock: the swap that
  -- makes a stranded customer actionable.
  insert into product_models (brand_id, category_id, name) values (b, c_nap,'TD Swap')  returning id into m_swap;
  -- Two bottles nobody has ever bought: dead stock.
  insert into product_models (brand_id, category_id, name) values (b, c_soap,'TD Dead One') returning id into m_d1;
  insert into product_models (brand_id, category_id, name) values (b, c_soap,'TD Dead Two') returning id into m_d2;

  insert into variants (model_id, display_name, attributes) values (m_live,'Live M', '{"size":"M"}'::jsonb) returning id into v_live;
  insert into variants (model_id, display_name, attributes) values (m_drop,'Drop L', '{"size":"L"}'::jsonb) returning id into v_drop;
  insert into variants (model_id, display_name, attributes) values (m_swap,'Swap L', '{"size":"L"}'::jsonb) returning id into v_swap;
  insert into variants (model_id, display_name) values (m_d1,'One') returning id into v_d1;
  insert into variants (model_id, display_name) values (m_d2,'Two') returning id into v_d2;

  -- A fixed pack price everywhere, so v_skus can derive a per-piece price and
  -- the promo engine has something to discount from.
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v_live,'TD-LIVE-M-10x2',10,2,300) returning id into s_live;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v_drop,'TD-DROP-L-10x2',10,2,300) returning id into s_drop;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v_swap,'TD-SWAP-L-10x2',10,2,300) returning id into s_swap;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v_d1,'TD-DEAD1-10x2',10,2,300) returning id into s_d1;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v_d2,'TD-DEAD2-10x2',10,2,300) returning id into s_d2;

  select id into g from godowns limit 1;

  -- ── Stock ────────────────────────────────────────────────────────────────
  -- Live and dropped: received 40 days ago, sold out 10 days ago. Both end at
  -- zero pieces with real demand behind them, which is what makes them
  -- 'out' in get_sku_reorder_alerts. The ONLY difference between the two is
  -- discontinued_at — so if the discontinued one reaches the list, nothing
  -- but the filter can be to blame.
  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source, received_at)
  values (s_live, g, 10, 200, 10, 100, 200, 'direct', now() - interval '40 days') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
  values (batch, s_live, g, 'in', 200, 'adjustment', now() - interval '40 days');
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
  values (batch, s_live, g, 'out', 200, 'sales_order', now() - interval '10 days');

  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source, received_at)
  values (s_drop, g, 10, 200, 10, 100, 200, 'direct', now() - interval '40 days') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
  values (batch, s_drop, g, 'in', 200, 'adjustment', now() - interval '40 days');
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, created_at)
  values (batch, s_drop, g, 'out', 200, 'sales_order', now() - interval '10 days');

  -- Three piles that sit there: the swap and the two bottles. None has ever
  -- sold, so all three are 'dead' — which is the point of the aggregate.
  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_swap, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_swap, g, 'in', 200, 'adjustment');
  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_d1, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_d1, g, 'in', 200, 'adjustment');
  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_d2, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_d2, g, 'in', 200, 'adjustment');

  -- ── People ───────────────────────────────────────────────────────────────
  -- Owes MVR 300 since three days ago.
  insert into customers (name, phone) values ('TD Owes','7713000') returning id into cust;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
  values ('TD-1', cust, 'delivered', g, now() - interval '3 days', now() - interval '3 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_live, 'pack', 1, 10, 300, 300);

  -- Owes exactly the same, but it went out this morning. The driver may still
  -- have the cash in his pocket; chasing it today is chasing a colleague.
  insert into customers (name, phone) values ('TD Delivered Today','7713001') returning id into cust;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at)
  values ('TD-2', cust, 'delivered', g, now()) returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_live, 'pack', 1, 10, 300, 300);

  -- One pack at a time, paid for, and nothing for forty days — long past the
  -- supply they bought. TWO orders on purpose: with a single order their
  -- lifetime revenue and their average order are the same number, and the
  -- test below could not tell which one the list is using.
  insert into customers (name, phone) values ('TD Ran Out','7713002') returning id into cust;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
  values ('TD-3a', cust, 'delivered', g, now() - interval '60 days', now() - interval '60 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_live, 'pack', 1, 10, 300, 300);
  insert into order_payments (order_id, amount_mvr, method) values (o, 300, 'cash');
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
  values ('TD-3b', cust, 'delivered', g, now() - interval '40 days', now() - interval '40 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_live, 'pack', 1, 10, 300, 300);
  insert into order_payments (order_id, amount_mvr, method) values (o, 300, 'cash');

  -- Buys nothing but the dropped range. Recent enough not to be "ran out" as
  -- well, so the stranded row is the only reason they can appear.
  insert into customers (name, phone) values ('TD Stranded','7713003') returning id into cust;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
  values ('TD-4', cust, 'delivered', g, now() - interval '5 days', now() - interval '5 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_drop, 'pack', 1, 10, 300, 300);
  insert into order_payments (order_id, amount_mvr, method) values (o, 300, 'cash');
end $$;

-- ── Cash he should already have ────────────────────────────────────────────

select is(
  (select impact_mvr from get_today(50) where kind = 'owed' and title = 'TD Owes'),
  300::numeric,
  'money owed is worth exactly what is owed — it could be collected this week'
);

select is(
  (select href from get_today(50) where kind = 'owed' and title = 'TD Owes'),
  '/sales/' || (select id::text from sales_orders where customer_id =
                 (select id from customers where name = 'TD Owes')),
  'and one tap opens that order, not a module'
);

select is(
  (select count(*)::int from get_today(50) where title = 'TD Delivered Today'),
  0,
  'an order delivered this morning is not an unpaid debt yet'
);

-- ── Stock ──────────────────────────────────────────────────────────────────

select is(
  (select count(*)::int from get_today(50)
    where kind = 'stockout' and title = 'TDBrand TD Live M'),
  1,
  'a seller that has run out reaches the list'
);

-- Identical stock, identical demand, identical price. Only discontinued_at
-- differs.
select is(
  (select count(*)::int from get_today(50)
    where kind = 'stockout' and title like '%TD Dropped%'),
  0,
  'a range we stopped buying running out is the plan, never an alert'
);

-- ── The people are NOT here, and that is the point ─────────────────────────
-- 0188 moved customers due a message into the follow-up round, which can
-- actually send one. Leaving them here as well would put the same name on the
-- dashboard twice, with the weaker of the two unable to act — the exact
-- duplication Ali called out on 2026-08-12 that cost the morning briefing its
-- customer lines.
--
-- The fixture still builds a run-out customer and a stranded one, so this is a
-- real absence rather than an empty fixture agreeing with itself. What they
-- must now do instead is proven in followup_round.test.sql.
select is(
  (select count(*)::int from get_today(50)
    where title in ('TD Ran Out', 'TD Stranded')),
  0,
  'customers due a message are not ALSO on the worklist — the round owns them'
);

select is(
  (select coalesce(string_agg(distinct kind, ',' order by kind), 'none') from get_today(50)),
  'deadstock,owed,stockout',
  'what is left is the work that is not a person: money owed, stock out, capital still'
);

-- The fixture really does contain both kinds of person, so the check above is
-- an absence and not a vacuum.
select cmp_ok(
  (select count(*)::int from get_followup_queue(50)
    where name in ('TD Ran Out', 'TD Stranded')),
  '>=', 1,
  'and they really exist — they are in the follow-up queue instead'
);

-- A shelf has nobody to text, and a debtor must never be sent "are you running
-- low?" — asking for another order is how a debt becomes a bigger debt.
select is(
  (select count(*)::int from get_today(50) where phone is not null),
  0,
  'nothing left on the worklist offers a message, because nothing left is a person'
);

-- ── Money sitting still ────────────────────────────────────────────────────

select is(
  (select count(*)::int from get_today(50) where kind = 'deadstock'),
  1,
  'every dead product is ONE row, because a clearance is one decision'
);

-- The guard on the test above: if the fixture only ever had one dead product,
-- "exactly one row" would pass no matter what the function did.
select cmp_ok(
  (select count(*)::int from get_promo_suggestions()),
  '>', 1,
  'and the fixture really does hold more than one dead product'
);

select is(
  (select impact_mvr from get_today(50) where kind = 'deadstock'),
  (select round(sum(coalesce(p.stock_pieces,0) * coalesce(p.promo_pack_mvr,0)
                    / nullif(p.pcs_per_pack,0)) / 13.0, 2)
     from get_promo_suggestions() p),
  'a pile of capital is valued over a quarter — clearing it is months of work'
);

-- The whole point of that quarter. Raw magnitude would put MVR 6,660 of
-- stagnant stock above a best seller being out, which is how the first
-- version of this list ranked itself and why it was wrong.
select cmp_ok(
  (select impact_mvr from get_today(50) where kind = 'stockout' and title = 'TDBrand TD Live M'),
  '>',
  (select impact_mvr from get_today(50) where kind = 'deadstock'),
  'so a seller being out outranks a bigger pile of stock that is not moving'
);

-- ── It stays a worklist ────────────────────────────────────────────────────
-- Five kinds are live in the fixture, so the cap is doing real work here.
select is(
  (select count(*)::int from get_today(2)),
  2,
  'capped, because a list that is always long stops being read'
);

-- ── Every row goes somewhere that exists ───────────────────────────────────
-- The dead-stock row shipped pointing at /market, which is not a route: the
-- module is CALLED Market and lives at /competitors. A 404 is invisible in
-- SQL and invisible in review — a browser prefetching the link and never
-- coming back is what found it. So the routes are named here, where a rename
-- has to be deliberate.
select is(
  (select array_agg(distinct h order by h)
     from (select regexp_replace(href, '^(/[a-z-]+).*$', '\1') as h from get_today(50)) x),
  array['/competitors','/reorder','/sales'],
  'every row lands on a route this app actually has'
);

-- ── Least privilege (0169's lesson: check the grant, do not assume it) ──────
select is(
  (select has_function_privilege('anon', 'public.get_today(integer)', 'execute')),
  false,
  'anon cannot read the worklist'
);

select * from finish();
rollback;

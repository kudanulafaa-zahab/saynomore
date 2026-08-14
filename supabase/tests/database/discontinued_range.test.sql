-- Discontinued is not inactive.
--
-- Getting this backwards costs real money in both directions, which is why it
-- is tested from both sides rather than just "the dead line is gone":
--
--   * propose BUYING a range that will never be restocked  -> a wasted container
--   * hide a discontinued range from stock and clearance   -> 281 packs stranded
--
-- So the suite asserts a SPLIT, not a filter. get_reorder_suggestions (a
-- purchase order) must not see it; get_sku_reorder_alerts (stock health, which
-- the Promo Advisor reads to find slow movers) must still see it.
--
-- The other half is the customers. Someone whose entire history in a category
-- is ranges we have stopped buying has nothing left to bring them back, and on
-- a ~9-day repurchase clock they leave silently. Those are found per CATEGORY,
-- not per customer: buying a detergent we still stock does not make a dropped
-- nappy line come back.
--
-- Nothing here names a real product. The fixture invents its own brands and
-- categories, so the suite proves the MECHANISM — which is what has to keep
-- working when the next range is dropped, in a category that may have no sizes
-- at all.

begin;
select plan(12);

do $$
declare v_cat uuid; v_other uuid; v_bA uuid; v_bB uuid;
        m_dead uuid; m_live uuid; m_liveB uuid; m_other uuid;
        v_dead uuid; v_live uuid; v_liveB uuid; v_oth uuid;
        s_dead uuid; s_live uuid; s_liveB uuid; s_oth uuid;
        g uuid; batch uuid; c_stranded uuid; c_mixed uuid; c_percat uuid; o uuid;
begin
  insert into product_categories (name, unit_uom, cost_basis)
  values ('DC Nappies', 'pcs', 'piece') returning id into v_cat;
  insert into product_categories (name, unit_uom, cost_basis)
  values ('DC Soap', 'bottle', 'piece') returning id into v_other;

  insert into brands (name) values ('DCBrandA') returning id into v_bA;
  insert into brands (name) values ('DCBrandB') returning id into v_bB;

  -- Same brand, same category, same size: one dropped, one kept. That pairing
  -- is what lets the swap prove it prefers the customer's own brand.
  insert into product_models (brand_id, category_id, name, discontinued_at)
  values (v_bA, v_cat, 'DC Dropped', current_date) returning id into m_dead;
  insert into product_models (brand_id, category_id, name)
  values (v_bA, v_cat, 'DC Kept')  returning id into m_live;
  insert into product_models (brand_id, category_id, name)
  values (v_bB, v_cat, 'DC Rival') returning id into m_liveB;
  insert into product_models (brand_id, category_id, name)
  values (v_bA, v_other, 'DC Bottle') returning id into m_other;

  insert into variants (model_id, display_name, attributes)
  values (m_dead, 'Dropped L', '{"size":"L"}'::jsonb) returning id into v_dead;
  insert into variants (model_id, display_name, attributes)
  values (m_live, 'Kept L', '{"size":"L"}'::jsonb) returning id into v_live;
  insert into variants (model_id, display_name, attributes)
  values (m_liveB, 'Rival L', '{"size":"L"}'::jsonb) returning id into v_liveB;
  insert into variants (model_id, display_name, attributes)
  values (m_other, 'Bottle', '{}'::jsonb) returning id into v_oth;

  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v_dead,  'DC-DEAD-L-10x2', 10, 2) returning id into s_dead;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v_live,  'DC-KEPT-L-10x2', 10, 2) returning id into s_live;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v_liveB, 'DC-RIVAL-L-10x2', 10, 2) returning id into s_liveB;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton)
  values (v_oth,   'DC-BOTTLE-1x6', 1, 6) returning id into s_oth;

  select id into g from godowns limit 1;

  -- Stock for all three nappy SKUs, so the swap is choosing on brand and not
  -- merely taking the only thing available.
  -- 10 pieces a pack, 2 packs a carton -> 200 pieces is 10 cartons. All three
  -- landed-cost columns are NOT NULL, so all three are supplied.
  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_dead, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_dead, g, 'in', 200, 'adjustment');

  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_live, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_live, g, 'in', 200, 'adjustment');

  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_liveB, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_liveB, g, 'in', 200, 'adjustment');

  -- Three customers: one only ever bought the dropped line, one buys the
  -- dropped line AND a kept one, one is dead on nappies but alive on soap.
  insert into customers (name, phone) values ('DC Stranded', '9990001') returning id into c_stranded;
  insert into customers (name, phone) values ('DC Mixed',    '9990002') returning id into c_mixed;
  insert into customers (name, phone) values ('DC PerCat',   '9990003') returning id into c_percat;

  insert into sales_orders (order_number, customer_id, status, delivered_at)
  values ('DC-1', c_stranded, 'delivered', now() - interval '10 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_dead, 'pack', 3, 30, 100, 300);

  insert into sales_orders (order_number, customer_id, status, delivered_at)
  values ('DC-2', c_mixed, 'delivered', now() - interval '10 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_dead, 'pack', 1, 10, 100, 100);
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_live, 'pack', 1, 10, 100, 100);

  insert into sales_orders (order_number, customer_id, status, delivered_at)
  values ('DC-3', c_percat, 'delivered', now() - interval '10 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_dead, 'pack', 2, 20, 100, 200);
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_oth, 'piece', 6, 6, 50, 300);
end $$;

-- ── The split: purchasing stops, watching does not ──────────────────────────

select is(
  (select count(*)::int from get_reorder_suggestions()
    where internal_code = 'DC-DEAD-L-10x2'),
  0,
  'a discontinued range is never proposed for purchase'
);

select is(
  (select count(*)::int from get_reorder_suggestions()
    where internal_code = 'DC-KEPT-L-10x2'),
  1,
  'and the range we kept still is — the filter is not just switching it off'
);

select is(
  (select count(*)::int from get_sku_reorder_alerts() a
     join skus s on s.id = a.sku_id where s.internal_code = 'DC-DEAD-L-10x2'),
  1,
  'stock health still reports it, so remaining stock can be watched and cleared'
);

-- Callers invoke this with no arguments. CREATE OR REPLACE silently dropping
-- the parameter defaults would break every one of them.
select is(
  (select count(*) >= 0 from get_reorder_suggestions()),
  true,
  'get_reorder_suggestions is still callable with no arguments'
);

-- ── Who is stranded ─────────────────────────────────────────────────────────

select is(
  (select count(*)::int from get_stranded_customers() where name = 'DC Stranded'),
  1,
  'a customer whose whole history is a dropped range is surfaced'
);

select is(
  (select count(*)::int from get_stranded_customers() where name = 'DC Mixed'),
  0,
  'a customer who also buys a range we kept is not — they have a reason to return'
);

select is(
  (select count(*)::int from get_stranded_customers() where name = 'DC PerCat'),
  1,
  'stranded is judged per category: buying soap does not replace a dropped nappy'
);

select is(
  (select category from get_stranded_customers() where name = 'DC PerCat'),
  'DC Nappies',
  'and it names the category they are stranded in, not the one they are fine in'
);

-- ── The replacement offered ─────────────────────────────────────────────────

select is(
  (select swap_label from get_stranded_customers() where name = 'DC Stranded'),
  'DCBrandA DC Kept L',
  'the swap keeps their brand and their size when both are in stock'
);

select is(
  (select packs_bought from get_stranded_customers() where name = 'DC Stranded'),
  3.0::numeric,
  'what they bought is reported in PACKS, never pieces'
);

-- Take the same-brand replacement off the shelf. The offer must move to the
-- rival rather than recommending something that cannot be shipped.
do $$
declare s_live uuid; g uuid; batch uuid;
begin
  select id into s_live from skus where internal_code = 'DC-KEPT-L-10x2';
  select godown_id into g from stock_movements where sku_id = s_live limit 1;
  select id into batch from inventory_batches where sku_id = s_live limit 1;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_live, g, 'out', 200, 'adjustment');
end $$;

select is(
  (select swap_label from get_stranded_customers() where name = 'DC Stranded'),
  'DCBrandB DC Rival L',
  'with their own brand out of stock the offer moves to one we can actually ship'
);

-- ── Least privilege (0169's lesson: check the grant, do not assume it) ──────
select is(
  (select has_function_privilege('anon', 'public.get_stranded_customers()', 'execute')),
  false,
  'anon cannot read the customer list'
);

select * from finish();
rollback;

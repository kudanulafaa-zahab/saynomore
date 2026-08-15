-- The cheapest sale is the one already going out the door.
--
-- 55 customers buy nappies, 19 buy detergent, and not one buys both. Across 101
-- orders not a single basket holds two categories. A bottle added to a nappy
-- order already being packed costs nothing to win — no advert, no new customer,
-- no second delivery.
--
-- A suggestion the APP volunteers carries more risk than one a person makes,
-- because Ali will trust it at the till without checking. So almost every test
-- here is about what it must REFUSE to say: something they already buy,
-- something not on that shelf, something being discontinued, something sold at
-- a loss, something already in the basket.
--
-- Ranked by popularity rather than affinity on purpose. With zero
-- co-occurrence, every affinity score is zero and the ranking would be noise
-- wearing a statistics costume. That is a decision, and 0183's header explains
-- when to revisit it.

begin;
select plan(10);

do $$
declare
  c_nappy uuid; c_soap uuid; c_dead uuid;
  b uuid; m_nappy uuid; m_soap uuid; m_loss uuid; m_dropped uuid;
  v1 uuid; v2 uuid; v3 uuid; v4 uuid;
  s_nappy uuid; s_soap uuid; s_loss uuid; s_dropped uuid;
  g uuid; g_other uuid; batch uuid; cust uuid; o uuid;
begin
  insert into product_categories (name, unit_uom, cost_basis) values ('XS Nappies','pcs','piece') returning id into c_nappy;
  insert into product_categories (name, unit_uom, cost_basis) values ('XS Soap','bottle','piece') returning id into c_soap;
  insert into product_categories (name, unit_uom, cost_basis) values ('XS Dead','pcs','piece') returning id into c_dead;
  insert into brands (name) values ('XSBrand') returning id into b;

  insert into product_models (brand_id, category_id, name) values (b, c_nappy,'XS Nappy') returning id into m_nappy;
  insert into product_models (brand_id, category_id, name) values (b, c_soap, 'XS Soap')  returning id into m_soap;
  -- Same (unbought) category as the soap, but priced below cost.
  insert into product_models (brand_id, category_id, name) values (b, c_soap, 'XS Loss')  returning id into m_loss;
  insert into product_models (brand_id, category_id, name, discontinued_at)
  values (b, c_dead, 'XS Dropped', current_date) returning id into m_dropped;

  insert into variants (model_id, display_name) values (m_nappy,'N')  returning id into v1;
  insert into variants (model_id, display_name) values (m_soap,'S')   returning id into v2;
  insert into variants (model_id, display_name) values (m_loss,'L')   returning id into v3;
  insert into variants (model_id, display_name) values (m_dropped,'D') returning id into v4;

  -- Prices are fixed per pack so v_skus can derive a per-piece price.
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v1,'XS-NAPPY-10x2',10,2, 300) returning id into s_nappy;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v2,'XS-SOAP-10x2',10,2, 300) returning id into s_soap;
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v3,'XS-LOSS-10x2',10,2, 50)  returning id into s_loss;   -- 5/pc, cost 10
  insert into skus (variant_id, internal_code, pcs_per_pack, packs_per_carton, fixed_price_per_pack_mvr)
  values (v4,'XS-DROPPED-10x2',10,2, 300) returning id into s_dropped;

  select id into g from godowns limit 1;
  insert into godowns (name) values ('XS Far Godown') returning id into g_other;

  -- Everything in stock in `g`, at MVR 10 a piece, EXCEPT the soap's twin which
  -- sits in the far godown so "wrong warehouse" can be tested separately.
  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_soap, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_soap, g, 'in', 200, 'adjustment');

  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_loss, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_loss, g, 'in', 200, 'adjustment');

  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_dropped, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_dropped, g, 'in', 200, 'adjustment');

  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values (s_nappy, g, 10, 200, 10, 100, 200, 'direct') returning id into batch;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (batch, s_nappy, g, 'in', 200, 'adjustment');

  -- A customer who buys NAPPIES only.
  insert into customers (name, phone) values ('XS Nappy Buyer','7712900') returning id into cust;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at)
  values ('XS-1', cust, 'delivered', g, now() - interval '5 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, s_nappy, 'pack', 1, 10, 300, 300);
end $$;

-- The order number is NOT a handle: trg_assign_sales_order_number rewrites
-- whatever the INSERT supplies, so matching on it silently finds nothing and
-- every assertion below would pass vacuously against a NULL warehouse. The
-- warehouse is looked up through the customer instead.

-- ── What it offers ─────────────────────────────────────────────────────────

select is(
  (select get_cross_sell_suggestion(
     (select id from customers where name = 'XS Nappy Buyer'),
     (select so.source_godown_id from sales_orders so join customers c on c.id=so.customer_id where c.name='XS Nappy Buyer' limit 1)) ->> 'label'),
  'XSBrand XS Soap · S',
  'a nappy buyer is offered the category they have never bought'
);

select is(
  (select get_cross_sell_suggestion(
     (select id from customers where name = 'XS Nappy Buyer'),
     (select so.source_godown_id from sales_orders so join customers c on c.id=so.customer_id where c.name='XS Nappy Buyer' limit 1)) ->> 'packs_on_hand'),
  '20',
  'with how many PACKS are on that shelf, never a piece count'
);

select is(
  (select get_cross_sell_suggestion(
     (select id from customers where name = 'XS Nappy Buyer'),
     (select so.source_godown_id from sales_orders so join customers c on c.id=so.customer_id where c.name='XS Nappy Buyer' limit 1)) ->> 'price_mvr'),
  '300',
  'and the price of the unit it is actually sold in'
);

-- ── What it REFUSES to offer ───────────────────────────────────────────────

select isnt(
  (select get_cross_sell_suggestion(
     (select id from customers where name = 'XS Nappy Buyer'),
     (select so.source_godown_id from sales_orders so join customers c on c.id=so.customer_id where c.name='XS Nappy Buyer' limit 1)) ->> 'category'),
  'XS Nappies',
  'never a category they already buy — that is a reorder nudge, not a cross-sell'
);

select isnt(
  (select get_cross_sell_suggestion(
     (select id from customers where name = 'XS Nappy Buyer'),
     (select so.source_godown_id from sales_orders so join customers c on c.id=so.customer_id where c.name='XS Nappy Buyer' limit 1)) ->> 'label'),
  'XSBrand XS Loss · L',
  'never something sold below cost — a volunteered loss is the worst kind'
);

select isnt(
  (select get_cross_sell_suggestion(
     (select id from customers where name = 'XS Nappy Buyer'),
     (select so.source_godown_id from sales_orders so join customers c on c.id=so.customer_id where c.name='XS Nappy Buyer' limit 1)) ->> 'category'),
  'XS Dead',
  'never a range being discontinued — winning someone onto it is worse than not'
);

-- Already in the basket: the only remaining candidate in that category is the
-- below-cost one, so the honest answer becomes nothing at all.
select is(
  (select get_cross_sell_suggestion(
     (select id from customers where name = 'XS Nappy Buyer'),
     (select so.source_godown_id from sales_orders so join customers c on c.id=so.customer_id where c.name='XS Nappy Buyer' limit 1),
     array[(select id from skus where internal_code = 'XS-SOAP-10x2')])),
  null,
  'nothing already in the basket is suggested again'
);

-- Wrong warehouse: the whole saving is that it travels in a box already going
-- out, so stock somewhere else is not an offer.
select is(
  (select get_cross_sell_suggestion(
     (select id from customers where name = 'XS Nappy Buyer'),
     (select id from godowns where name = 'XS Far Godown'))),
  null,
  'stock in a different warehouse is never offered — it would be a second delivery'
);

-- A customer who has bought from every stocked category has nothing to be
-- offered, and the function says so rather than reaching for filler.
do $$
declare cust uuid; g uuid; o uuid;
begin
  select id into g from godowns where name <> 'XS Far Godown' limit 1;
  insert into customers (name, phone) values ('XS Buys Both','7712901') returning id into cust;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at)
  values ('XS-2', cust, 'delivered', g, now() - interval '4 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  select o, s.id, 'pack', 1, 10, 300, 300 from skus s where s.internal_code = 'XS-NAPPY-10x2';
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  select o, s.id, 'pack', 1, 10, 300, 300 from skus s where s.internal_code = 'XS-SOAP-10x2';
end $$;

select is(
  (select get_cross_sell_suggestion(
     (select id from customers where name = 'XS Buys Both'),
     (select so.source_godown_id from sales_orders so join customers c on c.id=so.customer_id where c.name='XS Buys Both' limit 1)) is null),
  true,
  'a customer who already buys everything stocked gets no suggestion at all'
);

-- ── Least privilege (0169's lesson: check the grant, do not assume it) ──────
select is(
  (select has_function_privilege('anon', 'public.get_cross_sell_suggestion(uuid,uuid,uuid[])', 'execute')),
  false,
  'anon cannot read the suggestion'
);

select * from finish();
rollback;

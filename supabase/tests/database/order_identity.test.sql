-- An order carries its own customer's name.
--
-- Ali, 2026-08-15: "When a new customer is created by selecting WhatsApp it
-- shows as walk-in customer. There's no name on display. When I click and go
-- back the name appears."
--
-- The Sales list used to look the name up in a separately cached list of
-- customers, so "Walk-in" was printed for two different things: an order with
-- no customer, and an order whose customer had not been downloaded yet. Those
-- are not the same fact and must never render the same way — who owes money is
-- read off that screen.
--
-- The invariant this file exists to hold is one line:
--
--     customer_name IS NULL  if and only if  customer_id IS NULL
--
-- Everything below is a way of failing when that stops being true.

begin;
select plan(7);

do $$
declare c uuid; g uuid; s uuid; ppk int; o1 uuid; o2 uuid;
begin
  insert into customers (name, phone, channel)
  values ('OI Named Buyer', '7712001', 'whatsapp') returning id into c;

  select id into g from godowns limit 1;
  select id, pcs_per_pack into s, ppk from skus order by internal_code limit 1;

  -- One order WITH a customer, one genuinely without: the two cases that used
  -- to be indistinguishable.
  insert into sales_orders (order_number, customer_id, status, source_godown_id)
  values ('OI-1', c, 'confirmed', g) returning id into o1;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o1, s, 'pack', 1, ppk, 100, 100);

  insert into sales_orders (order_number, customer_id, status, source_godown_id)
  values ('OI-2', null, 'confirmed', g) returning id into o2;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o2, s, 'pack', 1, ppk, 100, 100);
end $$;

-- The order number is rewritten by trg_assign_sales_order_number, so rows are
-- found by customer rather than by the number handed to the INSERT.
select is(
  (select customer_name from get_sales_orders()
    where customer_id = (select id from customers where name = 'OI Named Buyer')),
  'OI Named Buyer',
  'an order carries its customer''s name, with no second lookup'
);

select is(
  (select customer_phone from get_sales_orders()
    where customer_id = (select id from customers where name = 'OI Named Buyer')),
  '7712001',
  'and their phone, so the row can still offer to message them'
);

-- Counted rather than selected: there can legitimately be several orders with
-- no customer, and a bare scalar subquery over them errors instead of failing.
select is(
  (select count(*)::int from get_sales_orders(p_limit := 100)
    where customer_id is null and customer_name is not null),
  0,
  'an order with NO customer returns no name — the only thing "Walk-in" may mean'
);

-- The invariant itself, stated over every order rather than the two above.
select is(
  (select count(*)::int from get_sales_orders(p_limit := 100)
    where (customer_id is null) <> (customer_name is null)),
  0,
  'name is absent exactly when the customer is absent — never for any other reason'
);

-- A renamed customer must follow the order. If the name were ever copied onto
-- sales_orders instead of joined, this is the test that would catch it.
update customers set name = 'OI Renamed Buyer' where name = 'OI Named Buyer';
select is(
  (select customer_name from get_sales_orders()
    where customer_id = (select id from customers where name = 'OI Renamed Buyer')),
  'OI Renamed Buyer',
  'renaming a customer renames them on their orders — the name is joined, not copied'
);

-- Search still works: the join it depends on is the same one now being selected
-- from, so a change to one must not quietly break the other.
select is(
  (select count(*)::int from get_sales_orders(p_search := 'OI Renamed')),
  1,
  'searching by customer name still finds the order'
);

select is(
  (select has_function_privilege('anon',
     'public.get_sales_orders(text,text,boolean,uuid,timestamptz,uuid,integer)', 'execute')),
  false,
  'anon cannot read the order list'
);

select * from finish();
rollback;

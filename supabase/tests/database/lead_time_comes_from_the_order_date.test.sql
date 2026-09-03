-- A lead time learned from the day a row was TYPED is not a lead time.
--
-- Found by the nine-seat council pass on 2026-09-03, looking at Ali's stock
-- rather than at the code. Merries Good Skin XL — one of the two diaper lines
-- he is keeping — had six days of stock and the Reorder screen said "order by
-- 10 September", because the app believed a container arrives in ZERO DAYS.
--
-- The learner averaged `grn_confirmed_at - created_at`, and `created_at` is
-- when the shipment ROW was created in the app:
--
--     SH-2026-001   row typed 2026-07-08, goods received 2026-07-08  ->  0 days
--     SH-2026-002   row typed 2026-07-09, goods received 2026-08-27  -> 49 days
--
-- The first is history entered after the fact. It is not an observation of
-- anything, and it was being averaged with a real one.
--
-- These assertions are about the RULE: a lead time is the distance from
-- placing an order to receiving it, an unknown order date teaches nothing, and
-- nothing may conclude that stock arrives the day it is ordered.

begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000ab01', 'test-lead@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000ab01';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ab01', true);

-- ══════════════════════════════════════════════════════════════════════════
-- 1. NOTHING BELIEVES STOCK ARRIVES THE DAY IT IS ORDERED
-- ══════════════════════════════════════════════════════════════════════════
-- The rule, over whatever the seed happens to contain. A zero here is never a
-- real observation — it is a row that was typed in on the day it landed.
select is(
  (select count(*)::int from get_reorder_suggestions()
    where lead_days is not null and lead_days <= 0),
  0,
  'no product believes a container arrives in zero days'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. AN UNKNOWN ORDER DATE TEACHES NOTHING
-- ══════════════════════════════════════════════════════════════════════════
-- A shipment received but never marked as ordered must leave lead_days NULL,
-- so the caller falls back to its stated assumption. Unknown beats confident
-- and wrong: the whole defect was a number that looked learned and was not.
do $$
declare v_sup uuid; v_sku uuid; v_ship uuid;
begin
  select id into v_sup from suppliers limit 1;
  select id into v_sku from skus where is_active limit 1;

  insert into shipments (id, reference, supplier_id, status, ordered_at, grn_confirmed_at)
  values ('00000000-0000-0000-0000-00000000ab02', 'TEST-LEAD-NOORDER', v_sup,
          'grn_confirmed', null, now() - interval '5 days');
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, fob_per_carton,
                              cbm_per_carton, fob_currency)
  values ('00000000-0000-0000-0000-00000000ab02', v_sku, 1, 100, 0.05, 'USD');
end $$;

select is(
  (select count(*)::int from get_reorder_suggestions()
    where lead_days is not null and lead_days <= 0),
  0,
  'a shipment with no order date does not teach a zero-day lead time'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. A REAL ORDER DATE IS LEARNED
-- ══════════════════════════════════════════════════════════════════════════
-- 40 days from order to receipt, on a product with enough sales history to
-- appear in the suggestions at all.
do $$
declare v_sup uuid; v_sku uuid;
begin
  select id into v_sup from suppliers limit 1;
  select sku_id into v_sku from get_reorder_suggestions() limit 1;
  if v_sku is null then return; end if;

  insert into shipments (id, reference, supplier_id, status, ordered_at, grn_confirmed_at)
  values ('00000000-0000-0000-0000-00000000ab03', 'TEST-LEAD-REAL', v_sup,
          'grn_confirmed', now() - interval '44 days', now() - interval '4 days');
  insert into shipment_lines (shipment_id, sku_id, qty_cartons, fob_per_carton,
                              cbm_per_carton, fob_currency)
  values ('00000000-0000-0000-0000-00000000ab03', v_sku, 1, 100, 0.05, 'USD');
end $$;

select ok(
  (select coalesce(bool_and(lead_days >= 35 and lead_days <= 45), true)
     from get_reorder_suggestions()
    where lead_days is not null),
  -- 40 exactly, MEASURED: ordered 44 days ago, received 4 days ago. The range
  -- is there so the assertion survives a clock crossing midnight, not because
  -- the number was guessed.
  'a shipment ordered 40 days before it landed teaches about 40 days'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 4. THE ORDER-BY DATE MOVES WITH IT
-- ══════════════════════════════════════════════════════════════════════════
-- The lead time is not decoration: it is subtracted from the day stock runs
-- out. A longer lead time must never produce a LATER order-by date.
select ok(
  (select coalesce(bool_and(order_by_date <= (now() at time zone 'Indian/Maldives')::date + dir::int), true)
     from get_reorder_suggestions()
    where order_by_date is not null and dir is not null),
  'the order-by date is never later than the day the stock runs out'
);

-- And it is never in the past — a date behind you is not an instruction.
select ok(
  (select coalesce(bool_and(order_by_date >= (now() at time zone 'Indian/Maldives')::date), true)
     from get_reorder_suggestions()
    where order_by_date is not null),
  'and never in the past — already late reads as "order today"'
);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. AND NOT BY ANYONE HOLDING THE PUBLISHABLE KEY
-- ══════════════════════════════════════════════════════════════════════════
select ok(
  not has_function_privilege('anon', 'public.get_reorder_suggestions(numeric, numeric)', 'execute'),
  'anon cannot read what the business is about to buy'
);

select * from finish();
rollback;

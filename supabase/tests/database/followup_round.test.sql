-- The follow-up round: an app that acts, not one that waits to be read.
--
-- 55 of Ali's 81 customers bought once. A customer who comes back is worth
-- MVR 1,098 against MVR 485 for one who does not, and the 26 who repeat produce
-- 52% of the revenue. The median gap between orders is 14 days.
--
-- The app has known who was due a second order for months. What it could not do
-- was act: following up meant Ali remembering to open a screen. This makes it a
-- QUEUE that remembers what it did and can be asked whether it worked.
--
-- WHAT THIS FILE GUARDS. Three things, and each one is what turns a helpful
-- nudge into an annoyance if it breaks:
--
--   * NOBODY IS CHASED TWICE IN A WEEK. Without the cooldown the same three
--     names come back every morning and the feature is dead inside a fortnight
--     — which is precisely how the old "Worth a call" briefing line died.
--   * A SKIP IS A DECISION. He looked at them and said not today. Asking again
--     tomorrow ignores him, so a skip holds the cooldown exactly like a send.
--   * SOMEBODY WHO HAS JUST ORDERED IS LEFT ALONE — and by the insights engine
--     already thinking so, not by a rule of its own. A first draft added one,
--     a mutation survived against it, and it turned out to be both redundant
--     and harmful. That story is at the check itself.
--
-- And the fourth, which is why the feature exists at all: it must be possible
-- to ASK whether it worked. A round that cannot be measured cannot be improved
-- and cannot honestly be defended either.

begin;
select plan(16);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c0', 'test-followup@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c0';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c0', true);

-- Two customers who each bought ONE pack, long enough ago to be past the supply
-- they bought. Different amounts, so the "richest first" ordering is
-- observable rather than a coin toss.
do $$
declare g uuid; c1 uuid; c2 uuid; o uuid; b uuid;
begin
  select id into g from godowns limit 1;

  insert into inventory_batches (sku_id, godown_id, qty_cartons_received, qty_pieces_received,
                                 landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr, source)
  values ('00000000-0000-0000-0000-000000000005', g, 10, 1020, 5, 170, 510, 'direct') returning id into b;
  insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type)
  values (b, '00000000-0000-0000-0000-000000000005', g, 'in', 1020, 'direct_receipt');

  insert into customers (name, phone) values ('FU Zoya Big', '7714001') returning id into c1;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
  values ('FU-1', c1, 'delivered', g, now() - interval '45 days', now() - interval '45 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, '00000000-0000-0000-0000-000000000005', 'pack', 1, 34, 900, 900);

  insert into customers (name, phone) values ('FU Anna Small', '7714002') returning id into c2;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
  values ('FU-2', c2, 'delivered', g, now() - interval '45 days', now() - interval '45 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, '00000000-0000-0000-0000-000000000005', 'pack', 1, 34, 200, 200);

  -- Somebody with no number at all. A message cannot be sent, so putting them
  -- in a send-or-skip queue is asking him to decide about nothing.
  insert into customers (name, phone) values ('FU No Phone', null) returning id into c2;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
  values ('FU-3', c2, 'delivered', g, now() - interval '45 days', now() - interval '45 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, '00000000-0000-0000-0000-000000000005', 'pack', 1, 34, 500, 500);

  -- Everybody here PAID. A customer who still owes money is a different job —
  -- chase the debt, not another order — and the check for that is below.
  --
  -- Keyed on the CUSTOMER, never the order number: trg_assign_sales_order_number
  -- rewrites whatever the INSERT supplies, so `like 'FU-%'` matches nothing and
  -- the payments silently never happen. cross_sell.test.sql carries the same
  -- warning and this file still walked into it.
  insert into order_payments (order_id, amount_mvr, method)
  select so.id, sum(sol.line_total_mvr), 'cash'
  from sales_orders so
  join sales_order_lines sol on sol.order_id = so.id
  join customers c on c.id = so.customer_id
  where c.name in ('FU Zoya Big', 'FU Anna Small', 'FU No Phone')
  group by so.id;
end $$;

-- ── Who is in the round ────────────────────────────────────────────────────

select is(
  (select count(*)::int from get_followup_queue(50) where name = 'FU Zoya Big'),
  1,
  'a customer past the supply they bought is due a message'
);

-- ASSERTED AS SORTEDNESS, not as "who is first". A first draft checked that
-- one named customer came before the other, and a mutation that re-sorted the
-- queue ALPHABETICALLY survived it — because "Big" happens to precede "Small".
-- The names now oppose the money order (Anna is the cheap one, Zoya the dear
-- one) and the check reads the property itself: every row is worth at least as
-- much as the one after it.
select is(
  (select coalesce(bool_and(a >= b), true)
     from (select avg_order_mvr as a, lead(avg_order_mvr) over () as b
             from get_followup_queue(50)) x
    where b is not null),
  true,
  'the queue is ordered by what is at stake — richest conversation first'
);

select is(
  (select count(*)::int from get_followup_queue(50) where name = 'FU No Phone'),
  0,
  'somebody with no number is never queued — there is no message to send'
);

select is(
  (select reason from get_followup_queue(50) where name = 'FU Zoya Big'),
  'ran_out',
  'the queue says WHY, because the message depends on it'
);

-- ── A debtor is chased for the money, not for another order ────────────────
-- The same rule 0184 applied to the worklist, where an unpaid invoice carries
-- no phone number on purpose. Found by an audit whose fixture customer owed
-- MVR 5,000 and was queued for a top-up anyway.
do $$
declare g uuid; c uuid; o uuid;
begin
  select id into g from godowns limit 1;
  insert into customers (name, phone) values ('FU Owes Money', '7714003') returning id into c;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
  values ('FU-5', c, 'delivered', g, now() - interval '45 days', now() - interval '45 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, '00000000-0000-0000-0000-000000000005', 'pack', 1, 34, 700, 700);
end $$;

select is(
  (select count(*)::int from get_followup_queue(50) where name = 'FU Owes Money'),
  0,
  'somebody who still owes money is not asked to buy more'
);

-- And once they have paid, they are an ordinary customer again.
do $$
begin
  insert into order_payments (order_id, amount_mvr, method)
  values ((select id from sales_orders
             where customer_id = (select id from customers where name = 'FU Owes Money') limit 1),
          700, 'cash');
end $$;

select is(
  (select count(*)::int from get_followup_queue(50) where name = 'FU Owes Money'),
  1,
  'and once the debt is settled they are due a message like anyone else'
);

-- ── It remembers ───────────────────────────────────────────────────────────

select isnt(
  (select log_customer_followup(
     (select id from customers where name = 'FU Zoya Big'),
     'ran_out', 'sent', 'deliver')),
  null,
  'a follow-up can be recorded'
);

select is(
  (select count(*)::int from get_followup_queue(50) where name = 'FU Zoya Big'),
  0,
  'and they drop out of the round — nobody is chased twice in a week'
);

-- A SKIP IS A DECISION. He looked at them and said not today.
select isnt(
  (select log_customer_followup(
     (select id from customers where name = 'FU Anna Small'),
     'ran_out', 'skipped', null)),
  null,
  'a skip is recorded too'
);

select is(
  (select count(*)::int from get_followup_queue(50) where name = 'FU Anna Small'),
  0,
  'and holds the cooldown exactly like a send, because skipping is an answer'
);

-- ── Eight days later, they are due again ───────────────────────────────────
-- The cooldown expires; it does not retire anyone permanently.
do $$
begin
  update customer_followups set created_at = now() - interval '8 days'
  where customer_id = (select id from customers where name = 'FU Zoya Big');
end $$;

select is(
  (select count(*)::int from get_followup_queue(50) where name = 'FU Zoya Big'),
  1,
  'a week later they are due again — the cooldown expires, it does not retire'
);

-- ── Somebody who answered is left alone ────────────────────────────────────
do $$
declare g uuid; o uuid;
begin
  select id into g from godowns limit 1;
  insert into sales_orders (order_number, customer_id, status, source_godown_id, delivered_at, created_at)
  values ('FU-4', (select id from customers where name = 'FU Zoya Big'),
          'delivered', g, now() - interval '2 days', now() - interval '2 days') returning id into o;
  insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
  values (o, '00000000-0000-0000-0000-000000000005', 'pack', 1, 34, 900, 900);
end $$;

-- No special rule does this: they ordered two days ago, so the insights engine
-- no longer considers them at risk and they simply are not due. That matters,
-- because a first draft DID add a special rule — "exclude anyone who ordered
-- since any follow-up in the last 30 days" — and a mutation test survived
-- against it. The rule was redundant here and harmful later: a customer who
-- answered three weeks ago and is due again would have been suppressed for a
-- month. The cooldown is the only suppression there is.
select is(
  (select count(*)::int from get_followup_queue(50) where name = 'FU Zoya Big'),
  0,
  'somebody who has just ordered is not due — no special rule needed to know it'
);

-- ── Did it work? ───────────────────────────────────────────────────────────
-- The question the whole feature exists to answer.

select is(
  (select ordered_count from get_followup_results(60)),
  1,
  'the round can say how many of the people it messaged came back'
);

select is(
  (select revenue_mvr from get_followup_results(60)),
  900.00::numeric,
  'and what that was worth, to the rufiyaa'
);

select is(
  (select skipped_count from get_followup_results(60)),
  1,
  'skips are counted beside sends — a round that is mostly skips is picking wrong'
);

-- ── Least privilege ────────────────────────────────────────────────────────
select is(
  (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_followup_queue', 'log_customer_followup', 'get_followup_results')),
  false,
  'none of the round is reachable without signing in'
);

select * from finish();
rollback;

-- Pass 6: a customer who ran out and never came back must be visible.
-- Regression guard for migration 0151.
--
-- The incident: at_risk flagged 0 of 58 customers — not because everyone was
-- healthy, but because the only rule needed `gap_count >= 2`, i.e. THREE
-- orders, before a customer had a "rhythm" to be overdue against. 42 of 58
-- customers have ordered exactly once, so they were structurally invisible
-- to it and always would be.
--
-- The replacement rule reasons from what they BOUGHT: a pack lasts a
-- knowable number of days, so a customer who bought one pack a month ago has
-- certainly run out, while one who bought ten has not. That distinction is
-- the whole feature, so the fixture below isolates it — three customers, the
-- same product, the same price, differing only in HOW MUCH they bought and
-- HOW LONG AGO.
--
--   A  1 pack, 30 days ago  -> ~6 days of supply, long gone      -> at risk
--   B  10 packs, 30 days ago -> ~60 days of supply, still fine   -> silent
--   C  1 pack, 5 days ago    -> ran out, but inside the 14-day
--                               floor that stops a brand-new
--                               customer being chased            -> silent
--
-- With fewer than 5 observed repeats the cohort rate falls back to 6.0 days
-- per pack, which is what makes these numbers fixed and the test stable.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000080', 'test-lapse@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000080';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000080', true);

insert into customers (id, name, phone, price_tier)
values ('00000000-0000-0000-0000-000000000081', 'Ran Out', '7000001', 'retail'),
       ('00000000-0000-0000-0000-000000000082', 'Well Stocked', '7000002', 'retail'),
       ('00000000-0000-0000-0000-000000000083', 'Just Bought', '7000003', 'retail');

-- Same SKU (34 pcs a pack), same unit price, three different quantities/dates.
insert into sales_orders (id, order_number, status, channel, customer_id,
                          source_godown_id, created_at)
values ('00000000-0000-0000-0000-000000000084', 'SO-TEST-LAPSE-A', 'confirmed', 'whatsapp',
        '00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000006',
        now() - interval '30 days'),
       ('00000000-0000-0000-0000-000000000085', 'SO-TEST-LAPSE-B', 'confirmed', 'whatsapp',
        '00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000006',
        now() - interval '30 days'),
       ('00000000-0000-0000-0000-000000000086', 'SO-TEST-LAPSE-C', 'confirmed', 'whatsapp',
        '00000000-0000-0000-0000-000000000083', '00000000-0000-0000-0000-000000000006',
        now() - interval '5 days');

insert into sales_order_lines (order_id, sku_id, uom, qty, qty_pieces, unit_price_mvr, line_total_mvr)
values ('00000000-0000-0000-0000-000000000084', '00000000-0000-0000-0000-000000000005',
        'pack', 1, 34, 700, 700),
       ('00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000005',
        'pack', 10, 340, 700, 7000),
       ('00000000-0000-0000-0000-000000000086', '00000000-0000-0000-0000-000000000005',
        'pack', 1, 34, 700, 700);

-- ── The rule ──────────────────────────────────────────────────────────────

select is(
  (select at_risk from get_customer_insights()
    where customer_id = '00000000-0000-0000-0000-000000000081'),
  true,
  'a customer who bought one pack a month ago is flagged -- one order is enough, which the old rhythm rule could never do'
);

select is(
  (select risk_reason from get_customer_insights()
    where customer_id = '00000000-0000-0000-0000-000000000081'),
  'ran_out',
  'and the reason says they ran out, not that they broke a rhythm they never had'
);

select is(
  (select at_risk from get_customer_insights()
    where customer_id = '00000000-0000-0000-0000-000000000082'),
  false,
  'a customer who bought TEN packs on the very same day is NOT flagged -- quantity decides, not elapsed time'
);

select is(
  (select at_risk from get_customer_insights()
    where customer_id = '00000000-0000-0000-0000-000000000083'),
  false,
  'a customer five days past a small order is not chased -- the 14-day floor protects a brand-new customer'
);

-- ── The supply estimate is in DAYS, derived from PACKS ────────────────────
select is(
  (select expected_supply_days from get_customer_insights()
    where customer_id = '00000000-0000-0000-0000-000000000081'),
  6,
  'one pack is about six days of supply at the fallback cohort rate'
);

select is(
  (select expected_supply_days from get_customer_insights()
    where customer_id = '00000000-0000-0000-0000-000000000082'),
  60,
  'ten packs is about sixty days -- the estimate scales with what was actually bought'
);

-- ── No rhythm invented for a one-time buyer ───────────────────────────────
select is(
  (select usual_gap_days from get_customer_insights()
    where customer_id = '00000000-0000-0000-0000-000000000081'),
  null,
  'a single-order customer has no usual gap -- the screen must not print one'
);

-- ── One definition of at-risk, not two ────────────────────────────────────
-- get_morning_briefing used to inline its own rhythm-only copy of this rule,
-- so the briefing and the Customers screen could disagree about the same
-- person. It now reads get_customer_insights.
select is(
  (get_morning_briefing() ->> 'at_risk_count')::int,
  (select count(*)::int from get_customer_insights() where at_risk),
  'the briefing''s at-risk count is exactly the Customers screen''s -- one rule, one answer'
);

select ok(
  (get_morning_briefing() -> 'overdue_customers') @> '[{"name": "Ran Out", "reason": "ran_out"}]'::jsonb,
  'the briefing names the lapsed customer, with the reason so it can use the right words'
);

select * from finish();
rollback;

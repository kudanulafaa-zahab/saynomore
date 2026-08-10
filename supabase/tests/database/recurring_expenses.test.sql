-- Standing monthly costs (migrations 0167-0170).
--
-- These exist because the P&L was reporting MVR 13,790 net profit for a month
-- with ZERO running costs behind it — business_expenses held one row in the
-- app's entire life, because the app modelled rent (the same every month) as a
-- one-off event and asked for it again every month.
--
-- The feature generates REAL ledger rows from a template rather than adding
-- numbers on the fly at read time, so every month can be corrected and audited.
-- That choice is only safe if two properties hold, and both are money-critical:
--
--   * generating twice must never DOUBLE a cost, and
--   * a hand-corrected month must SURVIVE the next generation.
--
-- Lose the first and every P&L overstates costs. Lose the second and every
-- correction Ali makes is silently reverted by a cron job at 07:00 on the 1st,
-- which is the worse of the two because nobody would ever catch it.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000090', 'test-recurring@example.test');
update user_profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000090';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000090', true);

insert into expense_categories (id, name, sort_order)
values ('00000000-0000-0000-0000-0000000000c1', 'Test Rent', 10);

-- Rent of MVR 5,000/month, starting three months ago.
insert into recurring_expenses (id, category_id, amount_mvr, starts_on, description)
values (
  '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000c1',
  5000,
  (date_trunc('month', (now() at time zone 'Indian/Maldives')::date) - interval '2 months')::date,
  'Godown rent'
);

-- 1. The trigger back-fills on insert: this month + the two before it.
select is(
  (select count(*)::int from business_expenses
    where recurring_id = '00000000-0000-0000-0000-0000000000d1'),
  3,
  'adding a monthly cost back-fills every month since it started -- past profit is right too'
);

-- 2. Every generated row is booked in its own month, on the 1st.
select is_empty(
  $$select id from business_expenses
     where recurring_id = '00000000-0000-0000-0000-0000000000d1'
       and (expense_date <> period_month
            or period_month <> date_trunc('month', period_month)::date)$$,
  'each generated row is booked on the 1st of the month it belongs to'
);

-- 3. IDEMPOTENCE. The cron job, the trigger and a manual run must not fight.
select is(
  materialise_recurring_expenses((now() at time zone 'Indian/Maldives')::date),
  0,
  'running the generator again inserts nothing -- a cost is never doubled'
);
select is(
  (select count(*)::int from business_expenses
    where recurring_id = '00000000-0000-0000-0000-0000000000d1'),
  3,
  'and the row count is unchanged after a second run'
);

-- 4. A CORRECTION MUST WIN. Rent really was 5,500 last month.
update business_expenses set amount_mvr = 5500
 where recurring_id = '00000000-0000-0000-0000-0000000000d1'
   and period_month = (date_trunc('month', (now() at time zone 'Indian/Maldives')::date) - interval '1 month')::date;

select is(
  materialise_recurring_expenses((now() at time zone 'Indian/Maldives')::date),
  0,
  'the generator has nothing to add after a month is corrected'
);
select is(
  (select amount_mvr from business_expenses
    where recurring_id = '00000000-0000-0000-0000-0000000000d1'
      and period_month = (date_trunc('month', (now() at time zone 'Indian/Maldives')::date) - interval '1 month')::date),
  5500::numeric,
  'a hand-corrected month SURVIVES regeneration -- the correction beats the template'
);

-- 5. The doubling guard is a CONSTRAINT, not a convention. Without the unique
--    index, ON CONFLICT DO NOTHING would have nothing to conflict against and
--    every run would append another rent line.
select throws_ok(
  $$insert into business_expenses (category_id, amount_mvr, expense_date, recurring_id, period_month)
    select category_id, amount_mvr, expense_date, recurring_id, period_month
      from business_expenses
     where recurring_id = '00000000-0000-0000-0000-0000000000d1' limit 1$$,
  '23505',
  null,
  'a second row for the same month is refused by the database, not merely avoided by the code'
);

-- 6. Ending a cost stops it WITHOUT rewriting the months it already generated.
update recurring_expenses
   set is_active = false,
       ends_on = (date_trunc('month', (now() at time zone 'Indian/Maldives')::date) - interval '1 month')::date
 where id = '00000000-0000-0000-0000-0000000000d1';

select is(
  (select count(*)::int from business_expenses
    where recurring_id = '00000000-0000-0000-0000-0000000000d1'),
  3,
  'stopping a monthly cost leaves every month it already recorded untouched'
);

-- 7. The helpers are not reachable from the app. Both are internal: the trigger
--    fires on write and pg_cron runs the catch-up. Supabase grants EXECUTE to
--    `authenticated` by default for new functions in public, so this is the
--    check that the REVOKEs in 0169/0170 actually took (HANDOFF 10a: the revoke
--    you wrote is not the grant you end up with).
select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('materialise_recurring_expenses','trg_recurring_expenses_materialise')
       and (has_function_privilege('anon',          p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute'))$$,
  'neither recurring-cost helper is executable by anon or authenticated'
);

select * from finish();
rollback;

-- 0170 — the recurring-cost machinery stops asking the SERVER what day it is.
--
-- Caught by money_rules.test.sql test 9, which forbids CURRENT_DATE in any
-- function or view: "There is no correct use of the server's day in this
-- database." 0167 used it in three places and the test failed the moment the
-- suite ran. The test is right and the migration was wrong.
--
-- WHY IT MATTERS HERE, CONCRETELY
--
-- The database runs in UTC; Ali is at UTC+5. Between 19:00 and midnight UTC it
-- is already tomorrow in Malé. The monthly job is scheduled at 02:00 UTC on the
-- 1st, which is 07:00 Malé on the 1st — safe. But the trigger fires whenever a
-- cost is ADDED, at whatever hour Ali happens to be using his phone. Add a cost
-- at 21:00 Malé on the 1st of a month (16:00 UTC — fine), or at 01:00 Malé on
-- the 1st (20:00 UTC on the LAST DAY of the previous month — not fine): the
-- server would compute the target month as the month that just ended, and the
-- new month would silently not be generated until the cron ran.
--
-- The window is a few hours a month and the damage is a missing rent line in
-- the current month's P&L — which is exactly the number this whole feature
-- exists to make true. Small, silent, and in the worst possible place.
--
-- (n.b. only the TRIGGER body actually tripped the test, because a parameter
-- default lives outside prosrc. The default was wrong for the same reason and
-- is fixed too — a rule enforced only where the grep happens to look is not
-- enforced.)

create or replace function materialise_recurring_expenses(
  p_up_to date default (now() at time zone 'Indian/Maldives')::date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_target   date;
  r          record;
  m          date;
begin
  v_target := date_trunc('month', p_up_to)::date;

  for r in
    select * from recurring_expenses
    where is_active and starts_on <= v_target
  loop
    m := r.starts_on;
    while m <= least(v_target, coalesce(r.ends_on, v_target)) loop
      insert into business_expenses
        (category_id, amount_mvr, expense_date, description, created_by,
         recurring_id, period_month)
      values
        (r.category_id, r.amount_mvr, m,
         coalesce(r.description, 'Monthly cost'), r.created_by,
         r.id, m)
      on conflict (recurring_id, period_month) where recurring_id is not null
        do nothing;              -- NEVER do update: a corrected month wins.
      if found then
        v_inserted := v_inserted + 1;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  return v_inserted;
end;
$$;

revoke execute on function materialise_recurring_expenses(date) from public;
revoke execute on function materialise_recurring_expenses(date) from anon;
revoke execute on function materialise_recurring_expenses(date) from authenticated;

create or replace function trg_recurring_expenses_materialise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform materialise_recurring_expenses((now() at time zone 'Indian/Maldives')::date);
  return null;
end;
$$;

revoke execute on function trg_recurring_expenses_materialise() from public;
revoke execute on function trg_recurring_expenses_materialise() from anon;
revoke execute on function trg_recurring_expenses_materialise() from authenticated;

-- And the scheduled catch-up, for the same reason.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('materialise-recurring-expenses')
      where exists (select 1 from cron.job where jobname = 'materialise-recurring-expenses');
    perform cron.schedule(
      'materialise-recurring-expenses',
      '0 2 1 * *',
      $cron$select public.materialise_recurring_expenses((now() at time zone 'Indian/Maldives')::date);$cron$
    );
  end if;
end $$;

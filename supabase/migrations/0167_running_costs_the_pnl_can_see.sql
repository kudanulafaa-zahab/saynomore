-- 0167 — the P&L can finally see what it costs to run the business.
--
-- THE PROBLEM, IN LIVE NUMBERS (2026-08-10)
--
-- get_pnl for the last 30 days returned:
--
--     revenue      MVR 41,710
--     cogs         MVR 26,979
--     marketing    MVR    847
--     write-offs   MVR     94
--     other_opex   MVR      0     <-- every running cost, all of it
--     net_profit   MVR 13,790
--
-- business_expenses has held exactly ONE row since the app was built:
-- MVR 1,000. Rent, salaries, fuel, boat freight, phone, bank charges — none of
-- it is in the ledger. So "net profit" is really gross profit minus marketing,
-- printed at 32px in green, and it is the single most misleading number in the
-- app. Ali is non-technical and runs the business off these screens; he has no
-- other place to read his profit from.
--
-- WHY IT WAS EMPTY, WHICH IS THE PART THAT MATTERS
--
-- Not laziness, and not a missing screen — the Expenses screen exists and the
-- six categories were already set up correctly (Rent & Godown, Staff Salaries,
-- Fuel & Delivery, Utilities & Internet, Bank & Fees, Other).
--
-- The app modelled a *fixed monthly cost* as a *one-off event*. Rent is the
-- same every month. Salaries are the same every month. The app asked him to
-- remember them and re-type them, every month, for ever. Nobody sustains that,
-- and an ERP should never ask: recurring costs are STANDING DATA, entered once.
--
-- WHAT THIS DOES
--
-- Adds a recurring definition, and generates REAL LEDGER ROWS from it.
--
-- The alternative — having get_pnl add recurring amounts on the fly — was
-- rejected deliberately. It would mean:
--   * no row to correct when a month is different (rent rises; a salary month
--     is skipped; you paid 11 months not 12),
--   * nothing in audit_log,
--   * the Expenses screen showing a different total from the P&L,
--   * and money math appearing in two places, which is how they drift.
-- Generated rows are ordinary business_expenses rows. Every existing report,
-- view and screen picks them up with no change, because they are not special.
--
-- IDEMPOTENCE IS THE WHOLE SAFETY PROPERTY
--
-- Generating twice must never double a cost. Each generated row carries its
-- recurring_id and the month it belongs to, and a UNIQUE index on that pair
-- makes a second run a no-op. This is the same discipline as the offline
-- replay key on post_sale: the operation can be retried safely, so the
-- scheduler, the backfill and a manual run cannot fight each other.
--
-- A CORRECTED MONTH SURVIVES REGENERATION. Because the insert is
-- ON CONFLICT DO NOTHING (never DO UPDATE), editing August's rent to the real
-- figure and re-running leaves the edit alone. Correction beats the template,
-- always — that is the ERP rule and it is enforced here rather than trusted.

-- ── The recurring definition ────────────────────────────────────────────────

create table if not exists recurring_expenses (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references expense_categories(id),
  amount_mvr   numeric(12,2) not null check (amount_mvr > 0),
  -- The first month this cost applies. Stored as the 1st of that month; the
  -- check keeps it that way so "which months does this cover" is never a
  -- question about day-of-month arithmetic.
  starts_on    date not null check (starts_on = date_trunc('month', starts_on)::date),
  -- Last month it applies. NULL = still running. Ending a cost is how you stop
  -- it; deleting the definition would orphan the rows it already generated.
  ends_on      date null check (ends_on is null or ends_on = date_trunc('month', ends_on)::date),
  description  text,
  is_active    boolean not null default true,
  created_by   uuid null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint recurring_expenses_range check (ends_on is null or ends_on >= starts_on)
);

comment on table recurring_expenses is
  'Standing monthly costs (rent, salaries…). Generates real business_expenses '
  'rows via materialise_recurring_expenses(). Never read directly by the P&L.';

-- ── The link from a generated row back to its definition ────────────────────

alter table business_expenses
  add column if not exists recurring_id uuid null references recurring_expenses(id) on delete set null,
  add column if not exists period_month date null;

comment on column business_expenses.recurring_id is
  'Set when this row was generated from a standing monthly cost. NULL for '
  'one-off expenses typed in directly.';
comment on column business_expenses.period_month is
  'The month a generated row belongs to (1st of month). Half of the '
  'idempotence key.';

-- The safety property, as a constraint rather than a convention.
create unique index if not exists business_expenses_recurring_month_uniq
  on business_expenses (recurring_id, period_month)
  where recurring_id is not null;

-- Reading "this month's generated rows" and the P&L's date-range scan both
-- benefit; the partial index above cannot serve a plain period_month lookup.
create index if not exists business_expenses_period_month_idx
  on business_expenses (period_month) where period_month is not null;

create index if not exists recurring_expenses_active_idx
  on recurring_expenses (is_active, starts_on);

-- ── RLS — matched to business_expenses exactly ──────────────────────────────
-- Read for any signed-in user; write for admin/manager only. Same shape as
-- be_read / be_write so a manager cannot see one and not the other.

alter table recurring_expenses enable row level security;

drop policy if exists re_read  on recurring_expenses;
drop policy if exists re_write on recurring_expenses;

create policy re_read  on recurring_expenses for select
  using ((select auth.uid()) is not null);
create policy re_write on recurring_expenses for all
  using (is_admin_or_manager());

-- ── Generating the ledger rows ──────────────────────────────────────────────

create or replace function materialise_recurring_expenses(p_up_to date default current_date)
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
  -- Whole months only, and never beyond the month we were asked for.
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

comment on function materialise_recurring_expenses(date) is
  'Generates missing business_expenses rows from standing monthly costs, up to '
  'and including the month of p_up_to. Idempotent — safe to run any number of '
  'times. Never overwrites a row that already exists, so manual corrections '
  'survive.';

revoke execute on function materialise_recurring_expenses(date) from public;
revoke execute on function materialise_recurring_expenses(date) from anon;
grant  execute on function materialise_recurring_expenses(date) to authenticated;

-- ── Backfill the moment a cost is added or changed ──────────────────────────
-- Without this, adding "rent from January" would show nothing until the
-- scheduler next ran, and the P&L would still be wrong for every past month.

create or replace function trg_recurring_expenses_materialise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform materialise_recurring_expenses(current_date);
  return null;
end;
$$;

revoke execute on function trg_recurring_expenses_materialise() from public;
revoke execute on function trg_recurring_expenses_materialise() from anon;

drop trigger if exists recurring_expenses_materialise on recurring_expenses;
create trigger recurring_expenses_materialise
  after insert or update on recurring_expenses
  for each statement execute function trg_recurring_expenses_materialise();

-- ── Does the P&L know about running costs at all? ───────────────────────────
--
-- The honesty problem is not only that opex was zero — it is that the app had
-- no way to tell "genuinely nothing to pay this month" apart from "nobody has
-- ever told me what this business costs to run". Those are wildly different
-- facts and both rendered as MVR 0 under a confident green Net Profit.
--
-- This answers it for the UI so the screen can stop pretending. It is a fact
-- about configuration, not money math, but it belongs here beside the data it
-- describes rather than being inferred in TypeScript.

create or replace function has_running_costs_configured()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from recurring_expenses where is_active)
      or exists (select 1 from business_expenses  where recurring_id is null);
$$;

comment on function has_running_costs_configured() is
  'True once the business has told the app what it costs to run — either a '
  'standing monthly cost, or any hand-entered expense. Lets the P&L show an '
  'honest "before running costs" state instead of a confident wrong net profit.';

revoke execute on function has_running_costs_configured() from public;
revoke execute on function has_running_costs_configured() from anon;
grant  execute on function has_running_costs_configured() to authenticated;

-- ── Keep it running without anyone remembering ──────────────────────────────
-- 02:00 UTC on the 1st = 07:00 Maldives, the same hour as the existing
-- low-stock digest. Guarded so the migration still replays on a database
-- without pg_cron (the CI test database has it, but do not depend on it).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('materialise-recurring-expenses')
      where exists (select 1 from cron.job where jobname = 'materialise-recurring-expenses');
    perform cron.schedule(
      'materialise-recurring-expenses',
      '0 2 1 * *',
      $cron$select public.materialise_recurring_expenses(current_date);$cron$
    );
  end if;
end $$;

-- 0168 — "does the P&L have running costs behind it" is a question about a
--        PERIOD, not about all time.
--
-- 0167 shipped has_running_costs_configured(), which asked "has anyone ever
-- entered an expense?" Against live data it answered TRUE — because one
-- MVR 1,000 expense exists from months ago.
--
-- That is precisely the wrong answer. It would have silenced the honesty
-- banner on a P&L whose last 30 days still contained no rent, no salaries and
-- no fuel. A single old row would have certified every future month as
-- complete, for ever. The bug was found by running the function against
-- production data rather than reasoning about it — the reasoning had looked
-- fine.
--
-- The real question is about the period ON SCREEN: does this month's profit
-- have this month's costs behind it? Same two arguments as get_pnl, so a
-- screen cannot ask about a different window than the one it is displaying —
-- that mismatch is how a "verified" figure quietly stops matching its label.
--
-- ever_recorded is kept as a separate column, because the two states need
-- different words. A business that has never recorded a cost needs teaching;
-- one that usually records them and missed this month needs reminding.

drop function if exists has_running_costs_configured();

create or replace function running_costs_status(p_from date, p_to date)
returns table (
  has_costs        boolean,   -- are there running costs in THIS period?
  amount_mvr       numeric,   -- how much
  from_recurring   boolean,   -- is a standing monthly cost covering it?
  ever_recorded    boolean    -- has the business ever recorded any cost at all?
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(be.amount_mvr), 0) > 0                                as has_costs,
    coalesce(sum(be.amount_mvr), 0)                                    as amount_mvr,
    bool_or(be.recurring_id is not null)                               as from_recurring,
    exists (select 1 from business_expenses)                           as ever_recorded
  from business_expenses be
  where be.expense_date between p_from and p_to;
$$;

comment on function running_costs_status(date, date) is
  'Whether the P&L for a given period actually has running costs behind it. '
  'Lets the screen show an honest "before running costs" state instead of a '
  'confident wrong net profit. Period-aware on purpose: one expense entered '
  'months ago does not make THIS month complete.';

revoke execute on function running_costs_status(date, date) from public;
revoke execute on function running_costs_status(date, date) from anon;
grant  execute on function running_costs_status(date, date) to authenticated;

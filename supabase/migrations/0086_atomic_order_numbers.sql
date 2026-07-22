-- 0086 — Atomic sales-order numbers
--
-- Order numbers were computed on the client (nextOrderNumber = max+1 over the
-- orders the browser had loaded). Two clients — or one client with a stale
-- cache — compute the SAME next number, and the second insert dies on
-- sales_orders_order_number_key. A manager hit exactly this.
--
-- Fix: the database owns the number. A per-year counter row is bumped
-- atomically inside a BEFORE INSERT trigger, so concurrent inserts serialize
-- on the counter row and can never collide. The client value is ignored.

create table if not exists public.order_number_counters (
  year     int  primary key,
  last_seq int  not null default 0
);

alter table public.order_number_counters enable row level security;
-- No policies: only the SECURITY DEFINER trigger (below) touches this table.
revoke all on public.order_number_counters from anon, authenticated;

create or replace function public.assign_sales_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from (now() at time zone 'Indian/Maldives'))::int;
  v_seq  int;
begin
  -- Atomic bump: the upsert locks the counter row for this year, so parallel
  -- inserts take their number one at a time. RETURNING gives us the new value.
  insert into public.order_number_counters (year, last_seq)
    values (v_year, 1)
  on conflict (year)
    do update set last_seq = public.order_number_counters.last_seq + 1
  returning last_seq into v_seq;

  new.order_number := 'SO-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  return new;
end;
$$;

revoke all on function public.assign_sales_order_number() from anon, authenticated, public;

-- Seed the counters from existing orders so we CONTINUE each year's sequence
-- rather than restart at 001 and collide again.
insert into public.order_number_counters (year, last_seq)
select yr, mx
from (
  select (regexp_match(order_number, '^SO-(\d{4})-'))[1]::int as yr,
         max((regexp_match(order_number, '^SO-\d{4}-(\d+)$'))[1]::int) as mx
  from public.sales_orders
  where order_number ~ '^SO-\d{4}-\d+$'
  group by 1
) s
on conflict (year)
  do update set last_seq = greatest(public.order_number_counters.last_seq, excluded.last_seq);

drop trigger if exists trg_assign_sales_order_number on public.sales_orders;
create trigger trg_assign_sales_order_number
  before insert on public.sales_orders
  for each row execute function public.assign_sales_order_number();

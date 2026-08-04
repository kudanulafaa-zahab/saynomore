-- 0120 — Sales order channel / source constraints, and the order_source column.
--
-- Consolidated replacement for a group of migrations that has been removed
-- from this repo. `sales_orders.order_source` exists in the live database
-- and predates that work; this migration makes it official and constrains
-- both it and `channel` to the values the app actually uses.
--
-- Written to be safe on a fresh database AND on the live one (where all of
-- this is already true): every step is guarded, so replaying it is a no-op
-- rather than an error.

-- order_source: staff-entered orders only. Kept because it exists live and
-- is harmless; nothing in the app reads it today.
alter table public.sales_orders
  add column if not exists order_source text default 'walk-in';

update public.sales_orders set order_source = 'walk-in' where order_source is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_orders'
      and column_name = 'order_source' and is_nullable = 'YES'
  ) then
    alter table public.sales_orders alter column order_source set not null;
  end if;
end $$;

alter table public.sales_orders
  drop constraint if exists sales_orders_order_source_check;

alter table public.sales_orders
  add constraint sales_orders_order_source_check
  check (order_source in ('walk-in'));

-- channel: how a staff-entered order actually arrived.
alter table public.sales_orders
  drop constraint if exists sales_orders_channel_check;

alter table public.sales_orders
  add constraint sales_orders_channel_check
  check (channel in (
    'whatsapp','viber','messenger','instagram','tiktok','facebook',
    'walkin','phone','other'
  ));

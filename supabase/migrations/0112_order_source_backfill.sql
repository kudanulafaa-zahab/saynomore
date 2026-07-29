-- 0112 — Bring order_source into the tracked migration history, add 'web'.
--
-- sales_orders.order_source exists live in the database (nullable text,
-- default 'walk-in') but is untracked in any migration file, and nothing in
-- the app's TypeScript reads or writes it (verified: grep across lib/,
-- components/, app/, supabase/migrations/ — zero hits). A prior planning doc
-- claimed Dispatch/Sales already used it for a "Web" badge; that badge does
-- not exist yet. This migration does two things: (1) makes the column
-- official and not-null with its existing default, so migration history
-- matches live reality, and (2) adds the 'web' value everywhere a channel/
-- source of an order can be recorded, ahead of the storefront's first order.
--
-- The real UI work (SalesOrderRow.order_source, the Web badge in the Sales
-- list and Dispatch board, an optional Web filter chip) is separate and
-- lands in its own commit against lib/queries/sales.ts and
-- components/sales/sales-list.tsx.

alter table public.sales_orders
  alter column order_source set default 'walk-in';

alter table public.sales_orders
  add column if not exists order_source text default 'walk-in';

update public.sales_orders set order_source = 'walk-in' where order_source is null;

-- The column already existed (nullable) on the live database before this
-- migration was ever written, so ADD COLUMN IF NOT EXISTS above is a no-op
-- and its own NOT NULL clause never applies here — SET NOT NULL has to be a
-- separate statement, after the backfill guarantees no NULLs remain.
alter table public.sales_orders
  alter column order_source set not null;

alter table public.sales_orders
  drop constraint if exists sales_orders_order_source_check;

alter table public.sales_orders
  add constraint sales_orders_order_source_check
  check (order_source in ('walk-in', 'web'));

-- 'web' joins the channel list so a storefront order can honestly record how
-- it arrived, alongside the existing whatsapp/viber/... values used for
-- staff-entered orders.
alter table public.sales_orders
  drop constraint if exists sales_orders_channel_check;

alter table public.sales_orders
  add constraint sales_orders_channel_check
  check (channel in (
    'whatsapp','viber','messenger','instagram','tiktok','facebook',
    'walkin','phone','other','web'
  ));

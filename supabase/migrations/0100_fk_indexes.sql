-- 0100 — Index every foreign key that didn't have one.
--
-- Postgres does NOT create an index for a foreign key automatically (only for
-- PRIMARY KEY / UNIQUE). Two costs when the child side is unindexed:
--   1. Every DELETE or key UPDATE on the PARENT row has to sequential-scan the
--      child table to enforce the constraint. Deleting a user profile today
--      scans audit_log, sales_orders, order_payments, shipments and
--      stock_movements end to end.
--   2. Any join or filter on that column is a seq scan.
--
-- The dataset is small today so nothing is slow yet — this is the cheap moment
-- to add them, before the tables grow. All are plain btree indexes: no logic,
-- no behaviour change, purely a planner option.
--
-- Source: Supabase performance advisor `unindexed_foreign_keys` (11 findings).

create index if not exists idx_audit_log_changed_by
  on public.audit_log (changed_by);

create index if not exists idx_marketing_spend_created_by
  on public.marketing_spend (created_by);

create index if not exists idx_order_payments_created_by
  on public.order_payments (created_by);

create index if not exists idx_price_lists_created_by
  on public.price_lists (created_by);

create index if not exists idx_sales_orders_created_by
  on public.sales_orders (created_by);

create index if not exists idx_sales_returns_sku_id
  on public.sales_returns (sku_id);

create index if not exists idx_sales_returns_godown_id
  on public.sales_returns (godown_id);

create index if not exists idx_shipments_created_by
  on public.shipments (created_by);

create index if not exists idx_shipments_grn_confirmed_by
  on public.shipments (grn_confirmed_by);

create index if not exists idx_stock_movements_created_by
  on public.stock_movements (created_by);

create index if not exists idx_stock_verification_sessions_verified_by
  on public.stock_verification_sessions (verified_by);

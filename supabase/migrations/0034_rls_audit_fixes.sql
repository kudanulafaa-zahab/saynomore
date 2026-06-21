-- ============================================================================
-- 0034 — RLS security audit fixes
-- ============================================================================
-- Full RLS audit performed 2026-06-21. Every table already had RLS enabled and
-- the role model (current_user_role() SECURITY DEFINER -> user_profiles.role,
-- wrapped by is_admin()/is_admin_or_manager()) is sound. Verified by simulation:
--   * anon (public key) reads 0 rows from customers/skus/user_profiles/price_lists
--   * staff sees only their own user_profiles row (1 of 4), cannot self-escalate
--     role to admin (UPDATE blocked by up_admin_write = is_admin())
--   * staff cannot read other drivers' orders (assigned_driver_id = auth.uid())
--
-- Two real problems were found and are fixed below.
-- ----------------------------------------------------------------------------

-- FINDING 1 (HIGH) — push_subscriptions leaked to everyone.
-- The "service_read" policy was `FOR SELECT USING (true)` on role public, added
-- under the false belief that the send edge function needs it. It does NOT: the
-- edge function uses the SERVICE ROLE key, which bypasses RLS entirely. The only
-- effect of this policy was to let ANY anon (public key, no login) or any
-- authenticated user read EVERY user's push endpoint + p256dh + auth keys —
-- enough to spoof push notifications to their devices. Confirmed live: anon and
-- a staff user could both read another user's subscription row.
-- Fix: drop the policy. The "owner" policy (auth.uid() = user_id) remains, so
-- users still manage their own subscriptions and the edge function is unaffected.
drop policy if exists "service_read" on push_subscriptions;

-- FINDING 2 (LOW) — legacy app_users table + dead sales_orders.driver_id FK.
-- app_users (1 stale row) predates user_profiles (the live table, 4 rows). Its
-- policies relied on auth.jwt() ->> 'role' (no user has that claim, so the write
-- policy is dead) and an "all_read" that let any authenticated user read the
-- whole table. The app references it nowhere; the only thing pointing at it is
-- sales_orders.driver_id (a dead column — the app uses assigned_driver_id, 14
-- code sites vs 0 real uses of driver_id). Removing the dead column + table
-- eliminates a confusing parallel auth surface.
alter table sales_orders drop column if exists driver_id;
drop table if exists app_users;

-- ----------------------------------------------------------------------------
-- Everything else passed the audit and is intentionally left unchanged:
--   * read policies of `auth.uid() IS NOT NULL` are correct for this app — every
--     authenticated employee may read master/catalog/inventory data; staff are
--     additionally restricted on sales_orders / sales_order_lines / stock_movements.
--   * audit_log: INSERT requires auth.uid(); no UPDATE/DELETE policy => immutable
--     to anon and authenticated (only service role can rewrite it). Correct.
--   * user_profiles: self-read only (or admin), admin-only write. Correct.
-- ============================================================================

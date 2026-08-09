-- 0166 — the migration files can rebuild the database again.
--
-- Ali, 2026-08-09: "I don't understand migration files not rebuilding the
-- database. Will this affect anything for me?"
--
-- Not today, and nothing about money, stock or accounts. Production is
-- correct. This is about being able to REBUILD it.
--
-- HOW IT WAS FOUND
--
-- Not by reading — by trying. Building a local copy from these files to test
-- the sales screens produced an app where every user was locked to the driver
-- view and creating a user failed outright. The live database was fine; the
-- files that are supposed to reproduce it were not.
--
-- TWO THINGS EXISTED ONLY IN PRODUCTION
--
-- 1. TABLE GRANTS. Supabase grants the anon/authenticated/service_role roles
--    access to tables in `public` as a platform default, applied when a table
--    is created through its API. Tables created by a migration file get no
--    such grant on a fresh rebuild, so a rebuilt database answers every query
--    with "permission denied for table user_profiles". The app then reads
--    every user's role as the "staff" fallback and redirects them all to
--    /deliveries.
--
--    Row security is what actually protects the data, and it is unaffected:
--    RLS is enabled on every money and stock table (asserted by
--    security_and_stock_rules.test.sql) and every policy still applies on top
--    of these grants. A grant says "you may ask"; a policy says "here is what
--    you may see".
--
-- 2. handle_new_user HAD NO search_path. It is the trigger that creates a
--    user_profiles row when an account is created. Production carries
--    `SET search_path = public`; the migration that created it did not. Under
--    the auth service's own search_path the unqualified table name does not
--    resolve, so account creation fails with "relation user_profiles does not
--    exist" — which is exactly what happened locally, and would happen to a
--    real invite on any rebuilt database.
--
-- WHY IT IS RECORDED AS-IS RATHER THAN TIGHTENED
--
-- anon holds SELECT on 33 tables in production. Reproducing that faithfully
-- is the whole point of this file: a rebuild must match what is running, or
-- the rebuild is untested. Whether anon should hold those grants at all is a
-- real question, but it is a security review with its own testing — not
-- something to smuggle into a housekeeping fix, where getting it wrong locks
-- Ali out of his own business.
--
-- SAFETY
--
-- Every statement is idempotent and describes what production already has, so
-- applying it live changes nothing. Its only effect is on a database built
-- from these files.

BEGIN;

-- ── 1. The platform-default table grants ──────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT
  ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- And for anything a LATER migration creates, so this cannot drift again.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

-- ── 2. The setting production has and the files never recorded ────────────
-- SECURITY DEFINER without a fixed search_path is also the mutable-search-path
-- warning the linter raises, so this closes that as well.
ALTER FUNCTION public.handle_new_user() SET search_path TO 'public';

COMMIT;

-- The security surface, checked by enumeration rather than by memory.
--
-- WHY THIS FILE EXISTS. `CREATE OR REPLACE VIEW` does not preserve reloptions.
-- Restate the view body without `WITH (security_invoker = true)` and the view
-- silently starts running with its CREATOR's rights, so row level security is
-- evaluated as the creator instead of as the person asking. Nothing fails,
-- nothing looks different, and the only symptom is an advisor line nobody is
-- obliged to read.
--
-- It has now happened twice to `v_order_balances` — migration 0124, undone by
-- 0125; then migration 0185, undone by 0186. Between those two, three separate
-- migrations (0139, 0149, 0153) added comments warning about the trap. Comments
-- did not stop it. A test does, because the gate runs whether or not anyone
-- remembers.
--
-- EVERY CHECK HERE IS BY ENUMERATION, NEVER BY NAME. A list of known views is
-- the same defence as a comment: correct on the day it is written and silently
-- incomplete from the next migration onwards. These queries ask the catalogue
-- what exists now, so a view or a function added next year is covered without
-- anyone doing anything.

begin;
select plan(8);

-- ── Every view respects the caller's row level security ────────────────────
-- `security_invoker` accepts both `true` and `on`; the app has used both
-- spellings over time and they mean the same thing.
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'none')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not exists (
        select 1 from unnest(coalesce(c.reloptions, array[]::text[])) o
         where o in ('security_invoker=true', 'security_invoker=on'))),
  'none',
  'every view in public runs as the CALLER, so row level security still applies'
);

-- ── Nothing unauthenticated runs with elevated rights ──────────────────────
-- A SECURITY DEFINER function reachable by `anon` is reachable by anyone on
-- the internet with the publishable key, running as its owner. There should be
-- none, and get_pricing_health once shipped as one for half a day.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')),
  'none',
  'no SECURITY DEFINER function can be executed without signing in'
);

-- ── ...AND NOTHING ELSE EITHER (migration 0203) ────────────────────────────
--
-- THE CHECK ABOVE IS TOO NARROW, AND ITS NARROWNESS IS WHY A HOLE SURVIVED IT.
-- It asks only about SECURITY DEFINER functions, because those run as their
-- owner and are the worst case. But `simulate_landed_costs` — the whole Cost
-- Simulator engine — is SECURITY INVOKER, so it passed this test while being
-- callable by anyone holding the publishable key. So were three trigger
-- functions and `price_per_unit`.
--
-- Two grants exist on a new function and they are not the same grant: Postgres
-- gives EXECUTE to PUBLIC, and Supabase's default privileges give it to `anon`
-- EXPLICITLY. Revoking PUBLIC does nothing to the second. That is what made the
-- gap invisible — and invisible LOCALLY in particular, since the local stack
-- carries no such default-privileges setting, so a single revoke really is
-- enough here and really is not enough on production.
--
-- ENUMERATED, NOT LISTED. A guard naming specific functions stops covering the
-- surface the moment one is added, which is how this happened. `keepalive` is
-- the one stated exception: it exists to be pinged unauthenticated.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname <> 'keepalive'
      and has_function_privilege('anon', p.oid, 'execute')),
  'none',
  'no function at all is callable without signing in, definer or not -- keepalive alone is meant to be'
);

-- ── Every elevated function pins its search_path ───────────────────────────
-- Without `SET search_path`, a SECURITY DEFINER function resolves names using
-- the CALLER's path, so an unqualified `skus` can be made to mean a table the
-- caller controls — the classic definer-function hijack.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
         where c like 'search\_path=%')),
  'none',
  'every SECURITY DEFINER function pins its search_path'
);

-- ── The guard is guarding something ────────────────────────────────────────
-- Three "none"s would also be the answer if the database had no views and no
-- definer functions at all, which is exactly how a security test quietly stops
-- testing. This asserts there is a real surface underneath.
select cmp_ok(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'),
  '>', 5,
  'and there really are views being checked, not an empty schema passing by default'
);

-- ── No rule is declared twice ──────────────────────────────────────────────
-- Six CHECK constraints existed in duplicate on sales_order_lines and
-- shipment_lines, with byte-identical definitions — one from the original
-- CREATE TABLE and one from a later hardening migration that re-added rules
-- already present (0195 removed them). Both were evaluated on every write, and
-- when a write was refused either could be the one named.
--
-- Enumerated, like everything else in this file: a pair added next year is
-- caught without anyone remembering this test exists.
select is(
  (select coalesce(string_agg(format('%s: %s', tbl, names), ' | ' order by tbl), 'none')
     from (
       select c.relname as tbl,
              string_agg(con.conname, ' = ' order by con.conname) as names
         from pg_constraint con
         join pg_class c on c.oid = con.conrelid
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where con.contype = 'c'
        group by c.relname, pg_get_constraintdef(con.oid)
       having count(*) > 1
     ) dupes),
  'none',
  'no table declares the same CHECK rule twice'
);

-- ── No policy asks who you are once per row ────────────────────────────────
-- A bare function call inside a policy expression is evaluated FOR EVERY ROW
-- considered. `is_admin_or_manager()` calls `current_user_role()`, which SELECTs
-- from user_profiles — so a query touching five tables asked "who is this
-- person?" against a table, over and over, for every row of every table.
--
-- Measured on production before 0196 fixed it:
--     row security bypassed   1.75 ms
--     row security enforced  52.85 ms      — 97% of the cost
-- and wrapping five policies took it to 3.26 ms.
--
-- Wrapping as `(select f())` makes Postgres hoist it to an InitPlan: once per
-- query, same answer, because all three helpers are STABLE.
--
-- Case-INSENSITIVE, and that matters: Postgres renders a wrapped call back as
-- "( SELECT is_admin_or_manager() AS ...)" in upper case. A lower-case check
-- reports every policy it just fixed as still broken, which is exactly what
-- happened the first time this was written.
select is(
  (select coalesce(string_agg(format('%s.%s', c.relname, p.polname), ', '
                              order by c.relname, p.polname), 'none')
     from pg_policy p
     join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where coalesce(pg_get_expr(p.polqual, p.polrelid), '')
            ~* '(?<!select )(is_admin_or_manager|is_admin_manager_or_viewer|current_user_role)\(\)'
       or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
            ~* '(?<!select )(is_admin_or_manager|is_admin_manager_or_viewer|current_user_role)\(\)'),
  'none',
  'no policy calls a role helper once per row — every one is hoisted to an InitPlan'
);

-- The guard is guarding something. "none" is also the answer if the policies
-- stopped calling these helpers at all, which would mean something far worse.
select cmp_ok(
  (select count(*)::int
     from pg_policy p
     join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~* '(is_admin_or_manager|is_admin_manager_or_viewer|current_user_role)\('
       or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~* '(is_admin_or_manager|is_admin_manager_or_viewer|current_user_role)\('),
  '>', 20,
  'and the role helpers are still doing the guarding, on a real number of policies'
);

select * from finish();
rollback;

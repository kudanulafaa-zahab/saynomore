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
select plan(4);

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

select * from finish();
rollback;

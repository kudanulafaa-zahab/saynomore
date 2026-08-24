-- 0203 — anon reaches nothing it should not, enumerated rather than listed.
--
-- ── HOW THIS WAS FOUND ──────────────────────────────────────────────────────
--
-- 0202's own guard refused an apply with "anon can execute price_per_unit". Two
-- grants exist on a new function and they are NOT the same grant:
--
--   PUBLIC   Postgres's own default on every new function.
--   anon     an EXPLICIT grant, from Supabase's `alter default privileges in
--            schema public grant execute on functions to anon, authenticated,
--            service_role`. Revoking PUBLIC does nothing to it.
--
-- 0202 revoked both from get_setup_gaps and only PUBLIC from price_per_unit —
-- one instance fixed, the surface not swept. It survived local testing because
-- the LOCAL STACK CARRIES NO SUCH DEFAULT-PRIVILEGES SETTING: locally one revoke
-- genuinely is enough, and the difference exists only on production. That is the
-- whole argument for asking `has_function_privilege` rather than trusting that a
-- REVOKE statement ran.
--
-- ── THE SWEEP, AND WHAT IT TURNED UP ────────────────────────────────────────
--
-- CLAUDE.md rule 9: a fix for one instance of a bug class is not done until the
-- whole surface has been swept systematically, not left to be discovered one
-- test run at a time. Asking production which public functions anon could
-- execute returned six, and the interesting one was not the one being fixed:
--
--   price_per_unit          the function that started this
--   simulate_landed_costs   THE COST SIMULATOR ENGINE. SECURITY INVOKER, and it
--                           reads no table, so none of Ali's data is exposed —
--                           but it is unbounded arithmetic that an
--                           unauthenticated caller could run at will, and the
--                           Pricing Tool has no business answering to anyone who
--                           is not signed in.
--   guard_sku_pack_config   three TRIGGER functions. A trigger is fired by the
--   round_sales_order_...   table, not called by a client, so nothing legitimate
--   tg_normalise_custom...  needs EXECUTE on them. Pure surface.
--
--   keepalive               LEFT ALONE, deliberately, and it is the only
--                           exception: it exists to be pinged, which is the one
--                           case where an anon grant is the point.
--
-- ── WHY THE GUARD ENUMERATES ────────────────────────────────────────────────
--
-- A guard that checks a named list stops covering the surface the moment
-- somebody adds a function — which is exactly how this hole appeared. So it asks
-- Postgres for every function anon can reach and fails on anything that is not
-- `keepalive`. The next one is caught by the gate rather than by a person
-- noticing.
--
-- ── THE REVOKE ENUMERATES TOO, AND THAT WAS NOT THE FIRST INSTINCT ──────────
--
-- The first version of this migration NAMED the six functions the production
-- sweep had returned. It failed on the replay from empty with
--
--     function public.guard_sku_pack_config() does not exist
--
-- because that function exists on PRODUCTION and in no migration — the same
-- drift class 0198 fixed for columns, this time for a function, and found only
-- because a named list forced the question. (Migrations create
-- `block_pack_config_change_with_history()`; the old name is a leftover from
-- before migrations were the discipline. Recorded in docs/OPEN.md — `npm run
-- drift` compares columns only and would never have seen it.)
--
-- So the revoke asks the catalogue instead. It then works on any database
-- whatever it happens to contain, needs no editing when a function is added or
-- renamed, and cannot be defeated by the drift it just uncovered.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname <> 'keepalive'
       and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    raise notice '0203: anon can no longer execute %', r.sig;
  end loop;
end $$;

-- The two this migration is directly responsible for keep their intended grant.
-- Stated explicitly rather than relying on the loop above having left them
-- alone, because the loop only ever REMOVES rights.
grant execute on function public.price_per_unit(numeric, numeric, integer) to authenticated, service_role;
grant execute on function public.get_setup_gaps() to authenticated, service_role;

-- ── PROVE IT, BY ASKING RATHER THAN ASSUMING ────────────────────────────────
do $$
declare v_open text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_open
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.proname <> 'keepalive'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_open is not null then
    raise exception 'anon can still execute: %', v_open;
  end if;
end $$;

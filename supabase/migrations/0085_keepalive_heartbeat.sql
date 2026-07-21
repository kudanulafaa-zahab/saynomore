-- 0085 — Keep-alive heartbeat
--
-- Supabase's Free plan pauses a project after 7 days with no *user* database
-- activity. Internal pg_cron jobs don't count — it wants a query that arrives
-- from outside. This function is that heartbeat: a scheduled GitHub Action
-- calls it every day so the project never goes quiet long enough to pause.
--
-- It is deliberately anon-executable (the one sanctioned exception to the
-- "revoke anon" rule): it takes no input, touches no table, and returns only
-- the server clock, so exposing it leaks nothing. search_path is pinned and
-- grants are explicit, per the backend laws.
create or replace function public.keepalive()
returns timestamptz
language sql
security definer
set search_path = ''
as $$ select now() $$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

comment on function public.keepalive() is
  'External heartbeat to keep the Free-plan project from pausing. Returns server time only; no data access. Called by the keepalive GitHub Action.';

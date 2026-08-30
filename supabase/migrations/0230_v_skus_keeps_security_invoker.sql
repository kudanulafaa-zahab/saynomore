-- 0230 — v_skus keeps security_invoker through a rebuild.
--
-- 0228 and 0229 patched v_skus by reading pg_get_viewdef, replacing one
-- expression and running `create or replace view public.v_skus as <def>`.
--
-- pg_get_viewdef RETURNS ONLY THE QUERY. It does not return the view's
-- options. So each rebuild silently dropped `security_invoker`, and v_skus
-- went back to running with its OWNER's rights — which bypasses row level
-- security on skus entirely.
--
-- Every other view in public carries security_invoker. v_skus was the only one
-- without it, and it was not without it yesterday: 0228 took it off.
--
-- rls_surface.test.sql caught this on the first replay — "every view in public
-- runs as the CALLER, so row level security still applies", have v_skus, want
-- none. That test has been sitting there for exactly this, and it is the only
-- reason this was found before anyone relied on it.
--
-- ── WHAT WAS ACTUALLY REACHABLE: NOTHING NEW ─────────────────────────────
--
-- Measured rather than assumed, because "a view stopped enforcing RLS" invites
-- a worse conclusion than the facts support:
--
--   anon           still blocked. v_skus reads through v_batch_stock, which
--                  kept its own security_invoker, so RLS was still enforced
--                  one level down and anon got a permission error either way.
--   authenticated  no change. skus_read is `auth.uid() IS NOT NULL`, so every
--                  signed-in user could already read every SKU.
--
-- So the setting was wrong for about forty minutes and no data was reachable
-- that was not already reachable. It is still a real defect — a view that must
-- run as the caller was not — and it is fixed here rather than argued away.
--
-- ── THE FIX, AND WHY IT IS ALSO IN THE PATCH BLOCKS ───────────────────────
--
-- Set here so production is correct immediately. 0228 and 0229 also gained an
-- `alter view ... set (security_invoker = on)` line, so a replay from empty
-- ends in the same place rather than reintroducing the hole and relying on
-- this migration to mop up afterwards.

alter view public.v_skus set (security_invoker = on);

do $$
declare
  v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not exists (
      select 1 from unnest(coalesce(c.reloptions, '{}')) o
       where o in ('security_invoker=on', 'security_invoker=true')
    );
  if v_bad is not null then
    raise exception 'view(s) still run as their owner and bypass row level security: %', v_bad;
  end if;
end $$;

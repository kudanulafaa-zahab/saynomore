-- 0110 — Drop the stale 3-argument record_verification overload.
--
-- 0108 added p_scope_lines with a default, intending to extend the function.
-- `create or replace` cannot change a function's argument list, so it created a
-- SECOND function rather than replacing the first. Both then existed:
--
--   record_verification(uuid, jsonb, text)
--   record_verification(uuid, jsonb, text, integer)
--
-- and a three-argument call became ambiguous. Proven, not assumed:
--
--   ERROR: function record_verification(uuid, jsonb, unknown) is not unique
--
-- The app happens to send all four named arguments, so saving a count still
-- works today — but the old overload is dead code that silently ignores
-- scope_lines, and any caller passing three arguments now fails outright.
--
-- Dropping the old signature is safe: the 4-argument version accepts a
-- 3-argument call through its default, so it fully replaces it.

drop function if exists public.record_verification(uuid, jsonb, text);

-- Re-assert the grants on the surviving signature.
revoke execute on function public.record_verification(uuid, jsonb, text, int) from public, anon;
grant  execute on function public.record_verification(uuid, jsonb, text, int) to authenticated, service_role;

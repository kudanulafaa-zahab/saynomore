-- 0169 — the two recurring-cost helpers stop being callable from the app.
--
-- 0167 wrote `revoke execute ... from public` and `from anon` for both, which
-- looked complete. Running the security advisor afterwards showed all three new
-- functions still carrying `authenticated=X` — including
-- trg_recurring_expenses_materialise(), a TRIGGER function that nothing should
-- ever call directly, now sitting on /rest/v1/rpc/.
--
-- Cause: Supabase ships `alter default privileges ... grant execute on
-- functions to authenticated` for the public schema, so every new function is
-- granted at creation, after the REVOKEs in the migration have run. This is the
-- same shape as the implicit-PUBLIC finding in HANDOFF 10a and the same lesson:
-- THE REVOKE YOU WROTE IS NOT THE GRANT YOU END UP WITH. Check the catalog
-- afterwards; do not trust the statement.
--
-- Neither function needs to be reachable from the app. The trigger fires on
-- insert/update, and pg_cron runs the monthly catch-up.
--
-- SAFE, AND VERIFIED RATHER THAN ASSUMED: Postgres checks EXECUTE on a trigger
-- function at CREATE TRIGGER time, not when the trigger fires. Proven on
-- production by inserting a recurring expense as `authenticated` with
-- request.jwt.claims set to a real admin — the generated business_expenses row
-- appeared with the grant already revoked. The same test also confirmed RLS:
-- the identical insert WITHOUT an admin uid was refused with 42501.

revoke execute on function trg_recurring_expenses_materialise() from authenticated;
revoke execute on function materialise_recurring_expenses(date)  from authenticated;

-- 0083: Re-assert anon lockdown on functions recreated after 0076.
-- CREATE OR REPLACE resets privileges to the default for newly created
-- functions, and get_dashboard_metrics (recreated in 0080/0081) and
-- get_reorder_suggestions (recreated in 0078) came back anon-executable —
-- caught by the security advisor. Same rule as 0076: business data is never
-- readable without signing in.

revoke execute on function public.get_dashboard_metrics() from public, anon;
grant execute on function public.get_dashboard_metrics() to authenticated, service_role;

revoke execute on function public.get_reorder_suggestions(numeric, numeric) from public, anon;
grant execute on function public.get_reorder_suggestions(numeric, numeric) to authenticated, service_role;

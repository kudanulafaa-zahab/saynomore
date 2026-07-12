-- 0069: Revoke anon execution on SECURITY DEFINER RPCs.
-- Security advisor (12 Jul): four functions were callable by the anon role.
-- The three write RPCs are internally guarded by is_admin_or_manager(), but
-- get_pricing_health() had no role check — landed costs and margins were
-- readable without signing in. All app calls run as `authenticated`, which
-- keeps EXECUTE; anon loses it.
REVOKE EXECUTE ON FUNCTION public.get_pricing_health() FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_target_prices(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_sales_order(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.edit_sales_order_line(uuid, integer, numeric) FROM anon;

-- 0125 — Restore security_invoker=true on views touched by migration 0124.
--
-- Self-caught regression: migration 0124's `CREATE OR REPLACE VIEW` for
-- v_order_balances, v_batch_stock and v_stock_levels omitted the
-- `WITH (security_invoker = true)` clause those views were originally
-- created with (migrations 0058 and 0053, the latter an explicit security
-- hardening pass) — CREATE OR REPLACE VIEW does not preserve reloptions
-- unless restated, so all three silently reverted to the default
-- (security definer-equivalent) behavior. Caught by re-running the
-- Supabase security advisor immediately after 0124 and seeing new ERROR-
-- level "Security Definer View" findings on exactly these three views.
-- No logic changes here — same view bodies as 0124, just the missing
-- option restored.

ALTER VIEW public.v_order_balances SET (security_invoker = true);
ALTER VIEW public.v_batch_stock    SET (security_invoker = true);
ALTER VIEW public.v_stock_levels   SET (security_invoker = true);

-- ============================================================================
-- 0094 — Allow 'write_off' as an audit_log action
-- ============================================================================
-- 0093's write_off_stock() logs the write-off with action='write_off', but
-- audit_log_action_check only allowed insert/update/delete — so every write-off
-- failed at the audit insert and rolled the whole thing back (stock untouched,
-- UI stuck on an error). Widen the constraint to include the distinct,
-- meaningful 'write_off' action. Additive — no existing row or code is affected.
-- ============================================================================

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text, 'write_off'::text]));

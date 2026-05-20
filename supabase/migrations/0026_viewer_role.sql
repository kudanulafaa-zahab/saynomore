-- Migration 0026: Add viewer role
-- Viewer can read everything, write nothing.
-- RLS write policies already gate on is_admin_or_manager() or explicit staff checks,
-- so viewer is automatically excluded from all writes without any policy changes.
-- We only need to widen the CHECK constraint on user_profiles.role.

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_role_check
    CHECK (role IN ('admin', 'manager', 'staff', 'viewer'));

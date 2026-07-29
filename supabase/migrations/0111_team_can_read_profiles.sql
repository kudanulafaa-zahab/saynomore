-- 0111 — Managers can't see their own team. Fix the driver dropdown.
--
-- THE BUG, live today
-- user_profiles read policy was:  id = auth.uid() OR is_admin()
-- so a MANAGER could only ever read their own row. Eena is a manager, and:
--
--   profiles Eena can see: 1  ("Eena")
--
-- Two daily screens read this table directly to list drivers —
-- sale-detail.tsx ("Assign Driver & Dispatch") and dispatch-view.tsx — so for
-- Eena the driver list contains only herself. She cannot assign a delivery to
-- Ibrahim at all. Nobody reported it because Ali is an admin and the policy
-- lets admins through, so it works perfectly for the one person testing it.
--
-- THE FIX
-- Reading who your colleagues are is not privileged information: the table
-- holds id, full_name, role and phone — no email, no credentials. Everyone who
-- can see the business (admin, manager, viewer) can now read the team; a staff
-- driver still sees only themselves, which is all their screen needs.
--
-- Writes are untouched and remain admin-only (up_admin_write, is_admin()), so
-- a manager still cannot change roles, invite or remove anyone.

drop policy if exists up_select_self on public.user_profiles;

create policy up_select_self on public.user_profiles
  for select using (
    id = (select auth.uid())              -- always see yourself
    or is_admin_manager_or_viewer()       -- office roles see the team
  );

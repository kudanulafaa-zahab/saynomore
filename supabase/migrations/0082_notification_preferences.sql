-- 0082: Notification preferences — per-user, per-category, admin-assignable.
--
-- Categories map 1:1 to the app's real senders:
--   delivery — driver assignments + delivered confirmations (CRITICAL: users
--              cannot switch it off themselves; only an admin can)
--   money    — payments recorded, orders voided or deleted
--   stock    — GRN margin summaries + the daily low-stock digest
--
-- Absence of a row = enabled. That is the "on by default": every category is
-- on for every user until someone writes a row saying otherwise.
-- Effective = admin_enabled AND (user_enabled OR category = 'delivery').
-- Enforcement lives server-side in the send-push edge function via
-- notification_allowed(), so no client can bypass it.

create table if not exists public.user_notification_prefs (
  user_id       uuid not null references public.user_profiles(id) on delete cascade,
  category      text not null check (category in ('delivery','money','stock')),
  admin_enabled boolean not null default true,
  user_enabled  boolean not null default true,
  updated_at    timestamptz not null default now(),
  primary key (user_id, category)
);

alter table public.user_notification_prefs enable row level security;

-- Reads: own rows, or any row for admins. All writes go through the RPCs.
drop policy if exists "read notification prefs" on public.user_notification_prefs;
create policy "read notification prefs" on public.user_notification_prefs
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.user_profiles up
      where up.id = (select auth.uid()) and up.role = 'admin'
    )
  );

grant select on public.user_notification_prefs to authenticated;
grant all on public.user_notification_prefs to service_role;

-- ── The single decision point the send path consults ────────────────────────
create or replace function public.notification_allowed(p_user uuid, p_category text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select p.admin_enabled and (p.user_enabled or p.category = 'delivery')
       from public.user_notification_prefs p
      where p.user_id = p_user and p.category = p_category),
    true);
$$;
revoke execute on function public.notification_allowed(uuid, text) from public, anon;
grant execute on function public.notification_allowed(uuid, text) to authenticated, service_role;

-- ── Recipient filter for digests / role fan-outs (used by edge functions) ───
create or replace function public.get_notification_recipients(p_roles text[], p_category text)
returns table (user_id uuid)
language sql stable security definer
set search_path = public
as $$
  select up.id
    from public.user_profiles up
   where up.role = any(p_roles)
     and public.notification_allowed(up.id, p_category);
$$;
revoke execute on function public.get_notification_recipients(text[], text) from public, anon;
grant execute on function public.get_notification_recipients(text[], text) to authenticated, service_role;

-- ── Settings screen: full category list with defaults filled in ─────────────
create or replace function public.get_notification_prefs(p_user uuid default null)
returns table (category text, admin_enabled boolean, user_enabled boolean)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_target uuid := coalesce(p_user, v_caller);
begin
  if v_caller is null then
    raise exception 'Not signed in';
  end if;
  if v_target <> v_caller and not exists (
    select 1 from public.user_profiles up where up.id = v_caller and up.role = 'admin'
  ) then
    raise exception 'Only administrators can view other users'' notification settings';
  end if;

  return query
    select c.cat,
           coalesce(p.admin_enabled, true),
           coalesce(p.user_enabled, true)
      from unnest(array['delivery','money','stock']) with ordinality as c(cat, ord)
      left join public.user_notification_prefs p
        on p.user_id = v_target and p.category = c.cat
     order by c.ord;
end $$;
revoke execute on function public.get_notification_prefs(uuid) from public, anon;
grant execute on function public.get_notification_prefs(uuid) to authenticated, service_role;

-- ── User switches their own non-critical categories ─────────────────────────
create or replace function public.set_my_notification_pref(p_category text, p_enabled boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'Not signed in';
  end if;
  if p_category = 'delivery' then
    raise exception 'Delivery alerts are critical and always stay on';
  end if;
  if p_category not in ('money','stock') then
    raise exception 'Unknown notification category: %', p_category;
  end if;

  insert into public.user_notification_prefs (user_id, category, user_enabled)
  values (v_caller, p_category, p_enabled)
  on conflict (user_id, category)
  do update set user_enabled = excluded.user_enabled, updated_at = now();
end $$;
revoke execute on function public.set_my_notification_pref(text, boolean) from public, anon;
grant execute on function public.set_my_notification_pref(text, boolean) to authenticated, service_role;

-- ── Admin assigns which categories a user receives (delivery included) ──────
create or replace function public.admin_set_notification_pref(
  p_user uuid, p_category text, p_enabled boolean
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_old boolean;
begin
  if not exists (
    select 1 from public.user_profiles up where up.id = v_caller and up.role = 'admin'
  ) then
    raise exception 'Only administrators can assign notifications';
  end if;
  if p_category not in ('delivery','money','stock') then
    raise exception 'Unknown notification category: %', p_category;
  end if;

  select coalesce(
    (select p.admin_enabled from public.user_notification_prefs p
      where p.user_id = p_user and p.category = p_category),
    true)
  into v_old;

  insert into public.user_notification_prefs (user_id, category, admin_enabled)
  values (p_user, p_category, p_enabled)
  on conflict (user_id, category)
  do update set admin_enabled = excluded.admin_enabled, updated_at = now();

  if v_old is distinct from p_enabled then
    insert into public.audit_log
      (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
    values
      ('user_notification_prefs', p_user, 'update', p_category || '.admin_enabled',
       case when v_old then 'on' else 'off' end,
       case when p_enabled then 'on' else 'off' end,
       'Admin set ' || p_category || ' notifications ' || case when p_enabled then 'on' else 'off' end,
       v_caller);
  end if;
end $$;
revoke execute on function public.admin_set_notification_pref(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_notification_pref(uuid, text, boolean) to authenticated, service_role;

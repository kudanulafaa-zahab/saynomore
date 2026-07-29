-- 0106 — Make the Viewer role actually work: sees everything, changes nothing.
--
-- THE BUG
-- Viewer is offered the full read navigation (VIEWER_NAV = everything except
-- Dispatch), but three tables restricted SELECT to admin/manager:
--     sales_orders, sales_order_lines, audit_log
-- So a viewer opened Sales to a permanently empty list, Financials to zeroes,
-- and would reasonably conclude the app was broken. Nobody has hit it because
-- there are no viewer accounts yet — which is exactly why it's worth fixing
-- before someone is handed one.
--
-- WHAT "SEE EVERYTHING, EDIT NOTHING" MEANS HERE
-- Read: viewer joins admin/manager on the three restricted tables. Every other
-- table already reads on "logged in", so viewer was fine there.
--
-- Write: verified closed on both doors before widening the read door.
--   1. Table policies — every write policy is ALL ... USING is_admin_or_manager()
--      (or is_admin() for price lists and user_profiles), so viewer matches none.
--   2. RPCs — all twelve money/stock mutators (post_sale, void_sales_order,
--      delete_sales_order, edit_sales_order_line, confirm_grn, admin_void_grn,
--      write_off_stock, record_customer_return, set_cash_balance,
--      apply_target_prices, admin_invite_user, admin_delete_sku) raise on
--      anything below manager. A viewer cannot call one.
--
-- ONE HOLE CLOSED WHILE HERE
-- audit_log INSERT was WITH CHECK (auth.uid() IS NOT NULL) — any logged-in
-- user, viewer included, could write audit rows by hand. That is a write, and
-- worse, a write into the tamper-evidence trail. Every function that legitimately
-- writes audit_log is SECURITY DEFINER (19 of them: confirm_grn, void_sales_order,
-- write_off_stock, record_verification, …), so they bypass RLS entirely and are
-- unaffected by tightening this. No client code inserts audit rows directly.

-- ── Read-all roles ──────────────────────────────────────────────────────────
create or replace function public.is_admin_manager_or_viewer()
returns boolean
language sql
stable
set search_path = public
as $$ select current_user_role() in ('admin','manager','viewer'); $$;

comment on function public.is_admin_manager_or_viewer() is
  'Roles allowed to READ the whole business: admin, manager, viewer. Viewer is '
  'read-only — every write policy and every mutating RPC still gates on '
  'is_admin_or_manager() or is_admin().';

revoke execute on function public.is_admin_manager_or_viewer() from public, anon;
grant execute on function public.is_admin_manager_or_viewer() to authenticated, service_role;

-- ── Widen the three restricted reads ────────────────────────────────────────
drop policy if exists so_mgr_select on public.sales_orders;
create policy so_mgr_select on public.sales_orders
  for select using (is_admin_manager_or_viewer());

drop policy if exists sol_mgr_select on public.sales_order_lines;
create policy sol_mgr_select on public.sales_order_lines
  for select using (is_admin_manager_or_viewer());

drop policy if exists al_read on public.audit_log;
create policy al_read on public.audit_log
  for select using (is_admin_manager_or_viewer());

-- ── Close the hand-written audit_log insert ─────────────────────────────────
drop policy if exists al_insert on public.audit_log;
create policy al_insert on public.audit_log
  for insert with check (is_admin_or_manager());

-- ── Document history follows the same rule ──────────────────────────────────
-- get_order_audit is SECURITY DEFINER (it resolves actor names from
-- user_profiles), so it re-applies the sales_orders read policy by hand. That
-- copy needs viewer too, or a viewer would see a cancelled order with no reason
-- on it — the exact dead end fixed in 0103.
create or replace function public.get_order_audit(p_order_id uuid)
returns table (
  id         uuid,
  action     text,
  field_name text,
  old_value  text,
  new_value  text,
  reason     text,
  changed_by uuid,
  changed_by_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id, a.action, a.field_name, a.old_value, a.new_value, a.reason,
    a.changed_by,
    coalesce(up.full_name, 'System') as changed_by_name,
    a.created_at
  from audit_log a
  left join user_profiles up on up.id = a.changed_by
  where a.table_name = 'sales_orders'
    and a.record_id  = p_order_id
    and exists (
      select 1 from sales_orders o
      where o.id = p_order_id
        and (
          is_admin_manager_or_viewer()
          or ((select current_user_role()) = 'staff'
              and o.assigned_driver_id = (select auth.uid()))
        )
    )
  order by a.created_at desc
  limit 100;
$$;

revoke execute on function public.get_order_audit(uuid) from public, anon;
grant execute on function public.get_order_audit(uuid) to authenticated, service_role;

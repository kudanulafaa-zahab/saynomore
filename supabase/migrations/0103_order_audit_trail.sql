-- 0103 — Document history for a sales order.
--
-- A cancelled order opened to a dead end: a red "Order cancelled" strip, the
-- customer card, and nothing else. No items, no money, no reason, no who or
-- when. Ali's screenshot of SO-2026-055.
--
-- The information was never missing — void_sales_order already writes it:
--   "voided — 1 stock movement(s) reversed. Reason: Wrong order entered"
-- with changed_by and created_at. Nothing read it back.
--
-- ERP convention for a voided document (SAP, NetSuite, Xero, QuickBooks all
-- behave this way): the document is NEVER deleted or blanked. It stays fully
-- readable — same lines, same amounts — stamped VOID, carrying who voided it,
-- when, why, and what the void reversed. That is what makes it auditable, and
-- it is the whole reason void exists instead of delete.
--
-- This returns the trail with the actor's NAME resolved. audit_log.changed_by
-- is a uuid, and user_profiles is not readable row-by-row from the client for
-- other users, so the join happens here.

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
security definer          -- to resolve actor names from user_profiles
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
    -- SECURITY DEFINER bypasses RLS, so the sales_orders read policy is
    -- re-applied EXPLICITLY here. A plain `exists (select 1 from sales_orders
    -- where id = p_order_id)` would NOT do it — inside a definer function that
    -- subquery also runs without RLS and is true for every order. This mirrors
    -- so_mgr_select / so_staff_read by hand: managers and admins see any
    -- order's history, a staff driver only their own runs.
    and exists (
      select 1 from sales_orders o
      where o.id = p_order_id
        and (
          is_admin_or_manager()
          or ((select current_user_role()) = 'staff'
              and o.assigned_driver_id = (select auth.uid()))
        )
    )
  order by a.created_at desc
  limit 100;
$$;

revoke execute on function public.get_order_audit(uuid) from public, anon;
grant execute on function public.get_order_audit(uuid) to authenticated, service_role;

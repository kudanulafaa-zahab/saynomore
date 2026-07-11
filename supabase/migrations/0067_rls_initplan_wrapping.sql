-- 0067: Wrap per-row auth function calls in RLS policies in scalar subselects.
-- (select auth.uid()) is evaluated once per statement (InitPlan) instead of
-- once per row, per Supabase lint 0003_auth_rls_initplan. No semantic change.

-- Simple "any authenticated user can read" policies
alter policy brands_read               on public.brands               using ((select auth.uid()) is not null);
alter policy product_models_read       on public.product_models       using ((select auth.uid()) is not null);
alter policy variants_read             on public.variants             using ((select auth.uid()) is not null);
alter policy skus_read                 on public.skus                 using ((select auth.uid()) is not null);
alter policy suppliers_read            on public.suppliers            using ((select auth.uid()) is not null);
alter policy customers_read            on public.customers            using ((select auth.uid()) is not null);
alter policy godowns_read              on public.godowns              using ((select auth.uid()) is not null);
alter policy competitors_read          on public.competitors          using ((select auth.uid()) is not null);
alter policy competitor_prices_read    on public.competitor_prices    using ((select auth.uid()) is not null);
alter policy marketing_spend_read      on public.marketing_spend      using ((select auth.uid()) is not null);
alter policy marketing_spend_skus_read on public.marketing_spend_skus using ((select auth.uid()) is not null);
alter policy ship_read                 on public.shipments            using ((select auth.uid()) is not null);
alter policy shl_read                  on public.shipment_lines       using ((select auth.uid()) is not null);
alter policy ib_read                   on public.inventory_batches    using ((select auth.uid()) is not null);
alter policy sm_read                   on public.stock_movements      using ((select auth.uid()) is not null);
alter policy pc_read                   on public.product_categories   using ((select auth.uid()) is not null);
alter policy ec_read                   on public.expense_categories   using ((select auth.uid()) is not null);
alter policy be_read                   on public.business_expenses    using ((select auth.uid()) is not null);

alter policy order_payments_read on public.order_payments
  using ((select auth.role()) = 'authenticated');

-- INSERT policy: only WITH CHECK applies
alter policy al_insert on public.audit_log
  with check ((select auth.uid()) is not null);

-- Self/ownership policies
alter policy up_select_self on public.user_profiles
  using ((id = (select auth.uid())) or (select is_admin()));

alter policy owner on public.push_subscriptions
  using ((select auth.uid()) = user_id);

-- Admin write policies
alter policy price_lists_admin_write on public.price_lists
  using (exists (
    select 1 from user_profiles
    where user_profiles.id = (select auth.uid()) and user_profiles.role = 'admin'
  ))
  with check (exists (
    select 1 from user_profiles
    where user_profiles.id = (select auth.uid()) and user_profiles.role = 'admin'
  ));

alter policy price_list_items_admin_write on public.price_list_items
  using (exists (
    select 1 from user_profiles
    where user_profiles.id = (select auth.uid()) and user_profiles.role = 'admin'
  ))
  with check (exists (
    select 1 from user_profiles
    where user_profiles.id = (select auth.uid()) and user_profiles.role = 'admin'
  ));

-- Staff/driver policies
alter policy so_staff_read on public.sales_orders
  using (
    (select current_user_role()) = 'staff'
    and assigned_driver_id = (select auth.uid())
  );

alter policy so_staff_update on public.sales_orders
  using (
    (select current_user_role()) = 'staff'
    and assigned_driver_id = (select auth.uid())
  )
  with check (
    (select current_user_role()) = 'staff'
    and assigned_driver_id = (select auth.uid())
  );

alter policy sol_staff_read on public.sales_order_lines
  using (
    (select current_user_role()) = 'staff'
    and exists (
      select 1 from sales_orders so
      where so.id = sales_order_lines.order_id
        and so.assigned_driver_id = (select auth.uid())
    )
  );

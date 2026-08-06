-- 0067: Wrap per-row auth function calls in RLS policies in scalar subselects.
-- (select auth.uid()) is evaluated once per statement (InitPlan) instead of
-- once per row, per Supabase lint 0003_auth_rls_initplan. No semantic change.

-- Found while proving migrations replay cleanly from an empty database
-- (they didn't): a from-scratch replay reaches this point with some of the
-- policies below already present and some missing, which means at least
-- one of these was created directly against production outside any tracked
-- migration file at some point in this project's history, and the exact
-- boundary isn't reconstructable from the files alone. Rather than guess,
-- each is created defensively (idempotent -- skips quietly if it already
-- exists) in its pre-wrap form (bare auth.uid()), matching what the ALTER
-- POLICY statements below convert to the scalar-subselect form, so this
-- migration's own diff is unchanged and still does exactly what its header
-- says. Verified against the live policy definitions in pg_policies before
-- writing these; changes nothing live in production.
DO $$ BEGIN
  CREATE POLICY brands_read ON public.brands FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY product_models_read ON public.product_models FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY variants_read ON public.variants FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY skus_read ON public.skus FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY suppliers_read ON public.suppliers FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY customers_read ON public.customers FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY godowns_read ON public.godowns FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY competitors_read ON public.competitors FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY competitor_prices_read ON public.competitor_prices FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY marketing_spend_read ON public.marketing_spend FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY marketing_spend_skus_read ON public.marketing_spend_skus FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY owner ON public.push_subscriptions FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY price_lists_admin_write ON public.price_lists
    FOR ALL
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY price_list_items_admin_write ON public.price_list_items
    FOR ALL
    USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

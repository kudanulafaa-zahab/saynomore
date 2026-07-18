-- ============================================================================
-- 0076 — Security regression fix + FK covering indexes (2026-07-18 audit)
-- ============================================================================
-- Security advisor findings:
--
-- 1) Anon could EXECUTE 10 SECURITY DEFINER RPCs again. Migration 0069
--    revoked anon on the four functions flagged on 12 Jul, but every
--    function (re)created since (0070 receivables, 0072 promo/briefing,
--    0073 campaign ROI, plus recreations of older ones) came back with
--    Postgres' default ACL, which grants EXECUTE to PUBLIC — so anon crept
--    back in. The write RPCs are internally guarded by is_admin_or_manager()
--    but the dashboard read RPCs have no role check: revenue, receivables
--    (with customer names), landed costs and margins were readable by anyone
--    holding the public anon key. Fix structurally this time:
--      a) revoke PUBLIC/anon on ALL current functions,
--      b) grant authenticated/service_role explicitly (all app calls run as
--         authenticated; triggers fire regardless of EXECUTE privilege),
--      c) ALTER DEFAULT PRIVILEGES so functions created by future migrations
--         never auto-grant PUBLIC again — the "never again" that 0069 wasn't.
--
-- 2) v_expiring_stock was the ONLY view without security_invoker=true
--    (0071 forgot the WITH clause its sibling views all carry). As a
--    definer-rights view owned by postgres it bypassed RLS entirely, and
--    Supabase's default grants let anon SELECT from it — expiring stock,
--    quantities and godown names, no sign-in needed.
--
-- Performance advisor: add covering indexes for the FK columns real app
-- queries actually filter/join on (batch stock by godown, competitor price
-- lookups, price list items, campaign SKU pro-rating, v_skus' category
-- join, shipment lines by destination godown, verification lines by SKU,
-- shipments by supplier). Deliberately NOT indexing the created_by/
-- changed_by/verified_by audit columns — nothing queries them, and they'd
-- add write cost to the hottest insert paths (stock_movements, audit_log).
-- ============================================================================

-- ── 1a. Wipe PUBLIC/anon EXECUTE from every existing function ──────────────
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- ── 1b. Restore what the app actually uses ─────────────────────────────────
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- ── 1c. Future-proof: functions created from now on get no PUBLIC grant ────
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── 2. v_expiring_stock: same invoker rights as every other view ───────────
ALTER VIEW public.v_expiring_stock SET (security_invoker = true);
REVOKE SELECT ON public.v_expiring_stock FROM anon;

-- ── 3. FK covering indexes (queried columns only) ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_batches_godown       ON public.inventory_batches (godown_id);
CREATE INDEX IF NOT EXISTS idx_cp_competitor        ON public.competitor_prices (competitor_id);
CREATE INDEX IF NOT EXISTS idx_pli_sku              ON public.price_list_items (sku_id);
CREATE INDEX IF NOT EXISTS idx_mss_sku              ON public.marketing_spend_skus (sku_id);
CREATE INDEX IF NOT EXISTS idx_be_category          ON public.business_expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_pm_category          ON public.product_models (category_id);
CREATE INDEX IF NOT EXISTS idx_sl_dest_godown       ON public.shipment_lines (destination_godown_id);
CREATE INDEX IF NOT EXISTS idx_shipments_supplier   ON public.shipments (supplier_id);
CREATE INDEX IF NOT EXISTS idx_svl_sku              ON public.stock_verification_lines (sku_id);

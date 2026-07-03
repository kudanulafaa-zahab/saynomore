-- ── Migration 0053: Security hardening (Supabase advisor findings) ──
--
-- Found via Supabase security advisors + manual verification 2026-07-02.
-- Confirmed exploitable in production before this migration:
--
--  (1) v_skus / v_batch_stock / v_stock_levels were SECURITY DEFINER views
--      (bypass RLS) AND anon had SELECT on them → the full product catalog,
--      selling prices, landed costs and stock levels were readable by anyone
--      on the internet holding the public anon key (which ships in the
--      client JS bundle). Fix: security_invoker = true so the querying
--      user's RLS applies (every underlying table already has an
--      auth.uid() IS NOT NULL read policy, so logged-in behavior is
--      unchanged), plus belt-and-suspenders REVOKE from anon.
--
--  (2) Every SECURITY DEFINER function in public was executable by anon,
--      including the financial reads (get_dashboard_metrics,
--      get_reports_data, ...) and the two core financial writes
--      (confirm_grn, post_sale) which had business guards but NO auth
--      guard. Fix: blanket revoke from PUBLIC/anon, grant to
--      authenticated + service_role, same for default privileges so
--      future functions are locked down automatically.
--
--  (3) confirm_grn and post_sale gain an explicit is_admin_or_manager()
--      guard — matching the app's role model (staff = delivery only,
--      viewer = read only) and the reopen_grn/void guards from 0048/0050.
--      Defense in depth: even if grants regress, the functions refuse.
--
--  (4) The 8 functions flagged "search_path mutable" get a pinned
--      search_path (schema-hijack hardening).
--
-- NOT fixed here (dashboard/config, not SQL): Auth OTP long expiry,
-- leaked-password protection disabled, pg_net extension in public schema.

BEGIN;

-- ── (1) Views: respect the querying user's RLS; block anon outright ────────
ALTER VIEW public.v_skus         SET (security_invoker = true);
ALTER VIEW public.v_batch_stock  SET (security_invoker = true);
ALTER VIEW public.v_stock_levels SET (security_invoker = true);

REVOKE SELECT ON public.v_skus, public.v_batch_stock, public.v_stock_levels FROM anon;

-- ── (2) Functions: authenticated users only ─────────────────────────────────
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Future functions created by migrations inherit the same lockdown.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT  EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT  EXECUTE ON FUNCTIONS TO service_role;

-- The signup trigger runs as the auth service — keep it explicitly allowed.
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

-- ── (4) Pin search_path on the advisor-flagged functions ───────────────────
ALTER FUNCTION public.block_grn_rate_changes()                 SET search_path = public;
ALTER FUNCTION public.set_updated_at()                         SET search_path = public;
ALTER FUNCTION public.is_admin()                               SET search_path = public;
ALTER FUNCTION public.is_admin_or_manager()                    SET search_path = public;
ALTER FUNCTION public.stock_signed_delta(text, integer)        SET search_path = public;
ALTER FUNCTION public.derive_idr_to_mvr()                      SET search_path = public;
ALTER FUNCTION public.round_selling_prices_price_list_items()  SET search_path = public;
ALTER FUNCTION public.round_selling_prices_skus()              SET search_path = public;

-- ── (3a) confirm_grn: add auth guard. Body is 0039 verbatim + the guard. ───
CREATE OR REPLACE FUNCTION confirm_grn(p_shipment_id UUID, p_godown_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ship        shipments%ROWTYPE;
  v_total_cbm   NUMERIC := 0;
  v_freight_mvr NUMERIC := 0;
  v_local_mvr   NUMERIC := 0;
  v_pool_mvr    NUMERIC := 0;
  v_user        UUID    := auth.uid();
BEGIN
  -- [0053] Auth guard: receiving stock is an admin/manager action.
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only admin or manager can confirm a GRN';
  END IF;

  -- ── Guards ────────────────────────────────────────────────────────────────
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment % not found', p_shipment_id;
  END IF;
  IF v_ship.status = 'grn_confirmed' THEN
    RAISE EXCEPTION 'Shipment already confirmed';
  END IF;
  IF v_ship.rate_usd_to_mvr IS NULL OR v_ship.rate_usd_to_mvr <= 0 THEN
    RAISE EXCEPTION 'USD→MVR rate required';
  END IF;
  IF v_ship.rate_idr_to_mvr IS NULL OR v_ship.rate_idr_to_mvr <= 0 THEN
    RAISE EXCEPTION 'IDR→MVR rate required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM shipment_lines
    WHERE shipment_id = p_shipment_id AND cbm_per_carton <= 0
  ) THEN
    RAISE EXCEPTION 'All lines must have CBM > 0';
  END IF;
  IF EXISTS (
    SELECT 1 FROM shipment_lines
    WHERE shipment_id = p_shipment_id
      AND COALESCE(qty_cartons_actual, qty_cartons) = 0
  ) THEN
    RAISE EXCEPTION 'Actual received qty cannot be zero — remove the line instead';
  END IF;

  IF EXISTS (
    SELECT 1 FROM shipment_lines
    WHERE shipment_id = p_shipment_id
      AND destination_godown_id IS NULL
      AND p_godown_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Destination warehouse required — choose where stock was received';
  END IF;

  -- ── CBM total: uses ORDERED qty (freight paid for space, not what arrived) ─
  SELECT COALESCE(SUM(qty_cartons * cbm_per_carton), 0)
    INTO v_total_cbm
    FROM shipment_lines
   WHERE shipment_id = p_shipment_id;

  IF v_total_cbm <= 0 THEN
    RAISE EXCEPTION 'Shipment has no carton volume';
  END IF;

  v_freight_mvr := COALESCE(v_ship.my_freight_share_usd, 0) * v_ship.rate_usd_to_mvr;
  v_local_mvr   := COALESCE(v_ship.customs_duty_mvr,  0)
                 + COALESCE(v_ship.mpl_charges_mvr,   0)
                 + COALESCE(v_ship.agent_fee_mvr,      0)
                 + COALESCE(v_ship.last_mile_mvr,      0)
                 + COALESCE(v_ship.insurance_mvr,      0)
                 + COALESCE(v_ship.other_mvr,          0);
  v_pool_mvr    := v_freight_mvr + v_local_mvr;

  -- ── Step 1: compute & write per-line costs ────────────────────────────────
  WITH calc AS (
    SELECT
      sl.id,
      sl.sku_id,
      sl.qty_cartons,
      COALESCE(sl.qty_cartons_actual, sl.qty_cartons) AS qty_act,
      sl.cbm_per_carton,
      sl.destination_godown_id,
      sl.fob_per_carton,
      sl.fob_currency,
      sl.estimated_landed_per_piece_mvr,
      s.pcs_per_pack,
      s.packs_per_carton,
      pc.unit_uom,
      pc.cost_basis,
      (v.attributes->>'unit_size')::NUMERIC AS unit_size_attr,
      (v.attributes->>'volume_ml')::NUMERIC AS volume_ml_attr,
      (v.attributes->>'weight_g')::NUMERIC  AS weight_g_attr,
      (COALESCE(sl.qty_cartons_actual, sl.qty_cartons) * sl.fob_per_carton *
        CASE sl.fob_currency
          WHEN 'IDR' THEN v_ship.rate_idr_to_mvr
          WHEN 'USD' THEN v_ship.rate_usd_to_mvr
          ELSE 1
        END
      ) AS fob_total_mvr,
      (sl.qty_cartons * sl.cbm_per_carton / v_total_cbm) AS cbm_share
    FROM shipment_lines sl
    JOIN skus              s  ON s.id  = sl.sku_id
    JOIN variants          v  ON v.id  = s.variant_id
    JOIN product_models    m  ON m.id  = v.model_id
    JOIN product_categories pc ON pc.id = m.category_id
    WHERE sl.shipment_id = p_shipment_id
  ),
  ap AS (
    SELECT *,
      cbm_share * v_freight_mvr                AS app_freight,
      cbm_share * v_local_mvr                  AS app_local,
      fob_total_mvr + (cbm_share * v_pool_mvr) AS landed_total
    FROM calc
  ),
  per AS (
    SELECT *,
      ROUND(landed_total / qty_act,                                        4) AS per_carton,
      ROUND(landed_total / (qty_act * packs_per_carton),                   4) AS per_pack,
      ROUND(landed_total / (qty_act * packs_per_carton * pcs_per_pack),    4) AS per_piece,
      CASE cost_basis
        WHEN 'piece' THEN
          ROUND(landed_total / (qty_act * packs_per_carton * pcs_per_pack), 4)
        WHEN 'per_100ml' THEN
          ROUND(
            (landed_total / (qty_act * packs_per_carton * pcs_per_pack))
            / (COALESCE(volume_ml_attr, unit_size_attr, 1) / 100.0), 4)
        WHEN 'per_100g' THEN
          ROUND(
            (landed_total / (qty_act * packs_per_carton * pcs_per_pack))
            / (COALESCE(weight_g_attr, unit_size_attr, 1) / 100.0), 4)
        ELSE
          ROUND(landed_total / (qty_act * packs_per_carton * pcs_per_pack), 4)
      END AS per_unit
    FROM ap
  )
  UPDATE shipment_lines sl SET
    fob_total_mvr           = p.fob_total_mvr,
    apportioned_freight_mvr = p.app_freight,
    apportioned_local_mvr   = p.app_local,
    landed_total_mvr        = p.landed_total,
    landed_per_carton_mvr   = p.per_carton,
    landed_per_pack_mvr     = p.per_pack,
    landed_per_piece_mvr    = p.per_piece,
    landed_per_unit_mvr     = p.per_unit,
    grn_variance_pct        = CASE
      WHEN p.estimated_landed_per_piece_mvr IS NOT NULL
       AND p.estimated_landed_per_piece_mvr > 0
      THEN ROUND(
        (p.per_piece - p.estimated_landed_per_piece_mvr)
        / p.estimated_landed_per_piece_mvr * 100, 2)
      ELSE NULL
    END
  FROM per p
  WHERE sl.id = p.id;

  -- ── Step 2: create inventory batches using ACTUAL qty + loose packs ───────
  INSERT INTO inventory_batches
    (shipment_line_id, sku_id, godown_id,
     qty_cartons_received, qty_pieces_received,
     landed_per_piece_mvr, landed_per_pack_mvr,
     landed_per_carton_mvr, landed_per_unit_mvr)
  SELECT
    sl.id,
    sl.sku_id,
    COALESCE(sl.destination_godown_id, p_godown_id),
    COALESCE(sl.qty_cartons_actual, sl.qty_cartons),
    ( COALESCE(sl.qty_cartons_actual, sl.qty_cartons) * s.packs_per_carton
      + COALESCE(sl.qty_loose_packs, 0) ) * s.pcs_per_pack,
    sl.landed_per_piece_mvr,
    sl.landed_per_pack_mvr,
    sl.landed_per_carton_mvr,
    sl.landed_per_unit_mvr
  FROM shipment_lines sl
  JOIN skus s ON s.id = sl.sku_id
  WHERE sl.shipment_id = p_shipment_id;

  -- ── Step 3: post stock movements 'in' ─────────────────────────────────────
  INSERT INTO stock_movements
    (batch_id, sku_id, godown_id, movement_type, qty_pieces,
     source_type, source_id, created_by)
  SELECT
    b.id, b.sku_id, b.godown_id, 'in',
    b.qty_pieces_received,
    'shipment', p_shipment_id, v_user
  FROM inventory_batches b
  WHERE b.shipment_line_id IN (
    SELECT id FROM shipment_lines WHERE shipment_id = p_shipment_id
  );

  -- ── Step 4: lock the shipment ──────────────────────────────────────────────
  UPDATE shipments SET
    status           = 'grn_confirmed',
    grn_confirmed_at = now(),
    grn_confirmed_by = v_user
  WHERE id = p_shipment_id;

  -- ── Step 5: audit ──────────────────────────────────────────────────────────
  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('shipments', p_shipment_id, 'update',
          'GRN confirmed; landed costs locked; actual qty used for stock', v_user);

  RETURN p_shipment_id;
END $$;

-- ── (3b) post_sale: add auth guard. Body is current prod verbatim + guard. ──
CREATE OR REPLACE FUNCTION public.post_sale(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order       sales_orders%ROWTYPE;
  v_line        RECORD;
  v_batch       RECORD;
  v_remaining   INTEGER;
  v_take        INTEGER;
  v_user        UUID := auth.uid();
  v_cost_sum    NUMERIC;
  v_qty_sold    INTEGER;
  v_avg_cost    NUMERIC;
  v_price_per_piece NUMERIC;
  v_margin      NUMERIC;
BEGIN
  -- [0053] Auth guard: posting a sale deducts stock and locks in cost/margin
  -- — admin/manager only (staff are delivery-only, viewers read-only).
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only admin or manager can post a sale';
  END IF;

  SELECT * INTO v_order FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.source_godown_id IS NULL THEN RAISE EXCEPTION 'Source godown required'; END IF;
  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'Order already posted (status: %) — stock was already deducted', v_order.status;
  END IF;

  FOR v_line IN
    SELECT id, sku_id, qty_pieces, uom, unit_price_mvr FROM sales_order_lines WHERE order_id = p_order_id
  LOOP
    v_remaining := v_line.qty_pieces;
    v_cost_sum  := 0;
    v_qty_sold  := 0;

    FOR v_batch IN
      SELECT bs.batch_id, bs.qty_pieces_remaining, bs.received_at, bs.landed_per_piece_mvr
      FROM v_batch_stock bs
      WHERE bs.sku_id = v_line.sku_id
        AND bs.godown_id = v_order.source_godown_id
        AND bs.qty_pieces_remaining > 0
      ORDER BY bs.received_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_remaining, v_batch.qty_pieces_remaining);
      INSERT INTO stock_movements
        (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, created_by)
      VALUES
        (v_batch.batch_id, v_line.sku_id, v_order.source_godown_id, 'out',
         v_take, 'sales_order', p_order_id, v_user);
      v_cost_sum := v_cost_sum + (v_take * COALESCE(v_batch.landed_per_piece_mvr, 0));
      v_qty_sold := v_qty_sold + v_take;
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Insufficient stock for SKU % in selected godown', v_line.sku_id;
    END IF;

    v_avg_cost := CASE WHEN v_qty_sold > 0 THEN v_cost_sum / v_qty_sold ELSE NULL END;

    SELECT
      v_line.unit_price_mvr / CASE v_line.uom
        WHEN 'carton' THEN (s.pcs_per_pack * s.packs_per_carton)
        WHEN 'pack'   THEN s.pcs_per_pack
        ELSE 1
      END
    INTO v_price_per_piece
    FROM skus s WHERE s.id = v_line.sku_id;

    v_margin := CASE
      WHEN v_avg_cost IS NOT NULL AND v_price_per_piece IS NOT NULL AND v_price_per_piece > 0
        THEN ROUND((1 - v_avg_cost / v_price_per_piece) * 100, 2)
      ELSE NULL
    END;

    UPDATE sales_order_lines
    SET landed_cost_per_piece_mvr = v_avg_cost,
        actual_margin_pct         = v_margin
    WHERE id = v_line.id;
  END LOOP;

  UPDATE sales_orders SET status='confirmed' WHERE id = p_order_id AND status='draft';
  RETURN p_order_id;
END $$;

COMMIT;

-- ============================================================================
-- 0093 — Stock write-off (damaged / expired / lost) done the proper way
-- ============================================================================
-- Handling unsellable stock is a reason-coded INVENTORY WRITE-OFF (shrinkage),
-- the ERP standard: remove it from sellable stock AND recognise its landed cost
-- as a loss — never a sale, never a silent quantity edit. The schema already
-- carried a `damage_out` movement type and a `damage` source (stock_signed_delta
-- treats damage_out as a decrement), but nothing recorded one and — critically —
-- get_pnl never counted it, so a write-off would shrink stock while OVERSTATING
-- profit. This closes both gaps.
--
-- 1. write_off_stock(): FIFO-depletes the damaged quantity across the SKU's
--    batches in one godown, each movement valued at that batch's locked landed
--    cost; blocks writing off more than is on hand; audit-logs old→new on-hand
--    with the reason and the money lost; returns the total cost written off so
--    the UI can confirm the hit. Admin/manager only, anon revoked.
-- 2. get_pnl(): gains a `stock_writeoff_mvr` line (landed cost of damage_out in
--    the period) and subtracts it from net profit — so damage shows up as the
--    loss it is, on its own line the owner can watch.
-- ============================================================================

-- 1. The write-off engine ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_off_stock(
  p_sku_id     uuid,
  p_godown_id  uuid,
  p_qty_pieces integer,
  p_reason     text,
  p_notes      text DEFAULT NULL
)
RETURNS numeric   -- total landed cost written off (the loss)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_need   integer := p_qty_pieces;
  v_avail  integer;
  v_before integer;
  v_cost   numeric := 0;
  v_take   integer;
  r        record;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Not authorised to write off stock';
  END IF;
  IF p_qty_pieces IS NULL OR p_qty_pieces <= 0 THEN
    RAISE EXCEPTION 'Quantity to write off must be more than zero';
  END IF;
  IF p_reason NOT IN ('damaged', 'expired', 'lost', 'other') THEN
    RAISE EXCEPTION 'Invalid write-off reason';
  END IF;

  -- On hand in this godown (stock = SUM of signed movements).
  SELECT COALESCE(SUM(stock_signed_delta(movement_type, qty_pieces)), 0)
    INTO v_avail
  FROM stock_movements
  WHERE sku_id = p_sku_id AND godown_id = p_godown_id;
  v_before := v_avail;

  IF v_need > v_avail THEN
    RAISE EXCEPTION 'Only % pieces on hand in this godown — cannot write off %', v_avail, p_qty_pieces;
  END IF;

  -- Deplete FIFO (oldest batch first), valuing the loss at each batch's locked
  -- landed cost — the same money trail a sale would leave.
  FOR r IN
    SELECT ib.id AS batch_id, ib.landed_per_piece_mvr,
           COALESCE((SELECT SUM(stock_signed_delta(sm.movement_type, sm.qty_pieces))
                     FROM stock_movements sm WHERE sm.batch_id = ib.id), 0) AS remaining
    FROM inventory_batches ib
    WHERE ib.sku_id = p_sku_id AND ib.godown_id = p_godown_id
    ORDER BY ib.received_at ASC, ib.created_at ASC
  LOOP
    EXIT WHEN v_need <= 0;
    IF r.remaining <= 0 THEN CONTINUE; END IF;
    v_take := LEAST(v_need, r.remaining);
    INSERT INTO stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, notes, created_by)
    VALUES (r.batch_id, p_sku_id, p_godown_id, 'damage_out', v_take, 'damage',
            p_reason || CASE WHEN NULLIF(btrim(p_notes), '') IS NOT NULL THEN ': ' || btrim(p_notes) ELSE '' END,
            (SELECT auth.uid()));
    v_cost := v_cost + v_take * COALESCE(r.landed_per_piece_mvr, 0);
    v_need := v_need - v_take;
  END LOOP;

  IF v_need > 0 THEN
    RAISE EXCEPTION 'Could not fully write off — only % pieces found across batches', p_qty_pieces - v_need;
  END IF;

  INSERT INTO audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  VALUES ('stock_movements', p_sku_id, 'write_off', 'on_hand_pieces',
          v_before::text, (v_before - p_qty_pieces)::text,
          'Wrote off ' || p_qty_pieces || ' pcs (' || p_reason || ') — MVR ' || ROUND(v_cost, 2) || ' loss'
            || CASE WHEN NULLIF(btrim(p_notes), '') IS NOT NULL THEN '; ' || btrim(p_notes) ELSE '' END,
          (SELECT auth.uid()));

  RETURN ROUND(v_cost, 2);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.write_off_stock(uuid, uuid, integer, text, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.write_off_stock(uuid, uuid, integer, text, text) TO authenticated, service_role;

-- 2. P&L now recognises write-offs as a loss ---------------------------------
DROP FUNCTION IF EXISTS public.get_pnl(date, date);

CREATE FUNCTION public.get_pnl(p_from date, p_to date)
RETURNS TABLE(
  revenue_mvr numeric, cogs_mvr numeric, gross_profit_mvr numeric,
  marketing_mvr numeric, other_opex_mvr numeric, stock_writeoff_mvr numeric,
  net_profit_mvr numeric, gross_margin_pct numeric, net_margin_pct numeric,
  opex_by_category jsonb, has_estimated_cost boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH
  latest_landed AS (
    SELECT DISTINCT ON (sku_id) sku_id, landed_per_piece_mvr
    FROM v_batch_stock
    WHERE qty_pieces_remaining > 0
    ORDER BY sku_id, received_at DESC
  ),
  sales AS (
    SELECT
      COALESCE(SUM(sol.line_total_mvr), 0) AS revenue,
      COALESCE(SUM(sol.qty_pieces * COALESCE(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0)), 0) AS cogs,
      BOOL_OR(sol.landed_cost_per_piece_mvr IS NULL) AS est
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    LEFT JOIN latest_landed ll ON ll.sku_id = sol.sku_id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.created_at::DATE BETWEEN p_from AND p_to
  ),
  mktg AS (
    SELECT COALESCE(SUM(
      ms.amount_mvr
      * GREATEST(0, LEAST(COALESCE(ms.end_date, CURRENT_DATE), p_to) - GREATEST(ms.start_date, p_from) + 1)::NUMERIC
      / GREATEST(1, COALESCE(ms.end_date, CURRENT_DATE) - ms.start_date + 1)::NUMERIC
    ), 0) AS spend
    FROM marketing_spend ms
    WHERE ms.start_date <= p_to
      AND COALESCE(ms.end_date, CURRENT_DATE) >= p_from
  ),
  opex_total AS (
    SELECT COALESCE(SUM(amount_mvr), 0) AS total
    FROM business_expenses
    WHERE expense_date BETWEEN p_from AND p_to
  ),
  writeoffs AS (
    SELECT COALESCE(SUM(sm.qty_pieces * COALESCE(ib.landed_per_piece_mvr, 0)), 0) AS total
    FROM stock_movements sm
    JOIN inventory_batches ib ON ib.id = sm.batch_id
    WHERE sm.movement_type = 'damage_out'
      AND sm.created_at::DATE BETWEEN p_from AND p_to
  ),
  opex_cats AS (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('name', name, 'amount', amount) ORDER BY amount DESC),
      '[]'::jsonb
    ) AS by_category
    FROM (
      SELECT ec.name, SUM(b.amount_mvr) AS amount
      FROM business_expenses b
      JOIN expense_categories ec ON ec.id = b.category_id
      WHERE b.expense_date BETWEEN p_from AND p_to
      GROUP BY ec.name
    ) x
  )
  SELECT
    s.revenue,
    ROUND(s.cogs, 2),
    ROUND(s.revenue - s.cogs, 2),
    ROUND(m.spend, 2),
    ot.total,
    ROUND(w.total, 2),
    ROUND(s.revenue - s.cogs - m.spend - ot.total - w.total, 2),
    CASE WHEN s.revenue > 0 THEN ROUND((s.revenue - s.cogs) / s.revenue * 100, 1) ELSE NULL END,
    CASE WHEN s.revenue > 0 THEN ROUND((s.revenue - s.cogs - m.spend - ot.total - w.total) / s.revenue * 100, 1) ELSE NULL END,
    oc.by_category,
    COALESCE(s.est, false)
  FROM sales s, mktg m, opex_total ot, writeoffs w, opex_cats oc;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_pnl(date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_pnl(date, date) TO authenticated, service_role;

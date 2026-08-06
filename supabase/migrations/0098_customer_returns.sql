-- ============================================================================
-- 0098 — Customer returns (the last "designed but not built" gap)
-- ============================================================================
-- The schema always had `return_in` / source 'return' and the stock math knows
-- how to handle them, but nothing could record a return. So a customer bringing
-- goods back had no correct path: voiding the order erases the whole sale
-- (wrong for a partial return of a legitimately delivered order).
--
-- A return has to undo the sale in EVERY place it was counted, or the money
-- screens disagree. Done here as reversing entries the existing engines already
-- read, so they can't drift:
--
--   • STOCK  — a `return_in` movement back to the ORIGINAL batch, so the goods
--     return at the exact landed cost they left with (FIFO + stock value stay
--     true; v_batch_stock already counts return_in).
--   • P&L    — get_pnl gains a "Returns & refunds" line: revenue reversed minus
--     the cost of goods actually back on the shelf (the true margin lost). This
--     is the standard Gross Sales − Returns presentation, and it means Ali can
--     SEE what returns cost him instead of it silently shrinking revenue.
--   • OWED   — get_receivables_aging subtracts returns, so what a customer owes
--     drops the moment they hand goods back. (The dashboard reads this same
--     function since 0080, so it follows automatically — one definition of owed.)
--   • CASH   — a money-back refund also writes a NEGATIVE order_payments row
--     (is_reversal), which the ledger was always designed for. Net effect on
--     owed is zero (they got cash, not credit) and cash out stays visible.
--
-- Settlement is chosen per return: 'refund' (money back) or 'credit' (reduces
-- what they owe). Credit is refused when nothing is outstanding, with a clear
-- message — better than silently losing the credit.
--
-- Goods that come back damaged are NOT restocked (p_restock = false): stock
-- stays off the shelf and the full cost lands as the loss, which is the honest
-- treatment.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sales_returns (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                  uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE RESTRICT,
  sku_id                    uuid NOT NULL REFERENCES public.skus(id)          ON DELETE RESTRICT,
  godown_id                 uuid REFERENCES public.godowns(id),
  qty_pieces                integer NOT NULL CHECK (qty_pieces > 0),
  refund_amount_mvr         numeric(14,2) NOT NULL CHECK (refund_amount_mvr >= 0),
  landed_cost_per_piece_mvr numeric(14,4),
  restocked                 boolean NOT NULL DEFAULT true,
  reason                    text NOT NULL CHECK (reason IN ('unwanted','wrong_item','defective','other')),
  settlement                text NOT NULL CHECK (settlement IN ('refund','credit')),
  notes                     text,
  created_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sr_read  ON public.sales_returns;
DROP POLICY IF EXISTS sr_write ON public.sales_returns;
CREATE POLICY sr_read  ON public.sales_returns FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY sr_write ON public.sales_returns FOR ALL    USING (is_admin_or_manager());

CREATE INDEX IF NOT EXISTS sales_returns_order_idx   ON public.sales_returns (order_id);
CREATE INDEX IF NOT EXISTS sales_returns_created_idx ON public.sales_returns (created_at DESC);

-- ── The engine ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_customer_return(
  p_order_id   uuid,
  p_sku_id     uuid,
  p_qty_pieces integer,
  p_reason     text,
  p_settlement text,
  p_restock    boolean DEFAULT true,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_line        record;
  v_sold        integer;
  v_returned    integer;
  v_price_pc    numeric;
  v_refund      numeric;
  v_cost_pc     numeric;
  v_batch       uuid;
  v_godown      uuid;
  v_outstanding numeric;
  v_id          uuid;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Not authorised to record returns';
  END IF;
  IF p_qty_pieces IS NULL OR p_qty_pieces <= 0 THEN
    RAISE EXCEPTION 'Return quantity must be more than zero';
  END IF;
  IF p_reason NOT IN ('unwanted','wrong_item','defective','other') THEN
    RAISE EXCEPTION 'Invalid return reason';
  END IF;
  IF p_settlement NOT IN ('refund','credit') THEN
    RAISE EXCEPTION 'Invalid settlement type';
  END IF;

  SELECT sol.qty_pieces, sol.line_total_mvr, sol.landed_cost_per_piece_mvr
    INTO v_line
  FROM sales_order_lines sol
  JOIN sales_orders so ON so.id = sol.order_id
  WHERE sol.order_id = p_order_id AND sol.sku_id = p_sku_id
    AND so.status NOT IN ('draft','cancelled')
  LIMIT 1;

  IF v_line IS NULL THEN
    RAISE EXCEPTION 'That product is not on this order (or the order is not confirmed)';
  END IF;

  v_sold := v_line.qty_pieces;
  SELECT COALESCE(SUM(qty_pieces), 0) INTO v_returned
  FROM sales_returns WHERE order_id = p_order_id AND sku_id = p_sku_id;

  IF p_qty_pieces > (v_sold - v_returned) THEN
    RAISE EXCEPTION 'Only % pieces can still be returned on this order (% sold, % already returned)',
      (v_sold - v_returned), v_sold, v_returned;
  END IF;

  -- Money reversed at the ORIGINAL selling price and ORIGINAL landed cost.
  v_price_pc := v_line.line_total_mvr / NULLIF(v_sold, 0);
  v_refund   := ROUND(p_qty_pieces * v_price_pc, 2);
  v_cost_pc  := v_line.landed_cost_per_piece_mvr;

  -- Where the goods left from (and which batch), so they go back identically.
  SELECT sm.batch_id, sm.godown_id INTO v_batch, v_godown
  FROM stock_movements sm
  WHERE sm.source_id = p_order_id AND sm.sku_id = p_sku_id AND sm.movement_type = 'out'
  ORDER BY sm.created_at DESC LIMIT 1;

  IF v_cost_pc IS NULL AND v_batch IS NOT NULL THEN
    SELECT landed_per_piece_mvr INTO v_cost_pc FROM inventory_batches WHERE id = v_batch;
  END IF;

  -- Credit only makes sense while something is still owed on the order.
  IF p_settlement = 'credit' THEN
    SELECT COALESCE(SUM(sol.line_total_mvr), 0)
           - COALESCE((SELECT SUM(op.amount_mvr) FROM order_payments op WHERE op.order_id = p_order_id), 0)
           - COALESCE((SELECT SUM(sr.refund_amount_mvr) FROM sales_returns sr WHERE sr.order_id = p_order_id), 0)
      INTO v_outstanding
    FROM sales_order_lines sol WHERE sol.order_id = p_order_id;

    IF v_outstanding < v_refund - 0.005 THEN
      RAISE EXCEPTION 'This order only has MVR % still owed — record this as a money-back refund instead',
        ROUND(GREATEST(v_outstanding, 0), 2);
    END IF;
  END IF;

  -- 1. Stock back on the shelf (unless it came back unsellable).
  IF p_restock AND v_batch IS NOT NULL THEN
    INSERT INTO stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces,
                                 source_type, source_id, notes, created_by)
    VALUES (v_batch, p_sku_id, v_godown, 'return_in', p_qty_pieces, 'return', p_order_id,
            'Customer return: ' || p_reason, (SELECT auth.uid()));
  END IF;

  -- 2. The return itself.
  INSERT INTO sales_returns (order_id, sku_id, godown_id, qty_pieces, refund_amount_mvr,
                             landed_cost_per_piece_mvr, restocked, reason, settlement, notes, created_by)
  VALUES (p_order_id, p_sku_id, v_godown, p_qty_pieces, v_refund, v_cost_pc,
          COALESCE(p_restock, true) AND v_batch IS NOT NULL, p_reason, p_settlement,
          NULLIF(btrim(p_notes), ''), (SELECT auth.uid()))
  RETURNING id INTO v_id;

  -- 3. Money back = a negative entry in the payment ledger (what it was built for).
  IF p_settlement = 'refund' THEN
    INSERT INTO order_payments (order_id, amount_mvr, method, paid_at, note, is_reversal, created_by)
    VALUES (p_order_id, -v_refund, 'other', now(),
            'Refund for returned goods (' || p_reason || ')', true, (SELECT auth.uid()));
  END IF;

  INSERT INTO audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  VALUES ('sales_returns', v_id, 'insert', 'refund_amount_mvr', '0', v_refund::text,
          'Return: ' || p_qty_pieces || ' pcs (' || p_reason || ', ' || p_settlement || ')'
            || CASE WHEN p_restock THEN ' — restocked' ELSE ' — NOT restocked' END,
          (SELECT auth.uid()));

  RETURN jsonb_build_object(
    'id', v_id,
    'refund_mvr', v_refund,
    'cost_recovered_mvr', CASE WHEN p_restock AND v_batch IS NOT NULL
                               THEN ROUND(p_qty_pieces * COALESCE(v_cost_pc, 0), 2) ELSE 0 END,
    'restocked', (p_restock AND v_batch IS NOT NULL),
    'settlement', p_settlement
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_customer_return(uuid, uuid, integer, text, text, boolean, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.record_customer_return(uuid, uuid, integer, text, text, boolean, text) TO authenticated, service_role;

-- ── Returns listing (traceability, same as the write-off log) ────────────────
CREATE OR REPLACE FUNCTION public.get_returns(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid, created_at timestamptz, order_number text, customer_name text,
  brand_name text, model_name text, variant_display text,
  qty_pieces integer, pcs_per_pack integer, pcs_per_carton integer,
  refund_amount_mvr numeric, cost_recovered_mvr numeric, net_loss_mvr numeric,
  restocked boolean, reason text, settlement text, notes text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT sr.id, sr.created_at, so.order_number,
         COALESCE(c.name, 'Walk-in'),
         vs.brand_name, vs.model_name, vs.variant_display,
         sr.qty_pieces, vs.pcs_per_pack, vs.pcs_per_carton,
         sr.refund_amount_mvr,
         ROUND(CASE WHEN sr.restocked THEN sr.qty_pieces * COALESCE(sr.landed_cost_per_piece_mvr,0) ELSE 0 END, 2),
         ROUND(sr.refund_amount_mvr
               - CASE WHEN sr.restocked THEN sr.qty_pieces * COALESCE(sr.landed_cost_per_piece_mvr,0) ELSE 0 END, 2),
         sr.restocked, sr.reason, sr.settlement, sr.notes
  FROM sales_returns sr
  JOIN sales_orders so ON so.id = sr.order_id
  JOIN v_skus vs       ON vs.id = sr.sku_id
  LEFT JOIN customers c ON c.id = so.customer_id
  WHERE (p_from IS NULL OR sr.created_at::date >= p_from)
    AND (p_to   IS NULL OR sr.created_at::date <= p_to)
  ORDER BY sr.created_at DESC
  LIMIT GREATEST(1, p_limit);
$$;
REVOKE EXECUTE ON FUNCTION public.get_returns(date, date, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_returns(date, date, int) TO authenticated, service_role;

-- ── Owed now nets off returns (one definition; dashboard follows via 0080) ───
-- Defensive drop for a from-scratch replay: column list changes here.
DROP FUNCTION IF EXISTS public.get_receivables_aging();
CREATE OR REPLACE FUNCTION public.get_receivables_aging()
RETURNS TABLE (
  customer_id uuid, customer_name text, phone text,
  orders_count integer, outstanding_mvr numeric, oldest_days integer, bucket text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH order_totals AS (
    SELECT so.id, so.customer_id,
           COALESCE(so.delivered_at::date, so.created_at::date) AS due_start,
           COALESCE(SUM(sol.line_total_mvr), 0) AS total
    FROM sales_orders so
    JOIN sales_order_lines sol ON sol.order_id = so.id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.payment_status <> 'paid'
    GROUP BY so.id
  ),
  order_paid AS (
    SELECT op.order_id, COALESCE(SUM(op.amount_mvr), 0) AS paid
    FROM order_payments op
    GROUP BY op.order_id
  ),
  order_returned AS (
    SELECT sr.order_id, COALESCE(SUM(sr.refund_amount_mvr), 0) AS returned
    FROM sales_returns sr
    GROUP BY sr.order_id
  ),
  owed AS (
    SELECT ot.customer_id,
           ot.total - COALESCE(p.paid, 0) - COALESCE(r.returned, 0) AS outstanding,
           (CURRENT_DATE - ot.due_start)  AS age_days
    FROM order_totals ot
    LEFT JOIN order_paid     p ON p.order_id = ot.id
    LEFT JOIN order_returned r ON r.order_id = ot.id
    WHERE ot.total - COALESCE(p.paid, 0) - COALESCE(r.returned, 0) > 0.005
  )
  SELECT
    o.customer_id,
    COALESCE(c.name, 'Walk-in / no customer') AS customer_name,
    c.phone,
    COUNT(*)::integer,
    ROUND(SUM(o.outstanding), 2),
    MAX(o.age_days)::integer,
    CASE
      WHEN MAX(o.age_days) > 60 THEN 'overdue'
      WHEN MAX(o.age_days) > 30 THEN 'watch'
      ELSE 'current'
    END
  FROM owed o
  LEFT JOIN customers c ON c.id = o.customer_id
  GROUP BY o.customer_id, c.name, c.phone
  ORDER BY MAX(o.age_days) DESC, SUM(o.outstanding) DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_receivables_aging() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_receivables_aging() TO authenticated, service_role;

-- ── P&L gains the "Returns & refunds" line ──────────────────────────────────
DROP FUNCTION IF EXISTS public.get_pnl(date, date);

CREATE FUNCTION public.get_pnl(p_from date, p_to date)
RETURNS TABLE(
  revenue_mvr numeric, cogs_mvr numeric, gross_profit_mvr numeric,
  marketing_mvr numeric, other_opex_mvr numeric, stock_writeoff_mvr numeric,
  returns_net_mvr numeric,
  net_profit_mvr numeric, gross_margin_pct numeric, net_margin_pct numeric,
  opex_by_category jsonb, has_estimated_cost boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH
  latest_landed AS (
    SELECT DISTINCT ON (sku_id) sku_id, landed_per_piece_mvr
    FROM v_batch_stock WHERE qty_pieces_remaining > 0
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
    WHERE ms.start_date <= p_to AND COALESCE(ms.end_date, CURRENT_DATE) >= p_from
  ),
  opex_total AS (
    SELECT COALESCE(SUM(amount_mvr), 0) AS total
    FROM business_expenses WHERE expense_date BETWEEN p_from AND p_to
  ),
  writeoffs AS (
    SELECT COALESCE(SUM(sm.qty_pieces * COALESCE(ib.landed_per_piece_mvr, 0)), 0) AS total
    FROM stock_movements sm
    JOIN inventory_batches ib ON ib.id = sm.batch_id
    WHERE sm.movement_type = 'damage_out'
      AND sm.created_at::DATE BETWEEN p_from AND p_to
  ),
  -- Net cost of returns: revenue given back, minus the cost of goods actually
  -- back on the shelf (an unsellable return recovers nothing).
  rtn AS (
    SELECT COALESCE(SUM(
      sr.refund_amount_mvr
      - CASE WHEN sr.restocked THEN sr.qty_pieces * COALESCE(sr.landed_cost_per_piece_mvr, 0) ELSE 0 END
    ), 0) AS total
    FROM sales_returns sr
    WHERE sr.created_at::DATE BETWEEN p_from AND p_to
  ),
  opex_cats AS (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('name', name, 'amount', amount) ORDER BY amount DESC),
      '[]'::jsonb) AS by_category
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
    ROUND(rt.total, 2),
    ROUND(s.revenue - s.cogs - m.spend - ot.total - w.total - rt.total, 2),
    CASE WHEN s.revenue > 0 THEN ROUND((s.revenue - s.cogs) / s.revenue * 100, 1) ELSE NULL END,
    CASE WHEN s.revenue > 0 THEN ROUND((s.revenue - s.cogs - m.spend - ot.total - w.total - rt.total) / s.revenue * 100, 1) ELSE NULL END,
    oc.by_category,
    COALESCE(s.est, false)
  FROM sales s, mktg m, opex_total ot, writeoffs w, rtn rt, opex_cats oc;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_pnl(date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_pnl(date, date) TO authenticated, service_role;

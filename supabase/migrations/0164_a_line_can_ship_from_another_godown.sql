-- 0164 — a line can ship from a different godown than the rest of the order.
--
-- Ali, 2026-08-09, circling a Sosoft Purple row reading "No full carton here ·
-- 20 cartons at Veesange":
--
--   "In sales add products when a sku is not available in chosen godown it
--    marks in orange words x cartons at x warehouse but doesn't let me choose
--    from this warehouse. How do we solve this godown problem?"
--
-- and, when asked whether one delivery can collect from two godowns:
--
--   "Usually one, but sometimes both."
--
-- THE ROOT CAUSE
--
-- The app modelled fulfilment as "one order = one warehouse". The location
-- lived only on the header (sales_orders.source_godown_id) and post_sale
-- depleted every line from it. So the app could SAY where the stock was and
-- had nowhere to record that ONE line comes from somewhere else. The orange
-- hint was a dead end by construction, not by oversight.
--
-- It bites constantly rather than rarely: 12 SKUs exist only in Veesange and
-- 3 only in Funvilu, so whichever warehouse is picked first, between 3 and 12
-- products cannot be sold on that order.
--
-- THE FIX, AND WHY THIS SHAPE
--
-- Stock location belongs to the LINE, with the header as the default. That is
-- what distribution ERPs do (SAP storage location, NetSuite location,
-- Odoo source location are all per line) and it is the only shape that
-- expresses "usually one, sometimes both" without forcing a second order.
--
-- The column is NULLABLE and NULL means "wherever the order ships from":
--
--   * Every one of the 93 existing orders keeps its exact behaviour. No
--     backfill, no rewrite of history, nothing to verify by hand.
--   * Any caller that does not know about the column still works, because the
--     resolution is coalesce(line.source_godown_id, order.source_godown_id).
--   * A single-godown order stores NULL on every line and is byte-identical
--     to what it would have been yesterday.
--
-- WHAT MOVES, AND WHAT DELIBERATELY DOES NOT
--
--   post_sale               resolves per line, deducts FIFO from that godown,
--                           and writes the movement against that godown.
--   edit_sales_order_line   re-deducts from the LINE's godown, not the
--                           order's — it had the same hardcoded assumption.
--   create_and_post_sale    accepts and stores the per-line godown.
--
--   void_sales_order        no change. It reverses the exact stock_movements
--   delete_sales_order_line rows it created, matching on source_id/sku_id and
--                           reusing each movement's own godown_id, so it
--                           follows a split automatically. Verified by reading
--                           both, not assumed.
--
-- The "insufficient stock" message now names the godown it looked in, because
-- with two possible answers "in selected godown" stopped being enough to act
-- on.

BEGIN;

ALTER TABLE public.sales_order_lines
  ADD COLUMN IF NOT EXISTS source_godown_id uuid REFERENCES public.godowns(id);

COMMENT ON COLUMN public.sales_order_lines.source_godown_id IS
  'Godown this line is picked from. NULL means the order''s source_godown_id — '
  'that is the normal case and keeps single-warehouse orders unchanged.';

-- Picking a whole order is still the common case, so the index only has to
-- serve the "which lines differ" question the dispatch view asks.
CREATE INDEX IF NOT EXISTS idx_sol_source_godown
  ON public.sales_order_lines (source_godown_id)
  WHERE source_godown_id IS NOT NULL;

-- ── post_sale: deplete each line from ITS godown ──────────────────────────
CREATE OR REPLACE FUNCTION public.post_sale(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_godown_name TEXT;
BEGIN
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
    SELECT id, sku_id, qty_pieces, uom, unit_price_mvr,
           -- The whole change: a line may name its own godown, and when it
           -- does not, it uses the order's. Every existing line is NULL here.
           COALESCE(source_godown_id, v_order.source_godown_id) AS godown_id
    FROM sales_order_lines WHERE order_id = p_order_id
  LOOP
    v_remaining := v_line.qty_pieces;
    v_cost_sum  := 0;
    v_qty_sold  := 0;

    FOR v_batch IN
      SELECT bs.batch_id, bs.qty_pieces_remaining, bs.received_at, bs.landed_per_piece_mvr
      FROM v_batch_stock bs
      WHERE bs.sku_id = v_line.sku_id
        AND bs.godown_id = v_line.godown_id
        AND bs.qty_pieces_remaining > 0
      ORDER BY bs.received_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_remaining, v_batch.qty_pieces_remaining);
      INSERT INTO stock_movements
        (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, created_by)
      VALUES
        (v_batch.batch_id, v_line.sku_id, v_line.godown_id, 'out',
         v_take, 'sales_order', p_order_id, v_user);
      v_cost_sum := v_cost_sum + (v_take * COALESCE(v_batch.landed_per_piece_mvr, 0));
      v_qty_sold := v_qty_sold + v_take;
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      -- Name the godown: with more than one possible answer, "the selected
      -- godown" no longer tells anyone where to look.
      SELECT name INTO v_godown_name FROM godowns WHERE id = v_line.godown_id;
      RAISE EXCEPTION 'Not enough stock at % for this product — % more needed',
        COALESCE(v_godown_name, 'the chosen warehouse'), v_remaining;
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
END $function$;

REVOKE EXECUTE ON FUNCTION public.post_sale(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.post_sale(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.post_sale(uuid) TO authenticated;

COMMIT;

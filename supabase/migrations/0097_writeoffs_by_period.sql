-- ============================================================================
-- 0097 — Write-offs for a period (so the P&L line explains itself in place)
-- ============================================================================
-- Tapping the P&L "Damaged & write-offs" figure navigated to Stock Ops — an
-- ACTION screen for creating write-offs, which explains nothing. Wrong pattern.
-- The P&L card already has the right one: Operating Expenses lists its
-- categories as indented sub-lines directly beneath it. Write-offs now do the
-- same, so the number explains itself where it's read.
--
-- For that the breakdown must cover EXACTLY the P&L's period, or the sub-lines
-- wouldn't add up to the total (the very inconsistency we're avoiding). So this
-- replaces get_recent_writeoffs with an optional date range; NULL dates = all
-- recent (the Stock Ops log keeps working unchanged).
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_recent_writeoffs(int);

CREATE FUNCTION public.get_recent_writeoffs(
  p_from  date DEFAULT NULL,
  p_to    date DEFAULT NULL,
  p_limit int  DEFAULT 50
)
RETURNS TABLE (
  id              uuid,
  created_at      timestamptz,
  brand_name      text,
  model_name      text,
  variant_display text,
  qty_pieces      integer,
  pcs_per_pack    integer,
  pcs_per_carton  integer,
  reason          text,     -- raw note: "<reason>[: <free text>]"
  cost_mvr        numeric,  -- landed cost written off (the loss)
  godown_name     text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT sm.id, sm.created_at,
         vs.brand_name, vs.model_name, vs.variant_display,
         sm.qty_pieces, vs.pcs_per_pack, vs.pcs_per_carton,
         sm.notes AS reason,
         ROUND(sm.qty_pieces * COALESCE(ib.landed_per_piece_mvr, 0), 2) AS cost_mvr,
         g.name AS godown_name
  FROM stock_movements sm
  JOIN inventory_batches ib ON ib.id = sm.batch_id
  JOIN v_skus vs            ON vs.id = sm.sku_id
  LEFT JOIN godowns g       ON g.id = sm.godown_id
  WHERE sm.movement_type = 'damage_out'
    AND (p_from IS NULL OR sm.created_at::date >= p_from)
    AND (p_to   IS NULL OR sm.created_at::date <= p_to)
  ORDER BY sm.created_at DESC
  LIMIT GREATEST(1, p_limit);
$$;
REVOKE EXECUTE ON FUNCTION public.get_recent_writeoffs(date, date, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_recent_writeoffs(date, date, int) TO authenticated, service_role;

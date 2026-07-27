-- ============================================================================
-- 0096 — Make write-offs visible (traceability for the P&L "Damaged" line)
-- ============================================================================
-- The P&L shows a "Damaged & write-offs" loss, but there was no way to see WHAT
-- it was. The data is all there (damage_out movements, audit_log), just not
-- surfaced. This returns the recent write-offs — product, quantity, reason,
-- money lost, date, godown — so the loss is explainable from the app, and the
-- P&L line can link straight to it. Read-only; anon revoked.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_recent_writeoffs(p_limit int DEFAULT 50)
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
  ORDER BY sm.created_at DESC
  LIMIT GREATEST(1, p_limit);
$$;
REVOKE EXECUTE ON FUNCTION public.get_recent_writeoffs(int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_recent_writeoffs(int) TO authenticated, service_role;

-- 0147 — get_shipment_void_impact: say the stock at risk in CARTONS, not pieces.
--
-- Ali, 2026-08-06: "I never sell diapers by pieces. It's always sold in packs
-- and cartons. Nobody will sell diapers in pieces."
--
-- The void-a-shipment confirmation showed "Stock still in the godown:
-- 20,254 pcs". That is the single worst place in the app for a unit he does
-- not trade in: it is the number he weighs before authorising an irreversible
-- action, and he cannot judge whether 20,254 is a little or a lot without
-- doing arithmetic in his head. In cartons it is immediately legible.
--
-- Why this needs Postgres rather than a UI conversion: a shipment spans many
-- SKUs with different pack configurations (34x3, 42x4, 1x6 ...), so a single
-- total piece count cannot be converted client-side. Each line has to be
-- divided by its own SKU's config and only then summed — same reasoning as
-- migration 0143, which added stock_restored_summary to
-- get_sales_order_delete_impact for the identical problem on sales orders.
--
-- pieces_received / pieces_on_hand are KEPT in the return type: they are the
-- ledger's own unit, other callers may rely on them, and dropping a column is
-- a breaking change for no gain. Two carton columns are added alongside; the
-- UI reads the carton figures.

BEGIN;

-- The column list grows here, which CREATE OR REPLACE cannot do for an
-- existing function — drop first, or both this migration and any future
-- from-scratch replay fail (the lesson of migrations 0046/0073/0084/0121/
-- 0123/0124/0126/0130, all fixed for exactly this reason).
DROP FUNCTION IF EXISTS public.get_shipment_void_impact(uuid);

CREATE OR REPLACE FUNCTION public.get_shipment_void_impact(p_shipment_id uuid)
RETURNS TABLE(
  reference text, status text, line_count integer, batch_count integer,
  pieces_received integer, pieces_on_hand integer,
  cartons_received numeric, cartons_on_hand numeric,
  orders_affected integer, orders_value_mvr numeric, paid_orders integer,
  blocked_reason text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_ref text; v_status text; v_line_ids uuid[]; v_batch_ids uuid[]; v_order_ids uuid[];
begin
  if not coalesce(is_admin_or_manager(), false) then
    raise exception 'Only admin or manager can preview a shipment void';
  end if;
  select s.reference, s.status into v_ref, v_status from shipments s where s.id = p_shipment_id;
  if v_ref is null then raise exception 'Shipment not found'; end if;
  select array_agg(sl.id) into v_line_ids from shipment_lines sl where sl.shipment_id = p_shipment_id;
  if v_line_ids is not null then
    select array_agg(ib.id) into v_batch_ids from inventory_batches ib where ib.shipment_line_id = any(v_line_ids);
  end if;
  if v_batch_ids is not null then
    select array_agg(distinct sm.source_id) into v_order_ids from stock_movements sm
    where sm.batch_id = any(v_batch_ids) and sm.movement_type = 'out'
      and sm.source_type = 'sales_order' and sm.source_id is not null;
  end if;
  return query
  select v_ref, v_status,
    coalesce(array_length(v_line_ids, 1), 0),
    coalesce(array_length(v_batch_ids, 1), 0),
    coalesce((select sum(ib.qty_pieces_received)::integer from inventory_batches ib
               where v_batch_ids is not null and ib.id = any(v_batch_ids)), 0),
    coalesce((select sum(stock_signed_delta(sm.movement_type, sm.qty_pieces))::integer from stock_movements sm
               where v_batch_ids is not null and sm.batch_id = any(v_batch_ids)), 0),
    -- Cartons received: each batch divided by ITS OWN SKU's carton size,
    -- then summed. Never a single division of the grand total.
    coalesce((select round(sum(ib.qty_pieces_received::numeric
                               / nullif(sk.pcs_per_pack * sk.packs_per_carton, 0)), 1)
                from inventory_batches ib
                join skus sk on sk.id = ib.sku_id
               where v_batch_ids is not null and ib.id = any(v_batch_ids)), 0)::numeric,
    coalesce((select round(sum(bal.on_hand::numeric
                               / nullif(sk.pcs_per_pack * sk.packs_per_carton, 0)), 1)
                from (select sm.batch_id,
                             sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)) on_hand
                        from stock_movements sm
                       where v_batch_ids is not null and sm.batch_id = any(v_batch_ids)
                       group by sm.batch_id) bal
                join inventory_batches ib on ib.id = bal.batch_id
                join skus sk on sk.id = ib.sku_id), 0)::numeric,
    coalesce(array_length(v_order_ids, 1), 0),
    round(coalesce((select sum(sol.line_total_mvr) from sales_order_lines sol
                     where v_order_ids is not null and sol.order_id = any(v_order_ids)), 0), 2)::numeric,
    coalesce((select count(*)::integer from sales_orders so
               where v_order_ids is not null and so.id = any(v_order_ids)
                 and (so.payment_status in ('paid','deposited')
                      or exists (select 1 from order_payments op where op.order_id = so.id))), 0),
    (select case when count(*) = 0 then null
       else 'Money has already been taken on ' || count(*) ||
            ' of the orders that used this stock. Void or refund those orders first.' end
     from sales_orders so where v_order_ids is not null and so.id = any(v_order_ids)
       and (so.payment_status in ('paid','deposited')
            or exists (select 1 from order_payments op where op.order_id = so.id)));
end $function$;

-- New/recreated functions here pick up an implicit PUBLIC grant; REVOKE from
-- anon alone does not remove it (see migration 0145).
REVOKE EXECUTE ON FUNCTION public.get_shipment_void_impact(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_shipment_void_impact(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_shipment_void_impact(uuid) TO authenticated;

COMMIT;

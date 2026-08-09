-- 0165 — the order-entry and edit paths can actually USE a line's godown.
--
-- Ali, 2026-08-09, still blocked on the same screen:
--
--   "When I make new sale and try to add products when the sku is not in the
--    godown I selected then there's no way to add this product to the order.
--    This is a failure since how can I proceed? I must be able to choose the
--    godown where the sku is available and fulfill the order without going
--    back."
--
-- 0164 taught post_sale to deplete each line from its own godown, but left the
-- column unreachable: create_and_post_sale did not accept it, so no sale could
-- ever set it, and edit_sales_order_line still re-deducted from the ORDER's
-- godown -- the same hardcoded assumption post_sale had. Half a fix is not a
-- fix, and it left a trap: a line with its own godown would have been edited
-- against the wrong one.
--
-- Both are closed here, so the column is writable end to end and every path
-- that moves stock agrees on where it comes from.
--
--   create_and_post_sale   stores source_godown_id per line (NULL as before
--                          when the line does not name one)
--   edit_sales_order_line  re-deducts from coalesce(line, order) -- matching
--                          post_sale exactly
--
-- Unchanged and deliberately so: void_sales_order and delete_sales_order_line
-- reverse the exact stock_movements rows they created, reusing each
-- movement's own godown_id, so a split reverses correctly with no edit.

BEGIN;

-- ── 1. Order entry stores it ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_and_post_sale(p_order jsonb, p_lines jsonb, p_offline_key text DEFAULT NULL::text)
 RETURNS TABLE(order_id uuid, order_number text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_order_id     uuid;
  v_order_number text;
  v_existing_id  uuid;
  v_existing_no  text;
  v_line         jsonb;
  v_sku          skus%rowtype;
  v_sku_id       uuid;
  v_uom          text;
  v_qty          numeric;
  v_unit_price   numeric;
  v_qty_pieces   integer;
  v_line_total   numeric;
  v_per_uom      integer;
  v_n            int := 0;
begin
  if not coalesce(is_admin_or_manager(), false) then
    raise exception 'Only an admin or manager can create a sale';
  end if;

  if p_offline_key is not null and btrim(p_offline_key) <> '' then
    select id, sales_orders.order_number into v_existing_id, v_existing_no
    from sales_orders where offline_key = p_offline_key;
    if found then
      return query select v_existing_id, v_existing_no;
      return;
    end if;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale needs at least one product line';
  end if;

  insert into sales_orders (
    customer_id, status, channel, payment_status, payment_method,
    source_godown_id, delivery_address_line1, delivery_address_line2,
    delivery_island, delivery_to_boat, notes, offline_key, created_by
  ) values (
    nullif(p_order->>'customer_id', '')::uuid,
    'draft',
    coalesce(nullif(p_order->>'channel', ''), 'walkin'),
    coalesce(nullif(p_order->>'payment_status', ''), 'pending'),
    nullif(p_order->>'payment_method', ''),
    nullif(p_order->>'source_godown_id', '')::uuid,
    nullif(p_order->>'delivery_address_line1', ''),
    nullif(p_order->>'delivery_address_line2', ''),
    nullif(p_order->>'delivery_island', ''),
    coalesce((p_order->>'delivery_to_boat')::boolean, false),
    nullif(p_order->>'notes', ''),
    nullif(btrim(coalesce(p_offline_key, '')), ''),
    (select auth.uid())
  )
  returning id, sales_orders.order_number into v_order_id, v_order_number;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_n := v_n + 1;

    v_sku_id := nullif(v_line->>'sku_id', '')::uuid;
    select * into v_sku from skus where id = v_sku_id;
    if not found then
      raise exception 'Line %: that product no longer exists', v_n;
    end if;

    v_uom := v_line->>'uom';
    if v_uom is null or v_uom not in ('piece', 'pack', 'carton') then
      raise exception 'Line %: unit must be piece, pack or carton', v_n;
    end if;

    v_qty        := nullif(v_line->>'qty', '')::numeric;
    v_unit_price := nullif(v_line->>'unit_price_mvr', '')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Line %: quantity must be more than zero', v_n;
    end if;
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'Line %: a price is required', v_n;
    end if;

    v_per_uom := case v_uom
      when 'carton' then v_sku.pcs_per_pack * v_sku.packs_per_carton
      when 'pack'   then v_sku.pcs_per_pack
      else 1
    end;

    v_qty_pieces := round(v_qty * v_per_uom)::int;
    v_line_total := round(v_qty * v_unit_price, 2);

    if v_qty_pieces <= 0 then
      raise exception 'Line %: that quantity works out to zero pieces', v_n;
    end if;

    -- A line may name the godown it is picked from (0164). NULL is the
    -- normal case and means "wherever the order ships from", so a
    -- single-warehouse order is unchanged.
    insert into sales_order_lines (
      order_id, sku_id, uom, qty, qty_pieces,
      unit_price_mvr, line_total_mvr, is_mixed_carton_fill, notes,
      source_godown_id
    ) values (
      v_order_id, v_sku_id, v_uom, v_qty, v_qty_pieces,
      v_unit_price, v_line_total,
      coalesce((v_line->>'is_mixed_carton_fill')::boolean, false),
      nullif(v_line->>'notes', ''),
      nullif(v_line->>'source_godown_id', '')::uuid
    );
  end loop;

  perform post_sale(v_order_id);

  return query select v_order_id, v_order_number;

exception
  when unique_violation then
    if position('offline_key' in sqlerrm) > 0 then
      select id, sales_orders.order_number into v_existing_id, v_existing_no
      from sales_orders where offline_key = p_offline_key;
      if found then
        return query select v_existing_id, v_existing_no;
        return;
      end if;
    end if;
    raise exception 'The same product appears twice in this sale — combine those lines into one and try again';
end
$function$;

-- ── 2. Editing a line re-deducts from the LINE's godown ───────────────────
CREATE OR REPLACE FUNCTION public.edit_sales_order_line(p_line_id uuid, p_new_qty_pieces integer, p_new_unit_price_mvr numeric)
 RETURNS sales_order_lines
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line            sales_order_lines%ROWTYPE;
  v_order           sales_orders%ROWTYPE;
  v_user            UUID := auth.uid();
  v_batch           RECORD;
  v_remaining       INTEGER;
  v_take            INTEGER;
  v_cost_sum        NUMERIC := 0;
  v_qty_sold        INTEGER := 0;
  v_avg_cost        NUMERIC;
  v_price_per_piece NUMERIC;
  v_margin          NUMERIC;
  v_units_per_uom   NUMERIC;
  v_qty_uom         NUMERIC;
  v_new_line_total  NUMERIC;
  v_returned        INTEGER;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only a manager or admin can edit a confirmed order line';
  END IF;
  IF p_new_qty_pieces IS NULL OR p_new_qty_pieces <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;
  IF p_new_unit_price_mvr IS NULL OR p_new_unit_price_mvr < 0 THEN
    RAISE EXCEPTION 'Price cannot be negative';
  END IF;

  SELECT * INTO v_line FROM sales_order_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order line not found'; END IF;

  SELECT * INTO v_order FROM sales_orders WHERE id = v_line.order_id;
  IF v_order.status NOT IN ('confirmed', 'picked') THEN
    RAISE EXCEPTION 'Can only edit lines while order is confirmed or picked (status: %) — void and recreate instead', v_order.status;
  END IF;

  -- How many pieces make up one of whatever this line is sold in. Needed
  -- before the guards below, not just for the money at the end.
  SELECT CASE v_line.uom
    WHEN 'carton' THEN s.pcs_per_pack * s.packs_per_carton
    WHEN 'pack'   THEN s.pcs_per_pack
    ELSE 1
  END INTO v_units_per_uom
  FROM skus s WHERE s.id = v_line.sku_id;

  -- ── Guard 1: whole selling units only ───────────────────────────────────
  -- The business sells packs and cartons, never a fraction of one. Without
  -- this the fraction reaches the line, qty rounds to 3 decimals, and the
  -- money no longer matches the quantity — which surfaced as a raw check
  -- constraint violation rather than anything a human could act on.
  IF v_units_per_uom > 1 AND mod(p_new_qty_pieces, v_units_per_uom::integer) <> 0 THEN
    RAISE EXCEPTION 'This line is sold by the % of %. Choose a whole number of %s — % or %, not %.',
      v_line.uom,
      v_units_per_uom::integer,
      v_line.uom,
      floor(p_new_qty_pieces::numeric / v_units_per_uom)::integer,
      ceil(p_new_qty_pieces::numeric / v_units_per_uom)::integer,
      round(p_new_qty_pieces::numeric / v_units_per_uom, 2);
  END IF;

  -- ── Guard 2: never below what has already come back ─────────────────────
  -- The edit rewrites this line's 'out' movements but leaves the 'return_in'
  -- movements a return wrote. Reducing the line below the returned quantity
  -- therefore creates stock that was never received.
  SELECT COALESCE(SUM(qty_pieces), 0) INTO v_returned
  FROM sales_returns
  WHERE order_id = v_order.id AND sku_id = v_line.sku_id;

  IF p_new_qty_pieces < v_returned THEN
    RAISE EXCEPTION '% %s have already been returned on this line — it cannot be reduced to %. Void the return first.',
      round(v_returned::numeric / NULLIF(v_units_per_uom, 0), 2),
      v_line.uom,
      round(p_new_qty_pieces::numeric / NULLIF(v_units_per_uom, 0), 2) || ' ' || v_line.uom || 's';
  END IF;

  -- Reverse this line's existing stock impact (scoped to this SKU within this
  -- order — the unique constraint guarantees no other line shares it).
  DELETE FROM stock_movements
  WHERE source_type = 'sales_order'
    AND source_id = v_order.id
    AND sku_id = v_line.sku_id
    AND movement_type = 'out';

  -- Re-deplete FIFO for the new quantity, identical logic to post_sale().
  v_remaining := p_new_qty_pieces;
  FOR v_batch IN
    SELECT bs.batch_id, bs.qty_pieces_remaining, bs.received_at, bs.landed_per_piece_mvr
    FROM v_batch_stock bs
    WHERE bs.sku_id = v_line.sku_id
      AND bs.godown_id = coalesce(v_line.source_godown_id, v_order.source_godown_id)
      AND bs.qty_pieces_remaining > 0
    ORDER BY bs.received_at ASC, bs.batch_id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_batch.qty_pieces_remaining);
    INSERT INTO stock_movements
      (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, created_by)
    VALUES
      (v_batch.batch_id, v_line.sku_id, coalesce(v_line.source_godown_id, v_order.source_godown_id), 'out',
       v_take, 'sales_order', v_order.id, v_user);
    v_cost_sum := v_cost_sum + (v_take * COALESCE(v_batch.landed_per_piece_mvr, 0));
    v_qty_sold := v_qty_sold + v_take;
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient stock for SKU % in selected godown — only % of % pieces available',
      v_line.sku_id, v_qty_sold, p_new_qty_pieces;
  END IF;

  v_avg_cost := CASE WHEN v_qty_sold > 0 THEN v_cost_sum / v_qty_sold ELSE NULL END;

  v_price_per_piece := p_new_unit_price_mvr / NULLIF(v_units_per_uom, 0);
  v_margin := CASE
    WHEN v_avg_cost IS NOT NULL AND v_price_per_piece IS NOT NULL AND v_price_per_piece > 0
      THEN ROUND((1 - v_avg_cost / v_price_per_piece) * 100, 2)
    ELSE NULL
  END;

  -- The quantity as it will be STORED, and the total derived from that same
  -- value. Computing the total from the unrounded quantity is what let the
  -- money drift from the recorded amount.
  v_qty_uom        := ROUND(p_new_qty_pieces::NUMERIC / NULLIF(v_units_per_uom, 0), 3);
  v_new_line_total := ROUND(v_qty_uom * p_new_unit_price_mvr, 2);

  UPDATE sales_order_lines
  SET qty                       = v_qty_uom,
      qty_pieces                = p_new_qty_pieces,
      unit_price_mvr            = p_new_unit_price_mvr,
      line_total_mvr            = v_new_line_total,
      landed_cost_per_piece_mvr = v_avg_cost,
      actual_margin_pct         = v_margin
  WHERE id = p_line_id
  RETURNING * INTO v_line;

  -- The order is worth a different amount now, so what the customer owes has
  -- changed. Without this a fully paid order that shrinks stays 'paid' while
  -- the customer is silently in credit.
  PERFORM recalculate_order_payment_status(v_order.id);

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('sales_order_lines', p_line_id, 'update', 'line edited — stock re-deducted via FIFO', v_user);

  RETURN v_line;
END $function$;

REVOKE EXECUTE ON FUNCTION public.create_and_post_sale(jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_and_post_sale(jsonb, jsonb, text) TO authenticated, service_role;

COMMIT;

-- 0134 — Removing a line from a confirmed order must give the stock back.
--
-- Found while reworking the confirmation sheets. The "Remove item" button on
-- a sales order is only offered when the order is `confirmed` or `picked` —
-- which is exactly when post_sale() has already deducted the stock. But the
-- app removed the line with a plain table delete:
--
--     supabase.from("sales_order_lines").delete().eq("id", id)
--
-- The revenue line disappeared and the 'out' stock_movements stayed behind.
-- The goods would have been in neither place: not on the order, and not in
-- inventory. Stock understated, permanently, with nothing in the audit log.
--
-- Its sibling edit_sales_order_line has always done this correctly, reversing
-- the line's movements before re-depleting. This is the same reversal without
-- the re-deplete.
--
-- Checked before writing: zero orders in production have orphaned movements,
-- so this closes the hole without leaving damage to repair.
--
-- Scoping note: movements are matched on (source_id, sku_id, 'out'), the same
-- key edit_sales_order_line uses. That is sound because a unique constraint
-- keeps one line per SKU per order, so a SKU's movements belong to exactly
-- one line.

create or replace function public.delete_sales_order_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_line     sales_order_lines%ROWTYPE;
  v_order    sales_orders%ROWTYPE;
  v_user     uuid := (select auth.uid());
  v_reversed integer := 0;
  v_others   integer;
begin
  if not coalesce(is_admin_or_manager(), false) then
    raise exception 'Only a manager or admin can remove a line from a confirmed order';
  end if;

  select * into v_line from sales_order_lines where id = p_line_id;
  if not found then
    raise exception 'Order line not found';
  end if;

  select * into v_order from sales_orders where id = v_line.order_id;

  -- Same window as edit_sales_order_line. A draft has no stock to give back
  -- and is handled by the plain delete; anything past 'picked' is a shipped
  -- or settled sale and must be voided, not quietly edited.
  if v_order.status not in ('confirmed', 'picked') then
    raise exception 'Items can only be removed while the order is confirmed or picked (this one is %). Void the order instead.', v_order.status;
  end if;

  -- An order with no items is not a record of anything. Void it instead, so
  -- the history survives.
  select count(*) into v_others
  from sales_order_lines where order_id = v_line.order_id and id <> p_line_id;
  if v_others = 0 then
    raise exception 'This is the only item on the order. Void the order instead of emptying it.';
  end if;

  -- Give the stock back to the batches it came from.
  delete from stock_movements
  where source_type   = 'sales_order'
    and source_id     = v_order.id
    and sku_id        = v_line.sku_id
    and movement_type = 'out';
  get diagnostics v_reversed = row_count;

  delete from sales_order_lines where id = p_line_id;

  insert into audit_log (table_name, record_id, action, reason, changed_by)
  values ('sales_order_lines', p_line_id, 'delete',
          format('item removed from %s — %s piece(s) returned to stock across %s movement(s)',
                 v_order.order_number, coalesce(v_line.qty_pieces, 0), v_reversed),
          v_user);
end $function$;

comment on function public.delete_sales_order_line(uuid) is
  'Removes a line from a confirmed/picked order AND reverses its FIFO stock '
  'movements. Replaces a raw table delete that left the stock deducted.';

revoke execute on function public.delete_sales_order_line(uuid) from public, anon;
grant  execute on function public.delete_sales_order_line(uuid) to authenticated, service_role;

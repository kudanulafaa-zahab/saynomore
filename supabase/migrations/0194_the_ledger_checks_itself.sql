-- 0194 — the ledger checks itself, instead of waiting to be asked.
--
-- WHY THIS EXISTS. On 2026-08-21 one batch of X-Tra Kering XXXL was found to
-- disagree with its own product: a carton recorded as 128 nappies for a SKU
-- whose code says 102, costed at 32-to-a-pack while the product said 34. The
-- Product Card reported MVR 88.63 of profit on a pack as MVR 133.97 — a 16.8
-- point margin error on a real product Ali prices from.
--
-- Nothing failed. No screen looked broken. It was found because a sweep was run
-- BY HAND, once, during an unrelated audit. Everything about that is luck, and
-- the same class of fault had also reached the shipment line, where a second
-- hand-run sweep found it again after the first fix was declared complete.
--
-- So the sweeps stop being something someone remembers to run. Each one is an
-- invariant that must hold over the whole business at all times, and this
-- function states all of them in one place, in Postgres, where the data is.
--
-- IT IS FOR THE GATE, NOT FOR ALI. Deliberately: a row here is not something he
-- can act on — "batch per-pack disagrees with per-piece" is not a job, it is a
-- bug report addressed to whoever is working on the app. Putting it on his
-- dashboard would be an alert he cannot clear, which this app's own rule
-- forbids ("every alert must be actionable or absent"). It runs in CI, and it
-- can be pointed at production during a session.
--
-- Every check reads: how many rows are WRONG, out of how many were examined.
-- The denominator matters — "0 bad" means nothing if nothing was looked at,
-- which is exactly how a guard quietly stops guarding.

create or replace function public.get_ledger_integrity()
returns table (check_name text, bad_rows bigint, rows_examined bigint)
language sql
stable
security definer
set search_path = public
as $$
  -- Money on a line must equal what it says it is.
  select 'order line total vs qty x price'::text,
         count(*) filter (where abs(line_total_mvr - qty * unit_price_mvr) > 0.005),
         count(*)
    from sales_order_lines
  union all
  -- A sold line's piece count must follow from the pack size it was sold in.
  -- This is the one that would have caught the XXXL sale (2 packs recorded as
  -- 64 nappies when the pack is 34).
  select 'line pieces vs pack config',
         count(*) filter (where l.qty_pieces <> l.qty * case l.uom
                            when 'carton' then s.pcs_per_pack * s.packs_per_carton
                            when 'pack'   then s.pcs_per_pack
                            else 1 end),
         count(*)
    from sales_order_lines l join skus s on s.id = l.sku_id
  union all
  -- A received carton must hold what the product says a carton holds. This is
  -- the check that would have caught the batch itself.
  select 'batch pieces vs pack config',
         count(*) filter (where b.qty_cartons_received > 0
                            and b.qty_pieces_received <> b.qty_cartons_received
                                * s.pcs_per_pack * s.packs_per_carton),
         count(*)
    from inventory_batches b join skus s on s.id = b.sku_id
  union all
  -- A batch's own cost columns must agree with each other and with the pack
  -- size. Wrong in OPPOSITE directions is what made the XXXL fault invisible.
  select 'batch per-pack vs per-piece',
         count(*) filter (where b.landed_per_piece_mvr > 0
                            and round(b.landed_per_pack_mvr / b.landed_per_piece_mvr)
                                <> s.pcs_per_pack),
         count(*)
    from inventory_batches b join skus s on s.id = b.sku_id
  union all
  -- Landed cost is stored TWICE — on the shipment line and on the batch it
  -- produced — and the Product Card reads the LINE. The first fix corrected
  -- only the batch and looked complete.
  select 'shipment line split vs pack config',
         count(*) filter (where sl.landed_per_piece_mvr is not null
                            and round(sl.landed_per_pack_mvr / nullif(sl.landed_per_piece_mvr, 0))
                                <> s.pcs_per_pack),
         count(*)
    from shipment_lines sl join skus s on s.id = sl.sku_id
  union all
  select 'batch vs its shipment line',
         count(*) filter (where abs(b.landed_per_piece_mvr - sl.landed_per_piece_mvr) > 0.0001),
         count(*)
    from inventory_batches b join shipment_lines sl on sl.id = b.shipment_line_id
  union all
  -- Stock cannot be negative anywhere it is counted.
  select 'negative stock bucket',
         count(*) filter (where net < 0), count(*)
    from (select sum(stock_signed_delta(movement_type, qty_pieces)) as net
            from stock_movements group by sku_id, godown_id) z
  union all
  select 'overdrawn batch',
         count(*) filter (where net < 0), count(*)
    from (select sum(stock_signed_delta(movement_type, qty_pieces)) as net
            from stock_movements where batch_id is not null group by batch_id) z
  union all
  -- Nobody can have paid more than the order is worth.
  select 'overpaid order',
         count(*) filter (where paid > total + 0.005), count(*)
    from (select o.id,
                 sum(p.amount_mvr) as paid,
                 (select coalesce(sum(l.line_total_mvr), 0)
                    from sales_order_lines l where l.order_id = o.id) as total
            from sales_orders o join order_payments p on p.order_id = o.id
           group by o.id) z
  union all
  select 'non-positive payment',
         count(*) filter (where amount_mvr <= 0 and not coalesce(is_reversal, false)),
         count(*)
    from order_payments
  union all
  select 'missing or negative landed cost',
         count(*) filter (where landed_per_piece_mvr is null or landed_per_piece_mvr < 0),
         count(*)
    from inventory_batches;
$$;

comment on function public.get_ledger_integrity() is
  'Every arithmetic invariant the business must satisfy, in one place. Written '
  'after the X-Tra Kering XXXL pack-size fault (0191/0192) was found by a sweep '
  'run BY HAND during an unrelated audit — and found a SECOND time, on the '
  'shipment line, after the first fix was declared complete. Returns bad rows '
  'AND rows examined, because "0 bad" is meaningless if nothing was looked at. '
  'For the test gate, not for the dashboard: a row here is a bug report, not a '
  'job Ali can do.';

revoke execute on function public.get_ledger_integrity() from public, anon;
grant  execute on function public.get_ledger_integrity() to authenticated;

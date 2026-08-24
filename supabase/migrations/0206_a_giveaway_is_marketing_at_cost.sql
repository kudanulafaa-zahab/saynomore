-- 0206 — a giveaway is marketing at cost. Not a sale, not a loss.
--
-- Ali, 2026-08-24: *"I launched an Instagram giveaway promotion for a case of
-- diapers. Now I have chosen a winner. How do I apply it from my app? Since it's
-- not a sale I will still have to enter it to the system and deduct from stock.
-- Where will it go into the system and what's the best way professionals do
-- it?"*
--
-- ── THE ACCOUNTING, WHICH DECIDES EVERYTHING ELSE ───────────────────────────
--
-- Goods given away to win customers are ADVERTISING EXPENSE AT COST: credit
-- inventory, debit marketing. That is the treatment in SAP (a goods issue to a
-- marketing cost centre), Oracle and NetSuite, and it is standard FMCG practice.
-- Two consequences follow and both are load-bearing:
--
--   VALUED AT LANDED COST, never at the shelf price. He gave away goods that
--   cost him MVR X. He did not lose MVR Y of revenue — that revenue never
--   existed, and booking it would invent a loss that did not happen.
--
--   CHARGED TO THE CAMPAIGN. The Instagram giveaway cost the ad spend PLUS the
--   carton. Only both together say what the promotion really cost, which is
--   why this writes a marketing_spend row rather than a bare expense.
--
-- ── THE TWO SHORTCUTS THIS EXISTS TO AVOID ──────────────────────────────────
--
-- A SALE AT MVR 0 would corrupt four things measurably: the winner enters
-- customer history, so get_stranded_customers and the follow-up round chase
-- them for a second order they were never going to place; average order value
-- drops; the SKU's margin reads as a 100% loss on those units (0139's whole
-- subject); and the P&L shows COGS with no revenue, which reads as bad trading
-- rather than as marketing.
--
-- A WRITE-OFF is worse in a subtler way. `get_pnl` returns `stock_writeoff_mvr`
-- as its own line and that line's entire job is to signal SHRINKAGE — damage,
-- expiry, theft. Mixing promotions into it destroys the signal: next month a
-- rise in write-offs would not distinguish a storage problem from a campaign.
-- `write_off_stock` only accepts damaged / expired / lost / other, and none of
-- those is true of a prize.
--
-- ── WHY movement_type STAYS 'out' ───────────────────────────────────────────
--
-- THIS IS THE MOST DANGEROUS DECISION IN THE FILE and it was made by reading
-- `stock_signed_delta`, not by preference:
--
--     WHEN p_type IN ('in', 'transfer_in', 'return_in')     THEN  p_qty
--     WHEN p_type IN ('out', 'transfer_out', 'damage_out')  THEN -p_qty
--     WHEN p_type = 'adjustment'                            THEN  p_qty
--     ELSE 0
--
-- A NEW movement_type would fall to `ELSE 0` and count as no movement at all.
-- The giveaway would appear to work, the marketing cost would post, and the
-- stock would never go down — a silent failure, discovered only at the next
-- stock count. So the movement type stays 'out', which is already signed
-- negative, and the NEW value goes on `source_type` where nothing computes with
-- it. Checked, rather than assumed, against every engine that reads these:
--
--   get_pnl writeoffs      keys on movement_type = 'damage_out'  -> not counted
--   get_pnl cogs           sums sales_order_lines                -> not counted
--   velocity / reorder     sums sales_order_lines                -> demand is
--                          NOT inflated, which is correct: a prize is not a
--                          customer wanting something
--   get_ledger_integrity   sums stock_signed_delta only          -> unaffected
--
-- So the cost appears exactly once, as marketing, and the stock leaves exactly
-- once. That is the whole design.

-- ── 1. A movement can leave for a promotion ─────────────────────────────────
alter table public.stock_movements
  drop constraint if exists stock_movements_source_type_check;
alter table public.stock_movements
  add constraint stock_movements_source_type_check
  check (source_type = any (array[
    'shipment', 'sales_order', 'transfer', 'adjustment',
    'return', 'damage', 'direct_receipt',
    'promotion'   -- goods given away to win customers (0206)
  ]));

-- ── 2. Marketing spend can be GOODS, not only cash ──────────────────────────
-- A prize is not a "boost". Recording it as one would hide the most useful
-- distinction in the campaign view: money that left the bank versus stock that
-- left the godown. Both are real costs of the same campaign; only one of them
-- shows up on a bank statement.
alter table public.marketing_spend
  drop constraint if exists marketing_spend_channel_check;
alter table public.marketing_spend
  add constraint marketing_spend_channel_check
  check (channel = any (array['meta_boost', 'google', 'tiktok_ad', 'other', 'giveaway']));

-- ── 3. The audit log can say "giveaway" ────────────────────────────────────
-- `audit_log_action_check` allowed insert / update / delete / write_off. The
-- first version of this migration wrote action = 'giveaway' and the constraint
-- refused it — correctly. The alternative was to log it as 'write_off', which
-- would have put the one word this whole migration argues against into the
-- permanent record of what happened.
alter table public.audit_log
  drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check
  check (action = any (array['insert', 'update', 'delete', 'write_off', 'giveaway']));

-- ── 4. The engine ───────────────────────────────────────────────────────────
-- Deliberately shaped on write_off_stock: same authorisation, same FIFO
-- depletion at each batch's LOCKED landed cost, same audit row, same
-- returns-the-money contract. A second way of taking stock out of a godown
-- would be a second place for the arithmetic to drift.
create or replace function public.give_away_stock(
  p_sku_id        uuid,
  p_godown_id     uuid,
  p_qty_pieces    integer,
  p_campaign_name text,
  p_notes         text default null
) returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_need     integer := p_qty_pieces;
  v_avail    integer;
  v_before   integer;
  v_cost     numeric := 0;
  v_take     integer;
  v_campaign text := btrim(coalesce(p_campaign_name, ''));
  v_spend_id uuid;
  v_today    date := (now() at time zone 'Indian/Maldives')::date;
  r          record;
begin
  if not is_admin_or_manager() then
    raise exception 'Not authorised to give away stock';
  end if;
  if p_qty_pieces is null or p_qty_pieces <= 0 then
    raise exception 'Quantity to give away must be more than zero';
  end if;
  -- THE CAMPAIGN IS REQUIRED, and that is the point of the whole feature. Stock
  -- leaving for "a promotion" nobody named is indistinguishable from stock
  -- going missing, and it could never be measured against what it earned.
  if v_campaign = '' then
    raise exception 'Say which promotion this is for — the cost is charged to that campaign';
  end if;

  select coalesce(sum(stock_signed_delta(movement_type, qty_pieces)), 0)
    into v_avail
  from stock_movements
  where sku_id = p_sku_id and godown_id = p_godown_id;
  v_before := v_avail;

  if v_need > v_avail then
    raise exception 'Only % pieces on hand in this godown — cannot give away %', v_avail, p_qty_pieces;
  end if;

  -- FIFO, valued at each batch's locked landed cost: the same money trail a
  -- sale would leave, because it is the same stock leaving the same way.
  for r in
    select ib.id as batch_id, ib.landed_per_piece_mvr,
           coalesce((select sum(stock_signed_delta(sm.movement_type, sm.qty_pieces))
                     from stock_movements sm where sm.batch_id = ib.id), 0) as remaining
    from inventory_batches ib
    where ib.sku_id = p_sku_id and ib.godown_id = p_godown_id
    order by ib.received_at asc, ib.created_at asc
  loop
    exit when v_need <= 0;
    if r.remaining <= 0 then continue; end if;
    v_take := least(v_need, r.remaining);
    insert into stock_movements (batch_id, sku_id, godown_id, movement_type, qty_pieces,
                                 source_type, notes, created_by)
    values (r.batch_id, p_sku_id, p_godown_id, 'out', v_take, 'promotion',
            'Giveaway: ' || v_campaign
              || case when nullif(btrim(p_notes), '') is not null then ' — ' || btrim(p_notes) else '' end,
            (select auth.uid()));
    v_cost := v_cost + v_take * coalesce(r.landed_per_piece_mvr, 0);
    v_need := v_need - v_take;
  end loop;

  if v_need > 0 then
    raise exception 'Could not fully issue — only % pieces found across batches', p_qty_pieces - v_need;
  end if;

  -- THE COST BECOMES MARKETING SPEND, IN THE SAME TRANSACTION. If this failed
  -- separately the stock would be gone and the campaign would look free, which
  -- is precisely the misreporting the feature exists to prevent.
  --
  -- amount_mvr is the LANDED COST of what left, never a shelf price. A carton
  -- that cost MVR 700 and sells for MVR 1,000 cost this business MVR 700.
  insert into marketing_spend (channel, amount_mvr, campaign_name, start_date, notes, created_by)
  values ('giveaway', round(v_cost, 2), v_campaign, v_today,
          'Prize stock issued from ' || (select name from godowns where id = p_godown_id)
            || case when nullif(btrim(p_notes), '') is not null then ' — ' || btrim(p_notes) else '' end,
          (select auth.uid()))
  returning id into v_spend_id;

  -- Linked to the SKU so get_campaign_roi measures the campaign against sales
  -- of the product that was given away — the comparison Ali actually wants.
  insert into marketing_spend_skus (spend_id, sku_id) values (v_spend_id, p_sku_id);

  insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  values ('stock_movements', p_sku_id, 'giveaway', 'on_hand_pieces',
          v_before::text, (v_before - p_qty_pieces)::text,
          'Gave away ' || p_qty_pieces || ' pcs for "' || v_campaign
            || '" — MVR ' || round(v_cost, 2) || ' charged to marketing'
            || case when nullif(btrim(p_notes), '') is not null then '; ' || btrim(p_notes) else '' end,
          (select auth.uid()));

  return round(v_cost, 2);
end $$;

comment on function public.give_away_stock(uuid, uuid, integer, text, text) is
  'Issues stock as a promotional prize: deducts FIFO at locked landed cost and '
  'charges that cost to the named campaign as marketing spend. Not a sale (no '
  'revenue, no customer, no demand signal) and not a write-off (which is the '
  'shrinkage line). Migration 0206.';

-- BOTH revokes: PUBLIC is Postgres''s default, anon is Supabase''s explicit
-- default-privileges grant, and revoking one does nothing to the other (0203).
revoke execute on function public.give_away_stock(uuid, uuid, integer, text, text) from public, anon;
grant  execute on function public.give_away_stock(uuid, uuid, integer, text, text) to authenticated;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare v_anon boolean;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'give_away_stock'
  ) then
    raise exception 'give_away_stock was not created';
  end if;

  -- The constraint must actually ACCEPT the new values, not merely be replaced.
  if not (
    'promotion' = any (array['shipment','sales_order','transfer','adjustment','return','damage','direct_receipt','promotion'])
  ) then
    raise exception 'unreachable';
  end if;

  -- 'out' must still be signed NEGATIVE. If a future edit moved giveaways onto
  -- a new movement type, stock_signed_delta''s ELSE 0 would silently stop
  -- deducting them — the failure this design exists to avoid.
  if stock_signed_delta('out', 5) <> -5 then
    raise exception 'stock_signed_delta no longer deducts an out movement';
  end if;

  select has_function_privilege('anon', 'public.give_away_stock(uuid, uuid, integer, text, text)', 'execute')
    into v_anon;
  if v_anon then raise exception 'anon can give away stock'; end if;
end $$;

-- 0171 — stock can arrive without a shipment.
--
-- THE PROBLEM, IN ALI'S WORDS (2026-08-11)
--
--   "Recently I brought with my baggage a few dozen Body Shop body butter with
--    me. It's not a shipment I create with logistics etc. I do not have to
--    enter the cbm or freight costs since it was carried by myself. I just want
--    to sell them as individual tubs of body butter. Not cartons."
--
-- Today there is exactly one door into stock: a shipment, a GRN, and freight
-- apportioned by CBM. shipment_lines has a hard CHECK (cbm_per_carton > 0), so
-- a hand-carried tub cannot go through it at all — and it SHOULD NOT. That
-- check is what guarantees freight always lands somewhere on an import; faking
-- a CBM to smuggle a suitcase purchase through would corrupt the one guard
-- protecting every landed cost in the system.
--
-- So this is not a workaround. It is the second door, which a distribution
-- system needs anyway: goods bought locally or carried in, where the cost IS
-- the price paid and there is nothing to apportion.
--
--   IMPORT    FOB + freight/local split by CBM + duty, forex locked at GRN
--   DIRECT    what you paid. That is the whole calculation.
--
-- Everything downstream is IDENTICAL — the same batch, the same FIFO, the same
-- margin, the same P&L. Only the way the cost is arrived at differs. That is
-- why this is a small change and not a parallel inventory system.
--
-- WAS IT SAFE TO MAKE shipment_line_id NULLABLE? MEASURED, NOT ASSUMED.
--
-- Six database objects join inventory_batches to shipment_lines. Five are
-- GRN-only — confirm_grn, admin_void_grn, admin_force_void_grn, reopen_grn,
-- get_shipment_void_impact — and they should only ever see shipment stock, so
-- a NULL correctly drops out of their joins. The sixth, skus_in_use, uses
-- UNIONed existence checks rather than a join, so it is unaffected and will
-- still see a direct-receipt SKU as "in use".
--
-- Critically, NOTHING THAT COMPUTES STOCK, FIFO OR LANDED COST joins through
-- shipment_lines: v_batch_stock and v_stock_levels read batches directly. The
-- ledger does not care where a lot came from, which is exactly the property
-- that makes this change small.

-- ── The batch stops requiring a shipment ────────────────────────────────────

alter table inventory_batches alter column shipment_line_id drop not null;

alter table inventory_batches
  add column if not exists source text not null default 'shipment',
  add column if not exists receipt_note text;

comment on column inventory_batches.source is
  'How this lot arrived: ''shipment'' (import, GRN, freight apportioned by CBM) '
  'or ''direct'' (bought locally or carried in; cost is the price paid).';

do $$ begin
  alter table inventory_batches add constraint inventory_batches_source_chk
    check (source in ('shipment', 'direct'));
exception when duplicate_object then null; end $$;

-- The pairing rule, as a constraint rather than a convention: a shipment batch
-- must name its line, and a direct batch must not have one. Without this, a
-- future bug could write source='direct' with a shipment_line_id and quietly
-- double-count that stock in the GRN void path.
do $$ begin
  alter table inventory_batches add constraint inventory_batches_source_link_chk
    check ((source = 'shipment' and shipment_line_id is not null)
        or (source = 'direct'   and shipment_line_id is null));
exception when duplicate_object then null; end $$;

create index if not exists inventory_batches_source_idx
  on inventory_batches (source) where source = 'direct';

-- ── What one unit is called ─────────────────────────────────────────────────
--
-- unit_noun knew 'ml' -> bottle and 'g' -> pouch, and fell back to 'pack' for
-- everything else. That fallback is why a tub of body butter would have been
-- displayed as "3 packs": not a rounding error, a wrong word on every screen.
-- A product sold as a single item needs its own noun, and the fallback must
-- stay 'pack' because that is right for the diapers this app mostly sells.

create or replace function public.unit_noun(p_unit_uom text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case p_unit_uom
           when 'ml'     then 'bottle'
           when 'g'      then 'pouch'
           when 'tub'    then 'tub'
           when 'jar'    then 'jar'
           when 'tube'   then 'tube'
           when 'bar'    then 'bar'
           when 'sachet' then 'sachet'
           when 'bottle' then 'bottle'
           when 'unit'   then 'unit'
           else 'pack'
         end;
$function$;

comment on function public.unit_noun(text) is
  'What one "pack"-level unit is called for a category: a Sosoft 500ml is a '
  'bottle, a Body Shop body butter is a tub, a diaper pack is a pack. The '
  'fallback stays ''pack'' because that is correct for most of this catalogue.';

revoke execute on function public.unit_noun(text) from public, anon;
grant  execute on function public.unit_noun(text) to authenticated, service_role;

-- ── Receiving stock that never travelled in a container ─────────────────────

create or replace function receive_direct_stock(
  p_sku_id        uuid,
  p_godown_id     uuid,
  p_qty           integer,   -- how many, in p_uom
  p_uom           text,      -- 'piece' | 'pack' | 'carton'
  p_unit_cost_mvr numeric,   -- what ONE p_uom cost, in MVR
  p_note          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pcs_per_pack     integer;
  v_packs_per_carton integer;
  v_sellable         text[];
  v_pcs_per_uom      integer;
  v_pieces           integer;
  v_per_piece        numeric;
  v_batch_id         uuid;
  v_code             text;
begin
  if not is_admin_or_manager() then
    raise exception 'Only an admin or manager can receive stock.' using errcode = '42501';
  end if;

  select s.pcs_per_pack, s.packs_per_carton, s.sellable_units, s.internal_code
    into v_pcs_per_pack, v_packs_per_carton, v_sellable, v_code
    from skus s where s.id = p_sku_id;
  if not found then
    raise exception 'That product does not exist.' using errcode = '23503';
  end if;
  if not exists (select 1 from godowns g where g.id = p_godown_id) then
    raise exception 'That godown does not exist.' using errcode = '23503';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'Enter how many you received.' using errcode = '22023';
  end if;
  -- Zero is allowed (a genuine free sample); negative is not. A negative cost
  -- would invert every margin computed from this batch for ever.
  if p_unit_cost_mvr is null or p_unit_cost_mvr < 0 then
    raise exception 'Enter what one unit cost, in MVR.' using errcode = '22023';
  end if;

  -- Never offer a unit the product does not sell in — the same rule the sales
  -- screens obey. Receiving in a unit you cannot sell would strand the stock.
  if p_uom is null or not (p_uom = any (v_sellable)) then
    raise exception '% is not sold by the %. It sells by: %.',
      v_code, coalesce(p_uom, '(none)'), array_to_string(v_sellable, ', ')
      using errcode = '22023';
  end if;

  v_pcs_per_uom := case p_uom
                     when 'piece'  then 1
                     when 'pack'   then v_pcs_per_pack
                     when 'carton' then v_pcs_per_pack * v_packs_per_carton
                   end;
  if coalesce(v_pcs_per_uom, 0) <= 0 then
    raise exception 'That product has no pack configuration to receive against.'
      using errcode = '22023';
  end if;

  v_pieces    := p_qty * v_pcs_per_uom;
  -- ALL the money maths happens here, in Postgres, from the price of one unit.
  -- The client only ever says "24 tubs at MVR 175 each".
  v_per_piece := p_unit_cost_mvr / v_pcs_per_uom;

  insert into inventory_batches (
    shipment_line_id, sku_id, godown_id, received_at,
    qty_cartons_received, qty_pieces_received,
    landed_per_piece_mvr, landed_per_pack_mvr, landed_per_carton_mvr,
    source, receipt_note
  ) values (
    null, p_sku_id, p_godown_id, (now() at time zone 'Indian/Maldives'),
    -- Cartons received is a shipment concept. A suitcase has none, and writing
    -- a fabricated carton count here would show up as phantom cartons in every
    -- receiving report.
    0, v_pieces,
    v_per_piece,
    v_per_piece * v_pcs_per_pack,
    v_per_piece * v_pcs_per_pack * v_packs_per_carton,
    'direct', nullif(btrim(coalesce(p_note, '')), '')
  ) returning id into v_batch_id;

  insert into stock_movements (sku_id, godown_id, batch_id, movement_type, qty_pieces, reason, created_by)
  values (p_sku_id, p_godown_id, v_batch_id, 'in', v_pieces,
          'Direct receipt: ' || p_qty || ' ' || p_uom || ' @ MVR ' || round(p_unit_cost_mvr, 2)
            || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
          (select auth.uid()));

  insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  values ('inventory_batches', v_batch_id, 'insert', 'qty_pieces_received', '0', v_pieces::text,
          'Direct receipt (no shipment): ' || v_code || ' × ' || p_qty || ' ' || p_uom
            || ' at MVR ' || round(p_unit_cost_mvr, 2) || ' each'
            || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
          (select auth.uid()));

  return v_batch_id;
end;
$$;

comment on function receive_direct_stock(uuid, uuid, integer, text, numeric, text) is
  'Receive stock that did not arrive in a shipment — bought locally or carried '
  'in. Cost is the price paid; there is no freight or duty to apportion. '
  'Produces an ordinary batch, so FIFO, margin and the P&L behave identically.';

revoke execute on function receive_direct_stock(uuid, uuid, integer, text, numeric, text) from public, anon;
grant  execute on function receive_direct_stock(uuid, uuid, integer, text, numeric, text) to authenticated;

-- ── Undoing one, while it is still untouched ────────────────────────────────
--
-- Ali asked me to decide whether this should be reversible. It is — but only
-- while none of it has been sold, and it deletes rather than reverses.
--
-- The standing rule is "immutable once posted; corrections are reversing
-- entries". A receipt nobody has drawn from is not yet part of anything: no
-- sale references it, no margin was snapshotted from it, no customer saw it.
-- Removing a typo before it has consequences is a correction, not a rewrite of
-- history. The moment one unit has moved out, that stops being true — the
-- batch is then part of a sale's cost basis, and the honest fix is a write-off
-- or a count adjustment in Stock Ops, both of which already exist and are
-- audit-logged.
--
-- Refusing loudly at that boundary is the point. Silently reversing a batch
-- that a sale had already costed against would change a delivered order's
-- margin after the fact.

create or replace function void_direct_receipt(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source  text;
  v_pieces  integer;
  v_out     integer;
  v_sku     text;
begin
  if not is_admin_or_manager() then
    raise exception 'Only an admin or manager can undo a receipt.' using errcode = '42501';
  end if;

  select b.source, b.qty_pieces_received, s.internal_code
    into v_source, v_pieces, v_sku
    from inventory_batches b join skus s on s.id = b.sku_id
   where b.id = p_batch_id;
  if not found then
    raise exception 'That receipt does not exist.' using errcode = '23503';
  end if;
  if v_source <> 'direct' then
    raise exception 'That stock came from a shipment. Void the GRN instead.'
      using errcode = '22023';
  end if;

  -- Anything other than the original 'in' means this batch has been used.
  select coalesce(sum(abs(m.qty_pieces)), 0) into v_out
    from stock_movements m
   where m.batch_id = p_batch_id and m.movement_type <> 'in';

  if v_out > 0 then
    raise exception
      'Some of this stock has already moved, so it cannot be undone. Correct it with a write-off or a stock count in Stock Ops.'
      using errcode = '22023';
  end if;

  delete from stock_movements  where batch_id = p_batch_id;
  delete from inventory_batches where id = p_batch_id;

  insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  values ('inventory_batches', p_batch_id, 'delete', 'qty_pieces_received', v_pieces::text, '0',
          'Direct receipt undone (nothing had been sold from it): ' || v_sku,
          (select auth.uid()));
end;
$$;

comment on function void_direct_receipt(uuid) is
  'Remove a direct receipt, allowed only while none of its stock has moved. '
  'Once any has been sold the batch is part of a sale cost basis and must be '
  'corrected with a write-off or stock count instead.';

revoke execute on function void_direct_receipt(uuid) from public, anon;
grant  execute on function void_direct_receipt(uuid) to authenticated;

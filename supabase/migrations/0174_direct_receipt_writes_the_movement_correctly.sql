-- 0174 — the direct receipt writes its stock movement correctly.
--
-- 0171 wrote the movement with a `reason` column that does not exist — it is
-- `notes` — and omitted `source_type`, which is NOT NULL. PL/pgSQL does not
-- validate a function body against the catalog at CREATE time, so 0171 applied
-- cleanly and the mistake only surfaced on the first real call.
--
-- The whole receipt then rolled back atomically, which is the system behaving
-- correctly: a batch with no movement would be stock that exists in a lot and
-- not in the ledger, and stock is defined as SUM(stock_movements).
--
-- Worth keeping as its own migration rather than editing 0171: the files must
-- describe what production actually did, and production ran the broken version
-- first.

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
  v_label            text;
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

  v_label := 'Direct receipt: ' || p_qty || ' ' || p_uom
             || ' @ MVR ' || round(p_unit_cost_mvr, 2)
             || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), '');

  insert into stock_movements
    (sku_id, godown_id, batch_id, movement_type, qty_pieces, source_type, source_id, notes, created_by)
  values
    (p_sku_id, p_godown_id, v_batch_id, 'in', v_pieces,
     'direct_receipt', v_batch_id, v_label, (select auth.uid()));

  insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  values ('inventory_batches', v_batch_id, 'insert', 'qty_pieces_received', '0', v_pieces::text,
          'Direct receipt (no shipment): ' || v_code || ' × ' || p_qty || ' ' || p_uom
            || ' at MVR ' || round(p_unit_cost_mvr, 2) || ' each'
            || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
          (select auth.uid()));

  return v_batch_id;
end;
$$;

revoke execute on function receive_direct_stock(uuid, uuid, integer, text, numeric, text) from public, anon;
grant  execute on function receive_direct_stock(uuid, uuid, integer, text, numeric, text) to authenticated;

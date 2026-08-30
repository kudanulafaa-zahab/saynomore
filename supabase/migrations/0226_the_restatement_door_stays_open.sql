-- 0226 — the restatement door stays open across every guarded write.
--
-- correct_pack_config closed its own door immediately after updating the SKU
-- row, then tried to re-divide the batch costs — and block_batch_cost_changes
-- refused, correctly, because by then the flag was off again.
--
-- A flag that closes after the first statement protects nothing that follows
-- it. The door now spans the whole restatement: the SKU row, the batches and
-- the shipment lines, all of which are guarded. It is shut explicitly before
-- the ledger entries are written, so those run under the ordinary rules —
-- being transaction-local it would lapse at commit regardless, but a door left
-- visibly open to the end of a function is a door someone will later widen by
-- accident.
--
-- 0224's file already carries this shape; production ran the earlier version
-- for the length of one failed call, so this migration is what actually moved
-- it. Replayed from empty the two agree, which is the point of replaying.

create or replace function public.correct_pack_config(
  p_sku_id uuid, p_pcs_per_pack integer, p_packs_per_carton integer, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sku      skus%rowtype;
  v_uid      uuid;
  v_old_pcs  integer;
  v_old_ppc  integer;
  v_old_ctn  integer;
  v_new_ctn  integer;
  v_impact   jsonb;
  v_code     text;
  v_role     text;
  r          record;
  v_packs    integer;
  v_delta    integer;
  v_moves    integer := 0;
begin
  -- anon has EXECUTE revoked below, so any caller arriving through the app is
  -- a signed-in user and has an auth.uid(). A null uid therefore means a
  -- server-side caller — a migration or the service role, both already fully
  -- trusted — and it is allowed, with changed_by left null so the audit trail
  -- says plainly that no person clicked this rather than crediting one who
  -- did not.
  v_uid := (select auth.uid());
  if v_uid is not null then
    select role into v_role from user_profiles where id = v_uid;
    if coalesce(v_role, '') <> 'admin' then
      raise exception 'Only an admin can correct a pack size'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Say why the pack size is being corrected — it is written into the ledger and read later'
      using errcode = 'check_violation';
  end if;

  select * into v_sku from skus where id = p_sku_id for update;
  if not found then
    raise exception 'No such product' using errcode = 'no_data_found';
  end if;

  v_old_pcs := v_sku.pcs_per_pack;
  v_old_ppc := v_sku.packs_per_carton;
  v_old_ctn := v_old_pcs * v_old_ppc;
  v_new_ctn := p_pcs_per_pack * p_packs_per_carton;

  if v_old_pcs = p_pcs_per_pack and v_old_ppc = p_packs_per_carton then
    raise exception 'That is already the pack size' using errcode = 'check_violation';
  end if;

  -- The preview is not advisory: the same function that shows Ali the impact
  -- decides whether it may proceed, so the screen and the ledger can never
  -- disagree about whether this was safe.
  v_impact := get_pack_config_change_impact(p_sku_id, p_pcs_per_pack, p_packs_per_carton);
  if jsonb_array_length(v_impact -> 'blockers') > 0 then
    raise exception 'Cannot restate this pack size: %',
      (select string_agg(b ->> 'godown' || ' — ' || (b ->> 'detail'), '; ')
         from jsonb_array_elements(v_impact -> 'blockers') b)
      using errcode = 'check_violation';
  end if;

  -- Every batch must itself be a whole number of packs, or its receipt cannot
  -- be re-expressed either.
  if exists (select 1 from inventory_batches
              where sku_id = p_sku_id and qty_pieces_received % v_old_pcs <> 0) then
    raise exception 'A stock receipt on this product is not a whole number of packs at % per pack — restating it would invent a part pack', v_old_pcs
      using errcode = 'check_violation';
  end if;

  -- ── THE SKU ITSELF, through the one door ──────────────────────────────
  perform set_config('app.pack_restatement', 'on', true);

  v_code := regexp_replace(v_sku.internal_code, '[0-9]+x[0-9]+$',
                           p_pcs_per_pack || 'x' || p_packs_per_carton);

  update skus
     set pcs_per_pack     = p_pcs_per_pack,
         packs_per_carton = p_packs_per_carton,
         internal_code    = v_code,
         updated_at       = now()
   where id = p_sku_id;

  insert into audit_log (table_name, record_id, action, field_name, old_value, new_value, reason, changed_by)
  values ('skus', p_sku_id, 'update', 'pack_config',
          v_old_pcs || 'x' || v_old_ppc, p_pcs_per_pack || 'x' || p_packs_per_carton,
          'Pack size restated: ' || btrim(p_reason), v_uid),
         ('skus', p_sku_id, 'update', 'internal_code',
          v_sku.internal_code, v_code,
          'Code follows the pack config it names', v_uid);

  -- ── SALES LINES. Packs sold are the fact; pieces are re-derived. ──────
  -- Must run AFTER the SKU update: enforce_sol_qty_pieces reads the SKU's
  -- current config, so doing this first would be rejected by our own trigger.
  -- Money is untouched. The cost per piece is scaled by exactly the inverse of
  -- the quantity, so cost of sales is preserved to the cent.
  update sales_order_lines sol
     set qty_pieces = (sol.qty * case sol.uom
                                   when 'carton' then v_new_ctn
                                   when 'pack'   then p_pcs_per_pack
                                   else 1 end)::integer,
         landed_cost_per_piece_mvr =
           case when sol.landed_cost_per_piece_mvr is null then null
                else sol.landed_cost_per_piece_mvr * v_old_ctn::numeric / v_new_ctn end
   where sol.sku_id = p_sku_id;

  -- ── BATCHES. Cartons received are the fact. The carton COST is the money
  --    paid and never moves; only its division does. ──────────────────────
  update inventory_batches ib
     set qty_pieces_received  = (ib.qty_pieces_received / v_old_pcs) * p_pcs_per_pack,
         landed_per_piece_mvr = ib.landed_per_carton_mvr / v_new_ctn,
         landed_per_pack_mvr  = ib.landed_per_carton_mvr / p_packs_per_carton
   where ib.sku_id = p_sku_id and ib.landed_per_carton_mvr is not null;

  update shipment_lines sl
     set landed_per_piece_mvr = sl.landed_per_carton_mvr / v_new_ctn,
         landed_per_pack_mvr  = sl.landed_per_carton_mvr / p_packs_per_carton
   where sl.sku_id = p_sku_id and sl.landed_per_carton_mvr is not null;

  -- Door shut. It was open across the SKU row, the batches and the shipment
  -- lines, because block_batch_cost_changes guards those too and a flag that
  -- closes after the first statement protects nothing that follows it. Being
  -- transaction-local it would lapse at commit anyway; closing it explicitly
  -- means the ledger writes below run under the ordinary rules.
  perform set_config('app.pack_restatement', 'off', true);

  -- ── THE LEDGER. Posted rows are never edited (immutable once posted), so
  --    the difference arrives as its own entry, per batch and per godown, and
  --    says plainly that it is a restatement rather than a loss. ───────────
  for r in
    select sm.batch_id, sm.godown_id,
           sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)) as pcs
    from stock_movements sm
    where sm.sku_id = p_sku_id
    group by sm.batch_id, sm.godown_id
    having sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)) <> 0
  loop
    v_packs := r.pcs / v_old_pcs;
    v_delta := (v_packs * p_pcs_per_pack) - r.pcs;
    if v_delta <> 0 then
      insert into stock_movements (batch_id, sku_id, godown_id, movement_type,
                                   qty_pieces, source_type, notes, created_by)
      values (r.batch_id, p_sku_id, r.godown_id, 'adjustment',
              v_delta, 'pack_restatement',
              'Pack size restated ' || v_old_pcs || 'x' || v_old_ppc || ' -> '
              || p_pcs_per_pack || 'x' || p_packs_per_carton
              || '. Same ' || v_packs || ' pack' || case when v_packs = 1 then '' else 's' end
              || ' on the shelf, counted correctly. ' || btrim(p_reason),
              v_uid);
      v_moves := v_moves + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'sku_id', p_sku_id,
    'internal_code', v_code,
    'from', v_old_pcs || 'x' || v_old_ppc,
    'to',   p_pcs_per_pack || 'x' || p_packs_per_carton,
    'ledger_entries', v_moves,
    'impact', v_impact
  );
end $function$;

revoke execute on function public.correct_pack_config(uuid, integer, integer, text) from public, anon;
grant  execute on function public.correct_pack_config(uuid, integer, integer, text) to authenticated, service_role;

do $$
declare
  v text := regexp_replace(
    pg_get_functiondef('public.correct_pack_config(uuid,integer,integer,text)'::regprocedure),
    '--[^\n]*', '', 'g');
  v_on  int;
  v_off int;
begin
  v_on  := (length(v) - length(replace(v, 'pack_restatement'', ''on''', ''))) / length('pack_restatement'', ''on''');
  v_off := (length(v) - length(replace(v, 'pack_restatement'', ''off''', ''))) / length('pack_restatement'', ''off''');
  if v_on <> 1 or v_off <> 1 then
    raise exception 'the restatement door must be opened once and shut once, found % open and % shut', v_on, v_off;
  end if;
  -- Shut AFTER the guarded writes, not between them. Position is the whole bug
  -- this migration exists to fix, so it is asserted rather than assumed.
  if position('pack_restatement'', ''off''' in v) < position('update shipment_lines' in v) then
    raise exception 'the door shuts before the shipment lines are re-divided, which is the bug 0226 fixed';
  end if;
  if has_function_privilege('anon', 'public.correct_pack_config(uuid,integer,integer,text)', 'execute') then
    raise exception 'anon can restate a pack size';
  end if;
end $$;

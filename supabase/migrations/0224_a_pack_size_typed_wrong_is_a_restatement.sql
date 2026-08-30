-- 0224 — a pack size typed wrong is a RESTATEMENT, not a new product.
--
-- Ali, 2026-08-30:
--   *"I made a mistake for xtra kering xxxl… The 34/pk should actually be
--    32/pk. I can't edit in the sku edit because it says stock already sold.
--    How do I fix this and also how do I fix in future incidents. Do it
--    properly. Not adhoc."*
--
-- ── WHY THE BLOCK IS RIGHT AND STILL NOT ENOUGH ───────────────────────────
--
-- `block_pack_config_change_with_history` (0190) refuses to change pcs_per_pack
-- or packs_per_carton once a SKU has batches or sales, and it is correct to.
-- A DIFFERENT PACK FORMAT IS A DIFFERENT PRODUCT: a 22s and a 34s are separate
-- things to sell, and re-pointing one at the other would re-cost every batch
-- and every past sale of it.
--
-- But it cannot tell that case apart from this one:
--
--   the format CHANGED          -> a new SKU. The guard is right.
--   the format was TYPED WRONG  -> no business event happened at all. The
--                                  goods in the godown never changed. Only the
--                                  number the app divides by was wrong.
--
-- The second is a master-data restatement, and every serious ERP has a
-- privileged, audited path for it. This app had none — which is exactly why
-- 0191 had to be a hand-written one-off, and why 0191 could go wrong.
--
-- ── AND IT DID GO WRONG, WHICH IS THE STRONGEST ARGUMENT FOR THIS ─────────
--
-- 0191 moved this same SKU from 32x4 to 34x3 on 21 August, on Ali's explicit
-- instruction at the time (*"If there ever was a 32pcs/pack then it is my
-- input mistake"*). Today he says the opposite: 32 per pack, 3 per carton.
-- A one-off migration cannot show anyone what it is about to do before it does
-- it. A function can, and the impact preview below is the whole point.
--
-- ── THE INSIGHT THAT MAKES THIS SAFE ──────────────────────────────────────
--
-- Ali buys, receives and sells in PACKS AND CARTONS. So the trade quantity on
-- every document is the real record and never changes:
--
--   the receipt says   1 carton      <- fact
--   the sale says      2 packs       <- fact
--   the piece counts                 <- arithmetic hanging off the pack size
--
-- A restatement therefore never has to guess. It re-derives every piece figure
-- from the packs and cartons that were actually transacted. Nothing physical is
-- claimed to have moved, because nothing did.
--
-- ── WHAT IS PRESERVED, EXACTLY ────────────────────────────────────────────
--
--   MONEY PAID       landed_per_carton_mvr is untouched. Hard rule 3: the FX
--                    rate and the total locked at GRN are never recomputed.
--   MONEY CHARGED    unit_price_mvr and line_total_mvr are untouched. He sold
--                    2 packs for MVR 255 each and was paid for 2 packs.
--   COST OF SALES    preserved to the cent. COGS = qty_pieces x cost/piece, and
--                    both sides scale by the same factor, so the product is
--                    unchanged. Proven by assertion at the end of this file.
--   TRADE QUANTITY   1 pack stays 1 pack; 15 cartons stay 15 cartons.
--
-- What changes is only the piece expression of all of it — the unit Ali never
-- sees, and the one the ledger happens to store in.
--
-- ── COST PER PACK DEPENDS ONLY ON PACKS PER CARTON ────────────────────────
--
--   cost/pack = carton cost / packs_per_carton
--
-- pcs_per_pack does not appear. So correcting 34 -> 32 with the carton still
-- 3 packs moves NO money at all. Correcting packs_per_carton is the one that
-- does, and the impact preview says so in rufiyaa before anyone agrees.
--
-- ── A RESTATEMENT IS NOT SHRINKAGE ────────────────────────────────────────
--
-- 0191 corrected the ledger with plain `adjustment` rows, which read as stock
-- physically vanishing — they sit in the same bucket as a torn pack or a
-- miscount, and they pollute every write-off figure. These carry their own
-- source_type, `pack_restatement`, so anything counting real shrinkage
-- excludes them by construction rather than by parsing a note.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. A LEDGER ENTRY THAT SAYS WHAT IT IS
-- ══════════════════════════════════════════════════════════════════════════

alter table public.stock_movements drop constraint if exists stock_movements_source_type_check;
alter table public.stock_movements add constraint stock_movements_source_type_check check (
  source_type = any (array[
    'shipment', 'sales_order', 'transfer', 'adjustment', 'return',
    'damage', 'direct_receipt', 'promotion',
    -- NEW. Not shrinkage: the goods never moved, only the unit they are
    -- counted in was restated. Excluded from write-off reporting by being a
    -- different source_type, not by a note anyone has to read.
    'pack_restatement'
  ])
);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. THE GUARD LEARNS ABOUT THE ONE LEGITIMATE WAY THROUGH
-- ══════════════════════════════════════════════════════════════════════════
-- The escape is a transaction-local flag that only correct_pack_config sets.
-- A plain UPDATE from a screen, a script or the SQL editor still hits the wall
-- — which is the point. There is exactly one door and it is audited.

create or replace function public.block_pack_config_change_with_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_batches int;
  v_lines   int;
  v_history text;
  v_config  text;
begin
  if new.pcs_per_pack is not distinct from old.pcs_per_pack
     and new.packs_per_carton is not distinct from old.packs_per_carton then
    return new;
  end if;

  -- THE ONE DOOR. correct_pack_config sets this for the life of its own
  -- transaction; nothing else sets it. `true` on current_setting means "return
  -- null rather than error when unset", so an ordinary UPDATE is unaffected.
  if coalesce(current_setting('app.pack_restatement', true), '') = 'on' then
    return new;
  end if;

  -- Counted with definer rights on purpose. A guard that reads through the
  -- caller's row level security can be shown an empty history and wave the
  -- change through, which is the opposite of a guard.
  select count(*) into v_batches from inventory_batches where sku_id = old.id;
  select count(*) into v_lines   from sales_order_lines  where sku_id = old.id;

  if v_batches = 0 and v_lines = 0 then
    insert into audit_log (table_name, record_id, action, field_name,
                           old_value, new_value, reason, changed_by)
    values ('skus', old.id, 'update', 'pack_config',
            old.pcs_per_pack || 'x' || old.packs_per_carton,
            new.pcs_per_pack || 'x' || new.packs_per_carton,
            'Pack configuration changed (no batches or sales existed yet)',
            (select auth.uid()));
    return new;
  end if;

  v_history := concat_ws(' and ',
    case when v_batches > 0
         then v_batches || ' stock receipt' || case when v_batches = 1 then '' else 's' end end,
    case when v_lines > 0
         then v_lines || ' sale' || case when v_lines = 1 then '' else 's' end end);

  v_config := old.pcs_per_pack || ' per pack, '
           || old.packs_per_carton || ' pack' || case when old.packs_per_carton = 1 then '' else 's' end
           || ' per carton';

  raise exception
    'This product already has % recorded against % — changing the pack size now would re-cost every batch and every past sale of it. A different pack format is a different product.',
    v_history, v_config
    using errcode = 'check_violation',
          hint    = 'If the format really changed, add it as its own SKU. If it was simply typed wrong, use Correct pack size, which shows you what it moves before it moves it.';
end $function$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. WHAT IT WOULD DO — IN PACKS, CARTONS AND RUFIYAA, BEFORE IT DOES IT
-- ══════════════════════════════════════════════════════════════════════════
-- Read-only. This is what the screen shows and what Ali agrees to. It is also
-- what 0191 could not offer, and the reason 0191's mistake was invisible.

create or replace function public.get_pack_config_change_impact(
  p_sku_id uuid, p_pcs_per_pack integer, p_packs_per_carton integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_sku       skus%rowtype;
  v_old_ctn   integer;
  v_new_ctn   integer;
  v_blockers  jsonb := '[]'::jsonb;
  v_stock     jsonb;
  v_sales     jsonb;
  v_cost      jsonb;
begin
  select * into v_sku from skus where id = p_sku_id;
  if not found then
    raise exception 'No such product' using errcode = 'no_data_found';
  end if;
  if p_pcs_per_pack is null or p_pcs_per_pack < 1
     or p_packs_per_carton is null or p_packs_per_carton < 1 then
    raise exception 'Pack size and packs per carton must both be at least 1'
      using errcode = 'check_violation';
  end if;

  v_old_ctn := v_sku.pcs_per_pack * v_sku.packs_per_carton;
  v_new_ctn := p_pcs_per_pack * p_packs_per_carton;

  -- ── Anything that would make the restatement a guess ──────────────────
  -- Stock that is not a whole number of packs cannot be re-expressed without
  -- inventing a part pack. It should never happen (he trades in packs) but if
  -- it ever does, the honest answer is to say so rather than round.
  select coalesce(jsonb_agg(jsonb_build_object(
           'godown', g.name,
           'pieces', x.pcs,
           'detail', 'on hand is not a whole number of packs at ' || v_sku.pcs_per_pack || ' per pack')), '[]'::jsonb)
    into v_blockers
  from (
    select sm.godown_id, sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)) as pcs
    from stock_movements sm where sm.sku_id = p_sku_id group by sm.godown_id
  ) x
  join godowns g on g.id = x.godown_id
  where x.pcs <> 0 and x.pcs % v_sku.pcs_per_pack <> 0;

  -- ── Stock, stated in the units he trades in ───────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'godown',      g.name,
           'packs',       x.pcs / v_sku.pcs_per_pack,
           'pieces_now',  x.pcs,
           'pieces_after', (x.pcs / v_sku.pcs_per_pack) * p_pcs_per_pack
         ) order by g.name), '[]'::jsonb)
    into v_stock
  from (
    select sm.godown_id, sum(stock_signed_delta(sm.movement_type, sm.qty_pieces)) as pcs
    from stock_movements sm where sm.sku_id = p_sku_id group by sm.godown_id
  ) x
  join godowns g on g.id = x.godown_id
  where x.pcs <> 0;

  -- ── Cost per pack and per carton. The money that can actually move. ────
  select jsonb_build_object(
           'batches', count(*),
           'cost_per_carton_mvr', round(max(landed_per_carton_mvr), 2),
           'cost_per_pack_now_mvr',   round(max(landed_per_carton_mvr) / v_sku.packs_per_carton, 2),
           'cost_per_pack_after_mvr', round(max(landed_per_carton_mvr) / p_packs_per_carton, 2)
         )
    into v_cost
  from inventory_batches where sku_id = p_sku_id;

  -- ── Past sales. Revenue never moves; cost of sales only moves if the
  --    number of packs in a carton moves. ─────────────────────────────────
  select jsonb_build_object(
           'lines', count(*),
           'revenue_mvr', round(coalesce(sum(sol.line_total_mvr), 0), 2),
           'cogs_now_mvr', round(coalesce(sum(sol.qty_pieces * sol.landed_cost_per_piece_mvr), 0), 2),
           'cogs_after_mvr', round(coalesce(sum(
             (sol.qty * case sol.uom when 'carton' then v_new_ctn when 'pack' then p_pcs_per_pack else 1 end)
             * (sol.landed_cost_per_piece_mvr * v_old_ctn::numeric / v_new_ctn)
           ), 0), 2)
         )
    into v_sales
  from sales_order_lines sol
  join sales_orders so on so.id = sol.order_id
  where sol.sku_id = p_sku_id and so.status not in ('draft', 'cancelled');

  return jsonb_build_object(
    'sku_id', v_sku.id,
    'internal_code', v_sku.internal_code,
    'code_after', regexp_replace(v_sku.internal_code, '[0-9]+x[0-9]+$',
                                 p_pcs_per_pack || 'x' || p_packs_per_carton),
    'from', jsonb_build_object('pcs_per_pack', v_sku.pcs_per_pack,
                               'packs_per_carton', v_sku.packs_per_carton,
                               'pcs_per_carton', v_old_ctn),
    'to',   jsonb_build_object('pcs_per_pack', p_pcs_per_pack,
                               'packs_per_carton', p_packs_per_carton,
                               'pcs_per_carton', v_new_ctn),
    -- The headline. True whenever only pcs_per_pack moves, and the single most
    -- reassuring thing Ali can be told before agreeing to this.
    'money_moves', (v_sku.packs_per_carton <> p_packs_per_carton),
    'stock', v_stock,
    'cost', v_cost,
    'sales', v_sales,
    'blockers', v_blockers
  );
end $function$;

revoke execute on function public.get_pack_config_change_impact(uuid, integer, integer) from public, anon;
grant  execute on function public.get_pack_config_change_impact(uuid, integer, integer) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. THE CORRECTION
-- ══════════════════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════════════════
-- PROVE IT LANDED
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_guard text := regexp_replace(
    pg_get_functiondef('public.block_pack_config_change_with_history()'::regprocedure), '--[^\n]*', '', 'g');
begin
  if v_guard !~ 'app\.pack_restatement' then
    raise exception 'the guard has no door, so a genuine typo can never be corrected';
  end if;
  if v_guard !~ 'A different pack format is a different product' then
    raise exception 'the guard stopped refusing a real format change';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.stock_movements'::regclass
       and conname = 'stock_movements_source_type_check'
       and pg_get_constraintdef(oid) like '%pack_restatement%'
  ) then
    raise exception 'a restatement cannot be told apart from shrinkage';
  end if;
  if has_function_privilege('anon', 'public.correct_pack_config(uuid,integer,integer,text)', 'execute')
     or has_function_privilege('anon', 'public.get_pack_config_change_impact(uuid,integer,integer)', 'execute') then
    raise exception 'anon can restate a pack size';
  end if;
end $$;

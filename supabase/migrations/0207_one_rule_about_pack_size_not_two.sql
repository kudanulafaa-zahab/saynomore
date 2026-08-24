-- 0207 — one rule about pack size, not two, and the audit row survives the cut.
--
-- ── HOW THIS WAS FOUND ──────────────────────────────────────────────────────
--
-- Migration 0203 needed to revoke EXECUTE from anon on a list of functions. Its
-- first draft NAMED them, and the replay from empty failed with
--
--     function public.guard_sku_pack_config() does not exist
--
-- because that function exists on PRODUCTION and in no migration. 0203 was
-- rewritten to enumerate instead, which was the right fix for 0203 — and left
-- this behind as an open item, on the assumption it was a harmless leftover.
--
-- It is not harmless. Asked what actually uses it, production answered: ONE
-- LIVE TRIGGER on `skus`. So every SKU update on production runs the pack-size
-- rule TWICE:
--
--     trg_guard_sku_pack_config      guard_sku_pack_config          (drift)
--     trg_block_pack_config_change   block_pack_config_change_...   (0190)
--
-- Both BEFORE UPDATE, both raising on the same condition. That is the same
-- class migration 0195 fixed for CHECK constraints — six rules declared twice,
-- both evaluated on every write, and when a write is refused either could be
-- the one that named it. `rls_surface.test.sql` already guards constraints
-- against exactly this; nothing guarded triggers.
--
-- ── WHICH ONE WINS, AND WHY IT IS NOT A COIN TOSS ───────────────────────────
--
-- 0190's is strictly stronger and it is the one the migrations own:
--
--                              drifted            0190
--   blocks on batches            yes              yes
--   blocks on SALES              NO               yes
--   runs as                      invoker          SECURITY DEFINER — so row
--                                                 security cannot show the
--                                                 guard an empty history and
--                                                 have the change waved through
--   message                      terse            names what exists, and agrees
--                                                 with its own numbers
--
-- ── BUT THE DRIFTED ONE DID ONE THING 0190 DOES NOT ─────────────────────────
--
-- On the path where the change is ALLOWED — no batches, no sales, so the pack
-- size can still be corrected freely — the old trigger wrote an audit_log row
-- recording the change. 0190 simply returns.
--
-- Dropping the duplicate would therefore have quietly deleted an audit trail,
-- which is a worse outcome than the duplication. So the audit row moves into
-- 0190's function FIRST, and only then is the old pair dropped. Cleaning up a
-- duplicate must not lose the half of it that was doing something.

-- ── 1. KEEP THE AUDIT ROW, IN THE FUNCTION THE MIGRATIONS OWN ───────────────
create or replace function public.block_pack_config_change_with_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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

  -- Counted with definer rights on purpose. A guard that reads through the
  -- caller's row level security can be shown an empty history and wave the
  -- change through, which is the opposite of a guard.
  select count(*) into v_batches from inventory_batches where sku_id = old.id;
  select count(*) into v_lines   from sales_order_lines  where sku_id = old.id;

  if v_batches = 0 and v_lines = 0 then
    -- NOTHING RECORDED YET: the pack size can still be corrected freely, and
    -- the correction is WRITTEN DOWN. This insert came from the drifted
    -- guard_sku_pack_config, which 0207 removes — it was the one thing that
    -- trigger did that this one did not, and a cleanup that loses an audit
    -- trail is worse than the duplication it removes.
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
          hint    = 'Add the new pack format as its own SKU, then stop reordering this one.';
end $$;

-- ── 2. NOW DROP THE DUPLICATE ───────────────────────────────────────────────
-- Guarded: the replacement must be present and wired to `skus` before anything
-- is removed. A migration that drops a money-or-stock guard and finds the
-- replacement absent has taken a rule off the table rather than deduplicating
-- it. Idempotent — a replay from empty never created either, so this is a no-op
-- there and the guard still checks the replacement is real.
do $$
begin
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.skus'::regclass
       and not t.tgisinternal
       and t.tgfoid = 'public.block_pack_config_change_with_history'::regproc
  ) then
    raise exception
      'Refusing to drop the old pack-size guard: 0190''s replacement is not on skus. Fix that first.';
  end if;

  drop trigger if exists trg_guard_sku_pack_config on public.skus;
  drop function if exists public.guard_sku_pack_config();
end $$;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  -- Exactly ONE trigger on skus enforces the pack-size rule.
  select count(*) into v_n
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.skus'::regclass and not t.tgisinternal
     and pg_get_functiondef(p.oid) like '%pcs_per_pack%';
  if v_n <> 1 then
    raise exception '% triggers on skus still enforce the pack-size rule — expected exactly 1', v_n;
  end if;

  -- And the audit row the drop would otherwise have cost us is now in the
  -- surviving function.
  if pg_get_functiondef('public.block_pack_config_change_with_history'::regproc)
       not like '%audit_log%' then
    raise exception 'the surviving guard no longer records a pack-size correction';
  end if;
end $$;

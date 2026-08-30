-- 0225 — the batch-cost guard learns the same door.
--
-- correct_pack_config (0224) was refused by block_batch_cost_changes, which is
-- doing its job: a batch's landed cost and received quantity are locked once a
-- GRN is confirmed, because that is where hard rule 3 lives — the FX rate and
-- the money paid are fixed at receipt and never recomputed.
--
-- A pack-size restatement does not break that rule, it depends on it:
--
--   landed_per_carton_mvr   the money paid for one carton     NEVER TOUCHED
--   landed_per_pack_mvr     that money / packs per carton     re-divided
--   landed_per_piece_mvr    that money / pieces per carton    re-divided
--   qty_pieces_received     cartons received x pieces         re-derived
--
-- The carton total is the invariant and stays exactly as locked. Only its
-- division moves, because the divisor was typed wrong. The guard cannot see
-- that distinction, so it gets the same single door 0224 gave the pack-config
-- guard — a transaction-local flag that only correct_pack_config sets.
--
-- The carton figure is protected explicitly even inside the door: if a
-- restatement ever tried to move the money actually paid, this still refuses.
-- The door is for re-dividing a total, never for changing one.

create or replace function public.block_batch_cost_changes()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.pack_restatement', true), '') = 'on' then
    -- Even here, the money paid for a carton is untouchable. A restatement
    -- re-divides a locked total; it never restates the total itself.
    if new.landed_per_carton_mvr is distinct from old.landed_per_carton_mvr then
      raise exception 'A pack-size restatement may re-divide a carton cost but never change it — MVR % is what was paid and what the GRN locked',
        old.landed_per_carton_mvr;
    end if;
    return new;
  end if;

  if new.landed_per_piece_mvr  is distinct from old.landed_per_piece_mvr
  or new.landed_per_pack_mvr   is distinct from old.landed_per_pack_mvr
  or new.landed_per_carton_mvr is distinct from old.landed_per_carton_mvr
  or new.qty_pieces_received   is distinct from old.qty_pieces_received then
    raise exception 'A batch''s locked landed cost / received qty cannot be edited — void or reopen the GRN to rebuild it';
  end if;
  return new;
end $function$;

do $$
declare
  v text := regexp_replace(
    pg_get_functiondef('public.block_batch_cost_changes()'::regprocedure), '--[^\n]*', '', 'g');
begin
  if v !~ 'app\.pack_restatement' then
    raise exception 'the batch guard has no door, so a pack size can never be restated';
  end if;
  if v !~ 'never change it' then
    raise exception 'the carton cost is no longer protected inside the door';
  end if;
  if v !~ 'void or reopen the GRN' then
    raise exception 'the batch guard stopped refusing an ordinary cost edit';
  end if;
end $$;

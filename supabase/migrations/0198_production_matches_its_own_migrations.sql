-- 0198 — production matches its own migrations again.
--
-- ── THE REQUIREMENT, WRITTEN BEFORE THE CODE ────────────────────────────────
--
-- R1  Replaying every migration onto an empty Postgres produces the schema that
--     production actually has.
--
--     AC1  No column exists in production that no migration creates.
--     AC2  Nothing is dropped that holds data or that anything reads.
--     AC3  A drift check exists so the next one is found by the gate rather
--          than by someone noticing.
--
-- ── WHY THIS MATTERS MORE THAN IT LOOKS ─────────────────────────────────────
--
-- `db-tests.yml` replays every migration onto a fresh Postgres and runs 351
-- pgTAP tests against the result. That is the entire guarantee that the money
-- and stock engines are correct. It is only worth anything if the schema it
-- builds is production's schema — otherwise CI is testing a database that does
-- not exist, and passing means less than it appears to.
--
-- ── WHAT WAS FOUND, AND HOW ─────────────────────────────────────────────────
--
-- docs/OPEN.md recorded ONE drifted column (E1: sales_orders.godown_id, noticed
-- in passing). Comparing the two schemas column by column found THREE, all on
-- the same table:
--
--     production sales_orders   27 columns
--     migrations sales_orders   24 columns
--
--     godown_id      uuid                      + FK to godowns + idx_so_godown
--     dispatched_at  timestamptz
--     payment_ref    text
--
-- and nothing else in the database differs — 486 columns against 483, every
-- other one of the 45 tables and views identical. That is the value of checking
-- rather than remembering: the register was right that there was a problem and
-- wrong about its size, which is exactly the failure mode a register is for.
--
-- These are leftovers from before migrations were the discipline, orphaned when
-- source_godown_id replaced godown_id (0164/0165) and when the dispatch and
-- payment-reference designs changed.
--
-- ── PROVEN DEAD BEFORE BEING DROPPED ────────────────────────────────────────
--
-- Each of the three, checked on production:
--
--     rows carrying a value          0 of 129 orders     (all three NULL)
--     database objects referencing   0 of 128 functions and views
--     app source references          0 across lib/, components/, app/
--     migrations creating them       0
--
-- The only dependants are godown_id's own foreign key and index — an index
-- Postgres has been maintaining on every order write, for a column that has
-- never held a value.
--
-- The DO block below re-checks all of that at run time and RAISES rather than
-- dropping if any of it has changed since. A migration that quietly destroys a
-- column someone started using in the meantime would be far worse than the
-- drift it fixes.
--
-- Idempotent: `if exists` throughout, so a replay from empty — where these
-- columns were never created — does nothing at all.

do $$
declare
  v_col       text;
  v_rows      bigint;
  v_refs      text;
  v_blocked   text := '';
begin
  foreach v_col in array array['godown_id', 'dispatched_at', 'payment_ref'] loop
    -- Not there at all (a replay from empty) — nothing to check or do.
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'sales_orders' and column_name = v_col
    ) then
      continue;
    end if;

    -- REFUSE if the column has acquired data.
    execute format('select count(*) from public.sales_orders where %I is not null', v_col)
       into v_rows;
    if v_rows > 0 then
      v_blocked := v_blocked || format('%s now holds %s value(s); ', v_col, v_rows);
      continue;
    end if;

    -- REFUSE if anything has started reading it.
    --
    -- THE FIRST VERSION OF THIS GUARD WAS TOO LOOSE AND FIRED FALSELY, which is
    -- worth keeping because the failure was instructive. It asked for "a body
    -- mentioning godown_id that also mentions sales_orders" and named six
    -- functions including post_sale — the function that deducts stock. Reading
    -- post_sale, every one of its godown_id occurrences is something else:
    -- `v_order.source_godown_id` (a different column), `COALESCE(...) AS
    -- godown_id` (a query ALIAS), `bs.godown_id` (v_batch_stock) and
    -- `stock_movements (..., godown_id, ...)`. Not one is sales_orders.godown_id.
    --
    -- So the guard now asks two precise questions instead of one vague one:
    --
    --   VIEWS      pg_depend, which is Postgres's own record of which column a
    --              view actually depends on. Authoritative, not a guess.
    --   FUNCTIONS  a reference QUALIFIED by a sales_orders alias. Postgres has
    --              no column-level dependency tracking for function bodies, so
    --              text is the only option — but a qualified reference is the
    --              one that cannot be confused with another table's column of
    --              the same name.
    --
    -- Backed by the strongest evidence of all, checked above: all 129 orders
    -- have NULL here after 129 post_sale runs. Anything writing this column
    -- would have left a value in it.
    -- The ::text casts are because relname and proname are Postgres's `name`
    -- type. The prokind filter below is the one that actually mattered — see
    -- the comment there. Neither showed up locally, because these columns do
    -- not exist there so this branch never ran; the guard had to be dry-run
    -- against production, before any DDL, to surface them.
    select string_agg(refname, ', ') into v_refs from (
      select distinct c.relname::text as refname
        from pg_depend d
        join pg_rewrite r on r.oid = d.objid
        join pg_class c   on c.oid = r.ev_class
        join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
       where d.refobjid = 'public.sales_orders'::regclass
         and a.attname = v_col
         and c.relkind = 'v'
      union
      select p.proname::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         -- prokind='f' means a PLAIN function. pg_get_functiondef THROWS when
         -- handed an aggregate ('a') or a window function ('w'), and reports it
         -- as "array_agg is an aggregate function" — naming whichever aggregate
         -- it reached first, which is why the message points at something this
         -- migration never mentions.
         and p.prokind = 'f'
         and pg_get_functiondef(p.oid) ~ ('\m(so|o|ord|sales_orders)\.' || v_col || '\M')
    ) s;
    if v_refs is not null then
      v_blocked := v_blocked || format('%s is now referenced by %s; ', v_col, v_refs);
      continue;
    end if;

    execute format('alter table public.sales_orders drop column if exists %I cascade', v_col);
    raise notice '0198: dropped sales_orders.%', v_col;
  end loop;

  if v_blocked <> '' then
    raise exception
      'Refusing to drop a column that is no longer dead: %. Re-check before editing this migration.',
      v_blocked;
  end if;
end $$;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
-- A migration that reports success while changing nothing is the failure mode
-- 0189 and 0197 were both hardened against.
do $$
declare v_left text;
begin
  select string_agg(column_name, ', ' order by column_name) into v_left
    from information_schema.columns
   where table_schema = 'public' and table_name = 'sales_orders'
     and column_name in ('godown_id', 'dispatched_at', 'payment_ref');
  if v_left is not null then
    raise exception 'sales_orders still carries the drifted column(s): %', v_left;
  end if;
end $$;

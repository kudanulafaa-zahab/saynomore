-- A pure helper must stay inlinable.
--
-- WHY THIS FILE EXISTS. Postgres substitutes a simple SQL function's body
-- straight into the calling query — no function call survives, and the planner
-- can see through it. It refuses to do that for a function carrying a SET
-- clause, because the setting has to be established around the call, so the
-- call has to survive.
--
-- `SET search_path` on two pure CASE expressions therefore cost a GUC save and
-- restore FOR EVERY ROW, on the hottest path in the app — stock is
-- SUM(stock_movements), so every stock figure anywhere goes through
-- stock_signed_delta. Measured on production before 0197 removed them:
--
--     get_dashboard_metrics   64.10 ms  ->  49.49 ms
--     one aggregate over the 279-row ledger    1.669 ms  ->  0.204 ms
--
-- Nothing fails when the SET comes back. The function still returns the right
-- answer; the app just gets slower, invisibly, and stays that way until someone
-- profiles it again. A comment saying "do not add SET here" would be read by
-- nobody, which is why this is a test.
--
-- BY ENUMERATION, NEVER BY NAME — the same rule as rls_surface.test.sql. A list
-- of known helpers is correct on the day it is written and silently incomplete
-- from the next migration onward. This asks the catalogue what exists now, so a
-- third pure helper added next year is covered without anyone doing anything.

begin;
select plan(4);

-- ── No pure, inlinable helper is blocked from being inlined ────────────────
-- The shape that matters, all four conditions together:
--   language sql        — only SQL functions are ever inlined
--   IMMUTABLE           — a VOLATILE function is never inlined regardless
--   not SECURITY DEFINER — a definer function genuinely NEEDS its pinned path,
--                         and that rule is enforced in rls_surface.test.sql.
--                         This test must never be read as weakening it.
--   body has no FROM    — inlining requires a single SELECT with no FROM.
--                         normalise_island fails this (it uses two CTEs), so it
--                         could never be inlined with or without the SET, and
--                         measured 2.087 -> 2.058 ms, i.e. nothing. Stripping
--                         its SET would be churn, so it is correctly excluded
--                         here rather than exempted by name.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and l.lanname = 'sql'
      and p.provolatile = 'i'
      and not p.prosecdef
      and p.proconfig is not null
      and p.prosrc !~* '\mfrom\M'),
  'none',
  'no pure inlinable SQL helper carries a SET clause, which would stop Postgres inlining it'
);

-- ── The guard is guarding something ────────────────────────────────────────
-- "none" is also the answer if these helpers were renamed, moved to plpgsql, or
-- deleted — which is exactly how a test quietly stops testing. Name the two
-- this was written for and assert they are still the shape it cares about.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.proname in ('stock_signed_delta', 'unit_noun')
      and l.lanname = 'sql'
      and p.provolatile = 'i'
      and not p.prosecdef
      and p.proconfig is null),
  'stock_signed_delta, unit_noun',
  'and both helpers 0197 freed are still pure, IMMUTABLE, SQL and unpinned'
);

-- ── Speed that changed an answer would be worse than the slowness ──────────
-- The whole point of removing the SET is that it cannot change what these
-- return. Prove that rather than assert it. Every branch, including the one
-- that matters most: 'adjustment' carries its own sign already, so treating it
-- like 'in' or 'out' would corrupt every stock correction ever made.
select is(
  concat_ws(',',
    stock_signed_delta('in', 10),           --  10
    stock_signed_delta('transfer_in', 10),  --  10
    stock_signed_delta('return_in', 10),    --  10
    stock_signed_delta('out', 10),          -- -10
    stock_signed_delta('transfer_out', 10), -- -10
    stock_signed_delta('damage_out', 10),   -- -10
    stock_signed_delta('adjustment', -4),   --  -4, already signed
    stock_signed_delta('adjustment', 4),    --   4, already signed
    stock_signed_delta('nonsense', 10)),    --   0, an unknown type moves nothing
  '10,10,10,-10,-10,-10,-4,4,0',
  'stock_signed_delta still signs every movement type exactly as it did'
);

-- unit_noun is what stops a bottle being called a "pack" and a bedding set
-- being called anything else. Every mapping, plus the fallback.
select is(
  concat_ws(',', unit_noun('ml'), unit_noun('g'), unit_noun('tub'), unit_noun('jar'),
                 unit_noun('tube'), unit_noun('bar'), unit_noun('sachet'),
                 unit_noun('bottle'), unit_noun('set'), unit_noun('unit'),
                 unit_noun('pcs'), unit_noun(null)),
  'bottle,pouch,tub,jar,tube,bar,sachet,bottle,set,unit,pack,pack',
  'unit_noun still gives every unit its own word, and falls back to pack'
);

select * from finish();
rollback;

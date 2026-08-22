-- 0197 — two pure helpers stop being function calls.
--
-- MEASURED ON PRODUCTION, INSIDE A TRANSACTION, AND ROLLED BACK BEFORE BEING
-- BELIEVED — the same discipline as 0196:
--
--     get_dashboard_metrics    64.10 ms  ->  49.49 ms
--     get_sku_reorder_alerts   15.35 ms  ->  12.49 ms
--     get_reorder_suggestions  26.35 ms  ->  22.21 ms
--
-- and every row of all three came back byte-identical — compared with EXCEPT ALL
-- against a snapshot taken before the change, 0 differing rows on each.
--
-- get_dashboard_metrics is the single biggest consumer of database time in this
-- app: 796 calls for 73.7 seconds in total, more than any other statement the
-- app issues, and it runs on every dashboard load.
--
-- ── WHY A ONE-LINE CHANGE DOES THAT ──────────────────────────────────────────
-- Postgres INLINES a simple SQL function — it substitutes the body straight
-- into the calling query, so at run time there is no function call left and the
-- planner can see through it. It refuses to inline a function carrying a SET
-- clause, because the setting has to be established around the call, which
-- means the call has to survive.
--
-- So `SET search_path` turned a CASE expression into a real function
-- invocation, with a GUC save and restore, FOR EVERY ROW. Measured on one
-- aggregate over the 279-row stock ledger:
--
--     select sum(stock_signed_delta(movement_type, qty_pieces)) ...   1.669 ms
--     the same CASE written out by hand                               0.204 ms
--
-- Eight times, on 279 rows, for nothing. And stock_signed_delta is on the
-- hottest path in the app — stock is SUM(stock_movements), so every stock
-- figure anywhere goes through it. unit_noun measured 2.572 ms -> 0.209 ms on
-- the same test, and it is on the display path of every screen that names a
-- unit.
--
-- ── WHY REMOVING IT IS SAFE, AND WHY IT IS NOT THE RULE WE ALREADY HAVE ──────
-- skills.md says: "Every new SECURITY DEFINER function: SET search_path". That
-- rule exists because a SECURITY DEFINER function runs as its OWNER, so an
-- unqualified `skus` resolved through the CALLER's search_path can be made to
-- mean a table the caller controls. That is the definer-function hijack, and it
-- is real. This migration does not touch it — no SECURITY DEFINER function
-- loses anything here, and rls_surface.test.sql still enumerates every one of
-- them and fails if any lacks a pinned path.
--
-- NEITHER OF THESE TWO IS SECURITY DEFINER. They run as the caller, with the
-- caller's own rights, and they name no table, view or function at all — they
-- are pure expressions over their arguments:
--
--     stock_signed_delta   a CASE over a text movement type
--     unit_noun            a CASE mapping a unit to its English noun
--
-- There is nothing for a search_path to resolve, so pinning it protected
-- nothing and only blocked the optimiser. Once inlined there is no call left to
-- protect.
--
-- ── WHY normalise_island IS LEFT ALONE, THOUGH IT LOOKS IDENTICAL ────────────
-- The catalogue finds exactly three functions matching the shape "SQL language,
-- IMMUTABLE, not SECURITY DEFINER, carrying a SET clause, naming no relation".
-- The third is normalise_island, and it was in the first draft of this file
-- until it was measured:
--
--     2.087 ms  ->  2.058 ms       i.e. nothing
--
-- Its body has a FROM clause (two CTEs), and inlining requires a single SELECT
-- with no FROM. It could never be inlined, with or without the SET, so removing
-- it would buy nothing and only make the diff bigger. Changing it "for
-- consistency" would be churn dressed as optimisation — the same thing 0195 was
-- careful to disclaim.
--
-- ── THE SUPABASE ADVISOR WILL WARN ABOUT THIS, AND IT IS EXPECTED ───────────
-- After this runs, `function_search_path_mutable` reports exactly two lines:
--
--     Function `public.stock_signed_delta` has a role mutable search_path
--     Function `public.unit_noun` has a role mutable search_path
--
-- That advisor does not distinguish a SECURITY DEFINER function (where the
-- warning is serious) from a pure invoker-rights expression (where there is
-- nothing to resolve). Both of these are the second kind. DO NOT "fix" it by
-- putting the SET back: that silently returns get_dashboard_metrics to 64 ms
-- with no failing test to say so — which is exactly why
-- supabase/tests/database/helpers_can_inline.test.sql exists and will go red
-- if anyone does.
--
-- Bodies below are UNCHANGED, character for character, minus the SET line.
-- `parallel safe` is added because both already qualified and neither said so.

create or replace function public.stock_signed_delta(p_type text, p_qty integer)
returns integer
language sql
immutable parallel safe
as $function$
  SELECT CASE
    WHEN p_type IN ('in', 'transfer_in', 'return_in')     THEN  p_qty
    WHEN p_type IN ('out', 'transfer_out', 'damage_out')  THEN -p_qty
    WHEN p_type = 'adjustment'                            THEN  p_qty  -- already signed
    ELSE 0
  END;
$function$;

create or replace function public.unit_noun(p_unit_uom text)
returns text
language sql
immutable parallel safe
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
           when 'set'    then 'set'
           when 'unit'   then 'unit'
           else 'pack'
         end;
$function$;

-- ── PROVE IT LANDED ──────────────────────────────────────────────────────────
-- A CREATE OR REPLACE that quietly kept the old definition would leave this
-- migration reporting success while changing nothing — the failure mode 0189
-- was hardened against. So it refuses to finish quietly.
do $$
declare
  v_still   text;
  v_meaning text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_still
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('stock_signed_delta', 'unit_noun')
     and p.proconfig is not null;
  if v_still is not null then
    raise exception 'still carrying a SET clause, so still un-inlinable: %', v_still;
  end if;

  -- And that they still MEAN what they meant. Speed that changed an answer
  -- would be far worse than the slowness it replaced.
  select string_agg(x, '; ') into v_meaning from (
                select 'stock_signed_delta out'         as x where stock_signed_delta('out', 10) <> -10
      union all select 'stock_signed_delta in'               where stock_signed_delta('in', 10) <> 10
      union all select 'stock_signed_delta transfer_out'     where stock_signed_delta('transfer_out', 7) <> -7
      union all select 'stock_signed_delta adjustment'       where stock_signed_delta('adjustment', -4) <> -4
      union all select 'stock_signed_delta unknown'          where stock_signed_delta('nonsense', 10) <> 0
      union all select 'unit_noun ml'                        where unit_noun('ml') <> 'bottle'
      union all select 'unit_noun set'                       where unit_noun('set') <> 'set'
      union all select 'unit_noun default'                   where unit_noun('pcs') <> 'pack'
  ) t;
  if v_meaning is not null then
    raise exception 'a helper changed its answer, not just its speed: %', v_meaning;
  end if;
end $$;

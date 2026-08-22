-- 0196 — row security stops asking the same question once per row.
--
-- MEASURED, NOT GUESSED, AND IT OVERTURNED AN EARLIER CONCLUSION. During an
-- earlier sweep the advisor's `multiple_permissive_policies` warnings were
-- dismissed as noise "at this data size". That was wrong, and here is the
-- number that says so — the same call, on the same production data:
--
--     as postgres, row security bypassed        1.75 ms
--     as authenticated, row security enforced  52.85 ms
--
-- Row security was 97% of the cost. Not the SQL, which runs in under 2ms.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
-- A policy expression is a filter, and a bare function call inside one is
-- evaluated FOR EVERY ROW considered. `is_admin_or_manager()` calls
-- `current_user_role()`, which SELECTs from user_profiles. So a query touching
-- five tables asked "who is this person?" against a table, over and over, for
-- every row of every table it looked at.
--
-- Wrapping the call as `(select is_admin_or_manager())` makes Postgres treat it
-- as an InitPlan: evaluated ONCE per query, the result reused for every row.
-- Identical meaning — the functions are STABLE — and the whole cost disappears.
--
-- This project already knew the rule. skills.md says to "wrap auth calls as
-- (select auth.uid()) (initplan)", and the READ policies do exactly that:
--
--     sol_staff_read   (( SELECT current_user_role()) = 'staff' AND ...)   ✔
--     sol_mgr_select   is_admin_manager_or_viewer()                        ✘
--
-- The rule was applied to the policies written with auth.uid() in mind and not
-- to the ones written with a role helper. 36 policies had a bare call in USING
-- and 24 in WITH CHECK, out of 73.
--
-- ── PROVEN BEFORE BEING BELIEVED ─────────────────────────────────────────────
-- Five of them were wrapped inside a transaction on PRODUCTION, benchmarked
-- against real data, and rolled back:
--
--     52.85 ms  ->  3.26 ms        sixteen times faster, five policies
--
-- This migration does the rest.
--
-- ── HOW IT IS DONE, AND WHY NOT BY HAND ──────────────────────────────────────
-- Sixty edits typed out by hand is sixty chances to widen a policy by accident,
-- and a policy that is accidentally widened does not fail — it silently lets the
-- wrong person read money. So the statements are GENERATED from the catalogue,
-- and the rewrite is deliberately the narrowest possible: it replaces exactly
-- three known function calls with themselves wrapped in a select, and touches
-- nothing else in the expression. Anything it does not recognise it leaves
-- alone.
--
-- It also refuses to guess: if a rewrite would change an expression in any way
-- other than adding those wrappers, it raises rather than applying.

do $$
declare
  r          record;
  v_qual     text;
  v_check    text;
  v_new_q    text;
  v_new_c    text;
  v_sql      text;
  v_done     int := 0;
  -- Only these three. They are the role helpers; every one is STABLE, so
  -- hoisting them to an InitPlan cannot change what a policy means.
  v_fns      text[] := array['is_admin_or_manager', 'is_admin_manager_or_viewer', 'current_user_role'];
  f          text;
begin
  for r in
    select p.polname, c.relname, p.polcmd,
           pg_get_expr(p.polqual,      p.polrelid) as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as with_check
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  loop
    v_qual  := r.qual;
    v_check := r.with_check;
    v_new_q := v_qual;
    v_new_c := v_check;

    foreach f in array v_fns loop
      -- Wrap only a BARE call. A call already inside a select is left exactly
      -- as it is, so running this twice changes nothing.
      if v_new_q is not null then
        v_new_q := regexp_replace(v_new_q,
          '(?<![Ss][Ee][Ll][Ee][Cc][Tt] )' || f || '\(\)',
          '(select ' || f || '())', 'g');
      end if;
      if v_new_c is not null then
        v_new_c := regexp_replace(v_new_c,
          '(?<![Ss][Ee][Ll][Ee][Cc][Tt] )' || f || '\(\)',
          '(select ' || f || '())', 'g');
      end if;
    end loop;

    if v_new_q is not distinct from v_qual and v_new_c is not distinct from v_check then
      continue;                              -- nothing bare here
    end if;

    -- REFUSE TO GUESS. Strip the wrappers back out of the rewritten form; if it
    -- does not come back byte-identical to what was there, the rewrite changed
    -- something it was not supposed to and must not be applied.
    declare
      v_back_q text := v_new_q;
      v_back_c text := v_new_c;
    begin
      foreach f in array v_fns loop
        if v_back_q is not null then
          v_back_q := replace(v_back_q, '(select ' || f || '())', f || '()');
        end if;
        if v_back_c is not null then
          v_back_c := replace(v_back_c, '(select ' || f || '())', f || '()');
        end if;
      end loop;
      if v_back_q is distinct from v_qual or v_back_c is distinct from v_check then
        raise exception
          'Refusing to rewrite policy %.% — the wrapped form does not reverse to the original. Before: % / % After: % / %',
          r.relname, r.polname, v_qual, v_check, v_new_q, v_new_c;
      end if;
    end;

    v_sql := format('alter policy %I on public.%I', r.polname, r.relname);
    if v_new_q is not null then
      v_sql := v_sql || format(' using (%s)', v_new_q);
    end if;
    if v_new_c is not null then
      v_sql := v_sql || format(' with check (%s)', v_new_c);
    end if;

    execute v_sql;
    v_done := v_done + 1;
  end loop;

  raise notice '0196: % policies now evaluate their role check once per query instead of once per row', v_done;
end $$;

-- Prove it landed. Anything still calling one of the three helpers bare would
-- undo the whole point, so the migration refuses to finish quietly if any
-- remain.
do $$
declare v_left int;
begin
  select count(*) into v_left
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   -- Case-INsensitive on purpose. Postgres renders a wrapped call back as
   -- "( SELECT is_admin_or_manager() AS ...)" in upper case, so a lower-case
   -- lookbehind reports every policy it just fixed as still broken. That is
   -- exactly what happened the first time this ran.
   where coalesce(pg_get_expr(p.polqual, p.polrelid), '')      ~* '(?<!select )(is_admin_or_manager|is_admin_manager_or_viewer|current_user_role)\(\)'
      or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~* '(?<!select )(is_admin_or_manager|is_admin_manager_or_viewer|current_user_role)\(\)';

  if v_left > 0 then
    raise exception '% policies still call a role helper once per row', v_left;
  end if;
end $$;

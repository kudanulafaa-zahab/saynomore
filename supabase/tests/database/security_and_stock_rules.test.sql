-- Pass 1 of the automated test suite for the money/stock Postgres functions.
-- Everything here has been verified by hand against live production data,
-- repeatedly, across many audit sessions (see migration headers 0121-0146).
-- These checks encode real hard rules from CLAUDE.md/skills.md so a future
-- change that breaks one of them fails here, in CI, before it ever reaches
-- production - not after Ali notices on his phone.

begin;
select plan(10);

-- ── 1. No SECURITY DEFINER function is executable by anon ────────────────
-- skills.md Seat 3: "REVOKE EXECUTE FROM anon in the same migration" for
-- every new SECURITY DEFINER function. This has been violated and caught
-- twice in this project's history (get_pricing_health shipped anon-readable
-- for half a day; get_competitor_reference_prices picked up an implicit
-- PUBLIC grant in migration 0145, caught and fixed same-session). One test
-- covering all ~94 functions at once, instead of relying on remembering to
-- check pg_advisors by hand after every migration.
select is_empty(
  $$
  select p.proname
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosecdef = true
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname <> 'keepalive'
  $$,
  'no SECURITY DEFINER function should be executable by anon (keepalive is the one deliberate exception)'
);

-- ── 2. RLS is enabled on every money/stock table ──────────────────────────
-- Hard rule: stock and money mutations are gated by RLS, not just by
-- application code. A stale policy once let a staff-role session insert
-- raw stock movements directly, bypassing FIFO/audit entirely (found and
-- dropped in migration 0121-0126's audit pass).
select is_empty(
  $$
  select c.relname
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind = 'r'
    and c.relname in (
      'sales_orders', 'sales_order_lines', 'stock_movements', 'order_payments',
      'audit_log', 'shipments', 'shipment_lines', 'batches', 'customers'
    )
    and not c.relrowsecurity
  $$,
  'every money/stock table must have row level security enabled'
);

-- ── 3. stock_signed_delta: the one source of truth for movement direction ─
-- v_batch_stock and v_stock_levels used to reimplement this sign logic
-- inline instead of calling the function; today they agree, but "two
-- definitions can drift" is exactly the pattern that caused real bugs
-- elsewhere in this project (migration 0121-0126 audit). Locking the
-- function's own behaviour down directly.
select is(stock_signed_delta('in', 10),           10, 'in adds stock');
select is(stock_signed_delta('transfer_in', 10),  10, 'transfer_in adds stock');
select is(stock_signed_delta('return_in', 10),    10, 'return_in adds stock');
select is(stock_signed_delta('out', 10),         -10, 'out removes stock');
select is(stock_signed_delta('transfer_out', 10),-10, 'transfer_out removes stock');
select is(stock_signed_delta('damage_out', 10),  -10, 'damage_out removes stock');
select is(stock_signed_delta('adjustment', -5),   -5, 'adjustment passes through already-signed');
select is(stock_signed_delta('adjustment', 5),     5, 'adjustment passes through already-signed');

select * from finish();
rollback;
